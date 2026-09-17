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

describe("live theme registry", () => {
  test("themeColor returns the stock value until an override is set", async () => {
    const { setPrintThemeOverrides, themeColor } = await mod("lib/print-theme.js");
    setPrintThemeOverrides({});
    assert.equal(themeColor("roadFillTrunk"), PRINT_THEME_DEFAULTS.roadFillTrunk);
    setPrintThemeOverrides({ roadFillTrunk: "#00e5ff" });
    assert.equal(themeColor("roadFillTrunk"), "#00e5ff");
    // Untouched keys stay stock.
    assert.equal(themeColor("waterLine"), PRINT_THEME_DEFAULTS.waterLine);
    setPrintThemeOverrides({});
  });

  test("an invalid override never reaches the screen", async () => {
    const { setPrintThemeOverrides, themeColor } = await mod("lib/print-theme.js");
    setPrintThemeOverrides({ roadFillTrunk: "not-a-colour" });
    assert.equal(themeColor("roadFillTrunk"), PRINT_THEME_DEFAULTS.roadFillTrunk);
    setPrintThemeOverrides({});
  });

  test("no UI component hardcodes a colour the theme owns", async () => {
    // Regression: LeafletMap and Sidebar carried byte-identical copies of
    // the theme defaults, so an edited road, boundary or river colour
    // changed the printed sheet and left the screen stock — permanently,
    // even after reload. Any new literal that matches a theme default is
    // almost certainly another such copy.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { REPO_ROOT } = await import("../helpers/paths.mjs");
    const owned = new Map(
      Object.entries(PRINT_THEME_DEFAULTS).map(([k, v]) => [v.toLowerCase(), k])
    );
    // Colours the map legitimately reuses for a different purpose.
    const ALLOWED = new Set(["#ffffff", "#000000"]);
    const offenders = [];
    for (const file of ["components/LeafletMap.js", "components/Sidebar.js"]) {
      const src = await fs.readFile(path.join(REPO_ROOT, file), "utf8");
      for (const line of src.split("\n")) {
        if (/themeColor|colorForClass|^\s*\/\//.test(line)) continue;
        for (const m of line.matchAll(/"(#[0-9a-fA-F]{6})"/g)) {
          const hex = m[1].toLowerCase();
          if (ALLOWED.has(hex)) continue;
          if (owned.has(hex)) offenders.push(`${file}: ${hex} duplicates theme key "${owned.get(hex)}"`);
        }
      }
    }
    assert.deepEqual(offenders, [], offenders.join("\n"));
  });
});

describe("provider landmarks on the printed sheet", () => {
  test("a barangay hall survives even when the provider mis-tags it", async () => {
    // Regression: Google tags 6 of Bauko's 11 barangay halls as
    // "business", so filtering on the provider's kind dropped them before
    // the name was considered — 0 of 11 printed. This module already
    // treats the name as the more reliable signal for government places.
    const { filterProviderPoiFeatureCollection, normalizeLandmarkKind } =
      await mod("lib/landmark-icons.js");
    const fc = {
      type: "FeatureCollection",
      features: [
        { properties: { name: "Bila Barangay Hall", kind: "business" }, geometry: null },
        { properties: { name: "Bauko Municipal Hall", kind: "govt" }, geometry: null },
        { properties: { name: "Some Sari-sari Store", kind: "business" }, geometry: null },
        { properties: { name: "Tourist Viewpoint", kind: "tourism" }, geometry: null },
      ],
    };
    const kept = filterProviderPoiFeatureCollection(fc).features;
    const names = kept.map((f) => f.properties.name);
    assert.ok(names.includes("Bila Barangay Hall"), "mis-tagged barangay hall was dropped");
    assert.ok(names.includes("Bauko Municipal Hall"));
    assert.ok(!names.includes("Some Sari-sari Store"), "an ordinary business must not print");
    assert.ok(!names.includes("Tourist Viewpoint"), "tourism must not print");

    // A rescued hall must draw with the government icon, not a business one.
    const hall = kept.find((f) => f.properties.name === "Bila Barangay Hall");
    assert.equal(normalizeLandmarkKind(hall.properties.kind), "govt");
  });

  test("a health facility survives even when the provider mis-tags it", async () => {
    // Regression: real Barangay Health Stations and Rural Health Units
    // arrive tagged "business" or "govt", so Bauko printed 1 of 6 and
    // Tadian 0 of 2 — in municipalities with no hospital the BHS/RHU IS
    // the health facility. Co-ops and staff associations carrying a
    // hospital's name must NOT be rescued, or the hospital double-pins.
    const { filterProviderPoiFeatureCollection, isHealthFacilityName, normalizeLandmarkKind } =
      await mod("lib/landmark-icons.js");

    for (const name of [
      "Banao Barangay Health Station",
      "BARLIG RHU",
      "Paracelis Rural Health Unit",
      "Luis Hora Memorial Regional Hospital",
    ]) {
      assert.ok(isHealthFacilityName(name), `should be a facility: ${name}`);
    }
    for (const name of [
      "Luis Hora Memorial Regional Hospital Employees Association",
      "Bontoc General Hospital Multipurpose Cooperative",
      "Abatan Generic Pharmacy",
      "Tadian Pharmacy and Merchandising",
    ]) {
      assert.ok(!isHealthFacilityName(name), `should NOT be a facility: ${name}`);
    }

    const fc = {
      type: "FeatureCollection",
      features: [
        { properties: { name: "Butac BhS", kind: "business" }, geometry: null },
        { properties: { name: "Bontoc General Hospital Multipurpose Cooperative", kind: "business" }, geometry: null },
      ],
    };
    const kept = filterProviderPoiFeatureCollection(fc).features;
    assert.deepEqual(kept.map((f) => f.properties.name), ["Butac BhS"]);
    // And it draws with the hospital icon, not a business one.
    assert.equal(normalizeLandmarkKind(kept[0].properties.kind), "hospital");
  });

  test("the sheet prints no provider landmarks unless asked", async () => {
    const { parseLandmarkKinds } = await mod("app/api/print/svg/_route-helpers.js");
    assert.deepEqual(parseLandmarkKinds(null), []);
    assert.deepEqual(parseLandmarkKinds("0"), []);
    assert.deepEqual(parseLandmarkKinds("bogus"), []);
    assert.ok(parseLandmarkKinds("1").includes("govt"));
    assert.deepEqual(parseLandmarkKinds("school,govt").sort(), ["govt", "school"]);
  });
});
