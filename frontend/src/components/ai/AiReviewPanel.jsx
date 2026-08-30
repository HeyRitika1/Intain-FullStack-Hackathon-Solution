import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPatch, apiPost } from "../../lib/api.js";
import { toast } from "../ui/Toast.jsx";
import Badge from "../ui/Badge.jsx";
import Button from "../ui/Button.jsx";
import Spinner from "../ui/Spinner.jsx";
import RelativeTime from "../RelativeTime.jsx";
import { truncMiddle } from "../../lib/format.js";

const WATERMARK_CLS = "relative before:pointer-events-none before:absolute before:right-3 before:top-2 before:text-[10px] before:font-semibold before:uppercase before:tracking-widest before:text-purple-300 before:content-['AI-generated']";

const SLOW_HINT_MS = 4000;

export default function AiReviewPanel({ loan, exception, onDecisionApplied }) {
  const [history, setHistory] = useState([]);
  const [latest, setLatest] = useState(null);
  const [loadingBtn, setLoadingBtn] = useState(null);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPreview, setHistoryPreview] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const slowTimer = useRef(null);
  const [perField, setPerField] = useState({});

  const exceptionId = exception?.exceptionId;
  const loanId = loan?.loanId;
  const terminal = exception?.status === "resolved" || exception?.status === "dismissed";

  // Hydrate latestAiRecommendation + aiHistory whenever the focused exception changes.
  useEffect(() => {
    if (!exceptionId) return;
    let cancelled = false;
    apiGet(`/exceptions/${encodeURIComponent(exceptionId)}`)
      .then((res) => {
        if (cancelled) return;
        setHistory(res.aiHistory || []);
        if (res.latestAiRecommendation) {
          setLatest(res.latestAiRecommendation);
          seedPerFieldFromSuggestion(res.latestAiRecommendation, loan, setPerField);
        } else {
          setLatest(null);
          setPerField({});
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [exceptionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const startCall = (btn) => {
    setLoadingBtn(btn);
    setError(null);
    setSlow(false);
    slowTimer.current = setTimeout(() => setSlow(true), SLOW_HINT_MS);
  };
  const endCall = () => {
    setLoadingBtn(null);
    setSlow(false);
    if (slowTimer.current) { clearTimeout(slowTimer.current); slowTimer.current = null; }
  };

  const applyRec = useCallback((rec) => {
    setLatest(rec);
    setHistory((prev) => [
      { recommendationId: rec._id, templateName: rec.templateName, model: rec.model, confidence: rec.confidence, fallbackUsed: rec.fallbackUsed, createdAt: rec.createdAt || new Date().toISOString(), decisionAction: null },
      ...prev.filter((h) => h.recommendationId !== rec._id),
    ]);
    if (rec.templateName === "suggest_correction") {
      seedPerFieldFromSuggestion(rec, loan, setPerField);
    }
  }, [loan]);

  const doExplain = async () => {
    startCall("explain");
    try {
      const res = await apiPost(`/ai/explain/${encodeURIComponent(exceptionId)}`);
      applyRec(res.recommendation);
    } catch (err) {
      setError(err.message || "AI call failed");
    } finally { endCall(); }
  };
  const doSuggest = async () => {
    startCall("suggest");
    try {
      const res = await apiPost(`/ai/suggest/${encodeURIComponent(exceptionId)}`);
      applyRec(res.recommendation);
    } catch (err) {
      setError(err.message || "AI call failed");
    } finally { endCall(); }
  };
  const doCompare = async () => {
    startCall("compare");
    try {
      const res = await apiPost(`/ai/compare/${encodeURIComponent(loanId)}`);
      applyRec(res.recommendation);
    } catch (err) {
      setError(err.message || "AI call failed");
    } finally { endCall(); }
  };

  // ---------------- Decision handlers ----------------

  const suggestion = latest?.output?.suggestedFields || null;
  const hasSuggestion = suggestion && Object.keys(suggestion).length > 0;

  const derived = useMemo(() => {
    if (!hasSuggestion) return { changed: false, willApply: {} };
    const applying = {};
    let changed = false;
    for (const [k, aiVal] of Object.entries(suggestion)) {
      const row = perField[k];
      if (!row?.include) { changed = true; continue; }
      const finalVal = row.edited === "" ? null : (row.edited !== null && row.edited !== undefined ? coerce(row.edited, aiVal) : aiVal);
      if (finalVal === null && aiVal !== null && aiVal !== undefined) { changed = true; continue; }
      if (!looseEq(finalVal, aiVal)) changed = true;
      applying[k] = finalVal;
    }
    return { changed, willApply: applying };
  }, [hasSuggestion, suggestion, perField]);

  const submitDecision = async ({ action, comment }) => {
    if (!latest?._id) return;
    const body = { action, aiRecommendationId: latest._id, comment };
    if (action === "edit_ai") body.editedFields = derived.willApply;
    try {
      const res = await apiPatch(`/exceptions/${encodeURIComponent(exceptionId)}/resolve`, body);
      if (res.alreadyApplied) toast.info("Already applied");
      else toast.success(`${action.replace("_", " ")} recorded`);
      onDecisionApplied?.();
    } catch (err) {
      toast.error(`Decision failed: ${err.message}`);
    } finally {
      setConfirming(null);
    }
  };

  return (
    <div className="rounded-lg border-2 border-purple-300 bg-purple-50/40 p-4">
      <Header rec={latest} />

      <ActionStrip
        onExplain={doExplain}
        onSuggest={doSuggest}
        onCompare={doCompare}
        loadingBtn={loadingBtn}
        disabled={terminal}
        canCompare={Boolean(loan?.servicerUpdateBatchId)}
      />

      {slow && <div className="mt-2 text-xs text-slate-500">Still working…</div>}

      {latest?.fallbackUsed && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Deterministic fallback — set <code>AI_ENABLED=true</code> and provide <code>AI_API_KEY</code> for live LLM responses.
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
          AI provider error — showing deterministic fallback. ({error})
        </div>
      )}

      {latest?.output?.reasoningChain?.length ? (
        <section className={`mt-3 rounded-md bg-white p-3 ${WATERMARK_CLS}`}>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-purple-700">Reasoning</h4>
          <ol className="mt-1 space-y-1 text-sm text-slate-800">
            {latest.output.reasoningChain.map((s, i) => (
              <li key={i}>
                <span className="mr-1 font-mono text-xs text-slate-400">{i + 1}.</span>
                <span className="font-medium">{s.step}</span>
                <span className="text-slate-500">: {s.detail}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : latest?.output?.explanation ? (
        <section className={`mt-3 rounded-md bg-white p-3 ${WATERMARK_CLS}`}>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-purple-700">Explanation</h4>
          <p className="mt-1 text-sm text-slate-800">{latest.output.explanation}</p>
        </section>
      ) : null}

      {hasSuggestion && (
        <section className={`mt-3 rounded-md bg-white p-3 ${WATERMARK_CLS}`}>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-purple-700">Suggested correction</h4>
          <SuggestionTable
            suggestion={suggestion}
            perField={perField}
            setPerField={setPerField}
            loan={loan}
          />
          {latest.output.sourceHint && (
            <p className="mt-2 text-xs text-slate-500">Source: {latest.output.sourceHint}</p>
          )}
          {latest.output.rationale && (
            <p className="mt-1 text-xs text-slate-600">{latest.output.rationale}</p>
          )}
          <ConfidenceBar value={latest.confidence} />
        </section>
      )}

      {latest?.templateName === "compare_sources" && latest.output?.diffs?.length > 0 && (
        <section className={`mt-3 rounded-md bg-white p-3 ${WATERMARK_CLS}`}>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-purple-700">Sources compared</h4>
          <DiffsTable diffs={latest.output.diffs} />
          <p className="mt-2 text-xs text-slate-600">{latest.output.summary}</p>
        </section>
      )}

      {hasSuggestion && !terminal && (
        <DecisionBar
          derived={derived}
          onAcceptAsIs={() => setConfirming({ action: "accept_ai" })}
          onEditAccept={() => setConfirming({ action: "edit_ai" })}
          onReject={() => setConfirming({ action: "reject_ai" })}
        />
      )}

      <HistorySection
        open={historyOpen}
        toggle={() => setHistoryOpen((v) => !v)}
        history={history}
        onOpenEntry={(recId) => setHistoryPreview(recId)}
      />

      {historyPreview && (
        <HistoryDrawer recId={historyPreview} onClose={() => setHistoryPreview(null)} />
      )}

      {confirming && (
        <ConfirmModal
          action={confirming.action}
          derived={derived}
          suggestion={suggestion}
          onConfirm={(comment) => submitDecision({ action: confirming.action, comment })}
          onCancel={() => setConfirming(null)}
        />
      )}
    </div>
  );
}

// ---------------- Header ----------------

function Header({ rec }) {
  const model = rec?.model;
  return (
    <div className="flex items-start justify-between gap-2 border-b border-purple-200 pb-2">
      <div>
        <h3 className="text-sm font-semibold text-purple-900">AI Review Assistant</h3>
        <p className="text-[11px] text-purple-700/70">Recommendations are separate from the record. Reviewer always applies.</p>
      </div>
      <div className="flex items-center gap-1.5 text-xs">
        {model && (
          <span className="rounded bg-purple-100 px-2 py-0.5 font-mono text-purple-800">
            {truncMiddle(model, 20, 6)}
          </span>
        )}
        {rec?.fallbackUsed && <Badge tone="amber">fallback</Badge>}
        <HelpPopover />
      </div>
    </div>
  );
}

function HelpPopover() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-5 w-5 items-center justify-center rounded-full border border-purple-300 text-purple-700 hover:bg-purple-100"
        aria-label="What is fallback mode?"
      >?</button>
      {open && (
        <div className="absolute right-0 top-6 z-20 w-64 rounded-md border border-slate-200 bg-white p-3 text-xs shadow-lg">
          <p className="text-slate-700">
            <strong>Provider mode</strong> uses the configured OpenAI-compatible endpoint.
          </p>
          <p className="mt-1 text-slate-700">
            <strong>Fallback mode</strong> uses a deterministic rule-based reasoner so the app is fully demoable without any API key. Prompt snapshots, audit trail, and decision layer are identical.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------- Action strip ----------------

function ActionStrip({ onExplain, onSuggest, onCompare, loadingBtn, disabled, canCompare }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <ActionBtn label="Explain" busy={loadingBtn === "explain"} onClick={onExplain} disabled={disabled || !!loadingBtn} />
      <ActionBtn label="Suggest correction" busy={loadingBtn === "suggest"} onClick={onSuggest} disabled={disabled || !!loadingBtn} />
      <span title={canCompare ? "" : "No servicer_update linked to this loan"}>
        <ActionBtn
          label="Compare sources"
          busy={loadingBtn === "compare"}
          onClick={onCompare}
          disabled={disabled || !!loadingBtn || !canCompare}
        />
      </span>
    </div>
  );
}

function ActionBtn({ label, busy, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 rounded-md border border-purple-300 bg-white px-3 py-1.5 text-xs font-medium text-purple-800 hover:bg-purple-100 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {busy && <Spinner size="sm" />}
      {label}
    </button>
  );
}

// ---------------- Suggestion table ----------------

function SuggestionTable({ suggestion, perField, setPerField, loan }) {
  const rows = Object.entries(suggestion);
  const patchField = (key, patch) => {
    setPerField((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  if (!rows.length) return <p className="text-xs text-slate-500">No field-level suggestion.</p>;

  return (
    <div className="mt-2 overflow-x-auto">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
            <th className="px-1 py-1">Include</th>
            <th className="px-1 py-1">Field</th>
            <th className="px-1 py-1">Current</th>
            <th className="px-1 py-1">Suggested</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map(([key, aiVal]) => {
            const row = perField[key] || { include: true, edited: null };
            const currentVal = loan?.[key];
            const isEdited = row.edited !== null && row.edited !== undefined && String(row.edited) !== String(aiVal);
            return (
              <tr key={key} className={row.include ? "" : "opacity-50"}>
                <td className="px-1 py-1">
                  <input
                    type="checkbox"
                    checked={row.include}
                    onChange={(e) => patchField(key, { include: e.target.checked })}
                  />
                </td>
                <td className="px-1 py-1 font-mono text-slate-700">{key}</td>
                <td className="px-1 py-1 font-mono text-slate-500">{formatVal(currentVal)}</td>
                <td className="px-1 py-1">
                  <input
                    type="text"
                    value={row.edited !== null && row.edited !== undefined ? row.edited : formatVal(aiVal)}
                    onChange={(e) => patchField(key, { edited: e.target.value, include: e.target.value === "" ? false : true })}
                    className={`w-full rounded border px-1 py-0.5 text-xs font-mono ${isEdited ? "border-amber-400 bg-amber-50" : "border-slate-300"}`}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DiffsTable({ diffs }) {
  return (
    <table className="mt-2 min-w-full text-xs">
      <thead>
        <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
          <th className="px-1 py-1">Field</th>
          <th className="px-1 py-1">Loan tape</th>
          <th className="px-1 py-1">Servicer</th>
          <th className="px-1 py-1">Fresher</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {diffs.map((d, i) => (
          <tr key={i}>
            <td className="px-1 py-1 font-mono text-slate-700">{d.field}</td>
            <td className="px-1 py-1 font-mono text-slate-600">{formatVal(d.loanTapeValue)}</td>
            <td className="px-1 py-1 font-mono text-slate-600">{formatVal(d.servicerValue)}</td>
            <td className="px-1 py-1">
              <Badge tone={d.fresher === "servicer" ? "emerald" : d.fresher === "loanTape" ? "blue" : "slate"}>
                {d.fresher}
              </Badge>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ConfidenceBar({ value }) {
  const pct = typeof value === "number" ? Math.round(value * 100) : 0;
  const color = pct >= 70 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-slate-400";
  return (
    <div className="mt-2 flex items-center gap-2">
      <span className="text-[11px] uppercase tracking-wide text-slate-500">Confidence</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 text-right text-xs font-mono text-slate-600">{pct}%</span>
    </div>
  );
}

// ---------------- Decision bar + modal ----------------

function DecisionBar({ derived, onAcceptAsIs, onEditAccept, onReject }) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-purple-300 bg-purple-100/60 p-2">
      <p className="text-xs text-purple-900">
        {derived.changed
          ? "You've edited the suggestion — accept your edits or reject the whole thing."
          : "Accept the AI as-is, or edit before applying."}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onAcceptAsIs}>Accept as-is</Button>
        <Button size="sm" variant="secondary" onClick={onEditAccept} disabled={!derived.changed}>
          Edit & Accept
        </Button>
        <Button size="sm" variant="ghost" onClick={onReject}>Reject Suggestion</Button>
      </div>
    </div>
  );
}

function ConfirmModal({ action, derived, suggestion, onConfirm, onCancel }) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const summary =
    action === "accept_ai" ? { title: "Accept AI as-is", detail: suggestion } :
    action === "edit_ai" ? { title: "Apply edited fields", detail: derived.willApply } :
    { title: "Reject AI suggestion", detail: null };

  const run = async () => {
    setBusy(true);
    try { await onConfirm(comment); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-4 shadow-xl">
        <h3 className="text-sm font-semibold text-slate-900">{summary.title}</h3>
        {summary.detail && (
          <pre className="mt-2 max-h-40 overflow-auto rounded bg-slate-50 p-2 text-xs text-slate-700">
{JSON.stringify(summary.detail, null, 2)}
          </pre>
        )}
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Reviewer comment (optional)…"
          rows={2}
          className="mt-2 w-full rounded border border-slate-300 px-2 py-1 text-xs"
        />
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={run} disabled={busy}>
            {busy ? <Spinner size="sm" /> : "Confirm"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------- History ----------------

function HistorySection({ open, toggle, history, onOpenEntry }) {
  return (
    <section className="mt-3">
      <button
        type="button"
        onClick={toggle}
        className="text-[11px] font-semibold uppercase tracking-wide text-purple-700 hover:text-purple-900"
      >
        {open ? "▾" : "▸"} AI history ({history.length})
      </button>
      {open && (
        <div className="mt-2 overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
                <th className="px-2 py-1">Template</th>
                <th className="px-2 py-1">Model</th>
                <th className="px-2 py-1">Confidence</th>
                <th className="px-2 py-1">Fallback</th>
                <th className="px-2 py-1">Decision</th>
                <th className="px-2 py-1">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {history.length === 0 && (
                <tr><td colSpan={6} className="px-2 py-2 text-slate-500">No AI calls yet on this exception.</td></tr>
              )}
              {history.map((h) => (
                <tr key={h.recommendationId} className="cursor-pointer hover:bg-purple-50" onClick={() => onOpenEntry(h.recommendationId)}>
                  <td className="px-2 py-1 font-mono text-slate-700">{h.templateName}</td>
                  <td className="px-2 py-1 font-mono text-slate-600">{truncMiddle(h.model || "-", 16, 4)}</td>
                  <td className="px-2 py-1">{h.confidence != null ? `${Math.round(h.confidence * 100)}%` : "—"}</td>
                  <td className="px-2 py-1">{h.fallbackUsed ? "yes" : "no"}</td>
                  <td className="px-2 py-1">{h.decisionAction || <span className="text-slate-400">—</span>}</td>
                  <td className="px-2 py-1"><RelativeTime iso={h.createdAt} className="text-slate-500" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function HistoryDrawer({ recId, onClose }) {
  const [rec, setRec] = useState(null);
  useEffect(() => {
    apiGet(`/ai/recommendations?limit=100`).then((r) => {
      const found = (r.items || []).find((i) => String(i._id) === String(recId));
      setRec(found || null);
    }).catch(() => {});
  }, [recId]);

  const promptSnapshot = rec?.promptSnapshot ? tryParseJson(rec.promptSnapshot) : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={onClose}>
      <aside className="w-full max-w-2xl overflow-y-auto bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between border-b border-slate-200 pb-2">
          <h3 className="text-sm font-semibold text-slate-900">AI recommendation detail</h3>
          <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-800">Close</button>
        </header>
        {!rec && <div className="p-4"><Spinner label="Loading" /></div>}
        {rec && (
          <div className="mt-3 space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-y-1">
              <span className="text-slate-500">templateName</span><span className="font-mono">{rec.templateName}</span>
              <span className="text-slate-500">model</span><span className="font-mono">{rec.model}</span>
              <span className="text-slate-500">confidence</span><span>{rec.confidence}</span>
              <span className="text-slate-500">fallbackUsed</span><span>{String(rec.fallbackUsed)}</span>
              <span className="text-slate-500">latency</span><span>{rec.providerLatencyMs} ms</span>
            </div>
            {promptSnapshot && (
              <details open>
                <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-600">Prompt snapshot</summary>
                <pre className="mt-1 max-h-64 overflow-auto rounded bg-slate-50 p-2 text-[11px] text-slate-700">
{promptSnapshot.system ? `# SYSTEM\n${promptSnapshot.system}\n\n# USER\n${promptSnapshot.user}` : JSON.stringify(promptSnapshot, null, 2)}
                </pre>
              </details>
            )}
            <details open>
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-600">Output</summary>
              <pre className="mt-1 max-h-64 overflow-auto rounded bg-slate-50 p-2 text-[11px] text-slate-700">
{JSON.stringify(rec.output, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </aside>
    </div>
  );
}

// ---------------- helpers ----------------

function seedPerFieldFromSuggestion(rec, loan, setPerField) {
  const suggestion = rec?.output?.suggestedFields || {};
  const next = {};
  for (const k of Object.keys(suggestion)) next[k] = { include: true, edited: null };
  setPerField(next);
}

function formatVal(v) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function coerce(edited, refVal) {
  const s = String(edited).trim();
  if (s === "") return null;
  if (typeof refVal === "number") {
    const n = Number(s);
    if (Number.isFinite(n)) return n;
    return s;
  }
  return s;
}

function looseEq(a, b) {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return String(a) === String(b);
}

function tryParseJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

// eslint-disable-next-line no-unused-vars
async function fetchNote({ loanId, exceptionIds, decisionAction }) {
  return apiPost("/ai/note", { loanId, exceptionIds, decisionAction });
}
export { fetchNote as _fetchNote };
