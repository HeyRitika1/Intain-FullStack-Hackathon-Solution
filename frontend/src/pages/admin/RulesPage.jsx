import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPatch, apiPost } from "../../lib/api.js";
import { relativeTime } from "../../lib/format.js";
import { toast } from "../../components/ui/Toast.jsx";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import Badge from "../../components/ui/Badge.jsx";
import Spinner from "../../components/ui/Spinner.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import RuleExpressionEditor from "../../components/RuleExpressionEditor.jsx";

const CHIPS = [
  "flag loans where the borrower name is missing",
  "flag loans where the interest rate is above 25 percent",
  "flag loans in California with a balance over 500,000",
];

const SEVERITIES = ["low", "medium", "high", "blocking"];

export default function RulesPage() {
  const [rules, setRules] = useState(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [draftMode, setDraftMode] = useState("ai"); // "ai" | "manual"

  const reload = () => setReloadTick((n) => n + 1);

  useEffect(() => {
    apiGet("/rules").then((r) => setRules(r.items || [])).catch((e) => toast.error(e.message));
  }, [reloadTick]);

  const pending = useMemo(() => (rules || []).filter((r) => r.origin === "ai_generated" && !r.approvedBy && !r.active), [rules]);
  const active = useMemo(() => (rules || []).filter((r) => r.active), [rules]);
  const deactivated = useMemo(() => (rules || []).filter((r) => !r.active && (r.approvedBy || r.origin !== "ai_generated")), [rules]);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Admin — validation rules</h1>
            <p className="text-xs text-slate-500">
              AI proposes, human approves. Draft a rule in plain English and preview how many loans it would match before you activate it.
              {" "}
              <Link to="/dev-log/caught-bad-ai" className="text-red-700 underline">See a caught bad rule →</Link>
            </p>
          </div>
          <div className="flex gap-1 rounded-md bg-slate-100 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setDraftMode("ai")}
              className={`rounded px-2 py-1 ${draftMode === "ai" ? "bg-white shadow" : "text-slate-500"}`}
            >Ask AI</button>
            <button
              type="button"
              onClick={() => setDraftMode("manual")}
              className={`rounded px-2 py-1 ${draftMode === "manual" ? "bg-white shadow" : "text-slate-500"}`}
            >Write manually</button>
          </div>
        </div>
      </Card>

      {draftMode === "ai" ? <AiDraftBox onSaved={reload} /> : <ManualDraftBox onSaved={reload} />}

      <RuleTable
        title="Pending rules"
        subtitle="AI-drafted rules awaiting an admin approve/reject."
        rules={pending}
        emptyText="No pending rules. Draft one above ↑."
        showApprove
        onChange={reload}
      />

      <RuleTable
        title="Active rules"
        subtitle="Running against every validation pass. Toggle to deactivate."
        rules={active}
        showToggle
        showOpenCount
        onChange={reload}
      />

      {deactivated.length > 0 && (
        <details className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Deactivated rules ({deactivated.length})
          </summary>
          <div className="border-t border-slate-100 px-5 py-4">
            <RuleTable rules={deactivated} bare onChange={reload} showReactivate />
          </div>
        </details>
      )}

      {rules === null && <Spinner label="Loading rules" />}
    </div>
  );
}

// ---------------- AI-draft box ----------------

function AiDraftBox({ onSaved }) {
  const [nl, setNl] = useState("");
  const [busy, setBusy] = useState(false);
  const [rec, setRec] = useState(null);
  const [override, setOverride] = useState({ ruleId: "", name: "", severity: "medium", messageTemplate: "" });

  const ask = async (text) => {
    const q = (text ?? nl).trim();
    if (!q) return;
    setBusy(true); setRec(null);
    try {
      const r = await apiPost("/ai/rule", { naturalLanguage: q });
      const out = r.recommendation?.output || {};
      setRec(r.recommendation);
      setOverride({
        ruleId: out.ruleId || "",
        name: out.name || "",
        severity: out.severity || "medium",
        messageTemplate: out.messageTemplate || "",
      });
      if (out.error) toast.info(out.error);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!rec) return;
    if (!override.ruleId.trim()) { toast.error("Pick a rule id."); return; }
    setBusy(true);
    try {
      const body = {
        aiRecommendationId: rec._id,
        ruleId: override.ruleId.trim(),
        overrides: {
          name: override.name || undefined,
          severity: override.severity,
          messageTemplate: override.messageTemplate || undefined,
        },
      };
      await apiPost("/rules", body);
      toast.info(`Saved ${override.ruleId} as pending.`);
      setRec(null); setNl("");
      onSaved?.();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const discard = () => { setRec(null); setNl(""); };

  const out = rec?.output || {};
  const fallbackNoParse = !!out.error && !out.expression;

  return (
    <Card title="Ask AI to draft a rule">
      <div className="flex flex-wrap items-end gap-2">
        <textarea
          value={nl}
          onChange={(e) => setNl(e.target.value)}
          placeholder="e.g. flag loans where interest rate is above 25 percent"
          rows={2}
          className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm shadow-inner focus:outline-none focus:border-slate-500"
        />
        <Button onClick={() => ask()} disabled={busy || !nl.trim()}>{busy ? "…" : "Ask"}</Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {CHIPS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => { setNl(c); ask(c); }}
            className="rounded-full border border-slate-300 bg-white px-2.5 py-0.5 text-[11px] text-slate-700 hover:border-slate-500 hover:bg-slate-50"
          >
            {c}
          </button>
        ))}
      </div>

      {rec && (
        <div className="mt-4 rounded-md border border-purple-200 bg-purple-50/40 p-4">
          <div className="mb-2 flex items-center gap-2 text-xs">
            <Badge tone="purple">{rec.model}</Badge>
            {rec.fallbackUsed && <Badge tone="amber">fallback</Badge>}
            {typeof rec.confidence === "number" && <span className="text-purple-800">confidence {(rec.confidence * 100).toFixed(0)}%</span>}
          </div>

          {fallbackNoParse ? (
            <div className="space-y-2 text-sm">
              <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                Fallback mode can't reliably translate this yet — enable a real AI provider (<code>AI_ENABLED=true</code>) or write the rule manually.
              </div>
              <p className="text-xs text-slate-600">{out.error}</p>
            </div>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Rule ID (unique)">
                  <input
                    value={override.ruleId}
                    onChange={(e) => setOverride({ ...override, ruleId: e.target.value.toUpperCase() })}
                    placeholder="e.g. INTEREST_ABOVE_25"
                    className="w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs"
                  />
                </Field>
                <Field label="Name">
                  <input
                    value={override.name}
                    onChange={(e) => setOverride({ ...override, name: e.target.value })}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                </Field>
                <Field label="Severity">
                  <select
                    value={override.severity}
                    onChange={(e) => setOverride({ ...override, severity: e.target.value })}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  >
                    {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <Field label="Message template">
                  <input
                    value={override.messageTemplate}
                    onChange={(e) => setOverride({ ...override, messageTemplate: e.target.value })}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                </Field>
              </div>
              <div className="mt-3">
                <RuleExpressionEditor value={out.expression} onChange={() => { /* AI expression not editable inline yet */ }} rows={6} />
              </div>
              <DryRunSummary dryRun={out.dryRun} />
              <div className="mt-4 flex items-center gap-2">
                <Button onClick={save} disabled={busy || !override.ruleId.trim()}>Save as pending</Button>
                <Button variant="secondary" onClick={discard}>Discard</Button>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function ManualDraftBox({ onSaved }) {
  const [form, setForm] = useState({
    ruleId: "",
    name: "",
    severity: "medium",
    messageTemplate: "",
    expression: { op: "isEmpty", field: "borrowerName" },
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!form.ruleId.trim()) { toast.error("Pick a rule id."); return; }
    setBusy(true);
    try {
      await apiPost("/rules", { ...form, origin: "user" });
      toast.info(`Saved ${form.ruleId} as pending.`);
      onSaved?.();
      setForm({ ...form, ruleId: "", name: "", messageTemplate: "" });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Write a rule manually" subtitle="Same schema as the seeded rules.">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Rule ID"><input value={form.ruleId} onChange={(e) => setForm({ ...form, ruleId: e.target.value.toUpperCase() })} className="w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs" /></Field>
        <Field label="Name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded border border-slate-300 px-2 py-1 text-sm" /></Field>
        <Field label="Severity">
          <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })} className="w-full rounded border border-slate-300 px-2 py-1 text-sm">
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Message template"><input value={form.messageTemplate} onChange={(e) => setForm({ ...form, messageTemplate: e.target.value })} className="w-full rounded border border-slate-300 px-2 py-1 text-sm" /></Field>
      </div>
      <div className="mt-3">
        <RuleExpressionEditor value={form.expression} onChange={(expr) => setForm({ ...form, expression: expr })} />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button onClick={save} disabled={busy}>Save as pending</Button>
      </div>
    </Card>
  );
}

function DryRunSummary({ dryRun }) {
  if (!dryRun) return null;
  const { loansMatched = 0, sampleLoanIds = [] } = dryRun;
  return (
    <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-900">
      <span className="font-semibold">Dry run:</span>{" "}
      would match <span className="font-mono">{loansMatched}</span> loan{loansMatched === 1 ? "" : "s"}
      {sampleLoanIds.length > 0 && (
        <>
          {" "}— sample: {sampleLoanIds.map((id) => <code key={id} className="rounded bg-white px-1">{id}</code>).reduce((acc, el, i) => i === 0 ? [el] : [...acc, ", ", el], [])}
        </>
      )}.
      <span className="ml-2 text-blue-700/70">No Exception records were created — this is a preview only.</span>
    </div>
  );
}

// ---------------- Rules table ----------------

function RuleTable({ title, subtitle, rules, emptyText, showApprove, showToggle, showOpenCount, showReactivate, bare, onChange }) {
  const inner = (
    <>
      {(!rules || rules.length === 0) ? (
        <EmptyState title={emptyText || "No rules"} description="" />
      ) : (
        <table className="min-w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-slate-500">
            <tr className="border-b border-slate-100">
              <th className="px-2 py-2 text-left">Rule ID</th>
              <th className="px-2 py-2 text-left">Name</th>
              <th className="px-2 py-2 text-left">Severity</th>
              <th className="px-2 py-2 text-left">Origin</th>
              {showOpenCount && <th className="px-2 py-2 text-right">Open</th>}
              <th className="px-2 py-2 text-left">Created</th>
              <th className="px-2 py-2 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <RuleRow
                key={r.ruleId}
                rule={r}
                showApprove={showApprove}
                showToggle={showToggle}
                showOpenCount={showOpenCount}
                showReactivate={showReactivate}
                onChange={onChange}
              />
            ))}
          </tbody>
        </table>
      )}
    </>
  );
  if (bare) return inner;
  return <Card title={title} subtitle={subtitle}>{inner}</Card>;
}

function RuleRow({ rule, showApprove, showToggle, showOpenCount, showReactivate, onChange }) {
  const [busy, setBusy] = useState(false);
  const [openCount, setOpenCount] = useState(null);

  useEffect(() => {
    if (!showOpenCount) return;
    apiGet(`/rules/${encodeURIComponent(rule.ruleId)}/exception-count`)
      .then((r) => setOpenCount(r.openCount))
      .catch(() => setOpenCount(0));
  }, [rule.ruleId, rule.updatedAt, showOpenCount]);

  const call = async (fn, msg) => {
    setBusy(true);
    try { await fn(); toast.info(msg); onChange?.(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const approve = () => call(async () => {
    const r = await apiPatch(`/rules/${encodeURIComponent(rule.ruleId)}/approve`, {});
    return `Rule activated — ${r.newExceptions ?? 0} new exception${r.newExceptions === 1 ? "" : "s"} raised.`;
  }, "Rule activated");

  const reject = () => {
    if (!window.confirm(`Reject rule ${rule.ruleId}? Its open exceptions will auto-dismiss.`)) return;
    return call(() => apiPatch(`/rules/${encodeURIComponent(rule.ruleId)}/reject`, { note: "rejected via UI" }), `Rule rejected`);
  };

  const toggleDeactivate = () => {
    if (!window.confirm(`Deactivate ${rule.ruleId}? Existing open exceptions will auto-dismiss.`)) return;
    return call(() => apiPatch(`/rules/${encodeURIComponent(rule.ruleId)}/reject`, {}), `Rule deactivated`);
  };
  const reactivate = () => call(() => apiPatch(`/rules/${encodeURIComponent(rule.ruleId)}/approve`, {}), `Rule reactivated`);

  return (
    <tr className="border-b border-slate-50 hover:bg-slate-50">
      <td className="px-2 py-2 font-mono text-xs">{rule.ruleId}</td>
      <td className="px-2 py-2 text-sm">{rule.name}</td>
      <td className="px-2 py-2 text-xs"><Badge tone={sevTone(rule.severity)}>{rule.severity}</Badge></td>
      <td className="px-2 py-2 text-xs"><Badge tone={originTone(rule.origin)}>{rule.origin}</Badge></td>
      {showOpenCount && <td className="px-2 py-2 text-right font-mono text-xs">{openCount ?? "…"}</td>}
      <td className="px-2 py-2 text-xs text-slate-500">{relativeTime(rule.createdAt)}</td>
      <td className="px-2 py-2 text-right">
        <div className="flex justify-end gap-1.5">
          {showApprove && (
            <>
              <Button size="sm" onClick={approve} disabled={busy}>Approve &amp; Activate</Button>
              <Button size="sm" variant="secondary" onClick={reject} disabled={busy}>Reject</Button>
            </>
          )}
          {showToggle && (
            <Button size="sm" variant="secondary" onClick={toggleDeactivate} disabled={busy}>Deactivate</Button>
          )}
          {showReactivate && (
            <Button size="sm" onClick={reactivate} disabled={busy}>Reactivate</Button>
          )}
        </div>
      </td>
    </tr>
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

function sevTone(s) { return s === "blocking" ? "red" : s === "high" ? "amber" : s === "medium" ? "yellow" : "slate"; }
function originTone(o) { return o === "seed" ? "slate" : o === "ai_generated" ? "purple" : "blue"; }
