import mongoose from "mongoose";

const loanSchema = new mongoose.Schema(
  {
    loanId: { type: String, required: true, unique: true, index: true },
    borrowerId: { type: String, index: true },
    borrowerName: { type: String },
    state: { type: String, uppercase: true, minlength: 2, maxlength: 2, index: true },
    originationDate: { type: Date },
    maturityDate: { type: Date },
    originalPrincipal: { type: Number },
    currentBalance: { type: Number },
    interestRate: { type: Number },
    paymentStatus: {
      type: String,
      enum: ["current", "delinquent", "default", "paid_off", "closed"],
    },
    daysPastDue: { type: Number, default: 0 },
    lastUpdatedAt: { type: Date },
    documentStatus: {
      type: String,
      enum: ["complete", "missing", "partial", "unknown"],
      default: "unknown",
    },
    sourceBatchId: { type: String, index: true },
    sourceRowIndex: { type: Number },
    servicerUpdateBatchId: { type: String, default: null },
    verificationStatus: {
      type: String,
      enum: ["pending", "in_review", "verified", "rejected"],
      default: "pending",
      index: true,
    },
  },
  { timestamps: true }
);

loanSchema.index({ borrowerId: 1, originalPrincipal: 1, originationDate: 1 });

export const Loan = mongoose.models.Loan || mongoose.model("Loan", loanSchema);
export default Loan;
