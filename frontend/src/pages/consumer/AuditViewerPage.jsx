import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiGet } from "../../lib/api.js";
import { toast } from "../../components/ui/Toast.jsx";
import Card from "../../components/ui/Card.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import Spinner from "../../components/ui/Spinner.jsx";
import Badge from "../../components/ui/Badge.jsx";
import AuditTimeline from "../../components/audit/AuditTimeline.jsx";
import TrustScoreBadge from "../../components/TrustScoreBadge.jsx";
import { copyToClipboard, truncMiddle } from "../../lib/format.js";

export default function AuditViewerPage() {
  const [params, setParams] = useSearchParams();
  const selectedLoanId = params.get("loanId") || null;
  const setSelected = (id) => {
    const next = new URLSearchParams(params);
    if (id) next.set("loanId", id);
    else next.delete("loanId");
    setParams(next, { replace: false });
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
      <VerifiedList selectedLoanId={selectedLoanId} onSelect={setSelected} />
      <div className="min-w-0">
        {selectedLoanId ? (
          <SelectedLoanView loanId={selectedLoanId} />
        ) : (
          <Card title="Select a verified loan" subtitle="Full hash-chained history + verified-loan-record header.">
            <p className="text-sm text-slate-600">
              Pick any verified loan on the left to inspect its complete audit trail.
              Any tampering with an earlier event breaks the chain and lights the banner red.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

// ---------------- verified loans list ----------------

function VerifiedList({ selectedLoanId, onSelect }) {
  const [items, setItems] = useState(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams({ limit: "100" });
    if (q) qs.set("q", q);
    apiGet(`/verified?${qs.toString()}`)
      .then((r) => { if (!cancelled) setItems(r.items || []); })
      .catch((err) => { if (!cancelled) toast.error(`Load failed: ${err.message}`); });
    return () => { cancelled = true; };
  }, [q]);

  return (
    <Card title="Verified loans">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="loanId or borrower…"
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
      />
      <div className="mt-3 max-h-[70vh] overflow-y-auto">
        {items === null && <Spinner label="Loading" />}
        {items && items.length === 0 && (
          <EmptyState
            title="No verified loans yet"
            description="Have a reviewer verify a loan via the queue to see it here."
          />
        )}
        {items && items.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {items.map((r) => (
              <li key={r.loanId}>
                <button
                  type="button"
                  onClick={() => onSelect(r.loanId)}
                  className={`w-full rounded-md px-2 py-2 text-left text-sm hover:bg-slate-50 ${selectedLoanId === r.loanId ? "bg-emerald-50 ring-1 ring-emerald-300" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-slate-700">{r.loanId}</span>
                    <TrustScoreBadge score={r.trustScore} breakdown={r.trustBreakdown} size="sm" />
                  </div>
                  <div className="mt-0.5 text-xs text-slate-600">{r.snapshot?.borrowerName || "—"}</div>
                  <div className="text-[11px] text-slate-500">
                    verified {formatRelative(r.verifiedAt)}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function TrustBadge({ score }) {
  const s = Number(score);
  if (!Number.isFinite(s)) return <Badge tone="slate">n/a</Badge>;
  const tone = s >= 85 ? "emerald" : s >= 70 ? "amber" : "red";
  return <Badge tone={tone}>{s}</Badge>;
}

function formatRelative(iso) {
  if (!iso) return "—";
  const t = new Date(iso);
  const days = Math.round((Date.now() - t.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

// ---------------- selected loan view ----------------

function SelectedLoanView({ loanId }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setData(null); setErr(null);
    apiGet(`/verified/${encodeURIComponent(loanId)}`)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => {
        if (cancelled) return;
        if (e.status === 404) setErr("No verified record for this loan yet.");
        else setErr(e.message || "Load failed");
      });
    return () => { cancelled = true; };
  }, [loanId]);

  if (err) {
    return <Card><EmptyState title="Not verified" description={err} /></Card>;
  }
  if (!data) return <Spinner label="Loading verified loan" />;

  const { record, chainOk } = data;
  return (
    <div className="space-y-4">
      <VerifiedRecordHeader record={record} chainOk={chainOk} />
      <Card title="Audit trail" subtitle="Every event on this loan, hash-linked in order.">
        <AuditTimeline loanId={loanId} maxHeight="70vh" />
      </Card>
    </div>
  );
}

// ---------------- verified record header ----------------

function VerifiedRecordHeader({ record, chainOk }) {
  return (
    <Card
      title={
        <span>
          {record.snapshot?.loanId}
          <span className="text-slate-500"> · {record.snapshot?.borrowerName || "—"}</span>
        </span>
      }
      subtitle="Verified Loan Record"
      actions={
        <div className="flex items-center gap-2">
          <Badge tone={chainOk ? "emerald" : "red"}>
            {chainOk ? "chain OK" : "chain BROKEN"}
          </Badge>
          <TrustScoreBadge
            score={record.trustScore}
            breakdown={record.trustBreakdown}
            size="lg"
          />
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SnapshotBlock snapshot={record.snapshot} />
        <TrustBlock record={record} />
        <ChainProofBlock record={record} />
      </div>
    </Card>
  );
}

function SnapshotBlock({ snapshot }) {
  const rows = snapshot ? Object.entries(snapshot).filter(([k]) => !k.startsWith("_") && k !== "verificationStatus") : [];
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/50 p-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Snapshot</h4>
      <dl className="mt-2 grid grid-cols-[minmax(0,110px)_minmax(0,1fr)] gap-y-1 text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="truncate text-slate-500">{k}</dt>
            <dd className="break-words font-mono text-slate-800">{formatVal(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function TrustBlock({ record }) {
  const b = record.trustBreakdown || {};
  return (
    <div className="rounded-md border border-emerald-200 bg-emerald-50/40 p-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Trust</h4>
      <div className="mt-1 text-2xl font-semibold text-emerald-900">{record.trustScore ?? "—"}</div>
      <dl className="mt-2 grid grid-cols-2 gap-y-1 text-xs text-emerald-900">
        <dt className="text-emerald-800/70">Completeness</dt><dd className="font-mono">{b.completeness ?? "—"}</dd>
        <dt className="text-emerald-800/70">Consistency</dt><dd className="font-mono">{b.consistency ?? "—"}</dd>
        <dt className="text-emerald-800/70">Freshness</dt><dd className="font-mono">{b.freshness ?? "—"}</dd>
        <dt className="text-emerald-800/70">Coverage</dt><dd className="font-mono">{b.reviewCoverage ?? "—"}</dd>
      </dl>
      <p className="mt-2 text-[10px] text-emerald-800/70">
        verifiedAt {shortDate(record.verifiedAt)}
        {record.verifiedBy ? ` · by ${String(record.verifiedBy).slice(-6)}` : " · system"}
      </p>
    </div>
  );
}

function ChainProofBlock({ record }) {
  const copy = async (label, val) => {
    const ok = await copyToClipboard(val);
    toast[ok ? "info" : "error"](ok ? `${label} copied` : "copy failed");
  };
  return (
    <div className="rounded-md border border-blue-200 bg-blue-50/40 p-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-blue-800">Chain proof</h4>
      <p className="mt-1 text-[11px] text-blue-900/80">
        The record hash covers the full snapshot + prevAuditHash. Any change to earlier history would break this link.
      </p>
      <div className="mt-2 space-y-1 text-[11px]">
        <HashRow label="recordHash" value={record.recordHash} onCopy={copy} />
        <HashRow label="prevAuditHash" value={record.prevAuditHash} onCopy={copy} />
      </div>
    </div>
  );
}

function HashRow({ label, value, onCopy }) {
  return (
    <div className="flex items-center gap-2 font-mono text-blue-900">
      <span className="text-blue-800/70">{label}:</span>
      <span title={value}>{truncMiddle(value || "", 8, 8)}</span>
      <button
        type="button"
        onClick={() => onCopy(label, value)}
        aria-label={`Copy ${label}`}
        className="rounded border border-blue-200 bg-white px-1 text-[9px] text-blue-700 hover:bg-blue-100"
      >
        copy
      </button>
    </div>
  );
}

function formatVal(v) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10);
  return String(v);
}
function shortDate(v) {
  if (!v) return "—";
  return String(v).slice(0, 10);
}
