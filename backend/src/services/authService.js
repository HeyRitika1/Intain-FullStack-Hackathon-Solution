import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { User } from "../models/index.js";
import { HttpError } from "../middleware/error.js";

const TOKEN_TTL = "12h";

function toPublicUser(userDoc) {
  const u = typeof userDoc.toJSON === "function" ? userDoc.toJSON() : userDoc;
  return { id: String(u._id || u.id), email: u.email, name: u.name, role: u.role };
}

export function issueToken(user) {
  const payload = { sub: String(user._id || user.id), role: user.role, email: user.email };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: TOKEN_TTL });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, env.JWT_SECRET);
  } catch (err) {
    const message = err?.name === "TokenExpiredError" ? "Token expired" : "Invalid token";
    throw new HttpError(401, message);
  }
}

export async function registerUser({ email, password, name, role }) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = await User.findOne({ email: normalizedEmail }).lean();
  if (existing) throw new HttpError(409, "Email already registered");

  const passwordHash = await User.hashPassword(password);
  const doc = await User.create({ email: normalizedEmail, passwordHash, name, role });
  return { user: toPublicUser(doc), token: issueToken(doc) };
}

export async function authenticate({ email, password }) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const user = await User.findOne({ email: normalizedEmail });
  if (!user) throw new HttpError(401, "Invalid email or password");
  const ok = await user.verifyPassword(password);
  if (!ok) throw new HttpError(401, "Invalid email or password");
  return { user: toPublicUser(user), token: issueToken(user) };
}

export async function upsertSeedUser({ email, password, name, role }) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) return { user: toPublicUser(existing), created: false };
  const passwordHash = await User.hashPassword(password);
  const doc = await User.create({ email: normalizedEmail, passwordHash, name, role });
  return { user: toPublicUser(doc), created: true };
}

export { toPublicUser };
