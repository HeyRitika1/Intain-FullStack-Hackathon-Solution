import express from "express";
import { z } from "zod";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { Loan, RawImport, ReviewDecision, User } from "../models/index.js";
import { appendAuditEvent } from "../services/ingestService.js";
import { escapeRegex, paginationMeta, parsePagination } from "../services/queryHelpers.js";
import {
  autoResolveCrossSourceIfReconciled,
  computeReconciliation,
  findOpenCrossSourceConflict,
  loadServicerRow,
} from "../services/reconciliationService.js";

const router = express.Router();
router.use(requireAuth);

const LOAN_LIST_ALLOWED_PAYMENT = ["current", "delinquent", "default", "paid_off", "closed"];
const LOAN_LIST_ALLOWED_VERIFICATION = ["pending", "in_review", "verified", "rejected"];
const EDITABLE_FIELDS = [
  "borrowerName",
  "state",
  "currentBalance",
  "interestRate",
  "paymentStatus",
  "daysPastDue",
  "lastUpdatedAt",
  "documentStatus",
];

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 25 });
    const filter = {};
    if (req.query.state) filter.state = String(req.query.state).toUpperCase();
    if (req.query.paymentStatus) {
      const v = String(req.query.paymentStatus);
      if (!LOAN_LIST_ALLOWED_PAYMENT.includes(v)) throw new HttpError(400, `Unsupported paymentStatus '${v}'`);
      filter.paymentStatus = v;
    }
    if (req.query.verificationStatus) {
      const v = String(req.query.verificationStatus);
      if (!LOAN_LIST_ALLOWED_VERIFICATION.includes(v)) throw new HttpError(400, `Unsupported verificationStatus '${v}'`);
      filter.verificationStatus = v;
    }
    if (req.query.q) {
      const rx = new RegExp(escapeRegex(String(req.query.q)), "i");
      filter.$or = [{ loanId: rx }, { borrowerName: rx }, { borrowerId: rx }];
    }
    if (req.query.hasServicerUpdate === "true") {
      filter.servicerUpdateBatchId = { $ne: null };
    } else if (req.query.hasServicerUpdate === "false") {
      filter.servicerUpdateBatchId = null;
    }

    const [items, total] = await Promise.all([
      Loan.find(filter).sort({ updatedAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
      Loan.countDocuments(filter),
    ]);
    res.json({ items, ...paginationMeta({ total, page, limit }) });
  })
);

router.get(
  "/:loanId",
  asyncHandler(async (req, res) => {
    const loan = await Loan.findOne({ loanId: req.params.loanId }).lean();
    if (!loan) throw new HttpError(404, "Loan not found");

    const [openExceptionCount, manifestRows, exceptions, reviewDecisions] = await Promise.all([
      countOpenExceptions(loan.loanId),
      getManifestForLoan(loan.loanId),
      loadLoanExceptions(loan.loanId),
      loadLoanDecisions(loan.loanId),
    ]);

    res.json({
      loan,
      openExceptionCount,
      servicerUpdatePresent: Boolean(loan.servicerUpdateBatchId),
      manifestRows,
      exceptions,
      reviewDecisions,
    });
  })
);

router.get(
  "/:loanId/reconciliation",
  requireRole("reviewer", "admin"),
  asyncHandler(async (req, res) => {
    const loan = await Loan.findOne({ loanId: req.params.loanId }).lean();
    if (!loan) throw new HttpError(404, "Loan not found");
    const servicerUpdate = await loadServicerRow(loan.loanId);
    const recon = computeReconciliation(loan, servicerUpdate);
    const conflict = await findOpenCrossSourceConflict(loan.loanId);
    res.json({
      loan,
      servicerUpdate,
      diffs: recon.diffs,
      meta: {
        loanTapeLastUpdatedAt: recon.loanTapeLastUpdatedAt,
        servicerLastUpdatedAt: recon.servicerLastUpdatedAt,
        conflictExceptionId: conflict?.exceptionId || null,
      },
    });
  })
);

const patchSchema = z
  .object({
    borrowerName: z.string().min(1).max(200).optional(),
    state: z.string().length(2).optional(),
    currentBalance: z.number().finite().optional(),
    interestRate: z.number().finite().optional(),
    paymentStatus: z.enum(LOAN_LIST_ALLOWED_PAYMENT).optional(),
    daysPastDue: z.number().int().nonnegative().optional(),
    lastUpdatedAt: z
      .union([z.string(), z.date()])
      .transform((v) => (v instanceof Date ? v : new Date(v)))
      .refine((d) => !Number.isNaN(d.getTime()), { message: "invalid date" })
      .optional(),
    documentStatus: z.enum(["complete", "missing", "partial", "unknown"]).optional(),
    // Non-whitelisted keys (comment / notes / exceptionId) pass validation but are handled
    // separately below — the field-diff loop only touches whitelisted fields.
    comment: z.string().optional(),
    notes: z.any().optional(),
    exceptionId: z.string().optional(),
  })
  .passthrough();

router.patch(
  "/:loanId",
  requireRole("reviewer", "admin"),
  asyncHandler(async (req, res) => {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "Invalid patch body", { issues: parsed.error.issues });
    }
    const parsedBody = parsed.data;
    const patch = {};
    for (const key of EDITABLE_FIELDS) {
      if (parsedBody[key] !== undefined) patch[key] = parsedBody[key];
    }
    if (!Object.keys(patch).length) throw new HttpError(400, "No editable fields provided");

    if (String(patch.state || "").length) patch.state = patch.state.toUpperCase();

    const loan = await Loan.findOne({ loanId: req.params.loanId });
    if (!loan) throw new HttpError(404, "Loan not found");

    const before = {};
    const after = {};
    for (const [k, newVal] of Object.entries(patch)) {
      const oldVal = loan[k];
      if (!valuesEqual(oldVal, newVal)) {
        before[k] = normalizeForLog(oldVal);
        after[k] = normalizeForLog(newVal);
        loan[k] = newVal;
      }
    }

    if (!Object.keys(after).length) {
      return res.json({ loan: loan.toObject(), changed: false });
    }

    await loan.save();

    await appendAuditEvent({
      loanId: loan.loanId,
      type: "field_edit",
      payload: { before, after, notes: parsedBody.notes || null },
      actor: req.user.id,
      actorRole: req.user.role,
    });

    await ReviewDecision.create({
      loanId: loan.loanId,
      exceptionId: parsedBody.exceptionId || null,
      action: "edit_field",
      beforeValues: before,
      afterValues: after,
      comment: parsedBody.comment || "",
      reviewer: req.user.id,
      notes: parsedBody.notes || undefined,
    });

    // If this edit reconciled the last substantive diff against the servicer_update,
    // auto-resolve the open CROSS_SOURCE_CONFLICT exception.
    const autoResolvedExceptionId = await autoResolveCrossSourceIfReconciled(loan, req.user.id);
    if (autoResolvedExceptionId) {
      await appendAuditEvent({
        loanId: loan.loanId,
        type: "decision",
        payload: {
          action: "auto_resolve",
          subType: "reconciled_side_by_side",
          exceptionId: autoResolvedExceptionId,
        },
        actor: req.user.id,
        actorRole: req.user.role,
      });
    }

    res.json({
      loan: loan.toObject(),
      changed: true,
      before,
      after,
      autoResolvedExceptionId,
    });
  })
);

// ------------------- helpers -------------------

async function countOpenExceptions(loanId) {
  const { Exception } = await import("../models/index.js");
  return Exception.countDocuments({ loanId, status: { $in: ["open", "in_review"] } });
}

async function loadLoanExceptions(loanId) {
  const { Exception } = await import("../models/index.js");
  return Exception.find({ loanId }).sort({ createdAt: -1 }).lean();
}

async function loadLoanDecisions(loanId) {
  const decisions = await ReviewDecision.find({ loanId }).sort({ createdAt: 1 }).lean();
  const reviewerIds = [...new Set(decisions.map((d) => String(d.reviewer)).filter(Boolean))];
  if (!reviewerIds.length) return decisions.map((d) => ({ ...d, reviewerUser: null }));
  const users = await User.find({ _id: { $in: reviewerIds } }).select("email name role").lean();
  const map = new Map(users.map((u) => [String(u._id), u]));
  return decisions.map((d) => ({ ...d, reviewerUser: map.get(String(d.reviewer)) || null }));
}

async function getManifestForLoan(loanId) {
  // Look at the most recent document_manifest batch's stored rowsByLoanId.
  const latest = await RawImport.findOne({ fileType: "document_manifest" })
    .sort({ createdAt: -1 })
    .select("notes")
    .lean();
  const rows = latest?.notes?.rowsByLoanId?.[loanId];
  return Array.isArray(rows) ? rows : [];
}

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

export default router;
