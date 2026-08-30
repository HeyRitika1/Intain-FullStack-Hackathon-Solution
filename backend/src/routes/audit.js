import express from "express";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { requireAuth } from "../middleware/auth.js";
import { AuditEvent, User } from "../models/index.js";
import { verifyChain } from "../services/hashChainService.js";

const router = express.Router();
router.use(requireAuth);

router.get(
  "/:loanId",
  asyncHandler(async (req, res) => {
    const loanId = req.params.loanId;
    const events = await AuditEvent.find({ loanId })
      .sort({ timestamp: 1, _id: 1 })
      .lean();

    const actorIds = [...new Set(events.map((e) => e.actor).filter(Boolean).map(String))];
    const users = actorIds.length ? await User.find({ _id: { $in: actorIds } }).select("email name role").lean() : [];
    const uMap = new Map(users.map((u) => [String(u._id), u]));
    const items = events.map((e) => ({ ...e, actorUser: e.actor ? uMap.get(String(e.actor)) || null : null }));

    const chain = await verifyChain(loanId);
    res.json({ items, ...chain });
  })
);

export default router;
