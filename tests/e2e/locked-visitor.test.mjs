// Author: Rinar M. Dengwas — Mountain Province Land Value Map
// The public, locked experience. Every assertion here corresponds to a
// leak or regression found while testing the password feature.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../helpers/server.mjs";
import {
  assertInteractive,
  gotoApp,
  launchBrowser,
  selectMunicipality,
  watchProblems,
  watchSameOriginPosts,
} from "../helpers/browser.mjs";

// Resolved at module load, because node:test evaluates a suite's `skip`
// option when describe() is called — before any before() hook has run.
let server = null;
let browser = null;
let skipReason = false;
try {
  browser = await launchBrowser();
} catch (e) {
  if (!e.isMissingBrowser) throw e;
  skipReason = `no browser available: ${e.message}`;
}
// Browser tests run against a production build: no HMR websocket, no
// on-demand compilation, so a page load is deterministic.
if (browser) server = await startServer({ mode: "start" });

after(async () => {
  await browser?.close();
  await server?.stop();
});

async function openPage({ width = 1400, height = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const problems = watchProblems(page);
  const posts = watchSameOriginPosts(ctx, server.base);
  await gotoApp(page, server.base);
  return { ctx, page, problems, posts };
}

const EDITOR_BUTTON_RE =
  /Save to project|Export GeoJSON|Save landmarks|Delete selected|Select zones to join|\+ Landmark/;

async function editorButtons(page) {
  return page.$$eval("button", (bs, src) =>
    bs.map((b) => b.textContent.trim()).filter((t) => new RegExp(src).test(t)),
  EDITOR_BUTTON_RE.source);
}

describe("locked visitor", { skip: skipReason }, () => {
  test("shows no editing affordance", async () => {
    const { ctx, page } = await openPage();
    try {
      const labels = await page.$$eval("nav.top-nav button", (bs) =>
        bs.map((b) => b.getAttribute("aria-label"))
      );
      assert.ok(labels.includes("Unlock editing tools"));
      assert.ok(!labels.includes("Edit options"), "pencil leaked while locked");
      assert.ok(!labels.includes("Print sheet options"), "printer leaked while locked");
      assert.deepEqual(await editorButtons(page), []);
    } finally {
      await ctx.close();
    }
  });

  test("cadastral parcels are inert for a locked visitor", async () => {
    // A locked page still renders the parcel layer as cartography, but
    // nothing about it may be clickable: handleParcelFeature must refuse
    // to attach a click handler, and the paths must be pointer-transparent
    // so a click falls through to the map.
    //
    // Asserted as interactivity rather than "did the editor appear",
    // because the editor does NOT appear on click even with the gate
    // removed — verified by reverting the fix and clicking every
    // hit-testable parcel. Interactivity is the property that actually
    // differs between the two builds:
    //   gate removed -> interactive 4488, pointer-events:none 0, 8 hit points
    //   gate present -> interactive 0,    pointer-events:none 4488, 0 hit points
    const { ctx, page, posts } = await openPage();
    try {
      // Without this, an un-hydrated page would pass everything below for
      // the wrong reason.
      await assertInteractive(page);

      const state = await page.evaluate(() => {
        const paths = [
          ...document.querySelectorAll(".leaflet-parcels-pane-pane path"),
        ];
        const hitPoints = [];
        for (let x = 120; x < window.innerWidth - 120; x += 12) {
          for (let y = 140; y < window.innerHeight - 120; y += 12) {
            if (document.elementFromPoint(x, y)?.closest(".leaflet-parcels-pane-pane")) {
              hitPoints.push([x, y]);
            }
          }
        }
        return {
          total: paths.length,
          interactive: paths.filter((p) =>
            p.classList.contains("leaflet-interactive")
          ).length,
          hitPoints,
        };
      });

      assert.ok(
        state.total > 0,
        "no parcels rendered, so this test proves nothing — check that " +
          "bauko is the default LGU and its parcels layer is on"
      );
      assert.equal(
        state.interactive,
        0,
        `${state.interactive} of ${state.total} parcels are click-interactive while locked`
      );
      assert.deepEqual(
        state.hitPoints,
        [],
        "parcels are hit-testable while locked"
      );

      // And clicking where they are still does nothing.
      for (const [x, y] of [[396, 332], [540, 488], [552, 284]]) {
        await page.mouse.click(x, y);
        await page.waitForTimeout(250);
      }
      assert.deepEqual(await editorButtons(page), []);
      assert.deepEqual(posts, [], `locked page issued writes: ${posts}`);
    } finally {
      await ctx.close();
    }
  });

  test("?print=1 does not open the print workbench while locked", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    try {
      await gotoApp(page, server.base, "/?print=1");
      await page.waitForTimeout(1500);
      assert.equal(await page.locator(".print-panel").count(), 0);
    } finally {
      await ctx.close();
    }
  });

  test("browsing several municipalities stays clean and silent", async () => {
    const { ctx, page, problems, posts } = await openPage();
    try {
      for (const lgu of ["Sagada", "Besao", "Barlig", "Bauko"]) {
        await selectMunicipality(page, lgu);
      }
      assert.deepEqual(await editorButtons(page), []);
      assert.deepEqual(posts, [], `locked browsing issued writes: ${posts}`);
      assert.deepEqual(problems, [], `page problems: ${problems.join(" | ")}`);
    } finally {
      await ctx.close();
    }
  });

  test("no horizontal overflow at phone width, and every nav control is reachable", async () => {
    // Regression: the nav laid out on one non-wrapping row measuring
    // ~690 px inside a 400 px viewport, so the lock and basemap buttons
    // sat off-screen with no way to scroll to them.
    const { ctx, page } = await openPage({ width: 400, height: 820 });
    try {
      const m = await page.evaluate(() => {
        const inView = (el) => {
          const r = el.getBoundingClientRect();
          return r.left >= -1 && r.right <= window.innerWidth + 1 && r.width > 0;
        };
        return {
          overflow: document.documentElement.scrollWidth > window.innerWidth,
          offscreen: [...document.querySelectorAll("nav.top-nav button")]
            .filter((b) => !inView(b))
            .map((b) => b.getAttribute("aria-label")),
        };
      });
      assert.equal(m.overflow, false, "page scrolls horizontally at 400px");
      assert.deepEqual(m.offscreen, [], "nav controls are off-screen at 400px");
    } finally {
      await ctx.close();
    }
  });
});
