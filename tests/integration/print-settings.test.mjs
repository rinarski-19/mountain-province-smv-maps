// Author: Rinar M. Dengwas — Mountain Province Land Value Map
// Publish/read cycle for the print overrides, plus the coverage list the
// panel builds its barangay menu from.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, makeClient } from "../helpers/server.mjs";
import { guardFiles } from "../helpers/data-guard.mjs";

// sadanga is the smallest LGU, so its sheets render fastest.
const SLUG = "sadanga";
const SETTINGS = `${SLUG}_print_settings.json`;

let server;
let client;
before(async () => {
  server = await startServer();
  client = makeClient(server.base);
  await client.unlock();
});
after(async () => {
  await server?.stop();
});

const publish = (payload) =>
  client.json(`/api/print-settings/${SLUG}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

describe("reading print settings", () => {
  test("GET is public and reports empty overrides when nothing is published", async () => {
    const anon = makeClient(server.base);
    const { res, body } = await anon.json(`/api/print-settings/${SLUG}`);
    assert.equal(res.status, 200);
    assert.deepEqual(body.classValues, {});
    assert.deepEqual(body.labels, {});
  });

  test("an unknown slug is a 400", async () => {
    const { res } = await client.json("/api/print-settings/atlantis");
    assert.equal(res.status, 400);
  });

  test("every scheduled barangay is printable, sitios via a parent outline", async () => {
    // Was: these three were excluded because they have no PSA polygon,
    // which meant a raw 500 if anyone reached them. Now:
    //   - besao/padangaan was only a spelling gap (PSA writes "Padangan")
    //     and has its own boundary
    //   - barlig's two sitios genuinely have none — PSA maps Lingoy and
    //     Lunas as single barangays — so they borrow the parent outline
    //     and the menu says so via mappedVia
    const { body: barlig } = await client.json("/api/print-settings/barlig");
    const byslug = Object.fromEntries(
      barlig.printableBarangays.map((b) => [b.slug, b])
    );
    assert.ok(byslug["lingoy-lower"], "lingoy-lower should be printable");
    assert.ok(byslug["lunas-mog-ao"], "lunas-mog-ao should be printable");
    assert.equal(byslug["lingoy-lower"].mappedVia, "Lingoy (Upper)");
    assert.equal(byslug["lunas-mog-ao"].mappedVia, "Lunas");
    // A barangay with its own polygon must NOT claim to borrow one.
    assert.equal(byslug["gawana"].mappedVia, null);

    const { body: besao } = await client.json("/api/print-settings/besao");
    const padangaan = besao.printableBarangays.find((b) => b.slug === "padangaan");
    assert.ok(padangaan, "padangaan should be printable");
    assert.equal(padangaan.mappedVia, null, "padangaan has its own boundary");

    // Every barangay offered must actually render, sitios included.
    const anon = makeClient(server.base);
    for (const slug of ["lingoy-lower", "lunas-mog-ao", "gawana"]) {
      const res = await anon.fetch(`/api/print/svg/portrait/barlig/${slug}`);
      assert.equal(res.status, 200, `barlig/${slug} returned ${res.status}`);
    }
    const res = await anon.fetch("/api/print/svg/portrait/besao/padangaan");
    assert.equal(res.status, 200, `besao/padangaan returned ${res.status}`);
  });
});

describe("publishing", () => {
  test("a valid publish lands on disk and shows up on the sheet", async () => {
    await guardFiles([SETTINGS], async () => {
      const { res, body } = await publish({
        classValues: { "C-1": 4321 },
        labels: { title: "INTEGRATION TITLE" },
      });
      assert.equal(res.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.overrides, 2);

      const { body: read } = await client.json(`/api/print-settings/${SLUG}`);
      assert.deepEqual(read.classValues, { "C-1": 4321 });
      assert.equal(read.labels.title, "INTEGRATION TITLE");

      const svg = await (
        await client.fetch(`/api/print/svg/portrait/${SLUG}`)
      ).text();
      assert.ok(svg.includes("INTEGRATION TITLE"));
      assert.ok(svg.includes("₱4,321"));
    });
  });

  test("invalid values are reported as rejected instead of silently dropped", async () => {
    await guardFiles([SETTINGS], async () => {
      const { body } = await publish({
        classValues: { "C-1": -99, "C-2": 999999999999, "C-3": 500 },
        force: true,
      });
      assert.equal(body.ok, true);
      assert.equal(body.requested, 3);
      assert.equal(body.overrides, 1);
      assert.equal(body.rejected.length, 2);
      assert.ok(body.rejected.join(" ").includes("C-1"));
      assert.ok(body.rejected.join(" ").includes("C-2"));
    });
  });

  test("an over-long caption is clamped before it reaches the page", async () => {
    await guardFiles([SETTINGS], async () => {
      await publish({ labels: { title: "Z".repeat(400) }, force: true });
      const { body } = await client.json(`/api/print-settings/${SLUG}`);
      assert.equal(body.labels.title.length, 60);
    });
  });

  test("a stale publish is refused with 409 rather than overwriting", async () => {
    // Regression: two editors, second publish wins, first one's changes
    // gone with no warning.
    await guardFiles([SETTINGS], async () => {
      const { body: first } = await publish({
        classValues: { "C-1": 111 },
        baseUpdatedAt: null,
      });
      assert.equal(first.ok, true);

      const { res, body } = await publish({
        classValues: { "C-2": 222 },
        baseUpdatedAt: null, // what a second panel loaded before `first`
      });
      assert.equal(res.status, 409);
      assert.equal(body.conflict, true);
      // The caller is handed the state it has to rebase onto.
      assert.deepEqual(body.current.classValues, { "C-1": 111 });

      // Republishing against the current version succeeds.
      const { body: merged } = await publish({
        classValues: { "C-1": 111, "C-2": 222 },
        baseUpdatedAt: body.current.updatedAt,
      });
      assert.equal(merged.ok, true);
      assert.equal(merged.overrides, 2);
    });
  });

  test("force:true overwrites deliberately, which is how clear-all works", async () => {
    await guardFiles([SETTINGS], async () => {
      await publish({ classValues: { "C-1": 1 }, baseUpdatedAt: null });
      const { res, body } = await publish({
        classValues: {},
        labels: {},
        force: true,
      });
      assert.equal(res.status, 200);
      assert.equal(body.overrides, 0);
    });
  });

  test("a malformed body is a 400", async () => {
    const { res } = await client.json(`/api/print-settings/${SLUG}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{oops",
    });
    assert.equal(res.status, 400);
  });
});
