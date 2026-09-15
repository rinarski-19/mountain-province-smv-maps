// Author: Rinar M. Dengwas — Mountain Province Land Value Map
// Frontend unlock endpoint.
//
//   GET    → { unlocked, required, configured }  — lets the app decide
//            on load whether to render locked or unlocked, without the
//            client ever holding the password.
//   POST   → { password } ; on match, sets the httpOnly smv_unlock
//            cookie and returns { ok: true }.
//   DELETE → clears the cookie (the "Lock" button).
//
// The password itself never round-trips back to the browser; the
// cookie carries an HMAC-signed expiry instead (see lib/server-auth.js).

import {
  UNLOCK_TTL_MS,
  allowsUnauthenticatedWrites,
  isAuthorized,
  isLockedDown,
  issueUnlockToken,
  matchesSharedPassword,
  unlockCookieHeader,
} from "../../../../lib/server-auth.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ---------------------------------------------------------------------
// Brute-force throttle.
//
// Two counters, because the obvious one is not trustworthy:
//
//   per-client  keyed off X-Forwarded-For. Cheap and precise, but the
//               header is client-supplied — behind a direct `next start`
//               (which this project supports for an LGU office box)
//               anyone can rotate it and walk straight past this.
//   global      a single instance-wide failure budget. Nothing in the
//               request can influence which bucket it lands in, so this
//               is the counter that actually bounds an attacker: at
//               MAX_GLOBAL failures/minute, guessing any non-trivial
//               password is hopeless.
//
// Only FAILURES consume budget, and a correct password clears the
// client's own bucket, so ordinary use never approaches either limit.
//
// Accepted trade-off: an attacker who saturates the global budget denies
// unlocking to everyone for up to a minute. That is self-healing, and
// strictly better than leaving an unbounded guessing channel open. Set
// SMV_LOCKDOWN=true if you want the door shut regardless.
// ---------------------------------------------------------------------
const WINDOW_MS = 60_000;
const MAX_PER_CLIENT = 10;
const MAX_GLOBAL = 60;
// Bound the map so header-rotation can't grow it without limit.
const MAX_TRACKED_CLIENTS = 5_000;

const ATTEMPTS = new Map();
let globalWindowStart = 0;
let globalFailures = 0;

function clientKey(request) {
  const fwd = request.headers.get("x-forwarded-for") || "";
  return fwd.split(",")[0].trim() || request.headers.get("x-real-ip") || "local";
}

function evictStale(now) {
  for (const [key, entry] of ATTEMPTS) {
    if (now - entry.start > WINDOW_MS) ATTEMPTS.delete(key);
  }
  // Still oversized after eviction (a flood inside one window) → drop the
  // oldest entries. Losing a bucket only costs precision; the global
  // counter is what holds the line.
  if (ATTEMPTS.size > MAX_TRACKED_CLIENTS) {
    const excess = ATTEMPTS.size - MAX_TRACKED_CLIENTS;
    let dropped = 0;
    for (const key of ATTEMPTS.keys()) {
      ATTEMPTS.delete(key);
      if (++dropped >= excess) break;
    }
  }
}

// Seconds the caller must wait, or 0 when they may try now.
function retryAfterSeconds(key) {
  const now = Date.now();
  evictStale(now);

  if (now - globalWindowStart > WINDOW_MS) {
    globalWindowStart = now;
    globalFailures = 0;
  }
  if (globalFailures >= MAX_GLOBAL) {
    return Math.max(1, Math.ceil((globalWindowStart + WINDOW_MS - now) / 1000));
  }

  const entry = ATTEMPTS.get(key);
  if (entry && now - entry.start <= WINDOW_MS && entry.count >= MAX_PER_CLIENT) {
    return Math.max(1, Math.ceil((entry.start + WINDOW_MS - now) / 1000));
  }
  return 0;
}

function recordFailure(key) {
  const now = Date.now();
  const entry = ATTEMPTS.get(key);
  if (!entry || now - entry.start > WINDOW_MS) {
    ATTEMPTS.set(key, { start: now, count: 1 });
  } else {
    entry.count += 1;
  }
  if (now - globalWindowStart > WINDOW_MS) {
    globalWindowStart = now;
    globalFailures = 0;
  }
  globalFailures += 1;
}

export async function GET(request) {
  return Response.json({
    ok: true,
    unlocked: isAuthorized(request),
    // false when the environment grants access without a password
    // (local dev with no SAVE_PASSWORD set) — the UI hides the lock
    // button entirely in that case.
    required: !allowsUnauthenticatedWrites() && !isLockedDown(),
    configured: Boolean(process.env.SAVE_PASSWORD),
    lockedDown: isLockedDown(),
  });
}

export async function POST(request) {
  if (isLockedDown()) {
    return Response.json(
      { ok: false, error: "This deployment is locked down." },
      { status: 403 }
    );
  }
  if (!process.env.SAVE_PASSWORD) {
    return Response.json(
      {
        ok: false,
        error:
          "No password is configured for this deployment. Set SAVE_PASSWORD to enable unlocking.",
      },
      { status: 503 }
    );
  }

  const key = clientKey(request);
  const wait = retryAfterSeconds(key);
  if (wait > 0) {
    return Response.json(
      {
        ok: false,
        error: `Too many failed attempts. Try again in ${wait} second${
          wait === 1 ? "" : "s"
        }.`,
      },
      { status: 429, headers: { "Retry-After": String(wait) } }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "Body is not valid JSON." },
      { status: 400 }
    );
  }

  if (!matchesSharedPassword(body?.password)) {
    recordFailure(key);
    return Response.json(
      { ok: false, error: "Wrong password." },
      { status: 401 }
    );
  }

  ATTEMPTS.delete(key);
  const token = issueUnlockToken();
  return Response.json(
    { ok: true, unlocked: true, expiresAt: Date.now() + UNLOCK_TTL_MS },
    { headers: { "Set-Cookie": unlockCookieHeader(token) } }
  );
}

export async function DELETE() {
  return Response.json(
    { ok: true, unlocked: false },
    { headers: { "Set-Cookie": unlockCookieHeader(null) } }
  );
}
