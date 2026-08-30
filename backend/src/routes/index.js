import express from "express";
import { dbStatus } from "../config/db.js";
import authRouter from "./auth.js";
import ingestRouter from "./ingest.js";
import rulesRouter from "./rules.js";
import loansRouter from "./loans.js";
import exceptionsRouter from "./exceptions.js";
import aiRouter from "./ai.js";
import verifiedRouter from "./verified.js";
import auditRouter from "./audit.js";
import summaryRouter from "./summary.js";
import devLogRouter from "./devLog.js";
import converseRouter from "./converse.js";

// -----------------------------------------------------------------------------
// API surface — see routes/apiSchema.js for the ground-truth route table (also
// printed at server startup). Notable aliases:
//   /api/verified-loans  →  same router as /api/verified  (Module H spelling)
// The full list of loanId path-param routes accept both real loanIds and the
// synthetic id conventions __BATCH__ / __ORPHAN__ / __MISSING__ / __QUERY__ /
// __RULES__ / __EXCEPTION__ documented on AuditEvent.
// -----------------------------------------------------------------------------

const router = express.Router();

// Health probe used by the frontend on mount + smoke scripts.
router.get("/health", (req, res) => {
  res.json({
    ok: true,
    db: dbStatus(),
    authRoutes: "mounted",
    time: new Date().toISOString(),
  });
});

router.use("/auth", authRouter);
router.use("/ingest", ingestRouter);
router.use("/rules", rulesRouter);
router.use("/loans", loansRouter);
router.use("/exceptions", exceptionsRouter);
router.use("/ai", aiRouter);
router.use("/verified", verifiedRouter);
router.use("/verified-loans", verifiedRouter);
router.use("/audit", auditRouter);
router.use("/summary", summaryRouter);
router.use("/converse", converseRouter);
router.use("/dev-log", devLogRouter);

export default router;
