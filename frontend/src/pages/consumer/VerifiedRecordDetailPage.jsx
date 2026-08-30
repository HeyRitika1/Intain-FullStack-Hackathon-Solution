import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiGet, apiPost } from "../../lib/api.js";
import { copyToClipboard, relativeTime, truncMiddle } from "../../lib/format.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { toast } from "../../components/ui/Toast.jsx";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import Badge from "../../components/ui/Badge.jsx";
import Spinner from "../../components/ui/Spinner.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import AuditTimeline from "../../components/audit/AuditTimeline.jsx";
import TrustScoreBadge from "../../components/TrustScoreBadge.jsx";

const SNAPSHOT_ORDER = [
  "loanId","borrowerId","borrowerName","state",
  "originationDate","maturityDate","originalPrincipal","currentBalance",
  "interestRate","paymentStatus","daysPastDue","lastUpdatedAt","documentStatus",
  "sourceBatchId","servicerUpdateBatchId","sourceRowIndex",
];

export default function VerifiedRecordDetailPage() {
  const { loanId } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  const reload = () => {
    setData(null); setErr(null);
    apiGet(`/verified/${encodeURIComponent(loanId)}`)
      .then(setData)
      .catch((e) => setErr(e.status === 404 ? "No verified record for this loan yet." : e.message));
  };
  useEffect(reload, [loanId]);

  if (err) return <Card><EmptyState title="Not verified" description={err} action={<Link to="/consumer/verified" className="text-emerald-700 underline">← Back to verified records</Link>} /></Card>;
  if (!data) return <Spinner label="Loading verified record" />;

  const { record, chainOk } = data;
  const s = record.snapshot || {};

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link to="/consumer/verified" className="text-xs text-slate-500 underline hover:text-slate-700">← Back to verified records</Link>
      </div>

      <HeaderPanel record={record} chainOk={chainOk} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
        <div className="space-y-4">
          <SnapshotPanel snapshot={s} />
          <ChainProofPanel record={record} />
          <Card title="Audit trail" subtitle="Every event on this loan, hash-linked in order.">
            <AuditTimeline loanId={loanId} maxHeight="70vh" />
          </Card>
        </div>
        <div className="space-y-4">
          <TrustBreakdownPanel loanId={loanId} record={record} onReverified={reload} />
        </div>
      </div>
    </div>
  );
}

function HeaderPanel({ record, chainOk }) {
  const s = record.snapshot || {};
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-6">
        <TrustScoreBadge score={record.trustScore} breakdown={record.trustBreakdown} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="text-xs uppercase tracking-wide text-slate-500">Verified Loan Record</div>
          <div className="text-xl font-semibold text-slate-800">
            {s.loanId}
            <span className="ml-2 text-base font-normal text-slate-500">· {s.borrowerName || "—"}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-600">
            <span>verified {relativeTime(record.verifiedAt)}</span>
            <span className="text-slate-300">|</span>
            <span>by {record.verifiedBy ? String(record.verifiedBy).slice(-6) : "system"}</span>
            <span className="text-slate-300">|</span>
            <Badge tone={chainOk ? "emerald" : "red"}>
              {chainOk ? "✓ chain integrity verified" : "✕ chain BROKEN"}
            </Badge>
          </div>
        </div>
      </div>
    </Card>
  );
}

function SnapshotPanel({ snapshot }) {
  const rows = useMemo(() => {
    const seen = new Set();
    const ordered = SNAPSHOT_ORDER.filter((k) => snapshot[k] !== undefined).map((k) => { seen.add(k); return [k, snapshot[k]]; });
    const rest = Object.entries(snapshot).filter(([k]) => !seen.has(k) && !k.startsWith("_") && k !== "verificationStatus");
    return [...ordered, ...rest];
  }, [snapshot]);

  return (
    <Card
      title="Snapshot"
      subtitle="Canonical loan data at the moment of verification — read-only."
      actions={<Badge tone="blue">✓ certified</Badge>}
      className="relative overflow-hidden"
    >
      <div aria-hidden className="pointer-events-none absolute -right-6 -top-6 select-none text-[10rem] leading-none text-blue-100">
        ✓
      </div>
      <dl className="relative grid grid-cols-1 gap-y-1 text-sm md:grid-cols-2 md:gap-x-8">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b border-slate-50 py-1">
            <dt className="text-xs uppercase tracking-wide text-slate-500">{prettyKey(k)}</dt>
            <dd className="font-mono text-xs text-slate-800">{formatVal(v)}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function ChainProofPanel({ record }) {
  const copy = async (label, value) => {
    const ok = await copyToClipboard(value);
    toast[ok ? "info" : "error"](ok ? `${label} copied` : "copy failed");
  };
  return (
    <Card title="Chain proof" subtitle="Cryptographic link between this record and prior history.">
      <p className="text-xs text-slate-600">
        This record's hash is derived from its full contents and the previous audit event's hash.
        Any change to earlier history would break this link.
      </p>
      <div className="mt-3 space-y-2 text-xs">
        <HashRow label="recordHash" value={record.recordHash} onCopy={copy} />
        <HashRow label="prevAuditHash" value={record.prevAuditHash} onCopy={copy} />
      </div>
    </Card>
  );
}

function HashRow({ label, value, onCopy }) {
  return (
    <div className="flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
      <span className="w-28 shrink-0 text-slate-500">{label}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-slate-800" title={value}>
        {truncMiddle(value || "", 16, 16)}
      </span>
      <button
        type="button"
        onClick={() => onCopy(label, value)}
        className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] text-slate-700 hover:bg-slate-100"
        aria-label={`Copy ${label}`}
      >
        copy
      </button>
    </div>
  );
}

function TrustBreakdownPanel({ loanId, record, onReverified }) {
  const { user } = useAuth();
  const isConsumer = user?.role === "consumer";
  const [drift, setDrift] = useState(null);
  const [busy, setBusy] = useState(false);

  const check = async () => {
    setBusy(true);
    try {
      const r = await apiGet(`/verified/${encodeURIComponent(loanId)}/trust`);
      setDrift(r);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const reverify = async () => {
    if (!window.confirm("Re-verify this loan against current data? A new VerifiedLoanRecord will be appended.")) return;
    setBusy(true);
    try {
      await apiPost(`/verified/${encodeURIComponent(loanId)}`, {});
      toast.info("Re-verified.");
      onReverified?.();
      setDrift(null);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const b = record.trustBreakdown || {};
  const bars = [
    ["Completeness", b.completeness, drift?.current?.breakdown?.completeness],
    ["Consistency", b.consistency, drift?.current?.breakdown?.consistency],
    ["Freshness", b.freshness, drift?.current?.breakdown?.freshness],
    ["Review coverage", b.reviewCoverage, drift?.current?.breakdown?.reviewCoverage],
  ];

  const deltas = drift?.drift
    ? bars
        .filter(([, stored, current]) => Number.isFinite(current) && Number(stored) !== Number(current))
        .map(([label, stored, current]) => `${label.toLowerCase()} ${current - stored > 0 ? "+" : ""}${current - stored}`)
    : [];

  return (
    <Card title="Trust breakdown" subtitle="Why this loan scored what it did.">
      <div className="space-y-2">
        {bars.map(([label, stored, current]) => (
          <BreakdownBar key={label} label={label} stored={stored} current={current} />
        ))}
      </div>
      {record.trustNotes?.length > 0 && (
        <ul className="mt-3 list-disc space-y-0.5 border-t border-slate-100 pt-2 pl-4 text-[11px] text-slate-600">
          {record.trustNotes.slice(0, 6).map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <span className="text-xs text-slate-500">Recompute against current data</span>
        <Button size="sm" variant="secondary" onClick={check} disabled={busy}>
          {busy ? "…" : drift ? "Refresh" : "Check drift"}
        </Button>
      </div>
      {drift?.drift && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <div className="font-semibold">This loan has changed since verification.</div>
          <div className="mt-1">Delta: {deltas.join(", ") || "scores differ"}. Consider re-verification.</div>
          {!isConsumer && (
            <Button size="sm" className="mt-2" onClick={reverify} disabled={busy}>Re-verify</Button>
          )}
        </div>
      )}
      {drift && !drift.drift && (
        <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
          Current data matches the verified snapshot. No drift.
        </div>
      )}
    </Card>
  );
}

function BreakdownBar({ label, stored, current }) {
  const v = Number.isFinite(Number(stored)) ? Number(stored) : 0;
  const cls = v >= 85 ? "bg-emerald-500" : v >= 70 ? "bg-amber-500" : "bg-red-500";
  const drift = Number.isFinite(Number(current)) && Number(current) !== v;
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-slate-600">{label}</span>
        <span className="font-mono text-slate-800">
          {stored ?? "—"}
          {drift && (
            <span className="ml-1 text-amber-700">→ {current}</span>
          )}
        </span>
      </div>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full ${cls}`} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

function prettyKey(k) {
  return k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

function formatVal(v) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10);
  return String(v);
}
