import mongoose from "mongoose";

const validationRuleSchema = new mongoose.Schema(
  {
    ruleId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    description: { type: String },
    severity: {
      type: String,
      enum: ["low", "medium", "high", "blocking"],
      required: true,
    },
    messageTemplate: { type: String, required: true },
    expression: { type: mongoose.Schema.Types.Mixed, required: true },
    // Which source the rule iterates. Defaults to `loan` — orphan rules use the other two.
    appliesTo: {
      type: String,
      enum: ["loan", "servicerUpdate", "manifest"],
      default: "loan",
    },
    active: { type: Boolean, default: true, index: true },
    origin: {
      type: String,
      enum: ["seed", "ai_generated", "user"],
      default: "seed",
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

export const ValidationRule =
  mongoose.models.ValidationRule || mongoose.model("ValidationRule", validationRuleSchema);
export default ValidationRule;
