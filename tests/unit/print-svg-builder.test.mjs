// Author: Rinar M. Dengwas — Mountain Province Land Value Map
// Covers the plumbing from an override to the glyphs on the page: the
// three-layer merge (valuations < published file < caller), and the XML
// escaping that stands between a user-typed caption and a corrupt SVG.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { PUBLIC_DATA, mod } from "../helpers/paths.mjs";

const { buildSvgForSlug } = await mod("lib/print-svg-builder.js");
const { PRINT_LABEL_DEFAULTS } = await mod("lib/print-labels.js");

// A single barangay keeps each render to a few hundred KB instead of the
// ~4 MB a whole-municipality sheet costs.
const SLUG = "bauko";
const BARANGAY = "Poblacion (Bauko)";
const SETTINGS_FILE = path.join(PUBLIC_DATA, `${SLUG}_print_settings.json`);

let hadSettingsFile = false;
before(async () => {
  hadSettingsFile = await fs
    .access(SETTINGS_FILE)
    .then(() => true)
    .catch(() => false);
  assert.equal(
    hadSettingsFile,
    false,
    `${SETTINGS_FILE} exists; these tests would overwrite real overrides`
  );
});
after(async () => {
  if (!hadSettingsFile) await fs.rm(SETTINGS_FILE, { force: true });
});

function render(opts = {}) {
  return buildSvgForSlug(SLUG, PUBLIC_DATA, { barangayName: BARANGAY, ...opts }).svg;
}

describe("print SVG labels", () => {
  test("renders the stock captions with no overrides", () => {
    const svg = render();
    assert.ok(svg.includes(PRINT_LABEL_DEFAULTS.title));
    assert.ok(svg.includes(PRINT_LABEL_DEFAULTS.municipalityLabel));
    assert.ok(svg.includes(PRINT_LABEL_DEFAULTS.preparedByName));
  });

  test("caller-supplied labels replace the defaults", () => {
    const svg = render({
      labels: { title: "SCHEDULE OF VALUES", preparedByTitle: "Municipal Assessor" },
    });
    assert.ok(svg.includes("SCHEDULE OF VALUES"));
    assert.ok(svg.includes("Municipal Assessor"));
    assert.ok(!svg.includes(PRINT_LABEL_DEFAULTS.title));
    // Untouched captions keep their defaults.
    assert.ok(svg.includes(PRINT_LABEL_DEFAULTS.municipalityLabel));
  });

  test("class value overrides reach the legend", () => {
    const svg = render({ classValueOverrides: { "C-1": 7654321 } });
    assert.ok(svg.includes("₱7,654,321"), "formatted override missing from legend");
  });

  test("a barangay crop carries the BARANGAY caption; the whole LGU does not", () => {
    assert.ok(render().includes(PRINT_LABEL_DEFAULTS.barangayLabel));
    const whole = buildSvgForSlug(SLUG, PUBLIC_DATA, {}).svg;
    assert.ok(!whole.includes(PRINT_LABEL_DEFAULTS.barangayLabel));
  });
});

describe("XML safety", () => {
  test("hostile caption text is escaped, not injected", () => {
    // Labels are free text typed by an unlocked editor and land directly
    // in <text> nodes. Anything less than full escaping produces either a
    // parse error or an executable script element.
    const svg = render({
      labels: {
        title: '<script>alert(1)</script>',
        provinceValue: 'Tom & Jerry "quoted" \'single\'',
        islandValue: "</text><rect width='999'/>",
      },
    });
    assert.ok(!svg.includes("<script>"), "raw <script> reached the document");
    assert.ok(svg.includes("&lt;script&gt;"));
    assert.ok(svg.includes("Tom &amp; Jerry"));
    assert.ok(!svg.includes("</text><rect width='999'/>"));
  });

  test("the rendered document stays well-formed XML", () => {
    const svg = render({ labels: { title: '<b>&"\'</b>', legendLabel: "A & B" } });
    // A minimal well-formedness proxy: no bare & outside an entity, and
    // balanced <text> elements.
    const bareAmp = svg.match(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g);
    assert.equal(bareAmp, null, `unescaped ampersand(s): ${bareAmp?.slice(0, 3)}`);
    const open = (svg.match(/<text\b/g) || []).length;
    const close = (svg.match(/<\/text>/g) || []).length;
    assert.equal(open, close, "unbalanced <text> elements");
  });
});

describe("override layering", () => {
  test("published file overlays the valuations file, and the caller overlays both", async () => {
    await fs.writeFile(
      SETTINGS_FILE,
      JSON.stringify({
        slug: SLUG,
        classValues: { "C-1": 111111 },
        labels: { title: "PUBLISHED TITLE", islandValue: "PUBLISHED ISLAND" },
      }),
      "utf8"
    );
    try {
      const published = render();
      assert.ok(published.includes("PUBLISHED TITLE"));
      assert.ok(published.includes("₱111,111"));

      // Caller wins for what it sets; the published layer still applies
      // to everything it does not.
      const drafted = render({
        labels: { title: "DRAFT TITLE" },
        classValueOverrides: { "C-2": 222222 },
      });
      assert.ok(drafted.includes("DRAFT TITLE"));
      assert.ok(!drafted.includes("PUBLISHED TITLE"));
      assert.ok(drafted.includes("PUBLISHED ISLAND"), "published label was lost");
      assert.ok(drafted.includes("₱111,111"), "published value was lost");
      assert.ok(drafted.includes("₱222,222"));
    } finally {
      await fs.rm(SETTINGS_FILE, { force: true });
    }
  });

  test("a malformed settings file is ignored rather than failing the render", async () => {
    await fs.writeFile(SETTINGS_FILE, "{ not json", "utf8");
    try {
      assert.ok(render().includes(PRINT_LABEL_DEFAULTS.title));
    } finally {
      await fs.rm(SETTINGS_FILE, { force: true });
    }
  });
});

// The control the assessors asked for: make the class codes on the zones
// bigger or smaller. Asserting on the rendered glyph sizes rather than on
// the query plumbing, because the plumbing was already in place twice
// before while the type on the page never moved.
describe("class code size", () => {
  // Codes look like "C-1" / "R-4". Excludes the legend, whose chips carry
  // the same strings at a fixed size and must NOT follow this setting.
  function codeSizes(svg) {
    const start = svg.indexOf('<g id="zone-class-labels"');
    // Guard rather than slice(-1): a renamed group would otherwise make
    // every assertion below pass against an empty set.
    assert.notEqual(start, -1, "zone-class-labels group missing from the sheet");
    const group = svg.slice(start, svg.indexOf("</g>", start));
    const sizes = [];
    const re = /<text[^>]*font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g;
    for (const m of group.matchAll(re)) {
      if (/^[A-Z]+-\d+$/.test(m[2].trim())) sizes.push(Number(m[1]));
    }
    return sizes.sort((a, b) => a - b);
  }
  const median = (a) => a[Math.floor(a.length / 2)];

  const small = codeSizes(render({ classLabelScale: 0.5 }));
  const normal = codeSizes(render({ classLabelScale: 1 }));
  const large = codeSizes(render({ classLabelScale: 2 }));

  test("renders class codes at every scale", () => {
    for (const set of [small, normal, large]) assert.ok(set.length > 0);
  });

  test("the scale actually moves the type on the page", () => {
    assert.ok(
      median(small) < median(normal),
      `expected smaller median than ${median(normal)}, got ${median(small)}`
    );
    assert.ok(
      median(large) > median(normal),
      `expected larger median than ${median(normal)}, got ${median(large)}`
    );
  });

  // The documented trade-off: a code that no longer fits its zone is
  // dropped rather than spilling outside it.
  test("bigger codes label fewer zones, smaller codes label more", () => {
    assert.ok(small.length >= normal.length);
    assert.ok(large.length <= normal.length);
  });

  test("omitting the option prints exactly what scale 1 prints", () => {
    assert.deepEqual(codeSizes(render()), normal);
  });

  test("junk falls back to the default rather than blanking the sheet", () => {
    assert.deepEqual(codeSizes(render({ classLabelScale: "abc" })), normal);
    assert.deepEqual(codeSizes(render({ classLabelScale: 0 })), normal);
  });
});
