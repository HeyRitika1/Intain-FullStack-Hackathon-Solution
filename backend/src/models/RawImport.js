import mongoose from "mongoose";

const failedRowSchema = new mongoose.Schema(
  {
    rowIndex: { type: Number, required: true },
    rawRow: { type: mongoose.Schema.Types.Mixed },
    reason: { type: String, required: true },
  },
  { _id: false }
);

const rawImportSchema = new mongoose.Schema(
  {
    batchId: { type: String, required: true, unique: true, index: true },
    fileType: {
      type: String,
      enum: ["loan_tape", "servicer_update", "document_manifest"],
      required: true,
      index: true,
    },
    originalFilename: { type: String, required: true },
    fileHash: { type: String, required: true },
    rawText: { type: String, required: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    rowCount: { type: Number, default: 0 },
    normalizedCount: { type: Number, default: 0 },
    failedRowCount: { type: Number, default: 0 },
    failedRows: { type: [failedRowSchema], default: [] },
    status: {
      type: String,
      enum: ["uploaded", "normalized", "validated", "committed"],
      default: "uploaded",
    },
    // Structured import metadata. Shape varies by fileType — e.g. { duplicateLoanIds: [...],
    // parsedRowsByLoanId: {...}, rowsByLoanId: {...}, linkedLoanIds: [...] }. Queryable via
    // dot-paths like `notes.parsedRowsByLoanId.LN-0001`.
    notes: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export const RawImport = mongoose.models.RawImport || mongoose.model("RawImport", rawImportSchema);
export default RawImport;
