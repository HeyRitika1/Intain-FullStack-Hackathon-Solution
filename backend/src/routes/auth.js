import express from "express";
import { z } from "zod";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { requireAuth } from "../middleware/auth.js";
import { authenticate, registerUser, toPublicUser } from "../services/authService.js";
import { User } from "../models/index.js";

const router = express.Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1).max(120),
  role: z.enum(["operator", "reviewer", "consumer", "admin"]),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function parseOrThrow(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new HttpError(400, "Invalid request body", {
      issues: result.error.issues.map((i) => ({ path: i.path, message: i.message })),
    });
  }
  return result.data;
}

// POST /api/auth/register — curl -X POST /api/auth/register -H "Content-Type: application/json" -d '{...}'
router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const body = parseOrThrow(registerSchema, req.body);
    const result = await registerUser(body);
    res.status(201).json(result);
  })
);

// POST /api/auth/login — returns { user, token } on success.
router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const body = parseOrThrow(loginSchema, req.body);
    const result = await authenticate(body);
    res.json(result);
  })
);

// GET /api/auth/me — requires Authorization: Bearer <token>.
router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id);
    if (!user) throw new HttpError(401, "User no longer exists");
    res.json({ user: toPublicUser(user) });
  })
);

export default router;
