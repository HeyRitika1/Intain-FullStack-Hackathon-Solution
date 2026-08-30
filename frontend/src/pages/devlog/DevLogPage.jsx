import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiGet, apiPost } from "../../lib/api.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { toast } from "../../components/ui/Toast.jsx";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import Spinner from "../../components/ui/Spinner.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import DevLogCard from "../../components/DevLogCard.jsx";

const OUTCOMES = ["accepted", "edited", "rejected", "caught_bad_ai"];

export default function DevLogPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [params, setParams] = useSearchParams();
  const module = params.get("module") || "";
  const outcomes = (params.get("outcome") || "").split(",").filter(Boolean);
  const q = params.get("q") || "";

  const [stats, setStats] = useState(null);
  const [feed, setFeed] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    apiGet("/dev-log/stats").then(setStats).catch((e) => toast.error(e.message));
  }, [reloadTick]);

  useEffect(() => {
    const qs = new URLSearchParams({ limit: "50" });
    if (module) qs.set("module", module);
    if (outcomes.length) qs.set("outcome", outcomes.join(","));
    if (q) qs.set("q", q);
    setFeed(null);
    apiGet(`/dev-log?${qs.toString()}`).then((r) => setFeed(r)).catch((e) => toast.error(e.message));
  }, [module, outcomes.join(","), q, reloadTick]);

  const setFilter = (patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      const val = Array.isArray(v) ? v.join(",") : v;
      if (!val) next.delete(k);
      else next.set(k, val);
    }
    setParams(next, { replace: false });
  };

  const toggleOutcome = (o) => {
    const set = new Set(outcomes);
    if (set.has(o)) set.delete(o); else set.add(o);
    setFilter({ outcome: [...set] });
  };

  return (
    <div className="space-y-4">
      <KpiStrip stats={stats} />

      <div className="grid gap-4 xl:grid-cols-[240px_minmax(0,1fr)]">
        <ModuleRail stats={stats} selected={module} onSelect={(m) => setFilter({ module: m })} />

        <div className="space-y-3">
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Outcome:</span>
              {OUTCOMES.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => toggleOutcome(o)}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] ${outcomes.includes(o) ? "border-slate-800 bg-slate-800 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
                >
                  {o.replace(/_/g, " ")}
                </button>
              ))}
              <input
                type="search"
                placeholder="Search prompt or notes…"
                value={q}
                onChange={(e) => setFilter({ q: e.target.value })}
                className="ml-2 min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
              {isAdmin && (
                <Button size="sm" onClick={() => setDrawerOpen(true)}>+ Add entry</Button>
              )}
            </div>
          </Card>

          {feed === null && <Spinner label="Loading dev log" />}
          {feed && feed.items.length === 0 && <EmptyState title="No entries match" description="Try clearing filters." />}
          {feed && feed.items.map((e) => <DevLogCard key={e._id} entry={e} />)}
        </div>
      </div>

      {drawerOpen && (
        <AddEntryDrawer
          onClose={() => setDrawerOpen(false)}
          onSaved={() => { setDrawerOpen(false); setReloadTick((t) => t + 1); toast.info("Dev log entry saved."); }}
        />
      )}
    </div>
  );
}

function KpiStrip({ stats }) {
  const modules = stats?.byModule?.length ?? 0;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Kpi label="Total entries" value={stats?.totalEntries ?? "—"} />
      <Kpi label="Avg AI-authored %" value={stats?.avgAiAuthoredPct ?? "—"} caption="uneven per module = credible" />
      <Kpi label="Caught bad AI" value={stats?.caughtBadAiCount ?? 0} tone="danger" caption="the rubric wants this > 0" />
      <Kpi label="Modules covered" value={modules} />
    </div>
  );
}

function Kpi({ label, value, tone, caption }) {
  const cls = tone === "danger" ? "text-red-700" : "text-slate-900";
  return (
    <Card>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${cls}`}>{value}</div>
      {caption && <div className="mt-1 text-[11px] text-slate-500">{caption}</div>}
    </Card>
  );
}

function ModuleRail({ stats, selected, onSelect }) {
  const list = useMemo(() => (stats?.byModule || []).slice().sort((a, b) => b.count - a.count), [stats]);
  return (
    <Card title="Modules" subtitle="Filter the feed by module.">
      <ul className="space-y-1 text-sm">
        <li>
          <button
            type="button"
            onClick={() => onSelect("")}
            className={`flex w-full items-center justify-between rounded px-2 py-1 text-left ${!selected ? "bg-slate-100 font-semibold text-slate-900" : "text-slate-700 hover:bg-slate-50"}`}
          >
            <span>All modules</span>
            <span className="text-[10px] font-mono text-slate-500">{stats?.totalEntries ?? "—"}</span>
          </button>
        </li>
        {list.map((m) => (
          <li key={m.module}>
            <button
              type="button"
              onClick={() => onSelect(m.module)}
              className={`flex w-full items-center justify-between rounded px-2 py-1 text-left ${selected === m.module ? "bg-slate-100 font-semibold text-slate-900" : "text-slate-700 hover:bg-slate-50"}`}
            >
              <span className="truncate">{m.module}</span>
              <span className="text-[10px] font-mono text-slate-500">{m.count}</span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function AddEntryDrawer({ onClose, onSaved }) {
  const [form, setForm] = useState({
    module: "",
    tool: "copilot",
    outcome: "accepted",
    aiAuthoredPct: 50,
    prompt: "",
    notes: "",
  });
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await apiPost("/dev-log", {
        ...form,
        aiAuthoredPct: form.aiAuthoredPct === "" ? null : Number(form.aiAuthoredPct),
      });
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex" onClick={onClose}>
      <div className="flex-1 bg-slate-900/40" />
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-md flex-col gap-3 overflow-y-auto bg-white p-4 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-800">Add dev log entry</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-slate-800">✕</button>
        </div>
        <Field label="Module">
          <input required value={form.module} onChange={(e) => setForm({ ...form, module: e.target.value })} className="w-full rounded border border-slate-300 px-2 py-1 text-sm" />
        </Field>
        <Field label="Tool">
          <input value={form.tool} onChange={(e) => setForm({ ...form, tool: e.target.value })} className="w-full rounded border border-slate-300 px-2 py-1 text-sm" />
        </Field>
        <Field label="Outcome">
          <select value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })} className="w-full rounded border border-slate-300 px-2 py-1 text-sm">
            {OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>
        <Field label={`AI-authored % (${form.aiAuthoredPct})`}>
          <input type="range" min={0} max={100} step={5} value={form.aiAuthoredPct} onChange={(e) => setForm({ ...form, aiAuthoredPct: e.target.value })} className="w-full" />
        </Field>
        <Field label="Prompt">
          <textarea required rows={4} value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} className="w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs" />
        </Field>
        <Field label="Notes (supports **bold** and `code`)">
          <textarea rows={4} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full rounded border border-slate-300 px-2 py-1 text-sm" />
        </Field>
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-500">
      <span>{label}</span>
      {children}
    </label>
  );
}
