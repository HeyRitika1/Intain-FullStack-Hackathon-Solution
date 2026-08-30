import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, getSummary, getSummaryTrust } from "../../lib/api.js";
import { relativeTime } from "../../lib/format.js";
import Card from "../../components/ui/Card.jsx";
import Spinner from "../../components/ui/Spinner.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import TrustScoreBadge from "../../components/TrustScoreBadge.jsx";

export default function TrustScorePage() {
  const [trust, setTrust] = useState(null);
  const [summary, setSummary] = useState(null);
  const [worst, setWorst] = useState(null);

  useEffect(() => {
    getSummaryTrust().then(setTrust).catch(() => setTrust({}));
    getSummary().then(setSummary).catch(() => {});
    apiGet("/verified?limit=100")
      .then((r) => {
        const sorted = [...(r.items || [])].sort((a, b) => (a.trustScore ?? 0) - (b.trustScore ?? 0));
        setWorst(sorted.slice(0, 10));
      })
      .catch(() => setWorst([]));
  }, []);

  if (trust === null) return <Spinner label="Loading portfolio trust" />;

  if (!trust.verifiedLoanCount) {
    return (
      <Card title="Portfolio trust">
        <EmptyState
          title="No verified loans yet"
          description="Trust is computed at verification time. Have a reviewer verify a loan first."
          action={<Link to="/consumer/verified" className="text-emerald-700 underline">Go to verified records →</Link>}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card title="Portfolio trust" subtitle="Aggregated across the latest verified record per loan.">
        <div className="grid gap-6 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
          <div className="flex flex-col items-center justify-center gap-2 rounded-md bg-slate-50 p-4">
            <TrustScoreBadge score={trust.portfolioTrustScore} breakdown={trust.breakdownAverages} size="lg" />
            <div className="text-xs text-slate-500">
              across {trust.verifiedLoanCount} verified loan{trust.verifiedLoanCount === 1 ? "" : "s"}
            </div>
          </div>
          <div className="space-y-3">
            <DistributionChart bands={trust.distribution?.bands || []} />
            <BreakdownBars avgs={trust.breakdownAverages || {}} />
          </div>
        </div>
        {summary?.recentActivity?.[0]?.timestamp && (
          <div className="mt-4 text-[11px] text-slate-500">
            Data verified as of {relativeTime(summary.recentActivity[0].timestamp)}.
          </div>
        )}
      </Card>

      <Card title="Loans to investigate first" subtitle="10 lowest trust scores across verified loans.">
        {worst === null && <Spinner />}
        {worst && worst.length === 0 && <EmptyState title="Nothing to investigate" description="All verified loans scored above the threshold." />}
        {worst && worst.length > 0 && (
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
              {worst.map((r) => (
                <tr key={r.loanId} className="border-b border-slate-50 hover:bg-slate-50">
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

function DistributionChart({ bands }) {
  const max = Math.max(1, ...bands.map((b) => b.count || 0));
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Distribution</div>
      <div className="mt-2 flex h-32 items-end justify-around gap-4 rounded-md border border-slate-100 bg-white p-3">
        {bands.map((b) => {
          const h = ((b.count || 0) / max) * 100;
          const cls =
            b.label === "90-100" ? "bg-emerald-500" :
            b.label === "80-89" ? "bg-emerald-400" :
            b.label === "70-79" ? "bg-amber-400" :
            b.label === "60-69" ? "bg-orange-400" : "bg-red-500";
          return (
            <div key={b.label} className="flex flex-1 flex-col items-center gap-1">
              <div className="text-[10px] font-mono text-slate-700">{b.count || 0}</div>
              <div className={`w-full rounded-t ${cls}`} style={{ height: `${h}%`, minHeight: b.count ? 4 : 0 }} />
              <div className="text-[10px] text-slate-500">{b.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BreakdownBars({ avgs }) {
  const rows = [
    ["Completeness", avgs.completeness],
    ["Consistency", avgs.consistency],
    ["Freshness", avgs.freshness],
    ["Review coverage", avgs.reviewCoverage],
  ];
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Breakdown averages</div>
      <div className="mt-2 space-y-1.5 rounded-md border border-slate-100 bg-white p-3">
        {rows.map(([label, v]) => {
          const val = Number.isFinite(Number(v)) ? Number(v) : 0;
          const cls = val >= 85 ? "bg-emerald-500" : val >= 70 ? "bg-amber-500" : "bg-red-500";
          return (
            <div key={label} className="grid grid-cols-[130px_1fr_36px] items-center gap-2 text-xs">
              <span className="text-slate-500">{label}</span>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div className={`h-full ${cls}`} style={{ width: `${val}%` }} />
              </div>
              <span className="text-right font-mono text-slate-700">{v ?? "—"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
