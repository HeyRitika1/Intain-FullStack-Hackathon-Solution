import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { connectDb } from "../src/config/db.js";
import { AuditEvent } from "../src/models/index.js";
import { verifyChain } from "../src/services/hashChainService.js";
import { logger } from "../src/utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKUP_PATH = path.resolve(__dirname, ".tamper-backup.json");

async function main() {
  if (!fs.existsSync(BACKUP_PATH)) {
    logger.warn(`[demo:untamper] no backup found at ${BACKUP_PATH}`);
    process.exitCode = 1;
    return;
  }
  const backup = JSON.parse(fs.readFileSync(BACKUP_PATH, "utf8"));
  await connectDb();
  try {
    await AuditEvent.updateOne({ _id: backup.eventId }, { $set: { payload: backup.payload } });
    const after = await verifyChain(backup.loanId);
    fs.unlinkSync(BACKUP_PATH);
    logger.info(`[demo:untamper] restored loanId=${backup.loanId} event=${backup.eventId} chainOk=${after.ok}`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  logger.error("[demo:untamper] failed:", err?.stack || err?.message || err);
  process.exit(1);
});
