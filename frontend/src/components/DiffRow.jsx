import Badge from "./ui/Badge.jsx";

const FRESHER_TONE = { servicer: "emerald", loanTape: "blue", tie: "slate" };

export default function DiffRow({ diff, onUseLoanTape, onUseServicer, onManualEntry, busy = false, actionable = true }) {
  const { field, loanTapeValue, servicerValue, fresher, freshnessDelta } = diff;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-3 border-t border-slate-100 px-3 py-3 first:border-t-0">
      <Cell
        label="Loan tape"
        value={loanTapeValue}
        highlight={fresher === "loanTape"}
        fresherLabel={fresher === "loanTape" ? "fresher" : null}
      />
      <Cell
        label="Servicer update"
        value={servicerValue}
        highlight={fresher === "servicer"}
        fresherLabel={fresher === "servicer" ? "fresher" : null}
      />
      <div className="flex min-w-[240px] flex-col items-end gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{field}</span>
        {freshnessDelta && (
          <Badge tone={FRESHER_TONE[fresher] || "slate"} className="whitespace-nowrap">
            {freshnessDelta}
          </Badge>
        )}
        {actionable && (
          <div className="mt-1 flex flex-wrap justify-end gap-1">
            <button
              type="button"
              onClick={onUseLoanTape}
              disabled={busy}
              className="rounded border border-blue-300 bg-white px-2 py-0.5 text-[11px] font-medium text-blue-800 hover:bg-blue-50 disabled:opacity-50"
            >
              Use loan-tape
            </button>
            <button
              type="button"
              onClick={onUseServicer}
              disabled={busy}
              className="rounded border border-emerald-300 bg-white px-2 py-0.5 text-[11px] font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
            >
              Use servicer
            </button>
            <button
              type="button"
              onClick={onManualEntry}
              disabled={busy}
              className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              Manual…
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Cell({ label, value, highlight, fresherLabel }) {
  return (
    <div className={`rounded-md border p-2 ${highlight ? "border-emerald-300 bg-emerald-50/40" : "border-slate-200 bg-white"}`}>
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-slate-500">
        <span>{label}</span>
        {fresherLabel && <Badge tone="emerald">{fresherLabel}</Badge>}
      </div>
      <div className="mt-1 break-words font-mono text-sm text-slate-800">
        {value === null || value === undefined || value === "" ? "—" : formatCell(value)}
      </div>
    </div>
  );
}

function formatCell(v) {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
