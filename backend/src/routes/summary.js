import express from "express";
import { asyncHandler } from "../middleware/error.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { computeAggregate, computeForLoan } from "../services/trustScoreService.js";
import {
  AiRecommendation,
  AuditEvent,
  Exception,
  Loan,
  RawImport,
  ReviewDecision,
  User,
  VerifiedLoanRecord,
} from "../models/index.js";

const router = express.Router();
router.use(requireAuth);

// -------------- /trust: portfolio aggregate --------------

router.get(
  "/trust",
  asyncHandler(async (req, res) => {
    const filter = {
      state: req.query.state,
      verifiedAfter: req.query.verifiedAfter,
      minTrustScore: req.query.minTrustScore,
    };
    const agg = await computeAggregate({ filter });
    res.json(agg);
  })
);

// -------------- /summary: one-shot dashboard payload (15s in-memory cache) --------------

const CACHE_TTL_MS = 15_000;
let cache = { at: 0, payload: null };

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const now = Date.now();
    if (cache.payload && now - cache.at < CACHE_TTL_MS) {
      return res.json({ ...cache.payload, _cached: true });
    }
    const payload = await buildSummary();
    cache = { at: now, payload };
    res.json(payload);
  })
);

async function buildSummary() {
  const now = new Date();
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);

  const [
    loanCounts,
    exceptionByStatus,
    exceptionBySeverity,
    batchCounts,
    aiToday,
    aiDecisionMap,
    trust,
    recentActivity,
  ] = await Promise.all([
    Loan.aggregate([{ $group: { _id: "$verificationStatus", n: { $sum: 1 } } }]),
    Exception.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
    Exception.aggregate([{ $group: { _id: "$severity", n: { $sum: 1 } } }]),
    RawImport.aggregate([{ $group: { _id: "$fileType", n: { $sum: 1 } } }]),
    AiRecommendation.find({ createdAt: { $gte: dayStart } })
      .select("_id fallbackUsed createdAt exceptionId")
      .lean(),
    ReviewDecision.find({
      createdAt: { $gte: dayStart },
      action: { $in: ["accept_ai", "edit_ai", "reject_ai"] },
      aiRecommendationId: { $ne: null },
    })
      .select("aiRecommendationId action")
      .lean(),
    computeAggregate({}),
    recentVerifiedActivity(),
  ]);

  const loans = tally(loanCounts, ["pending", "in_review", "verified", "rejected"]);
  const exStatus = tally(exceptionByStatus, ["open", "in_review", "resolved", "dismissed"]);
  const exSev = tally(exceptionBySeverity, ["blocking", "high", "medium", "low"]);
  const batches = tally(batchCounts, ["loan_tape", "servicer_update", "document_manifest"]);
  const totalLoans = loans.pending + loans.in_review + loans.verified + loans.rejected;

  const decisionByRec = new Map(aiDecisionMap.map((d) => [String(d.aiRecommendationId), d.action]));
  const aiCounts = { total: aiToday.length, accepted: 0, edited: 0, rejected: 0, fallback: 0 };
  for (const rec of aiToday) {
    if (rec.fallbackUsed) aiCounts.fallback += 1;
    const action = decisionByRec.get(String(rec._id));
    if (action === "accept_ai") aiCounts.accepted += 1;
    else if (action === "edit_ai") aiCounts.edited += 1;
    else if (action === "reject_ai") aiCounts.rejected += 1;
  }
  const fallbackShareToday = aiCounts.total ? Number((aiCounts.fallback / aiCounts.total).toFixed(2)) : 0;

  return {
    generatedAt: now.toISOString(),
    counts: {
      loans: {
        total: totalLoans,
        verified: loans.verified,
        inReview: loans.in_review,
        pending: loans.pending,
        rejected: loans.rejected,
      },
      exceptions: {
        open: exStatus.open,
        inReview: exStatus.in_review,
        resolved: exStatus.resolved,
        dismissed: exStatus.dismissed,
        bySeverity: exSev,
      },
      batches: {
        loanTape: batches.loan_tape,
        servicerUpdate: batches.servicer_update,
        documentManifest: batches.document_manifest,
      },
      ai: {
        recommendationsToday: aiCounts.total,
        acceptedToday: aiCounts.accepted,
        editedToday: aiCounts.edited,
        rejectedToday: aiCounts.rejected,
        fallbackShareToday,
      },
    },
    trust: {
      portfolioTrustScore: trust.portfolioTrustScore,
      verifiedLoanCount: trust.verifiedLoanCount,
      distribution: trust.distribution,
      breakdownAverages: trust.breakdownAverages,
    },
    recentActivity,
  };
}

function tally(rows, keys) {
  const out = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const r of rows) if (r._id in out) out[r._id] = r.n;
  return out;
}

async function recentVerifiedActivity() {
  const events = await AuditEvent.find({ type: "verified" })
    .sort({ timestamp: -1 })
    .limit(10)
    .lean();
  const actorIds = [...new Set(events.map((e) => e.actor).filter(Boolean).map(String))];
  const users = actorIds.length
    ? await User.find({ _id: { $in: actorIds } }).select("email name").lean()
    : [];
  const uMap = new Map(users.map((u) => [String(u._id), u]));
  return events.map((e) => ({
    type: e.type,
    loanId: e.loanId,
    actor: e.actor ? (uMap.get(String(e.actor))?.email || String(e.actor)) : "system",
    timestamp: e.timestamp,
  }));
}

// Testing/dev hook so seed/reset scripts can force a rebuild.
export function _clearSummaryCache() { cache = { at: 0, payload: null }; }

// ============ role-specific augments ============
// Each layers on top of buildSummary() with only the data that role's
// dashboard actually renders. All are cache-friendly for polling.

router.get(
  "/operator",
  requireRole("operator", "admin"),
  asyncHandler(async (req, res) => {
    const now = new Date();
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);

    const [summary, recentImports, failedToday, latestBatch, ageBands, awaitingValidation] = await Promise.all([
      buildSummary(),
      RawImport.find({}, { rawText: 0, failedRows: 0 })
        .sort({ createdAt: -1 })
        .limit(8)
        .populate("uploadedBy", "email name")
        .lean(),
      RawImport.aggregate([
        { $match: { createdAt: { $gte: dayStart } } },
        { $group: { _id: null, failed: { $sum: "$failedRowCount" }, ingested: { $sum: "$normalizedCount" } } },
      ]),
      RawImport.findOne({}).sort({ createdAt: -1 }).select("batchId fileType status createdAt originalFilename").lean(),
      loanStalenessBands(now),
      Loan.countDocuments({ verificationStatus: "pending" }),
    ]);

    const totalImports = await RawImport.countDocuments();
    res.json({
      ...summary,
      operator: {
        totalImports,
        rowsIngestedToday: failedToday[0]?.ingested || 0,
        rowsFailedToday: failedToday[0]?.failed || 0,
        loansAwaitingValidation: awaitingValidation,
        latestBatchStatus: latestBatch
          ? { batchId: latestBatch.batchId, fileType: latestBatch.fileType, status: latestBatch.status, originalFilename: latestBatch.originalFilename, createdAt: latestBatch.createdAt }
          : null,
        recentImports: recentImports.map((r) => ({
          batchId: r.batchId,
          fileType: r.fileType,
          originalFilename: r.originalFilename,
          rowCount: r.rowCount,
          failedRowCount: r.failedRowCount,
          status: r.status,
          uploadedBy: r.uploadedBy?.email || null,
          createdAt: r.createdAt,
        })),
        staleness: ageBands,
      },
    });
  })
);

router.get(
  "/reviewer",
  requireRole("reviewer", "admin"),
  asyncHandler(async (req, res) => {
    const now = new Date();
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [summary, queueDepth, blockingCount, myClaimed, aiToday, aiWeek, aiDecisionsToday, topRules, avgResolutionMs, recentDecisions] = await Promise.all([
      buildSummary(),
      Exception.countDocuments({ status: { $in: ["open", "in_review"] } }),
      Exception.countDocuments({ status: { $in: ["open", "in_review"] }, severity: "blocking" }),
      myClaimedCount(req.user.id),
      AiRecommendation.countDocuments({ createdAt: { $gte: dayStart } }),
      AiRecommendation.countDocuments({ createdAt: { $gte: weekStart } }),
      ReviewDecision.aggregate([
        { $match: { createdAt: { $gte: dayStart }, action: { $in: ["accept_ai", "edit_ai", "reject_ai"] } } },
        { $group: { _id: "$action", n: { $sum: 1 } } },
      ]),
      Exception.aggregate([
        { $match: { status: { $in: ["open", "in_review"] } } },
        { $group: { _id: "$ruleId", ruleName: { $first: "$ruleName" }, severity: { $first: "$severity" }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 8 },
      ]),
      avgResolutionMinutes(),
      recentReviewDecisions(),
    ]);

    const aiToDayCounts = tally(aiDecisionsToday, ["accept_ai", "edit_ai", "reject_ai"]);
    const fallbackToday = await AiRecommendation.countDocuments({ createdAt: { $gte: dayStart }, fallbackUsed: true });

    res.json({
      ...summary,
      reviewer: {
        queueDepth,
        blockingCount,
        myClaimedCount: myClaimed,
        aiUsage: {
          today: {
            total: aiToday,
            accepted: aiToDayCounts.accept_ai,
            edited: aiToDayCounts.edit_ai,
            rejected: aiToDayCounts.reject_ai,
            fallback: fallbackToday,
          },
          week: { total: aiWeek },
        },
        avgResolutionMinutes: avgResolutionMs,
        topRulesByOpenCount: topRules.map((r) => ({
          ruleId: r._id,
          ruleName: r.ruleName,
          severity: r.severity,
          count: r.count,
        })),
        recentDecisions,
      },
    });
  })
);

router.get(
  "/consumer",
  asyncHandler(async (req, res) => {
    const now = new Date();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [summary, latestPerLoan, exportsThisWeek] = await Promise.all([
      buildSummary(),
      VerifiedLoanRecord.aggregate([
        { $sort: { loanId: 1, verifiedAt: -1 } },
        { $group: { _id: "$loanId", latest: { $first: "$$ROOT" } } },
        { $replaceRoot: { newRoot: "$latest" } },
      ]),
      AuditEvent.countDocuments({ type: "exported", timestamp: { $gte: weekStart } }),
    ]);

    let drifted = 0;
    await Promise.all(
      latestPerLoan.slice(0, 50).map(async (rec) => {
        try {
          const current = await computeForLoan(rec.loanId);
          if (Number(current?.trustScore) !== Number(rec.trustScore)) drifted += 1;
        } catch { /* skip */ }
      })
    );

    res.json({
      ...summary,
      consumer: {
        portfolioTrustScore: summary.trust.portfolioTrustScore,
        distribution: summary.trust.distribution,
        breakdownAverages: summary.trust.breakdownAverages,
        verifiedCount: summary.trust.verifiedLoanCount,
        driftedCount: drifted,
        exportsThisWeek,
        latestVerifiedAt: summary.recentActivity[0]?.timestamp || null,
      },
    });
  })
);

// -------- helpers for the augment endpoints --------

async function myClaimedCount(userId) {
  const rows = await ReviewDecision.aggregate([
    { $match: { reviewer: toObjectId(userId), action: { $in: ["claim", "add_comment", "edit_field", "manual_approve", "manual_reject", "request_correction", "accept_ai", "edit_ai", "reject_ai"] } } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: "$exceptionId", lastReviewer: { $first: "$reviewer" } } },
  ]);
  const exceptionIds = rows.map((r) => r._id);
  if (!exceptionIds.length) return 0;
  return Exception.countDocuments({ exceptionId: { $in: exceptionIds }, status: "in_review" });
}

function toObjectId(v) {
  try { return new (Loan.base.Types.ObjectId)(String(v)); } catch { return v; }
}

async function avgResolutionMinutes() {
  const rows = await Exception.aggregate([
    { $match: { resolvedAt: { $ne: null } } },
    { $project: { minutes: { $divide: [{ $subtract: ["$resolvedAt", "$createdAt"] }, 60000] } } },
    { $group: { _id: null, avg: { $avg: "$minutes" } } },
  ]);
  return rows[0]?.avg ? Math.round(rows[0].avg) : 0;
}

async function recentReviewDecisions() {
  const decisions = await ReviewDecision.find({})
    .sort({ createdAt: -1 })
    .limit(10)
    .populate("reviewer", "email name")
    .lean();
  return decisions.map((d) => ({
    id: String(d._id),
    loanId: d.loanId,
    exceptionId: d.exceptionId,
    action: d.action,
    comment: d.comment,
    reviewer: d.reviewer?.email || "system",
    reviewerName: d.reviewer?.name || null,
    createdAt: d.createdAt,
  }));
}

async function loanStalenessBands(now) {
  const bands = [
    { label: "0-30d", maxDays: 30 },
    { label: "31-90d", maxDays: 90 },
    { label: "91-180d", maxDays: 180 },
    { label: "181-365d", maxDays: 365 },
    { label: "365+d", maxDays: Infinity },
  ];
  const loans = await Loan.find({}, { lastUpdatedAt: 1 }).lean();
  const out = Object.fromEntries(bands.map((b) => [b.label, 0]));
  for (const l of loans) {
    if (!l.lastUpdatedAt) { out["365+d"] += 1; continue; }
    const days = (now.getTime() - new Date(l.lastUpdatedAt).getTime()) / (1000 * 60 * 60 * 24);
    const band = bands.find((b) => days <= b.maxDays);
    out[band.label] += 1;
  }
  return {
    loansOlderThan90Days: out["91-180d"] + out["181-365d"] + out["365+d"],
    bands: bands.map((b) => ({ label: b.label, count: out[b.label] })),
  };
}

export { buildSummary };
export default router;
