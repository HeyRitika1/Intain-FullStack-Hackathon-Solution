import { useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiGet } from "../../lib/api.js";
import { relativeTime, truncMiddle } from "../../lib/format.js";
import useAutoRefresh from "../../lib/useAutoRefresh.js";
import Card from "../../components/ui/Card.jsx";
import Badge from "../../components/ui/Badge.jsx";
import Spinner from "../../components/ui/Spinner.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import DashboardControls from "../../components/DashboardControls.jsx";
import BarChart from "../../components/charts/BarChart.jsx";

const BLUE = "#2563eb";

export default function OperatorDashboard() {
  const navigate = useNavigate();
  const fetcher = useCallback(() => apiGet("/summary/operator"), []);
  const { data, loadedAt, error, busy, enabled, setEnabled, refresh } = useAutoRefresh(fetcher);

  if (error) return <Card><EmptyState title="Load failed" description={error.message} /></Card>;
  if (!data) return <Spinner label="Loading operator dashboard" />;

  const op = data.operator || {};
  const stalenessData = (op.staleness?.bands || []).map((b) => ({ label: b.label, value: b.count, color: BLUE }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-blue-900">Operations health</h1>
          <p className="text-xs text-slate-500">Ingestion, lineage, and data freshness — updated every 30s when auto-refresh is on.</p>
        </div>
        <DashboardControls enabled={enabled} setEnabled={setEnabled} refresh={refresh} busy={busy} loadedAt={loadedAt} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Total imports" value={op.totalImports} caption="all time" accent="blue" />
        <Kpi label="Rows ingested today" value={op.rowsIngestedToday} accent="blue" />
        <Kpi label="Rows failed today" value={op.rowsFailedToday} tone={op.rowsFailedToday > 0 ? "warn" : "ok"} />
        <Kpi label="Loans awaiting validation" value={op.loansAwaitingValidation} accent="blue" caption="pending status" />
      </div>

      <Card
        title="Recent imports"
        subtitle="Latest 8 across all file types."
        actions={<Link to="/operator/imports" className="text-xs text-blue-700 underline">Full history →</Link>}
      >
        {op.recentImports?.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-slate-500">
                <tr className="border-b border-slate-100">
                  <th className="px-2 py-2 text-left">Type</th>
                  <th className="px-2 py-2 text-left">Filename</th>
                  <th className="px-2 py-2 text-right">Rows</th>
                  <th className="px-2 py-2 text-right">Failed</th>
                  <th className="px-2 py-2 text-left">Status</th>
                  <th className="px-2 py-2 text-left">By</th>
                  <th className="px-2 py-2 text-left">Uploaded</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {op.recentImports.map((r) => (
                  <tr key={r.batchId} className="border-b border-slate-50 hover:bg-blue-50/40">
                    <td className="px-2 py-2 font-mono text-xs">{r.fileType}</td>
                    <td className="px-2 py-2 text-xs" title={r.originalFilename}>{truncMiddle(r.originalFilename || "—", 20, 6)}</td>
                    <td className="px-2 py-2 text-right font-mono">{r.rowCount ?? 0}</td>
                    <td className={`px-2 py-2 text-right font-mono ${r.failedRowCount > 0 ? "text-amber-700" : "text-slate-500"}`}>{r.failedRowCount ?? 0}</td>
                    <td className="px-2 py-2"><Badge tone={statusTone(r.status)}>{r.status}</Badge></td>
                    <td className="px-2 py-2 text-xs text-slate-600">{r.uploadedBy || "—"}</td>
                    <td className="px-2 py-2 text-xs text-slate-500">{relativeTime(r.createdAt)}</td>
                    <td className="px-2 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => navigate(`/operator/uploads?fileType=${r.fileType}`)}
                        className="rounded border border-blue-200 bg-white px-2 py-0.5 text-[10px] text-blue-700 hover:bg-blue-50"
                      >
                        Re-upload
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No imports yet" description="Upload a Loan Tape to get started." action={<Link to="/operator/uploads" className="text-blue-700 underline">Go to uploads →</Link>} />
        )}
      </Card>

      <Card title="Loan freshness" subtitle="Loans by lastUpdatedAt age band. Older bands = re-ingest candidates.">
        <BarChart data={stalenessData} orientation="vertical" height={160} />
        {op.staleness?.loansOlderThan90Days > 0 && (
          <p className="mt-3 text-[11px] text-amber-700">
            {op.staleness.loansOlderThan90Days} loans have not been updated in the last 90 days. Consider requesting a fresh servicer feed.
          </p>
        )}
      </Card>
    </div>
  );
}

function Kpi({ label, value, tone, caption, accent }) {
  const valueTone =
    tone === "warn" ? "text-amber-700" :
    tone === "ok" ? "text-emerald-700" :
    accent === "blue" ? "text-blue-900" : "text-slate-900";
  const border = accent === "blue" ? "border-l-4 border-l-blue-500" : "";
  return (
    <Card className={border}>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${valueTone}`}>{value ?? 0}</div>
      {caption && <div className="mt-1 text-xs text-slate-500">{caption}</div>}
    </Card>
  );
}

function statusTone(s) {
  return s === "committed" || s === "normalized" ? "emerald" : s === "uploaded" ? "blue" : "slate";
}
