import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import client, { exportBundle, exportVerified } from "../../lib/api.js";
import { recomputeBundleHash } from "../../lib/hash.js";
import { formatBytes, truncMiddle } from "../../lib/format.js";
import { toast } from "../../components/ui/Toast.jsx";
import Card from "../../components/ui/Card.jsx";
import Button from "../../components/ui/Button.jsx";
import Badge from "../../components/ui/Badge.jsx";

const BUNDLE_CONTENTS = [
  "Latest verified loan records (snapshot + trustScore + trustBreakdown)",
  "recordHash + prevAuditHash per loan (chain proof)",
  "chainOk per loan (recomputed at export)",
  "Full audit trail per loan (upload → validate → decisions → verified → exported)",
  "All AI recommendations referenced by exported loans (prompt + model + fallback flag)",
  "All human review decisions",
  "Active + approved validation rules",
  "Portfolio summary (counts + trust)",
  "bundleHash — sha256 of the canonical bundle (verify client-side)",
];

function useUrlFilters() {
  const [params, setParams] = useSearchParams();
  const filters = {
    q: params.get("q") || "",
    state: params.get("state") || "",
    minTrustScore: params.get("minTrustScore") || "",
    verifiedAfter: params.get("verifiedAfter") || "",
  };
  const setFilters = (patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (!v) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: false });
  };
  return [filters, setFilters];
}

function serverFilters(f) {
  const out = {};
  if (f.q) out.q = f.q;
  if (f.state) out.state = f.state;
  if (f.minTrustScore) out.minTrustScore = f.minTrustScore;
  if (f.verifiedAfter) out.verifiedAfter = f.verifiedAfter;
  return out;
}

export default function ExportPage() {
  const [filters, setFilters] = useUrlFilters();
  const [preview, setPreview] = useState(null);
  const [verify, setVerify] = useState(null);
  const [busy, setBusy] = useState(false);

  const runPreview = async () => {
    setBusy(true);
    setPreview(null); setVerify(null);
    try {
      const qs = new URLSearchParams(serverFilters(filters));
      const [csvRes, bundleRes] = await Promise.all([
        client.get(`/verified/export?format=csv&${qs.toString()}`, { responseType: "blob" }),
        client.get(`/verified/export/bundle?${qs.toString()}`, { responseType: "blob" }),
      ]);
      const csvBlob = csvRes.data;
      const bundleBlob = bundleRes.data;
      const bundleText = await bundleBlob.text();
      const bundle = JSON.parse(bundleText);
      const localHash = await recomputeBundleHash(bundle);
      const match = localHash === bundle.bundleHash;
      setPreview({
        csvSize: csvBlob.size,
        bundleSize: bundleBlob.size,
        loanCount: bundle.verifiedLoans?.length || 0,
        eventCount: Object.values(bundle.auditTrails || {}).reduce((n, arr) => n + (arr?.length || 0), 0),
      });
      setVerify({ serverHash: bundle.bundleHash, localHash, match });
    } catch (e) {
      toast.error(`Preview failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const doExport = async (kind) => {
    setBusy(true);
    try {
      const fn = kind === "csv" ? exportVerified : exportBundle;
      const args = kind === "csv" ? ["csv", serverFilters(filters)] : [serverFilters(filters)];
      const r = await fn(...args);
      toast.info(`Downloaded ${r.filename}`);
    } catch (e) {
      toast.error(`Export failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card title="Export verified dataset" subtitle="Portable, hash-sealed data drawn from the append-only VerifiedLoanRecord ledger.">
        <ul className="ml-5 list-disc space-y-1 text-sm text-slate-700">
          {BUNDLE_CONTENTS.map((b) => <li key={b}>{b}</li>)}
        </ul>
        <p className="mt-3 text-[11px] text-slate-500">
          Every export is logged as an <code>exported</code> event in the audit trail.
        </p>
      </Card>

      <Card title="Filters" subtitle="Same filters as the Verified Records browse.">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Search">
            <input
              value={filters.q}
              onChange={(e) => setFilters({ q: e.target.value })}
              placeholder="loanId or borrower…"
              className="w-56 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="State">
            <input
              value={filters.state}
              onChange={(e) => setFilters({ state: e.target.value.toUpperCase().slice(0, 2) })}
              placeholder="TX"
              className="w-16 rounded-md border border-slate-300 px-2 py-1.5 text-center font-mono text-sm uppercase"
            />
          </Field>
          <Field label={`Min trust: ${filters.minTrustScore || 0}`}>
            <input
              type="range" min="0" max="100" step="5"
              value={Number(filters.minTrustScore || 0)}
              onChange={(e) => setFilters({ minTrustScore: e.target.value === "0" ? "" : e.target.value })}
              className="w-40"
            />
          </Field>
          <Field label="Verified after">
            <input
              type="date"
              value={filters.verifiedAfter}
              onChange={(e) => setFilters({ verifiedAfter: e.target.value })}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </Field>
        </div>
      </Card>

      <Card title="Download" actions={<Button variant="secondary" onClick={runPreview} disabled={busy}>Preview</Button>}>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => doExport("csv")} disabled={busy}>Download CSV</Button>
          <Button onClick={() => doExport("bundle")} disabled={busy}>Download JSON Bundle</Button>
        </div>
        {preview && (
          <div className="mt-4 grid gap-3 border-t border-slate-100 pt-3 text-sm md:grid-cols-4">
            <Kpi label="Loans" value={preview.loanCount} />
            <Kpi label="Audit events" value={preview.eventCount} />
            <Kpi label="CSV size" value={formatBytes(preview.csvSize)} />
            <Kpi label="Bundle size" value={formatBytes(preview.bundleSize)} />
          </div>
        )}
        {verify && (
          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
            <div className="mb-1 flex items-center gap-2">
              <span className="font-semibold text-slate-700">Bundle hash verification</span>
              <Badge tone={verify.match ? "emerald" : "red"}>
                {verify.match ? "✓ MATCH" : "✕ MISMATCH"}
              </Badge>
            </div>
            <div className="font-mono">
              <div>server: <span title={verify.serverHash}>{truncMiddle(verify.serverHash, 16, 16)}</span></div>
              <div>client: <span title={verify.localHash}>{truncMiddle(verify.localHash, 16, 16)}</span></div>
            </div>
            <p className="mt-1 text-slate-500">
              Recomputed client-side via sha256(canonicalStringify(bundle − bundleHash)).
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-500">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Kpi({ label, value }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-lg font-semibold text-slate-800">{value}</div>
    </div>
  );
}
