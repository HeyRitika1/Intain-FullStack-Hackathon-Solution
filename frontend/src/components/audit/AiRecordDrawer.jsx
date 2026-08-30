import { useEffect, useState } from "react";
import { apiGet } from "../../lib/api.js";
import Spinner from "../ui/Spinner.jsx";
import Badge from "../ui/Badge.jsx";

export default function AiRecordDrawer({ recId, onClose }) {
  const [rec, setRec] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!recId) return;
    let cancelled = false;
    apiGet(`/ai/recommendations/${encodeURIComponent(recId)}`)
      .then((r) => { if (!cancelled) setRec(r.recommendation); })
      .catch((e) => { if (!cancelled) setErr(e.message || "Load failed"); });
    return () => { cancelled = true; };
  }, [recId]);

  const snapshot = rec?.promptSnapshot ? tryParseJson(rec.promptSnapshot) : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={onClose}>
      <aside className="w-full max-w-2xl overflow-y-auto bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between border-b border-slate-200 pb-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">AI recommendation record</h3>
            {rec && (
              <p className="mt-0.5 text-[11px] text-slate-500">
                {rec.templateName} · {rec.model} {rec.fallbackUsed && <Badge tone="amber">fallback</Badge>}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-800">Close</button>
        </header>

        {!rec && !err && <div className="p-4"><Spinner label="Loading" /></div>}
        {err && <div className="p-4 text-sm text-red-700">{err}</div>}

        {rec && (
          <div className="mt-3 space-y-3 text-xs">
            <dl className="grid grid-cols-2 gap-y-1">
              <dt className="text-slate-500">loanId</dt><dd className="font-mono">{rec.loanId || "—"}</dd>
              <dt className="text-slate-500">exceptionId</dt><dd className="font-mono">{rec.exceptionId || "—"}</dd>
              <dt className="text-slate-500">confidence</dt><dd>{typeof rec.confidence === "number" ? `${Math.round(rec.confidence * 100)}%` : "—"}</dd>
              <dt className="text-slate-500">latency</dt><dd>{rec.providerLatencyMs} ms</dd>
              <dt className="text-slate-500">createdAt</dt><dd>{new Date(rec.createdAt).toLocaleString()}</dd>
              {rec.sourceHint && (<><dt className="text-slate-500">sourceHint</dt><dd>{rec.sourceHint}</dd></>)}
            </dl>

            {snapshot && (
              <details open>
                <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Prompt snapshot
                </summary>
                <pre className="mt-1 max-h-72 overflow-auto rounded bg-slate-50 p-2 text-[11px] text-slate-700">
{snapshot.system
  ? `# SYSTEM\n${snapshot.system}\n\n# USER\n${snapshot.user}`
  : JSON.stringify(snapshot, null, 2)}
                </pre>
              </details>
            )}

            <details open>
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-600">Output</summary>
              <pre className="mt-1 max-h-72 overflow-auto rounded bg-slate-50 p-2 text-[11px] text-slate-700">
{JSON.stringify(rec.output, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </aside>
    </div>
  );
}

function tryParseJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}
