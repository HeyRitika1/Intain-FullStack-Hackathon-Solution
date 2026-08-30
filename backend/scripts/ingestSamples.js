import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { connectDb } from "../src/config/db.js";
import { commitBatch, previewUpload } from "../src/services/ingestService.js";
import { AuditEvent, Loan, RawImport, User } from "../src/models/index.js";
import { logger } from "../src/utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SAMPLES_DIR = path.resolve(__dirname, "../../samples");

const FILES = [
  { fileType: "loan_tape", name: "loan_tape.csv" },
  { fileType: "servicer_update", name: "servicer_update.csv" },
  { fileType: "document_manifest", name: "document_manifest.csv" },
];

/**
 * Reads /samples/*.csv and drives the ingestService end-to-end.
 * Callable from other scripts (reset, smoke) that manage their own DB lifecycle.
 * If { resetCollections: true } (default) it wipes Loan/RawImport/AuditEvent first.
 */
export async function ingestSamples({ resetCollections = true } = {}) {
  if (resetCollections) {
    logger.info("[ingest:samples] resetting Loan, RawImport, AuditEvent collections");
    await Promise.all([
      Loan.deleteMany({}),
      RawImport.deleteMany({}),
      AuditEvent.deleteMany({}),
    ]);
  }

  const operator = await User.findOne({ email: "operator@intain.test" }).lean();
  if (!operator) throw new Error("Seeded operator not found. Run: npm run seed:users first.");

  const summary = { batches: [], loans: 0, imports: 0, auditEvents: 0 };
  for (const f of FILES) {
    const filePath = path.join(SAMPLES_DIR, f.name);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing sample: ${filePath}. Run: npm run gen:samples`);
    }
    const rawText = fs.readFileSync(filePath, "utf8");

    const preview = await previewUpload({
      fileType: f.fileType,
      originalFilename: f.name,
      rawText,
      uploadedBy: operator._id,
      actorRole: operator.role,
    });
    const commit = await commitBatch(preview.batchId, {
      actor: operator._id,
      actorRole: operator.role,
    });
    summary.batches.push({ fileType: f.fileType, preview, commit });
  }
  const [loans, imports, events] = await Promise.all([
    Loan.countDocuments(),
    RawImport.countDocuments(),
    AuditEvent.countDocuments(),
  ]);
  summary.loans = loans; summary.imports = imports; summary.auditEvents = events;
  return summary;
}

async function main() {
  await connectDb();
  try {
    const summary = await ingestSamples({ resetCollections: true });
    for (const b of summary.batches) {
      logger.info(
        `[ingest:samples] ${b.fileType}: rows=${b.preview.rowCount} normalized=${b.preview.normalizedCount} failed=${b.preview.failedRowCount} batchId=${b.preview.batchId.slice(0,8)}... committed=${b.commit.committedCount} orphans=${(b.commit.orphanLoanIds || []).length}`
      );
    }
    logger.info(`[ingest:samples] summary: loans=${summary.loans} rawImports=${summary.imports} auditEvents=${summary.auditEvents}`);

    const sample = await Loan.find({
      loanId: { $in: ["LN-0001", "LN-0057", "LN-0060", "LN-0003"] },
    })
      .select("loanId currentBalance paymentStatus servicerUpdateBatchId documentStatus sourceRowIndex")
      .lean();
    for (const l of sample) {
      logger.info(
        `[ingest:samples]   ${l.loanId}: balance=${l.currentBalance} status=${l.paymentStatus} servicer=${l.servicerUpdateBatchId ? "linked" : "-"} docs=${l.documentStatus}`
      );
    }
  } finally {
    await mongoose.disconnect();
  }
}

const isDirectRun = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("/scripts/ingestSamples.js");
if (isDirectRun) {
  main().catch((err) => {
    logger.error("[ingest:samples] failed:", err?.stack || err?.message || err);
    process.exit(1);
  });
}
