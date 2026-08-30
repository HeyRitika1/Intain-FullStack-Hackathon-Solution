import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../../lib/api.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { copyToClipboard, relativeTime, truncMiddle } from "../../lib/format.js";
import { toast } from "../../components/ui/Toast.jsx";
import Badge from "../../components/ui/Badge.jsx";
import Button from "../../components/ui/Button.jsx";
import Card from "../../components/ui/Card.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import Spinner from "../../components/ui/Spinner.jsx";

const FILETYPE_TONE = {
  loan_tape: "blue",
  servicer_update: "amber",
  document_manifest: "emerald",
};

export default function ImportHistoryPage() {
  const [items, setItems] = useState(null);
  const [selected, setSelected] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiGet("/ingest/imports")
      .then((res) => { if (!cancelled) setItems(res.items || []); })
      .catch((err) => { if (!cancelled) toast.error(`Load failed: ${err.message}`); });
    return () => { cancelled = true; };
  }, [refreshTick]);

  return (
    <div className="space-y-4">
      <Card
        title="Import history"
        subtitle="Every uploaded batch, newest first."
        actions={<Button size="sm" variant="secondary" onClick={() => setRefreshTick((t) => t + 1)}>Refresh</Button>}
      >
        {items === null && <Spinner label="Loading imports" />}
        {items && items.length === 0 && (
          <EmptyState title="No imports yet" description="Upload a CSV from the Uploads page to see it here." />
        )}
        {items && items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-2">Batch</th>
                  <th className="px-2 py-2">Type</th>
                  <th className="px-2 py-2">Filename</th>
                  <th className="px-2 py-2">Uploaded by</th>
                  <th className="px-2 py-2 text-right">Rows</th>
                  <th className="px-2 py-2 text-right">Normalized</th>
                  <th className="px-2 py-2 text-right">Failed</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((i) => (
                  <tr
                    key={i.batchId}
                    onClick={() => setSelected(i.batchId)}
                    className="cursor-pointer hover:bg-slate-50"
                  >
                    <td className="px-2 py-2 font-mono text-xs text-slate-700">
                      <BatchIdCell id={i.batchId} />
                    </td>
                    <td className="px-2 py-2"><Badge tone={FILETYPE_TONE[i.fileType] || "slate"}>{i.fileType}</Badge></td>
                    <td className="px-2 py-2 text-slate-700">{i.originalFilename}</td>
                    <td className="px-2 py-2 text-slate-600">{i.uploadedByUser?.email || "-"}</td>
                    <td className="px-2 py-2 text-right text-slate-700">{i.rowCount}</td>
                    <td className="px-2 py-2 text-right text-slate-700">{i.normalizedCount}</td>
                    <td className={`px-2 py-2 text-right ${i.failedRowCount > 0 ? "text-red-600" : "text-slate-700"}`}>{i.failedRowCount}</td>
                    <td className="px-2 py-2"><Badge tone={i.status === "normalized" ? "emerald" : "slate"}>{i.status}</Badge></td>
                    <td className="px-2 py-2 text-xs text-slate-500">{relativeTime(i.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selected && (
        <ImportDetailDrawer
          batchId={selected}
          onClose={() => setSelected(null)}
          onValidationRan={() => setRefreshTick((t) => t + 1)}
        />
      )}
    </div>
  );
}

function BatchIdCell({ id }) {
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        const ok = await copyToClipboard(id);
        toast[ok ? "info" : "error"](ok ? "batchId copied" : "copy failed");
      }}
      className="hover:text-slate-900"
      title={id}
    >
      {truncMiddle(id, 8, 6)}
    </button>
  );
}

function ImportDetailDrawer({ batchId, onClose, onValidationRan }) {
  const { user } = useAuth();
  const [doc, setDoc] = useState(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiGet(`/ingest/imports/${batchId}`)
      .then((d) => { if (!cancelled) setDoc(d); })
      .catch((err) => { if (!cancelled) toast.error(`Load failed: ${err.message}`); });
    return () => { cancelled = true; };
  }, [batchId]);

  const canRunValidation = user && ["admin", "reviewer"].includes(user.role);

  const runValidation = async () => {
    if (!doc || running) return;
    setRunning(true);
    try {
      const affected = [
        ...(doc.notes?.committedLoanIds || []),
        ...(doc.notes?.linkedLoanIds || []),
      ];
      const body = affected.length ? { loanIds: affected } : {};
      const res = await apiPost("/rules/run", body);
      toast.success(
        `Validation: +${res.exceptionsCreated} created, ${res.exceptionsUpdated} updated, ${res.exceptionsAutoDismissed} dismissed`
      );
      onValidationRan?.();
    } catch (err) {
      toast.error(`Validation run failed: ${err.message}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-2xl flex-col overflow-y-auto border-l border-slate-200 bg-white">
        <header className="flex items-start justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Import detail</h2>
            <p className="mt-0.5 font-mono text-xs text-slate-500">{batchId}</p>
          </div>
          <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-800">Close</button>
        </header>

        <div className="flex-1 space-y-4 p-5">
          {!doc && <Spinner label="Loading batch" />}
          {doc && (
            <>
              <section className="rounded-md border border-slate-200 p-3 text-sm">
                <div className="grid grid-cols-2 gap-y-1">
                  <span className="text-slate-500">fileType</span><span>{doc.fileType}</span>
                  <span className="text-slate-500">filename</span><span>{doc.originalFilename}</span>
                  <span className="text-slate-500">fileHash</span><span className="font-mono text-xs">{truncMiddle(doc.fileHash, 12, 10)}</span>
                  <span className="text-slate-500">rowCount</span><span>{doc.rowCount}</span>
                  <span className="text-slate-500">normalizedCount</span><span>{doc.normalizedCount}</span>
                  <span className="text-slate-500">failedRowCount</span><span>{doc.failedRowCount}</span>
                  <span className="text-slate-500">status</span><span>{doc.status}</span>
                  <span className="text-slate-500">createdAt</span><span>{new Date(doc.createdAt).toLocaleString()}</span>
                  {doc.uploadedByUser?.email && (
                    <>
                      <span className="text-slate-500">uploadedBy</span><span>{doc.uploadedByUser.email}</span>
                    </>
                  )}
                </div>

                {canRunValidation && (
                  <div className="mt-3 flex justify-end">
                    <Button size="sm" onClick={runValidation} disabled={running}>
                      {running ? <Spinner size="sm" label="Running" /> : "Re-run validation on this batch"}
                    </Button>
                  </div>
                )}
              </section>

              {(doc.notes?.duplicateLoanIds?.length || doc.notes?.orphanLoanIds?.length) ? (
                <section className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  {doc.notes.duplicateLoanIds?.length ? (
                    <div><strong>Duplicate loan_ids:</strong> {doc.notes.duplicateLoanIds.join(", ")}</div>
                  ) : null}
                  {doc.notes.orphanLoanIds?.length ? (
                    <div><strong>Orphan loan_ids:</strong> {doc.notes.orphanLoanIds.join(", ")}</div>
                  ) : null}
                </section>
              ) : null}

              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Failed rows ({doc.failedRows?.length || 0})
                </h3>
                {(!doc.failedRows || doc.failedRows.length === 0) ? (
                  <p className="text-xs text-slate-500">None.</p>
                ) : (
                  <div className="space-y-2">
                    {doc.failedRows.map((r, i) => (
                      <div key={i} className="rounded border border-red-200 bg-red-50 p-2 text-xs">
                        <div className="text-red-800">row {r.rowIndex}: {r.reason}</div>
                        <pre className="mt-1 overflow-x-auto text-[11px] text-slate-700">
{JSON.stringify(r.rawRow, null, 2)}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
