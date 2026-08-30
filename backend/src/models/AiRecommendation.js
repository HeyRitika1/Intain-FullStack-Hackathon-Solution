import mongoose from "mongoose";

const aiRecommendationSchema = new mongoose.Schema(
  {
    loanId: { type: String, index: true },
    exceptionId: { type: String, default: null, index: true },
    templateName: {
      type: String,
      enum: [
        "explain_failure",
        "suggest_correction",
        "compare_sources",
        "generate_reviewer_note",
        "classify_severity",
        "summarize_batch",
        "rule_from_nl",
        "converse_query",
      ],
      required: true,
      index: true,
    },
    promptSnapshot: { type: String, required: true },
    model: { type: String, required: true },
    providerLatencyMs: { type: Number },
    output: { type: mongoose.Schema.Types.Mixed },
    confidence: { type: Number, min: 0, max: 1, default: null },
    sourceHint: { type: String, default: null },
    fallbackUsed: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

export const AiRecommendation =
  mongoose.models.AiRecommendation || mongoose.model("AiRecommendation", aiRecommendationSchema);
export default AiRecommendation;
