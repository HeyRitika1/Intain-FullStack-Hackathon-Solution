#!/usr/bin/env node
// Cross-platform launcher for the sized reset: sets SAMPLES_SIZE and
// SERVICER_EXTRA_BATCHES, then runs the backend reset workspace script.
// Usage: node scripts/reset-sized.mjs <samplesSize> <servicerExtraBatches>

import { spawnSync } from "node:child_process";

const size = process.argv[2] || "3000";
const extra = process.argv[3] || "3";

process.env.SAMPLES_SIZE = String(size);
process.env.SERVICER_EXTRA_BATCHES = String(extra);

console.log(`[reset-sized] SAMPLES_SIZE=${size} SERVICER_EXTRA_BATCHES=${extra}`);

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const res = spawnSync(
  npmCmd,
  ["--workspace", "backend", "run", "reset", "--", "--yes"],
  { stdio: "inherit", env: process.env }
);
process.exit(res.status ?? 1);
