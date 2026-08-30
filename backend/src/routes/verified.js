import express from "express";
import { z } from "zod";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  AiRecommendation,
  AuditEvent,
  ReviewDecision,
  ValidationRule,
  VerifiedLoanRecord,
} from "../models/index.js";
import { verifyLoan, unverifyLoan } from "../services/verificationService.js";
import { verifyChain } from "../services/hashChainService.js";
import { computeForLoan } from "../services/trustScoreService.js";
import { canonicalStringify, sha256 } from "../utils/hash.js";
import { escapeRegex, paginationMeta, parsePagination } from "../services/queryHelpers.js";
import { buildSummary } from "./summary.js";

const router = express.Router();
router.use(requireAuth);

// Static-path POSTs must be registered BEFORE `/:loanId` so Express doesn't
// route `/chain-check` into the reviewer-only verify handler.
const chainCheckSchema = z.object({ loanIds: z.array(z.string().min(1)).min(1).max(200) });

router.post(
  "/chain-check",
  asyncHandler(async (req, res) => {
    const parsed = chainCheckSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Invalid body", { issues: parsed.error.issues });
    const results = {};
    for (const lid of parsed.data.loanIds) {
      const r = await verifyChain(lid);
      results[lid] = r.ok;
    }
    res.json({ results });
  })
);

router.post(
  "/:loanId",
  requireRole("reviewer", "admin"),
  asyncHandler(async (req, res) => {
    const record = await verifyLoan(req.params.loanId, { id: req.user.id, role: req.user.role });
    res.status(201).json({ record });
  })
);

router.post(
  "/:loanId/unverify",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    await unverifyLoan(req.params.loanId, { id: req.user.id, role: req.user.role }, req.body?.reason);
    res.json({ ok: true });
  })
);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 25 });
    const match = {};
    if (req.query.state) match["snapshot.state"] = String(req.query.state).toUpperCase();
    if (req.query.verifiedAfter) match.verifiedAt = { $gte: new Date(req.query.verifiedAfter) };
    if (req.query.minTrustScore) match.trustScore = { $gte: Number(req.query.minTrustScore) };

    const pipeline = [
      { $match: match },
      { $sort: { loanId: 1, verifiedAt: -1 } },
      { $group: { _id: "$loanId", latest: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$latest" } },
    ];
    if (req.query.q) {
      const rx = new RegExp(escapeRegex(String(req.query.q)), "i");
      pipeline.push({ $match: { $or: [{ loanId: rx }, { "snapshot.borrowerName": rx }] } });
    }
    pipeline.push({
      $facet: {
        items: [{ $sort: { verifiedAt: -1 } }, { $skip: skip }, { $limit: limit }],
        total: [{ $count: "n" }],
      },
    });
    const [agg] = await VerifiedLoanRecord.aggregate(pipeline);
    const items = agg?.items || [];
    const total = agg?.total?.[0]?.n || 0;
    res.json({ items, ...paginationMeta({ total, page, limit }) });
  })
);

// ---- /export : CSV or JSON of the latest verified record per loan ----

router.get(
  "/export",
  requireRole("reviewer", "admin", "consumer"),
  asyncHandler(async (req, res) => {
    const records = await loadLatestVerifiedFiltered(req.query);
    const format = String(req.query.format || "csv").toLowerCase();
    const stamp = fileStamp();

    // Chain check per exported loan (spec: "compute lazily; only for exports").
    const withChain = await Promise.all(records.map(async (r) => ({
      ...r,
      chainOk: (await verifyChain(r.loanId)).ok,
    })));

    // Audit: emit one `exported` event per loan. We deliberately chain these via
    // appendAuditEvent (not the batched insertMany the spec suggests) so verifyChain
    // stays green — the demo tamper story requires an unbroken chain.
    const actor = req.user.id;
    const actorRole = req.user.role;
    const { appendAuditEvent } = await import("../services/hashChainService.js");
    for (const r of withChain) {
      await appendAuditEvent({
        loanId: r.loanId,
        type: "exported",
        payload: { format, exportedBy: actor, chainOk: r.chainOk, verifiedAt: r.verifiedAt },
        actor,
        actorRole,
      });
    }

    if (format === "json") {
      res.setHeader("Content-Disposition", `attachment; filename="verified-loans-${stamp}.json"`);
      res.setHeader("Content-Type", "application/json");
      const items = withChain.map((r) => ({
        snapshot: r.snapshot,
        trustScore: r.trustScore,
        trustBreakdown: r.trustBreakdown,
        verifiedAt: r.verifiedAt,
        verifiedBy: r.verifiedBy,
        recordHash: r.recordHash,
        prevAuditHash: r.prevAuditHash,
        chainOk: r.chainOk,
      }));
      return res.json({ generatedAt: new Date().toISOString(), count: items.length, items });
    }

    // CSV
    res.setHeader("Content-Disposition", `attachment; filename="verified-loans-${stamp}.csv"`);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    const headers = [
      "loanId","borrowerId","borrowerName","state",
      "originationDate","maturityDate","originalPrincipal","currentBalance",
      "interestRate","paymentStatus","daysPastDue","lastUpdatedAt","documentStatus",
      "trustScore","verifiedAt","verifiedBy","chainOk","recordHash",
    ];
    res.write(headers.join(",") + "\n");
    for (const r of withChain) {
      const s = r.snapshot || {};
      const row = [
        s.loanId, s.borrowerId, s.borrowerName, s.state,
        shortDate(s.originationDate), shortDate(s.maturityDate),
        s.originalPrincipal, s.currentBalance,
        s.interestRate, s.paymentStatus, s.daysPastDue,
        shortDate(s.lastUpdatedAt), s.documentStatus,
        r.trustScore, iso(r.verifiedAt), r.verifiedBy || "system",
        r.chainOk, r.recordHash,
      ];
      res.write(row.map(csvEscape).join(",") + "\n");
    }
    res.end();
  })
);

// ---- /export/bundle : a portable, hash-sealed dataset for the demo close ----

router.get(
  "/export/bundle",
  requireRole("reviewer", "admin", "consumer"),
  asyncHandler(async (req, res) => {
    const records = await loadLatestVerifiedFiltered(req.query);

    const verifiedLoans = await Promise.all(records.map(async (r) => ({
      snapshot: r.snapshot,
      trustScore: r.trustScore,
      trustBreakdown: r.trustBreakdown,
      verifiedAt: r.verifiedAt,
      verifiedBy: r.verifiedBy,
      recordHash: r.recordHash,
      prevAuditHash: r.prevAuditHash,
      chainOk: (await verifyChain(r.loanId)).ok,
    })));

    const loanIds = verifiedLoans.map((v) => v.snapshot?.loanId).filter(Boolean);
    const auditTrails = {};
    for (const lid of loanIds) {
      auditTrails[lid] = await AuditEvent.find({ loanId: lid })
        .sort({ timestamp: 1, _id: 1 })
        .lean();
    }
    const aiRecommendationIds = [
      ...new Set(records.flatMap((r) => (r.aiRecommendationIds || []).map(String))),
    ];
    const [aiRecommendations, reviewDecisions, validationRules, summary] = await Promise.all([
      aiRecommendationIds.length
        ? AiRecommendation.find({ _id: { $in: aiRecommendationIds } }).lean()
        : Promise.resolve([]),
      loanIds.length ? ReviewDecision.find({ loanId: { $in: loanIds } }).lean() : Promise.resolve([]),
      ValidationRule.find({ active: true, approvedBy: { $ne: null } }).lean(),
      buildSummary(),
    ]);

    const bundle = {
      generatedAt: new Date().toISOString(),
      verifiedLoans,
      auditTrails,
      aiRecommendations,
      reviewDecisions,
      validationRules,
      summary,
    };
    bundle.bundleHash = sha256(canonicalStringify(bundle));

    const stamp = fileStamp();
    res.setHeader("Content-Disposition", `attachment; filename="verified-dataset-${stamp}.json"`);
    res.setHeader("Content-Type", "application/json");
    res.json(bundle);
  })
);

router.get(
  "/:loanId",
  asyncHandler(async (req, res) => {
    const record = await VerifiedLoanRecord.findOne({ loanId: req.params.loanId })
      .sort({ verifiedAt: -1 })
      .lean();
    if (!record) throw new HttpError(404, "No verified record for this loan");
    const chain = await verifyChain(req.params.loanId);
    res.json({ record, chainOk: chain.ok, brokenAtIndex: chain.brokenAtIndex });
  })
);

router.get(
  "/:loanId/trust",
  asyncHandler(async (req, res) => {
    const record = await VerifiedLoanRecord.findOne({ loanId: req.params.loanId })
      .sort({ verifiedAt: -1 })
      .lean();
    const current = await computeForLoan(req.params.loanId);
    if (!record) {
      return res.json({ stored: null, current, drift: false, verifiedAt: null });
    }
    const drift =
      record.trustScore !== current.trustScore ||
      diffBreakdown(record.trustBreakdown, current.breakdown);
    res.json({
      stored: {
        trustScore: record.trustScore,
        breakdown: record.trustBreakdown,
      },
      current,
      drift,
      verifiedAt: record.verifiedAt,
    });
  })
);

router.get(
  "/:loanId/history",
  asyncHandler(async (req, res) => {
    const records = await VerifiedLoanRecord.find({ loanId: req.params.loanId })
      .sort({ verifiedAt: 1 })
      .lean();
    res.json({ items: records, total: records.length });
  })
);

function diffBreakdown(a = {}, b = {}) {
  for (const k of ["completeness", "consistency", "freshness", "reviewCoverage"]) {
    if (Number(a?.[k]) !== Number(b?.[k])) return true;
  }
  return false;
}

// --------- shared helpers for /export + /export/bundle ---------

async function loadLatestVerifiedFiltered(query = {}) {
  const match = {};
  if (query.state) match["snapshot.state"] = String(query.state).toUpperCase();
  if (query.verifiedAfter) match.verifiedAt = { $gte: new Date(query.verifiedAfter) };
  if (query.minTrustScore) match.trustScore = { $gte: Number(query.minTrustScore) };

  const pipeline = [
    { $match: match },
    { $sort: { loanId: 1, verifiedAt: -1 } },
    { $group: { _id: "$loanId", latest: { $first: "$$ROOT" } } },
    { $replaceRoot: { newRoot: "$latest" } },
    { $sort: { verifiedAt: -1 } },
  ];
  if (query.q) {
    const rx = new RegExp(String(query.q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    pipeline.push({ $match: { $or: [{ loanId: rx }, { "snapshot.borrowerName": rx }] } });
  }
  return VerifiedLoanRecord.aggregate(pipeline);
}

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function shortDate(v) {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toISOString().slice(0, 10);
}

function iso(v) {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}

function fileStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export default router;
