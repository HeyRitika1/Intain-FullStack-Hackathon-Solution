import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../../lib/api.js";
import { toast } from "../../components/ui/Toast.jsx";
import Card from "../../components/ui/Card.jsx";
import Spinner from "../../components/ui/Spinner.jsx";

export default function ByModulePage() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    apiGet("/dev-log/stats").then(setStats).catch((e) => toast.error(e.message));
  }, []);

  if (!stats) return <Spinner label="Loading modules" />;
  const modules = stats.byModule || [];

  return (
    <div className="space-y-4">
      <Card>
        <h1 className="text-lg font-semibold text-slate-800">Modules covered</h1>
        <p className="text-xs text-slate-500">
          {modules.length} modules · {stats.totalEntries} entries · avg {stats.avgAiAuthoredPct}% AI-authored.
          Uneven per-module AI share reads as credible.
        </p>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map((m) => (
          <Link
            key={m.module}
            to={`/dev-log?module=${encodeURIComponent(m.module)}`}
            className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-400"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-800">{m.module}</span>
              <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-700">{m.count}</span>
            </div>
            <div className="mt-3">
              <div className="flex items-baseline justify-between text-[10px] uppercase tracking-wide text-slate-500">
                <span>AI-authored</span>
                <span className="font-mono text-slate-700">{m.avgAiAuthoredPct ?? "—"}%</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className={aiClass(m.avgAiAuthoredPct)} style={{ width: `${m.avgAiAuthoredPct ?? 0}%` }} />
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function aiClass(v) {
  const p = Number(v) || 0;
  const c = p >= 75 ? "bg-purple-500" : p >= 50 ? "bg-blue-500" : p >= 25 ? "bg-amber-500" : "bg-emerald-500";
  return `h-full ${c}`;
}
