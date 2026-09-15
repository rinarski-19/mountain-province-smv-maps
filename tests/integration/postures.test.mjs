// Author: Rinar M. Dengwas — Mountain Province Land Value Map
// Deployment postures that need their own environment: the hard kill
// switch, and a build with no password configured at all.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { startServer, makeClient, TEST_PASSWORD } from "../helpers/server.mjs";

describe("SMV_LOCKDOWN=true", () => {
  test("refuses to unlock and refuses every write, but still serves sheets", async () => {
    const server = await startServer({ env: { SMV_LOCKDOWN: "true" } });
    try {
      const client = makeClient(server.base);

      const { body: status } = await client.json("/api/auth/unlock");
      assert.equal(status.lockedDown, true);
      assert.equal(status.unlocked, false);
      // Nothing to unlock, so the UI hides the padlock entirely.
      assert.equal(status.required, false);

      const { res: unlockRes } = await client.unlock();
      assert.equal(unlockRes.status, 403);

      // Even a correct bearer token is refused.
      const { res: writeRes } = await client.json("/api/print-settings/bauko", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TEST_PASSWORD}`,
        },
        body: JSON.stringify({ classValues: {} }),
      });
      assert.equal(writeRes.status, 403);

      const sheet = await client.fetch("/api/print/svg/portrait/bauko/abatan");
      assert.equal(sheet.status, 200);
    } finally {
      await server.stop();
    }
  });
});

describe("no SAVE_PASSWORD configured", () => {
  test("reports that unlocking is unavailable and refuses to unlock", async () => {
    const server = await startServer({ env: { SAVE_PASSWORD: "" } });
    try {
      const client = makeClient(server.base);
      const { body } = await client.json("/api/auth/unlock");
      assert.equal(body.configured, false);

      const { res } = await client.unlock("anything");
      assert.equal(res.status, 503);
    } finally {
      await server.stop();
    }
  });
});
