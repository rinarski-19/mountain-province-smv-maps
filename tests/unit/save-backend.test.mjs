// Author: Rinar M. Dengwas — Mountain Province Land Value Map
// The GitHub Contents API is what actually persists edits on the deployed
// build; local dev never touches it. These tests stub fetch so the request
// sequence, encoding and error handling are covered without a real token.
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mod } from "../helpers/paths.mjs";

const { commitToGithub } = await mod("lib/save-backend.js");
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(responses) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", init });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected extra fetch to ${url}`);
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.body,
      text: async () => JSON.stringify(next.body),
    };
  };
  return calls;
}

const ARGS = {
  token: "tok",
  owner: "o",
  repo: "r",
  branch: "main",
  path: "public/data/bauko_print_settings.json",
  message: "msg",
};

describe("commitToGithub", () => {
  test("updates an existing file by echoing back its sha", async () => {
    const calls = stubFetch([
      { status: 200, body: { sha: "existing-sha" } },
      { status: 200, body: { commit: { sha: "c1" }, content: { html_url: "u1" } } },
    ]);
    const result = await commitToGithub({ ...ARGS, content: '{"a":1}\n' });

    assert.equal(calls.length, 2);
    assert.equal(calls[0].method, "GET");
    assert.ok(calls[0].url.includes("ref=main"), "GET must pin the branch");
    assert.ok(
      calls[0].url.includes(encodeURIComponent(ARGS.path)),
      "path must be URL-encoded"
    );
    assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
    assert.equal(calls[1].method, "PUT");
    const put = JSON.parse(calls[1].init.body);
    assert.equal(put.sha, "existing-sha");
    assert.equal(put.branch, "main");
    assert.equal(put.message, "msg");
    assert.deepEqual(result, { commitSha: "c1", htmlUrl: "u1" });
  });

  test("creates a new file when the GET 404s, sending no sha", async () => {
    const calls = stubFetch([
      { status: 404, body: {} },
      { status: 201, body: { commit: { sha: "c2" }, content: { html_url: "u2" } } },
    ]);
    await commitToGithub({ ...ARGS, content: "x" });
    assert.equal(JSON.parse(calls[1].init.body).sha, undefined);
  });

  test("round-trips non-ASCII content through base64", async () => {
    // The sheet's captions include ₱ and Spanish place names; a latin1
    // encode here would corrupt them in the committed file.
    const content = '{"peso":"₱5,170","name":"Kin-iway (Pob.)"}\n';
    const calls = stubFetch([
      { status: 404, body: {} },
      { status: 201, body: { commit: {}, content: {} } },
    ]);
    await commitToGithub({ ...ARGS, content });
    const sent = JSON.parse(calls[1].init.body).content;
    assert.equal(Buffer.from(sent, "base64").toString("utf8"), content);
  });

  test("throws when the lookup fails, instead of blindly creating", async () => {
    stubFetch([{ status: 500, body: { message: "boom" } }]);
    await assert.rejects(
      () => commitToGithub({ ...ARGS, content: "x" }),
      /returned 500/
    );
  });

  test("throws when the write is rejected", async () => {
    stubFetch([
      { status: 404, body: {} },
      { status: 403, body: { message: "forbidden" } },
    ]);
    await assert.rejects(
      () => commitToGithub({ ...ARGS, content: "x" }),
      /returned 403/
    );
  });
});
