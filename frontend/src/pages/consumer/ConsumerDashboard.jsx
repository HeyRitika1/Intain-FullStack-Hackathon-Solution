import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../../lib/api.js";
import { relativeTime } from "../../lib/format.js";
import useAutoRefresh from "../../lib/useAutoRefresh.js";
import Card from "../../components/ui/Card.jsx";
import Spinner from "../../components/ui/Spinner.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import DashboardControls from "../../components/DashboardControls.jsx";
import TrustScoreBadge from "../../components/TrustScoreBadge.jsx";
import Histogram from "../../components/charts/Histogram.jsx";
import BarChart from "../../components/charts/BarChart.jsx";

const EMERALD = "#059669";

export default function ConsumerDashboard() {
  const fetcher = useCallback(() => apiGet("/summary/consumer"), []);
  const { data, loadedAt, error, busy, enabled, setEnabled, refresh } = useAutoRefresh(fetcher);
  const [triage, setTriage] = useState(null);

  useEffect(() => {
    let cancelled = false;
    apiGet("/verified?limit=100")
      .then((r) => {
        if (cancelled) return;
        const sorted = [...(r.items || [])].sort((a, b) => (a.trustScore ?? 0) - (b.trustScore ?? 0));
        const q = Math.max(3, Math.ceil(sorted.length / 5));
        setTriage(sorted.slice(0, q));
      })
      .catch(() => setTriage([]));
    return () => { cancelled = true; };
  }, [data]);

  if (error) return <Card><EmptyState title="Load failed" description={error.message} /></Card>;
  if (!data) return <Spinner label="Loading consumer dashboard" />;

  const c = data.consumer || {};
  const bd = c.breakdownAverages || {};
  const breakdownData = [
    { label: "Completeness", value: bd.completeness || 0, color: EMERALD },
    { label: "Consistency", value: bd.consistency || 0, color: EMERALD },
    { label: "Freshness", value: bd.freshness || 0, color: EMERALD },
    { label: "Coverage", value: bd.reviewCoverage || 0, color: EMERALD },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-emerald-900">Consumer overview</h1>
          <p className="text-xs text-slate-500">
            Read-only view. Data verified as of{" "}
            <span className="font-mono">{c.latestVerifiedAt ? relativeTime(c.latestVerifiedAt) : "—"}</span>.
          </p>
        </div>
        <DashboardControls enabled={enabled} setEnabled={setEnabled} refresh={refresh} busy={busy} loadedAt={loadedAt} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <TrustKpi score={c.portfolioTrustScore} breakdown={bd} />
        <Kpi label="Verified loans" value={c.verifiedCount} accent="emerald" caption="latest record per loan" />
        <Kpi label="Loans with drift" value={c.driftedCount} tone={c.driftedCount > 0 ? "warn" : "ok"} caption="changed since verification" />
        <Kpi label="Exports this week" value={c.exportsThisWeek} accent="emerald" caption="CSV + JSON bundles" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Trust distribution" subtitle="Verified loans by score band.">
          <Histogram bands={c.distribution?.bands || []} height={150} emptyText="No verified loans yet" />
        </Card>
        <Card title="Breakdown averages" subtitle="Portfolio-wide averages across the 4 trust dimensions.">
          <BarChart data={breakdownData} orientation="horizontal" />
        </Card>
      </div>

      <Card
        title="Loans to investigate first"
        subtitle="Bottom-quintile trust scores. This is what a data consumer would triage first."
        actions={<Link to="/consumer/trust" className="text-xs text-emerald-700 underline">Full leaderboard →</Link>}
      >
        {triage === null && <Spinner />}
        {triage && triage.length === 0 && <EmptyState title="Nothing to investigate" description="No verified loans yet, or all scored high." />}
        {triage && triage.length > 0 && (
          <table className="min-w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-slate-500">
              <tr className="border-b border-slate-100">
                <th className="px-2 py-2 text-left">Loan ID</th>
                <th className="px-2 py-2 text-left">Borrower</th>
                <th className="px-2 py-2 text-left">State</th>
                <th className="px-2 py-2 text-center">Trust</th>
                <th className="px-2 py-2 text-left">Verified</th>
              </tr>
            </thead>
            <tbody>
              {triage.map((r) => (
                <tr key={r.loanId} className="border-b border-slate-50 hover:bg-emerald-50/40">
                  <td className="px-2 py-2 font-mono text-xs">
                    <Link to={`/consumer/verified/${encodeURIComponent(r.loanId)}`} className="text-emerald-700 underline hover:text-emerald-900">
                      {r.loanId}
                    </Link>
                  </td>
                  <td className="px-2 py-2">{r.snapshot?.borrowerName || "—"}</td>
                  <td className="px-2 py-2 font-mono text-xs">{r.snapshot?.state || "—"}</td>
                  <td className="px-2 py-2">
                    <div className="flex justify-center">
                      <TrustScoreBadge score={r.trustScore} breakdown={r.trustBreakdown} size="sm" />
                    </div>
                  </td>
                  <td className="px-2 py-2 text-xs text-slate-600">{relativeTime(r.verifiedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function TrustKpi({ score, breakdown }) {
  return (
    <Card className="border-l-4 border-l-emerald-500">
      <div className="flex items-center gap-3">
        <TrustScoreBadge score={score} breakdown={breakdown} size="lg" />
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Portfolio trust</div>
          <div className="text-2xl font-semibold text-emerald-900">{score ?? "—"}</div>
        </div>
      </div>
    </Card>
  );
}

function Kpi({ label, value, tone, caption, accent }) {
  const valueTone =
    tone === "warn" ? "text-amber-700" :
    tone === "ok" ? "text-emerald-700" :
    accent === "emerald" ? "text-emerald-900" : "text-slate-900";
  const border = accent === "emerald" ? "border-l-4 border-l-emerald-500" : "";
  return (
    <Card className={border}>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${valueTone}`}>{value ?? 0}</div>
      {caption && <div className="mt-1 text-xs text-slate-500">{caption}</div>}
    </Card>
  );
}
