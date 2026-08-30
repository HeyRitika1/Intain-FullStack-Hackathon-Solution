import { HttpError } from "../middleware/error.js";

const SEVERITY_ORDER = { blocking: 4, high: 3, medium: 2, low: 1 };

export function parsePagination(query, { defaultLimit = 25, maxLimit = 100 } = {}) {
  const page = Math.max(Number(query.page) || 1, 1);
  const rawLimit = Number(query.limit) || defaultLimit;
  if (rawLimit > maxLimit) {
    throw new HttpError(400, `limit cannot exceed ${maxLimit}`);
  }
  const limit = Math.max(rawLimit, 1);
  return { page, limit, skip: (page - 1) * limit };
}

export function paginationMeta({ total, page, limit }) {
  return { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) };
}

export function parseCsvList(value, allowed = null) {
  if (value === undefined || value === null || value === "") return null;
  const parts = String(value)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  if (allowed) {
    for (const p of parts) {
      if (!allowed.includes(p)) throw new HttpError(400, `Unsupported value '${p}'`);
    }
  }
  return parts;
}

export function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const severityOrder = SEVERITY_ORDER;

// Emit a $addFields stage that adds `_severityRank` (1..4). Use before $sort.
export function severityRankStage(field = "$severity") {
  return {
    $addFields: {
      _severityRank: {
        $switch: {
          branches: [
            { case: { $eq: [field, "blocking"] }, then: 4 },
            { case: { $eq: [field, "high"] }, then: 3 },
            { case: { $eq: [field, "medium"] }, then: 2 },
            { case: { $eq: [field, "low"] }, then: 1 },
          ],
          default: 0,
        },
      },
    },
  };
}
