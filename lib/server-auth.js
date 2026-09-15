// Author: Rinar M. Dengwas — Mountain Province Land Value Map
// Shared server-side auth for every write route and for the frontend
// unlock.
//
// One secret, SAVE_PASSWORD, gates everything. Two ways to present it:
//
//   1. `Authorization: Bearer <SAVE_PASSWORD>` — what the zone editor
//      has always sent, kept working so nothing that already saves
//      breaks.
//   2. The `smv_unlock` cookie — set by POST /api/auth/unlock once the
//      user types the password into the frontend. httpOnly, so page
//      scripts (and any XSS) can't read the token back out, and it
//      carries an HMAC of its own expiry rather than the password
//      itself, so a stolen cookie never reveals the shared secret.
//
// Deliberate change from the previous behaviour: a read-only build
// (NEXT_PUBLIC_READ_ONLY=true) no longer hard-blocks writes. That flag
// now only sets the *default* frontend posture — locked — and an
// authorized user can unlock it. Set SMV_LOCKDOWN=true for the old
// "refuse every write no matter what" behaviour.

import crypto from "node:crypto";

export const UNLOCK_COOKIE = "smv_unlock";

// 12 hours. Long enough for an assessor to work a full day without
// retyping, short enough that a shared office machine re-locks itself.
export const UNLOCK_TTL_MS = 12 * 60 * 60 * 1000;

function sharedSecret() {
  return process.env.SAVE_PASSWORD || "";
}

export function isLockedDown() {
  return process.env.SMV_LOCKDOWN === "true";
}

// No password configured at all → localhost keeps working with zero
// friction (that's how the editor has always behaved in dev), while a
// deployed build refuses writes rather than silently opening up.
export function allowsUnauthenticatedWrites() {
  return !sharedSecret() && process.env.NODE_ENV === "development";
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a), "utf8");
  const bufB = Buffer.from(String(b), "utf8");
  // timingSafeEqual throws on length mismatch, so compare a fixed-size
  // digest of each side instead of the raw bytes.
  const digestA = crypto.createHash("sha256").update(bufA).digest();
  const digestB = crypto.createHash("sha256").update(bufB).digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

export function matchesSharedPassword(candidate) {
  const expected = sharedSecret();
  if (!expected || typeof candidate !== "string" || !candidate) return false;
  return safeEqual(candidate, expected);
}

function sign(payload, key) {
  return crypto.createHmac("sha256", key).update(payload).digest("base64url");
}

export function issueUnlockToken(ttlMs = UNLOCK_TTL_MS) {
  const key = sharedSecret();
  if (!key) return null;
  const exp = String(Date.now() + ttlMs);
  return `${exp}.${sign(exp, key)}`;
}

export function verifyUnlockToken(token) {
  const key = sharedSecret();
  if (!key || typeof token !== "string") return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const exp = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d+$/.test(exp) || !sig) return false;
  if (!safeEqual(sig, sign(exp, key))) return false;
  return Number(exp) > Date.now();
}

// Parse the raw Cookie header rather than reaching for NextRequest's
// `.cookies`, so this works on the plain `Request` the route handlers
// already receive.
function readCookie(request, name) {
  const header = request.headers?.get?.("cookie") || "";
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return part.slice(eq + 1).trim();
    }
  }
  return null;
}

export function isAuthorized(request) {
  if (isLockedDown()) return false;
  if (allowsUnauthenticatedWrites()) return true;

  const header = request.headers?.get?.("authorization") || "";
  const bearer = header.match(/^Bearer\s+(.+)$/i);
  if (bearer && matchesSharedPassword(bearer[1])) return true;

  return verifyUnlockToken(readCookie(request, UNLOCK_COOKIE));
}

// Returns a Response to send back when the request may NOT write, or
// null when it may. Every write route starts with this.
export function writeGuard(request) {
  if (isLockedDown()) {
    return Response.json(
      { ok: false, error: "This deployment is locked down (SMV_LOCKDOWN=true)." },
      { status: 403 }
    );
  }
  if (allowsUnauthenticatedWrites()) return null;
  if (!sharedSecret()) {
    return Response.json(
      {
        ok: false,
        error:
          "Editing is not configured on this deployment. Set SAVE_PASSWORD to enable it.",
      },
      { status: 503 }
    );
  }
  if (isAuthorized(request)) return null;
  return Response.json(
    { ok: false, error: "Locked — unlock with the team password to save." },
    { status: 401 }
  );
}

export function unlockCookieHeader(token, { maxAgeSeconds } = {}) {
  const attrs = [
    `${UNLOCK_COOKIE}=${token ?? ""}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${token ? Math.floor((maxAgeSeconds ?? UNLOCK_TTL_MS / 1000)) : 0}`,
  ];
  if (process.env.NODE_ENV === "production") attrs.push("Secure");
  return attrs.join("; ");
}
