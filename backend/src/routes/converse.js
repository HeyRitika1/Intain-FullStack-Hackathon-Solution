import express from "express";
import { z } from "zod";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { run as aiRun } from "../services/ai/aiService.js";
import { appendAuditEvent } from "../services/hashChainService.js";
import { AiRecommendation, VerifiedLoanRecord } from "../models/index.js";
import { logger } from "../utils/logger.js";

// SECURITY: Converse queries run against VerifiedLoanRecord ONLY. Non-verified
// data is never queryable through this endpoint. This is a hard rule from the
// strategy doc (section 5.1: "Consumer never sees raw unverified data").

const WHITELISTED_FIELDS = [
  "loanId", "state", "paymentStatus", "verificationStatus",
  "daysPastDue", "interestRate", "currentBalance", "originalPrincipal", "trustScore",
];
const WHITELISTED_OPS = new Set([
  "$eq", "$ne", "$gt", "$gte", "$lt", "$lte", "$in", "$nin", "$and", "$or", "$regex",
]);
const LOGICAL_OPS = new Set(["$and", "$or"]);
const MAX_DEPTH = 3;
const MAX_REGEX_LEN = 32;

// snapshot.<field> is what VerifiedLoanRecord actually stores. trustScore lives
// at the top level. This mapping applied at query-time — user-facing filter
// still uses the flat names.
function toSnapshotField(field) {
  if (field === "trustScore" || field === "verifiedAt") return field;
  return `snapshot.${field}`;
}

/**
 * Validate a mongoFilter against the whitelist. Returns
 * { safe: true, filter } or { safe: false, offending: [...] }.
 */
function sanitizeFilter(input, depth = 0) {
  const offending = [];
  if (depth > MAX_DEPTH) {
    return { safe: false, offending: ["nesting-depth-exceeded"] };
  }
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { safe: false, offending: ["non-object-root"] };
  }
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (key.startsWith("$")) {
      // logical operator at root
      if (!LOGICAL_OPS.has(key)) {
        offending.push(key);
        continue;
      }
      if (!Array.isArray(value)) {
        offending.push(`${key}:not-array`);
        continue;
      }
      const arr = [];
      for (const sub of value) {
        const r = sanitizeFilter(sub, depth + 1);
        if (!r.safe) { offending.push(...r.offending); continue; }
        arr.push(r.filter);
      }
      if (arr.length) out[key] = arr;
    } else {
      if (!WHITELISTED_FIELDS.includes(key)) {
        offending.push(key);
        continue;
      }
      const sanitizedValue = sanitizeFieldValue(value, offending, depth + 1);
      if (sanitizedValue !== undefined) out[toSnapshotField(key)] = sanitizedValue;
    }
  }
  if (offending.length) return { safe: false, offending };
  return { safe: true, filter: out };
}

function sanitizeFieldValue(value, offending, depth) {
  if (depth > MAX_DEPTH) { offending.push("nesting-depth-exceeded"); return undefined; }
  if (value === null || typeof value !== "object" || Array.isArray(value) || value instanceof RegExp) {
    // scalar or array literal
    return value;
  }
  const out = {};
  for (const [op, val] of Object.entries(value)) {
    if (!op.startsWith("$")) { offending.push(op); continue; }
    if (!WHITELISTED_OPS.has(op)) { offending.push(op); continue; }
    if (op === "$regex") {
      const s = String(val);
      if (s.length > MAX_REGEX_LEN) { offending.push("$regex:too-long"); continue; }
      out[op] = s;
    } else if (op === "$in" || op === "$nin") {
      if (!Array.isArray(val)) { offending.push(`${op}:not-array`); continue; }
      out[op] = val;
    } else {
      out[op] = val;
    }
  }
  return out;
}

// ---- routes ----

const router = express.Router();
router.use(requireAuth);
router.use(requireRole("consumer", "reviewer", "admin"));

const converseSchema = z.object({ naturalLanguage: z.string().min(1).max(500) });

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = converseSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Invalid body", { issues: parsed.error.issues });

    const { rec } = await aiRun({
      templateName: "converse_query",
      input: { naturalLanguage: parsed.data.naturalLanguage, schemaHint: WHITELISTED_FIELDS },
      actor: req.user.id,
      loanId: "__QUERY__",
    });

    const out = rec.output || {};
    if (out.error) {
      // Fallback couldn't parse — still return the recommendation, results empty.
      return res.json({
        recommendationId: String(rec._id),
        mongoFilter: {},
        humanSummary: out.error,
        involvedFields: [],
        confidence: 0,
        fallbackUsed: rec.fallbackUsed,
        fallbackMode: true,
        results: [],
        model: rec.model,
      });
    }

    const check = sanitizeFilter(out.mongoFilter || {});
    if (!check.safe) {
      logger.warn(`[converse] rejected filter for user=${req.user.email} offending=${check.offending.join(",")} raw=${JSON.stringify(out.mongoFilter).slice(0, 200)}`);
      throw new HttpError(400, "Unsafe or unsupported filter", { offending: check.offending });
    }

    const sort = sanitizeSort(out.sort);
    const rawLimit = Number(out.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(50, rawLimit) : 50;

    // Aggregate: latest VerifiedLoanRecord per loanId, then apply sanitized filter.
    const pipeline = [
      { $sort: { loanId: 1, verifiedAt: -1 } },
      { $group: { _id: "$loanId", latest: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$latest" } },
      { $match: check.filter },
    ];
    if (sort) pipeline.push({ $sort: sort });
    else pipeline.push({ $sort: { verifiedAt: -1 } });
    pipeline.push({ $limit: limit });
    pipeline.push({
      $project: {
        _id: 0,
        loanId: 1,
        trustScore: 1,
        trustBreakdown: 1,
        verifiedAt: 1,
        verifiedBy: 1,
        snapshot: {
          borrowerName: "$snapshot.borrowerName",
          state: "$snapshot.state",
          paymentStatus: "$snapshot.paymentStatus",
          verificationStatus: "$snapshot.verificationStatus",
          daysPastDue: "$snapshot.daysPastDue",
          interestRate: "$snapshot.interestRate",
          currentBalance: "$snapshot.currentBalance",
          originalPrincipal: "$snapshot.originalPrincipal",
        },
      },
    });

    const results = await VerifiedLoanRecord.aggregate(pipeline);

    await appendAuditEvent({
      loanId: "__QUERY__",
      type: "exported",
      payload: {
        subType: "converse_query",
        naturalLanguage: parsed.data.naturalLanguage,
        recommendationId: String(rec._id),
        resultsCount: results.length,
        userEmail: req.user.email,
      },
      actor: req.user.id,
      actorRole: req.user.role,
    });

    res.json({
      recommendationId: String(rec._id),
      mongoFilter: out.mongoFilter,
      humanSummary: out.humanSummary || "",
      involvedFields: out.involvedFields || [],
      confidence: out.confidence ?? null,
      fallbackUsed: rec.fallbackUsed,
      model: rec.model,
      sort,
      limit,
      results,
    });
  })
);

function sanitizeSort(sort) {
  if (!sort || typeof sort !== "object") return null;
  const out = {};
  for (const [field, dir] of Object.entries(sort)) {
    if (!WHITELISTED_FIELDS.includes(field)) continue;
    const d = Number(dir) === -1 ? -1 : 1;
    out[toSnapshotField(field)] = d;
  }
  return Object.keys(out).length ? out : null;
}

// Recent queries for the popover. Filters AiRecommendations of template
// converse_query created by the current user.
router.get(
  "/history",
  asyncHandler(async (req, res) => {
    const limit = Math.min(50, Number(req.query.limit) || 20);
    const items = await AiRecommendation.find({
      templateName: "converse_query",
      createdBy: req.user.id,
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select("_id output confidence fallbackUsed createdAt promptSnapshot")
      .lean();
    // Decode the human-language query from the persisted prompt snapshot.
    const decoded = items.map((i) => {
      let nl = "";
      try { nl = JSON.parse(JSON.parse(i.promptSnapshot).user).naturalLanguage || ""; } catch { /* ignore */ }
      return {
        id: String(i._id),
        naturalLanguage: nl,
        humanSummary: i.output?.humanSummary || i.output?.error || "",
        mongoFilter: i.output?.mongoFilter || {},
        fallbackUsed: i.fallbackUsed,
        confidence: i.confidence,
        createdAt: i.createdAt,
      };
    });
    res.json({ items: decoded });
  })
);

export default router;
