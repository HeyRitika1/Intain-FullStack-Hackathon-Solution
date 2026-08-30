import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { parse as csvParseSync } from "csv-parse/sync";
import { connectDb } from "../src/config/db.js";
import { Exception } from "../src/models/index.js";
import { runValidationForLoans } from "../src/services/ruleEngine/index.js";
import { logger } from "../src/utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXPECTED_PATH = path.resolve(__dirname, "../../samples/expected_exceptions.csv");

async function main() {
  await connectDb();
  try {
    const summary = await runValidationForLoans();
    logger.info(
      `[validate:all] created=${summary.exceptionsCreated} updated=${summary.exceptionsUpdated} dismissed=${summary.exceptionsAutoDismissed} orphans=${summary.orphanExceptionCount}`
    );

    // Actual counts per rule from DB (open + resolved + dismissed) so we compare correctly
    // even after auto-dismissals.
    const actualAgg = await Exception.aggregate([
      { $group: { _id: "$ruleId", count: { $sum: 1 } } },
    ]);
    const actualByRule = new Map(actualAgg.map((r) => [r._id, r.count]));

    // Bucket by severity — quick health view.
    const bySev = await Exception.aggregate([
      { $group: { _id: { severity: "$severity", status: "$status" }, count: { $sum: 1 } } },
      { $sort: { "_id.severity": 1, "_id.status": 1 } },
    ]);
    logger.info("[validate:all] exceptions by severity + status:");
    for (const b of bySev) {
      logger.info(`  ${b._id.severity.padEnd(9)} ${b._id.status.padEnd(10)} ${b.count}`);
    }

    // Ground-truth comparison. Expected file has repeated entries — dedupe by (loan_id, rule_id).
    if (fs.existsSync(EXPECTED_PATH)) {
      const expectedRows = csvParseSync(fs.readFileSync(EXPECTED_PATH, "utf8"), {
        columns: true,
        trim: true,
        skip_empty_lines: true,
      });
      const expectedByRule = new Map();
      const uniquePairs = new Set();
      for (const r of expectedRows) {
        const key = `${r.loan_id}||${r.rule_id}`;
        if (uniquePairs.has(key)) continue;
        uniquePairs.add(key);
        expectedByRule.set(r.rule_id, (expectedByRule.get(r.rule_id) || 0) + 1);
      }
      const misses = [];
      logger.info("[validate:all] per-rule check (produced >= expected unique):");
      for (const [rule, expCount] of [...expectedByRule.entries()].sort()) {
        const actual = actualByRule.get(rule) || 0;
        const ok = actual >= expCount;
        logger.info(`  ${ok ? "OK " : "MISS"} ${rule.padEnd(30)} expected>=${expCount}  actual=${actual}`);
        if (!ok) misses.push({ rule, expected: expCount, actual });
      }
      if (misses.length) {
        logger.warn(`[validate:all] ${misses.length} rule(s) under-produced`);
      } else {
        logger.info("[validate:all] all expected rule counts satisfied");
      }
    } else {
      logger.warn(`[validate:all] expected file missing: ${EXPECTED_PATH}`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  logger.error("[validate:all] failed:", err?.stack || err?.message || err);
  process.exit(1);
});
