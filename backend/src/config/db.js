import mongoose from "mongoose";
import { env } from "./env.js";
import { logger } from "../utils/logger.js";

let connected = false;

export const connectDb = async () => {
  mongoose.set("strictQuery", true);
  try {
    await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 8000,
    });
    connected = true;
    logger.info("MongoDB connected");
  } catch (err) {
    connected = false;
    logger.error("MongoDB connection failed:", err?.message || err);
    // Do not exit — keep server up so /api/health can report the disconnect.
  }

  mongoose.connection.on("disconnected", () => {
    connected = false;
    logger.warn("MongoDB disconnected");
  });
  mongoose.connection.on("reconnected", () => {
    connected = true;
    logger.info("MongoDB reconnected");
  });
};

export const dbStatus = () => (mongoose.connection.readyState === 1 && connected ? "connected" : "disconnected");
