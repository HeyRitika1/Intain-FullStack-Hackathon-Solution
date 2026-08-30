// Browser-side SHA-256 + canonical JSON serializer.
// Must produce the EXACT same output as backend/src/utils/hash.js so that
// bundle re-hashing on the client matches the server-computed bundleHash.

function sortValue(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sortValue);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
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

export function canonicalStringify(value) {
  return JSON.stringify(sortValue(value));
}

export async function sha256Hex(input) {
  const text = typeof input === "string" ? input : canonicalStringify(input);
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function recomputeBundleHash(bundle) {
  const { bundleHash: _server, ...rest } = bundle;
  return sha256Hex(canonicalStringify(rest));
}
