import { useMemo, useState } from "react";

const SIZE = { sm: 32, md: 56, lg: 88 };
const STROKE = { sm: 4, md: 7, lg: 10 };
const FONT = { sm: 12, md: 18, lg: 26 };

const BAND_COLOR = (s) => (s >= 85 ? "text-emerald-600" : s >= 70 ? "text-amber-600" : "text-red-600");
const BAND_STROKE = (s) => (s >= 85 ? "stroke-emerald-500" : s >= 70 ? "stroke-amber-500" : "stroke-red-500");

export default function TrustScoreBadge({ score, breakdown, notes = [], size = "md", label = "Trust" }) {
  const [hovering, setHovering] = useState(false);
  const s = Number.isFinite(Number(score)) ? Math.max(0, Math.min(100, Number(score))) : null;
  const px = SIZE[size] || SIZE.md;
  const stroke = STROKE[size] || STROKE.md;
  const font = FONT[size] || FONT.md;
  const r = (px - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = s === null ? 0 : (s / 100) * c;

  return (
    <div className="relative inline-block" onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}>
      <svg width={px} height={px} viewBox={`0 0 ${px} ${px}`} role="img" aria-label={`${label} score ${s ?? "n/a"}`}>
        <circle
          cx={px / 2} cy={px / 2} r={r}
          fill="none" stroke="currentColor" strokeWidth={stroke}
          className="text-slate-200"
        />
        {s !== null && (
          <circle
            cx={px / 2} cy={px / 2} r={r}
            fill="none" strokeWidth={stroke} strokeLinecap="round"
            className={BAND_STROKE(s)}
            strokeDasharray={`${dash} ${c - dash}`}
            transform={`rotate(-90 ${px / 2} ${px / 2})`}
          />
        )}
        <text
          x="50%" y="50%" textAnchor="middle" dominantBaseline="central"
          fontSize={font} fontWeight="600"
          className={s === null ? "fill-slate-400" : BAND_COLOR(s).replace("text-", "fill-")}
        >
          {s === null ? "—" : s}
        </text>
      </svg>

      {hovering && (breakdown || notes.length) && (
        <TrustPopover breakdown={breakdown} notes={notes} score={s} />
      )}
    </div>
  );
}

function TrustPopover({ breakdown, notes, score }) {
  const rows = useMemo(
    () => [
      ["Completeness", breakdown?.completeness],
      ["Consistency", breakdown?.consistency],
      ["Freshness", breakdown?.freshness],
      ["Review coverage", breakdown?.reviewCoverage],
    ],
    [breakdown]
  );
  return (
    <div className="absolute left-1/2 top-full z-30 mt-1 w-72 -translate-x-1/2 rounded-md border border-slate-200 bg-white p-3 text-xs shadow-xl">
      <div className="flex items-baseline justify-between border-b border-slate-100 pb-1">
        <span className="font-semibold text-slate-800">Trust breakdown</span>
        <span className={`font-mono ${BAND_COLOR(score)}`}>{score ?? "—"}</span>
      </div>
      <div className="mt-2 space-y-1">
        {rows.map(([label, v]) => (
          <MiniBar key={label} label={label} value={v} />
        ))}
      </div>
      {notes.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] text-slate-600">
          {notes.slice(0, 5).map((n, i) => <li key={i}>{n}</li>)}
          {notes.length > 5 && <li className="text-slate-400">+{notes.length - 5} more…</li>}
        </ul>
      )}
    </div>
  );
}

function MiniBar({ label, value }) {
  const v = Number.isFinite(Number(value)) ? Number(value) : 0;
  const cls = v >= 85 ? "bg-emerald-500" : v >= 70 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="grid grid-cols-[110px_1fr_28px] items-center gap-2">
      <span className="text-slate-500">{label}</span>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full ${cls}`} style={{ width: `${v}%` }} />
      </div>
      <span className="text-right font-mono text-slate-700">{value ?? "—"}</span>
    </div>
  );
}
