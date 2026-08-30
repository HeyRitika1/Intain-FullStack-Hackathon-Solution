// Prompt templates for every AI call in the app. Each template exports
// { system, buildUser(input), parseOutput(rawContent), buildFallback(input),
//   responseFormat? } — the aiService orchestrates them uniformly.

const MONITORED_SERVICER_FIELDS = ["currentBalance", "paymentStatus", "daysPastDue"];

const SUPPORTED_OPS_HINT = `
Supported operators for expressions:
  Leaf: isEmpty, notEmpty, equals, notEquals, lt, lte, gt, gte, inSet, notInSet,
        dateBefore, dateAfter, olderThanDays, regexMatch
  Boolean: and (args), or (args), not (args)
  Cross-field: crossFieldCompare { left, op2, right, rightMultiplier? }
  Cross-source: existsInOtherSource, conflictsWithOtherSource
Return valid JSON only. No prose.
`.trim();

const WHITELISTED_QUERY_FIELDS = [
  "loanId",
  "state",
  "paymentStatus",
  "verificationStatus",
  "daysPastDue",
  "interestRate",
  "currentBalance",
  "originalPrincipal",
  "trustScore",
];

// ---------------- helpers ----------------

function interpolate(template, bag) {
  if (!template) return "";
  return String(template).replace(/\{(\w+)\}/g, (_, key) => {
    const v = bag[key];
    if (v === null || v === undefined) return `{${key}}`;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v);
  });
}

function safeParseJson(raw) {
  if (typeof raw !== "string") return raw;
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("empty response");
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    // Strip common wrapping ("```json ... ```") and retry.
    const fenced = trimmed.replace(/^```[a-z]*\s*/i, "").replace(/```$/, "").trim();
    return JSON.parse(fenced);
  }
}

function daysBetween(a, b) {
  const da = a instanceof Date ? a : new Date(a);
  const db = b instanceof Date ? b : new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return null;
  return Math.round(Math.abs(db.getTime() - da.getTime()) / (1000 * 60 * 60 * 24));
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

function shortDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// ---------------- explain_failure ----------------

const explainFailure = {
  system:
    "You are a data-quality analyst helping a loan reviewer understand why a validation rule fired. Respond in strict JSON with keys: explanation (2-4 plain-English sentences), involvedFields (array of loan field names), reasoningChain (array of {step, detail} pairs, at least 3 items), confidence (0-1).",

  buildUser({ loan, exception, rule }) {
    return JSON.stringify({
      instruction: "Explain why this exception fired. Do not suggest a correction here.",
      loan: pickLoan(loan),
      exception: pickException(exception),
      rule: pickRule(rule),
    });
  },

  parseOutput(raw) {
    const j = safeParseJson(raw);
    if (typeof j.explanation !== "string" || !Array.isArray(j.reasoningChain)) {
      throw new Error("output missing explanation/reasoningChain");
    }
    return {
      explanation: j.explanation,
      involvedFields: Array.isArray(j.involvedFields) ? j.involvedFields : [],
      reasoningChain: j.reasoningChain,
      confidence: clampConfidence(j.confidence, 0.7),
    };
  },

  buildFallback({ loan, exception, rule }) {
    const cv = exception?.context?.contextValues || {};
    const flat = { ...loan, ...cv };
    const rendered = interpolate(rule?.messageTemplate || exception?.message || "", flat);
    const valuesDetail = Object.entries(cv)
      .filter(([k]) => !k.startsWith("_"))
      .slice(0, 6)
      .map(([k, v]) => `${k}=${format(v)}`)
      .join(", ") || "(no context captured)";

    return {
      explanation:
        `${rendered || "Rule matched on this loan."} This is why the '${rule?.ruleId || exception?.ruleId}' check flagged it.`,
      involvedFields: Array.isArray(exception?.fields) ? exception.fields : [],
      reasoningChain: [
        { step: "Rule fired", detail: rule?.ruleId || exception?.ruleId || "unknown" },
        { step: "Values", detail: valuesDetail },
        { step: "Why this matters", detail: rule?.description || "Data integrity: the flagged combination is invalid or inconsistent." },
      ],
      confidence: 0.55,
    };
  },
};

// ---------------- suggest_correction ----------------

const suggestCorrection = {
  system:
    "You are a data-quality analyst. Propose the minimal correction the reviewer should apply. Respond in strict JSON with keys: suggestedFields (object of loanField -> proposedValue), sourceHint (string), rationale (string), confidence (0-1). Suggest ONLY fields from this whitelist: borrowerName, state, currentBalance, interestRate, paymentStatus, daysPastDue, lastUpdatedAt, documentStatus. If no confident correction is possible, return suggestedFields: {} with a clear rationale.",

  buildUser({ loan, exception, rule, servicerUpdate }) {
    return JSON.stringify({
      instruction: "Suggest a correction. Prefer values already present in servicerUpdate when it is fresher.",
      loan: pickLoan(loan),
      exception: pickException(exception),
      rule: pickRule(rule),
      servicerUpdate: servicerUpdate ? pickServicer(servicerUpdate) : null,
    });
  },

  parseOutput(raw) {
    const j = safeParseJson(raw);
    return {
      suggestedFields: j.suggestedFields && typeof j.suggestedFields === "object" ? j.suggestedFields : {},
      sourceHint: typeof j.sourceHint === "string" ? j.sourceHint : null,
      rationale: typeof j.rationale === "string" ? j.rationale : "",
      confidence: clampConfidence(j.confidence, 0.6),
    };
  },

  buildFallback({ loan, exception, rule, servicerUpdate }) {
    const ruleId = rule?.ruleId || exception?.ruleId;
    const cv = exception?.context?.contextValues || {};

    switch (ruleId) {
      case "BALANCE_EXCEEDS_PRINCIPAL": {
        const cap = Number(loan?.originalPrincipal);
        return {
          suggestedFields: Number.isFinite(cap) ? { currentBalance: cap } : {},
          sourceHint: "clamp to originalPrincipal (1.00x)",
          rationale: "Amortizing loans cannot re-inflate their balance; capping at the original principal is the conservative correction.",
          confidence: 0.7,
        };
      }
      case "NEGATIVE_BALANCE":
        return {
          suggestedFields: { currentBalance: 0 },
          sourceHint: "floor at zero",
          rationale: "A loan cannot carry a negative outstanding balance; setting it to zero preserves accounting integrity until a servicer refresh arrives.",
          confidence: 0.7,
        };
      case "INTEREST_RATE_OUT_OF_RANGE": {
        const raw = Number(loan?.interestRate);
        const clamped = Number.isFinite(raw) && raw > 30 ? 15 : (Number.isFinite(raw) && raw < 0 ? 0 : 15);
        return {
          suggestedFields: { interestRate: clamped },
          sourceHint: "range clamp to typical 0-30 window",
          rationale: `Interest rate ${raw} sits outside the allowed 0-30 range. Clamping to a plausible ${clamped} while a source refresh is requested.`,
          confidence: 0.7,
        };
      }
      case "STATUS_DPD_MISMATCH": {
        const dpd = Number(loan?.daysPastDue);
        const status = loan?.paymentStatus;
        if (status === "current" && dpd > 30) {
          return {
            suggestedFields: { paymentStatus: "delinquent" },
            sourceHint: "reconciled from daysPastDue",
            rationale: "Days past due exceeds 30 while status reads current; delinquent is the honest reconciliation.",
            confidence: 0.5,
          };
        }
        if (status === "delinquent" && dpd === 0) {
          return {
            suggestedFields: { paymentStatus: "current" },
            sourceHint: "reconciled from daysPastDue=0",
            rationale: "Days past due is 0 while status reads delinquent; current is the reconciliation.",
            confidence: 0.5,
          };
        }
        return { suggestedFields: {}, sourceHint: null, rationale: "Requires manual review of servicing history.", confidence: 0.4 };
      }
      case "CLOSED_BUT_POSITIVE_BALANCE":
        return {
          suggestedFields: { currentBalance: 0 },
          sourceHint: "closed/paid_off status implies zero balance",
          rationale: "Loans marked paid_off or closed cannot carry a positive balance; setting to zero.",
          confidence: 0.7,
        };
      case "INVALID_STATE_CODE":
        return {
          suggestedFields: { state: null },
          sourceHint: null,
          rationale: "State is not a recognized US 2-letter code and requires manual entry — no confident source.",
          confidence: 0.4,
        };
      case "CROSS_SOURCE_CONFLICT": {
        if (!servicerUpdate) {
          return { suggestedFields: {}, sourceHint: null, rationale: "No servicer update available.", confidence: 0.4 };
        }
        const suggested = {};
        for (const f of MONITORED_SERVICER_FIELDS) {
          if (servicerUpdate[f] !== undefined && servicerUpdate[f] !== null && servicerUpdate[f] !== loan?.[f]) {
            suggested[f] = servicerUpdate[f];
          }
        }
        const dt = shortDate(servicerUpdate.lastUpdatedAt);
        const row = servicerUpdate.sourceRowIndex || "?";
        return {
          suggestedFields: suggested,
          sourceHint: `servicer_update.csv row ${row}, last_updated_at=${dt || "?"}`,
          rationale: "Servicer update is the fresher source on the monitored fields; accepting it reconciles the disagreement.",
          confidence: 0.7,
        };
      }
      case "STALE_LAST_UPDATED":
        return {
          suggestedFields: { lastUpdatedAt: null },
          sourceHint: null,
          rationale: "Last updated is older than 365 days. Request a fresh servicer feed rather than backdating.",
          confidence: 0.4,
        };
      case "MISSING_DOCUMENTS":
        return {
          suggestedFields: {},
          sourceHint: null,
          rationale: "Request the missing documents from the custodian before touching the record.",
          confidence: 0.4,
        };
      case "DUPLICATE_LOAN_ID":
      case "DUPLICATE_BORROWER_TRIPLE":
      case "ORPHAN_SERVICER_UPDATE":
      case "ORPHAN_DOCUMENT":
        return {
          suggestedFields: {},
          sourceHint: null,
          rationale: "Duplicate/orphan patterns require manual reconciliation with source systems.",
          confidence: 0.4,
        };
      default:
        return {
          suggestedFields: {},
          sourceHint: null,
          rationale: `No canned fallback for rule '${ruleId}'. Reviewer should decide manually.`,
          confidence: 0.4,
        };
    }
  },
};

// ---------------- compare_sources ----------------

const compareSources = {
  system:
    "You are reconciling a loan_tape row against a servicer_update row. Respond in strict JSON: diffs (array of {field, loanTapeValue, servicerValue, fresher}), summary (1-2 sentences), confidence (0-1).",

  buildUser({ loan, servicerUpdate }) {
    return JSON.stringify({
      instruction: "Diff the monitored fields; state which side is fresher for each and summarize.",
      monitoredFields: MONITORED_SERVICER_FIELDS,
      loan: pickLoan(loan),
      servicerUpdate: pickServicer(servicerUpdate),
    });
  },

  parseOutput(raw) {
    const j = safeParseJson(raw);
    return {
      diffs: Array.isArray(j.diffs) ? j.diffs : [],
      summary: typeof j.summary === "string" ? j.summary : "",
      confidence: clampConfidence(j.confidence, 0.6),
    };
  },

  buildFallback({ loan, servicerUpdate }) {
    const diffs = [];
    const fresher = fresherOf(loan?.lastUpdatedAt, servicerUpdate?.lastUpdatedAt);
    for (const f of MONITORED_SERVICER_FIELDS) {
      const a = loan?.[f];
      const b = servicerUpdate?.[f];
      if (a !== b && !(a == null && b == null)) {
        diffs.push({ field: f, loanTapeValue: a ?? null, servicerValue: b ?? null, fresher });
      }
    }
    const days = daysBetween(loan?.lastUpdatedAt, servicerUpdate?.lastUpdatedAt);
    const summary = diffs.length
      ? `Servicer update ${fresher === "servicer" ? `is ${days ?? "?"} days fresher and` : "differs and"} disagrees on ${diffs.map((d) => d.field).join(", ")}.`
      : "No monitored fields disagree.";
    return { diffs, summary, confidence: diffs.length ? 0.6 : 0.9 };
  },
};

// ---------------- generate_reviewer_note ----------------

const generateReviewerNote = {
  system:
    "You are drafting a short reviewer note documenting a decision on one or more loan exceptions. Respond in strict JSON: { note: string, confidence: 0-1 }. Keep it under 400 characters.",

  buildUser({ loan, exceptions, decisionAction }) {
    return JSON.stringify({
      instruction: "Draft a concise reviewer note.",
      decisionAction,
      loan: pickLoan(loan),
      exceptions: (exceptions || []).map(pickException),
    });
  },

  parseOutput(raw) {
    const j = safeParseJson(raw);
    return {
      note: typeof j.note === "string" ? j.note : "",
      confidence: clampConfidence(j.confidence, 0.7),
    };
  },

  buildFallback({ loan, exceptions, decisionAction }) {
    const ruleIds = (exceptions || []).map((e) => e.ruleId).join(", ");
    const sourceHint = exceptions?.find((e) => e.context?.sourceHint)?.context?.sourceHint || "manual entry";
    return {
      note: `${decisionAction || "reviewed"} on ${loan?.loanId || "loan"} for exception(s) ${ruleIds || "(none)"}. Reviewer confirmed values per ${sourceHint}.`,
      confidence: 0.6,
    };
  },
};

// ---------------- classify_severity ----------------

const classifySeverity = {
  system:
    "You are a data-quality analyst. Given an exception and its rule definition, propose a severity level (blocking | high | medium | low). Respond in strict JSON: { severity, rationale, confidence }.",

  buildUser({ exception, rule }) {
    return JSON.stringify({
      instruction: "Classify severity honestly. Prefer to keep the rule's default unless context clearly warrants a change.",
      exception: pickException(exception),
      rule: pickRule(rule),
    });
  },

  parseOutput(raw) {
    const j = safeParseJson(raw);
    const allowed = ["blocking", "high", "medium", "low"];
    return {
      severity: allowed.includes(j.severity) ? j.severity : "medium",
      rationale: typeof j.rationale === "string" ? j.rationale : "",
      confidence: clampConfidence(j.confidence, 0.7),
    };
  },

  buildFallback({ exception, rule }) {
    return {
      severity: rule?.severity || exception?.severity || "medium",
      rationale: `Echoing the rule's declared severity (${rule?.severity || "n/a"}); fallback cannot re-classify meaningfully.`,
      confidence: 0.5,
    };
  },
};

// ---------------- summarize_batch ----------------

const summarizeBatch = {
  system:
    "You are summarizing a validation batch for an operations lead. Respond in strict JSON: { summary: 3-5 sentence string, topRisks: array of ruleId strings, confidence: 0-1 }.",

  buildUser({ batchId, counts }) {
    return JSON.stringify({
      instruction: "Summarize the batch; highlight the top 3 risky rules by count.",
      batchId,
      counts,
    });
  },

  parseOutput(raw) {
    const j = safeParseJson(raw);
    return {
      summary: typeof j.summary === "string" ? j.summary : "",
      topRisks: Array.isArray(j.topRisks) ? j.topRisks.slice(0, 5) : [],
      confidence: clampConfidence(j.confidence, 0.7),
    };
  },

  buildFallback({ batchId, counts }) {
    const byRule = counts?.byRule || {};
    const topRisks = Object.entries(byRule)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([r]) => r);
    const bs = counts?.bySeverity || {};
    const summary =
      `Batch ${batchId || "?"} produced ${counts?.total ?? "?"} exceptions: ` +
      `${bs.blocking || 0} blocking, ${bs.high || 0} high, ${bs.medium || 0} medium, ${bs.low || 0} low. ` +
      `Top rules by count: ${topRisks.join(", ") || "n/a"}. ` +
      `Reviewer triage should start with blocking severities before mopping up low-severity noise.`;
    return { summary, topRisks, confidence: 0.6 };
  },
};

// ---------------- rule_from_nl ----------------

const ruleFromNl = {
  system:
    "You translate a plain-English validation intent into a ValidationRule JSON object. Respond in strict JSON with keys: ruleId (SCREAMING_SNAKE_CASE slug), name, description, severity (blocking|high|medium|low), messageTemplate, expression, appliesTo (usually 'loan'). " +
    SUPPORTED_OPS_HINT,

  buildUser({ naturalLanguage }) {
    return JSON.stringify({ instruction: "Draft a rule.", naturalLanguage });
  },

  parseOutput(raw) {
    const j = safeParseJson(raw);
    if (!j.ruleId || !j.expression) throw new Error("output missing ruleId/expression");
    return {
      ruleId: String(j.ruleId).toUpperCase().replace(/[^A-Z0-9_]/g, "_"),
      name: j.name || j.ruleId,
      description: j.description || "",
      severity: ["blocking", "high", "medium", "low"].includes(j.severity) ? j.severity : "medium",
      messageTemplate: j.messageTemplate || "Rule matched",
      expression: j.expression,
      appliesTo: ["loan", "servicerUpdate", "manifest"].includes(j.appliesTo) ? j.appliesTo : "loan",
    };
  },

  buildFallback({ naturalLanguage }) {
    const nl = String(naturalLanguage || "").toLowerCase();
    const parsed = keywordParseRule(nl);
    if (!parsed) {
      return { error: "Fallback could not parse; please use the real AI provider or write the rule manually." };
    }
    return parsed;
  },
};

// ---------------- converse_query ----------------

const converseQuery = {
  system:
    `You translate a plain-English question about verified loan data into a MongoDB filter. ` +
    `Fields whitelist: ${WHITELISTED_QUERY_FIELDS.join(", ")}. ` +
    `Operators whitelist: $eq $ne $gt $gte $lt $lte $in $nin $and $or $regex. ` +
    `Return strict JSON: { mongoFilter: object, humanSummary: string, involvedFields: array, confidence: 0-1 }.`,

  buildUser({ naturalLanguage, schemaHint }) {
    return JSON.stringify({
      instruction: "Translate the question to a Mongo filter over verified loan records.",
      naturalLanguage,
      allowedFields: schemaHint || WHITELISTED_QUERY_FIELDS,
    });
  },

  parseOutput(raw) {
    const j = safeParseJson(raw);
    return {
      mongoFilter: j.mongoFilter && typeof j.mongoFilter === "object" ? j.mongoFilter : {},
      humanSummary: typeof j.humanSummary === "string" ? j.humanSummary : "",
      involvedFields: Array.isArray(j.involvedFields) ? j.involvedFields : [],
      confidence: clampConfidence(j.confidence, 0.6),
      sort: j.sort && typeof j.sort === "object" ? j.sort : null,
      limit: Number.isFinite(Number(j.limit)) ? Math.min(50, Number(j.limit)) : null,
    };
  },

  buildFallback({ naturalLanguage }) {
    const parsed = keywordParseConverse(String(naturalLanguage || "").toLowerCase());
    if (!parsed) return { error: "Unable to translate query in fallback mode.", fallbackMode: true };
    return parsed;
  },
};

// ---------------- exports ----------------

export const TEMPLATES = {
  explain_failure: explainFailure,
  suggest_correction: suggestCorrection,
  compare_sources: compareSources,
  generate_reviewer_note: generateReviewerNote,
  classify_severity: classifySeverity,
  summarize_batch: summarizeBatch,
  rule_from_nl: ruleFromNl,
  converse_query: converseQuery,
};

// ---------------- shared helpers ----------------

function pickLoan(loan) {
  if (!loan) return null;
  const keys = [
    "loanId", "borrowerId", "borrowerName", "state",
    "originationDate", "maturityDate", "originalPrincipal", "currentBalance",
    "interestRate", "paymentStatus", "daysPastDue", "lastUpdatedAt",
    "documentStatus", "verificationStatus",
  ];
  const out = {};
  for (const k of keys) if (loan[k] !== undefined) out[k] = normalize(loan[k]);
  return out;
}

function pickException(exception) {
  if (!exception) return null;
  return {
    exceptionId: exception.exceptionId,
    loanId: exception.loanId,
    ruleId: exception.ruleId,
    ruleName: exception.ruleName,
    severity: exception.severity,
    status: exception.status,
    message: exception.message,
    fields: exception.fields,
    context: exception.context,
  };
}

function pickRule(rule) {
  if (!rule) return null;
  return {
    ruleId: rule.ruleId,
    name: rule.name,
    description: rule.description,
    severity: rule.severity,
    messageTemplate: rule.messageTemplate,
    expression: rule.expression,
    appliesTo: rule.appliesTo,
  };
}

function pickServicer(row) {
  if (!row) return null;
  return {
    loanId: row.loanId,
    currentBalance: row.currentBalance,
    paymentStatus: row.paymentStatus,
    daysPastDue: row.daysPastDue,
    lastUpdatedAt: normalize(row.lastUpdatedAt),
    sourceRowIndex: row.sourceRowIndex,
  };
}

function normalize(v) {
  if (v instanceof Date) return v.toISOString();
  return v;
}

function clampConfidence(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function format(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// ---------------- keyword parsers ----------------

const STATE_CODES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
]);

function keywordParseRule(nl) {
  // Determine field
  const fieldMap = [
    { field: "interestRate", pattern: /interest\s*rate/ },
    { field: "currentBalance", pattern: /current\s*balance|balance/ },
    { field: "originalPrincipal", pattern: /original\s*principal|principal/ },
    { field: "daysPastDue", pattern: /days\s*past\s*due|dpd/ },
    { field: "state", pattern: /state/ },
    { field: "paymentStatus", pattern: /payment\s*status|status/ },
    { field: "documentStatus", pattern: /document\s*status|documents?/ },
    { field: "lastUpdatedAt", pattern: /last\s*updated|last_updated/ },
    { field: "borrowerName", pattern: /borrower\s*name|borrower/ },
  ];
  const field = fieldMap.find((f) => f.pattern.test(nl))?.field;
  if (!field) return null;

  let expression = null;
  let messageTemplate = "";
  let name = "";
  let severity = "medium";

  // "above N" / "over N" / ">= N"
  const gt = /(?:above|over|more than|greater than|>\s*)\s*(\d+(?:\.\d+)?)/.exec(nl);
  const lt = /(?:below|under|less than|<\s*)\s*(\d+(?:\.\d+)?)/.exec(nl);
  const older = /older than\s*(\d+)\s*days/.exec(nl);

  if (gt) {
    const v = Number(gt[1]);
    expression = { op: "gt", field, value: v };
    messageTemplate = `${field} exceeds ${v}`;
    name = `${field} above ${v}`;
  } else if (lt) {
    const v = Number(lt[1]);
    expression = { op: "lt", field, value: v };
    messageTemplate = `${field} below ${v}`;
    name = `${field} below ${v}`;
  } else if (older) {
    const v = Number(older[1]);
    expression = { op: "olderThanDays", field, days: v };
    messageTemplate = `${field} older than ${v} days`;
    name = `${field} stale > ${v}d`;
  } else if (/is\s+missing|missing/.test(nl)) {
    expression = { op: "isEmpty", field };
    messageTemplate = `${field} is missing`;
    name = `${field} missing`;
    severity = "blocking";
  } else if (/equals?\s+"?([^"]+)"?/.test(nl)) {
    const m = /equals?\s+"?([^"]+)"?/.exec(nl);
    expression = { op: "equals", field, value: m[1].trim() };
    messageTemplate = `${field} equals ${m[1].trim()}`;
    name = `${field} equals ${m[1].trim()}`;
  } else {
    return null;
  }

  const slug = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return {
    ruleId: slug || "FALLBACK_RULE",
    name,
    description: `Auto-generated from: "${nl.slice(0, 120)}"`,
    severity,
    messageTemplate,
    expression,
    appliesTo: "loan",
  };
}

function keywordParseConverse(nl) {
  const filter = {};
  const involved = [];
  let sort = null;
  let limit = null;

  // state
  const stateMatch = nl.match(/\b(?:in|state)\s+([a-z]{2})\b/) || nl.match(/\b([a-z]{2})\s+loans?\b/);
  if (stateMatch) {
    const code = stateMatch[1].toUpperCase();
    if (STATE_CODES.has(code)) { filter.state = code; involved.push("state"); }
  }
  const stateName = nl.match(/\b(texas|california|new york|florida|illinois)\b/);
  const NAME_MAP = { texas: "TX", california: "CA", "new york": "NY", florida: "FL", illinois: "IL" };
  if (stateName && !filter.state) { filter.state = NAME_MAP[stateName[1]]; involved.push("state"); }

  // past due N days
  const pd = nl.match(/past due (?:more than|over|>)?\s*(\d+)\s*days?/);
  if (pd) { filter.daysPastDue = { $gt: Number(pd[1]) }; involved.push("daysPastDue"); }

  // trust score above/below N
  const ts = nl.match(/trust score (above|below)\s*(\d+)/);
  if (ts) {
    filter.trustScore = ts[1] === "above" ? { $gt: Number(ts[2]) } : { $lt: Number(ts[2]) };
    involved.push("trustScore");
  }

  // interest rate above/below N
  const ir = nl.match(/interest rate (above|below|over|under)\s*(\d+(?:\.\d+)?)/);
  if (ir) {
    filter.interestRate = /above|over/.test(ir[1]) ? { $gt: Number(ir[2]) } : { $lt: Number(ir[2]) };
    involved.push("interestRate");
  }

  // current balance above/below N
  const cb = nl.match(/(?:current\s*)?balance (above|below|over|under)\s*([\d,]+)/);
  if (cb) {
    const n = Number(cb[2].replace(/,/g, ""));
    filter.currentBalance = /above|over/.test(cb[1]) ? { $gt: n } : { $lt: n };
    involved.push("currentBalance");
  }

  // verified / not verified
  if (/\bnot verified\b/.test(nl)) { filter.verificationStatus = { $ne: "verified" }; involved.push("verificationStatus"); }
  else if (/\bverified\b/.test(nl)) { filter.verificationStatus = "verified"; involved.push("verificationStatus"); }

  // top N loans by <field> → sort desc + limit
  const top = nl.match(/top\s+(\d+)\s+loans?\s+by\s+(trust(?:\s*score)?|current\s*balance|original\s*principal|interest\s*rate|days\s*past\s*due)/);
  if (top) {
    const field = ({
      "trust": "trustScore",
      "trust score": "trustScore",
      "current balance": "currentBalance",
      "original principal": "originalPrincipal",
      "interest rate": "interestRate",
      "days past due": "daysPastDue",
    })[top[2].replace(/\s+/g, " ")];
    if (field) {
      sort = { [field]: -1 };
      limit = Math.min(50, Number(top[1]));
      involved.push(field);
    }
  }

  // "last N days" freshness hint — not a whitelisted filter field, but we
  // interpret it as "verified" + a note (verifiedAt filtering happens client-side).
  const lastDays = nl.match(/last\s+(\d+)\s+days?/);
  const freshnessNote = lastDays ? `updated within the last ${lastDays[1]} days` : null;
  if (lastDays && !filter.verificationStatus) {
    filter.verificationStatus = "verified";
    involved.push("verificationStatus");
  }

  if (!Object.keys(filter).length && !sort) return null;

  const parts = [];
  if (filter.state) parts.push(`state=${filter.state}`);
  if (filter.daysPastDue?.$gt !== undefined) parts.push(`daysPastDue > ${filter.daysPastDue.$gt}`);
  if (filter.trustScore?.$gt !== undefined) parts.push(`trustScore > ${filter.trustScore.$gt}`);
  if (filter.trustScore?.$lt !== undefined) parts.push(`trustScore < ${filter.trustScore.$lt}`);
  if (filter.interestRate?.$gt !== undefined) parts.push(`interestRate > ${filter.interestRate.$gt}`);
  if (filter.interestRate?.$lt !== undefined) parts.push(`interestRate < ${filter.interestRate.$lt}`);
  if (filter.currentBalance?.$gt !== undefined) parts.push(`currentBalance > ${filter.currentBalance.$gt}`);
  if (filter.currentBalance?.$lt !== undefined) parts.push(`currentBalance < ${filter.currentBalance.$lt}`);
  if (filter.verificationStatus) parts.push(`verified: ${JSON.stringify(filter.verificationStatus)}`);
  if (sort) parts.push(`sort by ${Object.keys(sort)[0]} desc, top ${limit}`);
  if (freshnessNote) parts.push(freshnessNote);

  return {
    mongoFilter: filter,
    humanSummary: `Filter: ${parts.join(" AND ")}`,
    involvedFields: involved,
    confidence: 0.6,
    sort,
    limit,
  };
}
