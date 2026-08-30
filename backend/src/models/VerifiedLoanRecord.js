import mongoose from "mongoose";

const validationSummarySchema = new mongoose.Schema(
  {
    rulesRun: { type: Number, default: 0 },
    passed: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    exceptionIds: { type: [String], default: [] },
  },
  { _id: false }
);

const trustBreakdownSchema = new mongoose.Schema(
  {
    completeness: { type: Number, min: 0, max: 100, default: 0 },
    consistency: { type: Number, min: 0, max: 100, default: 0 },
    freshness: { type: Number, min: 0, max: 100, default: 0 },
    reviewCoverage: { type: Number, min: 0, max: 100, default: 0 },
  },
  { _id: false }
);

const verifiedLoanRecordSchema = new mongoose.Schema(
  {
    // Append-only: multiple records per loanId are allowed; the read API picks the
    // most recent by verifiedAt. Uniqueness lives on recordHash (below).
    loanId: { type: String, required: true, index: true },
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    sourceBatchId: { type: String },
    servicerUpdateBatchId: { type: String, default: null },
    validationSummary: { type: validationSummarySchema, default: () => ({}) },
    reviewerDecisionIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "ReviewDecision",
      default: [],
    },
    aiRecommendationIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "AiRecommendation",
      default: [],
    },
    trustScore: { type: Number, min: 0, max: 100, default: 0 },
    trustBreakdown: { type: trustBreakdownSchema, default: () => ({}) },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    verifiedAt: { type: Date, default: Date.now, index: true },
    recordHash: { type: String, required: true, unique: true },
    prevAuditHash: { type: String, required: true },
  },
  { timestamps: true }
);

export const VerifiedLoanRecord =
  mongoose.models.VerifiedLoanRecord ||
  mongoose.model("VerifiedLoanRecord", verifiedLoanRecordSchema);
export default VerifiedLoanRecord;
