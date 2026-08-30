import crypto from "node:crypto";
import { AuditEvent, Exception, Loan, RawImport, ValidationRule } from "../../models/index.js";
import { appendAuditEvent } from "../hashChainService.js";
import { evaluate } from "./expressions.js";
import { logger } from "../../utils/logger.js";

/**
 * runValidationForLoans(loanIds?) — if loanIds omitted, runs against all Loans.
 * Also runs orphan rules (appliesTo: servicerUpdate | manifest) against the
 * most-recent RawImport rows for those file types.
 *
 * Returns: { exceptionsCreated, exceptionsUpdated, exceptionsAutoDismissed,
 *            loanIdsTouched: string[], byRule: Record<ruleId, {matched, created, updated, dismissed}> }
 */
export async function runValidationForLoans(loanIds = null, { actor = null, actorRole = null } = {}) {
  const now = new Date();

  const rules = await ValidationRule.find({ active: true, approvedBy: { $ne: null } }).lean();
  if (!rules.length) {
    logger.warn("[ruleEngine] no active + approved rules");
    return emptyResult();
  }
  const loanRules = rules.filter((r) => (r.appliesTo || "loan") === "loan");
  const servicerRules = rules.filter((r) => r.appliesTo === "servicerUpdate");
  const manifestRules = rules.filter((r) => r.appliesTo === "manifest");

  // Load target loans.
  const loanQuery = loanIds ? { loanId: { $in: loanIds } } : {};
  const loans = await Loan.find(loanQuery).lean();
  if (!loans.length && !servicerRules.length && !manifestRules.length) {
    return emptyResult();
  }

  const shared = await loadOtherSources({ loans, loanIds });

  // ---- Evaluate loan-level rules ----
  const loanResults = new Map(); // loanId -> [{ rule, evalResult }]
  const perLoanMatchedRuleIds = new Map(); // loanId -> Set(ruleId)
  for (const loan of loans) {
    const record = normalizeLoanForEval(loan);
    const ctx = {
      record,
      otherSources: {
        ...shared,
        // Convenience: current loan's servicer update / manifest rows are already keyed by loanId in shared maps.
      },
      now,
    };
    const perRule = [];
    const matched = new Set();
    for (const rule of loanRules) {
      const r = evaluate(rule.expression, ctx);
      perRule.push({ rule, evalResult: r });
      if (r.matched) matched.add(rule.ruleId);
    }
    loanResults.set(loan.loanId, perRule);
    perLoanMatchedRuleIds.set(loan.loanId, matched);
  }

  // ---- Evaluate orphan rules against source rows ----
  const orphanFindings = []; // [{ loanId (synthetic), rule, evalResult }]
  const servicerRows = shared._servicerRowsList;
  const manifestList = shared._manifestRowsList;
  for (const rule of servicerRules) {
    for (const row of servicerRows) {
      const ctx = { record: row, otherSources: shared, now };
      const r = evaluate(rule.expression, ctx);
      if (r.matched) {
        orphanFindings.push({
          syntheticLoanId: `__ORPHAN__servicer__${row.loanId}`,
          originalKey: row.loanId,
          rule,
          evalResult: r,
        });
      }
    }
  }
  for (const rule of manifestRules) {
    for (const row of manifestList) {
      const ctx = { record: row, otherSources: shared, now };
      const r = evaluate(rule.expression, ctx);
      if (r.matched) {
        orphanFindings.push({
          syntheticLoanId: `__ORPHAN__manifest__${row.loanId}`,
          originalKey: row.loanId,
          rule,
          evalResult: r,
        });
      }
    }
  }

  // ---- Load existing exceptions we might touch ----
  const affectedLoanIds = new Set([
    ...loans.map((l) => l.loanId),
    ...orphanFindings.map((f) => f.syntheticLoanId),
  ]);
  const existing = await Exception.find({
    loanId: { $in: [...affectedLoanIds] },
  }).lean();
  const existingByKey = new Map();
  for (const ex of existing) existingByKey.set(`${ex.loanId}||${ex.ruleId}`, ex);

  // ---- Plan write ops ----
  const inserts = [];
  const updates = [];
  const dismissals = [];
  const auditEvents = [];
  const byRule = {};
  const bumpRule = (ruleId, key) => {
    byRule[ruleId] = byRule[ruleId] || { matched: 0, created: 0, updated: 0, dismissed: 0 };
    byRule[ruleId][key]++;
  };

  // Loan-level: matches → insert or update in-place; misses (existing open) → dismiss.
  for (const loan of loans) {
    const perRule = loanResults.get(loan.loanId) || [];
    for (const { rule, evalResult } of perRule) {
      const key = `${loan.loanId}||${rule.ruleId}`;
      const ex = existingByKey.get(key);
      if (evalResult.matched) {
        bumpRule(rule.ruleId, "matched");
        const message = renderTemplate(rule.messageTemplate, {
          ...normalizeLoanForEval(loan),
          ...evalResult.contextValues,
        });
        const context = {
          contextValues: evalResult.contextValues,
          otherSourceValue: evalResult.contextValues.otherSourceValue || null,
          sourceHint: evalResult.contextValues.sourceHint || null,
        };
        if (!ex) {
          const doc = {
            exceptionId: crypto.randomUUID(),
            loanId: loan.loanId,
            ruleId: rule.ruleId,
            ruleName: rule.name,
            severity: rule.severity,
            fields: evalResult.involvedFields,
            message,
            context,
            status: "open",
          };
          inserts.push(doc);
          bumpRule(rule.ruleId, "created");
          auditEvents.push({
            loanId: loan.loanId,
            type: "exception_created",
            payload: { ruleId: rule.ruleId, severity: rule.severity, exceptionId: doc.exceptionId },
          });
        } else if (ex.status === "open" || ex.status === "in_review") {
          updates.push({ _id: ex._id, message, context, fields: evalResult.involvedFields });
          bumpRule(rule.ruleId, "updated");
        }
        // resolved / dismissed: skip (respect human decision)
      } else if (ex && (ex.status === "open" || ex.status === "in_review")) {
        dismissals.push(ex._id);
        bumpRule(rule.ruleId, "dismissed");
      }
    }
  }

  // Orphan findings: insert one exception per (syntheticLoanId, ruleId).
  for (const f of orphanFindings) {
    const key = `${f.syntheticLoanId}||${f.rule.ruleId}`;
    const ex = existingByKey.get(key);
    bumpRule(f.rule.ruleId, "matched");
    const message = renderTemplate(f.rule.messageTemplate, {
      loanId: f.originalKey,
      ...f.evalResult.contextValues,
    });
    const context = {
      contextValues: { ...f.evalResult.contextValues, loanId: f.originalKey },
      sourceHint: `orphan row from ${f.rule.appliesTo} import`,
    };
    if (!ex) {
      const doc = {
        exceptionId: crypto.randomUUID(),
        loanId: f.syntheticLoanId,
        ruleId: f.rule.ruleId,
        ruleName: f.rule.name,
        severity: f.rule.severity,
        fields: f.evalResult.involvedFields,
        message,
        context,
        status: "open",
      };
      inserts.push(doc);
      bumpRule(f.rule.ruleId, "created");
      auditEvents.push({
        loanId: f.syntheticLoanId,
        type: "exception_created",
        payload: { ruleId: f.rule.ruleId, severity: f.rule.severity, exceptionId: doc.exceptionId },
      });
    } else if (ex.status === "open" || ex.status === "in_review") {
      updates.push({ _id: ex._id, message, context, fields: f.evalResult.involvedFields });
      bumpRule(f.rule.ruleId, "updated");
    }
  }

  // ---- Execute writes ----
  if (inserts.length) await Exception.insertMany(inserts);
  if (updates.length) {
    const ops = updates.map((u) => ({
      updateOne: {
        filter: { _id: u._id },
        update: { $set: { message: u.message, context: u.context, fields: u.fields } },
      },
    }));
    await Exception.bulkWrite(ops);
  }
  if (dismissals.length) {
    await Exception.updateMany(
      { _id: { $in: dismissals } },
      {
        $set: {
          status: "dismissed",
          resolutionType: null,
          resolvedAt: now,
          resolutionNote: "auto: rule no longer matches",
        },
      }
    );
  }

  // Sweep: any open/in_review exception whose rule is no longer active+approved gets
  // auto-dismissed with a distinct note. Covers the "PATCH active:false" path.
  // A full run (no loanIds arg) sweeps across every exception; a scoped run only
  // touches the targeted loans.
  const activeRuleIds = new Set(rules.map((r) => r.ruleId));
  const sweepFilter = {
    status: { $in: ["open", "in_review"] },
    ruleId: { $nin: [...activeRuleIds] },
  };
  if (loanIds) sweepFilter.loanId = { $in: [...affectedLoanIds] };
  const orphanedRuleSweep = await Exception.updateMany(sweepFilter, {
    $set: {
      status: "dismissed",
      resolutionType: null,
      resolvedAt: now,
      resolutionNote: "auto: rule deactivated",
    },
  });
  const sweptCount = orphanedRuleSweep?.modifiedCount || 0;

  // ---- Emit audit events ----
  // Prompt 15: sequential per-loanId append via hashChainService.appendAuditEvent so
  // per-loan chains stay correct. Slower than a batched insertMany, but the mutex-
  // protected append is the single source of truth for AuditEvent writes.
  for (const l of loans) {
    await appendAuditEvent({
      loanId: l.loanId,
      type: "validate",
      payload: {
        rulesRun: loanRules.length,
        matchedRuleIds: [...(perLoanMatchedRuleIds.get(l.loanId) || [])],
      },
      actor,
      actorRole,
    });
  }
  for (const ev of auditEvents) {
    await appendAuditEvent({
      loanId: ev.loanId,
      type: ev.type,
      payload: ev.payload,
      actor,
      actorRole,
    });
  }

  return {
    exceptionsCreated: inserts.length,
    exceptionsUpdated: updates.length,
    exceptionsAutoDismissed: dismissals.length + sweptCount,
    loanIdsTouched: loans.map((l) => l.loanId),
    orphanExceptionCount: orphanFindings.length,
    byRule,
  };
}

/**
 * Convenience wrapper — validates every loan touched by a RawImport batch.
 * After validation, auto-verifies any still-pending loan with zero exceptions.
 */
export async function runValidationForBatch(batchId, opts = {}) {
  const raw = await RawImport.findOne({ batchId }).lean();
  if (!raw) throw new Error(`Batch not found: ${batchId}`);
  const notes = raw.notes || {};
  const affected = new Set([
    ...(notes.committedLoanIds || []),
    ...(notes.linkedLoanIds || []),
  ]);
  if (!affected.size && raw.fileType === "loan_tape") {
    // Fallback: any loan with matching sourceBatchId.
    const loans = await Loan.find({ sourceBatchId: batchId }).select("loanId").lean();
    for (const l of loans) affected.add(l.loanId);
  }
  const result = await runValidationForLoans([...affected], opts);

  // Prompt 15: batch-level auto-verify for pending loans with zero exceptions.
  // Dynamic import avoids a circular dep during module init.
  const { autoVerifyZeroExceptionLoans } = await import("../verificationService.js");
  const auto = await autoVerifyZeroExceptionLoans([...affected]);
  return { ...result, autoVerified: auto.verified, autoVerifySkipped: auto.skipped.length };
}

/**
 * Evaluate an unsaved expression against every loan without persisting Exceptions.
 * Used by POST /api/ai/rule to preview the "would match N loans" hint before
 * an admin commits an AI-drafted rule to the collection.
 */
export async function dryRunRule(expression, { appliesTo = "loan", sampleLimit = 5 } = {}) {
  if (!expression || typeof expression !== "object") {
    return { loansMatched: 0, sampleLoanIds: [] };
  }
  const now = new Date();
  const loans = await Loan.find({}).lean();
  const shared = await loadOtherSources({ loans, loanIds: null });
  const matched = [];
  if (appliesTo === "loan") {
    for (const loan of loans) {
      const record = normalizeLoanForEval(loan);
      const ctx = { record, otherSources: shared, now };
      const r = evaluate(expression, ctx);
      if (r.matched) matched.push(loan.loanId);
    }
  } else if (appliesTo === "servicerUpdate") {
    for (const row of shared._servicerRowsList) {
      const r = evaluate(expression, { record: row, otherSources: shared, now });
      if (r.matched) matched.push(row.loanId);
    }
  } else if (appliesTo === "manifest") {
    for (const row of shared._manifestRowsList) {
      const r = evaluate(expression, { record: row, otherSources: shared, now });
      if (r.matched) matched.push(row.loanId);
    }
  }
  return {
    loansMatched: matched.length,
    sampleLoanIds: matched.slice(0, sampleLimit),
  };
}

// ------------------------- helpers -------------------------

async function loadOtherSources({ loans, loanIds }) {
  // Loan ids that exist in canonical Loan collection (subset that we're validating right now).
  // For orphan detection we need the complete set, not just this run's targets.
  const allLoans = loanIds
    ? await Loan.find({}, { loanId: 1 }).lean()
    : loans.map((l) => ({ loanId: l.loanId }));
  const loanTapeLoanIds = new Set(allLoans.map((l) => l.loanId));

  // Duplicate loan ids: read from the most recent loan_tape RawImport notes.
  const dupSet = new Set();
  const latestLoanTape = await RawImport.findOne({ fileType: "loan_tape" })
    .sort({ createdAt: -1 })
    .lean();
  if (latestLoanTape?.notes?.duplicateLoanIds) {
    for (const id of latestLoanTape.notes.duplicateLoanIds) dupSet.add(id);
  }

  // Duplicate borrower triples: compute across all loans.
  const dupTripleSet = computeDuplicateBorrowerTriples(await Loan.find({}, {
    loanId: 1, borrowerId: 1, originalPrincipal: 1, originationDate: 1,
  }).lean());

  // Servicer updates: latest servicer_update RawImport, parsedRowsByLoanId.
  const servicerUpdates = new Map();
  const servicerRowsList = [];
  const latestServicer = await RawImport.findOne({ fileType: "servicer_update" })
    .sort({ createdAt: -1 })
    .lean();
  if (latestServicer?.notes?.parsedRowsByLoanId) {
    for (const [lid, row] of Object.entries(latestServicer.notes.parsedRowsByLoanId)) {
      const withDate = { ...row, lastUpdatedAt: row.lastUpdatedAt ? new Date(row.lastUpdatedAt) : null };
      servicerUpdates.set(lid, withDate);
      servicerRowsList.push(withDate);
    }
  }

  // Document manifest: latest manifest RawImport, rowsByLoanId.
  const manifestRows = new Map();
  const manifestRowsList = [];
  const latestManifest = await RawImport.findOne({ fileType: "document_manifest" })
    .sort({ createdAt: -1 })
    .lean();
  if (latestManifest?.notes?.rowsByLoanId) {
    for (const [lid, entries] of Object.entries(latestManifest.notes.rowsByLoanId)) {
      const parsedEntries = entries.map((e) => ({
        ...e,
        receivedAt: e.receivedAt ? new Date(e.receivedAt) : null,
      }));
      manifestRows.set(lid, parsedEntries);
      manifestRowsList.push(...parsedEntries);
    }
  }

  return {
    loanTapeLoanIds,
    servicerUpdates,
    manifestRows,
    duplicateLoanIds: dupSet,
    duplicateTripleLoanIds: dupTripleSet,
    _servicerRowsList: servicerRowsList,
    _manifestRowsList: manifestRowsList,
  };
}

function computeDuplicateBorrowerTriples(loans) {
  const groups = new Map();
  for (const l of loans) {
    if (!l.borrowerId || l.originalPrincipal === null || !l.originationDate) continue;
    const iso = l.originationDate instanceof Date
      ? l.originationDate.toISOString().slice(0, 10)
      : String(l.originationDate).slice(0, 10);
    const key = `${l.borrowerId}||${l.originalPrincipal}||${iso}`;
    const bucket = groups.get(key) || [];
    bucket.push(l.loanId);
    groups.set(key, bucket);
  }
  const dupLoanIds = new Set();
  for (const bucket of groups.values()) {
    if (bucket.length > 1) for (const id of bucket) dupLoanIds.add(id);
  }
  return dupLoanIds;
}

function normalizeLoanForEval(loan) {
  // Convert Date fields to Date objects so the evaluator's date ops work uniformly.
  return {
    ...loan,
    originationDate: loan.originationDate ? new Date(loan.originationDate) : null,
    maturityDate: loan.maturityDate ? new Date(loan.maturityDate) : null,
    lastUpdatedAt: loan.lastUpdatedAt ? new Date(loan.lastUpdatedAt) : null,
  };
}

function renderTemplate(template, bag) {
  if (!template) return "";
  return String(template).replace(/\{(\w+)\}/g, (_, key) => {
    const v = bag[key];
    if (v === null || v === undefined) return `{${key}}`;
    if (v instanceof Date) return v.toISOString();
    return String(v);
  });
}

function emptyResult() {
  return {
    exceptionsCreated: 0,
    exceptionsUpdated: 0,
    exceptionsAutoDismissed: 0,
    loanIdsTouched: [],
    orphanExceptionCount: 0,
    byRule: {},
  };
}
