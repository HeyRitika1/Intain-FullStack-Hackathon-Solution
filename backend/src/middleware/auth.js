import { verifyToken } from "../services/authService.js";
import { HttpError } from "./error.js";

export function requireAuth(req, _res, next) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(String(header));
  if (!match) return next(new HttpError(401, "Missing bearer token"));

  const payload = verifyToken(match[1]);
  req.user = { id: payload.sub, role: payload.role, email: payload.email };
  next();
}

export function requireRole(...allowedRoles) {
  const allowed = allowedRoles.flat();
  return (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, "Authentication required"));
    if (!allowed.includes(req.user.role)) {
      return next(new HttpError(403, `Role '${req.user.role}' is not permitted`));
    }
    next();
  };
}
