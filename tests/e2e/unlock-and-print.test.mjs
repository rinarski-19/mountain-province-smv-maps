// Author: Rinar M. Dengwas — Mountain Province Land Value Map
// The unlocked path: the password dialog, and the print workbench's draft
// lifecycle. Publishing is covered by tests/integration/print-settings —
// these browser tests run against a production build, where a publish
// would try to commit to GitHub.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, TEST_PASSWORD } from "../helpers/server.mjs";
import {
  assertInteractive,
  gotoApp,
  launchBrowser,
  selectMunicipality,
  watchProblems,
} from "../helpers/browser.mjs";

let server = null;
let browser = null;
let skipReason = false;
try {
  browser = await launchBrowser();
} catch (e) {
  if (!e.isMissingBrowser) throw e;
  skipReason = `no browser available: ${e.message}`;
}
if (browser) server = await startServer({ mode: "start" });

after(async () => {
  await browser?.close();
  await server?.stop();
});

async function openPage() {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const problems = watchProblems(page);
  await gotoApp(page, server.base);
  await assertInteractive(page);
  return { ctx, page, problems };
}

async function unlock(page, password = TEST_PASSWORD) {
  await page.click('button[aria-label="Unlock editing tools"]');
  await page.waitForSelector("#unlock-password");
  await page.fill("#unlock-password", password);
  await page.click('.unlock-dialog button[type="submit"]');
}

async function unlockFully(page) {
  await unlock(page);
  await page.waitForSelector(".unlock-dialog", { state: "detached", timeout: 20_000 });
  await page.waitForTimeout(800);
}

const navLabels = (page) =>
  page.$$eval("nav.top-nav button", (bs) => bs.map((b) => b.getAttribute("aria-label")));

describe("unlock dialog", { skip: skipReason }, () => {
  test("a wrong password keeps the dialog open and returns focus to the field", async () => {
    // Regression: the field is disabled while checking, so calling
    // .select() in the same tick silently did nothing and stranded focus
    // on <body> — ejecting keyboard and screen-reader users on every typo.
    const { ctx, page } = await openPage();
    try {
      await unlock(page, "definitely-not-it");
      await page.waitForSelector(".unlock-dialog__error");
      assert.equal(await page.locator(".unlock-dialog").count(), 1);
      await page.waitForTimeout(400);
      assert.equal(
        await page.evaluate(() => document.activeElement?.id),
        "unlock-password"
      );
      assert.equal(await page.getAttribute("#unlock-password", "aria-invalid"), "true");
      assert.ok(!(await navLabels(page)).includes("Print sheet options"));
    } finally {
      await ctx.close();
    }
  });

  test("a whitespace-only password cannot be submitted", async () => {
    const { ctx, page } = await openPage();
    try {
      await page.click('button[aria-label="Unlock editing tools"]');
      await page.waitForSelector("#unlock-password");
      await page.fill("#unlock-password", "   ");
      assert.equal(await page.isDisabled('.unlock-dialog button[type="submit"]'), true);
    } finally {
      await ctx.close();
    }
  });

  test("focus stays trapped inside the dialog", async () => {
    // aria-modal="true" is a promise to assistive tech that the rest of
    // the page is inert; without a trap, Tab walked straight out into the
    // map and the nav behind it.
    const { ctx, page } = await openPage();
    try {
      await page.click('button[aria-label="Unlock editing tools"]');
      await page.waitForSelector("#unlock-password");
      // The dialog autofocuses its field on a timer; tabbing before that
      // lands would test the wrong starting point.
      await page.waitForFunction(
        () => document.activeElement?.id === "unlock-password",
        { timeout: 5000 }
      );
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press("Tab");
        const inside = await page.evaluate(
          () => !!document.activeElement?.closest?.(".unlock-dialog")
        );
        assert.ok(inside, `focus escaped the dialog after ${i + 1} tabs`);
      }
    } finally {
      await ctx.close();
    }
  });

  test("the nav is not clickable through the dialog", async () => {
    // Regression: .top-nav is z-index 2000 and the backdrop was 1200, so
    // the basemap and municipality menus opened on top of the modal.
    const { ctx, page } = await openPage();
    try {
      await page.click('button[aria-label="Unlock editing tools"]');
      await page.waitForSelector("#unlock-password");
      const covered = await page.evaluate(() => {
        const btn = document.querySelector(
          'nav.top-nav button[aria-label="Show tile mode options"]'
        );
        const r = btn.getBoundingClientRect();
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return !(top === btn || btn.contains(top));
      });
      assert.ok(covered, "the nav is reachable through the modal scrim");
    } finally {
      await ctx.close();
    }
  });

  test("the correct password reveals the editing tools, and Lock hides them again", async () => {
    const { ctx, page } = await openPage();
    try {
      await unlockFully(page);
      const unlocked = await navLabels(page);
      assert.ok(unlocked.includes("Edit options"));
      assert.ok(unlocked.includes("Print sheet options"));
      assert.ok(unlocked.includes("Lock editing tools"));

      await page.click('button[aria-label="Lock editing tools"]');
      await page.waitForTimeout(1200);
      const relocked = await navLabels(page);
      assert.ok(!relocked.includes("Edit options"));
      assert.ok(!relocked.includes("Print sheet options"));
      assert.ok(relocked.includes("Unlock editing tools"));
    } finally {
      await ctx.close();
    }
  });
});

describe("print workbench", { skip: skipReason }, () => {
  test("the drawer header clears the nav and its close button works", async () => {
    // Regression: the nav covered the whole print-panel header, so the
    // title, the scope line and the × were invisible and unclickable.
    const { ctx, page } = await openPage();
    try {
      await unlockFully(page);
      await page.click('button[aria-label="Print sheet options"]');
      await page.waitForSelector(".print-panel");
      const clear = await page.evaluate(() => {
        const nav = document.querySelector("nav.top-nav").getBoundingClientRect();
        const head = document.querySelector(".print-panel__head").getBoundingClientRect();
        return head.top >= nav.bottom - 1;
      });
      assert.ok(clear, "the drawer header is underneath the nav");
      assert.ok(await page.isVisible(".print-panel__title"));
      await page.click(".print-panel__close", { timeout: 5000 });
      await page.waitForSelector(".print-panel", { state: "detached", timeout: 5000 });
    } finally {
      await ctx.close();
    }
  });

  test("the coverage list offers every barangay and flags borrowed outlines", async () => {
    // Was: barangays without a PSA polygon were omitted. Now all 146 are
    // offered, and the two Barlig sitios — which PSA maps only as part of
    // their parent — say so in the option text rather than letting the
    // user discover it after printing.
    const { ctx, page } = await openPage();
    try {
      await unlockFully(page);
      await page.click('button[aria-label="Print sheet options"]');
      await page.waitForSelector(".print-panel");
      await selectMunicipality(page, "Barlig");
      await page.waitForTimeout(1500);
      const options = await page.$$eval(".print-panel select >> nth=0 >> option", (o) =>
        o.map((x) => x.textContent)
      );
      assert.ok(options.some((t) => t.includes("Whole municipality")));
      const sitio = options.find((t) => t.includes("Lingoy (Lower)"));
      assert.ok(sitio, "Lingoy (Lower) should be offered");
      assert.match(sitio, /mapped on Lingoy \(Upper\)/);
      // A barangay with its own boundary must not carry the note.
      const own = options.find((t) => t.trim().startsWith("Gawana"));
      assert.ok(own && !own.includes("mapped on"), `unexpected note: ${own}`);
      // Nothing should now be advertised as unprintable.
      assert.equal(
        await page.locator('.print-panel__field small:has-text("cannot be printed")').count(),
        0
      );
    } finally {
      await ctx.close();
    }
  });

  test("an out-of-range band width is reported instead of silently dropped", async () => {
    const { ctx, page } = await openPage();
    try {
      await unlockFully(page);
      await page.click('button[aria-label="Print sheet options"]');
      await page.waitForSelector(".print-panel");
      await page.fill('.print-panel input[type="number"]', "-10");
      await page.waitForTimeout(250);
      assert.match(
        await page.textContent(".print-panel__inline-warning"),
        /no extra width/
      );
      await page.fill('.print-panel input[type="number"]', "9999");
      await page.waitForTimeout(250);
      assert.match(await page.textContent(".print-panel__inline-warning"), /Capped at 500/);
    } finally {
      await ctx.close();
    }
  });

  test("a draft survives a reload and does not leak between municipalities", async () => {
    // Regression: the autosave effect ran before the async load resolved,
    // so it erased the stored draft on open, and on an LGU switch stamped
    // the previous LGU's numbers onto the new one.
    const { ctx, page } = await openPage();
    try {
      await unlockFully(page);
      await page.click('button[aria-label="Print sheet options"]');
      await page.waitForSelector(".print-panel");
      await page.click('.print-panel__tab:has-text("Values")');
      await page.waitForSelector(".print-panel__row input");
      await page.fill(".print-panel__row input", "4242");
      await page.waitForTimeout(500);

      const key = "smv-print-draft-v1:bauko";
      const before = await page.evaluate((k) => localStorage.getItem(k), key);
      assert.ok(before?.includes("4242"), `draft not saved: ${before}`);

      // Only the tab holding the edit is marked.
      const dots = await page.$$eval(".print-panel__tab", (ts) =>
        ts.map((t) => [
          t.textContent.replace(/\s+/g, ""),
          !!t.querySelector(".print-panel__tab-dot"),
        ])
      );
      assert.deepEqual(dots.filter(([, d]) => d).map(([t]) => t), ["Values"]);

      await page.reload({ waitUntil: "domcontentloaded" });
      await gotoApp(page, server.base);
      await page.click('button[aria-label="Print sheet options"]');
      await page.waitForSelector(".print-panel");
      await page.waitForTimeout(1800);
      const after = await page.evaluate((k) => localStorage.getItem(k), key);
      assert.equal(after, before, "the draft was destroyed by a reload");
      await page.click('.print-panel__tab:has-text("Values")');
      await page.waitForTimeout(400);
      const restored = await page.$$eval(".print-panel__row input", (i) =>
        i.map((x) => x.value).filter(Boolean)
      );
      assert.deepEqual(restored, ["4242"], "the draft did not repopulate the form");

      await selectMunicipality(page, "Sagada");
      await page.waitForTimeout(2000);
      assert.equal(
        await page.evaluate(() => localStorage.getItem("smv-print-draft-v1:sagada")),
        null,
        "the bauko draft leaked into sagada"
      );
      assert.equal(
        await page.evaluate((k) => localStorage.getItem(k), key),
        before,
        "the bauko draft was lost when switching away"
      );
    } finally {
      await ctx.close();
    }
  });

  test("opening a sheet lands a real SVG at the expected URL", async () => {
    const { ctx, page } = await openPage();
    try {
      await unlockFully(page);
      await page.click('button[aria-label="Print sheet options"]');
      await page.waitForSelector(".print-panel");
      await page.selectOption(".print-panel select >> nth=0", { index: 3 });
      await page.selectOption(".print-panel select >> nth=1", "landscape");
      await page.waitForTimeout(300);
      const [sheet] = await Promise.all([
        ctx.waitForEvent("page", { timeout: 90_000 }),
        page.click(".print-panel__button--primary"),
      ]);
      await sheet.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(3000);
      assert.match(sheet.url(), /\/api\/print\/svg\/landscape\/bauko\/[a-z-]+$/);
      assert.deepEqual(
        await sheet.evaluate(() => ({
          root: document.documentElement.tagName.toLowerCase(),
          w: document.documentElement.getAttribute("width"),
          h: document.documentElement.getAttribute("height"),
        })),
        { root: "svg", w: "420mm", h: "297mm" }
      );
    } finally {
      await ctx.close();
    }
  });

  // The size control has to reach the sheet, not just the panel. Two
  // earlier settings shipped with the plumbing in place while the type
  // on the page never moved, so this asserts on the rendered glyphs.
  //
  // Compares two real sheets rather than checking one against a fixed
  // millimetre threshold: the default size varies by barangay, so any
  // single number here would pass without the feature working.
  test("the class code size control changes the type on the sheet", async () => {
    const { ctx, page } = await openPage();
    try {
      await unlockFully(page);
      await page.click('button[aria-label="Print sheet options"]');
      await page.waitForSelector(".print-panel");
      // A barangay that actually carries SMV zones — the zone-class-labels
      // group is absent entirely where there are none, and the medians
      // below would then be measuring nothing.
      await page.selectOption(".print-panel select >> nth=0", "abatan");

      const box = page.locator('input[aria-label="Class code size percent"]');
      await box.waitFor();
      assert.equal(await box.inputValue(), "100", "defaults to 100%");

      // Median class-code type size on a freshly opened sheet.
      async function medianAt(percent) {
        await box.fill(String(percent));
        await box.blur();
        await page.waitForTimeout(300);
        const [sheet] = await Promise.all([
          ctx.waitForEvent("page", { timeout: 90_000 }),
          page.click(".print-panel__button--primary"),
        ]);
        await sheet.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(3000);
        const recorded = await sheet.evaluate(() =>
          document.documentElement.getAttribute("data-label-scale")
        );
        assert.equal(
          recorded,
          String(percent / 100),
          `sheet did not record the requested ${percent}% size`
        );
        const median = await sheet.evaluate(() => {
          const g = document.getElementById("zone-class-labels");
          if (!g) return null;
          const sizes = [...g.querySelectorAll("text")]
            .filter((t) => /^[A-Z]+-\d+$/.test(t.textContent.trim()))
            .map((t) => parseFloat(t.getAttribute("font-size")))
            .sort((a, b) => a - b);
          return sizes.length ? sizes[Math.floor(sizes.length / 2)] : null;
        });
        await sheet.close();
        assert.ok(median !== null, `no class codes on the ${percent}% sheet`);
        return median;
      }

      const normal = await medianAt(100);
      const large = await medianAt(200);
      const small = await medianAt(60);

      assert.ok(
        large > normal,
        `200% should print larger codes than 100% (${large} vs ${normal})`
      );
      assert.ok(
        small < normal,
        `60% should print smaller codes than 100% (${small} vs ${normal})`
      );
    } finally {
      await ctx.close();
    }
  });
});
