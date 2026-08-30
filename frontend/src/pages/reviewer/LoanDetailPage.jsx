import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { apiGet, apiPatch, apiPost } from "../../lib/api.js";
import { toast } from "../../components/ui/Toast.jsx";
import Badge from "../../components/ui/Badge.jsx";
import Button from "../../components/ui/Button.jsx";
import Card from "../../components/ui/Card.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import Spinner from "../../components/ui/Spinner.jsx";
import EditableField from "../../components/EditableField.jsx";
import KeyValueList from "../../components/KeyValueList.jsx";
import RelativeTime from "../../components/RelativeTime.jsx";
import SeverityBadge from "../../components/SeverityBadge.jsx";
import AiReviewPanel from "../../components/ai/AiReviewPanel.jsx";
import AuditTimeline from "../../components/audit/AuditTimeline.jsx";

const EDITABLE_FIELDS = [
  { name: "borrowerName", label: "Borrower name", type: "string" },
  { name: "state", label: "State", type: "string" },
  { name: "currentBalance", label: "Current balance", type: "number" },
  { name: "interestRate", label: "Interest rate %", type: "number" },
  { name: "paymentStatus", label: "Payment status", type: "string", options: ["current", "delinquent", "default", "paid_off", "closed"] },
  { name: "daysPastDue", label: "Days past due", type: "number" },
  { name: "lastUpdatedAt", label: "Last updated", type: "date" },
  { name: "documentStatus", label: "Document status", type: "string", options: ["complete", "missing", "partial", "unknown"] },
];

const READ_ONLY_FIELDS = [
  { name: "loanId", label: "Loan ID", mono: true },
  { name: "borrowerId", label: "Borrower ID", mono: true },
  { name: "sourceBatchId", label: "Source batch", mono: true },
  { name: "originalPrincipal", label: "Original principal" },
  { name: "originationDate", label: "Origination", type: "date" },
  { name: "maturityDate", label: "Maturity", type: "date" },
];

const STATUS_ORDER = ["open", "in_review", "resolved", "dismissed"];
const STATUS_LABEL = { open: "Open", in_review: "In Review", resolved: "Resolved", dismissed: "Dismissed" };
const STATUS_TONE = { open: "amber", in_review: "blue", resolved: "emerald", dismissed: "slate" };

export default function LoanDetailPage() {
  const { loanId } = useParams();
  const [params] = useSearchParams();
  const focusExceptionId = params.get("exception") || null;
  const [detail, setDetail] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    apiGet(`/loans/${encodeURIComponent(loanId)}`)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((err) => { if (!cancelled) toast.error(`Load failed: ${err.message}`); });
    return () => { cancelled = true; };
  }, [loanId, tick]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  if (!detail) return <Spinner label="Loading loan" />;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,340px)_minmax(0,1.4fr)_minmax(0,340px)]">
      <LoanFactsCard detail={detail} onSaved={refetch} />
      <ExceptionsColumn detail={detail} focusExceptionId={focusExceptionId} onChanged={refetch} />
      <ActivityColumn detail={detail} />
    </div>
  );
}

function LoanFactsCard({ detail, onSaved }) {
  const loan = detail.loan;

  const save = async (name, value) => {
    try {
      const res = await apiPatch(`/loans/${encodeURIComponent(loan.loanId)}`, { [name]: value });
      if (res.changed) {
        toast.success(`Saved ${name}`);
        onSaved();
      } else {
        toast.info("No change");
      }
    } catch (err) {
      toast.error(`Save failed: ${err.message}`);
      throw err;
    }
  };

  return (
    <Card title="Loan facts" subtitle={loan.loanId}>
      {detail.servicerUpdatePresent && (
        <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs">
          <Link
            to={`/reviewer/reconciliation?loanId=${encodeURIComponent(loan.loanId)}`}
            className="font-medium text-emerald-800 hover:underline"
          >
            View reconciliation →
          </Link>
          <span className="ml-2 text-emerald-700/70">Side-by-side loan_tape vs servicer_update</span>
        </div>
      )}
      <dl>
        {READ_ONLY_FIELDS.map((f) => (
          <EditableField
            key={f.name}
            label={f.label}
            name={f.name}
            value={loan[f.name]}
            type={f.type || "string"}
            editable={false}
          />
        ))}
        {EDITABLE_FIELDS.map((f) => (
          <EditableField
            key={f.name}
            label={f.label}
            name={f.name}
            value={loan[f.name]}
            type={f.type}
            options={f.options}
            onSave={save}
          />
        ))}
      </dl>
      <div className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
        <div>Verification: <Badge tone={STATUS_TONE[loan.verificationStatus] || "slate"}>{loan.verificationStatus}</Badge></div>
        <div className="mt-1">Servicer update linked: {detail.servicerUpdatePresent ? "yes" : "no"}</div>
        <div>Open exceptions: {detail.openExceptionCount}</div>
      </div>
    </Card>
  );
}

function ExceptionsColumn({ detail, focusExceptionId, onChanged }) {
  const grouped = useMemo(() => {
    const map = { open: [], in_review: [], resolved: [], dismissed: [] };
    for (const e of detail.exceptions || []) map[e.status]?.push(e);
    return map;
  }, [detail.exceptions]);

  const flatOrder = STATUS_ORDER.flatMap((s) => grouped[s] || []);
  const focused = flatOrder.find((e) => e.exceptionId === focusExceptionId) || flatOrder[0] || null;

  if (!flatOrder.length) {
    return (
      <Card title="Exceptions">
        <EmptyState title="No exceptions on this loan" description="This loan currently has no rule failures." />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card title={`Exceptions (${flatOrder.length})`} subtitle="Selected exception is pinned first.">
        <div className="space-y-3">
          {focused && (
            <ExceptionCard exception={focused} pinned onChanged={onChanged} loan={detail.loan} />
          )}
          {STATUS_ORDER.map((s) => {
            const others = (grouped[s] || []).filter((e) => e.exceptionId !== focused?.exceptionId);
            if (!others.length) return null;
            return (
              <details key={s} className="rounded-md border border-slate-200 bg-slate-50">
                <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  {STATUS_LABEL[s]} ({others.length})
                </summary>
                <div className="space-y-2 border-t border-slate-200 bg-white p-3">
                  {others.map((e) => (
                    <ExceptionCard key={e.exceptionId} exception={e} onChanged={onChanged} loan={detail.loan} />
                  ))}
                </div>
              </details>
            );
          })}
        </div>
      </Card>

      {focused && (
        <AiReviewPanel
          loan={detail.loan}
          exception={focused}
          onDecisionApplied={onChanged}
        />
      )}
    </div>
  );
}

function ExceptionCard({ exception: e, pinned = false, onChanged, loan }) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(null);
  const terminal = e.status === "resolved" || e.status === "dismissed";

  const generateNote = async () => {
    if (busy) return;
    setBusy("note");
    try {
      const res = await apiPost("/ai/note", {
        loanId: loan?.loanId || e.loanId,
        exceptionIds: [e.exceptionId],
        decisionAction: "reviewed",
      });
      const note = res?.recommendation?.output?.note;
      if (note) {
        setComment(note);
        toast.info("AI note drafted — edit before posting");
      }
    } catch (err) {
      toast.error(`Note draft failed: ${err.message}`);
    } finally {
      setBusy(null);
    }
  };

  const resolve = async (action) => {
    if (busy || terminal) return;
    setBusy(action);
    try {
      await apiPatch(`/exceptions/${encodeURIComponent(e.exceptionId)}/resolve`, {
        action,
        comment: comment.trim() || undefined,
      });
      toast.success(`Exception ${action.replace("_", " ")}`);
      setComment("");
      onChanged();
    } catch (err) {
      toast.error(`Action failed: ${err.message}`);
    } finally {
      setBusy(null);
    }
  };

  const addComment = async () => {
    if (!comment.trim() || busy) return;
    setBusy("comment");
    try {
      await apiPost(`/exceptions/${encodeURIComponent(e.exceptionId)}/comment`, { comment: comment.trim() });
      toast.success("Comment added");
      setComment("");
      onChanged();
    } catch (err) {
      toast.error(`Comment failed: ${err.message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`rounded-md border p-3 ${pinned ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <SeverityBadge severity={e.severity} />
            <span className="font-mono text-xs text-slate-500">{e.ruleId}</span>
            <Badge tone={STATUS_TONE[e.status] || "slate"}>{e.status}</Badge>
            {pinned && <span className="rounded-full bg-amber-200 px-2 text-[10px] font-semibold uppercase text-amber-900">Focused</span>}
          </div>
          <p className="mt-1 text-sm font-medium text-slate-900">{e.ruleName}</p>
          <p className="mt-0.5 text-sm text-slate-700">{e.message}</p>
        </div>
        <RelativeTime iso={e.createdAt} className="text-xs text-slate-500" />
      </div>

      {e.context?.contextValues && (
        <div className="mt-2 rounded bg-slate-50 p-2">
          <KeyValueList data={e.context.contextValues} />
          {e.context.sourceHint && (
            <p className="mt-1 text-[11px] text-slate-500">source: {e.context.sourceHint}</p>
          )}
        </div>
      )}

      {terminal ? (
        <p className="mt-3 text-xs italic text-slate-500">
          {e.resolutionType ? `Resolution: ${e.resolutionType}` : "Terminal state — no further actions."}
          {e.resolutionNote ? ` · ${e.resolutionNote}` : ""}
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="relative">
            <textarea
              value={comment}
              onChange={(ev) => setComment(ev.target.value)}
              placeholder="Comment (optional)…"
              className="w-full rounded-md border border-slate-300 px-2 py-1 pr-24 text-xs"
              rows={2}
            />
            <button
              type="button"
              onClick={generateNote}
              disabled={!!busy}
              className="absolute right-1 top-1 rounded border border-purple-300 bg-white px-2 py-0.5 text-[10px] font-medium text-purple-800 hover:bg-purple-50 disabled:opacity-50"
            >
              {busy === "note" ? "…" : "AI note"}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => resolve("manual_approve")} disabled={!!busy}>
              {busy === "manual_approve" ? <Spinner size="sm" label="Working" /> : "Approve as-is"}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => resolve("manual_reject")} disabled={!!busy}>
              Reject
            </Button>
            <Button size="sm" variant="secondary" onClick={() => resolve("request_correction")} disabled={!!busy}>
              Request Correction
            </Button>
            <Button size="sm" variant="ghost" onClick={addComment} disabled={!!busy || !comment.trim()}>
              Comment only
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ActivityColumn({ detail }) {
  const decisions = (detail.reviewDecisions || []).slice().reverse();
  return (
    <div className="space-y-3">
      <Card title="Recent activity" subtitle="Reviewer decisions on this loan.">
        {decisions.length === 0 ? (
          <p className="text-xs text-slate-500">No decisions yet.</p>
        ) : (
          <ul className="space-y-2">
            {decisions.map((d) => (
              <li key={String(d._id)} className="rounded-md border border-slate-200 bg-white p-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-800">{d.action}</span>
                  <RelativeTime iso={d.createdAt} className="text-slate-500" />
                </div>
                {d.reviewerUser && (
                  <div className="text-slate-500">by {d.reviewerUser.name || d.reviewerUser.email}</div>
                )}
                {d.comment && <p className="mt-1 text-slate-700">{d.comment}</p>}
                {(d.beforeValues && d.afterValues) && (
                  <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-1 text-[10px] text-slate-600">
{JSON.stringify({ before: d.beforeValues, after: d.afterValues }, null, 2)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <div className="text-xs text-slate-500">
          <div className="font-semibold text-slate-700">Hash-chained audit trail</div>
          <p className="mt-1">Last 15 events with chain integrity indicator. Full history in the Consumer Audit Viewer.</p>
        </div>
        <div className="mt-3">
          <AuditTimeline loanId={detail.loan.loanId} compact maxHeight="60vh" />
        </div>
      </Card>
      <Card>
        <Link to="/reviewer/queue" className="text-xs text-blue-700 hover:underline">← Back to queue</Link>
      </Card>
    </div>
  );
}
