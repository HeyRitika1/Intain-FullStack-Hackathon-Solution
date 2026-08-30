import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { connectDb } from "../src/config/db.js";
import { AuditEvent, VerifiedLoanRecord } from "../src/models/index.js";
import { verifyChain } from "../src/services/hashChainService.js";
import { logger } from "../src/utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKUP_PATH = path.resolve(__dirname, ".tamper-backup.json");

const SKIP_TYPES = new Set(["verified", "upload"]);

async function pickTarget(loanIdArg) {
  if (loanIdArg) return loanIdArg;
  const rec = await VerifiedLoanRecord.findOne({}).sort({ verifiedAt: -1 }).select("loanId").lean();
  if (!rec) throw new Error("No verified loans found. Verify one via POST /api/verified/:loanId first.");
  return rec.loanId;
}

async function main() {
  const loanIdArg = process.argv[2] || null;
  await connectDb();
  try {
    if (fs.existsSync(BACKUP_PATH)) {
      logger.warn(`[demo:tamper] backup already exists at ${BACKUP_PATH} — run demo:untamper first.`);
      process.exitCode = 1;
      return;
    }
    const loanId = await pickTarget(loanIdArg);
    const events = await AuditEvent.find({ loanId }).sort({ timestamp: 1, _id: 1 }).lean();
    const candidates = events.filter((e) => !SKIP_TYPES.has(e.type));
    if (candidates.length === 0) throw new Error(`No tamperable events for ${loanId}`);
    const target = candidates[Math.floor(candidates.length / 2)];
    const indexInChain = events.findIndex((e) => String(e._id) === String(target._id));

    const backup = { loanId, eventId: String(target._id), payload: target.payload };
    fs.writeFileSync(BACKUP_PATH, JSON.stringify(backup, null, 2), "utf8");

    const mutated = { ...(target.payload || {}), _tampered: true, _demo: new Date().toISOString() };
    await AuditEvent.updateOne({ _id: target._id }, { $set: { payload: mutated } });

    const after = await verifyChain(loanId);
    logger.info(`[demo:tamper] loanId=${loanId} tampered event type=${target.type} _id=${target._id}`);
    logger.info(`[demo:tamper] expected brokenAtIndex=${indexInChain} — verifyChain says ok=${after.ok}, brokenAtIndex=${after.brokenAtIndex}`);
    logger.info(`[demo:tamper] backup written to ${BACKUP_PATH}`);
    logger.info(`[demo:tamper] run 'npm run demo:untamper' to restore.`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  logger.error("[demo:tamper] failed:", err?.stack || err?.message || err);
  process.exit(1);
});
