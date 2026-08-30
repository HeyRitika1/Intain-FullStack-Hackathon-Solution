import {
  AiRecommendation,
  Exception,
  Loan,
  ReviewDecision,
  VerifiedLoanRecord,
} from "../models/index.js";
import { canonicalStringify, sha256 } from "../utils/hash.js";
import { HttpError } from "../middleware/error.js";
import { appendAuditEvent, latestAuditHash, verifyChain as verifyChainImpl } from "./hashChainService.js";
import { loadServicerRow } from "./reconciliationService.js";
import { computePure } from "./trustScoreService.js";
import { logger } from "../utils/logger.js";

const PLACEHOLDER_BREAKDOWN = {
  completeness: 100,
  consistency: 100,
  freshness: 100,
  reviewCoverage: 100,
};

export async function computeVerifiabilityStatus(loanId) {
  const bySev = await Exception.aggregate([
    { $match: { loanId, status: { $in: ["open", "in_review"] } } },
    { $group: { _id: "$severity", n: { $sum: 1 } } },
  ]);
  const counts = { blocking: 0, high: 0, medium: 0, low: 0 };
  for (const r of bySev) if (counts[r._id] !== undefined) counts[r._id] = r.n;
  const eligible = counts.blocking === 0;
  const reasons = [];
  if (!eligible) reasons.push(`${counts.blocking} blocking exception(s) still open`);
  if (counts.high) reasons.push(`${counts.high} high open (non-blocking)`);
  if (counts.medium) reasons.push(`${counts.medium} medium open (non-blocking)`);
  if (counts.low) reasons.push(`${counts.low} low open (non-blocking)`);
  return {
    eligible,
    blockingOpen: counts.blocking,
    highOpen: counts.high,
    mediumOpen: counts.medium,
    lowOpen: counts.low,
    reasons,
  };
}

function computeTrust({ loan, exceptions, reviewDecisions, aiRecommendations, servicerUpdate }) {
  return computePure({
    loan,
    exceptions,
    reviewDecisions,
    aiRecommendations,
    servicerUpdate,
    now: new Date(),
  });
}

/**
 * verifyLoan(loanId, actor)
 * actor = { id, role } | null (for system/batch auto-verify).
 */
export async function verifyLoan(loanId, actor) {
  const eligibility = await computeVerifiabilityStatus(loanId);
  if (!eligibility.eligible) {
    throw new HttpError(409, "Loan not eligible for verification", { reasons: eligibility.reasons });
  }

  const loan = await Loan.findOne({ loanId });
  if (!loan) throw new HttpError(404, "Loan not found");

  const [allExceptions, decisions, aiRecs, servicerUpdate] = await Promise.all([
    Exception.find({ loanId }).lean(),
    ReviewDecision.find({ loanId }).lean(),
    AiRecommendation.find({ loanId }).lean(),
    loadServicerRow(loanId),
  ]);

  const snapshot = pickSnapshot(loan.toObject());

  const trust = computeTrust({
    loan: loan.toObject(),
    exceptions: allExceptions,
    reviewDecisions: decisions,
    aiRecommendations: aiRecs,
    servicerUpdate,
  });
  const trustScore = typeof trust.trustScore === "number"
    ? trust.trustScore
    : Math.round(
        (Object.values(trust.breakdown || PLACEHOLDER_BREAKDOWN).reduce((a, b) => a + b, 0)) /
          Math.max(Object.keys(trust.breakdown || PLACEHOLDER_BREAKDOWN).length, 1)
      );

  const prevAuditHash = await latestAuditHash(loanId);
  const verifiedAt = new Date();

  const validationSummary = {
    rulesRun: 0,
    passed: 0,
    failed: allExceptions.length,
    exceptionIds: allExceptions.map((e) => e.exceptionId),
  };

  const reviewerDecisionIds = decisions.map((d) => d._id);
  const aiRecommendationIds = aiRecs.map((r) => r._id);
  const verifiedBy = actor?.id ? actor.id : null;

  const hashInput = {
    ...snapshot,
    sourceBatchId: loan.sourceBatchId,
    servicerUpdateBatchId: loan.servicerUpdateBatchId,
    validationSummary,
    reviewerDecisionIds: reviewerDecisionIds.map(String),
    aiRecommendationIds: aiRecommendationIds.map(String),
    trustScore,
    trustBreakdown: trust.breakdown,
    verifiedBy,
    verifiedAt: verifiedAt.toISOString(),
    prevAuditHash,
  };
  const recordHash = sha256(canonicalStringify(hashInput));

  const record = await VerifiedLoanRecord.create({
    loanId,
    snapshot,
    sourceBatchId: loan.sourceBatchId,
    servicerUpdateBatchId: loan.servicerUpdateBatchId,
    validationSummary,
    reviewerDecisionIds,
    aiRecommendationIds,
    trustScore,
    trustBreakdown: trust.breakdown,
    verifiedBy,
    verifiedAt,
    recordHash,
    prevAuditHash,
  });

  loan.verificationStatus = "verified";
  await loan.save();

  await appendAuditEvent({
    loanId,
    type: "verified",
    payload: { recordHash, trustScore, trustBreakdown: trust.breakdown },
    actor: verifiedBy,
    actorRole: actor?.role || (verifiedBy ? undefined : "system"),
  });

  return record.toObject();
}

export async function unverifyLoan(loanId, actor, reason) {
  const loan = await Loan.findOne({ loanId });
  if (!loan) throw new HttpError(404, "Loan not found");
  loan.verificationStatus = "in_review";
  await loan.save();
  await appendAuditEvent({
    loanId,
    type: "decision",
    // In a real Intain product, unverification would be a first-class event type;
    // we ride on `decision` with subType to keep the schema tight for the demo.
    payload: { subType: "unverify", reason: reason || "" },
    actor: actor?.id || null,
    actorRole: actor?.role || null,
  });
}

export { verifyChainImpl as verifyChain };

/**
 * Batch-level auto-verify: after runValidationForBatch, any pending loan with
 * zero exceptions ever created is verified with actor=null, actorRole="system".
 * Prompt 15 explicitly permits this "unambiguous zero-exception pass-through".
 */
export async function autoVerifyZeroExceptionLoans(loanIds) {
  if (!loanIds?.length) return { verified: [], skipped: [] };
  const verified = [];
  const skipped = [];
  for (const loanId of loanIds) {
    const loan = await Loan.findOne({ loanId }).select("verificationStatus").lean();
    if (!loan || loan.verificationStatus !== "pending") { skipped.push(loanId); continue; }
    const exCount = await Exception.countDocuments({ loanId });
    if (exCount > 0) { skipped.push(loanId); continue; }
    try {
      await verifyLoan(loanId, null);
      verified.push(loanId);
    } catch (err) {
      logger.warn(`[auto-verify] ${loanId} skipped: ${err?.message || err}`);
      skipped.push(loanId);
    }
  }
  return { verified, skipped };
}

// ------------------- helpers -------------------

function pickSnapshot(loanObj) {
  const keys = [
    "loanId", "borrowerId", "borrowerName", "state",
    "originationDate", "maturityDate", "originalPrincipal", "currentBalance",
    "interestRate", "paymentStatus", "daysPastDue", "lastUpdatedAt",
    "documentStatus", "sourceBatchId", "sourceRowIndex", "servicerUpdateBatchId",
    "verificationStatus",
  ];
  const out = {};
  for (const k of keys) if (loanObj[k] !== undefined) out[k] = loanObj[k];
  return out;
}
