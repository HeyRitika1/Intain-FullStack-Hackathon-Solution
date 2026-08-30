import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import { fileURLToPath } from "node:url";
import { connectDb } from "../config/db.js";
import { User, ValidationRule } from "../models/index.js";
import { logger } from "../utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RULES_PATH = path.resolve(__dirname, "../../../samples/validation_rules.json");

export async function seedRulesFromFile(rulesPath = RULES_PATH) {
  if (!fs.existsSync(rulesPath)) {
    throw new Error(`Rules file missing: ${rulesPath}. Run: npm run gen:samples`);
  }
  const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
  const admin = await User.findOne({ role: "admin" }).lean();
  if (!admin) throw new Error("No admin user found. Run: npm run seed:users");

  const results = { created: 0, updated: 0 };
  for (const r of rules) {
    const doc = {
      name: r.name,
      description: r.description || "",
      severity: r.severity,
      messageTemplate: r.messageTemplate,
      expression: r.expression,
      appliesTo: r.appliesTo || r.expression?.appliesTo || "loan",
      active: r.active !== false,
      origin: "seed",
      approvedBy: admin._id,
    };
    const existing = await ValidationRule.findOne({ ruleId: r.ruleId });
    if (existing) {
      Object.assign(existing, doc);
      existing.markModified("expression");
      await existing.save();
      results.updated++;
    } else {
      await ValidationRule.create({ ruleId: r.ruleId, ...doc });
      results.created++;
    }
  }
  return results;
}

async function main() {
  await connectDb();
  try {
    const { created, updated } = await seedRulesFromFile();
    logger.info(`[seed:rules] done. created=${created} updated=${updated}`);
  } finally {
    await mongoose.disconnect();
  }
}

const isDirectRun = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("/services/ruleSeeder.js");
if (isDirectRun) {
  main().catch((err) => {
    logger.error("[seed:rules] failed:", err?.stack || err?.message || err);
    process.exit(1);
  });
}
