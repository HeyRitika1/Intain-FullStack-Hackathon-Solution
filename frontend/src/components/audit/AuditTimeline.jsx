import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../../lib/api.js";
import { copyToClipboard, truncMiddle } from "../../lib/format.js";
import { toast } from "../ui/Toast.jsx";
import Badge from "../ui/Badge.jsx";
import Button from "../ui/Button.jsx";
import Spinner from "../ui/Spinner.jsx";
import RelativeTime from "../RelativeTime.jsx";
import AiRecordDrawer from "./AiRecordDrawer.jsx";

const EVENT_META = {
  upload:             { label: "Upload",             tag: "UP", tone: "slate"   },
  import:             { label: "Import",             tag: "IM", tone: "slate"   },
  normalize:          { label: "Normalize",          tag: "NR", tone: "slate"   },
  validate:           { label: "Validate",           tag: "VA", tone: "blue"    },
  exception_created:  { label: "Exception created",  tag: "!!", tone: "red"     },
  ai_recommendation:  { label: "AI recommendation",  tag: "AI", tone: "purple"  },
  comment:            { label: "Comment",            tag: "CM", tone: "slate"   },
  field_edit:         { label: "Field edit",         tag: "FE", tone: "amber"   },
  decision:           { label: "Decision",           tag: "DC", tone: "amber"   },
  verified:           { label: "Verified",           tag: "OK", tone: "emerald" },
  exported:           { label: "Exported",           tag: "EX", tone: "slate"   },
};
const ALL_TYPES = Object.keys(EVENT_META);

const TAG_TONE_CLS = {
  slate:   "bg-slate-200  text-slate-800",
  blue:    "bg-blue-200   text-blue-900",
  red:     "bg-red-200    text-red-900",
  purple:  "bg-purple-200 text-purple-900",
  amber:   "bg-amber-200  text-amber-900",
  emerald: "bg-emerald-200 text-emerald-900",
};

export default function AuditTimeline({ loanId, compact = false, maxHeight = null, standaloneLink = null }) {
  const [data, setData] = useState(null);
  const [reload, setReload] = useState(0);
  const [oldestFirst, setOldestFirst] = useState(false);
  const [typeFilter, setTypeFilter] = useState([]);
  const [drawerRecId, setDrawerRecId] = useState(null);

  useEffect(() => {
    if (!loanId) return;
    let cancelled = false;
    setData(null);
    apiGet(`/audit/${encodeURIComponent(loanId)}`)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((err) => { if (!cancelled) toast.error(`Load failed: ${err.message}`); });
    return () => { cancelled = true; };
  }, [loanId, reload]);

  const displayItems = useMemo(() => {
    const items = data?.items || [];
    const filtered = typeFilter.length ? items.filter((e) => typeFilter.includes(e.type)) : items;
    const sorted = oldestFirst ? filtered : [...filtered].reverse();
    return { items: sorted, totalRaw: items.length };
  }, [data, typeFilter, oldestFirst]);

  if (!loanId) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
        Pick a loan to view its audit trail.
      </div>
    );
  }
  if (!data) return <Spinner label="Loading timeline" />;

  const capped = compact ? displayItems.items.slice(0, 15) : displayItems.items;
  const truncated = compact && displayItems.items.length > 15;

  return (
    <div className={`rounded-lg border border-slate-200 bg-white ${maxHeight ? "overflow-y-auto" : ""}`} style={maxHeight ? { maxHeight } : undefined}>
      <ChainIntegrityBanner data={data} />

      {!compact && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2 text-xs">
          <TypeFilter typeFilter={typeFilter} setTypeFilter={setTypeFilter} counts={countsByType(data.items)} />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOldestFirst((v) => !v)}
              className="rounded border border-slate-300 bg-white px-2 py-0.5 text-slate-700 hover:bg-slate-50"
            >
              {oldestFirst ? "Newest first" : "Oldest first"}
            </button>
            <Button size="sm" variant="secondary" onClick={() => exportBlob(loanId, data)}>Export events</Button>
            <Button size="sm" variant="ghost" onClick={() => setReload((n) => n + 1)}>Refresh</Button>
          </div>
        </div>
      )}

      <ul role="list" className="space-y-0">
        {capped.map((e, i) => (
          <EventCard key={String(e._id)} event={e} index={i} onOpenAi={setDrawerRecId} loanId={loanId} />
        ))}
      </ul>

      {capped.length === 0 && (
        <div className="p-4 text-center text-xs text-slate-500">No events match the current filters.</div>
      )}

      {truncated && (
        <div className="border-t border-slate-100 px-4 py-2 text-right text-xs">
          <a
            href={standaloneLink || `/consumer/audit?loanId=${encodeURIComponent(loanId)}`}
            className="text-blue-700 hover:underline"
          >
            View full timeline ({displayItems.items.length - 15} more) →
          </a>
        </div>
      )}

      {drawerRecId && (
        <AiRecordDrawer recId={drawerRecId} onClose={() => setDrawerRecId(null)} />
      )}
    </div>
  );
}

// ---------------- chain integrity banner ----------------

function ChainIntegrityBanner({ data }) {
  const { ok, brokenAtIndex, totalEvents, reason } = data;
  if (ok) {
    return (
      <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">
        <span className="mr-2 font-semibold">Chain integrity: verified.</span>
        {totalEvents} events, all hashes chain correctly.
      </div>
    );
  }
  return (
    <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-900">
      <span className="mr-2 font-semibold">Chain integrity: BROKEN.</span>
      Event #{brokenAtIndex + 1} of {totalEvents} · {reason || "hash mismatch"}. Any change to earlier history would break this link.
    </div>
  );
}

// ---------------- filter chips ----------------

function TypeFilter({ typeFilter, setTypeFilter, counts }) {
  const toggle = (t) => {
    setTypeFilter((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  };
  return (
    <div className="flex flex-wrap gap-1">
      {ALL_TYPES.filter((t) => (counts[t] || 0) > 0).map((t) => {
        const active = typeFilter.includes(t);
        const meta = EVENT_META[t];
        return (
          <button
            key={t}
            type="button"
            onClick={() => toggle(t)}
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${active ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-100"}`}
          >
            {meta.label} ({counts[t] || 0})
          </button>
        );
      })}
      {typeFilter.length > 0 && (
        <button type="button" onClick={() => setTypeFilter([])} className="text-[11px] text-slate-500 hover:underline">
          clear
        </button>
      )}
    </div>
  );
}

function countsByType(items) {
  const out = {};
  for (const e of items || []) out[e.type] = (out[e.type] || 0) + 1;
  return out;
}

// ---------------- event card ----------------

function EventCard({ event: e, index, onOpenAi, loanId }) {
  const [open, setOpen] = useState(false);
  const meta = EVENT_META[e.type] || { label: e.type, tag: "??", tone: "slate" };
  const tagCls = TAG_TONE_CLS[meta.tone] || TAG_TONE_CLS.slate;
  const title = renderTitle(e);

  return (
    <li
      role="listitem"
      tabIndex={0}
      className="grid grid-cols-[36px_1fr] gap-3 border-t border-slate-100 px-4 py-3 first:border-t-0 focus:bg-slate-50"
    >
      <div className="relative flex flex-col items-center">
        <span aria-hidden="true" className="absolute top-6 h-full w-px bg-slate-200" />
        <span className={`z-10 flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-bold ${tagCls}`}>
          {meta.tag}
        </span>
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm text-slate-800">{title}</span>
          <RelativeTime iso={e.timestamp} className="text-xs text-slate-500" />
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
          <span className="font-mono">{meta.label}</span>
          {e.actorUser ? (
            <>
              <span>·</span>
              <span>{e.actorUser.name || e.actorUser.email}</span>
              <Badge tone="slate">{e.actorUser.role}</Badge>
            </>
          ) : (
            <>
              <span>·</span>
              <Badge tone="slate">{e.actorRole || "system"}</Badge>
            </>
          )}
        </div>

        <SpecificRendering event={e} onOpenAi={onOpenAi} loanId={loanId} />

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-2 text-[11px] text-slate-500 hover:text-slate-800"
        >
          {open ? "▾" : "▸"} Payload + hash
        </button>
        {open && (
          <div className="mt-2 space-y-1 rounded bg-slate-50 p-2 text-[11px]">
            <pre className="max-h-64 overflow-auto text-slate-700">
{JSON.stringify(e.payload, null, 2)}
            </pre>
            <HashLine label="prevHash" value={e.prevHash} />
            <HashLine label="hash" value={e.hash} />
          </div>
        )}
      </div>
    </li>
  );
}

function HashLine({ label, value }) {
  const copy = async () => {
    const ok = await copyToClipboard(value);
    toast[ok ? "info" : "error"](ok ? `${label} copied` : "copy failed");
  };
  return (
    <div className="flex items-center gap-2 font-mono text-slate-600">
      <span className="text-slate-400">{label}:</span>
      <span title={value}>{truncMiddle(value || "", 8, 8)}</span>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label}`}
        className="rounded border border-slate-200 px-1 text-[9px] text-slate-500 hover:bg-white"
      >
        copy
      </button>
    </div>
  );
}

function renderTitle(e) {
  const p = e.payload || {};
  switch (e.type) {
    case "ai_recommendation":
      return `AI recommendation: ${p.templateName || "?"}${p.fallbackUsed ? " (fallback" : " ("}${typeof p.confidence === "number" ? `, confidence ${Math.round(p.confidence * 100)}%` : ""})`;
    case "field_edit":
      return `Field edit${p.field ? `: ${p.field}` : ""}${p.viaAction ? ` via ${p.viaAction}` : ""}`;
    case "decision":
      return `Decision${p.action ? `: ${p.action}` : p.subType ? `: ${p.subType}` : ""}${p.resolutionType ? ` (${p.resolutionType})` : ""}`;
    case "exception_created":
      return `Exception created: ${p.ruleId || "?"}${p.severity ? ` (${p.severity})` : ""}`;
    case "validate":
      return `Validation run: ${p.rulesRun || 0} rules · ${p.matchedRuleIds?.length || 0} matched`;
    case "verified":
      return `Verified · trust score ${p.trustScore ?? "?"}`;
    case "upload":
      return `Upload: ${p.fileType || "?"} · ${p.rowCount ?? "?"} rows`;
    case "import":
      return `Import: ${p.fileType || "?"}`;
    case "comment":
      return `Comment${p.comment ? `: "${String(p.comment).slice(0, 60)}"` : ""}`;
    default:
      return e.type;
  }
}

// ---------------- type-specific mini renders ----------------

function SpecificRendering({ event, onOpenAi, loanId }) {
  const p = event.payload || {};
  if (event.type === "field_edit" && p.before && p.after) {
    const before = p.before;
    const after = p.after;
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return (
      <div className="mt-2 overflow-x-auto rounded border border-amber-200 bg-amber-50 p-1">
        <table className="min-w-full text-[11px]">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="px-1">field</th>
              <th className="px-1">before</th>
              <th className="px-1">after</th>
            </tr>
          </thead>
          <tbody>
            {[...keys].map((k) => (
              <tr key={k}>
                <td className="px-1 font-mono">{k}</td>
                <td className="px-1 font-mono text-slate-600">{formatVal(before?.[k])}</td>
                <td className="px-1 font-mono text-slate-900">{formatVal(after?.[k])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (event.type === "ai_recommendation") {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
        {p.model && <span className="rounded bg-purple-100 px-2 py-0.5 font-mono text-purple-800">{p.model}</span>}
        {typeof p.confidence === "number" && (
          <span className="rounded bg-slate-100 px-2 py-0.5">confidence {Math.round(p.confidence * 100)}%</span>
        )}
        {p.fallbackUsed && <Badge tone="amber">fallback</Badge>}
        {p.recommendationId && (
          <button
            type="button"
            onClick={() => onOpenAi(p.recommendationId)}
            className="text-purple-800 hover:underline"
          >
            View full AI record →
          </button>
        )}
      </div>
    );
  }
  if (event.type === "verified") {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
        {p.recordHash && (
          <span className="rounded bg-emerald-100 px-2 py-0.5 font-mono text-emerald-800">
            recordHash: {truncMiddle(p.recordHash, 8, 8)}
          </span>
        )}
        <a
          href={`/api/verified/${encodeURIComponent(loanId)}`}
          target="_blank" rel="noreferrer"
          className="text-emerald-800 hover:underline"
        >
          GET /api/verified/{loanId} →
        </a>
      </div>
    );
  }
  return null;
}

function formatVal(v) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10);
  return String(v);
}

// ---------------- export ----------------

function exportBlob(loanId, data) {
  const payload = { loanId, exportedAt: new Date().toISOString(), ...data };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audit-${loanId}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
