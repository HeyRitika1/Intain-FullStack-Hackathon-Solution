import crypto from "node:crypto";

export function sha256(str) {
  return crypto.createHash("sha256").update(String(str), "utf8").digest("hex");
}

export function canonicalStringify(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sortValue);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    // ObjectId, Buffer, Decimal128 etc. all expose toJSON — respect it so the
    // canonical form matches what JSON.stringify(value) produces on the wire.
    if (typeof value.toJSON === "function") return sortValue(value.toJSON());
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const v = value[key];
      if (v === undefined) continue;
      out[key] = sortValue(v);
    }
    return out;
  }
  return value;
}

export function linkedHash({ loanId, type, payload, actor, timestamp, prevHash }) {
  const canonical = canonicalStringify({
    loanId,
    type,
    payload: payload ?? null,
    actor: actor ? String(actor) : null,
    timestamp: timestamp instanceof Date ? timestamp.toISOString() : timestamp,
    prevHash: prevHash ?? "GENESIS",
  });
  return sha256(canonical);
}
