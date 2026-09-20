import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiGet, apiPatch, apiPost } from "../../lib/api.js";
import { toast } from "../../components/ui/Toast.jsx";
import Button from "../../components/ui/Button.jsx";
import Card from "../../components/ui/Card.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import Spinner from "../../components/ui/Spinner.jsx";
import Badge from "../../components/ui/Badge.jsx";
import DiffRow from "../../components/DiffRow.jsx";
import { relativeTime } from "../../lib/format.js";

export default function ReconciliationPage() {
  const [params, setParams] = useSearchParams();
  const loanId = params.get("loanId") || null;
  const setLoanId = (id) => {
    const next = new URLSearchParams(params);
    if (id) next.set("loanId", id);
    else next.delete("loanId");
    setParams(next, { replace: false });
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
      <CandidateList selectedLoanId={loanId} onSelect={setLoanId} />
      <div className="min-w-0">
        {loanId ? (
          <SelectedLoanView loanId={loanId} onBack={() => setLoanId(null)} />
        ) : (
          <Card title="Select a loan" subtitle="Pick a candidate on the left to open the side-by-side view.">
            <p className="text-sm text-slate-600">
              Reconciliation surfaces the loan_tape vs servicer_update disagreement per monitored field.
              Any per-row action here writes a <code>ReviewDecision</code> with the reconciliation source
              logged and (when applicable) auto-resolves the <code>CROSS_SOURCE_CONFLICT</code> exception.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

// ------------------------------- candidate list -------------------------------

function CandidateList({ selectedLoanId, onSelect }) {
  const [items, setItems] = useState(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams({ hasServicerUpdate: "true", limit: "100" });
    if (q) qs.set("q", q);
    apiGet(`/loans?${qs.toString()}`)
      .then((r) => { if (!cancelled) setItems(r.items || []); })
      .catch((err) => { if (!cancelled) toast.error(`Load failed: ${err.message}`); });
    return () => { cancelled = true; };
  }, [q]);

  return (
    <Card title="Reconciliation candidates" subtitle="Loans with a linked servicer_update row.">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="loanId or borrower…"
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
      />
      <div className="mt-3 max-h-[70vh] overflow-y-auto">
        {items === null && <Spinner label="Loading candidates" />}
        {items && items.length === 0 && (
          <EmptyState
            title="No servicer updates yet"
            description="Upload a servicer_update.csv from the Operator portal to see reconciliation candidates."
            action={<Link to="/operator/uploads" className="text-xs text-blue-700 hover:underline">Go to uploads →</Link>}
          />
        )}
        {items && items.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {items.map((l) => (
              <li key={l.loanId}>
                <button
                  type="button"
                  onClick={() => onSelect(l.loanId)}
                  className={`w-full rounded-md px-2 py-2 text-left text-sm hover:bg-slate-50 ${selectedLoanId === l.loanId ? "bg-amber-50 ring-1 ring-amber-300" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-slate-700">{l.loanId}</span>
                    <Badge tone={l.verificationStatus === "verified" ? "emerald" : "slate"}>{l.verificationStatus}</Badge>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-600">{l.borrowerName || "—"}</div>
                  <div className="text-[11px] text-slate-500">
                    {l.state} · balance {formatMoney(l.currentBalance)} · {l.paymentStatus}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

// ------------------------------- selected loan view -------------------------------

function SelectedLoanView({ loanId, onBack }) {
  const [data, setData] = useState(null);
  const [reload, setReload] = useState(0);
  const [busyField, setBusyField] = useState(null);
  const [manualField, setManualField] = useState(null);
  const [aiDrawer, setAiDrawer] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    setData(null);
    apiGet(`/loans/${encodeURIComponent(loanId)}/reconciliation`)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((err) => { if (!cancelled) toast.error(`Load failed: ${err.message}`); });
    return () => { cancelled = true; };
  }, [loanId, reload]);

  const refetch = useCallback(() => setReload((n) => n + 1), []);

  const applyField = useCallback(async (field, value, source) => {
    setBusyField(field);
    try {
      const body = { [field]: value, notes: { reconciliationSource: source } };
      const res = await apiPatch(`/loans/${encodeURIComponent(loanId)}`, body);
      toast.success(`Updated ${field} from ${source}`);
      if (res.autoResolvedExceptionId) {
        toast.success("CROSS_SOURCE_CONFLICT auto-resolved");
      }
      if (res.autoVerified) toast.success(`${loanId} auto-verified`);
      refetch();
    } catch (err) {
      toast.error(`Update failed: ${err.message}`);
    } finally {
      setBusyField(null);
    }
  }, [loanId, refetch]);

  const bulkApply = async (source) => {
    if (!data?.diffs?.length) return;
    if (busyField) return;
    setBusyField("__bulk__");
    try {
      const body = { notes: { reconciliationSource: source } };
      for (const d of data.diffs) {
        body[d.field] = source === "servicer" ? d.servicerValue : d.loanTapeValue;
      }
      const res = await apiPatch(`/loans/${encodeURIComponent(loanId)}`, body);
      toast.success(`Bulk applied ${data.diffs.length} field(s) from ${source}`);
      if (res.autoResolvedExceptionId) toast.success("CROSS_SOURCE_CONFLICT auto-resolved");
      if (res.autoVerified) toast.success(`${loanId} auto-verified`);
      refetch();
    } catch (err) {
      toast.error(`Bulk apply failed: ${err.message}`);
    } finally {
      setBusyField(null);
    }
  };

  const askAi = async () => {
    if (aiBusy) return;
    setAiBusy(true);
    try {
      const res = await apiPost(`/ai/compare/${encodeURIComponent(loanId)}`);
      setAiDrawer(res.recommendation);
    } catch (err) {
      toast.error(`Ask AI failed: ${err.message}`);
    } finally {
      setAiBusy(false);
    }
  };

  const openAiPanel = () => {
    const exId = data?.meta?.conflictExceptionId;
    if (!exId) {
      navigate(`/reviewer/loans/${encodeURIComponent(loanId)}`);
    } else {
      navigate(`/reviewer/loans/${encodeURIComponent(loanId)}?exception=${encodeURIComponent(exId)}`);
    }
  };

  if (!data) return <Spinner label="Loading reconciliation" />;

  const { loan, servicerUpdate, diffs, meta } = data;

  if (!servicerUpdate) {
    return (
      <Card title={`${loan.loanId} · ${loan.borrowerName || "—"}`} actions={<Button size="sm" variant="secondary" onClick={onBack}>Back</Button>}>
        <EmptyState title="No servicer update linked" description="This loan does not have a linked servicer_update row to reconcile against." />
      </Card>
    );
  }

  const bulkBusy = busyField === "__bulk__";

  return (
    <div className="space-y-4">
      <Card
        title={<span>{loan.loanId} <span className="text-slate-500">· {loan.borrowerName || "—"}</span></span>}
        subtitle={
          <span className="text-xs text-slate-600">
            loan_tape updated <b>{shortDate(meta.loanTapeLastUpdatedAt)}</b>
            {" · "}servicer_update updated <b>{shortDate(meta.servicerLastUpdatedAt)}</b>
            {meta.conflictExceptionId ? (
              <>
                {" · "}
                <button type="button" onClick={openAiPanel} className="text-amber-700 hover:underline">
                  Open AI panel on the conflict exception →
                </button>
              </>
            ) : (
              <>{" · "}<span className="text-emerald-700">no open conflict exception</span></>
            )}
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={onBack}>Back</Button>
            <Link
              to={`/reviewer/loans/${encodeURIComponent(loanId)}`}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Loan detail →
            </Link>
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 pb-3">
          <Button size="sm" onClick={() => bulkApply("servicer")} disabled={!diffs.length || !!busyField}>
            Accept all servicer values
          </Button>
          <Button size="sm" variant="secondary" onClick={() => bulkApply("loanTape")} disabled={!diffs.length || !!busyField}>
            Keep all loan-tape values
          </Button>
          <Button size="sm" variant="ghost" onClick={askAi} disabled={aiBusy}>
            {aiBusy ? <Spinner size="sm" label="Asking AI" /> : "Ask AI to reconcile"}
          </Button>
          {bulkBusy && <Spinner size="sm" label="Applying" />}
        </div>

        {diffs.length === 0 ? (
          <div className="p-4 text-sm text-slate-600">
            This loan's servicer update matches the loan tape on all monitored fields.
            You can still <button type="button" onClick={askAi} className="text-blue-700 hover:underline">Ask AI to reconcile</button> for a summary insight.
          </div>
        ) : (
          <div>
            {diffs.map((d) => (
              <ReconciliationRow
                key={d.field}
                diff={d}
                busy={busyField === d.field || bulkBusy}
                onUseLoanTape={() => applyField(d.field, d.loanTapeValue, "loanTape")}
                onUseServicer={() => applyField(d.field, d.servicerValue, "servicer")}
                onManualEntry={() => setManualField(d)}
              />
            ))}
          </div>
        )}
      </Card>

      {manualField && (
        <ManualEntryModal
          diff={manualField}
          onConfirm={(val) => { applyField(manualField.field, val, "manual"); setManualField(null); }}
          onCancel={() => setManualField(null)}
        />
      )}

      {aiDrawer && (
        <AiCompareDrawer
          rec={aiDrawer}
          onClose={() => setAiDrawer(null)}
          onOpenPanel={openAiPanel}
        />
      )}
    </div>
  );
}

function ReconciliationRow({ diff, busy, onUseLoanTape, onUseServicer, onManualEntry }) {
  return (
    <div className="grid grid-cols-1">
      <DiffRow
        diff={diff}
        busy={busy}
        onUseLoanTape={onUseLoanTape}
        onUseServicer={onUseServicer}
        onManualEntry={onManualEntry}
      />
    </div>
  );
}

function ManualEntryModal({ diff, onConfirm, onCancel }) {
  const initial = diff.servicerValue ?? diff.loanTapeValue ?? "";
  const [val, setVal] = useState(String(initial ?? ""));
  const coerce = (raw) => {
    if (raw === "") return null;
    const isNumericField = ["currentBalance", "daysPastDue"].includes(diff.field);
    if (isNumericField) {
      const n = Number(raw);
      return Number.isFinite(n) ? n : raw;
    }
    return raw;
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-4 shadow-xl">
        <h3 className="text-sm font-semibold text-slate-900">Manual entry: <code>{diff.field}</code></h3>
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
          <div><span className="text-slate-500">loan_tape:</span> <span className="font-mono">{String(diff.loanTapeValue ?? "—")}</span></div>
          <div><span className="text-slate-500">servicer:</span> <span className="font-mono">{String(diff.servicerValue ?? "—")}</span></div>
        </div>
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          autoFocus
          className="mt-3 w-full rounded border border-slate-300 px-2 py-1 text-sm"
          placeholder="new value"
        />
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button size="sm" onClick={() => onConfirm(coerce(val))}>Apply</Button>
        </div>
      </div>
    </div>
  );
}

function AiCompareDrawer({ rec, onClose, onOpenPanel }) {
  const out = rec?.output || {};
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={onClose}>
      <aside className="w-full max-w-lg overflow-y-auto bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between border-b border-slate-200 pb-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">AI reconciliation view</h3>
            <p className="text-[11px] text-slate-500">
              {rec.model} · {rec.fallbackUsed ? "fallback" : "provider"}
              {typeof rec.confidence === "number" ? ` · ${Math.round(rec.confidence * 100)}%` : ""}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-800">Close</button>
        </header>
        <p className="mt-3 text-sm text-slate-800">{out.summary || "(no summary)"}</p>
        {Array.isArray(out.diffs) && out.diffs.length > 0 && (
          <div className="mt-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Diffs</h4>
            <div className="mt-1 rounded-md border border-slate-200">
              {out.diffs.map((d, i) => (
                <DiffRow key={i} diff={d} actionable={false} />
              ))}
            </div>
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
          <Button size="sm" onClick={onOpenPanel}>Suggest correction →</Button>
        </div>
      </aside>
    </div>
  );
}

// ------------------------------- helpers -------------------------------

function shortDate(v) {
  if (!v) return "—";
  return String(v).slice(0, 10);
}
function formatMoney(v) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
