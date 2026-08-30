import { useCallback, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiGet } from "../../lib/api.js";
import { relativeTime } from "../../lib/format.js";
import { useAuth } from "../../context/AuthContext.jsx";
import useAutoRefresh from "../../lib/useAutoRefresh.js";
import Card from "../../components/ui/Card.jsx";
import Spinner from "../../components/ui/Spinner.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import DashboardControls from "../../components/DashboardControls.jsx";
import BarChart from "../../components/charts/BarChart.jsx";
import StackedBar from "../../components/charts/StackedBar.jsx";
import ConversePanel from "../../components/converse/ConversePanel.jsx";

const AMBER = "#f59e0b";

export default function ReviewerDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [justMine, setJustMine] = useState(false);
  const fetcher = useCallback(() => apiGet("/summary/reviewer"), []);
  const { data, loadedAt, error, busy, enabled, setEnabled, refresh } = useAutoRefresh(fetcher);

  if (error) return <Card><EmptyState title="Load failed" description={error.message} /></Card>;
  if (!data) return <Spinner label="Loading reviewer dashboard" />;

  const r = data.reviewer || {};
  const ai = r.aiUsage?.today || {};
  const rulesData = (r.topRulesByOpenCount || []).map((row) => ({
    label: row.ruleId,
    value: row.count,
    color: severityColor(row.severity),
    meta: row,
  }));
  const aiSegments = [
    { label: "accepted", value: ai.accepted || 0, color: "#10b981" },
    { label: "edited", value: ai.edited || 0, color: "#f59e0b" },
    { label: "rejected", value: ai.rejected || 0, color: "#ef4444" },
    { label: "fallback (no decision)", value: Math.max(0, (ai.fallback || 0) - ((ai.accepted || 0) + (ai.edited || 0) + (ai.rejected || 0))), color: "#94a3b8" },
  ];

  const decisions = (r.recentDecisions || []).filter((d) => (!justMine || d.reviewer === user?.email));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-amber-900">Queue health &amp; AI leverage</h1>
          <p className="text-xs text-slate-500">How the exception queue is moving and how much AI leverage the team is getting.</p>
        </div>
        <DashboardControls enabled={enabled} setEnabled={setEnabled} refresh={refresh} busy={busy} loadedAt={loadedAt} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Open exceptions" value={r.queueDepth} caption="open + in_review" accent="amber" />
        <Kpi label="Blocking" value={r.blockingCount} tone={r.blockingCount > 0 ? "danger" : "ok"} />
        <Kpi label="My in-review" value={r.myClaimedCount} accent="amber" caption={user?.email || ""} />
        <Kpi label="Avg resolution (min)" value={r.avgResolutionMinutes} accent="amber" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Exceptions by rule" subtitle="Top 8 open rules. Click a bar to filter the queue.">
          {rulesData.length ? (
            <BarChart
              data={rulesData}
              orientation="horizontal"
              onBarClick={(d) => navigate(`/reviewer/queue?ruleId=${encodeURIComponent(d.label)}`)}
            />
          ) : (
            <EmptyState title="Queue clear" description="No open exceptions." />
          )}
        </Card>
        <Card title="AI usage today" subtitle="Recommendations grouped by the reviewer decision they got.">
          <div className="mb-2 text-2xl font-semibold text-amber-900">{ai.total ?? 0} <span className="text-xs font-normal text-slate-500">recommendations</span></div>
          <StackedBar segments={aiSegments} height={28} />
          <p className="mt-3 text-[11px] text-slate-500">
            Fallback recs today: <span className="font-mono">{ai.fallback ?? 0}</span> · Week total: <span className="font-mono">{r.aiUsage?.week?.total ?? 0}</span>
          </p>
        </Card>
      </div>

      <Card
        title="Recent decisions"
        subtitle="Last 10 reviewer actions across all loans."
        actions={
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={justMine} onChange={(e) => setJustMine(e.target.checked)} />
            Just mine
          </label>
        }
      >
        {decisions.length ? (
          <ul className="divide-y divide-slate-100">
            {decisions.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="font-semibold text-slate-800">{d.reviewerName || d.reviewer}</span>
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">{d.action}</span>
                {d.loanId && !d.loanId.startsWith("__") && (
                  <Link to={`/reviewer/loans/${encodeURIComponent(d.loanId)}`} className="font-mono text-xs text-amber-700 underline hover:text-amber-900">
                    {d.loanId}
                  </Link>
                )}
                {d.comment && <span className="min-w-0 truncate text-xs text-slate-600">— {d.comment}</span>}
                <span className="ml-auto text-xs text-slate-500">{relativeTime(d.createdAt)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No decisions to show" description={justMine ? "You haven't made a decision recently." : "No recent activity."} />
        )}
      </Card>

      <AskDetails />
    </div>
  );
}

function AskDetails() {
  return (
    <details className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50">
        Ask a question — natural-language query over verified data
      </summary>
      <div className="border-t border-slate-100 px-5 py-4">
        <ConversePanel compact showHistory={false} />
      </div>
    </details>
  );
}

function Kpi({ label, value, tone, caption, accent }) {
  const valueTone =
    tone === "danger" ? "text-red-700" :
    tone === "ok" ? "text-emerald-700" :
    accent === "amber" ? "text-amber-900" : "text-slate-900";
  const border = accent === "amber" ? "border-l-4 border-l-amber-500" : "";
  return (
    <Card className={border}>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${valueTone}`}>{value ?? 0}</div>
      {caption && <div className="mt-1 text-xs text-slate-500">{caption}</div>}
    </Card>
  );
}

function severityColor(sev) {
  return sev === "blocking" ? "#dc2626" : sev === "high" ? "#ea580c" : sev === "medium" ? "#f59e0b" : "#64748b";
}
