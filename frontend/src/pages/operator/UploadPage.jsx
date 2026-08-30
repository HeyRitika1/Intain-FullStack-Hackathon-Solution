import { useState } from "react";
import { Link } from "react-router-dom";
import { apiPost, apiUpload } from "../../lib/api.js";
import { formatBytes, sha256HexFromFile, truncMiddle } from "../../lib/format.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { toast } from "../../components/ui/Toast.jsx";
import Button from "../../components/ui/Button.jsx";
import Card from "../../components/ui/Card.jsx";
import Spinner from "../../components/ui/Spinner.jsx";
import DropZone from "../../components/DropZone.jsx";

const CARDS = [
  { fileType: "loan_tape", title: "Loan Tape", desc: "Canonical loan-level data.", accent: "blue" },
  { fileType: "servicer_update", title: "Servicer Update", desc: "Fresher balances / statuses.", accent: "amber" },
  { fileType: "document_manifest", title: "Document Manifest", desc: "Doc-level completeness.", accent: "emerald" },
];

const HEADER_TINT = {
  blue: "bg-blue-50 border-blue-100",
  amber: "bg-amber-50 border-amber-100",
  emerald: "bg-emerald-50 border-emerald-100",
};
const HEADER_TEXT = {
  blue: "text-blue-700",
  amber: "text-amber-700",
  emerald: "text-emerald-700",
};

export default function UploadPage() {
  const { user } = useAuth();
  const [states, setStates] = useState(() =>
    Object.fromEntries(CARDS.map((c) => [c.fileType, emptyState()]))
  );

  const patch = (fileType, partial) =>
    setStates((prev) => ({ ...prev, [fileType]: { ...prev[fileType], ...partial } }));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        {CARDS.map((c) => (
          <UploadCard
            key={c.fileType}
            card={c}
            state={states[c.fileType]}
            patch={(p) => patch(c.fileType, p)}
            role={user?.role}
          />
        ))}
      </div>
    </div>
  );
}

function emptyState() {
  return {
    file: null,
    clientHash: null,
    hashing: false,
    uploading: false,
    preview: null,
    activeTab: "summary",
    committing: false,
    commitResult: null,
    error: null,
  };
}

function UploadCard({ card, state, patch, role }) {
  const onFile = async (file, err) => {
    if (err) {
      patch({ error: err, file: null, clientHash: null });
      toast.error(err);
      return;
    }
    patch({ file, clientHash: null, hashing: true, error: null, preview: null, commitResult: null });
    try {
      const hash = await sha256HexFromFile(file);
      patch({ clientHash: hash, hashing: false });
    } catch {
      patch({ hashing: false, error: "Client-side hashing failed" });
    }
  };

  const clear = () => patch(emptyState());

  const upload = async () => {
    if (!state.file || state.uploading) return;
    patch({ uploading: true, error: null });
    try {
      const preview = await apiUpload("/ingest/upload", state.file, { fileType: card.fileType });
      patch({ preview, uploading: false, activeTab: "summary" });
      toast.info(`Preview ready: ${preview.rowCount} rows`);
    } catch (err) {
      patch({ uploading: false, error: err.message });
      toast.error(`Upload failed: ${err.message}`);
    }
  };

  const commit = async () => {
    const batchId = state.preview?.batchId;
    if (!batchId || state.committing) return;
    patch({ committing: true, error: null });
    try {
      const result = await apiPost(`/ingest/commit/${batchId}`);
      patch({ committing: false, commitResult: result });
      const already = result.alreadyCommitted;
      toast.success(
        already
          ? `Batch already committed (${result.status})`
          : `Committed ${result.committedCount} rows to ${card.title}`
      );
    } catch (err) {
      patch({ committing: false, error: err.message });
      toast.error(`Commit failed: ${err.message}`);
    }
  };

  const runValidation = async () => {
    if (role !== "admin") return;
    try {
      const affected = state.commitResult?.loanIdsAffected || [];
      const result = await apiPost("/rules/run", { loanIds: affected });
      toast.success(
        `Validation: +${result.exceptionsCreated} created, ${result.exceptionsUpdated} updated, ${result.exceptionsAutoDismissed} dismissed`
      );
    } catch (err) {
      toast.error(`Validation run failed: ${err.message}`);
    }
  };

  const hashMismatch =
    state.preview && state.clientHash && state.preview.fileHash && state.preview.fileHash !== state.clientHash;

  return (
    <Card
      title={<span className={HEADER_TEXT[card.accent]}>{card.title}</span>}
      subtitle={card.desc}
      className={HEADER_TINT[card.accent]}
      actions={
        state.file ? (
          <button
            type="button"
            onClick={clear}
            className="text-xs text-slate-500 hover:text-slate-800"
          >
            Reset
          </button>
        ) : null
      }
    >
      {!state.file && (
        <DropZone accent={card.accent} onFile={onFile} />
      )}

      {state.file && (
        <div className="space-y-3">
          <div className="rounded-md border border-slate-200 bg-white p-3 text-xs">
            <div className="font-medium text-slate-800">{state.file.name}</div>
            <div className="mt-0.5 text-slate-500">{formatBytes(state.file.size)}</div>
            <div className="mt-2 font-mono text-[11px] text-slate-500">
              sha256:{" "}
              {state.hashing ? "computing…" : state.clientHash ? truncMiddle(state.clientHash, 16, 8) : "-"}
            </div>
          </div>

          {!state.preview && (
            <Button onClick={upload} disabled={state.uploading || state.hashing} className="w-full">
              {state.uploading ? <Spinner size="sm" label="Uploading" /> : "Upload & Preview"}
            </Button>
          )}
        </div>
      )}

      {state.error && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {state.error}
        </div>
      )}

      {state.preview && (
        <PreviewPanel
          state={state}
          patch={patch}
          hashMismatch={hashMismatch}
          onCommit={commit}
          onRunValidation={runValidation}
          card={card}
          role={role}
        />
      )}
    </Card>
  );
}

function PreviewPanel({ state, patch, hashMismatch, onCommit, onRunValidation, card, role }) {
  const p = state.preview;
  const setTab = (tab) => patch({ activeTab: tab });
  const committed = Boolean(state.commitResult && !state.commitResult.alreadyCommitted);

  return (
    <div className="mt-4 rounded-md border border-slate-200 bg-white">
      <div className="flex border-b border-slate-200 text-xs">
        <TabBtn active={state.activeTab === "summary"} onClick={() => setTab("summary")}>Summary</TabBtn>
        <TabBtn active={state.activeTab === "preview"} onClick={() => setTab("preview")}>Preview ({p.previewRows.length})</TabBtn>
        <TabBtn active={state.activeTab === "failed"} onClick={() => setTab("failed")}>Failed ({p.failedRowCount})</TabBtn>
      </div>

      <div className="max-h-64 overflow-auto p-3 text-xs">
        {state.activeTab === "summary" && (
          <dl className="grid grid-cols-2 gap-y-1">
            <Kv k="batchId" v={truncMiddle(p.batchId, 8, 6)} mono />
            <Kv k="rowCount" v={p.rowCount} />
            <Kv k="normalizedCount" v={p.normalizedCount} />
            <Kv k="failedRowCount" v={p.failedRowCount} />
            <Kv
              k="fileHash"
              v={
                <span className={hashMismatch ? "text-red-600" : ""}>
                  {truncMiddle(p.fileHash || "", 8, 6)}
                  {hashMismatch && " (mismatch)"}
                </span>
              }
              mono
            />
            {p.warnings?.length > 0 && (
              <div className="col-span-2 mt-2 rounded bg-amber-50 px-2 py-1 text-amber-800">
                {p.warnings.join(" · ")}
              </div>
            )}
          </dl>
        )}

        {state.activeTab === "preview" && (
          <PreviewRowsTable rows={p.previewRows} />
        )}

        {state.activeTab === "failed" && (
          p.failedRows?.length ? (
            <div className="space-y-2">
              {p.failedRows.map((r, i) => (
                <div key={i} className="rounded border border-red-200 bg-red-50 p-2">
                  <div className="text-red-800">row {r.rowIndex}: {r.reason}</div>
                  <pre className="mt-1 overflow-x-auto text-[11px] text-slate-700">
{JSON.stringify(r.rawRow, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-slate-500">No failed rows.</div>
          )
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-3 py-2">
        <div className="text-xs text-slate-500">
          {state.commitResult
            ? state.commitResult.alreadyCommitted
              ? "Already committed."
              : `Committed ${state.commitResult.committedCount} rows.`
            : "Nothing committed yet."}
        </div>
        <div className="flex items-center gap-2">
          {state.commitResult ? (
            <Link to="/operator/imports" className="text-xs text-blue-700 hover:underline">
              View in Import History →
            </Link>
          ) : (
            <Button size="sm" onClick={onCommit} disabled={state.committing}>
              {state.committing ? <Spinner size="sm" label="Committing" /> : "Commit"}
            </Button>
          )}
        </div>
      </div>

      {committed && card.fileType === "loan_tape" && (
        <div className="border-t border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-900">
          <div className="flex items-center justify-between gap-2">
            <span>
              {state.commitResult.committedCount} loans committed. {role === "admin" ? "Run validation on this batch?" : "Ask a Reviewer to run validation."}
            </span>
            {role === "admin" && (
              <Button size="sm" variant="secondary" onClick={onRunValidation}>
                Run validation
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2 transition ${active ? "border-b-2 border-slate-900 font-medium text-slate-900" : "text-slate-500 hover:text-slate-800"}`}
    >
      {children}
    </button>
  );
}

function Kv({ k, v, mono }) {
  return (
    <>
      <dt className="text-slate-500">{k}</dt>
      <dd className={mono ? "font-mono text-slate-800" : "text-slate-800"}>{v}</dd>
    </>
  );
}

function PreviewRowsTable({ rows }) {
  if (!rows?.length) return <div className="text-slate-500">No rows to preview.</div>;
  const cols = Object.keys(rows[0]).filter((k) => !k.startsWith("_"));
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-[11px]">
        <thead>
          <tr className="bg-slate-50 text-slate-600">
            {cols.map((c) => (
              <th key={c} className="whitespace-nowrap px-2 py-1 text-left font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <tr key={i} className="text-slate-700">
              {cols.map((c) => (
                <td key={c} className="whitespace-nowrap px-2 py-1">
                  {formatCell(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatCell(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
