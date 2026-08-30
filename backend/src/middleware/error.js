import { logger } from "../utils/logger.js";

// Wraps async route handlers so thrown errors flow into the global error handler
// without try/catch boilerplate everywhere.
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Global JSON error handler. Always returns JSON, never HTML.
// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  const payload = {
    ok: false,
    error: err.publicMessage || err.message || "Internal Server Error",
  };
  if (err.details) payload.details = err.details;

  if (status >= 500) {
    logger.error(`${req.method} ${req.originalUrl} ->`, err?.stack || err?.message || err);
  } else {
    logger.warn(`${req.method} ${req.originalUrl} -> ${status} ${payload.error}`);
  }

  res.status(status).json(payload);
};

// Small helper for controllers to throw typed HTTP errors.
export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.publicMessage = message;
    if (details) this.details = details;
  }
}
