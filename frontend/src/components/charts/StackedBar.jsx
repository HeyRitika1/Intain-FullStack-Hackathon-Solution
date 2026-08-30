// Single horizontal stacked bar with segment tooltips.
// Props: { segments: [{ label, value, color }], height?, total?, format? }

export default function StackedBar({ segments = [], height = 26, total, format = (v) => v }) {
  const filtered = segments.filter((s) => (s.value || 0) > 0);
  const sum = total ?? filtered.reduce((n, s) => n + (s.value || 0), 0);
  if (!sum) {
    return <div className="grid place-items-center py-3 text-xs text-slate-400">No data</div>;
  }
  return (
    <div>
      <div className="flex h-full w-full overflow-hidden rounded-md border border-slate-200 bg-slate-100" style={{ height }}>
        {filtered.map((s, i) => {
          const pct = (s.value / sum) * 100;
          return (
            <div
              key={s.label + i}
              className="group relative flex items-center justify-center text-[10px] font-semibold text-white transition hover:brightness-110"
              style={{ width: `${pct}%`, backgroundColor: s.color || "#3b82f6" }}
              title={`${s.label}: ${format(s.value)} (${pct.toFixed(0)}%)`}
            >
              {pct >= 10 && <span>{format(s.value)}</span>}
              <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] text-white shadow group-hover:block">
                {s.label}: {format(s.value)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-slate-600">
        {segments.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: s.color || "#3b82f6" }} />
            {s.label}: <span className="font-mono">{format(s.value || 0)}</span>
          </span>
        ))}
        <span className="ml-auto font-mono text-slate-500">total {format(sum)}</span>
      </div>
    </div>
  );
}
