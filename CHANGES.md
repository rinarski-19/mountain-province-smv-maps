# Mountain Province SMV Map — Recent Changes

Context document covering the work done on the Bauko / Mountain Province
land valuation consultation app. Organised by feature area for easier
review.

Working directory: `leaflet-test-app/`

---

## 1. DXF conversion pipeline

The LGU CAD files (AutoCAD `.dxf`, PRS92 / Philippines zone III) are the
authoritative source for SMV zones, but the converter needed several
rounds of fixes before it produced complete output.

### `scripts/dxf-to-geojson.py`

- **Reprojects** PRS92 → WGS84 via `pyproj`.
- **Layer-to-class mapping** handles four LGU naming styles in one
  converter: `Commercial`, `commercial`, `com1` → C-1; `C-2 COMMERCIAL`,
  `C-2COM.` → C-2; explicit hyphenated `R-1` … `R-15` via regex.
  Agricultural layers (`C-1 AGRI`, `AGRI-C-1`, `AGRI-C2`) and roads
  (`NATIONAL ROAD`, `PATHWAY`, `ROADS`) are intentionally **not**
  mapped — they'd otherwise mis-tag asphalt strips and farmland as
  commercial.
- **Smart close rule** for unclosed polylines:
  - 4+ vertices → always close (CAD operators routinely leave parcel
    outlines unsnapped; Mayag's 33-vertex R-5 parcel had a 97 m gap).
  - 3 vertices → only close if gap < 50 m (avoid turning two-segment
    "V" lines into triangles).
- **HATCH extraction** — the big one. CAD operators often create zone
  fills as `HATCH` entities **without** a corresponding outline
  polyline. The old converter only read polylines and missed half the
  zones. Now we read both LWPOLYLINE and HATCH external boundary paths,
  dedupe by centroid + area, and union per class.
  - Bauko: 491 → 1,307 polygons (+166%)
  - Bontoc: 1,342 → 2,612 polygons (+95%)
  - Sagada: 142 → 302 polygons (+113%)
- **`make_valid` bowtie rescue** for self-intersecting polygons whose
  `buffer(0)` cleanup would otherwise collapse them to empty.

### In-app DXF importer

- `POST /api/zones/import-dxf?slug=<municipality>` accepts a multipart
  `dxf` upload, writes to `os.tmpdir()`, spawns
  `python3 scripts/dxf-to-geojson.py`, and writes the resulting GeoJSON
  to the slug's target file.
- **Local-dev only** — Vercel serverless functions don't have Python;
  in production the route returns 501 with a clear message.
- **"Import DXF…" button** in the editor panel (in `EditableZones.js`)
  — file picker → confirm → upload → reload zones layer with the
  freshly-written file. Cache-busted fetch ensures the browser sees the
  new file. Same `SAVE_PASSWORD` auth as `/api/zones/save`.

---

## 2. Bauko (DXF preview) page

`/?m=bauko-dxf` — parallel preview slug for Bauko's LGU CAD data. Reads
zones from `public/data/bauko_zones_dxf.geojson`. Same schedule and
barangays as `/?m=bauko`, but writes don't touch the canonical
`bauko_zones.geojson`.

- Generated 1,307 polygons from `BAUKO LAND VALUE MAP 2026.dxf`
  (103 MB DXF, 264 KB GeoJSON after simplification).
- Bauko's DXF only digitises C-2 + R-1..R-5 — **no C-1 or C-3 layers**
  exist in the CAD file yet. Worth flagging to the LGU cartographer.
- Mirrors the existing `sagada-dxf` and `bontoc-dxf` preview pattern.

Cross-check (after user edits): 1,191 polygons unchanged, 7
reclassifications, 71 user-added polygons (including 15 new C-1 zones
filling the gap), 109 removed/replaced.

---

## 3. Bauko 2027 SMV schedule — documentation

The Bauko schedule got two derivable artefacts so it can travel outside
the app:

- **`public/data/bauko_smv_schedule.json`** — JSON snapshot of all 8
  classifications (C-1 / C-2 / C-3 + R-1..R-5) with location group
  descriptions and 2027 market values. Mirrors the Bontoc schedule
  format.
- **`Bauko 2027 SMV Schedule.docx`** — Word document for hand-off to
  the LGU. Cover heading, full schedule table with No. / Location /
  ₱/m² / Sub-class columns, summary table, 22-barangay list, and notes
  flagging:
  - The Banao / Otucan Sur road-segment exclusion (Kapayawan Bridge →
    Saint Paul Parish Church, Pak-as) which steps down to R-4.
  - The DXF data gap (no C-1 / C-3 polygons drawn yet).

---

## 4. Frontage band overlay

Visual + interactive guide for the LGU's 30 m depth-of-frontage rule:
the band tells you where the road-frontage tier (R-1 / C-1) legally
ends and the inner-lot tier begins.

### Generator: `scripts/build-frontage-bands.mjs`

Per-municipality script that:
1. Loads the OSM road network (`<slug>_osm_roads.geojson`).
2. Filters to **all-weather roads** (`trunk` / `primary` / `secondary` /
   `tertiary` / `unclassified` / `residential` — explicitly excludes
   `track` since OSM tracks are dirt / seasonal and don't qualify).
3. For each road segment, generates:
   - **0–30 m chip**: 30 m flat-cap buffer **minus** a 4 m road-inset
     carve-out, so the chip is a donut ring and the carriageway stays
     visible.
   - **30–60 m chip**: 60 m buffer minus the un-carved 30 m buffer.
4. Tags each chip with `chip_id`, `band`, `depth_m`, plus the road's
   `osm_way_id`, `road_name`, `road_highway`, `barangay_slug`,
   `barangay_name`.
5. Simplifies geometry at 1 m tolerance to keep file size manageable.

| municipality | roads | chips | file size |
|---|---|---|---|
| Bauko | 336 | 672 | 2.5 MB |
| Sagada | 80 | 160 | 824 KB |
| Bontoc | 128 | 256 | 1.3 MB |
| Tadian | 151 | 302 | 1.5 MB |
| Barlig | 36 | 72 | 458 KB |

`npm run bands:<slug>` for each.

### Layer + interactivity

- New **`labels-pane`** at z-index 460 — top-stacked. Hosts the CartoDB
  Voyager Labels transparent tile overlay so place + road names always
  sit above SMV fills.
- New **`frontage-bands-pane`** at z-index 435 — sits between the SMV
  fill and the drawn-zones pane.
- New **layer toggle** *"Frontage bands (0–30 / 30–60 m)"* in the
  editor's Layers panel.
- **Shift+click a band chip** to select it (red ring + brighter fill).
  Click a class chip → the selected band polygon(s) are baked into a
  zone with no buffering (they're already the right shape).
- **Multi-select supported** — pick several chips along a road, click
  C-2, and they union into one merged corridor with the road carved
  out.

### Bake flow improvements

- **Auto-clip against existing zones** — the bake intersects the new
  polygon against every existing zone in the group so it only fills
  empty space. Bbox pre-rejection makes this fast even with 1,000+
  existing polygons.
- **Toggle: "Trim against existing"** — checkbox in the editor panel
  (persisted to localStorage). Default on. Untick to paint over
  existing zones (e.g., promote an R-2 strip to C-2 on the same road).
- **Bake notice in header** — when clipping trimmed ≥ 25% of the
  candidate, the panel title flashes for 5 s with the trim percentage
  and a hint about the toggle. Avoids the "only one side filled"
  surprise.
- **Auto-select after bake** — the newly baked polygon gets selected
  immediately, so vertex handles appear without an extra click.

---

## 5. Road corridor buffering

Two-side flat-capped corridors with the road centerline carved out, for
both the Shift+click road flow in the editor and the offline `npm run
zones:auto:<slug>` script.

- **`flatCapBuffer`** — uses `turf.lineOffset` to compute the +r and −r
  parallels of the road, then stitches them into a closed polygon with
  perpendicular flat caps at start/end. Used in both
  `components/EditableZones.js` and `scripts/build-road-corridors.mjs`.
- **`bufferAlongsideRoad`** — outer (30 m) minus inner (4 m road
  inset) so the carriageway stays visible as two ribbons.
- **Mayag fix** — for curvy mountain roads (112+ vertices), `lineOffset`
  folds the inside of tight curves and `buffer(0)` cleanup silently
  shaves ~7% of one side ("only one side filled"). Detection: after
  the offset+stitch, if `buffer(0)` lost ≥ 1% of area, fall back to
  `turf.buffer` with rounded caps for that segment. Trade-off:
  curvy roads get rounded ends; straight roads keep flat caps.
- **Roads layer is `pmIgnore`** so the editor's vertex drag doesn't
  snap onto road centerlines.

---

## 6. Multi-vertex editing tool

New polygon-editing mode that takes over when toggled on.

- **State**: per-vertex selection set keyed by `ringPath|vertexIdx`.
  Supports Polygon, Polygon-with-holes, and MultiPolygon — the
  `ringsFromLatLngs` helper walks the nested array recursively.
- **Custom vertex handles** rendered as L.divIcon markers on a new
  **`vertex-pane`** (z-index 470). Replaces Geoman's default markers
  while the mode is on; Geoman handles return when toggled off.
- **Interactions**:
  - **Click** a handle: solo-select (clears prior selection).
  - **Shift+click**: toggle membership in the selection.
  - **Drag** any selected handle: moves **all** selected vertices by
    the same Δlat/Δlng — snapshots positions on dragstart, applies
    delta on drag, fires `setLatLngs` live.
  - **Right-click** a handle: removes that vertex.
  - **Delete / Backspace** with vertices selected: removes all
    selected. Validates each ring keeps ≥ 3 vertices; silently skips
    deletions that'd degenerate a ring.
- **Panel UI**:
  - *"Vertices: multi"* toggle button.
  - *"Delete N vertices"* button when 1+ are selected.
- **CSS**: `.vertex-handle` (blue ring + white fill default;
  `.is-selected` switches to filled blue with halo).

### Geoman edit config

Changed `allowSelfIntersection: false → true` everywhere
(`setGlobalOptions`, per-layer `pm.enable`, and the multi-vertex
restore branch) — Geoman was silently rejecting vertex moves on
polygons-with-holes (which is what every baked frontage corridor is),
producing the "vertex won't move" symptom.

The bake step also runs `turf.cleanCoords` on the merged polygon to
strip duplicate/colinear vertices so Geoman doesn't skip creating
handles for them.

---

## 7. C-1 hatch styling

The C-1 zone's SVG fill is a single source of truth for both the
consultation overlay and the editor.

- Currently: **translucent red base (`#c63b24` @ 35% opacity) with bold
  red diagonal stripes (95% opacity)**. The translucent base lets OSM
  POIs and place names underneath show through while the saturated
  stripes keep the C-1 corridor recognisable.
- Earlier iterations tried solid red base + white stripes (too opaque,
  buried labels) and a `mix-blend-mode: multiply` duplicate-basemap
  trick to put labels on top (muddied the whole map). Both reverted.
- The sidebar / bottom-bar chip uses a matching `.is-hatch` CSS
  background image at 40% white stripes so it evokes the same look.

---

## 8. POI / landmark labels (kept dormant)

We built a fetcher (`scripts/fetch-osm-landmarks.mjs`) and have data
for 65 named Bauko POIs (52 schools, 5 churches, 5 govt, 2 tourism, 1
hospital) at `public/data/bauko_landmarks.geojson`. The custom rendered
layer (coloured dot + name pill, then emoji icon + halo'd name) was
disabled after testing — it duplicated labels already baked into the
OSM tiles. Data + script kept for future re-enable as an optional
layer.

The active label layer is the CartoDB Voyager Labels transparent tile
overlay — place names + road names + some POI names, no custom
landmark dots.

---

## 9. Editor UX small wins

- **Sidebar chip ring** — when a polygon is selected, the chip matching
  its primary class gets a colored 2 px ring + small dot indicator.
  Secondary/tertiary classes get fainter rings.
- **Panel header** names the selected class: *"Selected: R-3 — click a
  chip to reassign"* instead of just *"Reassign zone"*.
- **Tooltips** on road and band chips include name, highway tag,
  barangay, length — so hover tells you what you're about to bake
  before you click.
- **Clear selection buttons** appear when roads or bands are selected.

---

## 10. Schedule + config — Bontoc

Real 2024 Bontoc SMV schedule wired in (replacing the Bauko-style
placeholder):

- 2 commercial classes (C-1, C-2) + 15 residential classes
  (R-1..R-15) — the deepest residential ladder in any municipality
  currently in the app.
- 16 PSA-confirmed barangays with LGU-spelling aliases
  ("Caluttit"→Calutit, "Guina-ang"→guinaang, "Can-eo"→caneo).
- Classification metadata in `lib/classifications.js` extended with the
  real R-8..R-15 prices (Bontoc-derived defaults).
- `legendEntries()` updated to include all 15 residential tiers.
- JSON snapshot at `public/data/bontoc_smv_schedule.json` mirroring
  the Bauko one.

---

## 11. Bug fixes

- **Vertex drag snapping to road lines** — added `pmIgnore` + `snapIgnore`
  on the parent road `L.geoJSON` group AND every child polyline so
  Geoman's global snap doesn't latch vertices to nearby road centerlines.
- **`flatCapBuffer` accepting only geometry, not Features** — the
  `turf.multiLineString(...)` wrapper returned a Feature, my checks
  expected raw geometry, the function silently returned null and the
  bake quietly produced nothing. Now accepts both.
- **Tree-reduce union** — the `turf.union(featureCollection(all))`
  call could throw on a single degenerate input and we'd silently drop
  N-1 candidates. Switched to pairwise union with per-pair try/catch.

---

## 12. Files added / changed

**New scripts**
- `scripts/build-frontage-bands.mjs`
- `scripts/fetch-osm-landmarks.mjs`
- `scripts/dxf-to-geojson.py` (heavily revised; HATCH extraction, regex
  layer classifier, make_valid bowtie rescue, smart close rule)

**New API route**
- `app/api/zones/import-dxf/route.js`

**New data files** (per municipality, generated from scripts)
- `public/data/<slug>_frontage_bands.geojson`
- `public/data/<slug>_landmarks.geojson`
- `public/data/<slug>_zones_dxf.geojson` (preview slug zones)
- `public/data/bauko_smv_schedule.json`
- `Bauko 2027 SMV Schedule.docx` (workspace root)

**Modified**
- `components/EditableZones.js` — band chip layer, multi-vertex tool,
  bake flow with clip + notice + auto-select, flat-cap + rounded-cap
  fallback buffers, vertex pane, dragless road snap.
- `components/LeafletMap.js` — labels-pane, CartoDB labels overlay,
  frontage bands rendering, hatch pattern, several pane z-indexes.
- `components/MapPanel.js` — frontage bands toggle.
- `app/page.js` — initial `layers.frontageBands: false`.
- `app/globals.css` — vertex handle styles, chip is-hatch tweak.
- `lib/municipalities.js` — frontage bands and landmark file paths,
  Bauko / Sagada DXF preview slugs.
- `lib/classifications.js` — R-8..R-15 entries.
- `lib/bontoc.js` — real 2024 schedule.
- `package.json` — npm scripts for `bands:<slug>` and
  `landmarks:<slug>`.
- `scripts/build-road-corridors.mjs` — flat-cap + rounded fallback
  buffer logic.

---

## 13. How to use the new tools

**Convert a fresh LGU DXF**:
```
npm run dev
# then in browser:
/?m=bauko-dxf   (or any *-dxf slug)
# Editor panel → "Import DXF…" button → pick the .dxf → confirm
```

**Rebuild auxiliary data files**:
```
npm run bands:bauko          # frontage bands
npm run landmarks:bauko      # POI landmarks
npm run zones:auto:bauko     # OSM-corridor auto-zones (offline)
npm run boundaries:fetch:bauko
npm run roads:fetch:bauko
```

**Multi-vertex editing**:
1. Select any zone polygon.
2. Click *"Vertices: multi"* in the editor panel.
3. Click handles to select, Shift+click to add, drag any selected to
   move all, Delete to remove all selected.

**Overlay-aware bake**:
- Default: bake auto-trims against existing zones (avoids overlaps).
- Untick *"Trim against existing"* in the panel to paint over.
- Header flashes a notice when clipping removes ≥ 25% so you know.

---

## 14. Known limitations / followups

- Custom POI rendering is dormant — re-enable if needed as a separate
  toggleable layer.
- Bauko DXF has no C-1 / C-3 layers; needs LGU cartographer to draw
  those before the CAD source is complete.
- `track`-grade roads are out of the frontage bands (matches the
  schedule's all-weather scope). If a barangay road in OSM is mis-tagged
  as `track` when it's actually paved, fix it in OSM (or override
  locally).
- Vertex drag on the road layer is blocked from snapping; if Geoman
  ever moves to a newer version that handles MultiPolygon edge-insert
  differently, the multi-vertex tool may need to adapt.

---

*Last updated: 2026-05-15 (Mountain Province SMV consultation app).*
