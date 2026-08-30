import express from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { DevLogEntry } from "../models/index.js";
import { parsePagination, paginationMeta, escapeRegex } from "../services/queryHelpers.js";

const router = express.Router();
router.use(requireAuth);

const entrySchema = z.object({
  module: z.string().min(1).max(80),
  date: z.union([z.string(), z.date()]).optional(),
  tool: z.string().min(1).max(40),
  prompt: z.string().min(1),
  outcome: z.enum(["accepted", "edited", "rejected", "caught_bad_ai"]),
  notes: z.string().max(4000).default(""),
  aiAuthoredPct: z.number().min(0).max(100).nullable().optional(),
});

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 25 });
    const match = {};
    if (req.query.module) match.module = req.query.module;
    if (req.query.outcome) match.outcome = { $in: String(req.query.outcome).split(",") };
    if (req.query.tool) match.tool = req.query.tool;
    if (req.query.q) {
      const rx = new RegExp(escapeRegex(String(req.query.q)), "i");
      match.$or = [{ prompt: rx }, { notes: rx }];
    }

    const [items, total, byOutcome, byModule] = await Promise.all([
      DevLogEntry.find(match)
        .sort({ date: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .populate("createdBy", "email name")
        .lean(),
      DevLogEntry.countDocuments(match),
      DevLogEntry.aggregate([{ $group: { _id: "$outcome", n: { $sum: 1 } } }]),
      DevLogEntry.aggregate([{ $group: { _id: "$module", n: { $sum: 1 } } }]),
    ]);
    res.json({
      items,
      ...paginationMeta({ total, page, limit }),
      counts: {
        byOutcome: Object.fromEntries(byOutcome.map((r) => [r._id, r.n])),
        byModule: Object.fromEntries(byModule.map((r) => [r._id, r.n])),
      },
    });
  })
);

router.get(
  "/stats",
  asyncHandler(async (req, res) => {
    const [total, byOutcome, byModule, avgOverall] = await Promise.all([
      DevLogEntry.countDocuments(),
      DevLogEntry.aggregate([{ $group: { _id: "$outcome", n: { $sum: 1 } } }]),
      DevLogEntry.aggregate([
        { $group: { _id: "$module", count: { $sum: 1 }, avgAiAuthoredPct: { $avg: "$aiAuthoredPct" } } },
        { $sort: { _id: 1 } },
      ]),
      DevLogEntry.aggregate([{ $group: { _id: null, avg: { $avg: "$aiAuthoredPct" } } }]),
    ]);
    const outcomeMap = Object.fromEntries(byOutcome.map((r) => [r._id, r.n]));
    res.json({
      totalEntries: total,
      avgAiAuthoredPct: avgOverall[0]?.avg ? Math.round(avgOverall[0].avg) : null,
      byModule: byModule.map((m) => ({
        module: m._id,
        count: m.count,
        avgAiAuthoredPct: m.avgAiAuthoredPct != null ? Math.round(m.avgAiAuthoredPct) : null,
      })),
      byOutcome: outcomeMap,
      caughtBadAiCount: outcomeMap.caught_bad_ai || 0,
    });
  })
);

router.post(
  "/",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const parsed = entrySchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Invalid body", { issues: parsed.error.issues });
    const doc = await DevLogEntry.create({
      ...parsed.data,
      date: parsed.data.date ? new Date(parsed.data.date) : new Date(),
      createdBy: req.user.id,
    });
    res.status(201).json({ entry: doc });
  })
);

router.patch(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(400, "Invalid id");
    const parsed = entrySchema.partial().safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, "Invalid body", { issues: parsed.error.issues });
    const patch = { ...parsed.data };
    if (patch.date) patch.date = new Date(patch.date);
    const doc = await DevLogEntry.findByIdAndUpdate(req.params.id, patch, { new: true }).lean();
    if (!doc) throw new HttpError(404, "Not found");
    res.json({ entry: doc });
  })
);

router.delete(
  "/:id",
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(400, "Invalid id");
    const doc = await DevLogEntry.findByIdAndDelete(req.params.id).lean();
    if (!doc) throw new HttpError(404, "Not found");
    res.json({ ok: true });
  })
);

export default router;
