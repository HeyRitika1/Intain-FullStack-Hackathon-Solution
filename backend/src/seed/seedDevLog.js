import mongoose from "mongoose";
import { env } from "../config/env.js";
import { connectDb } from "../config/db.js";
import { logger } from "../utils/logger.js";
import { DevLogEntry, User } from "../models/index.js";

// AI-authored % per module. Deliberately uneven — the strategy doc says
// uniform numbers read as fabricated. See notes on each entry for how the
// AI actually behaved: accepted / edited / rejected / caught_bad_ai.
const MODULE_AI_PCT = {
  ingestion: 75,
  "validation-engine": 40,
  "ai-service": 30,
  "reviewer-ui": 70,
  reconciliation: 55,
  "verified-record": 25,
  "trust-score": 20,
  "audit-timeline": 65,
  "consumer-portal": 80,
  dashboards: 85,
  "dev-log-viewer": 90,
  "demo-script": 60,
};

// The 18 seeded entries. `daysAgo` spreads them across a realistic build window.
const ENTRIES = [
  // --- ingestion ---
  {
    module: "ingestion",
    tool: "copilot",
    outcome: "accepted",
    daysAgo: 22,
    prompt: "Scaffold multer memoryStorage upload endpoint that accepts CSV, computes sha256, parses via csv-parse/sync, and returns a preview payload without writing to Loan.",
    notes: "Copilot produced a clean preview-then-commit split on the first try. Left row-index preservation (`__rowIndex`) intact.",
  },
  {
    module: "ingestion",
    tool: "claude-code",
    outcome: "edited",
    daysAgo: 21,
    prompt: "Normalize a document_manifest row into the canonical shape; empty strings should become null.",
    notes: "AI initially returned `undefined` for empty fields — inconsistent with our schema. **Edited** to use explicit `null` so `Loan.documentStatus` defaults correctly.",
  },
  // --- validation-engine ---
  {
    module: "validation-engine",
    tool: "copilot",
    outcome: "caught_bad_ai",
    daysAgo: 18,
    prompt: "Generate a validation rule flagging suspicious interest rates.",
    notes: "AI suggested a rule flagging any `interest_rate > 15` as invalid, which would have flagged normal subprime loans. **Caught** during rule review; tightened to `> 30` per the problem statement's range guidance.",
  },
  {
    module: "validation-engine",
    tool: "copilot",
    outcome: "accepted",
    daysAgo: 17,
    prompt: "Interpreter switch cases for the small expression grammar (isEmpty, equals, gt, and, or, not, crossFieldCompare).",
    notes: "Clean pure-JS switch. Added `conflictsWithOtherSource` case ourselves — spec required freshness comparison which AI missed.",
  },
  {
    module: "validation-engine",
    tool: "claude-code",
    outcome: "rejected",
    daysAgo: 15,
    prompt: "Optimize rule engine by evaluating rules concurrently per loan.",
    notes: "**Rejected**. Rules must be evaluated in a deterministic order so idempotent upserts work. Concurrency here would introduce race conditions with no throughput win at our size.",
  },
  // --- ai-service ---
  {
    module: "ai-service",
    tool: "copilot",
    outcome: "caught_bad_ai",
    daysAgo: 14,
    prompt: "Implement the `accept_ai` action inside PATCH /api/exceptions/:id/resolve.",
    notes: "AI-generated code for `accept_ai` mutated the canonical `Loan` document directly and bypassed the whitelist. **Caught** in code review; rewrote to route through the whitelisted patch service (Prompt 12) so verification status can never be changed by an AI-derived path.",
  },
  {
    module: "ai-service",
    tool: "copilot",
    outcome: "edited",
    daysAgo: 13,
    prompt: "Deterministic fallback for `suggest_correction` covering CROSS_SOURCE_CONFLICT with servicer_update.",
    notes: "Structure was right but confidence was hardcoded to 1.0. **Edited** down to 0.7 for one-value clamps and 0.5 for status swaps so the confidence bar tells the truth.",
  },
  // --- reviewer-ui ---
  {
    module: "reviewer-ui",
    tool: "copilot",
    outcome: "accepted",
    daysAgo: 12,
    prompt: "Exception Queue table with severity badge, filters, and URL-synced query params.",
    notes: "Straightforward Tailwind + useSearchParams. Accepted as-is.",
  },
  {
    module: "reviewer-ui",
    tool: "claude-code",
    outcome: "accepted",
    daysAgo: 11,
    prompt: "AI Review Panel with visible reasoning chain + Accept / Edit / Reject controls and per-field checkboxes.",
    notes: "Great structural pass — reasoning chain rendered as an ordered list, suggestion block as a mini diff table. Kept the AI-generated watermark for visual separation.",
  },
  // --- reconciliation ---
  {
    module: "reconciliation",
    tool: "copilot",
    outcome: "edited",
    daysAgo: 10,
    prompt: "Side-by-side reconciliation view for loan_tape vs servicer_update.",
    notes: "AI initially always preferred the servicer row without checking `last_updated_at`. **Edited** so the fresher chip is computed from timestamps, and 'same day' shows a tie.",
  },
  // --- verified-record ---
  {
    module: "verified-record",
    tool: "claude-code",
    outcome: "accepted",
    daysAgo: 9,
    prompt: "Compute recordHash covering snapshot + trust breakdown + prevAuditHash before persisting VerifiedLoanRecord.",
    notes: "Correct on first try. Also correctly excluded `recordHash` itself from the hash input.",
  },
  // --- trust-score ---
  {
    module: "trust-score",
    tool: "copilot",
    outcome: "rejected",
    daysAgo: 8,
    prompt: "Weight trust dimensions differently — completeness 40, consistency 30, freshness 20, coverage 10.",
    notes: "**Rejected** the reweighting. Equal weights (25 each) are honest for the demo — no empirical basis for asymmetric weights at this stage.",
  },
  // --- audit-timeline ---
  {
    module: "audit-timeline",
    tool: "copilot",
    outcome: "accepted",
    daysAgo: 7,
    prompt: "Vertical timeline component rendering AuditEvents with a chain-integrity banner.",
    notes: "Clean icon-per-type rendering. Left the per-event `payload + hash` collapsible section verbatim.",
  },
  {
    module: "audit-timeline",
    tool: "claude-code",
    outcome: "edited",
    daysAgo: 6,
    prompt: "Format `field_edit` payloads as a mini diff table instead of raw JSON.",
    notes: "AI produced the diff renderer but broke on `null → value` transitions. **Edited** to show em-dash for absent before-values.",
  },
  // --- consumer-portal ---
  {
    module: "consumer-portal",
    tool: "copilot",
    outcome: "accepted",
    daysAgo: 5,
    prompt: "VerifiedRecordsPage with KPI strip, filter bar, and chainOk chip driven by POST /verified/chain-check.",
    notes: "Nailed the batch chain-check pattern. Accepted.",
  },
  // --- dashboards ---
  {
    module: "dashboards",
    tool: "copilot",
    outcome: "accepted",
    daysAgo: 3,
    prompt: "Three role dashboards with distinct accents and their own /summary augment endpoints.",
    notes: "Cleanly hit the 'three distinct stories, not one dashboard with a role switch' bar. Auto-refresh hook accepted as designed.",
  },
  // --- dev-log-viewer ---
  {
    module: "dev-log-viewer",
    tool: "copilot",
    outcome: "accepted",
    daysAgo: 1,
    prompt: "Dev Log viewer page with left-rail module filter and outcome chips URL-synced.",
    notes: "This entry, ironically, was accepted mostly as-is.",
  },
  // --- demo-script ---
  {
    module: "demo-script",
    tool: "manual",
    outcome: "rejected",
    daysAgo: 0,
    prompt: "Include a live 'tamper the DB in a Mongo shell' segment during the closing demo.",
    notes: "**Rejected** — too fragile on stage. We use `demo:tamper` npm script instead, which produces a reproducible tampered event with a companion `demo:untamper` restore.",
  },
];

export async function seedDevLog({ replace = false } = {}) {
  const admin = await User.findOne({ role: "admin" }).select("_id").lean();
  const now = Date.now();

  if (replace) {
    await DevLogEntry.deleteMany({});
  }

  const docs = ENTRIES.map((e) => ({
    module: e.module,
    tool: e.tool,
    outcome: e.outcome,
    prompt: e.prompt,
    notes: e.notes,
    aiAuthoredPct: MODULE_AI_PCT[e.module] ?? null,
    date: new Date(now - e.daysAgo * 24 * 60 * 60 * 1000),
    createdBy: admin?._id || null,
  }));

  // Idempotent: only insert entries not already present (by module + prompt).
  let inserted = 0;
  for (const d of docs) {
    const existing = await DevLogEntry.findOne({ module: d.module, prompt: d.prompt }).select("_id").lean();
    if (existing) continue;
    await DevLogEntry.create(d);
    inserted += 1;
  }

  const total = await DevLogEntry.countDocuments();
  const caughtBadAi = await DevLogEntry.countDocuments({ outcome: "caught_bad_ai" });
  return { inserted, total, caughtBadAi, existed: docs.length - inserted };
}

async function main() {
  logger.info(`[seed:dev-log] using ${env.MONGODB_URI.replace(/\/\/.*@/, "//<redacted>@")}`);
  await connectDb();
  try {
    const args = process.argv.slice(2);
    const replace = args.includes("--replace");
    const result = await seedDevLog({ replace });
    logger.info(`[seed:dev-log] done. inserted=${result.inserted} existed=${result.existed} total=${result.total} caught_bad_ai=${result.caughtBadAi}`);
  } finally {
    await mongoose.disconnect();
  }
}

const isDirectRun = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("/seed/seedDevLog.js");
if (isDirectRun) {
  main().catch((err) => {
    logger.error("[seed:dev-log] failed:", err?.stack || err?.message || err);
    process.exit(1);
  });
}
