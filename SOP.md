# Standard Operating Procedure (SOP)
## SMV Map, Mountain Province Land Valuation Map
**Document Version:** 1.0
**Date:** May 17, 2026
**Repository:** Land Valuation Map (`leaflet-test-app/` + public viewer at `presentation/`)

---

## 1. Purpose

This document describes the current state of the **SMV Map**, the
web-based Schedule of Market Values mapping system for Mountain
Province. It is the companion document to the RPFAAS SOP
(`forms/SOP.md`) and covers everything to do with the map side of
the suite: the public-consultation viewer that citizens see, the
editor that the assessor's office uses to maintain SMV polygons,
and the data pipelines that feed both.

---

## 2. Scope

This SOP applies to all personnel and stakeholders involved with
the SMV Map:

- Provincial Assessor's Office staff (authoring SMV polygons)
- Citizens viewing the map during public consultations
- IT / system administrators managing deploys
- Developers extending the system

It does **not** cover RPFAAS form workflows (see `forms/SOP.md`)
or the wider MPAOMIS system scope (see `forms/SCOPE_OF_WORK.md`).

---

## 3. System Overview

The SMV Map is a two-app system built on the same codebase, served
in two modes:

| Mode | Audience | Path | Use case |
|---|---|---|---|
| Public Viewer | Citizens, LGU partners | `presentation/` | Public consultation, citizen lookup of class + value by parcel location |
| Editor | PAO staff | `leaflet-test-app/` (drawMode on) | Drawing and maintaining SMV polygons, importing DXF/DWG, baking corridors from roads |

### 3.1 Technology Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript / JavaScript |
| UI | React 19 + Tailwind CSS |
| Map engine | Leaflet 1.9 + react-leaflet 5 |
| Drawing & editing | leaflet-geoman |
| Geometry ops | @turf/turf 7 |
| Basemap | OpenStreetMap (online) + offline tile pack fallback |
| Storage | Static GeoJSON files in `public/data/<slug>_*.geojson` |
| Save endpoint | `/api/zones/save` (writes to disk or GitHub Contents API) |
| DXF pipeline | Python + ezdxf + pyproj + Shapely |

### 3.2 Architecture

Per municipality, the system maintains a fixed set of GeoJSON
files under `public/data/`:

```
<slug>.geojson                  Municipal outline (Polygon)
<slug>_barangays.geojson        15-ish PSA barangay boundaries
<slug>_zones.geojson            SMV zones (canonical, hand-curated)
<slug>_zones_dxf.geojson        SMV zones (DXF-derived preview slug)
<slug>_osm_roads.geojson        Per-segment OSM roads
<slug>_frontage_bands.geojson   0-30m / 30-60m depth-of-frontage chips
<slug>_custom_landmarks.geojson LGU-curated POIs (e.g. Kalangeg Bldg)
<slug>_valuations.json          Per-class 2027 figures
```

Each municipality is wired into `lib/municipalities.js` with a
config object pointing at its data files.

### 3.3 Deployment

- **Public viewer (`presentation/`)**: Next.js static export, runs
  from `file://` on a venue laptop or hosted on any static host.
  Currently in beta running for public consultations.
- **Editor (`leaflet-test-app/`)**: Next.js dev or production
  build, requires the save endpoint to be reachable (disk or
  GitHub Contents API).

---

## 4. User Roles

| Role | Access | Primary actions |
|---|---|---|
| Citizen | Public viewer (read-only) | Browse municipalities, hover zones to see class + value, drill into barangay sub-stretches |
| PAO Staff / Tax Mapper | Editor mode | Draw, edit, bake, trim, import DXF, manage landmarks |
| System Administrator | All | Deploy, manage tile packs, configure save endpoint |

---

## 5. Supported Municipalities

All 10 Mountain Province municipalities have at least scaffold
coverage:

| Municipality | Outline | Barangays | Zones | Frontage Bands | Roads | Landmarks |
|---|---|---|---|---|---|---|
| Barlig | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Bauko | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Besao | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Bontoc | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (2 hardcoded) |
| Natonin | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Paracelis | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Sabangan | ✅ | ✅ | empty | ❌ | ❌ | ❌ |
| Sadanga | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Sagada | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Tadian | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |

Each municipality also has a parallel `<slug>-dxf` preview slug
(e.g. `bontoc-dxf`, `sagada-dxf`) for previewing DXF-derived zones
without trampling the canonical zones file.

---

## 6. Public Viewer Capabilities

What citizens see at `presentation/`:

| Capability | Status |
|---|---|
| OpenStreetMap basemap with SMV zones overlaid | ✅ Done |
| Per-class color coding (C-1, C-2, C-3, R-1 through R-15, agri sub-classes) | ✅ Done |
| Per-municipality routing (`/?m=<slug>`) | ✅ Done |
| Top nav with all 10 MP municipalities | ✅ Done |
| Classification panel with commercial / residential split | ✅ Done |
| Per-barangay drilldown sidebar | ✅ Done |
| Per-stretch sub-zones (landmark to landmark) | ✅ Done |
| Saved viewports per stretch | ✅ Done |
| Hover any zone, info card follows cursor with class + barangay + 2027 value | ✅ Done |
| Frontage band overlay (0-30m / 30-60m bands) | ✅ Done |
| Custom landmarks layer (LGU-curated POIs) | ✅ Done |
| Static export (`pnpm build`) for offline venue laptop | ✅ Done |
| Beta running for actual public consultation | ✅ Done |

---

## 7. Editor Capabilities

What PAO staff can do at `leaflet-test-app/` with drawMode on:

### 7.1 Importing existing data

| Capability | Status |
|---|---|
| Import DXF / DWG file via in-app button | ✅ Done |
| PRS92 to WGS84 reprojection | ✅ Done |
| HATCH boundary extraction (2-3x coverage of off-the-shelf converters) | ✅ Done |
| LAYER_TO_CLASS regex classifier (auto-tags by CAD layer name) | ✅ Done |
| Smart polygon close (4+ vertex rule) | ✅ Done |
| Bowtie / self-intersection rescue via `make_valid` | ✅ Done |
| Tested on three real LGU CAD files (Bauko, Bontoc, Sagada) | ✅ Done |

### 7.2 Drawing zones

| Capability | Status |
|---|---|
| Polygon draw via Geoman | ✅ Done |
| Snap to existing edges (20px snap distance, toggleable) | ✅ Done |
| Snap to segment midpoints | ✅ Done |
| Bake from selected OSM road segments (flat-cap buffer) | ✅ Done |
| Bake from selected frontage band chips (0-30m / 30-60m) | ✅ Done |
| Auto-trim against existing zones (toggleable) | ✅ Done |
| Auto-carve road centerline out of new corridors | ✅ Done |
| Auto-clean sliver fragments (compactness filter) | ✅ Done |

### 7.3 Editing zones

| Capability | Status |
|---|---|
| Cut tool that inherits source class | ✅ Done |
| Split MultiPolygon into separate polygons | ✅ Done |
| Clean geometry (unkink + drop slivers) | ✅ Done |
| Trim overlaps (subtract neighbours from selected) | ✅ Done |
| Multi-vertex select / move / delete | ✅ Done |
| Assign secondary and tertiary class to a zone | ✅ Done |
| Undo / Redo with Cmd+Z / Cmd+Y | ✅ Done |

### 7.4 Custom landmarks

| Capability | Status |
|---|---|
| `+ Landmark` click-to-place tool | ✅ Done |
| Multi-stretch link per landmark | ✅ Done |
| Drag-to-move existing pin | ✅ Done |
| Click pin for edit / delete popup | ✅ Done |
| Auto-link new landmark to active sidebar stretch | ✅ Done |

### 7.5 Saving and persistence

| Capability | Status |
|---|---|
| Save endpoint `/api/zones/save` (writes to disk in dev) | ✅ Done |
| GitHub Contents API save for production deploys | ✅ Done |
| Per-LGU save password gate | ⚠️ Documented in MPAOMIS SOW; needs implementation |
| Export GeoJSON file from editor | ✅ Done |

---

## 8. Data Pipelines (CLI Scripts)

Scripts under `scripts/`:

| Script | Purpose |
|---|---|
| `dxf-to-geojson.py` | Convert a `.dxf` file to `<slug>_zones_dxf.geojson` with PRS92 reprojection, HATCH extraction, and layer-name classification |
| `build-frontage-bands.mjs` | Generate `<slug>_frontage_bands.geojson` from OSM roads (per-segment 0-30m + 30-60m chips, road centerline carved out) |
| `build-road-corridors.mjs` | Mirror of the in-app bake pipeline for offline corridor generation |
| `carve-roads-out-of-zones.mjs` | One-time cleanup that subtracts road centerline buffer from every existing zone |
| `fetch-osm-landmarks.mjs` | Pull OSM POIs (kept, not currently rendered) |

Each script takes a slug as its main argument:
```
node scripts/build-frontage-bands.mjs tadian
python scripts/dxf-to-geojson.py bontoc.dxf bontoc
node scripts/carve-roads-out-of-zones.mjs sagada
```

---

## 9. Adding a New Municipality

The repeatable flow (most recently exercised on Sabangan):

1. **Fetch barangay boundaries from PSA GeoRiskPH** ArcGIS service.
   Normalize properties to match the Tadian shape. Save to
   `public/data/<slug>_barangays.geojson`.
2. **Extract municipal outline** from
   `mountain_province_municipalities.geojson` by `name` filter.
   Save to `public/data/<slug>.geojson`.
3. **Write `lib/<slug>.js`** with `<SLUG>_BARANGAYS` and
   `<SLUG>_CLASSIFICATIONS` (mirror `lib/tadian.js` shape).
4. **Register in `lib/municipalities.js`**: add to
   `BASE_MUNICIPALITIES`, add `<SLUG>_CONFIG`, add to
   `CONFIG_BY_SLUG`. Also add the `<slug>-dxf` preview variant.
5. **Whitelist in `/api/zones/save/route.js`** and
   `/api/zones/import-dxf/route.js`.
6. **Create starter files**: empty
   `<slug>_zones.geojson` (`{"type":"FeatureCollection","features":[]}`),
   placeholder `<slug>_valuations.json`.
7. **Optionally** run `npm run osm:<slug>` and
   `npm run bands:<slug>` to generate the OSM roads + frontage
   band overlays.
8. **Optionally** import a DXF via the in-app button or
   `dxf-to-geojson.py` script.

---

## 10. Class Schema

Per `lib/classifications.js`, the system supports:

| Tier | Classes | Source |
|---|---|---|
| Commercial | C-1, C-2, C-3, C-4 | Standard BLGF schedule |
| Residential | R-1 through R-15 | Standard up to R-7; R-8 to R-15 added for Bontoc |
| Special | UNCLASSIFIED | Catch-all for unmapped areas |

Each class carries: hex color, label, category, and 2027 base unit
market value. Adding a new class requires editing
`CLASSIFICATION_INFO` and matching CSS rules in
`app/globals.css`.

---

## 11. Workflow: Public Consultation

Standard public consultation procedure with the SMV Map:

```
1. PAO publishes the proposed SMV schedule for a given municipality
   (paper or PDF, per the LGU Code)
         |
         v
2. SMV polygons authored / updated in the editor
   (drawn, baked from roads / bands, or imported from DXF)
         |
         v
3. Editor saves to <slug>_zones.geojson
   (in dev: written to disk; in prod: committed to GitHub via Contents API)
         |
         v
4. Public viewer (presentation/) rebuilt and re-deployed
   (pnpm build produces a fresh out/ folder)
         |
         v
5. Citizens browse the map during consultation sessions
   (web access for hybrid sessions; offline static export on venue laptops)
         |
         v
6. Feedback captured by PAO staff
         |
         v
7. Loop back to step 2 if revisions are needed
```

---

## 12. Workflow: SMV Map Authoring

How a PAO staffer maintains an LGU's SMV map:

```
Open the editor at /?m=<slug>
         |
         v
Turn on drawMode
         |
         v
Choose: draw fresh polygons, bake from selected roads / bands, or import DXF
         |
         v
Set active class chip (C-1, C-2, R-3, etc.)
         |
         v
Draw / select / bake the polygon
         |
         v
Auto-trim, auto-carve, auto-clean apply per toggles
         |
         v
(Optional) Add secondary / tertiary class, link landmarks
         |
         v
Save -> writes to <slug>_zones.geojson via /api/zones/save
         |
         v
Public viewer picks up the change on next reload
```

---

## 13. Key Routes & Files

| File / Route | Purpose |
|---|---|
| `app/page.js` | Main viewer page, handles municipality selection via `?m=<slug>` |
| `components/LeafletMap.js` | Main map container, layers, panes, tile sources, hover info card |
| `components/EditableZones.js` | Editor toolbar, draw / bake / edit logic, landmark editor |
| `components/ZoneHoverInfo.js` | Hover info card following the cursor over zones |
| `components/LandmarkAddForm.js` | Modal form for adding / editing landmarks |
| `components/Sidebar.js` | Class / barangay / stretch drilldown sidebar |
| `components/MapPanel.js` | Layers panel (collapsible toggle for outline, barangays, zones, smv, frontage bands) |
| `lib/municipalities.js` | Municipality config registry |
| `lib/classifications.js` | Class colors, labels, 2027 values |
| `lib/<slug>.js` | Per-municipality barangays + schedule |
| `app/api/zones/save/route.js` | Save endpoint (disk in dev, GitHub Contents API in prod) |
| `app/api/zones/import-dxf/route.js` | DXF import endpoint |

---

## 14. Current System Status

### Done

- Public viewer with all 10 MP municipalities rendering, beta in use for public consultation
- Editor with full draw / bake / edit toolset
- DXF import pipeline tested on 3 real LGU CAD files
- 4 LGUs with full SMV polygon coverage (Bauko, Bontoc, Sagada, Tadian)
- Frontage bands generated for Bauko, Sagada, Tadian
- OSM roads for Bauko, Bontoc, Sagada, Tadian
- Save flow to disk (dev) and GitHub (prod)
- Per-municipality DXF preview slugs to test imports without trampling canonical data

### Partial

- Sabangan scaffolded but zones empty
- Bontoc custom landmarks: 2 hardcoded (Kalangeg, Bontoc Circle); MPGCHS and CHICO/EDNP removed pending re-add via UI
- Per-LGU save password gate documented but not yet wired

### Missing

- 5 of 10 MP municipalities (Besao, Natonin, Paracelis, Sadanga, plus Sabangan's zones) have no SMV data
- 5 of 6 CAR provinces have no coverage at all (Abra, Apayao, Benguet, Ifugao, Kalinga)
- Integration with the RPFAAS forms app (MPAOMIS §7.6.2 GIS Map Integration) not yet built
- Mobile / PWA mode not yet built

---

## 15. Known Issues & Gotchas

- **`pmIgnore` on roads/bands**: when drawing or dragging vertices near a road or frontage band, Geoman would try to snap to the centerline and produce weird shapes. Roads and bands now carry `pmIgnore: true` and `snapIgnore: true` to prevent this.
- **Compactness filter for slivers**: cut and bake operations occasionally produce thin strip slivers (compactness < 0.10). The `isSliverPolygon` check auto-filters these in cut and bake flows.
- **Curvy roads + `buffer(0)`**: turf's `buffer(0)` cleanup can shave 7% off one side of a 100+ vertex curvy road. Mayag specifically. The fallback path uses rounded-cap buffer when area loss > 1%.
- **localStorage migration**: in-app landmarks created before `id` was added to the property bag silently failed to delete. Load function backfills `id` on first read.
- **Snap distance**: was 8px (too tight), bumped to 20px. Snap to edges toggle (default on) lets the user disable when not desired.

---

## 16. Future Improvements

### Short-Term

| Item | Description |
|---|---|
| Complete Mountain Province coverage | Build SMV data for Sabangan, Besao, Natonin, Paracelis, Sadanga |
| Per-LGU save password gate | Lock save endpoint per LGU slug so editors can only modify their own municipality |
| New SMV values ingest | Load LGU-supplied 2027 updates once they arrive |

### Medium-Term

| Item | Description |
|---|---|
| Cordillera expansion | Scaffold + build for Abra, Apayao, Benguet, Ifugao, Kalinga (5 provinces) |
| RPFAAS integration | Forms-to-SMV picker on Land FAAS step 1; auto-fill market value from polygon at parcel location |
| Public viewer Leaflet migration | Move `presentation/` from PNG-stack to real Leaflet rendering, sharing the codebase with the editor |
| Editor mode unlock per LGU | Once an LGU is a paying customer, their PAO gets editor access to maintain their own SMV map |

### Long-Term

| Item | Description |
|---|---|
| Open source release of the viewer | Defensibility move, encourages academic + civic-tech adoption |
| Provincial dashboard tier | Cross-LGU aggregate views for Provincial Assessors |
| Mobile PWA for field surveys | Tax Mappers can pin parcels on phones while in the field |
| BLGF integration | Once the BLGF RPVARA central system arrives, position as the editor layer feeding their central database |

---

## 17. Glossary

| Term | Definition |
|---|---|
| SMV | Schedule of Market Values, the per-class land valuation table every LGU is required to maintain |
| Stretch | Landmark-to-landmark sub-zone within a class + barangay (e.g. "Circle to Kalangeg building") |
| Frontage band | Depth-of-frontage strip along a road centerline (0-30m, 30-60m, 60m+); pre-computed per-segment chips |
| PRS92 | Philippine Reference System 1992, the local coordinate system most LGU cadastral data uses |
| DXF / DWG | AutoCAD file formats common for LGU land value maps |
| HATCH | DXF entity type representing a filled region; used here to extract zone boundaries that LWPOLYLINE alone misses |
| LWPOLYLINE | DXF entity type for lightweight polylines; the standard polygon representation |
| OSM | OpenStreetMap, the basemap source |
| Geoman | leaflet-geoman, the Leaflet drawing and editing plugin |
| Bake | Convert a road segment selection or frontage band chip selection into a corridor polygon zone |
| PAO | Provincial Assessor's Office |
| LGU | Local Government Unit (municipality or city) |
| MPAOMIS | Mountain Province Assessor's Office Management Information System, the parent project |

---

*This document should be updated whenever new map capabilities ship, a new municipality is added, or the data pipeline changes meaningfully.*
