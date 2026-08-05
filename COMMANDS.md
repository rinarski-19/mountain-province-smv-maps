# Project Commands

Run these commands from the project root:

```bash
cd /Users/rinar/Documents/Claude/Projects/Maps/leaflet-test-app
```

## Start the app

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Production verification:

```bash
npm run build
npm run start
```

## Print SVG exports

Build one whole-municipality A3 SVG:

```bash
npm run print:svg:bontoc
```

Other municipalities use the same pattern:

```bash
npm run print:svg:bauko
npm run print:svg:barlig
npm run print:svg:besao
npm run print:svg:natonin
npm run print:svg:paracelis
npm run print:svg:sabangan
npm run print:svg:sadanga
npm run print:svg:sagada
npm run print:svg:tadian
```

Build every municipality:

```bash
npm run print:svg:all
```

Build one barangay or every barangay for a municipality:

```bash
node scripts/build-print-svg.mjs bontoc poblacion
node scripts/build-print-svg.mjs bontoc all
```

Open a municipality web map:

```text
http://localhost:3000/
http://localhost:3000/?m=paracelis
http://localhost:3000/?m=natonin
http://localhost:3000/?m=sadanga
http://localhost:3000/?m=sabangan
```

Open a print SVG with building footprints enabled:

```text
http://localhost:3000/api/print/svg/portrait/sabangan/capinitan?buildings=1
http://localhost:3000/api/print/svg/landscape/sabangan/capinitan?buildings=1
http://localhost:3000/api/print/svg/bauko/abatan?buildings=1
http://localhost:3000/api/print/svg/bauko?buildings=1
http://localhost:3000/api/print/svg/barlig/kaleo?buildings=1
http://localhost:3000/api/print/svg/barlig?buildings=1
http://localhost:3000/api/print/svg/paracelis/poblacion?buildings=1
http://localhost:3000/api/print/svg/paracelis?buildings=1
http://localhost:3000/api/print/svg/natonin/poblacion?buildings=1
http://localhost:3000/api/print/svg/natonin?buildings=1
http://localhost:3000/api/print/svg/sadanga/sadanga?buildings=1
http://localhost:3000/api/print/svg/sadanga?buildings=1
http://localhost:3000/api/print/svg/sabangan/poblacion?buildings=1
http://localhost:3000/api/print/svg/sabangan?buildings=1
```

Show the optional locations legend. It is off by default:

```text
http://localhost:3000/api/print/svg/portrait/sabangan/capinitan?locations=1
http://localhost:3000/api/print/svg/landscape/sabangan/capinitan?locations=1
```

Turn building footprints off again:

```text
http://localhost:3000/api/print/svg/portrait/sabangan/capinitan?buildings=0
http://localhost:3000/api/print/svg/bauko/abatan?buildings=0
http://localhost:3000/api/print/svg/barlig/kaleo?buildings=0
http://localhost:3000/api/print/svg/paracelis/poblacion?buildings=0
http://localhost:3000/api/print/svg/natonin/poblacion?buildings=0
http://localhost:3000/api/print/svg/sadanga/sadanga?buildings=0
http://localhost:3000/api/print/svg/sabangan/poblacion?buildings=0
```

Fetch Overture building footprints first if the print/web map
does not have building data yet:

```bash
npm run buildings:overture:bauko
npm run buildings:overture:paracelis
npm run buildings:overture:natonin
npm run buildings:overture:sadanga
npm run buildings:overture:sabangan
npm run buildings:overture:sagada
npm run buildings:overture:tadian
```

If Overture/AWS times out on one barangay, retry with a longer retry count:

```bash
npm run buildings:overture -- tadian --by-barangay --retries=8
```

If one barangay keeps failing and you still want a partial output file:

```bash
npm run buildings:overture -- tadian --by-barangay --retries=8 --skip-failed
```

The generated files are written under `public/print/` and are ignored by
Git. Use a browser, Inkscape, or Illustrator to preview the SVG.

To make an Illustrator-safe raster image, install Inkscape and run:

```bash
npm run print:svg:bontoc
npm run print:png -- bontoc exports/bontoc_print.png --dpi=600
```

The SVG remains the editable source. The PNG contains the final rendered
labels as pixels, so Illustrator will not reinterpret the fonts or SVG text.
Use `INKSCAPE_BIN` when Inkscape is not available on the system PATH:

```powershell
$env:INKSCAPE_BIN = "C:\Program Files\Inkscape\bin\inkscape.exe"
npm run print:png -- bontoc exports\bontoc_print.png --dpi=600
```

## DXF export

Export the current GeoJSON map data to an editable AutoCAD DXF. The default
coordinate system is PRS92 / Philippines Zone III (`EPSG:3123`):

```bash
mkdir -p exports
npm run export:dxf -- bontoc exports/bontoc_smv_map.dxf
```

The DXF contains separate layers for SMV classes, parcels, roads, barangay
boundaries, municipal boundary, and labels. To export geometry without fills
or labels:

```bash
npm run export:dxf -- bontoc exports/bontoc_lines_only.dxf --no-hatches --no-labels
```

To export only parcels that have a lot-number label or a `C-1` / `C-2` label
inside them, first create a filtered parcel file, then pass it to the DXF
exporter:

```bash
python3 scripts/filter-parcels-by-dxf-labels.py \
  public/data/bauko_parcels.geojson \
  "/Users/rinar/Downloads/Bauko projection map 2023.dxf" \
  exports/bauko_labelled_parcels.geojson

npm run export:dxf -- bauko exports/bauko_labelled_parcels.dxf \
  --parcels-file exports/bauko_labelled_parcels.geojson \
  --no-labels
```

The exporter requires the same Python GIS tools used by the DXF importer:

```bash
pip install ezdxf pyproj shapely
```

Remove river lines from a source DXF without changing the original file:

```bash
python3 scripts/remove-dxf-layers.py \
  "/Users/rinar/Downloads/Bauko projection map 2023.dxf" \
  exports/bauko_projection_map_2023_no_rivers.dxf \
  --layer creek \
  --layer RIVER
```

## Bontoc parcel import

Convert the exact closed parcel polylines from the Bontoc DXF into WGS84
GeoJSON for the web map and print exporter:

```bash
python3 scripts/dxf-parcels-to-geojson.py \
  "/Users/rinar/Documents/Claude/Projects/Maps/BONTOC MAP PROJECTION.dxf" \
  public/data/bontoc_parcels.geojson \
  --layer "declared property" \
  --closed-only \
  --clip-to public/data/bontoc.geojson
```

For Barlig, the 2023 projection stores parcel linework across three layers.
The command below selects all three layers while ignoring text and labels:

```bash
python3 scripts/dxf-parcels-to-geojson.py \
  "/Users/rinar/Downloads/barlig map projection 2023.dxf" \
  public/data/barlig_parcels.geojson \
  --layer "MPV LOTS" \
  --layer "DECLARED  PROPERTY" \
  --layer "declared property" \
  --closed-only \
  --clip-to public/data/barlig.geojson
```

For Bauko, the parcel drawing uses several layers, including the misspelled
`declcared property` layer:

```bash
python3 scripts/dxf-parcels-to-geojson.py \
  "/Users/rinar/Downloads/Bauko projection map 2023.dxf" \
  public/data/bauko_parcels.geojson \
  --layer "MPV LOTS" \
  --layer "declared property" \
  --layer "UNDECLARED" \
  --layer "FLOT" \
  --layer "FORPROJECTION" \
  --layer "0" \
  --layer "200" \
  --layer "LOT Lines" \
  --layer "bdry" \
  --polygonize-layer "declcared property" \
  --polygonize-layer "0" \
  --polygonize-layer "200" \
  --polygonize-layer "LOT Lines" \
  --polygonize-layer "FLOT" \
  --line-layer "0" \
  --line-layer "declared property" \
  --closed-only \
  --clip-to public/data/bauko_dxf_municipality.geojson  # DXF MBM clip used for parcels
```

To keep Bauko parcel data synchronized while editing the DXF in AutoCAD:

```bash
npm run parcels:watch:bauko
```

The watcher uses `/Users/rinar/Documents/shared/projection/Bauko projection
map 2023.dxf` on macOS and `Z:\projection\Bauko projection map 2023.dxf` on
Windows by default. You can also pass the Windows path explicitly:

```powershell
node scripts/watch-dxf-parcels.mjs bauko --dxf "Z:\projection\Bauko projection map 2023.dxf"
```

The watcher uses the selected parcel-layer profile shown above. It preserves
the green `bdry` lot shapes and open linework from Layer `0` and `declared
property`. BBM, MBM, river, text, and administrative boundary layers are not
selected. It updates `public/data/bauko_parcels.geojson` and the labelled
parcel export after each save. It does not create a final DXF automatically.

## Map data refresh commands

Fetch OSM roads, landmarks, places, water, or buildings:

```bash
npm run roads:fetch:bontoc
npm run landmarks:bontoc
npm run landmarks:osm -- bontoc
npm run places:fetch:bontoc
npm run water:fetch:bontoc
```

`landmarks:bontoc` and `landmarks:osm -- bontoc` fetch the filtered OSM
landmark snapshot to `public/data/bontoc_osm_landmarks.geojson`. The app and
print builder prefer this OSM snapshot; the older Google file remains as a
fallback until an OSM snapshot is fetched.

Fetch Google Places POIs into the app's visible landmark overlay
(`public/data/<slug>_landmarks.geojson`). This gives denser Google-like POI
coverage than OSM. It does not touch `*_custom_landmarks.geojson`.

```bash
npm run landmarks:google -- besao
npm run landmarks:google -- besao --barangay "Kin-iway"
npm run landmarks:google -- besao --text-sweep
npm run landmarks:google:bontoc
npm run landmarks:google:all -- --text-sweep
```

The Google command needs `GOOGLE_MAPS_API_KEY` or
`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` with Places API (New) enabled.
`--text-sweep` adds extra Text Search requests for small stores, eateries,
water refilling stations, government offices, schools, churches, etc. Use
`--dry-run` to see the planned request count before spending API calls:

```bash
npm run landmarks:google -- besao --text-sweep --dry-run
npm run landmarks:google:all -- --text-sweep --dry-run
```

`landmarks:google:all` refreshes the public municipality slugs only
(no DXF previews and no Bauko print profile). Add `--continue-on-error`
if you want it to keep going when one municipality hits a network/API error.

Fetch Overture building footprints. Barlig uses the safer per-barangay mode
because the whole-municipality download can be too large/slow:

```bash
npm run buildings:overture:bauko
npm run buildings:overture:barlig
npm run buildings:overture:paracelis
npm run buildings:overture:natonin
npm run buildings:overture:sadanga
npm run buildings:overture:sabangan
npm run buildings:overture:sagada
npm run buildings:overture:tadian
```

For any other municipality slug, run the generic command:

```bash
npm run buildings:overture -- besao
npm run buildings:overture -- barlig --by-barangay
```

Network download options:

```bash
npm run buildings:overture -- tadian --by-barangay --retries=8
npm run buildings:overture -- tadian --by-barangay --retries=8 --skip-failed
```

Regenerate frontage bands or automatically generated road corridors:

```bash
npm run bands:bontoc
npm run zones:auto:bontoc
```

The same command pattern works for the other municipality slugs.

## Git commands

Check changes:

```bash
git status
git diff --check
```

Commit selected changes:

```bash
git add COMMANDS.md .gitignore package.json scripts/export-map-to-dxf.py
git commit -m "Add map export commands and DXF exporter"
```

Check the configured remote before pushing:

```bash
git remote -v
git push origin main
```
