export default function KeyValueList({ data, className = "" }) {
  if (!data || typeof data !== "object") return null;
  const entries = Object.entries(data).filter(([k]) => !k.startsWith("_"));
  if (!entries.length) return <p className="text-xs text-slate-400">No context values.</p>;
  return (
    <dl className={`grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-x-3 gap-y-1 text-xs ${className}`}>
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="truncate text-slate-500">{k}</dt>
          <dd className="break-words font-mono text-slate-800">{formatValue(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function formatValue(v) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
