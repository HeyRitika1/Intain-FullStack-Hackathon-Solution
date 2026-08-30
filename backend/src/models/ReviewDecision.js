import mongoose from "mongoose";

const reviewDecisionSchema = new mongoose.Schema(
  {
    loanId: { type: String, required: true, index: true },
    exceptionId: { type: String, default: null, index: true },
    action: {
      type: String,
      enum: [
        "accept_ai",
        "edit_ai",
        "reject_ai",
        "manual_approve",
        "manual_reject",
        "edit_field",
        "request_correction",
        "add_comment",
      ],
      required: true,
    },
    beforeValues: { type: mongoose.Schema.Types.Mixed, default: null },
    afterValues: { type: mongoose.Schema.Types.Mixed, default: null },
    comment: { type: String, default: "" },
    aiRecommendationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AiRecommendation",
      default: null,
    },
    // Free-form metadata: droppedFields (from AI whitelist filtering),
    // reconciliationSource (Prompt 14), etc. Additive migration per Prompt 12.
    notes: { type: mongoose.Schema.Types.Mixed, default: undefined },
    reviewer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  },
  { timestamps: true }
);

export const ReviewDecision =
  mongoose.models.ReviewDecision || mongoose.model("ReviewDecision", reviewDecisionSchema);
export default ReviewDecision;
