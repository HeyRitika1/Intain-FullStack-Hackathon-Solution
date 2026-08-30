// Fully re-seed the demo DB, then apply a curated set of reviewer actions
// so the app opens with meaningful data on-screen from second one.
//
// Usage:
//   npm run reset            (root, passes --yes)
//   node scripts/reset.js --yes
//   node scripts/reset.js --db-name intain_lvc_demo

import mongoose from "mongoose";
import { env } from "../src/config/env.js";
import { logger } from "../src/utils/logger.js";

import { seedUsers } from "../src/seed/seedUsers.js";
import { seedRulesFromFile } from "../src/services/ruleSeeder.js";
import { seedDevLog } from "../src/seed/seedDevLog.js";
import { generateSamples } from "./generateSamples.js";
import { ingestSamples } from "./ingestSamples.js";
import { runValidationForLoans } from "../src/services/ruleEngine/index.js";
import { run as aiRun } from "../src/services/ai/aiService.js";
import { verifyLoan, computeVerifiabilityStatus } from "../src/services/verificationService.js";
import { appendAuditEvent } from "../src/services/hashChainService.js";
import { computeAggregate } from "../src/services/trustScoreService.js";
import {
  AiRecommendation, DevLogEntry, Exception, Loan, ReviewDecision, User, VerifiedLoanRecord,
} from "../src/models/index.js";

const args = process.argv.slice(2);
const argMap = argsToMap(args);

// Safety guards.
if (/prod|live|production/i.test(env.MONGODB_URI)) {
  logger.error("[reset] refusing to run against a prod/live URI");
  process.exit(2);
}
let uri = env.MONGODB_URI;
if (argMap["db-name"]) uri = uri.replace(/\/[^/?]+(\?|$)/, `/${argMap["db-name"]}$1`);
const canReset = args.includes("--yes") || process.env.RESET_ALLOW === "1";
if (!canReset) {
  logger.error("[reset] destructive. Re-run with '--yes' or RESET_ALLOW=1.");
  process.exit(2);
}

const WHITELIST = new Set([
  "borrowerName", "state", "currentBalance", "interestRate",
  "paymentStatus", "daysPastDue", "lastUpdatedAt", "documentStatus",
]);

async function main() {
  const t0 = Date.now();
  logger.info(`[reset] using ${uri.replace(/\/\/.*@/, "//<redacted>@")}`);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });

  // 3-second countdown unless --yes.
  if (!args.includes("--yes")) {
    for (let n = 3; n > 0; n--) {
      logger.warn(`[reset] dropping ${mongoose.connection.name} in ${n}...`);
      await sleep(1000);
    }
  }
  await mongoose.connection.db.dropDatabase();
  logger.info(`[reset] db=${mongoose.connection.name} dropped`);

  logger.info("[reset] gen:samples");
  await generateSamples();

  logger.info("[reset] seed:users");
  await seedUsers();

  logger.info("[reset] seed:rules");
  const rulesResult = await seedRulesFromFile();
  logger.info(`[reset]   rules created=${rulesResult.created} updated=${rulesResult.updated}`);

  logger.info("[reset] ingest:samples");
  const ingest = await ingestSamples({ resetCollections: false });
  logger.info(`[reset]   loans=${ingest.loans} imports=${ingest.imports} auditEvents=${ingest.auditEvents}`);

  logger.info("[reset] validate:all");
  const val = await runValidationForLoans(null, { actor: null, actorRole: "system" });
  logger.info(`[reset]   exceptions created=${val.exceptionsCreated} updated=${val.exceptionsUpdated} dismissed=${val.exceptionsAutoDismissed}`);

  logger.info("[reset] seed:dev-log");
  const devlog = await seedDevLog({ replace: true });
  logger.info(`[reset]   dev-log inserted=${devlog.inserted} total=${devlog.total}`);

  // Curated reviewer actions.
  logger.info("[reset] curated reviewer actions");
  const reviewer = await User.findOne({ role: "reviewer" }).lean();
  const admin = await User.findOne({ role: "admin" }).lean();

  const curated = { acceptAi: null, editAi: null, rejectManual: null };

  // Loan A: accept_ai on a BALANCE_EXCEEDS_PRINCIPAL exception.
  const bex = await Exception.findOne({ ruleId: "BALANCE_EXCEEDS_PRINCIPAL", status: { $in: ["open", "in_review"] } }).lean();
  if (bex) {
    curated.acceptAi = await curatedAcceptAi(bex, reviewer);
    logger.info(`[reset]   accept_ai on ${bex.loanId}`);
  }

  // Loan B: edit_ai on a CROSS_SOURCE_CONFLICT (accept servicer value, tweak by +$50).
  const cex = await Exception.findOne({ ruleId: "CROSS_SOURCE_CONFLICT", status: { $in: ["open", "in_review"] } }).lean();
  if (cex) {
    curated.editAi = await curatedEditAi(cex, reviewer);
    logger.info(`[reset]   edit_ai on ${cex.loanId}`);
  }

  // Loan C: reject_ai then manual_approve on a different exception.
  const otherEx = await Exception.findOne({
    ruleId: { $in: ["INTEREST_RATE_OUT_OF_RANGE", "STATUS_DPD_MISMATCH", "NEGATIVE_BALANCE", "CLOSED_BUT_POSITIVE_BALANCE"] },
    status: { $in: ["open", "in_review"] },
  }).lean();
  if (otherEx) {
    curated.rejectManual = await curatedRejectThenApprove(otherEx, reviewer);
    logger.info(`[reset]   reject_ai + manual_approve on ${otherEx.loanId}`);
  }

  // Try to verify the curated loans that are now blocking-free.
  for (const info of [curated.acceptAi, curated.editAi, curated.rejectManual].filter(Boolean)) {
    const status = await computeVerifiabilityStatus(info.loanId);
    if (status.eligible) {
      try {
        await verifyLoan(info.loanId, { id: reviewer._id, role: "reviewer" });
        logger.info(`[reset]     verified ${info.loanId}`);
      } catch (err) {
        logger.warn(`[reset]     verifyLoan ${info.loanId} failed: ${err.message}`);
      }
    }
  }

  // Live-looking dev-log entries dated "today".
  await appendTodayDevLogs({ reviewerEmail: reviewer.email, curated });

  // Banner.
  const [loanCount, verifiedCount, excCount, aiCount, agg] = await Promise.all([
    Loan.countDocuments(),
    VerifiedLoanRecord.aggregate([
      { $group: { _id: "$loanId" } },
      { $count: "n" },
    ]).then((r) => r[0]?.n || 0),
    Exception.countDocuments(),
    AiRecommendation.countDocuments(),
    computeAggregate({}),
  ]);
  const trust = agg.portfolioTrustScore ?? "—";
  const totalMs = Date.now() - t0;

  const banner = [
    "",
    "============================================================",
    ` READY FOR DEMO - ${loanCount} loans, ${verifiedCount} verified, ${excCount} exceptions, ${aiCount} AI recs, trust ${trust}`,
    ` finished in ${(totalMs / 1000).toFixed(1)}s`,
    "============================================================",
    "",
    " Login as any of the seeded users on http://localhost:5173:",
    "   operator@intain.test  Operator@123",
    "   reviewer@intain.test  Reviewer@123",
    "   consumer@intain.test  Consumer@123",
    "   admin@intain.test     Admin@1234",
    "",
  ].join("\n");
  console.log(banner);

  await mongoose.disconnect();
}

// -------- curated action helpers --------

async function curatedAcceptAi(bex, reviewer) {
  const loan = await Loan.findOne({ loanId: bex.loanId });
  const rule = { ruleId: bex.ruleId };
  const { rec } = await aiRun({
    templateName: "suggest_correction",
    input: { loan: loan.toObject(), exception: bex, rule },
    actor: reviewer._id,
    loanId: bex.loanId,
    exceptionId: bex.exceptionId,
  });
  await applySuggestedFields({ loan, exception: bex, aiRec: rec, actor: reviewer, action: "accept_ai" });
  return { loanId: bex.loanId, aiRec: rec };
}

async function curatedEditAi(cex, reviewer) {
  const loan = await Loan.findOne({ loanId: cex.loanId });
  const servicerRow = cex.context?.servicerRow || {};
  const rule = { ruleId: cex.ruleId };
  const { rec } = await aiRun({
    templateName: "suggest_correction",
    input: { loan: loan.toObject(), exception: cex, rule, servicerUpdate: servicerRow },
    actor: reviewer._id,
    loanId: cex.loanId,
    exceptionId: cex.exceptionId,
  });
  const suggested = rec.output?.suggestedFields || {};
  // Simulate an edit — bump currentBalance by $50 relative to servicer value.
  const edited = {};
  for (const k of Object.keys(suggested)) {
    edited[k] = k === "currentBalance" && Number.isFinite(Number(suggested[k]))
      ? Math.round(Number(suggested[k]) + 50)
      : suggested[k];
  }
  await applySuggestedFields({ loan, exception: cex, aiRec: rec, actor: reviewer, action: "edit_ai", overrideFields: edited });
  return { loanId: cex.loanId, aiRec: rec };
}

async function curatedRejectThenApprove(ex, reviewer) {
  const loan = await Loan.findOne({ loanId: ex.loanId });
  const rule = { ruleId: ex.ruleId };
  const { rec } = await aiRun({
    templateName: "suggest_correction",
    input: { loan: loan.toObject(), exception: ex, rule },
    actor: reviewer._id,
    loanId: ex.loanId,
    exceptionId: ex.exceptionId,
  });
  // reject_ai — no field mutation, exception stays in_review.
  await ReviewDecision.create({
    loanId: ex.loanId,
    exceptionId: ex.exceptionId,
    action: "reject_ai",
    aiRecommendationId: rec._id,
    reviewer: reviewer._id,
    comment: "AI suggestion doesn't match reviewer's read of the source.",
  });
  await Exception.updateOne(
    { _id: ex._id },
    { $set: { status: "in_review", aiRecommendationId: rec._id } }
  );
  await appendAuditEvent({
    loanId: ex.loanId, type: "decision",
    payload: { subType: "reject_ai", exceptionId: ex.exceptionId, aiRecommendationId: String(rec._id) },
    actor: reviewer._id, actorRole: "reviewer",
  });

  // Then manual_approve — mark resolved with resolutionType approved_as_is.
  await ReviewDecision.create({
    loanId: ex.loanId,
    exceptionId: ex.exceptionId,
    action: "manual_approve",
    reviewer: reviewer._id,
    comment: "Reviewer confirmed values per manual entry from custodian statement.",
  });
  await Exception.updateOne(
    { _id: ex._id },
    { $set: {
      status: "resolved",
      resolutionType: "approved_as_is",
      resolvedBy: reviewer._id,
      resolvedAt: new Date(),
    } }
  );
  await appendAuditEvent({
    loanId: ex.loanId, type: "decision",
    payload: { subType: "manual_approve", exceptionId: ex.exceptionId },
    actor: reviewer._id, actorRole: "reviewer",
  });
  return { loanId: ex.loanId, aiRec: rec };
}

async function applySuggestedFields({ loan, exception, aiRec, actor, action, overrideFields = null }) {
  const suggested = aiRec.output?.suggestedFields || {};
  const applied = overrideFields || suggested;
  const before = {};
  const after = {};
  for (const [k, v] of Object.entries(applied)) {
    if (!WHITELIST.has(k)) continue;
    before[k] = loan[k];
    loan[k] = v;
    after[k] = v;
  }
  await loan.save();

  await ReviewDecision.create({
    loanId: loan.loanId,
    exceptionId: exception.exceptionId,
    action,
    beforeValues: action === "edit_ai" ? { ...before, aiSuggested: suggested } : before,
    afterValues: after,
    aiRecommendationId: aiRec._id,
    reviewer: actor._id,
  });
  await Exception.updateOne(
    { _id: exception._id },
    { $set: {
      status: "resolved",
      resolutionType: "approved_as_is",
      resolvedBy: actor._id,
      resolvedAt: new Date(),
      aiRecommendationId: aiRec._id,
    } }
  );
  for (const [field, value] of Object.entries(after)) {
    await appendAuditEvent({
      loanId: loan.loanId, type: "field_edit",
      payload: { field, before: before[field], after: value, source: action },
      actor: actor._id, actorRole: "reviewer",
    });
  }
  await appendAuditEvent({
    loanId: loan.loanId, type: "decision",
    payload: { subType: action, exceptionId: exception.exceptionId, aiRecommendationId: String(aiRec._id) },
    actor: actor._id, actorRole: "reviewer",
  });
}

async function appendTodayDevLogs({ reviewerEmail, curated }) {
  const now = new Date();
  const entries = [];
  if (curated.acceptAi) entries.push({
    module: "reviewer-ui",
    tool: "manual",
    outcome: "accepted",
    prompt: "Reviewer accepted the AI's suggested currentBalance for a BALANCE_EXCEEDS_PRINCIPAL exception.",
    notes: `Loan ${curated.acceptAi.loanId} verified without edits by ${reviewerEmail}.`,
    aiAuthoredPct: 30,
    date: now,
  });
  if (curated.editAi) entries.push({
    module: "reconciliation",
    tool: "manual",
    outcome: "edited",
    prompt: "Reviewer edited the AI's servicer-value suggestion by +$50 before applying.",
    notes: `Loan ${curated.editAi.loanId} — proves the edit_ai path is honored end-to-end.`,
    aiAuthoredPct: 45,
    date: now,
  });
  if (curated.rejectManual) entries.push({
    module: "reviewer-ui",
    tool: "manual",
    outcome: "rejected",
    prompt: "Reviewer rejected the AI suggestion and then manually approved the exception.",
    notes: `Loan ${curated.rejectManual.loanId} — demonstrates divergence between AI and human paths, all logged.`,
    aiAuthoredPct: 20,
    date: now,
  });
  entries.push({
    module: "demo-script",
    tool: "manual",
    outcome: "accepted",
    prompt: "Ran `npm run reset` to seed the demo dataset.",
    notes: "Adds today-dated entries so /dev-log looks live at demo time.",
    aiAuthoredPct: 60,
    date: now,
  });
  if (entries.length) await DevLogEntry.insertMany(entries);
}

// -------- utils --------

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function argsToMap(a) {
  const m = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith("--")) {
      const key = a[i].slice(2);
      const next = a[i + 1];
      if (next && !next.startsWith("--")) { m[key] = next; i++; }
      else m[key] = true;
    }
  }
  return m;
}

main().catch(async (err) => {
  logger.error("[reset] failed:", err?.stack || err?.message || err);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
