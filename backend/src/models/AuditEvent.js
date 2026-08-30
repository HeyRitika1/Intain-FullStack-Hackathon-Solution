import mongoose from "mongoose";

/**
 * Hash-linked, append-only audit trail.
 *
 * Synthetic loanId conventions (documented once, used everywhere):
 *   `__BATCH__<batchId>`           — batch-level events (upload / summarize_batch).
 *   `__ORPHAN__servicer__<loanId>` — servicer_update row with no matching Loan.
 *   `__ORPHAN__manifest__<loanId>` — document_manifest row with no matching Loan.
 *   `__QUERY__`                    — Converse queries against verified data.
 *   `__RULES__`                    — rule-approval / rule-rejection events.
 *   `__MISSING__<rowIndex>__<b8>`  — loan_tape row that arrived with an empty loan_id.
 */
const auditEventSchema = new mongoose.Schema(
  {
    loanId: { type: String, required: true, index: true },
    type: {
      type: String,
      enum: [
        "upload",
        "import",
        "normalize",
        "validate",
        "exception_created",
        "ai_recommendation",
        "comment",
        "field_edit",
        "decision",
        "verified",
        "exported",
      ],
      required: true,
    },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    actorRole: { type: String, default: null },
    timestamp: { type: Date, default: Date.now },
    prevHash: { type: String, required: true },
    hash: { type: String, required: true },
  },
  { timestamps: true }
);

auditEventSchema.index({ loanId: 1, timestamp: 1 });

export const AuditEvent =
  mongoose.models.AuditEvent || mongoose.model("AuditEvent", auditEventSchema);
export default AuditEvent;
