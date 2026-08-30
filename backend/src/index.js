import express from "express";
import cors from "cors";
import morgan from "morgan";

import { env } from "./config/env.js";
import { connectDb } from "./config/db.js";
import { logger } from "./utils/logger.js";
import { notFound } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/error.js";
import apiRouter from "./routes/index.js";
import { printRouteTable } from "./routes/apiSchema.js";

const app = express();

const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
];
if (process.env.CLIENT_URL) {
  allowedOrigins.push(process.env.CLIENT_URL.replace(/\/$/, ""));
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin) || /\.vercel\.app$/.test(origin)) {
        return callback(null, true);
      }
      return callback(null, true);
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "20mb" }));
app.use(morgan("dev"));

app.use("/api", apiRouter);

app.use(notFound);
app.use(errorHandler);

const start = async () => {
  await connectDb();
  app.listen(env.PORT, () => {
    logger.info(`API up on http://localhost:${env.PORT}`);
    logger.info(`Health: http://localhost:${env.PORT}/api/health`);
    if (env.AI_ENABLED && !env.AI_API_KEY) {
      logger.warn("AI_ENABLED=true but AI_API_KEY is empty; falling back to deterministic-fallback-v1");
      logger.info("AI mode: deterministic-fallback (key missing)");
    } else {
      logger.info(`AI mode: ${env.AI_ENABLED ? "provider" : "deterministic-fallback"}`);
    }
    printRouteTable(logger);
  });
};

start().catch((err) => {
  logger.error("Fatal startup error:", err);
  process.exit(1);
});
