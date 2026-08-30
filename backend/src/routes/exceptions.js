import express from "express";
import { z } from "zod";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { AiRecommendation, Exception, Loan, ReviewDecision } from "../models/index.js";
import { appendAuditEvent } from "../services/ingestService.js";
import { computeVerifiabilityStatus } from "../services/verificationService.js";
import {
  escapeRegex,
  paginationMeta,
  parseCsvList,
  parsePagination,
  severityRankStage,
} from "../services/queryHelpers.js";

const router = express.Router();
router.use(requireAuth);

const STATUS_VALUES = ["open", "in_review", "resolved", "dismissed"];
const SEVERITY_VALUES = ["blocking", "high", "medium", "low"];

// Whitelist for both PATCH /api/loans/:id and AI-driven field application.
const LOAN_EDITABLE_FIELDS = new Set([
  "borrowerName",
  "state",
  "currentBalance",
  "interestRate",
  "paymentStatus",
  "daysPastDue",
  "lastUpdatedAt",
  "documentStatus",
]);

const IDEMPOTENCY_WINDOW_MS = 5_000;

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 50 });

    const status = parseCsvList(req.query.status ?? "open", STATUS_VALUES);
    const severity = parseCsvList(req.query.severity, SEVERITY_VALUES);
    const ruleId = parseCsvList(req.query.ruleId);
    const loanId = req.query.loanId ? String(req.query.loanId) : null;
    const q = req.query.q ? String(req.query.q).trim() : "";

    const filter = {};
    if (status) filter.status = { $in: status };
    if (severity) filter.severity = { $in: severity };
    if (ruleId) filter.ruleId = { $in: ruleId };
    if (loanId) filter.loanId = loanId;
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      filter.$or = [{ loanId: rx }, { ruleName: rx }, { message: rx }];
    }

    const pipeline = [
      { $match: filter },
      severityRankStage(),
      { $sort: { _severityRank: -1, createdAt: -1 } },
      {
        $facet: {
          items: [
            { $skip: skip },
            { $limit: limit },
            {
              $lookup: {
                from: "loans",
                localField: "loanId",
                foreignField: "loanId",
                as: "_loan",
                pipeline: [{ $project: { _id: 0, borrowerName: 1, state: 1, verificationStatus: 1 } }],
              },
            },
            { $addFields: { loan: { $first: "$_loan" } } },
            { $project: { _loan: 0, _severityRank: 0 } },
          ],
          total: [{ $count: "n" }],
        },
      },
    ];

    const [{ items, total }] = await Exception.aggregate(pipeline);
    const totalCount = total?.[0]?.n || 0;

    const counts = await computeStatusCounts();
    res.json({
      items,
      ...paginationMeta({ total: totalCount, page, limit }),
      counts,
    });
  })
);

router.get(
  "/:exceptionId",
  asyncHandler(async (req, res) => {
    const exc = await Exception.findOne({ exceptionId: req.params.exceptionId }).lean();
    if (!exc) throw new HttpError(404, "Exception not found");

    const [loan, latestAi, decisions, aiHistoryRaw] = await Promise.all([
      Loan.findOne({ loanId: exc.loanId }).lean(),
      exc.aiRecommendationId
        ? AiRecommendation.findById(exc.aiRecommendationId).lean()
        : AiRecommendation.findOne({ exceptionId: exc.exceptionId }).sort({ createdAt: -1 }).lean(),
      ReviewDecision.find({ loanId: exc.loanId }).sort({ createdAt: 1 }).lean(),
      AiRecommendation.find({ exceptionId: exc.exceptionId })
        .sort({ createdAt: -1 })
        .select("_id templateName model confidence fallbackUsed createdAt")
        .lean(),
    ]);

    const aiRecIds = aiHistoryRaw.map((r) => String(r._id));
    const decisionByRecId = new Map(
      decisions
        .filter((d) => d.aiRecommendationId && aiRecIds.includes(String(d.aiRecommendationId)))
        .map((d) => [String(d.aiRecommendationId), d.action])
    );
    const aiHistory = aiHistoryRaw.map((r) => ({
      recommendationId: String(r._id),
      templateName: r.templateName,
      model: r.model,
      confidence: r.confidence,
      fallbackUsed: r.fallbackUsed,
      createdAt: r.createdAt,
      decisionAction: decisionByRecId.get(String(r._id)) || null,
    }));

    res.json({
      exception: exc,
      loan: loan || null,
      latestAiRecommendation: latestAi || null,
      decisions,
      aiHistory,
    });
  })
);

router.patch(
  "/:exceptionId/claim",
  requireRole("reviewer", "admin"),
  asyncHandler(async (req, res) => {
    const exc = await Exception.findOne({ exceptionId: req.params.exceptionId });
    if (!exc) throw new HttpError(404, "Exception not found");
    if (exc.status !== "open") {
      return res.json({ exception: exc.toObject(), claimed: false, alreadyStatus: exc.status });
    }
    exc.status = "in_review";
    await exc.save();
    await appendAuditEvent({
      loanId: exc.loanId,
      type: "decision",
      payload: { subType: "claim", exceptionId: exc.exceptionId, ruleId: exc.ruleId },
      actor: req.user.id,
      actorRole: req.user.role,
    });
    res.json({ exception: exc.toObject(), claimed: true });
  })
);

const commentSchema = z.object({ comment: z.string().min(1).max(2000) });

router.post(
  "/:exceptionId/comment",
  requireRole("reviewer", "admin"),
  asyncHandler(async (req, res) => {
    const parsed = commentSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Invalid body", { issues: parsed.error.issues });

    const exc = await Exception.findOne({ exceptionId: req.params.exceptionId });
    if (!exc) throw new HttpError(404, "Exception not found");

    const decision = await ReviewDecision.create({
      loanId: exc.loanId,
      exceptionId: exc.exceptionId,
      action: "add_comment",
      comment: parsed.data.comment,
      reviewer: req.user.id,
    });

    await appendAuditEvent({
      loanId: exc.loanId,
      type: "comment",
      payload: { exceptionId: exc.exceptionId, decisionId: String(decision._id), comment: parsed.data.comment },
      actor: req.user.id,
      actorRole: req.user.role,
    });

    res.status(201).json({ decision });
  })
);

const MANUAL_ACTIONS = {
  manual_approve: { newStatus: "resolved", resolutionType: "approved_as_is" },
  manual_reject: { newStatus: "dismissed", resolutionType: "rejected" },
  request_correction: { newStatus: "resolved", resolutionType: "correction_requested" },
};

const resolveSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("manual_approve"), comment: z.string().max(2000).optional() }),
  z.object({ action: z.literal("manual_reject"), comment: z.string().max(2000).optional() }),
  z.object({ action: z.literal("request_correction"), comment: z.string().max(2000).optional() }),
  z.object({
    action: z.literal("accept_ai"),
    aiRecommendationId: z.string().min(1),
    comment: z.string().max(2000).optional(),
  }),
  z.object({
    action: z.literal("edit_ai"),
    aiRecommendationId: z.string().min(1),
    editedFields: z.record(z.string(), z.any()),
    comment: z.string().max(2000).optional(),
  }),
  z.object({
    action: z.literal("reject_ai"),
    aiRecommendationId: z.string().min(1),
    comment: z.string().max(2000).optional(),
  }),
]);

router.patch(
  "/:exceptionId/resolve",
  requireRole("reviewer", "admin"),
  asyncHandler(async (req, res) => {
    const parsed = resolveSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Invalid body", { issues: parsed.error.issues });
    const body = parsed.data;

    const exc = await Exception.findOne({ exceptionId: req.params.exceptionId });
    if (!exc) throw new HttpError(404, "Exception not found");

    // Idempotency guard for AI actions.
    if (["accept_ai", "edit_ai", "reject_ai"].includes(body.action)) {
      const recent = await ReviewDecision.findOne({
        exceptionId: exc.exceptionId,
        action: body.action,
        aiRecommendationId: body.aiRecommendationId,
        createdAt: { $gte: new Date(Date.now() - IDEMPOTENCY_WINDOW_MS) },
      }).sort({ createdAt: -1 });
      if (recent) {
        return res.json({ decision: recent.toObject(), exception: exc.toObject(), alreadyApplied: true });
      }
    }

    // ---- Manual actions (Prompt 10) ----
    if (body.action in MANUAL_ACTIONS) {
      if (exc.status === "resolved" || exc.status === "dismissed") {
        return res.json({ exception: exc.toObject(), alreadyResolved: true });
      }
      const map = MANUAL_ACTIONS[body.action];
      exc.status = map.newStatus;
      exc.resolutionType = map.resolutionType;
      exc.resolvedBy = req.user.id;
      exc.resolvedAt = new Date();
      await exc.save();

      const decision = await ReviewDecision.create({
        loanId: exc.loanId,
        exceptionId: exc.exceptionId,
        action: body.action,
        comment: body.comment || "",
        reviewer: req.user.id,
      });

      await appendAuditEvent({
        loanId: exc.loanId,
        type: "decision",
        payload: {
          action: body.action,
          resolutionType: map.resolutionType,
          exceptionId: exc.exceptionId,
          decisionId: String(decision._id),
        },
        actor: req.user.id,
        actorRole: req.user.role,
      });

      const verif = await maybeVerifiabilityChanged(exc.loanId);
      return res.json({ exception: exc.toObject(), decision, ...verif });
    }

    // ---- AI actions ----
    const rec = await AiRecommendation.findById(body.aiRecommendationId).lean();
    if (!rec) throw new HttpError(404, "AI recommendation not found");
    if (rec.exceptionId && rec.exceptionId !== exc.exceptionId) {
      throw new HttpError(400, "AI recommendation does not match this exception");
    }

    // ---- reject_ai ----
    if (body.action === "reject_ai") {
      exc.aiRecommendationId = body.aiRecommendationId;
      // Status stays in_review (or open if it was still open) — reviewer is rejecting the
      // AI, not resolving the exception. Bump open -> in_review so the queue tracks it.
      if (exc.status === "open") exc.status = "in_review";
      await exc.save();

      const decision = await ReviewDecision.create({
        loanId: exc.loanId,
        exceptionId: exc.exceptionId,
        action: "reject_ai",
        aiRecommendationId: body.aiRecommendationId,
        comment: body.comment || "",
        reviewer: req.user.id,
        notes: { aiSuggested: rec.output?.suggestedFields || {} },
      });

      await appendAuditEvent({
        loanId: exc.loanId,
        type: "decision",
        payload: {
          subType: "reject_ai",
          exceptionId: exc.exceptionId,
          aiRecommendationId: String(rec._id),
          decisionId: String(decision._id),
        },
        actor: req.user.id,
        actorRole: req.user.role,
      });

      const verif = await maybeVerifiabilityChanged(exc.loanId);
      return res.json({ exception: exc.toObject(), decision, ...verif });
    }

    // ---- accept_ai / edit_ai ----
    if (exc.status === "resolved" || exc.status === "dismissed") {
      return res.json({ exception: exc.toObject(), alreadyResolved: true });
    }

    const aiSuggested = rec.output?.suggestedFields || {};
    const rawCandidate = body.action === "accept_ai" ? aiSuggested : body.editedFields;

    // Whitelist filter.
    const applying = {};
    const dropped = [];
    for (const [k, v] of Object.entries(rawCandidate || {})) {
      if (LOAN_EDITABLE_FIELDS.has(k)) applying[k] = v;
      else dropped.push(k);
    }

    const loan = await Loan.findOne({ loanId: exc.loanId });
    if (!loan) throw new HttpError(404, "Loan for exception not found");

    // Diff old vs new; only touch fields that actually change.
    const before = {};
    const after = {};
    for (const [k, newVal] of Object.entries(applying)) {
      const oldVal = loan[k];
      if (!valuesEqual(oldVal, newVal)) {
        before[k] = normalizeForLog(oldVal);
        after[k] = normalizeForLog(newVal);
        loan[k] = newVal;
      }
    }

    if (Object.keys(after).length) {
      await loan.save();
    }

    // beforeValues for edit_ai includes the AI's original suggestion for audit clarity.
    const decisionNotes = {};
    if (dropped.length) decisionNotes.droppedFields = dropped;

    const decisionBefore = body.action === "edit_ai" ? { ...before, aiSuggested } : before;

    const decision = await ReviewDecision.create({
      loanId: exc.loanId,
      exceptionId: exc.exceptionId,
      action: body.action,
      aiRecommendationId: body.aiRecommendationId,
      beforeValues: decisionBefore,
      afterValues: after,
      comment: body.comment || "",
      reviewer: req.user.id,
      notes: Object.keys(decisionNotes).length ? decisionNotes : undefined,
    });

    // Per-field field_edit audit events.
    for (const [k, newVal] of Object.entries(after)) {
      await appendAuditEvent({
        loanId: exc.loanId,
        type: "field_edit",
        payload: { field: k, before: before[k] ?? null, after: newVal, viaAction: body.action },
        actor: req.user.id,
        actorRole: req.user.role,
      });
    }

    exc.status = "resolved";
    exc.resolutionType = "approved_as_is";
    exc.aiRecommendationId = body.aiRecommendationId;
    exc.resolvedBy = req.user.id;
    exc.resolvedAt = new Date();
    await exc.save();

    await appendAuditEvent({
      loanId: exc.loanId,
      type: "decision",
      payload: {
        action: body.action,
        resolutionType: "approved_as_is",
        exceptionId: exc.exceptionId,
        aiRecommendationId: String(rec._id),
        decisionId: String(decision._id),
        droppedFields: dropped,
      },
      actor: req.user.id,
      actorRole: req.user.role,
    });

    const verif = await maybeVerifiabilityChanged(exc.loanId);
    return res.json({ exception: exc.toObject(), decision, applied: after, dropped, ...verif });
  })
);

// ------------------- helpers -------------------

function valuesEqual(a, b) {
  if (a === b) return true;
  if (a === null || a === undefined) return b === null || b === undefined;
  if (a instanceof Date || b instanceof Date) {
    const da = a instanceof Date ? a : new Date(a);
    const db = b instanceof Date ? b : new Date(b);
    return da.getTime() === db.getTime();
  }
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return String(a) === String(b);
}

function normalizeForLog(v) {
  if (v instanceof Date) return v.toISOString();
  return v ?? null;
}

async function maybeVerifiabilityChanged(loanId) {
  const eligibility = await computeVerifiabilityStatus(loanId);
  if (!eligibility.eligible) return { verifiabilityChanged: false, eligibility };
  const loan = await Loan.findOne({ loanId }).select("verificationStatus").lean();
  if (!loan || loan.verificationStatus === "verified") {
    return { verifiabilityChanged: false, eligibility };
  }
  return { verifiabilityChanged: true, eligibility };
}

// ------------------- helpers -------------------

async function computeStatusCounts() {
  const rows = await Exception.aggregate([
    {
      $group: {
        _id: { status: "$status", severity: "$severity" },
        n: { $sum: 1 },
      },
    },
  ]);
  const counts = { open: 0, in_review: 0, resolved: 0, dismissed: 0, bySeverity: { blocking: 0, high: 0, medium: 0, low: 0 } };
  for (const r of rows) {
    if (counts[r._id.status] !== undefined) counts[r._id.status] += r.n;
    if (counts.bySeverity[r._id.severity] !== undefined) counts.bySeverity[r._id.severity] += r.n;
  }
  return counts;
}

export default router;
