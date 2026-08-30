import { useEffect, useState } from "react";

const SUPPORTED_OPS = [
  "isEmpty", "notEmpty", "equals", "notEquals",
  "lt", "lte", "gt", "gte", "inSet", "notInSet",
  "dateBefore", "dateAfter", "olderThanDays", "regexMatch",
  "and", "or", "not",
  "crossFieldCompare", "existsInOtherSource", "conflictsWithOtherSource",
];

// Simple JSON textarea with Format + validation. Prompt 23 spec calls for a
// structured tree editor but flags it as non-essential; this ships the
// pragmatic version an admin can actually use in the demo.
export default function RuleExpressionEditor({ value, onChange, rows = 8 }) {
  const [text, setText] = useState(() => JSON.stringify(value || {}, null, 2));
  const [err, setErr] = useState(null);

  useEffect(() => {
    setText(JSON.stringify(value || {}, null, 2));
  }, [value]);

  const commit = (next) => {
    setText(next);
    try {
      const parsed = JSON.parse(next);
      setErr(null);
      onChange?.(parsed);
    } catch (e) {
      setErr(e.message);
    }
  };

  const format = () => {
    try {
      const parsed = JSON.parse(text);
      const pretty = JSON.stringify(parsed, null, 2);
      setText(pretty);
      setErr(null);
      onChange?.(parsed);
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-slate-500">
        <span>Expression (JSON)</span>
        <button type="button" onClick={format} className="rounded border border-slate-300 bg-white px-2 py-0.5 hover:bg-slate-50">Format</button>
      </div>
      <textarea
        value={text}
        onChange={(e) => commit(e.target.value)}
        rows={rows}
        spellCheck={false}
        className={`w-full rounded-md border px-2 py-1.5 font-mono text-xs shadow-inner focus:outline-none ${err ? "border-red-400 bg-red-50" : "border-slate-300 bg-white focus:border-slate-500"}`}
      />
      {err && <p className="text-[11px] text-red-700">Invalid JSON: {err}</p>}
      <p className="text-[10px] text-slate-500">
        Ops:{" "}
        {SUPPORTED_OPS.map((o, i) => (
          <span key={o}>
            <code className="rounded bg-slate-100 px-1">{o}</code>
            {i < SUPPORTED_OPS.length - 1 ? " " : ""}
          </span>
        ))}
      </p>
    </div>
  );
}
