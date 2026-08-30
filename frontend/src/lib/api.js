import axios from "axios";

const rawBaseUrl = import.meta.env.VITE_API_URL || "";
const baseURL = rawBaseUrl ? `${rawBaseUrl.replace(/\/$/, "")}/api` : "/api";

const client = axios.create({ baseURL });

const TOKEN_KEY = "authToken";

export function getStoredToken() {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
  } catch {
    return null;
  }
}

export function setStoredToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

client.interceptors.request.use((config) => {
  const token = getStoredToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

client.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err?.response?.status;
    if (status === 401) {
      setStoredToken(null);
      if (typeof window !== "undefined" && window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(normalizeError(err));
  }
);

function normalizeError(err) {
  const status = err?.response?.status;
  const data = err?.response?.data;
  const message =
    (data && (data.error || data.message)) || err?.message || "Request failed";
  const wrapped = new Error(message);
  wrapped.status = status;
  wrapped.data = data;
  return wrapped;
}

export const apiGet = (path, config) => client.get(path, config).then((r) => r.data);
export const apiPost = (path, body, config) => client.post(path, body, config).then((r) => r.data);
export const apiPatch = (path, body, config) => client.patch(path, body, config).then((r) => r.data);
export const apiDelete = (path, config) => client.delete(path, config).then((r) => r.data);
export const apiUpload = (path, file, extraFields = {}, config = {}) => {
  const form = new FormData();
  form.append("file", file);
  for (const [k, v] of Object.entries(extraFields)) form.append(k, v);
  return client
    .post(path, form, {
      ...config,
      headers: { ...(config.headers || {}), "Content-Type": "multipart/form-data" },
    })
    .then((r) => r.data);
};

// Legacy shim so lingering `api.get(...)` calls still work while prompts land.
export const api = {
  get: apiGet,
  post: apiPost,
  patch: apiPatch,
  del: apiDelete,
};

// ---- Prompt 18 typed helpers used by Prompts 19 + 20 dashboards ----

export const getSummary = () => apiGet("/summary");
export const getSummaryTrust = (filters = {}) => apiGet(`/summary/trust${toQs(filters)}`);

export async function exportVerified(format = "csv", filters = {}) {
  const qs = toQs({ ...filters, format });
  const res = await client.get(`/verified/export${qs}`, { responseType: "blob" });
  const filename = extractFilename(res, `verified-loans.${format}`);
  triggerDownload(res.data, filename);
  return { filename };
}

export async function exportBundle(filters = {}) {
  const qs = toQs(filters);
  const res = await client.get(`/verified/export/bundle${qs}`, { responseType: "blob" });
  const filename = extractFilename(res, "verified-dataset.json");
  triggerDownload(res.data, filename);
  return { filename };
}

// Live-capture hook — usable from the browser console during a demo:
//   window.logDevEntry({ module: "demo-script", tool: "manual", outcome: "accepted", prompt: "…", notes: "…" })
// Admin-only server-side; helper just POSTs.
export const logDevEntry = (payload) => apiPost("/dev-log", payload);
if (typeof window !== "undefined") {
  window.logDevEntry = logDevEntry;
}

function toQs(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null || v === "") continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

function extractFilename(res, fallback) {
  const hdr = res.headers?.["content-disposition"] || res.headers?.get?.("content-disposition") || "";
  const match = /filename="?([^"]+)"?/.exec(hdr);
  return match ? match[1] : fallback;
}

function triggerDownload(blob, filename) {
  if (typeof window === "undefined") return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default client;
