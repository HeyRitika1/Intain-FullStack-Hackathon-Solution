// Environment sanity check. Prints one line per check with an ASCII "OK" or
// "FAIL" marker so Windows PowerShell renders it correctly. Exits non-zero on
// any failure.
//
// Usage:
//   npm --workspace backend run check:env
//   node scripts/checkEnv.js

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const ENV_PATH = path.join(REPO_ROOT, ".env");
const EXAMPLE_PATH = path.join(REPO_ROOT, ".env.example");

let failed = 0;
function ok(label, detail = "") { console.log(`  [ OK ] ${label}${detail ? " - " + detail : ""}`); }
function fail(label, detail = "") { console.log(`  [FAIL] ${label}${detail ? " - " + detail : ""}`); failed++; }
function note(label) { console.log(`  [....] ${label}`); }

// ---- .env presence ----

if (!fs.existsSync(ENV_PATH)) {
  console.log("  [FAIL] .env missing");
  if (fs.existsSync(EXAMPLE_PATH)) {
    console.log("         copy the template and fill it in:");
    console.log("         Copy-Item .env.example .env");
  }
  process.exit(1);
}
ok(".env present", ENV_PATH);

// ---- Load .env into process.env (without polluting a full app) ----
// The backend uses `dotenv/config` when it boots, but this script runs
// standalone, so we parse minimally here.
loadEnvFile(ENV_PATH);

// ---- Node version ----

const nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
if (Number.isFinite(nodeMajor) && nodeMajor >= 18) ok(`Node version ${process.versions.node}`);
else fail(`Node version ${process.versions.node}`, "requires >= 18 (fetch API)");

// ---- JWT_SECRET ----

const secret = process.env.JWT_SECRET || "";
if (!secret) fail("JWT_SECRET", "not set");
else if (secret.length < 16) fail("JWT_SECRET", `length ${secret.length}, need >= 16`);
else if (secret === "change_me") fail("JWT_SECRET", "still the placeholder from .env.example");
else ok("JWT_SECRET", `length ${secret.length}`);

// ---- MONGODB_URI ----

const uri = process.env.MONGODB_URI || "";
if (!uri) fail("MONGODB_URI", "not set");
else if (/prod|live|production/i.test(uri)) fail("MONGODB_URI", "looks like a prod/live URI - refuse to proceed");
else {
  ok("MONGODB_URI set", uri.replace(/\/\/.*@/, "//<redacted>@"));
  note("connecting to Mongo (3s timeout)...");
  const started = Date.now();
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 3000 });
    await mongoose.connection.db.admin().ping();
    ok(`Mongo reachable`, `${Date.now() - started}ms`);
    await mongoose.disconnect();
  } catch (err) {
    fail("Mongo reachable", err.message);
    try { await mongoose.disconnect(); } catch { /* ignore */ }
  }
}

// ---- AI configuration ----

const aiEnabled = String(process.env.AI_ENABLED || "false").toLowerCase() === "true";
const aiKey = process.env.AI_API_KEY || "";
const aiBase = process.env.AI_API_BASE_URL || "";

if (!aiEnabled) {
  ok("AI mode", "deterministic-fallback (AI_ENABLED=false)");
  console.log("         The AI panel + Converse + rule-from-NL all work in fallback mode.");
  console.log("         Set AI_ENABLED=true and provide AI_API_KEY when you want live LLM responses.");
} else {
  if (!aiKey) fail("AI_API_KEY", "AI_ENABLED=true but AI_API_KEY empty");
  else ok("AI_API_KEY", `length ${aiKey.length}`);
  if (!aiBase) fail("AI_API_BASE_URL", "empty");
  else if (!/^https?:\/\//.test(aiBase)) fail("AI_API_BASE_URL", "doesn't look like a URL");
  else {
    ok("AI_API_BASE_URL", aiBase);
    note(`HEAD ${aiBase} (3s timeout)...`);
    try {
      const controller = new AbortController();
      const to = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(aiBase, { method: "HEAD", signal: controller.signal });
      clearTimeout(to);
      if (res.status === 404) fail("AI_API_BASE_URL reachable", `HTTP 404 - wrong URL?`);
      else ok("AI_API_BASE_URL reachable", `HTTP ${res.status}`);
    } catch (err) {
      // Some providers 405 or 400 HEAD but that means we DID connect. Only
      // an abort (timeout) or connection-refused should FAIL.
      fail("AI_API_BASE_URL reachable", err.name === "AbortError" ? "timeout after 3s" : err.message);
    }
  }
}

// ---- summary ----

console.log("");
if (failed === 0) {
  console.log("  ALL OK");
  process.exit(0);
} else {
  console.log(`  ${failed} check(s) failed. Fix .env and rerun.`);
  process.exit(1);
}

// ---- helpers ----

function loadEnvFile(p) {
  const text = fs.readFileSync(p, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
