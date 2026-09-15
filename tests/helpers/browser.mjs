// Author: Rinar M. Dengwas — Mountain Province Land Value Map
// e2e uses playwright-core driving the browser already installed on the
// machine, so CI/dev boxes don't need a separate ~300 MB browser download.
// If no such browser is present the e2e suite skips rather than fails —
// unit and integration still cover the logic underneath.

import { chromium } from "playwright-core";

const CHANNELS = ["chrome", "msedge", "chromium"];

export async function launchBrowser() {
  let lastError;
  for (const channel of CHANNELS) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch (e) {
      lastError = e;
    }
  }
  try {
    return await chromium.launch({ headless: true });
  } catch (e) {
    lastError = e;
  }
  const err = new Error(
    `No usable Chromium found (tried ${CHANNELS.join(", ")}). ` +
      `Install Chrome, or run \`npx playwright install chromium\`. ` +
      `Original error: ${lastError?.message}`
  );
  err.isMissingBrowser = true;
  throw err;
}

// Known-noisy requests that predate this feature and are not what the
// e2e suite is asserting about.
const IGNORED = [
  /_osm_landmarks\.geojson/,
  /_osm_places\.geojson/,
  /_custom_landmarks\.geojson/,
  /tile\.googleapis\.com/,
  /googleapis\.com\/tile/,
];

export function watchProblems(page) {
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("response", (r) => {
    if (r.status() < 400) return;
    if (IGNORED.some((re) => re.test(r.url()))) return;
    problems.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });
  return problems;
}

export function watchSameOriginPosts(ctx, base) {
  const posts = [];
  ctx.on("request", (r) => {
    if (r.method() === "POST" && r.url().startsWith(base)) posts.push(r.url());
  });
  return posts;
}

// The municipality menu is a click-outside-dismissing popover, so opening
// it and clicking an item in one go is racy. Wait for the menu to actually
// be on screen in between.
export async function selectMunicipality(page, name) {
  await page.click(".top-nav__expander");
  await page.waitForSelector(".top-nav__menu", { state: "visible", timeout: 10_000 });
  const item = page.locator(`.top-nav__menu-item:has-text("${name}")`).first();
  await item.waitFor({ state: "visible", timeout: 10_000 });
  await item.click();
  await page.waitForSelector(".top-nav__menu", { state: "detached", timeout: 10_000 });
  // Let the new LGU's layers settle before asserting on them.
  await page.waitForTimeout(1800);
}

// Never wait on "networkidle" here: this is a map app that keeps pulling
// basemap tiles, so the network is never idle and the wait just times out.
//
// Wait for hydration instead, by checking that React has attached its
// internal props to a real control. That is the precise condition the
// tests depend on — an un-hydrated page still renders the full server
// markup, so DOM-only assertions would otherwise pass against a page
// where nothing is interactive and no leak could possibly appear.
export async function gotoApp(page, base, pathname = "/") {
  await page.goto(`${base}${pathname}`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  await page.waitForSelector("nav.top-nav button", { timeout: 60_000 });
  await page.waitForFunction(
    () => {
      const el = document.querySelector("nav.top-nav button");
      return !!el && Object.keys(el).some((k) => k.startsWith("__react"));
    },
    { timeout: 60_000 }
  );
  // Let the Leaflet layers and the lock-state fetch settle.
  await page.waitForTimeout(2500);
}

// Proves the page is actually interactive before a test asserts on the
// absence of something. Toggles the basemap menu open and shut.
export async function assertInteractive(page) {
  await page.click('button[aria-label="Show tile mode options"]');
  await page.waitForSelector(".top-nav__settings-menu", { timeout: 10_000 });
  await page.keyboard.press("Escape");
  await page.waitForSelector(".top-nav__settings-menu", {
    state: "detached",
    timeout: 10_000,
  });
}
