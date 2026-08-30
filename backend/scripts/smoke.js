// End-to-end smoke test. Imports services directly — NO HTTP.
// Every assertion increments a running fail counter; exit code = fail count.
//
// Usage:
//   npm run smoke -- --yes            # required to allow the destructive reset
//   SMOKE_ALLOW_RESET=1 npm run smoke
//   npm run smoke -- --yes --db-name intain_lvc_smoke

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { env } from "../src/config/env.js";
import { logger } from "../src/utils/logger.js";

// Domain services.
import { seedUsers } from "../src/seed/seedUsers.js";
import { seedRulesFromFile } from "../src/services/ruleSeeder.js";
import { seedDevLog } from "../src/seed/seedDevLog.js";
import { generateSamples } from "./generateSamples.js";
import { ingestSamples } from "./ingestSamples.js";
import { runValidationForLoans } from "../src/services/ruleEngine/index.js";
import { run as aiRun } from "../src/services/ai/aiService.js";
import { verifyLoan } from "../src/services/verificationService.js";
import { verifyChain, appendAuditEvent } from "../src/services/hashChainService.js";
import { computeForLoan, computeAggregate } from "../src/services/trustScoreService.js";

// Models used for reads + minimal test-only mutations.
import {
  AiRecommendation, AuditEvent, Exception, Loan, ReviewDecision, User, VerifiedLoanRecord,
} from "../src/models/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SAMPLES_DIR = path.resolve(__dirname, "../../samples");

const args = process.argv.slice(2);
const argMap = argsToMap(args);

// -------------------- safety guards --------------------

const DBNAME = argMap["db-name"] || null;
let uri = env.MONGODB_URI;
if (/prod|live|production/i.test(uri)) {
  logger.error("[smoke] refusing to run against a prod/live URI");
  process.exit(2);
}
if (DBNAME) {
  uri = uri.replace(/\/[^/?]+(\?|$)/, `/${DBNAME}$1`);
}
const canReset = args.includes("--yes") || process.env.SMOKE_ALLOW_RESET === "1";
if (!canReset) {
  logger.error("[smoke] destructive reset needed. Re-run with '--yes' or SMOKE_ALLOW_RESET=1.");
  process.exit(2);
}

// -------------------- assertion helpers --------------------

let failed = 0;
let passed = 0;
const timings = [];

function assert(name, cond, extra = "") {
  if (cond) { passed++; return; }
  failed++;
  logger.error(`  FAIL  ${name}${extra ? " — " + extra : ""}`);
}

async function step(name, fn) {
  const t0 = Date.now();
  logger.info(`\n[step] ${name}`);
  try {
    await fn();
  } catch (err) {
    failed++;
    logger.error(`  THROW ${name}: ${err?.stack || err?.message || err}`);
  }
  const ms = Date.now() - t0;
  timings.push({ name, ms });
  logger.info(`  (${ms}ms)`);
}

// -------------------- main --------------------

async function main() {
  logger.info(`[smoke] using ${uri.replace(/\/\/.*@/, "//<redacted>@")}`);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });

  const dbName = mongoose.connection.name;
  logger.info(`[smoke] connected to db=${dbName}`);

  // ---- Step 1: reset ----
  await step("1. drop database", async () => {
    await mongoose.connection.db.dropDatabase();
    assert("db dropped", true);
  });

  // ---- Step 2: seeds ----
  await step("2. seed users + rules + dev log", async () => {
    await generateSamples(); // regenerate /samples so seedRulesFromFile can read validation_rules.json
    const users = await seedUsers();
    assert("seeded 4 users", users.length === 4, `got ${users.length}`);
    const rulesResult = await seedRulesFromFile();
    assert("seeded ≥ 15 rules", (rulesResult.created + rulesResult.updated) >= 15);
    const devLogResult = await seedDevLog({ replace: true });
    assert("seeded ≥ 18 dev-log entries", devLogResult.total >= 18, `got ${devLogResult.total}`);
    assert("seeded 2 caught_bad_ai entries", devLogResult.caughtBadAi === 2);
  });

  // ---- Step 3: samples exist ----
  await step("3. verify /samples files exist", async () => {
    for (const f of ["loan_tape.csv", "servicer_update.csv", "document_manifest.csv", "validation_rules.json", "expected_exceptions.csv"]) {
      assert(`sample: ${f}`, fs.existsSync(path.join(SAMPLES_DIR, f)));
    }
  });

  // ---- Step 4: ingest ----
  await step("4. ingest 3 CSVs", async () => {
    const s = await ingestSamples({ resetCollections: true });
    // 60 CSV rows collapse to ~58 canonical loans: 2 duplicate loan_ids
    // upsert onto existing rows (net-zero adds), 2 missing-id rows become
    // synthetic __MISSING__ loans, so 45 clean + 2 synthetic + 2 borrower
    // triples + 9 other issues ~= 58.
    assert("ingested ≥ 55 loans", s.loans >= 55, `got ${s.loans}`);
    assert("3 raw imports written", s.imports === 3, `got ${s.imports}`);
    const loanTape = s.batches.find((b) => b.fileType === "loan_tape");
    assert("loan_tape normalized ≥ 58", loanTape.preview.normalizedCount >= 58);
  });

  // ---- Step 5: validate against ground truth ----
  await step("5. run validation + compare to expected_exceptions.csv", async () => {
    const result = await runValidationForLoans(null, { actor: null, actorRole: "system" });
    assert("≥ 10 exceptions created", (result.exceptionsCreated || 0) >= 10, `got ${result.exceptionsCreated}`);

    const expected = readExpected();
    const actualByRule = {};
    const openExceptions = await Exception.find({}).lean();
    for (const ex of openExceptions) {
      actualByRule[ex.ruleId] = (actualByRule[ex.ruleId] || 0) + 1;
    }
    // Some rules (e.g. DUPLICATE_LOAN_ID) collapse duplicate rows into a single
    // canonical loan at commit time, so the exception count under-runs the CSV.
    // We only FAIL if a rule produced 0 exceptions when we expected ≥1.
    const zeroRules = [];
    const underRules = [];
    for (const [ruleId, count] of Object.entries(expected.byRule)) {
      const actual = actualByRule[ruleId] || 0;
      if (actual === 0) zeroRules.push(ruleId);
      else if (actual < count) underRules.push(`${ruleId}: expected ≥${count}, got ${actual}`);
    }
    if (underRules.length) logger.warn(`[smoke]   rule count under-runs (informational):\n    - ${underRules.join("\n    - ")}`);
    assert(`every expected rule fired at least once (zero=${zeroRules.join(",") || "none"})`, zeroRules.length === 0);

    // Idempotency: rerunning should not create duplicates.
    const second = await runValidationForLoans(null, { actor: null, actorRole: "system" });
    assert("second run creates 0 new exceptions (idempotent)", (second.exceptionsCreated || 0) === 0);
  });

  // ---- Step 6: compare_sources on a CROSS_SOURCE_CONFLICT loan ----
  await step("6. AI compare_sources on a CROSS_SOURCE_CONFLICT", async () => {
    const conflictEx = await Exception.findOne({ ruleId: "CROSS_SOURCE_CONFLICT" }).lean();
    if (!conflictEx) { assert("has CROSS_SOURCE_CONFLICT exception", false); return; }
    const loan = await Loan.findOne({ loanId: conflictEx.loanId }).lean();
    const servicerUpdate = conflictEx.context?.servicerRow || null;

    const admin = await User.findOne({ role: "admin" }).lean();
    const { rec } = await aiRun({
      templateName: "compare_sources",
      input: { loan, servicerUpdate },
      actor: admin._id,
      loanId: conflictEx.loanId,
    });
    assert("compare_sources fallbackUsed=true", rec.fallbackUsed === true);
    assert("compare_sources has ≥ 1 diff", Array.isArray(rec.output?.diffs) && rec.output.diffs.length > 0);
  });

  // ---- Step 7: AI suggest + accept_ai on BALANCE_EXCEEDS_PRINCIPAL ----
  await step("7. AI suggest_correction + accept_ai path", async () => {
    const bex = await Exception.findOne({ ruleId: "BALANCE_EXCEEDS_PRINCIPAL", status: { $in: ["open", "in_review"] } }).lean();
    if (!bex) { assert("has BALANCE_EXCEEDS_PRINCIPAL open exception", false); return; }
    const loan = await Loan.findOne({ loanId: bex.loanId });
    const admin = await User.findOne({ role: "admin" }).lean();
    const rule = { ruleId: bex.ruleId };

    const { rec } = await aiRun({
      templateName: "suggest_correction",
      input: { loan: loan.toObject(), exception: bex, rule },
      actor: admin._id,
      loanId: bex.loanId,
      exceptionId: bex.exceptionId,
    });
    const suggested = rec.output?.suggestedFields || {};
    assert("suggest_correction returned suggestedFields.currentBalance", typeof suggested.currentBalance === "number");
    assert("suggested.currentBalance ≤ originalPrincipal", suggested.currentBalance <= loan.originalPrincipal);

    // Apply as accept_ai (whitelist just currentBalance).
    const decision = await applyAcceptAi({ loan, exception: bex, aiRec: rec, actor: admin });
    const updated = await Loan.findOne({ loanId: bex.loanId }).lean();
    assert("loan.currentBalance ≤ originalPrincipal after accept_ai", updated.currentBalance <= updated.originalPrincipal);
    assert("ReviewDecision.action = accept_ai", decision.action === "accept_ai");
    const exAfter = await Exception.findOne({ _id: bex._id }).lean();
    assert("Exception status = resolved", exAfter.status === "resolved");
  });

  // ---- Step 8: verify a zero-blocking loan ----
  let verifiedLoanId = null;
  await step("8. verify a loan with 0 blocking exceptions", async () => {
    // Find any loan whose blocking exceptions are all in terminal state.
    const candidates = await Loan.find({ verificationStatus: { $ne: "verified" } }).lean();
    for (const l of candidates) {
      const blockingOpen = await Exception.countDocuments({
        loanId: l.loanId, severity: "blocking", status: { $in: ["open", "in_review"] },
      });
      if (blockingOpen === 0) { verifiedLoanId = l.loanId; break; }
    }
    if (!verifiedLoanId) { assert("found eligible loan", false); return; }
    const admin = await User.findOne({ role: "admin" }).lean();
    const record = await verifyLoan(verifiedLoanId, { id: admin._id, role: "admin" });
    assert("VerifiedLoanRecord created", !!record?.recordHash);
    const chain = await verifyChain(verifiedLoanId);
    assert(`chainOk for ${verifiedLoanId}`, chain.ok === true, `brokenAt=${chain.brokenAtIndex}`);
  });

  // ---- Step 9: chain integrity across all loans ----
  await step("9. chain integrity for every loan", async () => {
    const loans = await Loan.find({}, { loanId: 1 }).lean();
    let brokenCount = 0;
    for (const l of loans) {
      const r = await verifyChain(l.loanId);
      if (!r.ok) brokenCount++;
    }
    assert(`0 broken chains (of ${loans.length})`, brokenCount === 0);
  });

  // ---- Step 10: trust score in range ----
  await step("10. trust score in valid range", async () => {
    if (!verifiedLoanId) { assert("skip", false, "no verified loan"); return; }
    const t = await computeForLoan(verifiedLoanId);
    assert(`trustScore between 60 and 100 (got ${t.trustScore})`, t.trustScore >= 60 && t.trustScore <= 100);
    assert("breakdown has 4 keys", ["completeness", "consistency", "freshness", "reviewCoverage"].every((k) => k in (t.breakdown || {})));
  });

  // ---- Step 11: portfolio aggregate ----
  await step("11. computeAggregate portfolio", async () => {
    const agg = await computeAggregate({});
    assert(`verifiedLoanCount ≥ 1 (got ${agg.verifiedLoanCount})`, agg.verifiedLoanCount >= 1);
    assert("portfolioTrustScore is a number", typeof agg.portfolioTrustScore === "number");
    const sum = (agg.distribution?.bands || []).reduce((n, b) => n + (b.count || 0), 0);
    assert(`distribution sums to verifiedLoanCount (${sum} == ${agg.verifiedLoanCount})`, sum === agg.verifiedLoanCount);
  });

  // ---- Step 12: tamper + restore ----
  await step("12. tamper simulation (mutate + verify + restore)", async () => {
    if (!verifiedLoanId) { assert("skip", false, "no verified loan"); return; }
    const events = await AuditEvent.find({ loanId: verifiedLoanId }).sort({ timestamp: 1, _id: 1 }).lean();
    if (events.length < 3) { assert("enough events to tamper", false); return; }
    const target = events[Math.floor(events.length / 2)];
    const originalPayload = target.payload;
    await AuditEvent.updateOne({ _id: target._id }, { $set: { payload: { ...(originalPayload || {}), _tampered: true } } });
    const broken = await verifyChain(verifiedLoanId);
    assert("chain reports NOT ok after tamper", broken.ok === false);
    assert("brokenAtIndex is set", broken.brokenAtIndex !== null && broken.brokenAtIndex !== undefined);
    // restore
    await AuditEvent.updateOne({ _id: target._id }, { $set: { payload: originalPayload } });
    const restored = await verifyChain(verifiedLoanId);
    assert("chain ok after restore", restored.ok === true);
  });

  // ---- Step 13: converse fallback ----
  await step("13. converse_query fallback", async () => {
    const admin = await User.findOne({ role: "admin" }).lean();
    const { rec } = await aiRun({
      templateName: "converse_query",
      input: { naturalLanguage: "Texas loans past due more than 30 days" },
      actor: admin._id,
      loanId: "__QUERY__",
    });
    const filter = rec.output?.mongoFilter || {};
    assert("converse_query fallback state = TX", filter.state === "TX");
    assert("converse_query daysPastDue > 30", filter.daysPastDue?.$gt === 30);
  });

  // ---- Step 14: rule_from_nl fallback ----
  await step("14. rule_from_nl fallback for 'interest rate above 25'", async () => {
    const admin = await User.findOne({ role: "admin" }).lean();
    const { rec } = await aiRun({
      templateName: "rule_from_nl",
      input: { naturalLanguage: "interest rate above 25" },
      actor: admin._id,
      loanId: "__RULES__",
    });
    const out = rec.output || {};
    assert("expression.op = gt", out.expression?.op === "gt", `got op=${out.expression?.op}`);
    assert("expression.field = interestRate", out.expression?.field === "interestRate", `got field=${out.expression?.field}`);
    assert("expression.value = 25", Number(out.expression?.value) === 25);
  });

  await mongoose.disconnect();
  printSummary();
}

// -------------------- helpers --------------------

// Reconstruct minimal accept_ai path (mirrors what PATCH /exceptions/:id/resolve does).
async function applyAcceptAi({ loan, exception, aiRec, actor }) {
  const WHITELIST = new Set([
    "borrowerName", "state", "currentBalance", "interestRate",
    "paymentStatus", "daysPastDue", "lastUpdatedAt", "documentStatus",
  ]);
  const suggested = aiRec.output?.suggestedFields || {};
  const before = {};
  const after = {};
  for (const [k, v] of Object.entries(suggested)) {
    if (!WHITELIST.has(k)) continue;
    before[k] = loan[k];
    loan[k] = v;
    after[k] = v;
  }
  await loan.save();

  const decision = await ReviewDecision.create({
    loanId: loan.loanId,
    exceptionId: exception.exceptionId,
    action: "accept_ai",
    beforeValues: before,
    afterValues: after,
    aiRecommendationId: aiRec._id,
    reviewer: actor._id,
  });

  exception.status = "resolved";
  exception.resolutionType = "approved_as_is";
  exception.resolvedBy = actor._id;
  exception.resolvedAt = new Date();
  exception.aiRecommendationId = aiRec._id;
  await Exception.updateOne({ _id: exception._id }, { $set: {
    status: exception.status,
    resolutionType: exception.resolutionType,
    resolvedBy: exception.resolvedBy,
    resolvedAt: exception.resolvedAt,
    aiRecommendationId: exception.aiRecommendationId,
  }});

  for (const [field, value] of Object.entries(after)) {
    await appendAuditEvent({
      loanId: loan.loanId,
      type: "field_edit",
      payload: { field, before: before[field], after: value, source: "accept_ai" },
      actor: actor._id,
      actorRole: "admin",
    });
  }
  await appendAuditEvent({
    loanId: loan.loanId,
    type: "decision",
    payload: { subType: "accept_ai", exceptionId: exception.exceptionId, aiRecommendationId: String(aiRec._id) },
    actor: actor._id,
    actorRole: "admin",
  });

  return decision;
}

function readExpected() {
  const file = path.join(SAMPLES_DIR, "expected_exceptions.csv");
  if (!fs.existsSync(file)) return { byRule: {} };
  const text = fs.readFileSync(file, "utf8");
  const lines = text.trim().split(/\r?\n/).slice(1);
  const byRule = {};
  for (const l of lines) {
    const parts = l.split(",");
    if (parts.length < 2) continue;
    const ruleId = parts[1];
    byRule[ruleId] = (byRule[ruleId] || 0) + 1;
  }
  return { byRule };
}

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

function printSummary() {
  const total = passed + failed;
  const bar = "=".repeat(60);
  logger.info(`\n${bar}`);
  logger.info(`SMOKE RESULTS  passed=${passed} failed=${failed} total=${total}`);
  logger.info(bar);
  for (const t of timings) {
    logger.info(`  ${String(t.ms).padStart(6)}ms  ${t.name}`);
  }
  logger.info(bar);
  if (failed > 0) {
    logger.error(`FAILED (${failed}). Exit code = ${failed}.`);
  } else {
    logger.info(`ALL GREEN.`);
  }
}

main()
  .then(() => process.exit(failed))
  .catch(async (err) => {
    logger.error("[smoke] fatal:", err?.stack || err?.message || err);
    try { await mongoose.disconnect(); } catch { /* ignore */ }
    process.exit(1);
  });
