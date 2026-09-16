// Author: Rinar M. Dengwas — Mountain Province Land Value Map
//
// Every colour on the sheet that is not an SMV class: roads, boundaries,
// basemap and landmark pins.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mod } from "../helpers/paths.mjs";

const {
  PRINT_THEME_DEFAULTS,
  PRINT_THEME_FIELDS,
  printThemeGroups,
  resolvePrintTheme,
  sanitizePrintTheme,
} = await mod("lib/print-theme.js");

describe("theme schema", () => {
  test("every field has a unique key, a group and a valid hex default", () => {
    const keys = new Set();
    for (const f of PRINT_THEME_FIELDS) {
      assert.ok(f.key && !keys.has(f.key), `bad or duplicate key ${f.key}`);
      keys.add(f.key);
      assert.ok(f.group && f.label, `${f.key} missing group or label`);
      assert.match(f.default, /^#[0-9a-fA-F]{6}$/, `${f.key} default is not hex`);
    }
  });

  test("groups cover every field", () => {
    const flat = printThemeGroups().flatMap((g) => g.fields.map((f) => f.key));
    assert.deepEqual(new Set(flat), new Set(Object.keys(PRINT_THEME_DEFAULTS)));
  });

});

describe("sanitizePrintTheme", () => {
  test("keeps valid hex, lowercased", () => {
    assert.deepEqual(sanitizePrintTheme({ waterFill: "#ABCDEF" }), {
      waterFill: "#abcdef",
    });
  });

  test("drops unknown keys and bad values", () => {
    assert.deepEqual(
      sanitizePrintTheme({
        nope: "#ffffff",
        waterFill: "blue",
        roadFill: "#ff",
        paper: 123,
      }),
      {}
    );
  });

  test("drops a value equal to the stock one", () => {
    assert.deepEqual(
      sanitizePrintTheme({ waterFill: PRINT_THEME_DEFAULTS.waterFill }),
      {}
    );
  });

  test("tolerates junk", () => {
    for (const bad of [null, undefined, 42, "x", []]) {
      assert.deepEqual(sanitizePrintTheme(bad), {});
    }
  });
});

describe("resolvePrintTheme", () => {
  test("fills every key, with overrides winning", () => {
    const out = resolvePrintTheme({ waterFill: "#445566" });
    assert.equal(out.waterFill, "#445566");
    assert.equal(out.roadFillTrunk, PRINT_THEME_DEFAULTS.roadFillTrunk);
    assert.deepEqual(
      Object.keys(out).sort(),
      Object.keys(PRINT_THEME_DEFAULTS).sort()
    );
  });

  test("an invalid override falls back rather than painting junk", () => {
    assert.equal(
      resolvePrintTheme({ paper: "transparent" }).paper,
      PRINT_THEME_DEFAULTS.paper
    );
  });
});
