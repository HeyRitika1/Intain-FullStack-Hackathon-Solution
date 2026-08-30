import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPost } from "../../lib/api.js";
import { relativeTime } from "../../lib/format.js";
import { toast } from "../ui/Toast.jsx";
import Button from "../ui/Button.jsx";
import Badge from "../ui/Badge.jsx";
import Spinner from "../ui/Spinner.jsx";
import TrustScoreBadge from "../TrustScoreBadge.jsx";

const EXAMPLE_CHIPS = [
  "Show all Texas loans past due more than 60 days",
  "Loans with trust score below 80",
  "Verified loans updated in the last 30 days",
  "Top 10 loans by current balance",
];

// SECURITY MICROCOPY: Results always draw from the append-only
// VerifiedLoanRecord ledger. Unverified data never reaches this endpoint.

export default function ConversePanel({ compact = false, showHistory = true }) {
  const [nl, setNl] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState(null);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const loadHistory = () => apiGet("/converse/history?limit=10").then((r) => setHistory(r.items || [])).catch(() => setHistory([]));
  useEffect(() => { if (showHistory) loadHistory(); }, [showHistory]);

  const ask = async (text) => {
    const q = (text ?? nl).trim();
    if (!q) return;
    setBusy(true); setError(null); setAnswer(null);
    try {
      const r = await apiPost("/converse", { naturalLanguage: q });
      setAnswer(r);
      if (r.fallbackMode) toast.info("The parser didn't recognize that query — try an example below.");
      loadHistory();
    } catch (e) {
      const details = e.data;
      // eslint-disable-next-line no-console
      console.warn("[converse] rejected", { error: e.message, offending: details?.offending });
      setError({
        userMessage: "That query couldn't be safely translated. Try one of these examples ↓",
        offending: details?.offending,
      });
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); ask(); }
  };

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      {!compact && (
        <div>
          <h1 className="text-lg font-semibold text-emerald-900">Converse with your verified data.</h1>
          <p className="text-xs text-slate-500">
            Ask questions in plain English. Results always draw from verified records only.
          </p>
        </div>
      )}

      <div className={compact ? "" : "rounded-lg border border-slate-200 bg-white p-3 shadow-sm"}>
        <div className="flex flex-wrap items-end gap-2">
          <textarea
            value={nl}
            onChange={(e) => setNl(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="e.g. Show all Texas loans past due more than 60 days"
            rows={compact ? 2 : 3}
            className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm shadow-inner focus:border-emerald-500 focus:outline-none"
          />
          <Button onClick={() => ask()} disabled={busy || !nl.trim()}>
            {busy ? "Asking…" : "Ask"}
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {EXAMPLE_CHIPS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => { setNl(c); ask(c); }}
              className="rounded-full border border-slate-300 bg-white px-2.5 py-0.5 text-[11px] text-slate-700 hover:border-emerald-400 hover:bg-emerald-50"
            >
              {c}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-slate-500">Ctrl/Cmd+Enter to submit. All results come from verified loans only.</p>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error.userMessage}
        </div>
      )}

      {answer && (
        <div className={`grid gap-4 ${compact ? "" : "lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]"}`}>
          <ResultsPanel answer={answer} compact={compact} />
          {!compact && <AiTracePanel answer={answer} />}
        </div>
      )}

      {compact && answer && <AiTracePanel answer={answer} compact />}

      {showHistory && (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs">
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            className="flex w-full items-center justify-between text-left font-semibold text-slate-700"
          >
            <span>Recent queries {history ? `(${history.length})` : ""}</span>
            <span>{historyOpen ? "▾" : "▸"}</span>
          </button>
          {historyOpen && (
            <div className="mt-2 space-y-1">
              {history === null && <Spinner label="Loading" />}
              {history && history.length === 0 && <p className="text-slate-500">No history yet.</p>}
              {history && history.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => { setNl(h.naturalLanguage); ask(h.naturalLanguage); }}
                  className="block w-full rounded px-2 py-1 text-left hover:bg-white"
                >
                  <div className="truncate text-slate-800">{h.naturalLanguage || <em>(empty)</em>}</div>
                  <div className="text-[10px] text-slate-500">{relativeTime(h.createdAt)} · {h.humanSummary}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ResultsPanel({ answer, compact }) {
  const rows = answer.results || [];
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-slate-100 px-4 py-2 text-xs">
        <span className="font-semibold text-slate-800">Results</span>
        <span className="text-slate-500">{rows.length} loan{rows.length === 1 ? "" : "s"} · verified only</span>
      </header>
      {rows.length === 0 ? (
        <div className="p-4 text-sm text-slate-500">
          No verified loans match. If you expected results, remember only <span className="font-semibold">verified</span> loans are queryable here.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-slate-500">
              <tr className="border-b border-slate-100">
                <th className="px-2 py-2 text-left">Loan ID</th>
                <th className="px-2 py-2 text-left">Borrower</th>
                <th className="px-2 py-2 text-left">State</th>
                <th className="px-2 py-2 text-right">Balance</th>
                <th className="px-2 py-2 text-right">DPD</th>
                <th className="px-2 py-2 text-center">Trust</th>
                <th className="px-2 py-2 text-left">Verified</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.loanId} className="border-b border-slate-50 hover:bg-emerald-50/40">
                  <td className="px-2 py-2 font-mono text-xs">
                    <Link to={`/consumer/verified/${encodeURIComponent(r.loanId)}`} className="text-emerald-700 underline hover:text-emerald-900">
                      {r.loanId}
                    </Link>
                  </td>
                  <td className="px-2 py-2 text-xs">{r.snapshot?.borrowerName || "—"}</td>
                  <td className="px-2 py-2 font-mono text-xs">{r.snapshot?.state || "—"}</td>
                  <td className="px-2 py-2 text-right font-mono">{fmtMoney(r.snapshot?.currentBalance)}</td>
                  <td className="px-2 py-2 text-right font-mono">{r.snapshot?.daysPastDue ?? "—"}</td>
                  <td className="px-2 py-2">
                    <div className="flex justify-center">
                      <TrustScoreBadge score={r.trustScore} breakdown={r.trustBreakdown} size="sm" />
                    </div>
                  </td>
                  <td className="px-2 py-2 text-xs text-slate-600">{relativeTime(r.verifiedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AiTracePanel({ answer, compact = false }) {
  return (
    <div className={`rounded-lg border border-purple-200 bg-purple-50/40 shadow-sm ${compact ? "" : "self-start"}`}>
      <header className="flex flex-wrap items-center gap-2 border-b border-purple-100 px-4 py-2 text-xs">
        <span className="font-semibold text-purple-900">AI trace</span>
        <Badge tone="purple">{answer.model}</Badge>
        {answer.fallbackUsed && <Badge tone="amber">fallback</Badge>}
      </header>
      <div className="space-y-3 px-4 py-3 text-xs">
        {answer.humanSummary && (
          <div>
            <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-purple-700">Interpretation</div>
            <p className="text-slate-800">{answer.humanSummary}</p>
          </div>
        )}
        <div>
          <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-purple-700">Translated Mongo filter</div>
          <pre className="overflow-x-auto rounded bg-white p-2 font-mono text-[11px] text-slate-800 shadow-inner">{JSON.stringify(answer.mongoFilter || {}, null, 2)}</pre>
          {answer.sort && (
            <pre className="mt-1 overflow-x-auto rounded bg-white p-2 font-mono text-[10px] text-slate-700 shadow-inner">sort: {JSON.stringify(answer.sort)} · limit: {answer.limit}</pre>
          )}
        </div>
        {typeof answer.confidence === "number" && (
          <div>
            <div className="mb-0.5 flex items-baseline justify-between text-[10px] uppercase tracking-wide text-purple-700">
              <span>Confidence</span>
              <span className="font-mono text-slate-700">{Math.round(answer.confidence * 100)}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-purple-100">
              <div className="h-full bg-purple-500" style={{ width: `${Math.round(answer.confidence * 100)}%` }} />
            </div>
          </div>
        )}
        {(answer.involvedFields?.length > 0) && (
          <div>
            <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-purple-700">Fields</div>
            <div className="flex flex-wrap gap-1">
              {answer.involvedFields.map((f) => (
                <span key={f} className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-700">{f}</span>
              ))}
            </div>
          </div>
        )}
        <p className="text-[10px] text-purple-700/70">
          Filter runs against <span className="font-mono">VerifiedLoanRecord</span> only — unverified loans are never reachable through Converse.
        </p>
      </div>
    </div>
  );
}

function fmtMoney(n) {
  if (!Number.isFinite(Number(n))) return "—";
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}
