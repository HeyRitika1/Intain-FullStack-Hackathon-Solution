// Shared reconciliation helpers for the Prompt 14 side-by-side view + the
// auto-resolve check that runs after PATCH /api/loans/:loanId.

import { Exception, RawImport } from "../models/index.js";

const RECON_MONITORED = ["currentBalance", "paymentStatus", "daysPastDue", "lastUpdatedAt"];
// lastUpdatedAt is informational; auto-resolve fires when the substantive three match.
const RECON_SUBSTANTIVE = ["currentBalance", "paymentStatus", "daysPastDue"];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function loadServicerRow(loanId) {
  const latest = await RawImport.findOne({ fileType: "servicer_update" })
    .sort({ createdAt: -1 })
    .select("notes")
    .lean();
  return latest?.notes?.parsedRowsByLoanId?.[loanId] || null;
}

export function computeReconciliation(loan, servicerRow) {
  if (!servicerRow) {
    return {
      diffs: [],
      loanTapeLastUpdatedAt: isoOrNull(loan?.lastUpdatedAt),
      servicerLastUpdatedAt: null,
    };
  }
  const loanTs = loan?.lastUpdatedAt;
  const serTs = servicerRow?.lastUpdatedAt;
  const fresher = fresherOf(loanTs, serTs);
  const days = daysBetween(loanTs, serTs);
  const delta = days === null
    ? null
    : days === 0
      ? "same day"
      : `${days} days ${fresher === "servicer" ? "newer" : "older"}`;

  const diffs = [];
  for (const f of RECON_MONITORED) {
    const a = loan?.[f];
    const b = servicerRow?.[f];
    if (!valuesEqual(a, b)) {
      diffs.push({
        field: f,
        loanTapeValue: normalize(a),
        servicerValue: normalize(b),
        fresher,
        freshnessDelta: delta,
      });
    }
  }
  return {
    diffs,
    loanTapeLastUpdatedAt: isoOrNull(loanTs),
    servicerLastUpdatedAt: isoOrNull(serTs),
  };
}

export function substantiveDiffCount(loan, servicerRow) {
  if (!servicerRow) return 0;
  let n = 0;
  for (const f of RECON_SUBSTANTIVE) if (!valuesEqual(loan?.[f], servicerRow?.[f])) n++;
  return n;
}

export async function findOpenCrossSourceConflict(loanId) {
  return Exception.findOne({
    loanId,
    ruleId: "CROSS_SOURCE_CONFLICT",
    status: { $in: ["open", "in_review"] },
  });
}

/**
 * Called from PATCH /api/loans/:loanId. If all substantive fields now match the
 * servicer row, mark the open CROSS_SOURCE_CONFLICT exception resolved with a
 * system note. Returns the exceptionId if it was auto-resolved.
 */
export async function autoResolveCrossSourceIfReconciled(loanDoc, actor) {
  const servicer = await loadServicerRow(loanDoc.loanId);
  if (!servicer) return null;
  if (substantiveDiffCount(loanDoc.toObject ? loanDoc.toObject() : loanDoc, servicer) > 0) return null;

  const exc = await findOpenCrossSourceConflict(loanDoc.loanId);
  if (!exc) return null;

  exc.status = "resolved";
  exc.resolutionType = "approved_as_is";
  exc.resolutionNote = "reconciled via side-by-side view";
  exc.resolvedBy = actor || null;
  exc.resolvedAt = new Date();
  await exc.save();
  return exc.exceptionId;
}

// --------------------- helpers ---------------------

function valuesEqual(a, b) {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (a instanceof Date || b instanceof Date) {
    const da = a instanceof Date ? a : new Date(a);
    const db = b instanceof Date ? b : new Date(b);
    return da.getTime() === db.getTime();
  }
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return String(a) === String(b);
}

function fresherOf(loanTs, servicerTs) {
  const a = loanTs ? new Date(loanTs).getTime() : null;
  const b = servicerTs ? new Date(servicerTs).getTime() : null;
  if (a === null && b === null) return "tie";
  if (a === null) return "servicer";
  if (b === null) return "loanTape";
  if (b > a) return "servicer";
  if (a > b) return "loanTape";
  return "tie";
}

function daysBetween(a, b) {
  const da = a ? new Date(a).getTime() : null;
  const db = b ? new Date(b).getTime() : null;
  if (da === null || db === null) return null;
  return Math.round(Math.abs(db - da) / MS_PER_DAY);
}

function normalize(v) {
  if (v instanceof Date) return v.toISOString();
  return v ?? null;
}

function isoOrNull(v) {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}
