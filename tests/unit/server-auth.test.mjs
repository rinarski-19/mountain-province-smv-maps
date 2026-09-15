// Author: Rinar M. Dengwas — Mountain Province Land Value Map
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mod } from "../helpers/paths.mjs";

// server-auth reads process.env at call time, so each test can set the
// posture it needs without re-importing the module.
const auth = await mod("lib/server-auth.js");
const {
  UNLOCK_COOKIE,
  UNLOCK_TTL_MS,
  allowsUnauthenticatedWrites,
  isAuthorized,
  isLockedDown,
  issueUnlockToken,
  matchesSharedPassword,
  unlockCookieHeader,
  verifyUnlockToken,
  writeGuard,
} = auth;

const ORIGINAL = {
  SAVE_PASSWORD: process.env.SAVE_PASSWORD,
  SMV_LOCKDOWN: process.env.SMV_LOCKDOWN,
  NODE_ENV: process.env.NODE_ENV,
};

function setEnv({ password, lockdown, nodeEnv }) {
  if (password === undefined) delete process.env.SAVE_PASSWORD;
  else process.env.SAVE_PASSWORD = password;
  if (lockdown === undefined) delete process.env.SMV_LOCKDOWN;
  else process.env.SMV_LOCKDOWN = lockdown;
  if (nodeEnv !== undefined) process.env.NODE_ENV = nodeEnv;
}

afterEach(() => {
  for (const [k, v] of Object.entries(ORIGINAL)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function requestWith({ authorization, cookie } = {}) {
  const headers = new Headers();
  if (authorization) headers.set("authorization", authorization);
  if (cookie) headers.set("cookie", cookie);
  return { headers };
}

describe("matchesSharedPassword", () => {
  beforeEach(() => setEnv({ password: "correct horse", nodeEnv: "production" }));

  test("accepts only the exact password", () => {
    assert.equal(matchesSharedPassword("correct horse"), true);
    assert.equal(matchesSharedPassword("correct hors"), false);
    assert.equal(matchesSharedPassword("correct horse "), false);
    assert.equal(matchesSharedPassword("CORRECT HORSE"), false);
  });

  test("rejects empty, non-string and absurdly long candidates without throwing", () => {
    // The comparison hashes both sides first, so a length mismatch must
    // not blow up the way a raw timingSafeEqual would.
    for (const bad of ["", null, undefined, 42, {}, "x".repeat(100_000)]) {
      assert.equal(matchesSharedPassword(bad), false);
    }
  });

  test("never matches when no password is configured", () => {
    setEnv({ password: undefined, nodeEnv: "production" });
    assert.equal(matchesSharedPassword(""), false);
    assert.equal(matchesSharedPassword("anything"), false);
  });
});

describe("unlock tokens", () => {
  beforeEach(() => setEnv({ password: "s3cret", nodeEnv: "production" }));

  test("a freshly issued token verifies", () => {
    assert.equal(verifyUnlockToken(issueUnlockToken()), true);
  });

  test("the token does not contain the password", () => {
    assert.ok(!issueUnlockToken().includes("s3cret"));
  });

  test("an expired token is rejected", () => {
    assert.equal(verifyUnlockToken(issueUnlockToken(-1000)), false);
  });

  test("a tampered expiry is rejected (signature covers it)", () => {
    const token = issueUnlockToken();
    const [, sig] = token.split(".");
    const forged = `${Date.now() + UNLOCK_TTL_MS * 10}.${sig}`;
    assert.equal(verifyUnlockToken(forged), false);
  });

  test("garbage and structurally invalid tokens are rejected", () => {
    for (const bad of ["", ".", "abc", "abc.def", ".sig", "123.", null, undefined, 42]) {
      assert.equal(verifyUnlockToken(bad), false, `accepted ${JSON.stringify(bad)}`);
    }
  });

  test("a token signed with a different password stops verifying", () => {
    const token = issueUnlockToken();
    setEnv({ password: "different", nodeEnv: "production" });
    assert.equal(verifyUnlockToken(token), false);
  });

  test("no token can be issued or verified without a configured password", () => {
    setEnv({ password: undefined, nodeEnv: "production" });
    assert.equal(issueUnlockToken(), null);
    assert.equal(verifyUnlockToken("1.2"), false);
  });
});

describe("unlockCookieHeader", () => {
  test("is httpOnly, scoped to the site root and SameSite=Lax", () => {
    const header = unlockCookieHeader("tok");
    assert.match(header, new RegExp(`^${UNLOCK_COOKIE}=tok`));
    assert.match(header, /HttpOnly/);
    assert.match(header, /Path=\//);
    assert.match(header, /SameSite=Lax/);
  });

  test("Secure is set only in production", () => {
    setEnv({ password: "x", nodeEnv: "production" });
    assert.match(unlockCookieHeader("tok"), /Secure/);
    setEnv({ password: "x", nodeEnv: "development" });
    assert.doesNotMatch(unlockCookieHeader("tok"), /Secure/);
  });

  test("clearing expires the cookie immediately", () => {
    assert.match(unlockCookieHeader(null), /Max-Age=0/);
  });
});

describe("isAuthorized", () => {
  beforeEach(() => setEnv({ password: "s3cret", nodeEnv: "production" }));

  test("accepts a bearer header carrying the shared password", () => {
    assert.equal(isAuthorized(requestWith({ authorization: "Bearer s3cret" })), true);
    assert.equal(isAuthorized(requestWith({ authorization: "bearer s3cret" })), true);
  });

  test("rejects a wrong or malformed bearer header", () => {
    assert.equal(isAuthorized(requestWith({ authorization: "Bearer nope" })), false);
    assert.equal(isAuthorized(requestWith({ authorization: "Basic s3cret" })), false);
    assert.equal(isAuthorized(requestWith({ authorization: "s3cret" })), false);
  });

  test("accepts a valid unlock cookie, including alongside other cookies", () => {
    const token = issueUnlockToken();
    assert.equal(isAuthorized(requestWith({ cookie: `${UNLOCK_COOKIE}=${token}` })), true);
    assert.equal(
      isAuthorized(requestWith({ cookie: `a=1; ${UNLOCK_COOKIE}=${token}; b=2` })),
      true
    );
  });

  test("rejects a forged cookie", () => {
    assert.equal(
      isAuthorized(requestWith({ cookie: `${UNLOCK_COOKIE}=999999999999.deadbeef` })),
      false
    );
  });

  test("rejects an unauthenticated request", () => {
    assert.equal(isAuthorized(requestWith()), false);
  });

  test("lockdown overrides even a correct bearer token", () => {
    setEnv({ password: "s3cret", lockdown: "true", nodeEnv: "production" });
    assert.equal(isLockedDown(), true);
    assert.equal(isAuthorized(requestWith({ authorization: "Bearer s3cret" })), false);
  });
});

describe("writeGuard", () => {
  test("allows unauthenticated writes in dev when no password is set", () => {
    setEnv({ password: undefined, nodeEnv: "development" });
    assert.equal(allowsUnauthenticatedWrites(), true);
    assert.equal(writeGuard(requestWith()), null);
  });

  test("refuses with 503 in production when no password is configured", async () => {
    setEnv({ password: undefined, nodeEnv: "production" });
    assert.equal(allowsUnauthenticatedWrites(), false);
    const res = writeGuard(requestWith());
    assert.equal(res.status, 503);
  });

  test("refuses with 401 when a password is set but not presented", () => {
    setEnv({ password: "s3cret", nodeEnv: "production" });
    assert.equal(writeGuard(requestWith()).status, 401);
  });

  test("allows a correctly authenticated write", () => {
    setEnv({ password: "s3cret", nodeEnv: "production" });
    assert.equal(writeGuard(requestWith({ authorization: "Bearer s3cret" })), null);
  });

  test("refuses with 403 under lockdown, even in dev with no password", () => {
    setEnv({ password: undefined, lockdown: "true", nodeEnv: "development" });
    assert.equal(writeGuard(requestWith()).status, 403);
  });
});
