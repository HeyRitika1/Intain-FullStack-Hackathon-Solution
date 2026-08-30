// Console-based unit tests for trustScoreService.computePure. Uses console.assert
// + fail counter; exit code = fail count. No DB, no test framework.

import { computePure } from "../src/services/trustScoreService.js";

let fails = 0;
const now = new Date("2026-08-30T00:00:00Z");

function assertEq(actual, expected, msg) {
  const ok = actual === expected;
  if (!ok) {
    fails++;
    console.error(`FAIL: ${msg} — expected ${expected}, got ${actual}`);
  } else {
    console.log(`OK   : ${msg} = ${actual}`);
  }
}

// -------------- fixtures --------------

const CLEAN_LOAN = {
  loanId: "TST-CLEAN",
  borrowerId: "BR-1",
  borrowerName: "Alice",
  state: "TX",
  originationDate: "2024-01-01",
  maturityDate: "2054-01-01",
  originalPrincipal: 100000,
  currentBalance: 90000,
  interestRate: 5,
  paymentStatus: "current",
  daysPastDue: 0,
  lastUpdatedAt: "2026-08-25", // 5 days before now
  documentStatus: "complete",
};

// -------------- tests --------------

// 1) Perfect loan: all fields, docs complete, no exceptions, fresh -> 100/100 all round.
{
  const r = computePure({ loan: CLEAN_LOAN, exceptions: [], reviewDecisions: [], aiRecommendations: [], now });
  assertEq(r.trustScore, 100, "clean loan trustScore");
  assertEq(r.breakdown.completeness, 100, "clean.completeness");
  assertEq(r.breakdown.consistency, 100, "clean.consistency");
  assertEq(r.breakdown.freshness, 100, "clean.freshness");
  assertEq(r.breakdown.reviewCoverage, 100, "clean.reviewCoverage");
}

// 2) One resolved blocking exception + docs complete: consistency = 92, total = 98.
{
  const r = computePure({
    loan: CLEAN_LOAN,
    exceptions: [
      { ruleId: "SOMETHING_BAD", severity: "blocking", status: "resolved" },
    ],
    reviewDecisions: [],
    aiRecommendations: [],
    now,
  });
  assertEq(r.breakdown.completeness, 100, "1blocking.completeness");
  assertEq(r.breakdown.consistency, 92, "1blocking.consistency (=100-8)");
  assertEq(r.breakdown.freshness, 100, "1blocking.freshness");
  assertEq(r.breakdown.reviewCoverage, 100, "1blocking.reviewCoverage");
  assertEq(r.trustScore, 98, "1blocking.trustScore (round((100+92+100+100)/4))");
}

// 3) documentStatus = missing -> completeness <= 80 (13/13 = 100, then -20 = 80).
{
  const loan = { ...CLEAN_LOAN, documentStatus: "missing" };
  const r = computePure({ loan, exceptions: [], reviewDecisions: [], aiRecommendations: [], now });
  assertEq(r.breakdown.completeness, 80, "docsMissing.completeness");
}

// 4) CROSS_SOURCE_CONFLICT resolved via reconciliation view: -1 instead of severity penalty.
{
  const r = computePure({
    loan: CLEAN_LOAN,
    exceptions: [
      {
        ruleId: "CROSS_SOURCE_CONFLICT",
        severity: "high",
        status: "resolved",
        resolutionNote: "reconciled via side-by-side view",
      },
    ],
    reviewDecisions: [],
    aiRecommendations: [],
    now,
  });
  assertEq(r.breakdown.consistency, 99, "reconciled.consistency (=100-1, softened)");
}

// 5) Freshness at 90-day age: score = 100 - floor(90/30)*5 = 85.
{
  const loan = { ...CLEAN_LOAN, lastUpdatedAt: "2026-06-01" }; // 90 days
  const r = computePure({ loan, exceptions: [], reviewDecisions: [], aiRecommendations: [], now });
  assertEq(r.breakdown.freshness, 85, "freshness at 90 days");
}

// 6) Open exception drops review coverage.
{
  const r = computePure({
    loan: CLEAN_LOAN,
    exceptions: [
      { ruleId: "A", severity: "low", status: "resolved" },
      { ruleId: "B", severity: "low", status: "open" },
    ],
    reviewDecisions: [],
    aiRecommendations: [],
    now,
  });
  assertEq(r.breakdown.reviewCoverage, 50, "reviewCoverage 1/2");
}

// -------------- summary --------------
console.log(`\n[trust:test] fails=${fails}`);
process.exit(fails);
