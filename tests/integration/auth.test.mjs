// Author: Rinar M. Dengwas — Mountain Province Land Value Map
// Drives the real /api/auth/unlock route and the write guards behind it.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, makeClient, TEST_PASSWORD } from "../helpers/server.mjs";

let server;
let client;
before(async () => {
  server = await startServer();
  client = makeClient(server.base);
});
after(async () => {
  await server?.stop();
});

describe("unlock lifecycle", () => {
  test("starts locked, with a password required and configured", async () => {
    const { body } = await client.json("/api/auth/unlock");
    assert.deepEqual(
      { unlocked: body.unlocked, required: body.required, configured: body.configured },
      { unlocked: false, required: true, configured: true }
    );
  });

  test("a wrong password is refused and sets no cookie", async () => {
    const { res, body } = await client.unlock("definitely-wrong");
    assert.equal(res.status, 401);
    assert.equal(body.ok, false);
    assert.equal(client.cookie, "");
  });

  test("the correct password sets an httpOnly, Lax-scoped cookie", async () => {
    const { res } = await client.unlock();
    assert.equal(res.status, 200);
    const setCookie = res.headers.get("set-cookie");
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    assert.match(setCookie, /Path=\//);
    // The shared secret must never be the cookie value.
    assert.ok(!setCookie.includes(TEST_PASSWORD));
  });

  test("the cookie is then accepted as proof of unlock", async () => {
    const { body } = await client.json("/api/auth/unlock");
    assert.equal(body.unlocked, true);
  });

  test("DELETE re-locks the session", async () => {
    const res = await client.fetch("/api/auth/unlock", { method: "DELETE" });
    assert.equal(res.status, 200);
    const { body } = await client.json("/api/auth/unlock");
    assert.equal(body.unlocked, false);
  });

  test("a forged cookie does not unlock", async () => {
    const { body } = await client.json("/api/auth/unlock", {
      headers: { Cookie: `smv_unlock=${Date.now() + 999999}.forgedsignature` },
    });
    assert.equal(body.unlocked, false);
  });

  test("a malformed JSON body is a 400, not a 500", async () => {
    const { res } = await client.json("/api/auth/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    assert.equal(res.status, 400);
  });
});

describe("write guards", () => {
  const WRITE_ROUTES = [
    "/api/zones/save?slug=bauko",
    "/api/views/save?slug=bauko",
    "/api/landmarks/save?slug=bauko",
    "/api/roads/save?slug=bauko",
    "/api/print-settings/bauko",
  ];

  test("every write route refuses an unauthenticated POST with 401", async () => {
    const anon = makeClient(server.base);
    for (const route of WRITE_ROUTES) {
      const { res } = await anon.json(route, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Deliberately invalid bodies: auth must be decided before the
        // payload is even looked at, so nothing can be written.
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 401, `${route} returned ${res.status}`);
    }
  });

  test("a bearer header is still accepted (pre-cookie clients keep working)", async () => {
    const anon = makeClient(server.base);
    const { res } = await anon.json("/api/zones/save?slug=__no_such_slug__", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TEST_PASSWORD}`,
      },
      body: JSON.stringify({ type: "FeatureCollection", features: [] }),
    });
    // 400 (unknown slug) proves auth passed without writing anything.
    assert.equal(res.status, 400);
  });

  test("GET routes stay public: print sheets need no credential", async () => {
    const anon = makeClient(server.base);
    const res = await anon.fetch("/api/print/svg/portrait/bauko/abatan");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /image\/svg\+xml/);
  });
});

describe("views/save payload validation", () => {
  test("a bare {} is refused so it cannot truncate the saved-views file", async () => {
    // Regression: this exact request wiped bauko_saved_views.json during
    // manual testing. Clearing views must be stated explicitly.
    const c = makeClient(server.base);
    await c.unlock();
    const { res, body } = await c.json("/api/views/save?slug=bauko", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    assert.match(body.error, /at least one key/);
  });

  test("entries that are not {lat,lng,zoom} are refused", async () => {
    const c = makeClient(server.base);
    await c.unlock();
    const { res } = await c.json("/api/views/save?slug=bauko", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ barangays: { abatan: { lat: "x" } }, stretches: {} }),
    });
    assert.equal(res.status, 400);
  });
});
