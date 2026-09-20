// Deterministic sample-data generator. No external deps beyond Node built-ins.
// Run: npm --workspace backend run gen:samples
// Writes into repo-root /samples/. Reruns produce byte-identical files.
//
// Scale knobs (all optional):
//   SAMPLES_SIZE=3000              -> total loan_tape rows (min 60, curated 1..60 preserved)
//   SERVICER_EXTRA_BATCHES=3       -> additional servicer_update_YYYYMM.csv files (rolling monthly cycles)
//   MANIFEST_EXTRA_COVERAGE=0.35   -> fraction of extra loans covered by document_manifest

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SAMPLES_DIR = path.resolve(__dirname, "../../samples");

// Anchor "today" for reproducibility. All date deltas hang off this.
const ANCHOR = new Date("2026-08-30T00:00:00Z");

const SAMPLES_SIZE = Math.max(60, Number.parseInt(process.env.SAMPLES_SIZE || "60", 10) || 60);
const SERVICER_EXTRA_BATCHES = Math.max(0, Number.parseInt(process.env.SERVICER_EXTRA_BATCHES || "0", 10) || 0);
const MANIFEST_EXTRA_COVERAGE = clamp01(Number.parseFloat(process.env.MANIFEST_EXTRA_COVERAGE || "0.35"));

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// -------------------- deterministic PRNG (mulberry32) --------------------
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260830);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const between = (lo, hi) => lo + rng() * (hi - lo);
const intBetween = (lo, hi) => Math.floor(between(lo, hi + 1));
const round2 = (n) => Math.round(n * 100) / 100;
const pad = (n, len = 4) => String(n).padStart(len, "0");

// -------------------- reference pools --------------------
const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY",
];
const FIRST = ["James","Mary","John","Patricia","Robert","Jennifer","Michael","Linda","William","Elizabeth","David","Barbara","Richard","Susan","Joseph","Jessica","Thomas","Karen","Charles","Sarah","Christopher","Nancy","Daniel","Lisa","Matthew","Betty","Anthony","Sandra","Mark","Ashley","Donald","Kimberly","Steven","Emily","Paul","Donna","Andrew","Michelle","Joshua","Carol"];
const LAST = ["Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis","Rodriguez","Martinez","Hernandez","Lopez","Gonzalez","Wilson","Anderson","Thomas","Taylor","Moore","Jackson","Martin","Lee","Perez","Thompson","White","Harris","Sanchez","Clark","Ramirez","Lewis","Robinson","Walker","Young","Allen","King","Wright","Scott","Torres","Nguyen","Hill","Flores"];

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}
function daysBefore(d, days) {
  const nd = new Date(d);
  nd.setUTCDate(nd.getUTCDate() - days);
  return nd;
}
function daysAfter(d, days) {
  const nd = new Date(d);
  nd.setUTCDate(nd.getUTCDate() + days);
  return nd;
}

// -------------------- loan tape --------------------
// 60 rows total. Row indexes are 1-based here to match "row N" language in the spec.
function buildLoanTape() {
  const rows = [];
  // 45 clean rows
  for (let i = 1; i <= 45; i++) {
    const origDaysAgo = intBetween(180, 1500);
    const origDate = daysBefore(ANCHOR, origDaysAgo);
    const termYears = pick([15, 20, 25, 30]);
    const maturityDate = daysAfter(origDate, termYears * 365);
    const originalPrincipal = round2(50000 + rng() * 500000);
    const currentBalance = round2(originalPrincipal * between(0.35, 0.98));
    const interestRate = round2(3 + rng() * 10);
    const isDelinquent = rng() < 0.15;
    const paymentStatus = isDelinquent ? "delinquent" : "current";
    const daysPastDue = isDelinquent ? intBetween(31, 90) : 0;
    const lastUpdatedDaysAgo = intBetween(5, 90);
    const lastUpdatedAt = daysBefore(ANCHOR, lastUpdatedDaysAgo);
    rows.push({
      loan_id: `LN-${pad(i)}`,
      borrower_id: `BR-${pad(i)}`,
      borrower_name: `${pick(FIRST)} ${pick(LAST)}`,
      state: pick(US_STATES),
      origination_date: fmtDate(origDate),
      maturity_date: fmtDate(maturityDate),
      original_principal: originalPrincipal,
      current_balance: currentBalance,
      interest_rate: interestRate,
      payment_status: paymentStatus,
      days_past_due: daysPastDue,
      last_updated_at: fmtDate(lastUpdatedAt),
      document_status: "unknown",
    });
  }

  // Row 46, 47: missing loan_id (empty string)
  rows.push(brokenRow(46, { loan_id: "" }));
  rows.push(brokenRow(47, { loan_id: "" }));

  // Row 48, 49: duplicate loan_id — reuse LN-0001 and LN-0002 but different other fields
  rows.push(brokenRow(48, { loan_id: "LN-0001" }));
  rows.push(brokenRow(49, { loan_id: "LN-0002" }));

  // Row 50, 51: duplicate borrower_id + original_principal + origination_date triple
  const dupOrig = fmtDate(daysBefore(ANCHOR, 900));
  rows.push(brokenRow(50, {
    borrower_id: "BR-DUPE",
    original_principal: 200000,
    origination_date: dupOrig,
  }));
  rows.push(brokenRow(51, {
    borrower_id: "BR-DUPE",
    original_principal: 200000,
    origination_date: dupOrig,
  }));

  // Row 52: maturity_date before origination_date
  const badOrig = fmtDate(daysBefore(ANCHOR, 500));
  const badMat = fmtDate(daysBefore(ANCHOR, 800));
  rows.push(brokenRow(52, { origination_date: badOrig, maturity_date: badMat }));

  // Row 53: current_balance > original_principal * 1.05
  rows.push(brokenRow(53, { original_principal: 100000, current_balance: 110000 }));

  // Row 54: current_balance negative
  rows.push(brokenRow(54, { current_balance: -5000 }));

  // Row 55: interest_rate = 45 (out of 0..30)
  rows.push(brokenRow(55, { interest_rate: 45 }));

  // Row 56: payment_status current + days_past_due 90 (mismatch)
  rows.push(brokenRow(56, { payment_status: "current", days_past_due: 90 }));

  // Row 57: paid_off + current_balance=12000 (closed but positive)
  rows.push(brokenRow(57, { payment_status: "paid_off", current_balance: 12000 }));

  // Row 58: state=ZZ (invalid US state)
  rows.push(brokenRow(58, { state: "ZZ" }));

  // Row 59: last_updated_at older than 400 days
  rows.push(brokenRow(59, { last_updated_at: fmtDate(daysBefore(ANCHOR, 420)) }));

  // Row 60: document_status=missing
  rows.push(brokenRow(60, { document_status: "missing" }));

  // ---- optional bulk-clean extras (LN-0061 .. LN-<SAMPLES_SIZE>) ----
  // All extras keep the same shape as the "45 clean rows" above so no rule
  // besides the trickle we intentionally embed below can fire on them.
  for (let i = 61; i <= SAMPLES_SIZE; i++) {
    const origDaysAgo = intBetween(120, 1600);
    const origDate = daysBefore(ANCHOR, origDaysAgo);
    const termYears = pick([10, 15, 20, 25, 30]);
    const maturityDate = daysAfter(origDate, termYears * 365);
    const originalPrincipal = round2(40000 + rng() * 750000);
    const currentBalance = round2(originalPrincipal * between(0.20, 0.98));
    const interestRate = round2(2.5 + rng() * 12);
    // ~10% delinquent, ~2% deep-delinquent (dpd > 90 with delinquent status → clean)
    const roll = rng();
    let paymentStatus = "current";
    let daysPastDue = 0;
    if (roll < 0.02) { paymentStatus = "delinquent"; daysPastDue = intBetween(91, 179); }
    else if (roll < 0.12) { paymentStatus = "delinquent"; daysPastDue = intBetween(31, 90); }
    // ~4% paid_off with balance=0 (clean closed state)
    if (rng() < 0.04) { paymentStatus = "paid_off"; daysPastDue = 0; }
    const balance = paymentStatus === "paid_off" ? 0 : currentBalance;
    // ~5% intentionally stale to give the low-severity rule volume across the portfolio.
    const stale = rng() < 0.05;
    const lastUpdatedDaysAgo = stale ? intBetween(400, 900) : intBetween(3, 90);
    const lastUpdatedAt = daysBefore(ANCHOR, lastUpdatedDaysAgo);
    // ~7% with an explicit document_status=missing (drives MISSING_DOCUMENTS beyond LN-0060).
    const docStatus = rng() < 0.07 ? "missing" : "unknown";
    rows.push({
      loan_id: `LN-${pad(i)}`,
      borrower_id: `BR-${pad(i)}`,
      borrower_name: `${pick(FIRST)} ${pick(LAST)}`,
      state: pick(US_STATES),
      origination_date: fmtDate(origDate),
      maturity_date: fmtDate(maturityDate),
      original_principal: originalPrincipal,
      current_balance: balance,
      interest_rate: interestRate,
      payment_status: paymentStatus,
      days_past_due: daysPastDue,
      last_updated_at: fmtDate(lastUpdatedAt),
      document_status: docStatus,
    });
  }

  return rows;
}

// Build a broken row that starts from a plausible clean baseline, then overrides.
function brokenRow(idx, overrides) {
  const origDate = daysBefore(ANCHOR, intBetween(200, 1200));
  const maturityDate = daysAfter(origDate, 25 * 365);
  const originalPrincipal = round2(80000 + rng() * 300000);
  const base = {
    loan_id: `LN-${pad(idx)}`,
    borrower_id: `BR-${pad(idx)}`,
    borrower_name: `${pick(FIRST)} ${pick(LAST)}`,
    state: pick(US_STATES),
    origination_date: fmtDate(origDate),
    maturity_date: fmtDate(maturityDate),
    original_principal: originalPrincipal,
    current_balance: round2(originalPrincipal * 0.7),
    interest_rate: round2(3 + rng() * 8),
    payment_status: "current",
    days_past_due: 0,
    last_updated_at: fmtDate(daysBefore(ANCHOR, intBetween(5, 60))),
    document_status: "unknown",
  };
  return { ...base, ...overrides };
}

// -------------------- servicer update --------------------
// 20 rows: 15 conflicts, 3 resolvers, 2 orphans.
function buildServicerUpdate(loanTape) {
  const rows = [];

  // 15 conflict rows — first 15 clean loans, fresher last_updated_at, tweak balance.
  for (let i = 1; i <= 15; i++) {
    const loan = loanTape[i - 1];
    const nudge = 1 - between(0.02, 0.10);
    rows.push({
      loan_id: loan.loan_id,
      current_balance: round2(loan.current_balance * nudge),
      payment_status: loan.payment_status,
      days_past_due: loan.days_past_due,
      last_updated_at: fmtDate(daysBefore(ANCHOR, intBetween(1, 25))),
    });
  }

  // 3 resolver rows — target the three broken rows that servicer data can plausibly fix.
  // Row 54 (negative balance) -> positive balance from servicer.
  rows.push({
    loan_id: "LN-0054",
    current_balance: 45000,
    payment_status: "current",
    days_past_due: 0,
    last_updated_at: fmtDate(daysBefore(ANCHOR, 3)),
  });
  // Row 56 (current + dpd=90 mismatch) -> servicer says delinquent, dpd=90.
  rows.push({
    loan_id: "LN-0056",
    current_balance: loanTape[55].current_balance, // row 56 index 55
    payment_status: "delinquent",
    days_past_due: 90,
    last_updated_at: fmtDate(daysBefore(ANCHOR, 4)),
  });
  // Row 57 (paid_off + balance=12000) -> servicer says balance=0.
  rows.push({
    loan_id: "LN-0057",
    current_balance: 0,
    payment_status: "paid_off",
    days_past_due: 0,
    last_updated_at: fmtDate(daysBefore(ANCHOR, 6)),
  });

  // 2 orphan rows — loan_ids not present in loan_tape.
  rows.push({
    loan_id: "LN-9001",
    current_balance: 87500,
    payment_status: "current",
    days_past_due: 0,
    last_updated_at: fmtDate(daysBefore(ANCHOR, 10)),
  });
  rows.push({
    loan_id: "LN-9002",
    current_balance: 132000,
    payment_status: "delinquent",
    days_past_due: 45,
    last_updated_at: fmtDate(daysBefore(ANCHOR, 8)),
  });

  // ---- optional bulk-clean coverage on the extras (LN-0061..) ----
  // ~35% of extras get a fresh servicer row. Roughly half of those have a
  // material balance nudge (fires CROSS_SOURCE_CONFLICT); the rest are dead
  // matches (no conflict — reviewer sees them as "reconciled").
  for (let i = 61; i <= loanTape.length; i++) {
    const loan = loanTape[i - 1];
    if (!loan || rng() > 0.35) continue;
    const materialNudge = rng() < 0.55;
    const factor = materialNudge ? 1 - between(0.03, 0.12) : 1;
    rows.push({
      loan_id: loan.loan_id,
      current_balance: round2(loan.current_balance * factor),
      payment_status: loan.payment_status,
      days_past_due: loan.days_past_due,
      last_updated_at: fmtDate(daysBefore(ANCHOR, intBetween(1, 20))),
    });
  }

  return rows;
}

// Additional "monthly cycle" servicer files. Each cycle picks a fresh subset of
// loans and bumps the balance / dpd — great for demoing repeated ingest and
// reconciliation over time without regenerating the base servicer_update.csv.
function buildExtraServicerBatch(loanTape, cycleIdx) {
  const rows = [];
  const cycleDaysBack = cycleIdx * 30 + intBetween(1, 5);
  const coverage = 0.15 + rng() * 0.10;
  for (const loan of loanTape) {
    if (loan.loan_id.startsWith("LN-90")) continue; // skip orphan echoes
    if (rng() > coverage) continue;
    const material = rng() < 0.5;
    const factor = material ? 1 - between(0.01, 0.08) : 1;
    const bumpDpd = loan.payment_status === "delinquent" && rng() < 0.3
      ? Math.min(180, (loan.days_past_due || 0) + intBetween(15, 30))
      : loan.days_past_due;
    rows.push({
      loan_id: loan.loan_id,
      current_balance: round2(loan.current_balance * factor),
      payment_status: loan.payment_status,
      days_past_due: bumpDpd,
      last_updated_at: fmtDate(daysBefore(ANCHOR, cycleDaysBack)),
    });
  }
  return rows;
}

function cycleLabel(cycleIdx) {
  // Subtract whole months from the anchor so labels are guaranteed unique
  // across cycles (30-day arithmetic collides — e.g. 30 and 60 days back
  // both land in July from a late-August anchor).
  const d = new Date(Date.UTC(ANCHOR.getUTCFullYear(), ANCHOR.getUTCMonth() - cycleIdx, 1));
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}${mm}`;
}

// -------------------- document manifest --------------------
// Cover the first 20 clean loans with 4 docs each. Five of those loans have >=1 missing doc.
// Plus 2 orphan rows.
const DOC_TYPES = ["promissory_note", "appraisal", "income_verification", "title"];
function buildDocManifest(loanTape) {
  const rows = [];
  const missingLoanIds = new Set(["LN-0003", "LN-0007", "LN-0012", "LN-0015", "LN-0019"]);
  const covered = 20;
  for (let i = 1; i <= covered; i++) {
    const loanId = loanTape[i - 1].loan_id;
    const missDoc = missingLoanIds.has(loanId) ? pick(DOC_TYPES) : null;
    for (const doc of DOC_TYPES) {
      const isMissing = doc === missDoc;
      rows.push({
        loan_id: loanId,
        doc_type: doc,
        doc_status: isMissing ? "missing" : "received",
        received_at: isMissing ? "" : fmtDate(daysBefore(ANCHOR, intBetween(30, 400))),
      });
    }
  }
  // 2 orphan manifest rows.
  rows.push({
    loan_id: "LN-9101",
    doc_type: "promissory_note",
    doc_status: "received",
    received_at: fmtDate(daysBefore(ANCHOR, 20)),
  });
  rows.push({
    loan_id: "LN-9102",
    doc_type: "appraisal",
    doc_status: "pending",
    received_at: "",
  });

  // ---- optional bulk-clean manifest for extras (LN-0061..) ----
  // ~35% coverage by default. Of those, ~15% have one missing doc, driving
  // MISSING_DOCUMENTS across the portfolio for a realistic-looking dashboard.
  for (let i = 61; i <= loanTape.length; i++) {
    const loan = loanTape[i - 1];
    if (!loan) continue;
    if (rng() > MANIFEST_EXTRA_COVERAGE) continue;
    const missDoc = rng() < 0.15 ? pick(DOC_TYPES) : null;
    for (const doc of DOC_TYPES) {
      const isMissing = doc === missDoc;
      rows.push({
        loan_id: loan.loan_id,
        doc_type: doc,
        doc_status: isMissing ? "missing" : "received",
        received_at: isMissing ? "" : fmtDate(daysBefore(ANCHOR, intBetween(20, 500))),
      });
    }
  }

  return rows;
}

// -------------------- validation rules --------------------
function buildRules() {
  return [
    { ruleId: "MISSING_LOAN_ID", name: "Missing loan ID", description: "Row has no loan_id (or synthetic __MISSING__ id assigned at ingest)",
      severity: "blocking", messageTemplate: "Loan ID is missing on row {sourceRowIndex}",
      expression: { op: "regexMatch", field: "loanId", pattern: "^__MISSING__" }, active: true },

    { ruleId: "DUPLICATE_LOAN_ID", name: "Duplicate loan ID", description: "Another Loan record shares this loanId",
      severity: "blocking", messageTemplate: "Loan ID {loanId} appears in more than one row",
      expression: { op: "duplicateLoanId" }, active: true },

    { ruleId: "DUPLICATE_BORROWER_TRIPLE", name: "Duplicate borrower/amount/date triple",
      description: "Same borrower_id + original_principal + origination_date as another loan",
      severity: "high", messageTemplate: "Borrower {borrowerId} appears twice with same principal and origination date",
      expression: { op: "duplicateBorrowerTriple" }, active: true },

    { ruleId: "MATURITY_BEFORE_ORIGINATION", name: "Maturity before origination",
      description: "maturity_date < origination_date",
      severity: "blocking", messageTemplate: "maturity_date {maturityDate} is before origination_date {originationDate}",
      expression: { op: "crossFieldCompare", left: "maturityDate", op2: "lt", right: "originationDate" }, active: true },

    { ruleId: "BALANCE_EXCEEDS_PRINCIPAL", name: "Current balance exceeds original principal",
      description: "current_balance > original_principal * 1.05",
      severity: "high", messageTemplate: "current_balance {currentBalance} > 1.05 * original_principal {originalPrincipal}",
      expression: { op: "crossFieldCompare", left: "currentBalance", op2: "gt", right: "originalPrincipal", rightMultiplier: 1.05 }, active: true },

    { ruleId: "NEGATIVE_BALANCE", name: "Negative current balance",
      description: "current_balance < 0",
      severity: "high", messageTemplate: "current_balance is negative: {currentBalance}",
      expression: { op: "lt", field: "currentBalance", value: 0 }, active: true },

    { ruleId: "INTEREST_RATE_OUT_OF_RANGE", name: "Interest rate out of range",
      description: "interest_rate must be between 0 and 30",
      severity: "medium", messageTemplate: "interest_rate {interestRate} outside 0..30",
      expression: { op: "or", args: [
        { op: "lt", field: "interestRate", value: 0 },
        { op: "gt", field: "interestRate", value: 30 },
      ] }, active: true },

    { ruleId: "STATUS_DPD_MISMATCH", name: "Payment status vs days past due mismatch",
      description: "current with dpd>30, or delinquent with dpd=0",
      severity: "high", messageTemplate: "payment_status {paymentStatus} inconsistent with days_past_due {daysPastDue}",
      expression: { op: "or", args: [
        { op: "and", args: [
          { op: "equals", field: "paymentStatus", value: "current" },
          { op: "gt", field: "daysPastDue", value: 30 },
        ] },
        { op: "and", args: [
          { op: "equals", field: "paymentStatus", value: "delinquent" },
          { op: "equals", field: "daysPastDue", value: 0 },
        ] },
      ] }, active: true },

    { ruleId: "CLOSED_BUT_POSITIVE_BALANCE", name: "Closed loan with positive balance",
      description: "payment_status in (paid_off, closed) but current_balance > 0",
      severity: "high", messageTemplate: "{paymentStatus} loan still has current_balance {currentBalance}",
      expression: { op: "and", args: [
        { op: "inSet", field: "paymentStatus", values: ["paid_off", "closed"] },
        { op: "gt", field: "currentBalance", value: 0 },
      ] }, active: true },

    { ruleId: "INVALID_STATE_CODE", name: "Invalid US state code",
      description: "state must be a valid two-letter US code",
      severity: "medium", messageTemplate: "state {state} is not a valid US state code",
      expression: { op: "notInSet", field: "state", values: US_STATES }, active: true },

    { ruleId: "STALE_LAST_UPDATED", name: "Stale last_updated_at",
      description: "last_updated_at older than 365 days",
      severity: "low", messageTemplate: "last_updated_at {lastUpdatedAt} is more than 365 days old",
      expression: { op: "olderThanDays", field: "lastUpdatedAt", days: 365 }, active: true },

    { ruleId: "MISSING_DOCUMENTS", name: "Documents incomplete",
      description: "document_status = missing OR any manifest row missing",
      severity: "medium", messageTemplate: "document_status is {documentStatus}",
      expression: { op: "or", args: [
        { op: "equals", field: "documentStatus", value: "missing" },
        { op: "manifestHasMissing" },
      ] }, active: true },

    { ruleId: "CROSS_SOURCE_CONFLICT", name: "Cross-source conflict with servicer update",
      description: "loan_tape and servicer_update disagree on a monitored field",
      severity: "high", messageTemplate: "servicer_update disagrees on {conflictField}",
      expression: { op: "conflictsWithOtherSource", source: "servicerUpdates", keyField: "loanId",
        compareFields: ["currentBalance", "paymentStatus", "daysPastDue"], onlyIfFresher: true }, active: true },

    { ruleId: "ORPHAN_SERVICER_UPDATE", name: "Orphan servicer update row",
      description: "servicer_update row references a loan_id not in loan_tape",
      severity: "medium", messageTemplate: "servicer update for {loanId} has no matching loan",
      appliesTo: "servicerUpdate",
      expression: { op: "not", args: [
        { op: "existsInOtherSource", source: "loanTapeLoans", keyField: "loanId" },
      ] }, active: true },

    { ruleId: "ORPHAN_DOCUMENT", name: "Orphan document manifest row",
      description: "document_manifest row references a loan_id not in loan_tape",
      severity: "low", messageTemplate: "document row for {loanId} has no matching loan",
      appliesTo: "manifest",
      expression: { op: "not", args: [
        { op: "existsInOtherSource", source: "loanTapeLoans", keyField: "loanId" },
      ] }, active: true },
  ];
}

// -------------------- expected exceptions --------------------
function buildExpectedExceptions() {
  const out = [];
  const add = (loanId, ruleId, severity, note) => out.push({ loan_id: loanId, rule_id: ruleId, severity, note });

  // Missing loan ids (rows 46, 47) -- loan_id blank; synthetic id assigned at ingest.
  add("", "MISSING_LOAN_ID", "blocking", "row 46: synthetic __MISSING__ id at ingest");
  add("", "MISSING_LOAN_ID", "blocking", "row 47: synthetic __MISSING__ id at ingest");

  // Duplicate loan_id (rows 48, 49 dup rows 1, 2). Both original + duplicate rows fire.
  add("LN-0001", "DUPLICATE_LOAN_ID", "blocking", "row 1 and row 48 share loan_id");
  add("LN-0001", "DUPLICATE_LOAN_ID", "blocking", "row 48 (duplicate of row 1)");
  add("LN-0002", "DUPLICATE_LOAN_ID", "blocking", "row 2 and row 49 share loan_id");
  add("LN-0002", "DUPLICATE_LOAN_ID", "blocking", "row 49 (duplicate of row 2)");

  // Duplicate borrower triple (rows 50, 51)
  add("LN-0050", "DUPLICATE_BORROWER_TRIPLE", "high", "same borrower/principal/origination as LN-0051");
  add("LN-0051", "DUPLICATE_BORROWER_TRIPLE", "high", "same borrower/principal/origination as LN-0050");

  add("LN-0052", "MATURITY_BEFORE_ORIGINATION", "blocking", "maturity < origination");
  add("LN-0053", "BALANCE_EXCEEDS_PRINCIPAL", "high", "110000 > 100000 * 1.05");
  add("LN-0054", "NEGATIVE_BALANCE", "high", "current_balance = -5000");
  add("LN-0055", "INTEREST_RATE_OUT_OF_RANGE", "medium", "interest_rate = 45");
  add("LN-0056", "STATUS_DPD_MISMATCH", "high", "current with dpd=90");
  add("LN-0057", "CLOSED_BUT_POSITIVE_BALANCE", "high", "paid_off with balance=12000");
  add("LN-0058", "INVALID_STATE_CODE", "medium", "state=ZZ");
  add("LN-0059", "STALE_LAST_UPDATED", "low", "last_updated_at 420 days ago");
  add("LN-0060", "MISSING_DOCUMENTS", "medium", "document_status=missing on loan_tape");

  // Missing documents from manifest (5 loans with a missing doc)
  for (const id of ["LN-0003", "LN-0007", "LN-0012", "LN-0015", "LN-0019"]) {
    add(id, "MISSING_DOCUMENTS", "medium", "at least one manifest row is missing");
  }

  // Cross-source conflicts (15 clean loans updated with fresher servicer values).
  for (let i = 1; i <= 15; i++) {
    add(`LN-${pad(i)}`, "CROSS_SOURCE_CONFLICT", "high", "servicer_update has fresher current_balance");
  }

  // Servicer resolvers (rows 54/56/57 also matched by servicer_update) also create conflicts,
  // but the underlying rule (NEGATIVE_BALANCE, STATUS_DPD_MISMATCH, CLOSED_BUT_POSITIVE_BALANCE)
  // is what the reviewer resolves via accept_ai. Do not double-count as CROSS_SOURCE_CONFLICT
  // in the ground truth — those 3 loans will additionally show up under CROSS_SOURCE_CONFLICT
  // when the engine runs; we allow "at least" matching in the smoke script.

  // Orphan servicer updates (2 rows: LN-9001, LN-9002)
  add("LN-9001", "ORPHAN_SERVICER_UPDATE", "medium", "servicer_update has no matching loan (synthetic __ORPHAN__servicer__LN-9001)");
  add("LN-9002", "ORPHAN_SERVICER_UPDATE", "medium", "servicer_update has no matching loan (synthetic __ORPHAN__servicer__LN-9002)");

  // Orphan documents (2 rows: LN-9101, LN-9102)
  add("LN-9101", "ORPHAN_DOCUMENT", "low", "document_manifest has no matching loan");
  add("LN-9102", "ORPHAN_DOCUMENT", "low", "document_manifest has no matching loan");

  return out;
}

// -------------------- CSV helpers --------------------
function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function toCsv(rows, headers) {
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(headers.map((h) => csvEscape(r[h])).join(","));
  }
  // LF endings; Excel opens both cleanly.
  return lines.join("\n") + "\n";
}

// -------------------- README --------------------
function buildReadme() {
  return `# /samples/

Deterministic sample dataset for the Loan Data Verification Copilot.

## Regenerate

\`\`\`powershell
npm --workspace backend run gen:samples
\`\`\`

Reruns produce byte-identical files (seeded PRNG anchored to ${fmtDate(ANCHOR)}).

## Files

| File | Purpose |
|---|---|
| \`loan_tape.csv\` | 60 rows. 45 clean + 15 intentionally broken. Fires most validation rules. |
| \`servicer_update.csv\` | 20 rows. 15 create cross-source conflicts, 3 fix loan-tape issues, 2 orphans. |
| \`document_manifest.csv\` | Doc coverage for the first 20 loans. 5 of them have a missing doc. 2 orphan rows. |
| \`validation_rules.json\` | 15 rules the engine seeds and runs (Prompt 7 interprets these). |
| \`expected_exceptions.csv\` | Ground truth for the smoke script. Counts per rule are the minimum the engine must produce. |

## Loans intentionally broken

| Loan ID | Reason | Expected rule |
|---|---|---|
| (row 46, blank) | Missing loan_id | MISSING_LOAN_ID |
| (row 47, blank) | Missing loan_id | MISSING_LOAN_ID |
| LN-0001 (row 48) | Duplicate loan_id of row 1 | DUPLICATE_LOAN_ID |
| LN-0002 (row 49) | Duplicate loan_id of row 2 | DUPLICATE_LOAN_ID |
| LN-0050, LN-0051 | Same borrower_id + principal + origination_date | DUPLICATE_BORROWER_TRIPLE |
| LN-0052 | maturity_date < origination_date | MATURITY_BEFORE_ORIGINATION |
| LN-0053 | current_balance 110000 > 100000 * 1.05 | BALANCE_EXCEEDS_PRINCIPAL |
| LN-0054 | current_balance = -5000 | NEGATIVE_BALANCE |
| LN-0055 | interest_rate = 45 | INTEREST_RATE_OUT_OF_RANGE |
| LN-0056 | payment_status=current, dpd=90 | STATUS_DPD_MISMATCH |
| LN-0057 | paid_off + balance=12000 | CLOSED_BUT_POSITIVE_BALANCE |
| LN-0058 | state=ZZ | INVALID_STATE_CODE |
| LN-0059 | last_updated_at 420 days ago | STALE_LAST_UPDATED |
| LN-0060 | document_status=missing | MISSING_DOCUMENTS |
| LN-9001, LN-9002 | servicer_update refs unknown loan | ORPHAN_SERVICER_UPDATE |
| LN-9101, LN-9102 | document_manifest refs unknown loan | ORPHAN_DOCUMENT |
| LN-0001..LN-0015 | Fresher servicer balance | CROSS_SOURCE_CONFLICT |
| LN-0003, LN-0007, LN-0012, LN-0015, LN-0019 | Missing manifest doc | MISSING_DOCUMENTS |
`;
}

// -------------------- write --------------------
function write(name, contents) {
  const p = path.join(SAMPLES_DIR, name);
  fs.writeFileSync(p, contents, "utf8");
  return { path: p, bytes: Buffer.byteLength(contents, "utf8") };
}

function main() {
  fs.mkdirSync(SAMPLES_DIR, { recursive: true });

  // Remove any leftover monthly-cycle files from a previous larger run so the
  // /samples/ folder always reflects the current config exactly.
  for (const name of fs.readdirSync(SAMPLES_DIR)) {
    if (/^servicer_update_\d{6}\.csv$/i.test(name)) {
      fs.unlinkSync(path.join(SAMPLES_DIR, name));
    }
  }

  const loanTape = buildLoanTape();
  const servicer = buildServicerUpdate(loanTape);
  const manifest = buildDocManifest(loanTape);
  const rules = buildRules();
  const expected = buildExpectedExceptions();

  const written = [];
  written.push({
    name: "loan_tape.csv",
    ...write("loan_tape.csv", toCsv(loanTape, [
      "loan_id","borrower_id","borrower_name","state","origination_date","maturity_date",
      "original_principal","current_balance","interest_rate","payment_status",
      "days_past_due","last_updated_at","document_status",
    ])),
    rowCount: loanTape.length,
  });
  written.push({
    name: "servicer_update.csv",
    ...write("servicer_update.csv", toCsv(servicer, [
      "loan_id","current_balance","payment_status","days_past_due","last_updated_at",
    ])),
    rowCount: servicer.length,
  });
  // Optional monthly cycles — labelled by YYYYMM so demo can show repeated ingest.
  for (let c = 1; c <= SERVICER_EXTRA_BATCHES; c++) {
    const extra = buildExtraServicerBatch(loanTape, c);
    const name = `servicer_update_${cycleLabel(c)}.csv`;
    written.push({
      name,
      ...write(name, toCsv(extra, [
        "loan_id","current_balance","payment_status","days_past_due","last_updated_at",
      ])),
      rowCount: extra.length,
    });
  }
  written.push({
    name: "document_manifest.csv",
    ...write("document_manifest.csv", toCsv(manifest, [
      "loan_id","doc_type","doc_status","received_at",
    ])),
    rowCount: manifest.length,
  });
  written.push({
    name: "validation_rules.json",
    ...write("validation_rules.json", JSON.stringify(rules, null, 2) + "\n"),
    rowCount: rules.length,
  });
  written.push({
    name: "expected_exceptions.csv",
    ...write("expected_exceptions.csv", toCsv(expected, ["loan_id","rule_id","severity","note"])),
    rowCount: expected.length,
  });
  written.push({
    name: "README.md",
    ...write("README.md", buildReadme()),
    rowCount: null,
  });

  console.log("[gen:samples] wrote:");
  for (const w of written) {
    const rc = w.rowCount === null ? "" : `${w.rowCount} rows, `;
    console.log(`  ${w.name.padEnd(32)} ${rc}${w.bytes} bytes`);
  }
  console.log(`[gen:samples] anchor=${fmtDate(ANCHOR)} SAMPLES_SIZE=${SAMPLES_SIZE} servicerExtra=${SERVICER_EXTRA_BATCHES}`);
  return written;
}

export { main as generateSamples };

const isDirectRun = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("/scripts/generateSamples.js");
if (isDirectRun) main();
