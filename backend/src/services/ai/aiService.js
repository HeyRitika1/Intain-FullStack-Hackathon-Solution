import { AiRecommendation } from "../../models/index.js";
import { env } from "../../config/env.js";
import { HttpError } from "../../middleware/error.js";
import { appendAuditEvent } from "../ingestService.js";
import { logger } from "../../utils/logger.js";
import { chatComplete, AiProviderError } from "./providers/openaiCompatible.js";
import { TEMPLATES } from "./promptTemplates.js";

const CACHE_TTL_MS = 60_000;
const cache = new Map();

function cacheKey({ templateName, exceptionId, loanId }) {
  if (templateName === "converse_query") return null;
  return `${templateName}||${exceptionId || ""}||${loanId || ""}`;
}

function getCached(key) {
  if (!key) return null;
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit;
}

function setCached(key, recId) {
  if (!key) return;
  cache.set(key, { at: Date.now(), recId: String(recId) });
}

/**
 * Single entry point for every AI feature.
 *   run({ templateName, input, actor, loanId, exceptionId })
 *   - loanId here is the loanId (or synthetic __BATCH__ / __QUERY__ / __RULES__) the
 *     audit event should be linked to.
 *   - Returns { rec, cached }.
 */
export async function run({ templateName, input, actor = null, loanId = null, exceptionId = null }) {
  const tpl = TEMPLATES[templateName];
  if (!tpl) throw new HttpError(400, `Unknown AI template: ${templateName}`);

  const ck = cacheKey({ templateName, exceptionId, loanId });
  const cached = getCached(ck);
  if (cached) {
    const doc = await AiRecommendation.findById(cached.recId).lean();
    if (doc) return { rec: doc, cached: true };
    cache.delete(ck);
  }

  const system = tpl.system;
  const user = tpl.buildUser(input);
  const promptSnapshot = { system, user };

  const useProvider = env.AI_ENABLED && env.AI_API_KEY;
  let output;
  let fallbackUsed = false;
  let model = "deterministic-fallback-v1";
  let providerLatencyMs = 0;

  if (useProvider) {
    try {
      const resp = await chatComplete({
        system,
        user,
        responseFormat: tpl.responseFormat || "json",
      });
      try {
        output = tpl.parseOutput(resp.content);
        model = resp.model;
        providerLatencyMs = resp.latencyMs;
      } catch (parseErr) {
        logger.warn(`[ai] parse failed for ${templateName}: ${parseErr.message}`);
        output = {
          ...tpl.buildFallback(input),
          _providerError: `parse: ${parseErr.message}`,
        };
        fallbackUsed = true;
      }
    } catch (err) {
      const kind = err instanceof AiProviderError ? err.kind : "network";
      const detailStr = err.details ? ` (${typeof err.details === "object" ? JSON.stringify(err.details) : err.details})` : "";
      logger.warn(`[ai] provider ${kind} error for ${templateName}: ${err.message}${detailStr}`);
      output = {
        ...tpl.buildFallback(input),
        _providerError: `${kind}: ${err.message}${detailStr}`,
      };
      fallbackUsed = true;
    }
  } else {
    output = tpl.buildFallback(input);
    fallbackUsed = true;
  }

  const confidence = typeof output?.confidence === "number" ? output.confidence : null;
  const sourceHint = output?.sourceHint || null;

  const rec = await AiRecommendation.create({
    loanId: loanId || null,
    exceptionId: exceptionId || null,
    templateName,
    promptSnapshot: JSON.stringify(promptSnapshot),
    model,
    providerLatencyMs,
    output,
    confidence,
    sourceHint,
    fallbackUsed,
    createdBy: actor,
  });

  // Audit event is linked to the loanId or the synthetic id the caller supplied.
  const eventLoanId = loanId || `__EXCEPTION__${exceptionId || "unknown"}`;
  await appendAuditEvent({
    loanId: eventLoanId,
    type: "ai_recommendation",
    payload: {
      templateName,
      model,
      fallbackUsed,
      confidence,
      exceptionId: exceptionId || null,
      recommendationId: String(rec._id),
    },
    actor,
    actorRole: null,
  });

  setCached(ck, rec._id);
  return { rec: rec.toObject(), cached: false };
}

export function _clearCacheForTest() {
  cache.clear();
}
