import mongoose from "mongoose";

const exceptionSchema = new mongoose.Schema(
  {
    exceptionId: { type: String, required: true, unique: true, index: true },
    loanId: { type: String, required: true, index: true },
    ruleId: { type: String, required: true, index: true },
    ruleName: { type: String },
    severity: {
      type: String,
      enum: ["low", "medium", "high", "blocking"],
      required: true,
      index: true,
    },
    fields: { type: [String], default: [] },
    message: { type: String, required: true },
    context: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ["open", "in_review", "resolved", "dismissed"],
      default: "open",
      index: true,
    },
    resolutionType: {
      type: String,
      enum: ["approved_as_is", "edited", "rejected", "correction_requested"],
      default: null,
    },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    resolvedAt: { type: Date, default: null },
    resolutionNote: { type: String, default: null },
    aiRecommendationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AiRecommendation",
      default: null,
    },
  },
  { timestamps: true }
);

exceptionSchema.index({ status: 1, severity: 1, createdAt: -1 });

export const Exception = mongoose.models.Exception || mongoose.model("Exception", exceptionSchema);
export default Exception;
