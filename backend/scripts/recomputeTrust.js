import mongoose from "mongoose";
import { connectDb } from "../src/config/db.js";
import { VerifiedLoanRecord } from "../src/models/index.js";
import { computeForLoan } from "../src/services/trustScoreService.js";
import { logger } from "../src/utils/logger.js";

async function main() {
  await connectDb();
  try {
    const latestPerLoan = await VerifiedLoanRecord.aggregate([
      { $sort: { loanId: 1, verifiedAt: -1 } },
      { $group: { _id: "$loanId", latest: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$latest" } },
    ]);
    logger.info(`[trust:recompute] verifiedLoanCount=${latestPerLoan.length}`);
    let drifted = 0;
    for (const rec of latestPerLoan) {
      try {
        const cur = await computeForLoan(rec.loanId);
        const same = rec.trustScore === cur.trustScore &&
          ["completeness","consistency","freshness","reviewCoverage"].every(
            (k) => Number(rec.trustBreakdown?.[k]) === Number(cur.breakdown?.[k])
          );
        if (!same) drifted++;
        const status = same ? "SAME" : "DRIFT";
        logger.info(`  ${status} ${rec.loanId.padEnd(24)} stored=${rec.trustScore} current=${cur.trustScore}`);
        if (!same) {
          logger.info(`    stored breakdown  = ${JSON.stringify(rec.trustBreakdown)}`);
          logger.info(`    current breakdown = ${JSON.stringify(cur.breakdown)}`);
        }
      } catch (err) {
        logger.warn(`  ERR  ${rec.loanId}: ${err?.message || err}`);
      }
    }
    logger.info(`[trust:recompute] drifted=${drifted} of ${latestPerLoan.length}`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  logger.error("[trust:recompute] failed:", err?.stack || err?.message || err);
  process.exit(1);
});
