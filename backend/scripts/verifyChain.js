import mongoose from "mongoose";
import { connectDb } from "../src/config/db.js";
import { Loan } from "../src/models/index.js";
import { verifyChain } from "../src/services/hashChainService.js";
import { logger } from "../src/utils/logger.js";

async function main() {
  await connectDb();
  try {
    const loans = await Loan.find({}).select("loanId verificationStatus").lean();
    const rawIds = [];
    // Also include synthetic loanIds that carry batch/orphan events.
    const AuditEvent = (await import("../src/models/index.js")).AuditEvent;
    const distinctSynthetic = await AuditEvent.distinct("loanId", {
      loanId: { $regex: /^__(BATCH|ORPHAN|QUERY|RULES|EXCEPTION)__/ },
    });
    for (const l of loans) rawIds.push(l.loanId);
    for (const s of distinctSynthetic) rawIds.push(s);

    let ok = 0;
    const broken = [];
    for (const id of rawIds) {
      const r = await verifyChain(id);
      if (r.ok) ok++;
      else broken.push({ id, brokenAtIndex: r.brokenAtIndex, total: r.totalEvents, reason: r.reason });
    }

    logger.info(`[chain:verify] checked ${rawIds.length} loanIds → OK=${ok} BROKEN=${broken.length}`);
    for (const b of broken) {
      logger.warn(`  BROKEN ${b.id}: brokenAtIndex=${b.brokenAtIndex} of ${b.total} (${b.reason})`);
    }
    process.exitCode = broken.length ? 1 : 0;
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  logger.error("[chain:verify] failed:", err?.stack || err?.message || err);
  process.exit(1);
});
