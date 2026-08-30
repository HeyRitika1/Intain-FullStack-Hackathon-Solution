import { relativeTime } from "../lib/format.js";
import Button from "./ui/Button.jsx";

// Right-side controls used by all three role dashboards.
export default function DashboardControls({ enabled, setEnabled, refresh, busy, loadedAt }) {
  return (
    <div className="flex items-center gap-2 text-xs text-slate-500">
      {loadedAt && <span>updated {relativeTime(loadedAt.toISOString())}</span>}
      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-3 w-3 cursor-pointer"
        />
        <span>Auto-refresh 30s</span>
      </label>
      <Button size="sm" variant="secondary" onClick={refresh} disabled={busy}>
        {busy ? "…" : "Refresh"}
      </Button>
    </div>
  );
}
