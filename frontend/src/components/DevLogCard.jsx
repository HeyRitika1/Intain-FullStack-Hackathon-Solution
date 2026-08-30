import { useState } from "react";
import { relativeTime } from "../lib/format.js";
import Badge from "./ui/Badge.jsx";

const OUTCOME_TONE = {
  accepted: "emerald",
  edited: "amber",
  rejected: "slate",
  caught_bad_ai: "red",
};

const OUTCOME_LABEL = {
  accepted: "accepted",
  edited: "edited",
  rejected: "rejected",
  caught_bad_ai: "caught bad AI",
};

export default function DevLogCard({ entry, emphasize = false }) {
  const [expanded, setExpanded] = useState(false);
  const outcomeTone = OUTCOME_TONE[entry.outcome] || "slate";
  const isBad = entry.outcome === "caught_bad_ai";

  return (
    <article
      className={`rounded-lg border bg-white shadow-sm ${isBad ? "border-red-200 border-l-4 border-l-red-500" : "border-slate-200"} ${emphasize ? "ring-1 ring-red-100" : ""}`}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2 text-xs">
        <span className="font-semibold text-slate-800">{entry.module}</span>
        <Badge tone="blue">{entry.tool}</Badge>
        <Badge tone={outcomeTone}>{OUTCOME_LABEL[entry.outcome] || entry.outcome}</Badge>
        {entry.aiAuthoredPct != null && <AiGauge pct={entry.aiAuthoredPct} />}
        <span className="ml-auto text-slate-500" title={new Date(entry.date).toISOString()}>
          {relativeTime(entry.date)} · {new Date(entry.date).toLocaleDateString()}
        </span>
      </header>
      <div className="space-y-2 px-4 py-3 text-sm">
        <div>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-800"
            aria-expanded={expanded}
          >
            Prompt {expanded ? "▾" : "▸"}
          </button>
          <pre
            className={`mt-1 overflow-hidden whitespace-pre-wrap break-words rounded bg-slate-50 px-3 py-2 font-mono text-[11px] text-slate-700 ${expanded ? "" : "max-h-16"}`}
          >
            {entry.prompt}
          </pre>
        </div>
        {entry.notes && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Notes</div>
            <p className="mt-1 text-slate-700" dangerouslySetInnerHTML={{ __html: mdLite(entry.notes) }} />
          </div>
        )}
      </div>
    </article>
  );
}

function AiGauge({ pct }) {
  const v = Math.max(0, Math.min(100, Number(pct) || 0));
  const cls = v >= 75 ? "bg-purple-500" : v >= 50 ? "bg-blue-500" : v >= 25 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] text-slate-500" title={`AI-authored ~${v}%`}>
      <span className="h-1 w-14 overflow-hidden rounded-full bg-slate-200">
        <span className={`block h-full ${cls}`} style={{ width: `${v}%` }} />
      </span>
      <span className="font-mono">{v}%</span>
    </span>
  );
}

// Tiny **bold** + newline formatter. HTML-safe against the notes we authored.
function mdLite(str) {
  const esc = String(str).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  return esc
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-slate-900">$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="rounded bg-slate-100 px-1 text-[11px] font-mono">$1</code>')
    .replace(/\n/g, "<br/>");
}
