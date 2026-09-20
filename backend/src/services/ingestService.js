import crypto from "node:crypto";
import { parse as csvParseSync } from "csv-parse/sync";
import { Loan, RawImport } from "../models/index.js";
import { HttpError } from "../middleware/error.js";
import { logger } from "../utils/logger.js";
import { appendAuditEvent } from "./hashChainService.js";

// Re-export so existing importers (routes/loans.js, routes/exceptions.js, ai) keep
// their existing `import { appendAuditEvent } from "../services/ingestService.js"` lines.
export { appendAuditEvent };

const FILE_TYPES = new Set(["loan_tape", "servicer_update", "document_manifest"]);
const MONITORED_SERVICER_FIELDS = ["currentBalance", "paymentStatus", "daysPastDue"];

// ------------------------- primitives -------------------------

export function parseCsv(rawText) {
  const rows = csvParseSync(rawText, {
    columns: true,
    trim: true,
    skip_empty_lines: true,
    relax_quotes: true,
    bom: true,
  });
  rows.forEach((r, i) => {
    r.__rowIndex = i + 1;
  });
  const header = rows.length ? Object.keys(rows[0]).filter((k) => k !== "__rowIndex") : [];
  return { header, rows };
}

export function hashFile(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), "utf8");
  return crypto.createHash("sha256").update(buf).digest("hex");
}

const emptyToNull = (v) =>
  v === "" || v === undefined || v === null || (typeof v === "string" && v.trim() === "")
    ? null
    : v;

function coerceNumber(raw) {
  const v = emptyToNull(raw);
  if (v === null) return { ok: true, value: null };
  const n = Number(v);
  if (!Number.isFinite(n)) return { ok: false, reason: `not a finite number: ${raw}` };
  return { ok: true, value: n };
}

function coerceDate(raw) {
  const v = emptyToNull(raw);
  if (v === null) return { ok: true, value: null };
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return { ok: false, reason: `not a date: ${raw}` };
  return { ok: true, value: d };
}

function coerceString(raw, { upper = false } = {}) {
  const v = emptyToNull(raw);
  if (v === null) return null;
  return upper ? String(v).toUpperCase() : String(v);
}

// ------------------------- row normalizers -------------------------

export function normalizeLoanTapeRow(row, batchId) {
  const rowIndex = row.__rowIndex;
  const errors = [];

  const num = (k) => {
    const r = coerceNumber(row[k]);
    if (!r.ok) errors.push(`${k}: ${r.reason}`);
    return r.value ?? null;
  };
  const date = (k) => {
    const r = coerceDate(row[k]);
    if (!r.ok) errors.push(`${k}: ${r.reason}`);
    return r.value ?? null;
  };

  const loan = {
    loanId: coerceString(row.loan_id),
    borrowerId: coerceString(row.borrower_id),
    borrowerName: coerceString(row.borrower_name),
    state: coerceString(row.state, { upper: true }),
    originationDate: date("origination_date"),
    maturityDate: date("maturity_date"),
    originalPrincipal: num("original_principal"),
    currentBalance: num("current_balance"),
    interestRate: num("interest_rate"),
    paymentStatus: coerceString(row.payment_status),
    daysPastDue: num("days_past_due") ?? 0,
    lastUpdatedAt: date("last_updated_at"),
    documentStatus: coerceString(row.document_status) || "unknown",
    sourceBatchId: batchId,
    sourceRowIndex: rowIndex,
  };

  if (errors.length) {
    return { ok: false, reason: errors.join("; "), rawRow: stripRowIndex(row), rowIndex };
  }
  return { ok: true, loan };
}

export function normalizeServicerUpdateRow(row, batchId) {
  const rowIndex = row.__rowIndex;
  const errors = [];
  const num = (k) => {
    const r = coerceNumber(row[k]);
    if (!r.ok) errors.push(`${k}: ${r.reason}`);
    return r.value ?? null;
  };
  const date = (k) => {
    const r = coerceDate(row[k]);
    if (!r.ok) errors.push(`${k}: ${r.reason}`);
    return r.value ?? null;
  };
  const update = {
    loanId: coerceString(row.loan_id),
    currentBalance: num("current_balance"),
    paymentStatus: coerceString(row.payment_status),
    daysPastDue: num("days_past_due") ?? 0,
    lastUpdatedAt: date("last_updated_at"),
    sourceBatchId: batchId,
    sourceRowIndex: rowIndex,
  };
  if (!update.loanId) {
    return { ok: false, reason: "servicer_update row missing loan_id", rawRow: stripRowIndex(row), rowIndex };
  }
  if (errors.length) {
    return { ok: false, reason: errors.join("; "), rawRow: stripRowIndex(row), rowIndex };
  }
  return { ok: true, update };
}

export function normalizeDocumentManifestRow(row, batchId) {
  const rowIndex = row.__rowIndex;
  const errors = [];
  const date = (k) => {
    const r = coerceDate(row[k]);
    if (!r.ok) errors.push(`${k}: ${r.reason}`);
    return r.value ?? null;
  };
  const manifest = {
    loanId: coerceString(row.loan_id),
    docType: coerceString(row.doc_type),
    docStatus: coerceString(row.doc_status),
    receivedAt: date("received_at"),
    sourceBatchId: batchId,
    sourceRowIndex: rowIndex,
  };
  if (!manifest.loanId) {
    return { ok: false, reason: "manifest row missing loan_id", rawRow: stripRowIndex(row), rowIndex };
  }
  if (errors.length) {
    return { ok: false, reason: errors.join("; "), rawRow: stripRowIndex(row), rowIndex };
  }
  return { ok: true, manifest };
}

function stripRowIndex(row) {
  const { __rowIndex, ...rest } = row;
  return rest;
}

function pickNormalizer(fileType) {
  if (fileType === "loan_tape") return normalizeLoanTapeRow;
  if (fileType === "servicer_update") return normalizeServicerUpdateRow;
  if (fileType === "document_manifest") return normalizeDocumentManifestRow;
  throw new HttpError(400, `Unknown fileType: ${fileType}`);
}

function extractRecord(normResult) {
  return normResult.loan || normResult.update || normResult.manifest;
}

// ------------------------- audit event helpers -------------------------

// appendAuditEvent lives in hashChainService.js — re-exported at the top of this file.
// Prompt 15 removed the batched insertMany optimization: import events are now appended
// sequentially per loanId so per-loan hash chains stay correct (correctness > throughput
// for this demo).

// ------------------------- upload preview -------------------------

export async function previewUpload({
  fileType,
  originalFilename,
  rawText,
  uploadedBy = null,
  actorRole = null,
}) {
  if (!FILE_TYPES.has(fileType)) {
    throw new HttpError(400, `Unknown fileType: ${fileType}`);
  }
  const batchId = crypto.randomUUID();
  const fileHash = hashFile(rawText);

  let parsed;
  try {
    parsed = parseCsv(rawText);
  } catch (err) {
    throw new HttpError(400, `CSV parse failed: ${err.message}`);
  }

  const normalizer = pickNormalizer(fileType);
  const normalizedRows = [];
  const failedRows = [];
  const seen = new Set();
  const duplicateLoanIds = new Set();

  for (const row of parsed.rows) {
    const result = normalizer(row, batchId);
    if (result.ok) {
      const rec = extractRecord(result);
      normalizedRows.push(rec);
      if (fileType === "loan_tape") {
        const key =
          rec.loanId ||
          `__MISSING__${rec.sourceRowIndex}__${batchId.slice(0, 8)}`;
        if (seen.has(key)) duplicateLoanIds.add(key);
        seen.add(key);
      }
    } else {
      failedRows.push({ rowIndex: result.rowIndex, rawRow: result.rawRow, reason: result.reason });
    }
  }

  const notes = { duplicateLoanIds: [...duplicateLoanIds] };
  const raw = await RawImport.create({
    batchId,
    fileType,
    originalFilename,
    fileHash,
    rawText,
    uploadedBy,
    rowCount: parsed.rows.length,
    normalizedCount: normalizedRows.length,
    failedRowCount: failedRows.length,
    failedRows,
    status: "uploaded",
    notes,
  });

  await appendAuditEvent({
    loanId: `__BATCH__${batchId}`,
    type: "upload",
    payload: {
      fileType,
      originalFilename,
      fileHash,
      rowCount: parsed.rows.length,
      normalizedCount: normalizedRows.length,
      failedRowCount: failedRows.length,
      uploadedBy: uploadedBy ? String(uploadedBy) : null,
    },
    actor: uploadedBy,
    actorRole,
  });

  return {
    batchId,
    fileType,
    rowCount: parsed.rows.length,
    normalizedCount: normalizedRows.length,
    failedRowCount: failedRows.length,
    previewRows: normalizedRows.slice(0, 10),
    failedRows: failedRows.slice(0, 10),
    warnings: duplicateLoanIds.size
      ? [`Duplicate loan_id detected in file: ${[...duplicateLoanIds].join(", ")}`]
      : [],
    _rawImportId: raw._id,
  };
}

// ------------------------- commit primitives -------------------------

export async function commitLoanTape(batchId) {
  const raw = await RawImport.findOne({ batchId });
  if (!raw) throw new HttpError(404, `Batch not found: ${batchId}`);
  if (raw.fileType !== "loan_tape") throw new HttpError(400, `Batch ${batchId} is not a loan_tape`);

  const { rows } = parseCsv(raw.rawText);
  const seen = new Map();
  const duplicates = new Set();
  const droppedDuplicateRows = []; // rows overwritten by a later duplicate loan_id
  const loans = [];

  for (const row of rows) {
    const result = normalizeLoanTapeRow(row, batchId);
    if (!result.ok) continue;
    const loan = result.loan;
    if (!loan.loanId) {
      loan.loanId = `__MISSING__${loan.sourceRowIndex}__${batchId.slice(0, 8)}`;
    }
    if (seen.has(loan.loanId)) {
      duplicates.add(loan.loanId);
      const prev = seen.get(loan.loanId);
      droppedDuplicateRows.push({
        rowIndex: prev.sourceRowIndex,
        rawRow: { loan_id: loan.loanId, borrower_id: prev.borrowerId, borrower_name: prev.borrowerName },
        reason: `duplicate loan_id — overwritten by later row ${loan.sourceRowIndex}`,
      });
    }
    seen.set(loan.loanId, loan);
    loans.push(loan);
  }

  const ops = loans.map((l) => ({
    updateOne: {
      filter: { loanId: l.loanId },
      update: { $set: l, $setOnInsert: { verificationStatus: "pending" } },
      upsert: true,
    },
  }));
  if (ops.length) await Loan.bulkWrite(ops);

  const uniqueLoanIds = [...seen.keys()];

  // Surface duplicate-drop as "failed rows" so the operator dashboard doesn't hide
  // the fact that some rows were merged. Preview-time parse failures already live
  // in raw.failedRows; we append duplicates without clobbering those.
  if (droppedDuplicateRows.length) {
    raw.failedRows = [...(raw.failedRows || []), ...droppedDuplicateRows];
    raw.failedRowCount = (raw.failedRowCount || 0) + droppedDuplicateRows.length;
  }

  raw.notes = {
    ...(isPlainObject(raw.notes) ? raw.notes : {}),
    duplicateLoanIds: [...duplicates],
    duplicateRowCount: droppedDuplicateRows.length,
    committedLoanIds: uniqueLoanIds,
  };
  raw.markModified("notes");
  raw.markModified("failedRows");
  await raw.save();

  return { loanIdsAffected: uniqueLoanIds };
}

export async function linkServicerUpdate(batchId) {
  const raw = await RawImport.findOne({ batchId });
  if (!raw) throw new HttpError(404, `Batch not found: ${batchId}`);
  if (raw.fileType !== "servicer_update") throw new HttpError(400, `Batch ${batchId} is not a servicer_update`);

  const { rows } = parseCsv(raw.rawText);
  const parsedRowsByLoanId = {};
  const linkedLoanIds = [];
  const orphanLoanIds = [];

  for (const row of rows) {
    const result = normalizeServicerUpdateRow(row, batchId);
    if (!result.ok) continue;
    const u = result.update;
    parsedRowsByLoanId[u.loanId] = { ...u, lastUpdatedAt: iso(u.lastUpdatedAt) };
    const existing = await Loan.findOneAndUpdate(
      { loanId: u.loanId },
      { $set: { servicerUpdateBatchId: batchId } },
      { new: true, projection: { loanId: 1 } }
    );
    if (existing) linkedLoanIds.push(u.loanId);
    else orphanLoanIds.push(u.loanId);
  }

  raw.notes = {
    ...(isPlainObject(raw.notes) ? raw.notes : {}),
    parsedRowsByLoanId,
    linkedLoanIds,
    orphanLoanIds,
  };
  raw.markModified("notes");
  await raw.save();

  return { loanIdsAffected: linkedLoanIds, orphanLoanIds };
}

export async function linkDocumentManifest(batchId) {
  const raw = await RawImport.findOne({ batchId });
  if (!raw) throw new HttpError(404, `Batch not found: ${batchId}`);
  if (raw.fileType !== "document_manifest") throw new HttpError(400, `Batch ${batchId} is not a document_manifest`);

  const { rows } = parseCsv(raw.rawText);
  const rowsByLoanId = {};
  for (const row of rows) {
    const result = normalizeDocumentManifestRow(row, batchId);
    if (!result.ok) continue;
    const m = result.manifest;
    const bucket = (rowsByLoanId[m.loanId] = rowsByLoanId[m.loanId] || []);
    bucket.push({ ...m, receivedAt: iso(m.receivedAt) });
  }

  const linkedLoanIds = [];
  const orphanLoanIds = [];

  for (const [loanId, entries] of Object.entries(rowsByLoanId)) {
    const existing = await Loan.findOne({ loanId }).select({ loanId: 1 });
    if (!existing) {
      orphanLoanIds.push(loanId);
      continue;
    }
    const hasMissing = entries.some((e) => e.docStatus === "missing");
    const allReceived = entries.every((e) => e.docStatus === "received");
    const documentStatus = hasMissing ? "missing" : allReceived ? "complete" : "partial";
    await Loan.updateOne({ loanId }, { $set: { documentStatus } });
    linkedLoanIds.push(loanId);
  }

  raw.notes = {
    ...(isPlainObject(raw.notes) ? raw.notes : {}),
    rowsByLoanId,
    linkedLoanIds,
    orphanLoanIds,
  };
  raw.markModified("notes");
  await raw.save();

  return { loanIdsAffected: linkedLoanIds, orphanLoanIds };
}

// ------------------------- commit orchestration -------------------------

export async function commitBatch(batchId, { actor = null, actorRole = null } = {}) {
  const raw = await RawImport.findOne({ batchId });
  if (!raw) throw new HttpError(404, `Batch not found: ${batchId}`);
  if (raw.status !== "uploaded") {
    return {
      batchId,
      committedCount: 0,
      loanIdsAffected: [],
      alreadyCommitted: true,
      status: raw.status,
    };
  }

  let result;
  if (raw.fileType === "loan_tape") result = await commitLoanTape(batchId);
  else if (raw.fileType === "servicer_update") result = await linkServicerUpdate(batchId);
  else if (raw.fileType === "document_manifest") result = await linkDocumentManifest(batchId);
  else throw new HttpError(400, `Unknown fileType: ${raw.fileType}`);

  raw.status = "normalized";
  await raw.save();

  // Sequential per-loanId append preserves chain correctness. Slower than the
  // previous insertMany batch, but Prompt 15 requires correctness over throughput.
  for (const loanId of result.loanIdsAffected) {
    await appendAuditEvent({
      loanId,
      type: "import",
      payload: { batchId, fileType: raw.fileType },
      actor,
      actorRole,
    });
  }

  // Auto-run validation immediately after ingest so the reviewer queue reflects
  // reality without a separate manual "Run validation" step. Dynamic import
  // avoids a circular dep between ingest and rule engine services.
  let validation = null;
  try {
    const { runValidationForBatch } = await import("./ruleEngine/index.js");
    validation = await runValidationForBatch(batchId, { actor, actorRole });
  } catch (err) {
    logger.warn(`[ingest] post-commit validation failed for ${batchId}: ${err?.message || err}`);
  }

  return {
    batchId,
    committedCount: result.loanIdsAffected.length,
    loanIdsAffected: result.loanIdsAffected,
    orphanLoanIds: result.orphanLoanIds || [],
    alreadyCommitted: false,
    validation: validation
      ? {
          exceptionsCreated: validation.exceptionsCreated,
          exceptionsUpdated: validation.exceptionsUpdated,
          exceptionsAutoDismissed: validation.exceptionsAutoDismissed,
          autoVerified: validation.autoVerified || [],
        }
      : null,
  };
}

// ------------------------- misc -------------------------

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function iso(d) {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : String(d);
}

export const _internals = {
  MONITORED_SERVICER_FIELDS,
};
