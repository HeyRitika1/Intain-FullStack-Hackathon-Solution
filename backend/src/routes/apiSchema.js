// Single source of truth for the API surface. Printed at server startup so any
// registered route that isn't listed here (or vice versa) is obvious.

export const API_ROUTES = [
  // --- auth ---
  ["POST",   "/api/auth/register",                          "public"],
  ["POST",   "/api/auth/login",                             "public"],
  ["GET",    "/api/auth/me",                                "auth"],

  // --- health ---
  ["GET",    "/api/health",                                 "public"],

  // --- ingest ---
  ["POST",   "/api/ingest/upload",                          "operator, admin"],
  ["POST",   "/api/ingest/commit/:batchId",                 "operator, admin"],
  ["GET",    "/api/ingest/imports",                         "operator, admin"],
  ["GET",    "/api/ingest/imports/:batchId",                "operator, admin"],

  // --- rules ---
  ["GET",    "/api/rules",                                  "auth"],
  ["GET",    "/api/rules/:ruleId",                          "auth"],
  ["POST",   "/api/rules",                                  "admin"],
  ["PATCH",  "/api/rules/:ruleId",                          "admin"],
  ["POST",   "/api/rules/run",                              "reviewer, admin"],
  ["PATCH",  "/api/rules/:ruleId/approve",                  "admin"],
  ["PATCH",  "/api/rules/:ruleId/reject",                   "admin"],
  ["GET",    "/api/rules/:ruleId/exception-count",          "auth"],

  // --- loans ---
  ["GET",    "/api/loans",                                  "auth"],
  ["GET",    "/api/loans/:loanId",                          "auth"],
  ["PATCH",  "/api/loans/:loanId",                          "reviewer, admin"],
  ["GET",    "/api/loans/:loanId/reconciliation",           "reviewer, admin"],

  // --- exceptions ---
  ["GET",    "/api/exceptions",                             "auth"],
  ["GET",    "/api/exceptions/:exceptionId",                "auth"],
  ["PATCH",  "/api/exceptions/:exceptionId/claim",          "reviewer, admin"],
  ["POST",   "/api/exceptions/:exceptionId/comment",        "reviewer, admin"],
  ["PATCH",  "/api/exceptions/:exceptionId/resolve",        "reviewer, admin"],

  // --- ai ---
  ["POST",   "/api/ai/explain/:exceptionId",                "reviewer, admin"],
  ["POST",   "/api/ai/suggest/:exceptionId",                "reviewer, admin"],
  ["POST",   "/api/ai/compare/:loanId",                     "reviewer, admin"],
  ["POST",   "/api/ai/note",                                "reviewer, admin"],
  ["POST",   "/api/ai/classify/:exceptionId",               "reviewer, admin"],
  ["POST",   "/api/ai/summarize/batch/:batchId",            "reviewer, admin"],
  ["POST",   "/api/ai/rule",                                "admin"],
  ["POST",   "/api/ai/converse",                            "reviewer, admin, consumer"],
  ["GET",    "/api/ai/recommendations",                     "auth"],
  ["GET",    "/api/ai/recommendations/:id",                 "auth"],

  // --- verified (with /verified-loans alias) ---
  ["POST",   "/api/verified/:loanId",                       "reviewer, admin"],
  ["POST",   "/api/verified/:loanId/unverify",              "admin"],
  ["GET",    "/api/verified",                               "auth"],
  ["POST",   "/api/verified/chain-check",                   "auth"],
  ["GET",    "/api/verified/export",                        "reviewer, admin, consumer"],
  ["GET",    "/api/verified/export/bundle",                 "reviewer, admin, consumer"],
  ["GET",    "/api/verified/:loanId",                       "auth"],
  ["GET",    "/api/verified/:loanId/trust",                 "auth"],
  ["GET",    "/api/verified/:loanId/history",               "auth"],
  ["*",      "/api/verified-loans/*",                       "alias of /api/verified"],

  // --- audit ---
  ["GET",    "/api/audit/:loanId",                          "auth"],

  // --- summary ---
  ["GET",    "/api/summary",                                "auth"],
  ["GET",    "/api/summary/trust",                          "auth"],
  ["GET",    "/api/summary/operator",                       "operator, admin"],
  ["GET",    "/api/summary/reviewer",                       "reviewer, admin"],
  ["GET",    "/api/summary/consumer",                       "auth"],

  // --- converse ---
  ["POST",   "/api/converse",                               "consumer, reviewer, admin"],
  ["GET",    "/api/converse/history",                       "consumer, reviewer, admin"],

  // --- dev-log ---
  ["GET",    "/api/dev-log",                                "auth"],
  ["GET",    "/api/dev-log/stats",                          "auth"],
  ["POST",   "/api/dev-log",                                "admin"],
  ["PATCH",  "/api/dev-log/:id",                            "admin"],
  ["DELETE", "/api/dev-log/:id",                            "admin"],
];

export function printRouteTable(logger) {
  const lines = API_ROUTES.map(([m, p, roles]) =>
    `  ${m.padEnd(6)} ${p.padEnd(52)} ${roles}`
  );
  logger.info(`API surface (${API_ROUTES.length} routes):\n${lines.join("\n")}`);
}
