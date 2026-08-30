import { useEffect, useState } from "react";
import Spinner from "./ui/Spinner.jsx";

const TYPE_MAP = {
  string: "text",
  number: "number",
  date: "date",
};

export default function EditableField({
  label,
  name,
  value,
  type = "string",
  editable = true,
  options = null,
  onSave,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => stringifyForInput(value, type));
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(false);

  useEffect(() => {
    setDraft(stringifyForInput(value, type));
  }, [value, type]);

  const displayValue = renderDisplay(value, type);

  const cancel = () => {
    setEditing(false);
    setDraft(stringifyForInput(value, type));
  };

  const commit = async () => {
    if (!onSave || saving) return;
    let parsed;
    try {
      parsed = parseFromInput(draft, type);
    } catch (err) {
      return; // silent; the parent handles validation errors via toast on save
    }
    setSaving(true);
    try {
      await onSave(name, parsed);
      setEditing(false);
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 1500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)_auto] items-center gap-2 border-b border-slate-100 py-1.5 text-sm">
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`min-w-0 truncate ${editable ? "text-slate-900" : "text-slate-600"}`}>
        {editing ? (
          options ? (
            <select
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
            >
              {options.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          ) : (
            <input
              type={TYPE_MAP[type] || "text"}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") cancel();
              }}
              autoFocus
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
          )
        ) : (
          <span className="truncate" title={String(displayValue)}>{displayValue}</span>
        )}
      </dd>
      <div className="flex items-center gap-1 text-xs">
        {editable && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="text-slate-400 hover:text-slate-700" aria-label={`Edit ${label}`}>
            ✎
          </button>
        )}
        {editing && (
          <>
            <button type="button" onClick={commit} disabled={saving} className="rounded bg-slate-900 px-2 py-0.5 text-white hover:bg-slate-800 disabled:opacity-50">
              {saving ? <Spinner size="sm" /> : "Save"}
            </button>
            <button type="button" onClick={cancel} className="text-slate-500 hover:text-slate-800">
              ✕
            </button>
          </>
        )}
        {!editing && savedTick && <span className="text-emerald-600">✓</span>}
      </div>
    </div>
  );
}

function stringifyForInput(value, type) {
  if (value === null || value === undefined) return "";
  if (type === "date") {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
  }
  return String(value);
}

function parseFromInput(str, type) {
  const s = String(str).trim();
  if (s === "") return null;
  if (type === "number") {
    const n = Number(s);
    if (!Number.isFinite(n)) throw new Error("not a number");
    return n;
  }
  if (type === "date") {
    return s; // backend accepts ISO date string
  }
  return s;
}

function renderDisplay(value, type) {
  if (value === null || value === undefined || value === "") return "—";
  if (type === "date") {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toISOString().slice(0, 10);
  }
  return String(value);
}
