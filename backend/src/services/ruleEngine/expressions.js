// Pure-function evaluator for the small validation expression grammar declared
// in samples/validation_rules.json. Never touches the DB — orchestrator (index.js)
// pre-loads every source it might need into ctx.otherSources.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * evaluate(expression, ctx) -> { matched, involvedFields, contextValues }
 *   ctx = {
 *     record,                  // the current row being tested (Loan | servicerUpdate | manifest row)
 *     otherSources: {
 *       loanTapeLoanIds:            Set<string>,
 *       servicerUpdates:            Map<loanId, updateRow>,
 *       manifestRows:               Map<loanId, [row, ...]>,
 *       duplicateLoanIds:           Set<string>,
 *       duplicateTripleLoanIds:     Set<string>,
 *     },
 *     now: Date,
 *   }
 */
export function evaluate(expression, ctx) {
  if (!expression || typeof expression !== "object") {
    return { matched: false, involvedFields: [], contextValues: {} };
  }
  const op = expression.op;
  switch (op) {
    // ------------------ leaf ops on the current record ------------------
    case "isEmpty": return leafField(expression, ctx, (v) => v === null || v === undefined || v === "");
    case "notEmpty": return leafField(expression, ctx, (v) => !(v === null || v === undefined || v === ""));
    case "equals": return leafField(expression, ctx, (v) => looseEq(v, expression.value));
    case "notEquals": return leafField(expression, ctx, (v) => !looseEq(v, expression.value));
    case "lt": return leafField(expression, ctx, (v) => numericCompare(v, expression.value, (a, b) => a < b));
    case "lte": return leafField(expression, ctx, (v) => numericCompare(v, expression.value, (a, b) => a <= b));
    case "gt": return leafField(expression, ctx, (v) => numericCompare(v, expression.value, (a, b) => a > b));
    case "gte": return leafField(expression, ctx, (v) => numericCompare(v, expression.value, (a, b) => a >= b));
    case "inSet": return leafField(expression, ctx, (v) => Array.isArray(expression.values) && expression.values.includes(v));
    case "notInSet": return leafField(expression, ctx, (v) => Array.isArray(expression.values) && !expression.values.includes(v));
    case "dateBefore": return leafField(expression, ctx, (v) => dateCompare(v, expression.value, (a, b) => a < b));
    case "dateAfter": return leafField(expression, ctx, (v) => dateCompare(v, expression.value, (a, b) => a > b));
    case "olderThanDays": return leafField(expression, ctx, (v) => {
      const d = toDate(v);
      if (!d) return false;
      const diff = (ctx.now.getTime() - d.getTime()) / MS_PER_DAY;
      return diff > Number(expression.days);
    });
    case "regexMatch": return leafField(expression, ctx, (v) => {
      if (v === null || v === undefined) return false;
      try {
        return new RegExp(expression.pattern, expression.flags || "").test(String(v));
      } catch { return false; }
    });

    // ------------------ boolean combinators ------------------
    case "and": {
      const args = expression.args || [];
      let matched = args.length > 0;
      const fields = [];
      const ctxVals = {};
      for (const arg of args) {
        const r = evaluate(arg, ctx);
        if (!r.matched) { matched = false; break; }
        fields.push(...r.involvedFields);
        Object.assign(ctxVals, r.contextValues);
      }
      return { matched, involvedFields: dedupe(fields), contextValues: ctxVals };
    }
    case "or": {
      const args = expression.args || [];
      for (const arg of args) {
        const r = evaluate(arg, ctx);
        if (r.matched) return r;
      }
      return { matched: false, involvedFields: [], contextValues: {} };
    }
    case "not": {
      const inner = Array.isArray(expression.args) ? expression.args[0] : expression.arg;
      const r = evaluate(inner, ctx);
      return { matched: !r.matched, involvedFields: r.involvedFields, contextValues: r.contextValues };
    }

    // ------------------ cross-field on same record ------------------
    case "crossFieldCompare": {
      const { left, right, op2, rightMultiplier = 1 } = expression;
      const lv = ctx.record?.[left];
      const rv = ctx.record?.[right];
      const contextValues = { [left]: lv, [right]: rv };
      if (lv === null || lv === undefined || rv === null || rv === undefined) {
        return { matched: false, involvedFields: [left, right], contextValues };
      }
      const cmp = compareValues(lv, rv, op2, rightMultiplier);
      return { matched: cmp, involvedFields: [left, right], contextValues };
    }

    // ------------------ cross-source ------------------
    case "existsInOtherSource": {
      const src = expression.source;
      const keyField = expression.keyField || "loanId";
      const key = ctx.record?.[keyField];
      const other = ctx.otherSources || {};
      let exists = false;
      if (src === "loanTapeLoans") {
        exists = other.loanTapeLoanIds instanceof Set && other.loanTapeLoanIds.has(key);
      } else if (src === "servicerUpdates") {
        exists = other.servicerUpdates instanceof Map && other.servicerUpdates.has(key);
      } else if (src === "manifestRows") {
        exists = other.manifestRows instanceof Map && other.manifestRows.has(key);
      }
      return { matched: exists, involvedFields: [keyField], contextValues: { [keyField]: key } };
    }
    case "conflictsWithOtherSource": {
      const { source, keyField = "loanId", compareFields = [], onlyIfFresher = false } = expression;
      const other = ctx.otherSources || {};
      const key = ctx.record?.[keyField];
      const map = source === "servicerUpdates" ? other.servicerUpdates : other.manifestRows;
      const otherRow = map instanceof Map ? map.get(key) : null;
      if (!otherRow) {
        return { matched: false, involvedFields: [], contextValues: {} };
      }
      if (onlyIfFresher) {
        const a = toDate(ctx.record?.lastUpdatedAt);
        const b = toDate(otherRow.lastUpdatedAt);
        if (a && b && !(b.getTime() > a.getTime())) {
          return { matched: false, involvedFields: [], contextValues: {} };
        }
      }
      const diffs = [];
      const contextValues = {
        loanTapeLastUpdatedAt: isoOrNull(ctx.record?.lastUpdatedAt),
        servicerLastUpdatedAt: isoOrNull(otherRow.lastUpdatedAt),
      };
      for (const f of compareFields) {
        const av = ctx.record?.[f];
        const bv = otherRow[f];
        if (!looseEq(av, bv)) {
          diffs.push(f);
          contextValues[`loanTape.${f}`] = av;
          contextValues[`servicer.${f}`] = bv;
        }
      }
      if (!diffs.length) {
        return { matched: false, involvedFields: [], contextValues: {} };
      }
      contextValues.conflictField = diffs.join(", ");
      contextValues.otherSourceValue = pick(otherRow, compareFields);
      contextValues.sourceHint = `servicer_update.csv (batch ${otherRow.sourceBatchId?.slice(0, 8) || "?"}, row ${otherRow.sourceRowIndex}, last_updated_at=${isoOrNull(otherRow.lastUpdatedAt)})`;
      return { matched: true, involvedFields: dedupe([keyField, ...diffs]), contextValues };
    }

    // ------------------ custom helpers used in samples/validation_rules.json ------------------
    case "duplicateLoanId": {
      const key = ctx.record?.loanId;
      const set = ctx.otherSources?.duplicateLoanIds;
      const matched = set instanceof Set && set.has(key);
      return { matched, involvedFields: ["loanId"], contextValues: { loanId: key } };
    }
    case "duplicateBorrowerTriple": {
      const key = ctx.record?.loanId;
      const set = ctx.otherSources?.duplicateTripleLoanIds;
      const matched = set instanceof Set && set.has(key);
      return {
        matched,
        involvedFields: ["borrowerId", "originalPrincipal", "originationDate"],
        contextValues: {
          borrowerId: ctx.record?.borrowerId,
          originalPrincipal: ctx.record?.originalPrincipal,
          originationDate: isoOrNull(ctx.record?.originationDate),
        },
      };
    }
    case "manifestHasMissing": {
      const key = ctx.record?.loanId;
      const map = ctx.otherSources?.manifestRows;
      const rows = map instanceof Map ? map.get(key) : null;
      const matched = Array.isArray(rows) && rows.some((r) => r.docStatus === "missing");
      return { matched, involvedFields: ["documentStatus"], contextValues: { documentStatus: ctx.record?.documentStatus } };
    }

    default:
      return { matched: false, involvedFields: [], contextValues: { _unknownOp: op } };
  }
}

// ------------------------- helpers -------------------------

function leafField(expression, ctx, predicate) {
  const f = expression.field;
  const v = ctx.record?.[f];
  const matched = predicate(v);
  return { matched, involvedFields: [f], contextValues: { [f]: isoOrPassthrough(v) } };
}

function looseEq(a, b) {
  if (a === b) return true;
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  if (a instanceof Date || b instanceof Date) {
    const da = toDate(a);
    const db = toDate(b);
    return da && db && da.getTime() === db.getTime();
  }
  // Compare numbers loosely so CSV strings match seeded numeric fixtures.
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && (typeof a === "number" || typeof b === "number")) {
    return na === nb;
  }
  return String(a) === String(b);
}

function numericCompare(a, b, op) {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
  return op(na, nb);
}

function dateCompare(a, b, op) {
  const da = toDate(a);
  const db = toDate(b);
  if (!da || !db) return false;
  return op(da.getTime(), db.getTime());
}

function compareValues(a, b, op2, rightMultiplier) {
  if (a instanceof Date || b instanceof Date) {
    const da = toDate(a);
    const db = toDate(b);
    if (!da || !db) return false;
    return applyOp(da.getTime(), db.getTime(), op2);
  }
  const na = Number(a);
  const nb = Number(b) * Number(rightMultiplier || 1);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
  return applyOp(na, nb, op2);
}

function applyOp(a, b, op) {
  switch (op) {
    case "eq": return a === b;
    case "ne": return a !== b;
    case "lt": return a < b;
    case "lte": return a <= b;
    case "gt": return a > b;
    case "gte": return a >= b;
    default: return false;
  }
}

function toDate(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isoOrNull(v) {
  const d = toDate(v);
  return d ? d.toISOString() : null;
}

function isoOrPassthrough(v) {
  if (v instanceof Date) return v.toISOString();
  return v;
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) out[k] = obj?.[k];
  return out;
}

function dedupe(arr) {
  return [...new Set(arr)];
}
