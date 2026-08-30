import Card from "../components/ui/Card.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";

export default function PortalLanding({ portal, description, features = [] }) {
  return (
    <div className="space-y-5">
      <Card title={`${portal} portal`} subtitle={description}>
        <p className="text-sm text-slate-600">
          Portal shell ready. Feature pages will be wired in later prompts and
          appear as sidebar links.
        </p>
      </Card>

      {features.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-md border border-slate-200 bg-white p-4 shadow-sm"
            >
              <p className="text-xs uppercase tracking-wide text-slate-400">
                {f.tag}
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-800">
                {f.title}
              </p>
              <p className="mt-1 text-xs text-slate-500">{f.desc}</p>
            </div>
          ))}
        </div>
      )}

      <EmptyState
        title="No live data yet"
        description="Seed data and feature UIs land in later prompts. This shell only verifies routing, auth, and role isolation."
      />
    </div>
  );
}
