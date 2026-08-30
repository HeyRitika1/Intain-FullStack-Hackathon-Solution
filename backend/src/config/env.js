// Loads process.env from the repo-root .env so both workspaces share one file.
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// backend/src/config/env.js -> ../../.. = repo root
const rootEnvPath = path.resolve(__dirname, "../../../.env");
dotenv.config({ path: rootEnvPath });

const required = (key, value) => {
  if (!value || String(value).trim() === "") {
    throw new Error(
      `[env] Missing required environment variable: ${key}. ` +
        `Copy .env.example to .env at the repo root and fill it in.`
    );
  }
  return value;
};

export const env = {
  PORT: Number(process.env.PORT || 4000),
  MONGODB_URI: required("MONGODB_URI", process.env.MONGODB_URI),
  JWT_SECRET: required("JWT_SECRET", process.env.JWT_SECRET),
  AI_ENABLED:
    process.env.AI_ENABLED !== undefined
      ? String(process.env.AI_ENABLED).trim().toLowerCase() === "true"
      : Boolean(process.env.AI_API_KEY && process.env.AI_API_KEY.trim() !== ""),
  AI_API_KEY: (process.env.AI_API_KEY || "").trim(),
  AI_API_BASE_URL: (process.env.AI_API_BASE_URL || "https://api.openai.com/v1").trim(),
  AI_MODEL: (process.env.AI_MODEL || "gpt-4o-mini").trim(),
};
