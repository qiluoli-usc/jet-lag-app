import { verifyToken } from "./auth.js";

const AUTH_REQUIRED = String(process.env.AUTH_REQUIRED ?? "0").trim() === "1";

/**
 * Extract user info from the Authorization header (if present).
 * Sets `req.user = { userId, displayName }` when a valid Bearer token is found.
 * Does NOT throw if token is missing — use `requireAuth` for that.
 */
export function extractUser(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    req.user = null;
    return;
  }

  try {
    const token = header.slice(7).trim();
    req.user = verifyToken(token);
  } catch {
    req.user = null;
  }
}

/**
 * Enforce authentication if AUTH_REQUIRED=1.
 * Returns true if request is allowed to proceed, false if 401 was sent.
 * When AUTH_REQUIRED is off, always returns true (allows anonymous access).
 */
export function requireAuth(req, res) {
  if (!AUTH_REQUIRED) {
    return true;
  }

  if (!req.user) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Authentication required" } }));
    return false;
  }

  return true;
}
