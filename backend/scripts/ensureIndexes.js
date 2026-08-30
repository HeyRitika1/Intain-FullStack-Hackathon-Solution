import mongoose from "mongoose";
import { connectDb } from "../src/config/db.js";
import * as models from "../src/models/index.js";
import { logger } from "../src/utils/logger.js";

async function main() {
  await connectDb();
  try {
    const entries = Object.entries(models).filter(([_, v]) => v && typeof v.syncIndexes === "function");
    for (const [name, Model] of entries) {
      const result = await Model.syncIndexes();
      logger.info(`[db:indexes] ${name} -> ${result.length ? result.join(",") : "up-to-date"}`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  logger.error("[db:indexes] failed:", err?.stack || err?.message || err);
  process.exit(1);
});
