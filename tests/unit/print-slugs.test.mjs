// Author: Rinar M. Dengwas — Mountain Province Land Value Map
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mod } from "../helpers/paths.mjs";

const { PRINT_SLUGS, KNOWN_PRINT_SLUGS, basePrintSlug, isPrintableSlug } =
  await mod("lib/print-slugs.js");
const { MUNICIPALITY_OPTIONS } = await mod("lib/municipalities.js");

describe("print slugs", () => {
  test("the set and the list agree", () => {
    assert.equal(KNOWN_PRINT_SLUGS.size, PRINT_SLUGS.length);
    for (const slug of PRINT_SLUGS) assert.ok(KNOWN_PRINT_SLUGS.has(slug));
  });

  test("every printable slug is a real municipality", () => {
    const known = new Set(MUNICIPALITY_OPTIONS.map((m) => m.slug));
    for (const slug of PRINT_SLUGS) {
      assert.ok(known.has(slug), `${slug} is not in MUNICIPALITY_OPTIONS`);
    }
  });

  test("basePrintSlug strips the hidden preview suffixes", () => {
    assert.equal(basePrintSlug("tadian-dxf"), "tadian");
    assert.equal(basePrintSlug("bauko-print"), "bauko");
    assert.equal(basePrintSlug("bauko-hybrid"), "bauko");
    assert.equal(basePrintSlug("BAUKO"), "bauko");
    assert.equal(basePrintSlug("bauko"), "bauko");
  });

  test("basePrintSlug tolerates junk", () => {
    for (const bad of [null, undefined, "", 0]) {
      assert.equal(basePrintSlug(bad), "");
    }
  });

  test("isPrintableSlug accepts preview variants but not unknown LGUs", () => {
    assert.equal(isPrintableSlug("tadian-dxf"), true);
    assert.equal(isPrintableSlug("bauko"), true);
    assert.equal(isPrintableSlug("nonexistent"), false);
    assert.equal(isPrintableSlug(""), false);
  });
});
