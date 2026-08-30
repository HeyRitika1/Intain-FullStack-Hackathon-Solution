import express from "express";
import { z } from "zod";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  AiRecommendation,
  Exception,
  Loan,
  RawImport,
  ValidationRule,
} from "../models/index.js";
import { run as runAi } from "../services/ai/aiService.js";
import { dryRunRule } from "../services/ruleEngine/index.js";
import { paginationMeta, parsePagination } from "../services/queryHelpers.js";

const router = express.Router();
router.use(requireAuth);

// ------------------- helpers -------------------

async function loadExceptionBundle(exceptionId) {
  const exception = await Exception.findOne({ exceptionId }).lean();
  if (!exception) throw new HttpError(404, "Exception not found");
  const [loan, rule] = await Promise.all([
    Loan.findOne({ loanId: exception.loanId }).lean(),
    ValidationRule.findOne({ ruleId: exception.ruleId }).lean(),
  ]);
  if (!loan) throw new HttpError(404, "Loan for exception not found");
  return { exception, loan, rule };
}

async function loadServicerRow(loanId) {
  const latest = await RawImport.findOne({ fileType: "servicer_update" })
    .sort({ createdAt: -1 })
    .select("notes")
    .lean();
  return latest?.notes?.parsedRowsByLoanId?.[loanId] || null;
}

async function attachRecToException(exceptionId, recId) {
  await Exception.updateOne(
    { exceptionId },
    { $set: { aiRecommendationId: recId } }
  );
}

// ------------------- endpoints -------------------

router.post(
  "/explain/:exceptionId",
  requireRole("reviewer", "admin"),
  asyncHandler(async (req, res) => {
    const { exception, loan, rule } = await loadExceptionBundle(req.params.exceptionId);
    const { rec, cached } = await runAi({
      templateName: "explain_failure",
      input: { loan, exception, rule },
      actor: req.user.id,
      loanId: loan.loanId,
      exceptionId: exception.exceptionId,
    });
    if (!cached) await attachRecToException(exception.exceptionId, rec._id);
    res.json({ recommendation: rec, cached });
  })
);

router.post(
  "/suggest/:exceptionId",
  requireRole("reviewer", "admin"),
  asyncHandler(async (req, res) => {
    const { exception, loan, rule } = await loadExceptionBundle(req.params.exceptionId);
    const servicerUpdate = await loadServicerRow(loan.loanId);
    const { rec, cached } = await runAi({
      templateName: "suggest_correction",
      input: { loan, exception, rule, servicerUpdate },
      actor: req.user.id,
      loanId: loan.loanId,
      exceptionId: exception.exceptionId,
    });
    if (!cached) await attachRecToException(exception.exceptionId, rec._id);
    res.json({ recommendation: rec, cached });
  })
);

router.post(
  "/compare/:loanId",
  requireRole("reviewer", "admin"),
  asyncHandler(async (req, res) => {
    const loan = await Loan.findOne({ loanId: req.params.loanId }).lean();
    if (!loan) throw new HttpError(404, "Loan not found");
    const servicerUpdate = await loadServicerRow(loan.loanId);
    if (!servicerUpdate) throw new HttpError(400, "No servicer_update for this loan");

    const { rec, cached } = await runAi({
      templateName: "compare_sources",
      input: { loan, servicerUpdate },
      actor: req.user.id,
      loanId: loan.loanId,
    });
    res.json({ recommendation: rec, cached });
  })
);

const noteSchema = z.object({
  loanId: z.string().min(1),
  exceptionIds: z.array(z.string()).default([]),
  decisionAction: z.string().default("reviewed"),
});
router.post(
  "/note",
  requireRole("reviewer", "admin"),
  asyncHandler(async (req, res) => {
    const parsed = noteSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Invalid body", { issues: parsed.error.issues });
    const { loanId, exceptionIds, decisionAction } = parsed.data;
    const loan = await Loan.findOne({ loanId }).lean();
    if (!loan) throw new HttpError(404, "Loan not found");
    const exceptions = exceptionIds.length
      ? await Exception.find({ exceptionId: { $in: exceptionIds } }).lean()
      : [];
    const { rec, cached } = await runAi({
      templateName: "generate_reviewer_note",
      input: { loan, exceptions, decisionAction },
      actor: req.user.id,
      loanId,
    });
    res.json({ recommendation: rec, cached });
  })
);

router.post(
  "/classify/:exceptionId",
  requireRole("reviewer", "admin"),
  asyncHandler(async (req, res) => {
    const { exception, rule } = await loadExceptionBundle(req.params.exceptionId);
    const { rec, cached } = await runAi({
      templateName: "classify_severity",
      input: { exception, rule },
      actor: req.user.id,
      loanId: exception.loanId,
      exceptionId: exception.exceptionId,
    });
    res.json({ recommendation: rec, cached });
  })
);

router.post(
  "/summarize/batch/:batchId",
  requireRole("reviewer", "admin"),
  asyncHandler(async (req, res) => {
    const batchId = req.params.batchId;
    const raw = await RawImport.findOne({ batchId }).lean();
    if (!raw) throw new HttpError(404, "Batch not found");
    const affectedLoanIds = [
      ...(raw.notes?.committedLoanIds || []),
      ...(raw.notes?.linkedLoanIds || []),
    ];
    const rows = affectedLoanIds.length
      ? await Exception.aggregate([
          { $match: { loanId: { $in: affectedLoanIds } } },
          {
            $facet: {
              byRule: [{ $group: { _id: "$ruleId", n: { $sum: 1 } } }],
              bySeverity: [{ $group: { _id: "$severity", n: { $sum: 1 } } }],
              total: [{ $count: "n" }],
            },
          },
        ])
      : [{ byRule: [], bySeverity: [], total: [{ n: 0 }] }];
    const { byRule, bySeverity, total } = rows[0];
    const counts = {
      total: total?.[0]?.n || 0,
      byRule: Object.fromEntries(byRule.map((r) => [r._id, r.n])),
      bySeverity: Object.fromEntries(bySeverity.map((r) => [r._id, r.n])),
    };

    const { rec, cached } = await runAi({
      templateName: "summarize_batch",
      input: { batchId, counts },
      actor: req.user.id,
      loanId: `__BATCH__${batchId}`,
    });
    res.json({ recommendation: rec, cached });
  })
);

const ruleSchema = z.object({ naturalLanguage: z.string().min(3).max(500) });
/** @precondition adminOnly — AI-drafted rules NEVER auto-insert; admin must POST /api/rules to persist. */
router.post(
  "/rule",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    if (req.user.role !== "admin") throw new HttpError(403, "adminOnly");
    const parsed = ruleSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Invalid body", { issues: parsed.error.issues });
    const { rec, cached } = await runAi({
      templateName: "rule_from_nl",
      input: { naturalLanguage: parsed.data.naturalLanguage },
      actor: req.user.id,
      loanId: "__RULES__",
    });

    // Compute dry-run "would match N loans" so the admin can sanity-check before saving.
    // If the rec has no valid expression (fallback couldn't parse), skip.
    const expression = rec?.output?.expression;
    const appliesTo = rec?.output?.appliesTo || "loan";
    let dryRun = null;
    if (expression && typeof expression === "object" && !rec.output?.error) {
      try {
        dryRun = await dryRunRule(expression, { appliesTo });
      } catch (err) {
        dryRun = { loansMatched: 0, sampleLoanIds: [], error: err.message };
      }
      // Persist the dryRun onto the rec so /admin/rules can render it later.
      await AiRecommendation.updateOne(
        { _id: rec._id },
        { $set: { "output.dryRun": dryRun } }
      );
      rec.output = { ...rec.output, dryRun };
    }

    res.json({ recommendation: rec, cached });
  })
);

const converseSchema = z.object({ naturalLanguage: z.string().min(3).max(500) });
router.post(
  "/converse",
  requireRole("reviewer", "admin", "consumer"),
  asyncHandler(async (req, res) => {
    const parsed = converseSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Invalid body", { issues: parsed.error.issues });
    const { rec } = await runAi({
      templateName: "converse_query",
      input: { naturalLanguage: parsed.data.naturalLanguage },
      actor: req.user.id,
      loanId: "__QUERY__",
    });
    // Prompt 22 will execute the filter against VerifiedLoanRecord and return real results.
    res.json({ recommendation: rec, resultsPreview: [] });
  })
);

router.get(
  "/recommendations",
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 25 });
    const filter = {};
    if (req.query.loanId) filter.loanId = String(req.query.loanId);
    if (req.query.exceptionId) filter.exceptionId = String(req.query.exceptionId);
    if (req.query.templateName) filter.templateName = String(req.query.templateName);

    const [items, total] = await Promise.all([
      AiRecommendation.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      AiRecommendation.countDocuments(filter),
    ]);
    res.json({ items, ...paginationMeta({ total, page, limit }) });
  })
);

router.get(
  "/recommendations/:id",
  asyncHandler(async (req, res) => {
    const rec = await AiRecommendation.findById(req.params.id).lean();
    if (!rec) throw new HttpError(404, "Recommendation not found");
    res.json({ recommendation: rec });
  })
);

export default router;
