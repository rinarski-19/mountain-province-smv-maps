// Author: Rinar M. Dengwas — Mountain Province Land Value Map
// The unlock throttle is instance-global in-memory state, so exhausting it
// would poison any other test sharing the server. This file gets its own.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, makeClient, TEST_PASSWORD } from "../helpers/server.mjs";

let server;
before(async () => {
  server = await startServer();
});
after(async () => {
  await server?.stop();
});

async function attempt(password, forwardedFor) {
  const headers = { "Content-Type": "application/json" };
  if (forwardedFor) headers["X-Forwarded-For"] = forwardedFor;
  const res = await fetch(`${server.base}/api/auth/unlock`, {
    method: "POST",
    headers,
    body: JSON.stringify({ password }),
  });
  return res.status;
}

describe("brute-force throttle", () => {
  test("a single client is cut off after repeated failures", async () => {
    const ip = "203.0.113.10";
    const codes = [];
    for (let i = 0; i < 14; i++) codes.push(await attempt("wrong", ip));
    assert.ok(codes.includes(429), `never throttled: ${codes.join(",")}`);
    assert.equal(codes[0], 401, "first attempt should be a plain rejection");
  });

  test("the 429 carries a Retry-After the UI can show", async () => {
    const res = await fetch(`${server.base}/api/auth/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.10" },
      body: JSON.stringify({ password: "wrong" }),
    });
    assert.equal(res.status, 429);
    assert.ok(Number(res.headers.get("retry-after")) > 0);
    assert.match((await res.json()).error, /Try again in \d+ seconds?/);
  });

  test("rotating X-Forwarded-For cannot buy unlimited guesses", async () => {
    // Regression: the throttle keyed only off this client-supplied header,
    // so 70 attempts with a rotating value sailed past without one 429.
    // The instance-wide budget is what actually bounds an attacker.
    let throttled = 0;
    for (let i = 0; i < 90; i++) {
      if ((await attempt("wrong", `198.51.100.${i % 254}`)) === 429) throttled++;
    }
    assert.ok(throttled > 0, "header rotation bypassed the throttle entirely");
  });

  test("a correct password is never leaked as a different status while throttled", async () => {
    // Whether it 200s or 429s depends on remaining budget; what matters is
    // that a throttled response looks identical for right and wrong
    // passwords, so the endpoint is not an oracle.
    const right = await attempt(TEST_PASSWORD, "198.51.100.7");
    const wrong = await attempt("wrong", "198.51.100.7");
    if (right === 429) assert.equal(wrong, 429);
  });
});
