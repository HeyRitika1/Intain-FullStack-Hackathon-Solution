import mongoose from "mongoose";

const devLogEntrySchema = new mongoose.Schema(
  {
    module: { type: String, required: true, index: true },
    date: { type: Date, default: Date.now, index: true },
    tool: { type: String, required: true },
    prompt: { type: String, required: true },
    outcome: {
      type: String,
      enum: ["accepted", "edited", "rejected", "caught_bad_ai"],
      required: true,
    },
    notes: { type: String, default: "" },
    aiAuthoredPct: { type: Number, min: 0, max: 100, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

export const DevLogEntry =
  mongoose.models.DevLogEntry || mongoose.model("DevLogEntry", devLogEntrySchema);
export default DevLogEntry;
