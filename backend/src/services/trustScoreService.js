// Pure trust-score computation. computePure is DB-free (used by the unit-test
// script). computeForLoan hydrates from Mongo and calls computePure.
// computeAggregate runs a portfolio-level Mongo aggregation.

import {
  AiRecommendation,
  Exception,
  Loan,
  ReviewDecision,
  VerifiedLoanRecord,
} from "../models/index.js";
import { loadServicerRow } from "./reconciliationService.js";

const REQUIRED_FIELDS = [
  "loanId",
  "borrowerId",
  "borrowerName",
  "state",
  "originationDate",
  "maturityDate",
  "originalPrincipal",
  "currentBalance",
  "interestRate",
  "paymentStatus",
  "daysPastDue",
  "lastUpdatedAt",
  "documentStatus",
];

const SEVERITY_PENALTY = { blocking: 8, high: 4, medium: 2, low: 1 };
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// -------------------- pure computation --------------------

export function computePure({
  loan,
  exceptions = [],
  reviewDecisions = [],
  aiRecommendations = [],
  servicerUpdate = null,
  now = new Date(),
}) {
  const notes = [];

  const completeness = computeCompleteness(loan, notes);
  const consistency = computeConsistency(exceptions, notes);
  const freshness = computeFreshness(loan, servicerUpdate, now, notes);
  const reviewCoverage = computeReviewCoverage(exceptions, aiRecommendations, reviewDecisions, notes);

  const breakdown = { completeness, consistency, freshness, reviewCoverage };
  const trustScore = Math.round((completeness + consistency + freshness + reviewCoverage) / 4);
  return { trustScore, breakdown, notes };
}

function computeCompleteness(loan, notes) {
  let present = 0;
  const missing = [];
  for (const f of REQUIRED_FIELDS) {
    const v = loan?.[f];
    if (v !== null && v !== undefined && v !== "") present += 1;
    else missing.push(f);
  }
  let score = Math.round((present / REQUIRED_FIELDS.length) * 100);
  if (missing.length) notes.push(`Missing required fields: ${missing.join(", ")}`);
  if (loan?.documentStatus !== "complete") {
    score = Math.max(0, score - 20);
    notes.push(`Document status is '${loan?.documentStatus || "unknown"}' — 20 point completeness penalty`);
  }
  return score;
}

function computeConsistency(exceptions, notes) {
  let score = 100;
  const perRule = {};
  for (const e of exceptions) {
    if (e.status !== "resolved") continue; // dismissed / open / in_review contribute nothing
    const softenedReconciliation =
      e.ruleId === "CROSS_SOURCE_CONFLICT" && e.resolutionNote === "reconciled via side-by-side view";
    const penalty = softenedReconciliation ? 1 : (SEVERITY_PENALTY[e.severity] ?? 1);
    score -= penalty;
    perRule[e.ruleId] = (perRule[e.ruleId] || 0) + penalty;
  }
  score = Math.max(0, score);
  for (const [ruleId, p] of Object.entries(perRule)) {
    notes.push(`Consistency penalty ${p} for resolved ${ruleId}`);
  }
  return score;
}

function computeFreshness(loan, servicerUpdate, now, notes) {
  const loanTs = toMs(loan?.lastUpdatedAt);
  const servTs = toMs(servicerUpdate?.lastUpdatedAt);
  const newest = Math.max(loanTs || 0, servTs || 0);
  if (!newest) {
    notes.push("Freshness: no lastUpdatedAt on loan or servicer — defaulting to 0");
    return 0;
  }
  const days = Math.floor((now.getTime() - newest) / MS_PER_DAY);
  const score = Math.max(0, 100 - Math.max(0, Math.floor(days / 30)) * 5);
  if (score < 100) notes.push(`Freshest source is ${days} days old — freshness ${score}`);
  return score;
}

function computeReviewCoverage(exceptions, aiRecs, reviewDecisions, notes) {
  const total = exceptions.length;
  if (total === 0) return 100;
  const terminal = exceptions.filter((e) => e.status === "resolved" || e.status === "dismissed").length;
  let score = Math.round((terminal / total) * 100);
  if (score < 100) notes.push(`${total - terminal} exception(s) still open/in_review — coverage ${score}`);

  // Guard: any AI rec that was "applied" but never acknowledged via accept/edit/reject.
  const ackedIds = new Set(
    reviewDecisions
      .filter((d) => ["accept_ai", "edit_ai", "reject_ai"].includes(d.action) && d.aiRecommendationId)
      .map((d) => String(d.aiRecommendationId))
  );
  const unacknowledged = aiRecs
    .filter((r) => r.exceptionId && !ackedIds.has(String(r._id)));
  if (unacknowledged.length > 0) {
    // In our design this never fires (whitelist patch service always writes a decision);
    // guard remains for integrity's sake.
    const applied = unacknowledged.some((r) => r.output?.suggestedFields && Object.keys(r.output.suggestedFields).length);
    if (applied) {
      score = Math.max(0, score - 20);
      notes.push("AI recommendation applied without accept_ai/edit_ai — 20 point integrity penalty");
    }
  }
  return score;
}

function toMs(v) {
  if (!v) return 0;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
}

// -------------------- DB-hydrated wrappers --------------------

export async function computeForLoan(loanId) {
  const [loan, exceptions, reviewDecisions, aiRecommendations, servicerUpdate] = await Promise.all([
    Loan.findOne({ loanId }).lean(),
    Exception.find({ loanId }).lean(),
    ReviewDecision.find({ loanId }).lean(),
    AiRecommendation.find({ loanId }).lean(),
    loadServicerRow(loanId),
  ]);
  if (!loan) throw new Error(`Loan not found: ${loanId}`);
  return computePure({ loan, exceptions, reviewDecisions, aiRecommendations, servicerUpdate });
}

// -------------------- portfolio aggregate --------------------

const DEFAULT_BANDS = [
  { label: "90-100", lo: 90, hi: 100 },
  { label: "80-89", lo: 80, hi: 89 },
  { label: "70-79", lo: 70, hi: 79 },
  { label: "60-69", lo: 60, hi: 69 },
  { label: "<60", lo: -Infinity, hi: 59 },
];

export async function computeAggregate({ filter = {} } = {}) {
  const match = {};
  if (filter.state) match["snapshot.state"] = String(filter.state).toUpperCase();
  if (filter.verifiedAfter) match.verifiedAt = { $gte: new Date(filter.verifiedAfter) };
  if (filter.minTrustScore !== undefined) match.trustScore = { $gte: Number(filter.minTrustScore) };

  const rows = await VerifiedLoanRecord.aggregate([
    { $match: match },
    { $sort: { loanId: 1, verifiedAt: -1 } },
    { $group: { _id: "$loanId", latest: { $first: "$$ROOT" } } },
    { $replaceRoot: { newRoot: "$latest" } },
  ]);

  const verifiedLoanCount = rows.length;
  if (verifiedLoanCount === 0) {
    return {
      portfolioTrustScore: 0,
      verifiedLoanCount: 0,
      breakdownAverages: { completeness: 0, consistency: 0, freshness: 0, reviewCoverage: 0 },
      distribution: { bands: DEFAULT_BANDS.map((b) => ({ label: b.label, count: 0 })) },
    };
  }

  let sumTrust = 0;
  const sums = { completeness: 0, consistency: 0, freshness: 0, reviewCoverage: 0 };
  const counts = DEFAULT_BANDS.map((b) => ({ label: b.label, count: 0 }));
  for (const r of rows) {
    sumTrust += Number(r.trustScore || 0);
    for (const k of Object.keys(sums)) sums[k] += Number(r.trustBreakdown?.[k] || 0);
    const band = DEFAULT_BANDS.find((b) => r.trustScore >= b.lo && r.trustScore <= b.hi);
    if (band) {
      const bucket = counts.find((c) => c.label === band.label);
      if (bucket) bucket.count += 1;
    }
  }

  const avg = (n) => Math.round(n / verifiedLoanCount);
  return {
    portfolioTrustScore: avg(sumTrust),
    verifiedLoanCount,
    breakdownAverages: {
      completeness: avg(sums.completeness),
      consistency: avg(sums.consistency),
      freshness: avg(sums.freshness),
      reviewCoverage: avg(sums.reviewCoverage),
    },
    distribution: { bands: counts },
  };
}
