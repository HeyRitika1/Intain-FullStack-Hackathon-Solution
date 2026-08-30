import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { roleHomePath, useAuth } from "../context/AuthContext.jsx";

const SEEDED = [
  { email: "operator@intain.test",  password: "Operator@123", role: "operator" },
  { email: "reviewer@intain.test",  password: "Reviewer@123", role: "reviewer" },
  { email: "consumer@intain.test",  password: "Consumer@123", role: "consumer" },
  { email: "admin@intain.test",     password: "Admin@1234",   role: "admin"    },
];

export default function Home() {
  const { user, loading } = useAuth();
  const [health, setHealth] = useState(null);
  const [summary, setSummary] = useState(null);
  const [healthErr, setHealthErr] = useState(null);
  const [summaryErr, setSummaryErr] = useState(null);

  useEffect(() => {
    api.get("/health").then(setHealth).catch((e) => setHealthErr(e.message));
    // Unauth /summary is a 401 by design — treat gracefully.
    api.get("/summary").then(setSummary).catch((e) => setSummaryErr(e.status || e.message));
  }, []);

  if (loading) return null;
  if (user) return <Navigate to={roleHomePath(user.role)} replace />;

  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-bold text-slate-900">Intain Verify</h1>
      <p className="mt-2 text-slate-600">
        Loan Data Verification Copilot.{" "}
        <Link to="/login" className="text-blue-600 hover:underline">
          Log in to enter a portal
        </Link>
        .
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <PortalCard title="Data Operator" desc="Upload loan tapes, servicer updates, document manifests." accent="bg-blue-600" />
        <PortalCard title="Reviewer" desc="Work the exception queue with the AI Review Assistant." accent="bg-amber-500" />
        <PortalCard title="Data Consumer" desc="Browse verified records, trust scores, and the audit trail." accent="bg-emerald-600" />
        <PortalCard title="Dev Log" desc="Agentic-coding evidence and caught-bad-AI entries." accent="bg-slate-700" />
      </div>

      <div className="mt-10 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">System status</h2>
        {healthErr ? (
          <p className="mt-2 text-sm text-red-600">
            API not reachable — is <code>npm run dev</code> running on :4000? ({healthErr})
          </p>
        ) : health ? (
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <Chip tone={health.ok ? "emerald" : "red"}>API {health.ok ? "OK" : "down"}</Chip>
            <Chip tone={health.db === "connected" ? "emerald" : "amber"}>db {health.db}</Chip>
            <Chip tone="slate">auth {health.authRoutes}</Chip>
            <Chip tone="slate" title={health.time}>time {new Date(health.time).toLocaleTimeString()}</Chip>
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-400">Checking…</p>
        )}
        <div className="mt-3 text-xs text-slate-600">
          {summary ? (
            <>
              Portfolio counts:
              {" "}<code>loans={summary.counts?.loans?.total}</code>
              {" "}<code>verified={summary.counts?.loans?.verified}</code>
              {" "}<code>open exceptions={summary.counts?.exceptions?.open}</code>
              {" "}<code>trust={summary.trust?.portfolioTrustScore}</code>
            </>
          ) : summaryErr === 401 ? (
            <span className="text-slate-500">
              Portfolio counts are private. <Link to="/login" className="text-blue-600 hover:underline">Log in</Link> to view.
            </span>
          ) : summaryErr ? (
            <span className="text-slate-500">Portfolio counts unavailable ({String(summaryErr)}).</span>
          ) : (
            <span className="text-slate-400">Loading…</span>
          )}
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Seeded demo users</h2>
        <p className="mt-1 text-xs text-slate-500">Click a credential to auto-fill the login form.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {SEEDED.map((u) => (
            <Link
              key={u.email}
              to={`/login?email=${encodeURIComponent(u.email)}&password=${encodeURIComponent(u.password)}`}
              className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs hover:border-slate-400 hover:bg-white"
            >
              <span>
                <span className="font-mono text-slate-800">{u.email}</span>
                <span className="ml-2 text-slate-500">/ {u.password}</span>
              </span>
              <Chip tone={roleTone(u.role)}>{u.role}</Chip>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function PortalCard({ title, desc, accent }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className={`mb-3 h-2 w-10 rounded-full ${accent}`} />
      <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 text-sm text-slate-600">{desc}</p>
    </div>
  );
}

function Chip({ tone = "slate", children, title }) {
  const map = {
    slate: "bg-slate-100 text-slate-700",
    emerald: "bg-emerald-100 text-emerald-800",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-800",
    blue: "bg-blue-100 text-blue-800",
    purple: "bg-purple-100 text-purple-800",
  };
  return (
    <span title={title} className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${map[tone]}`}>
      {children}
    </span>
  );
}

function roleTone(role) {
  return role === "operator" ? "blue" : role === "reviewer" ? "amber" : role === "consumer" ? "emerald" : "purple";
}