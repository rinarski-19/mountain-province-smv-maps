// Author: Rinar M. Dengwas — Mountain Province Land Value Map
// Boots a real Next dev server on a free port so integration and e2e tests
// exercise the actual routes — middleware, param parsing, cookies and all —
// rather than calling handler functions directly with hand-built Requests.
//
// IMPORTANT: Next 16 permits only ONE dev server per project directory; a
// second one exits with "Another next dev server is already running". So
// every suite that calls startServer() must run serially — see the
// --test-concurrency=1 in the package.json test scripts — and each server
// must be fully torn down before the next starts. `npx next dev` spawns a
// grandchild `next-server` that does not die with its parent, so we run the
// child in its own process group and signal the whole group.

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { REPO_ROOT } from "./paths.mjs";

export const TEST_PASSWORD = "test-password-do-not-use-in-production";

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForReady(base, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let apiReady = false;
  while (Date.now() < deadline) {
    try {
      if (!apiReady) {
        const res = await fetch(`${base}/api/auth/unlock`, { cache: "no-store" });
        if (res.ok) apiReady = true;
      }
      if (apiReady) {
        // The page route compiles separately from the API routes. Without
        // warming it, the first browser load races an in-progress compile:
        // the HTML arrives referencing chunks that 404, React never
        // hydrates, and every DOM-only assertion passes vacuously against
        // a dead page.
        const page = await fetch(`${base}/`, { cache: "no-store" });
        if (page.ok) {
          await page.text();
          return;
        }
      }
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Server at ${base} was not ready within ${timeoutMs}ms`);
}

// `env` overrides let a test drive a server with e.g. SMV_LOCKDOWN=true or no
// SAVE_PASSWORD at all, which is the only way to cover those branches.
// mode "dev"   — `next dev`. NODE_ENV=development, so writes go to the
//                 local filesystem; that is the only way to exercise the
//                 save backend end to end. Next allows ONE per directory.
// mode "start" — `next start` against a production build. Deterministic
//                 (no HMR, no on-demand compile) and safe to run several
//                 of, which makes it the right choice for browser tests.
//                 Requires `npm run build` first.
export async function startServer({
  env = {},
  password = TEST_PASSWORD,
  mode = "dev",
} = {}) {
  if (mode === "start" && !fs.existsSync(path.join(REPO_ROOT, ".next", "BUILD_ID"))) {
    throw new Error(
      "No production build found. Run `npm run build` before the e2e suite."
    );
  }
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn("npx", ["next", mode === "start" ? "start" : "dev", "-p", String(port)], {
    cwd: REPO_ROOT,
    // Own process group, so stop() can take the grandchild with it.
    detached: true,
    env: {
      ...process.env,
      // A dev server with a password set is the closest thing to the
      // deployed posture that still writes to the local filesystem
      // instead of committing to GitHub.
      SAVE_PASSWORD: password,
      NEXT_PUBLIC_READ_ONLY: "true",
      NEXT_TELEMETRY_DISABLED: "1",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const logs = [];
  let lockConflict = false;
  const collect = (d) => {
    const text = String(d);
    logs.push(text);
    if (text.includes("Another next dev server is already running")) {
      lockConflict = true;
    }
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);

  const killGroup = () => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {}
    }
  };
  // A crashed or interrupted run must not leave a server holding the lock
  // and breaking every subsequent run.
  const onExit = () => killGroup();
  process.once("exit", onExit);

  try {
    await waitForReady(base, lockConflict ? 5_000 : 120_000);
  } catch (e) {
    killGroup();
    process.off("exit", onExit);
    if (lockConflict) {
      throw new Error(
        "Another `next dev` server is already running for this project, so a " +
          "test server could not start. Next allows only one per directory. " +
          "Stop it (pkill -f 'next dev') and make sure test suites that boot a " +
          "server run with --test-concurrency=1."
      );
    }
    throw new Error(`${e.message}\n--- server output ---\n${logs.join("")}`);
  }

  return {
    base,
    port,
    logs,
    async stop() {
      process.off("exit", onExit);
      if (child.exitCode !== null) return;
      const exited = new Promise((resolve) => child.once("exit", resolve));
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
      await Promise.race([
        exited,
        new Promise((resolve) => setTimeout(resolve, 5000)).then(killGroup),
      ]);
      // Next releases the single-dev-server lock on exit; give it a beat so
      // the next suite in line does not race it.
      await new Promise((r) => setTimeout(r, 500));
    },
  };
}

// Small fetch wrapper that carries a cookie jar, so tests can exercise the
// unlock cookie exactly the way a browser would.
export function makeClient(base) {
  let cookie = "";
  return {
    get cookie() {
      return cookie;
    },
    clearCookie() {
      cookie = "";
    },
    async fetch(pathname, init = {}) {
      const headers = { ...(init.headers || {}) };
      if (cookie) headers.Cookie = cookie;
      const res = await fetch(`${base}${pathname}`, { ...init, headers });
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) {
        const [pair] = setCookie.split(";");
        // Max-Age=0 is the server clearing it.
        cookie = /Max-Age=0(?:;|$)/i.test(setCookie) ? "" : pair;
      }
      return res;
    },
    async json(pathname, init) {
      const res = await this.fetch(pathname, init);
      let body = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      return { res, body };
    },
    async unlock(password = TEST_PASSWORD) {
      return this.json("/api/auth/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
    },
  };
}
