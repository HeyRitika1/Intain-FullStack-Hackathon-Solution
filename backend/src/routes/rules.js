import express from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { AiRecommendation, Exception, ValidationRule } from "../models/index.js";
import { runValidationForLoans } from "../services/ruleEngine/index.js";
import { appendAuditEvent } from "../services/hashChainService.js";

const router = express.Router();

router.use(requireAuth);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = {};
    if (req.query.active !== undefined) q.active = req.query.active === "true";
    if (req.query.origin) q.origin = req.query.origin;
    const items = await ValidationRule.find(q).sort({ createdAt: 1 }).lean();
    res.json({ items, total: items.length });
  })
);

router.get(
  "/:ruleId",
  asyncHandler(async (req, res) => {
    const item = await ValidationRule.findOne({ ruleId: req.params.ruleId }).lean();
    if (!item) throw new HttpError(404, "Rule not found");
    res.json(item);
  })
);

const ruleBodySchema = z.object({
  ruleId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional().default(""),
  severity: z.enum(["low", "medium", "high", "blocking"]),
  messageTemplate: z.string().min(1),
  expression: z.record(z.string(), z.any()),
  appliesTo: z.enum(["loan", "servicerUpdate", "manifest"]).optional().default("loan"),
  active: z.boolean().optional().default(false),
  origin: z.enum(["seed", "ai_generated", "user"]).optional().default("user"),
});

const ruleFromAiSchema = z.object({
  aiRecommendationId: z.string().min(1),
  ruleId: z.string().min(1).optional(),
  overrides: z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    severity: z.enum(["low", "medium", "high", "blocking"]).optional(),
    messageTemplate: z.string().optional(),
  }).optional(),
});

/** @precondition adminOnly — only path that persists a rule; AI cannot self-insert. */
router.post(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    if (req.user.role !== "admin") throw new HttpError(403, "adminOnly");

    // Path A: create from an AI recommendation.
    if (req.body?.aiRecommendationId) {
      const parsed = ruleFromAiSchema.safeParse(req.body);
      if (!parsed.success) throw new HttpError(400, "Invalid body", { issues: parsed.error.issues });
      const rec = await AiRecommendation.findById(parsed.data.aiRecommendationId).lean();
      if (!rec) throw new HttpError(404, "AI recommendation not found");
      if (rec.templateName !== "rule_from_nl") throw new HttpError(400, "Recommendation is not a rule draft");
      const out = rec.output || {};
      if (out.error || !out.expression) throw new HttpError(400, "AI draft has no valid expression to persist");

      const overrides = parsed.data.overrides || {};
      const ruleId = parsed.data.ruleId || out.ruleId || `AI_${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      const existing = await ValidationRule.findOne({ ruleId });
      if (existing) throw new HttpError(409, "ruleId already exists — pick a different id");

      const doc = await ValidationRule.create({
        ruleId,
        name: overrides.name || out.name || ruleId,
        description: overrides.description || out.description || "",
        severity: overrides.severity || out.severity || "medium",
        messageTemplate: overrides.messageTemplate || out.messageTemplate || "AI-drafted rule matched",
        expression: out.expression,
        appliesTo: out.appliesTo || "loan",
        origin: "ai_generated",
        createdBy: req.user.id,
        approvedBy: null,
        active: false,
      });
      return res.status(201).json({ rule: doc, aiRecommendationId: String(rec._id) });
    }

    // Path B: raw rule fields (unchanged behavior).
    const parsed = ruleBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "Invalid rule body", { issues: parsed.error.issues });
    }
    const existing = await ValidationRule.findOne({ ruleId: parsed.data.ruleId });
    if (existing) throw new HttpError(409, "ruleId already exists");
    // New rules land inactive with approvedBy=null; admin must approve to activate.
    const doc = await ValidationRule.create({
      ...parsed.data,
      createdBy: req.user.id,
      approvedBy: null,
      active: false,
    });
    res.status(201).json({ rule: doc });
  })
);

const rulePatchSchema = ruleBodySchema.partial().omit({ ruleId: true, origin: true });

router.patch(
  "/:ruleId",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const parsed = rulePatchSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "Invalid patch body", { issues: parsed.error.issues });
    }
    const rule = await ValidationRule.findOne({ ruleId: req.params.ruleId });
    if (!rule) throw new HttpError(404, "Rule not found");
    Object.assign(rule, parsed.data);
    if (parsed.data.expression) rule.markModified("expression");
    await rule.save();
    res.json(rule);
  })
);

router.post(
  "/run",
  requireRole("admin", "reviewer"),
  asyncHandler(async (req, res) => {
    const loanIds = Array.isArray(req.body?.loanIds) && req.body.loanIds.length ? req.body.loanIds : null;
    const result = await runValidationForLoans(loanIds, {
      actor: req.user.id,
      actorRole: req.user.role,
    });
    res.json(result);
  })
);

// ---- approve / reject for AI-generated + user-drafted rules ----

router.patch(
  "/:ruleId/approve",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const rule = await ValidationRule.findOne({ ruleId: req.params.ruleId });
    if (!rule) throw new HttpError(404, "Rule not found");
    const before = rule.active;
    rule.approvedBy = req.user.id;
    rule.active = true;
    await rule.save();

    await appendAuditEvent({
      loanId: "__RULES__",
      type: "decision",
      payload: { subType: "rule_approved", ruleId: rule.ruleId, name: rule.name, wasActive: before },
      actor: req.user.id,
      actorRole: req.user.role,
    });

    // Post-approval: immediately validate every loan against the full rule set.
    // New matches show up in the reviewer queue; auto-dismiss also runs for
    // formerly-open exceptions whose rule no longer matches.
    const runResult = await runValidationForLoans(null, {
      actor: req.user.id,
      actorRole: req.user.role,
    });
    const newExceptions = runResult.byRule?.[rule.ruleId]?.created ?? 0;
    res.json({ rule, newExceptions, runResult });
  })
);

router.patch(
  "/:ruleId/reject",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const rule = await ValidationRule.findOne({ ruleId: req.params.ruleId });
    if (!rule) throw new HttpError(404, "Rule not found");
    rule.active = false;
    if (typeof req.body?.note === "string") {
      rule.description = rule.description
        ? `${rule.description}\n[rejected] ${req.body.note}`
        : `[rejected] ${req.body.note}`;
    }
    await rule.save();

    await appendAuditEvent({
      loanId: "__RULES__",
      type: "decision",
      payload: { subType: "rule_rejected", ruleId: rule.ruleId, note: req.body?.note || null },
      actor: req.user.id,
      actorRole: req.user.role,
    });

    // Deactivation always triggers a full re-run so the engine's sweep can
    // auto-dismiss any remaining open exceptions owned by this rule.
    const runResult = await runValidationForLoans(null, {
      actor: req.user.id,
      actorRole: req.user.role,
    });
    res.json({ rule, runResult });
  })
);

// Extra convenience for admin-rules UI: open-exception counts per rule.
router.get(
  "/:ruleId/exception-count",
  asyncHandler(async (req, res) => {
    const count = await Exception.countDocuments({
      ruleId: req.params.ruleId,
      status: { $in: ["open", "in_review"] },
    });
    res.json({ ruleId: req.params.ruleId, openCount: count });
  })
);

export default router;
