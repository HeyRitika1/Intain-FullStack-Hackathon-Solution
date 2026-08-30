import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiGet, apiPost, exportBundle, exportVerified, getSummary } from "../../lib/api.js";
import { relativeTime } from "../../lib/format.js";
import { toast } from "../../components/ui/Toast.jsx";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import Badge from "../../components/ui/Badge.jsx";
import Spinner from "../../components/ui/Spinner.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import TrustScoreBadge from "../../components/TrustScoreBadge.jsx";

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

function useUrlFilters() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(
    () => ({
      q: params.get("q") || "",
      states: (params.get("states") || "").split(",").filter(Boolean),
      minTrustScore: params.get("minTrustScore") || "",
      verifiedAfter: params.get("verifiedAfter") || "",
    }),
    [params]
  );
  const setFilters = (patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      const val = Array.isArray(v) ? v.join(",") : v;
      if (val === "" || val === null || val === undefined) next.delete(k);
      else next.set(k, val);
    }
    setParams(next, { replace: false });
  };
  return [filters, setFilters];
}

function serverFilters(filters) {
  const out = {};
  if (filters.q) out.q = filters.q;
  if (filters.states?.length === 1) out.state = filters.states[0];
  if (filters.minTrustScore) out.minTrustScore = filters.minTrustScore;
  if (filters.verifiedAfter) out.verifiedAfter = filters.verifiedAfter;
  return out;
}

export default function VerifiedRecordsPage() {
  const [filters, setFilters] = useUrlFilters();
  const [summary, setSummary] = useState(null);
  const [items, setItems] = useState(null);
  const [chainMap, setChainMap] = useState({});
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    getSummary().then(setSummary).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    const qs = new URLSearchParams({ limit: "100", ...serverFilters(filters) });
    apiGet(`/verified?${qs.toString()}`)
      .then((r) => {
        if (cancelled) return;
        let list = r.items || [];
        if (filters.states.length > 1) {
          const set = new Set(filters.states);
          list = list.filter((it) => set.has(it.snapshot?.state));
        }
        setItems(list);
        if (list.length) {
          apiPost("/verified/chain-check", { loanIds: list.map((it) => it.loanId) })
            .then((res) => { if (!cancelled) setChainMap(res.results || {}); })
            .catch(() => {});
        } else {
          setChainMap({});
        }
      })
      .catch((e) => {
        if (!cancelled) toast.error(`Load failed: ${e.message}`);
      });
    return () => { cancelled = true; };
  }, [filters.q, filters.states.join(","), filters.minTrustScore, filters.verifiedAfter]);

  const doExport = async (kind) => {
    setBusy(true);
    try {
      const fn = kind === "csv" ? exportVerified : exportBundle;
      const args = kind === "csv" ? ["csv", serverFilters(filters)] : [serverFilters(filters)];
      const r = await fn(...args);
      toast.info(`Downloaded ${r.filename}`);
    } catch (e) {
      toast.error(`Export failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const lastVerifiedAt = summary?.recentActivity?.find((a) => a.type === "verified")?.timestamp;

  return (
    <div className="space-y-4">
      <KpiStrip summary={summary} lastVerifiedAt={lastVerifiedAt} />

      <Card
        title="Verified Records"
        subtitle="Read-only, trust-scored, chain-verified loans."
        actions={
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-500">Exports are logged in the audit trail</span>
            <Button variant="secondary" onClick={() => doExport("csv")} disabled={busy}>Export CSV</Button>
            <Button onClick={() => doExport("bundle")} disabled={busy}>Export Bundle</Button>
          </div>
        }
      >
        <FilterBar filters={filters} onChange={setFilters} />
        <div className="mt-3">
          {items === null && <Spinner label="Loading verified loans" />}
          {items && items.length === 0 && <EmptyBoard />}
          {items && items.length > 0 && (
            <VerifiedTable items={items} chainMap={chainMap} onOpen={(id) => navigate(`/consumer/verified/${encodeURIComponent(id)}`)} />
          )}
        </div>
      </Card>
    </div>
  );
}

function KpiStrip({ summary, lastVerifiedAt }) {
  const trust = summary?.trust || {};
  const bd = trust.breakdownAverages;
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <Card className="!p-0">
        <div className="flex items-center gap-4 px-5 py-4">
          <TrustScoreBadge score={trust.portfolioTrustScore} breakdown={bd} size="lg" />
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">Portfolio trust</div>
            <div className="text-2xl font-semibold text-slate-800">{trust.portfolioTrustScore ?? "—"}</div>
            <div className="text-[11px] text-slate-500">across {trust.verifiedLoanCount ?? 0} verified loans</div>
          </div>
        </div>
      </Card>
      <Card className="!p-0">
        <div className="px-5 py-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Verified loans</div>
          <div className="mt-1 text-2xl font-semibold text-slate-800">{trust.verifiedLoanCount ?? 0}</div>
          <div className="text-[11px] text-slate-500">
            {summary?.counts?.loans?.total
              ? `of ${summary.counts.loans.total} total`
              : "—"}
          </div>
        </div>
      </Card>
      <Card className="!p-0">
        <div className="px-5 py-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Last verification</div>
          <div className="mt-1 text-2xl font-semibold text-slate-800">
            {lastVerifiedAt ? relativeTime(lastVerifiedAt) : "—"}
          </div>
          <div className="text-[11px] text-slate-500">from /api/summary.recentActivity</div>
        </div>
      </Card>
    </div>
  );
}

function FilterBar({ filters, onChange }) {
  const [statesOpen, setStatesOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 pb-3">
      <Field label="Search">
        <input
          value={filters.q}
          onChange={(e) => onChange({ q: e.target.value })}
          placeholder="loanId or borrower…"
          className="w-56 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
      </Field>
      <Field label="State">
        <div className="relative">
          <button
            type="button"
            onClick={() => setStatesOpen((v) => !v)}
            className="w-40 rounded-md border border-slate-300 px-2 py-1.5 text-left text-sm hover:bg-slate-50"
          >
            {filters.states.length ? filters.states.join(", ") : "All states"}
          </button>
          {statesOpen && (
            <div className="absolute z-20 mt-1 max-h-56 w-56 overflow-y-auto rounded-md border border-slate-200 bg-white p-2 text-xs shadow-lg">
              {STATES.map((st) => {
                const checked = filters.states.includes(st);
                return (
                  <label key={st} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const next = checked ? filters.states.filter((s) => s !== st) : [...filters.states, st];
                        onChange({ states: next });
                      }}
                    />
                    <span className="font-mono">{st}</span>
                  </label>
                );
              })}
              {filters.states.length > 0 && (
                <button type="button" onClick={() => onChange({ states: [] })} className="mt-1 w-full rounded bg-slate-100 py-1 text-[11px] text-slate-700">
                  Clear
                </button>
              )}
            </div>
          )}
        </div>
      </Field>
      <Field label={`Min trust: ${filters.minTrustScore || 0}`}>
        <input
          type="range" min="0" max="100" step="5"
          value={Number(filters.minTrustScore || 0)}
          onChange={(e) => onChange({ minTrustScore: e.target.value === "0" ? "" : e.target.value })}
          className="w-40"
        />
      </Field>
      <Field label="Verified after">
        <input
          type="date"
          value={filters.verifiedAfter}
          onChange={(e) => onChange({ verifiedAfter: e.target.value })}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
      </Field>
      {(filters.q || filters.states.length || filters.minTrustScore || filters.verifiedAfter) && (
        <button
          type="button"
          onClick={() => onChange({ q: "", states: [], minTrustScore: "", verifiedAfter: "" })}
          className="text-xs text-slate-500 underline hover:text-slate-700"
        >
          Clear filters
        </button>
      )}
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

function VerifiedTable({ items, chainMap, onOpen }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="text-[11px] uppercase tracking-wide text-slate-500">
          <tr className="border-b border-slate-100">
            <th className="px-2 py-2 text-left">Loan ID</th>
            <th className="px-2 py-2 text-left">Borrower</th>
            <th className="px-2 py-2 text-left">State</th>
            <th className="px-2 py-2 text-right">Current balance</th>
            <th className="px-2 py-2 text-center">Trust</th>
            <th className="px-2 py-2 text-left">Verified</th>
            <th className="px-2 py-2 text-center">Chain</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => {
            const s = r.snapshot || {};
            const ok = chainMap[r.loanId];
            return (
              <tr
                key={r.loanId}
                onClick={() => onOpen(r.loanId)}
                className="cursor-pointer border-b border-slate-50 hover:bg-emerald-50/50"
              >
                <td className="px-2 py-2 font-mono text-xs">{s.loanId}</td>
                <td className="px-2 py-2">{s.borrowerName || "—"}</td>
                <td className="px-2 py-2 font-mono text-xs">{s.state || "—"}</td>
                <td className="px-2 py-2 text-right font-mono">{fmtMoney(s.currentBalance)}</td>
                <td className="px-2 py-2">
                  <div className="flex justify-center">
                    <TrustScoreBadge score={r.trustScore} breakdown={r.trustBreakdown} size="sm" />
                  </div>
                </td>
                <td className="px-2 py-2 text-xs text-slate-600">{relativeTime(r.verifiedAt)}</td>
                <td className="px-2 py-2 text-center">
                  {ok === undefined ? (
                    <Badge tone="slate">…</Badge>
                  ) : ok ? (
                    <Badge tone="emerald">✓ ok</Badge>
                  ) : (
                    <Badge tone="red">✕ broken</Badge>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function fmtMoney(n) {
  if (!Number.isFinite(Number(n))) return "—";
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function EmptyBoard() {
  return (
    <div className="grid place-items-center py-12">
      <div className="w-full max-w-md rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6">
        <div className="mx-auto flex h-24 w-full items-end justify-around gap-1 rounded bg-white p-3 shadow-inner">
          <div className="h-8 w-4 rounded-t bg-emerald-200" />
          <div className="h-16 w-4 rounded-t bg-emerald-300" />
          <div className="h-12 w-4 rounded-t bg-emerald-400" />
          <div className="h-20 w-4 rounded-t bg-emerald-500" />
          <div className="h-10 w-4 rounded-t bg-emerald-300" />
          <div className="h-14 w-4 rounded-t bg-emerald-400" />
        </div>
        <div className="mt-4 text-center">
          <div className="text-sm font-semibold text-slate-700">No verified loans yet</div>
          <div className="mt-1 text-xs text-slate-500">
            Ask a Reviewer to verify a loan to see it here.
          </div>
          <Link to="/reviewer/queue" className="mt-3 inline-block text-xs text-emerald-700 underline hover:text-emerald-900">
            Open the reviewer queue →
          </Link>
        </div>
      </div>
    </div>
  );
}
