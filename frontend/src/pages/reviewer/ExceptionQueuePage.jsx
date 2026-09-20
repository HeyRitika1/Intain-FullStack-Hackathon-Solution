import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiGet } from "../../lib/api.js";
import { toast } from "../../components/ui/Toast.jsx";
import Badge from "../../components/ui/Badge.jsx";
import Button from "../../components/ui/Button.jsx";
import Card from "../../components/ui/Card.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import RelativeTime from "../../components/RelativeTime.jsx";
import SeverityBadge from "../../components/SeverityBadge.jsx";
import Spinner from "../../components/ui/Spinner.jsx";

const SEVERITY_OPTS = ["blocking", "high", "medium", "low"];
const STATUS_ORDER = ["open", "in_review", "resolved", "dismissed"];
const STATUS_LABEL = { open: "Open", in_review: "In Review", resolved: "Resolved", dismissed: "Dismissed" };

export default function ExceptionQueuePage() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const rowRefs = useRef([]);
  const navigate = useNavigate();

  const filters = useMemo(() => ({
    status: params.get("status") || "open",
    severity: params.get("severity") || "",
    ruleId: params.get("ruleId") || "",
    q: params.get("q") || "",
    page: Number(params.get("page")) || 1,
    limit: Number(params.get("limit")) || 50,
  }), [params]);

  const setFilter = useCallback((key, value) => {
    const next = new URLSearchParams(params);
    if (value === "" || value === null || value === undefined) next.delete(key);
    else next.set(key, String(value));
    if (key !== "page") next.delete("page");
    setParams(next, { replace: true });
    setSelectedIdx(0);
  }, [params, setParams]);

  useEffect(() => {
    apiGet("/rules?active=true").then((r) => setRules(r.items || [])).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v !== "" && v !== null) qs.set(k, v);
    apiGet(`/exceptions?${qs.toString()}`)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setSelectedIdx((idx) => Math.min(idx, Math.max((res.items?.length || 1) - 1, 0)));
      })
      .catch((err) => { if (!cancelled) toast.error(`Load failed: ${err.message}`); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filters]);

  const items = data?.items || [];
  const counts = data?.counts || {};

  useEffect(() => {
    const onKey = (e) => {
      if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target?.tagName)) return;
      if (!items.length) return;
      if (e.key === "j") { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, items.length - 1)); }
      else if (e.key === "k") { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); }
      else if (e.key === "Enter") { e.preventDefault(); openRow(items[selectedIdx]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, selectedIdx]);

  useEffect(() => {
    rowRefs.current[selectedIdx]?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  function openRow(row) {
    if (!row) return;
    navigate(`/reviewer/loans/${encodeURIComponent(row.loanId)}?exception=${encodeURIComponent(row.exceptionId)}`);
  }

  const activeSeverities = filters.severity ? filters.severity.split(",").filter(Boolean) : [];
  const toggleSeverity = (s) => {
    const next = new Set(activeSeverities);
    next.has(s) ? next.delete(s) : next.add(s);
    setFilter("severity", [...next].join(","));
  };

  const clearAll = () => {
    setParams({ status: "open" }, { replace: true });
    setSelectedIdx(0);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {STATUS_ORDER.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter("status", s)}
            className={`rounded-full px-3 py-1 text-xs font-medium ring-1 transition ${filters.status === s ? "bg-amber-500 text-white ring-amber-500" : "bg-white text-slate-700 ring-slate-200 hover:bg-amber-50"}`}
          >
            {STATUS_LABEL[s]} <span className="ml-1 opacity-70">({counts[s] ?? "…"})</span>
          </button>
        ))}
      </div>

      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 pb-3">
          <div className="min-w-0 flex-1">
            <label className="mb-1 block text-xs font-medium text-slate-600">Search</label>
            <input
              value={filters.q}
              onChange={(e) => setFilter("q", e.target.value)}
              placeholder="loanId, borrower, rule name/id, message…"
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Rule</label>
            <select
              value={filters.ruleId}
              onChange={(e) => setFilter("ruleId", e.target.value)}
              className="w-52 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">All rules</option>
              {rules.map((r) => (
                <option key={r.ruleId} value={r.ruleId}>{r.ruleId}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Severity</label>
            <div className="flex gap-1">
              {SEVERITY_OPTS.map((s) => {
                const active = activeSeverities.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleSeverity(s)}
                    className={`rounded px-2 py-1 text-xs font-medium ring-1 transition ${active ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-100"}`}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={clearAll}>Clear filters</Button>
        </div>

        <div className="mt-3">
          {loading && <Spinner label="Loading exceptions" />}
          {!loading && items.length === 0 && (
            <EmptyState title="No exceptions match" description="Adjust the filters or clear them." />
          )}
          {items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-2 py-2">Severity</th>
                    <th className="px-2 py-2">Loan</th>
                    <th className="px-2 py-2">Borrower</th>
                    <th className="px-2 py-2">Rule</th>
                    <th className="px-2 py-2">Message</th>
                    <th className="px-2 py-2">When</th>
                    <th className="px-2 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((row, idx) => (
                    <tr
                      key={row.exceptionId}
                      ref={(el) => (rowRefs.current[idx] = el)}
                      onMouseEnter={() => setSelectedIdx(idx)}
                      onClick={() => openRow(row)}
                      className={`cursor-pointer ${idx === selectedIdx ? "bg-amber-50" : "hover:bg-slate-50"}`}
                    >
                      <td className="px-2 py-2"><SeverityBadge severity={row.severity} /></td>
                      <td className="px-2 py-2 font-mono text-xs text-slate-800">{row.loanId}</td>
                      <td className="px-2 py-2 text-slate-700">{row.loan?.borrowerName || "—"}</td>
                      <td className="px-2 py-2 font-mono text-xs text-slate-700">{row.ruleId}</td>
                      <td className="px-2 py-2 max-w-md truncate text-slate-700" title={row.message}>{row.message}</td>
                      <td className="px-2 py-2 text-xs text-slate-500"><RelativeTime iso={row.createdAt} /></td>
                      <td className="px-2 py-2"><Badge tone={STATUS_TONE[row.status]}>{row.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {data && data.totalPages > 1 && (
          <div className="mt-3 flex items-center justify-between text-xs text-slate-600">
            <span>Page {data.page} of {data.totalPages} · {data.total} total</span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={data.page <= 1} onClick={() => setFilter("page", data.page - 1)}>Prev</Button>
              <Button size="sm" variant="secondary" disabled={data.page >= data.totalPages} onClick={() => setFilter("page", data.page + 1)}>Next</Button>
            </div>
          </div>
        )}

        <p className="mt-3 text-[10px] uppercase tracking-wide text-slate-400">
          Keyboard: j/k to move · Enter to open
        </p>
      </Card>
    </div>
  );
}

const STATUS_TONE = {
  open: "amber",
  in_review: "blue",
  resolved: "emerald",
  dismissed: "slate",
};
