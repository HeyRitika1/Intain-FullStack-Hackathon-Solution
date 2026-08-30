import mongoose from "mongoose";
import { env } from "../config/env.js";
import { connectDb } from "../config/db.js";
import { upsertSeedUser } from "../services/authService.js";
import { logger } from "../utils/logger.js";

const SEED_USERS = [
  { email: "operator@intain.test", password: "Operator@123", name: "Ollie Operator", role: "operator" },
  { email: "reviewer@intain.test", password: "Reviewer@123", name: "Rhea Reviewer", role: "reviewer" },
  { email: "consumer@intain.test", password: "Consumer@123", name: "Chris Consumer", role: "consumer" },
  { email: "admin@intain.test", password: "Admin@1234", name: "Ada Admin", role: "admin" },
];

export async function seedUsers() {
  const results = [];
  for (const seed of SEED_USERS) {
    const { user, created } = await upsertSeedUser(seed);
    results.push({ email: user.email, role: user.role, created });
    if (created) logger.info(`[seed:users] CREATED ${user.email} (${user.role})`);
    else logger.info(`[seed:users] EXISTS  ${user.email} (${user.role})`);
  }
  return results;
}

async function main() {
  logger.info(`[seed:users] using ${env.MONGODB_URI.replace(/\/\/.*@/, "//<redacted>@")}`);
  await connectDb();
  try {
    const results = await seedUsers();
    const created = results.filter((r) => r.created).length;
    logger.info(`[seed:users] done. created=${created} existed=${results.length - created}`);
  } finally {
    await mongoose.disconnect();
  }
}

const isDirectRun = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("/seed/seedUsers.js");
if (isDirectRun) {
  main().catch((err) => {
    logger.error("[seed:users] failed:", err?.stack || err?.message || err);
    process.exit(1);
  });
}
