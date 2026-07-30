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

The exporter requires the same Python GIS tools used by the DXF importer:

```bash
pip install ezdxf pyproj shapely
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

## Map data refresh commands

Fetch OSM roads, landmarks, places, water, or buildings:

```bash
npm run roads:fetch:bontoc
npm run landmarks:bontoc
npm run places:fetch:bontoc
npm run water:fetch:bontoc
```

Fetch Google Places POIs into the app's visible landmark overlay
(`public/data/<slug>_landmarks.geojson`). This gives denser Google-like POI
coverage than OSM. It does not touch `*_custom_landmarks.geojson`.

```bash
npm run landmarks:google -- besao
npm run landmarks:google -- besao --barangay "Kin-iway"
npm run landmarks:google -- besao --text-sweep
npm run landmarks:google:bontoc
```

The Google command needs `GOOGLE_MAPS_API_KEY` or
`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` with Places API (New) enabled. Use
`--text-sweep` adds extra Text Search requests for small stores, eateries,
water refilling stations, government offices, schools, churches, etc. Use
`--dry-run` to see the planned request count before spending API calls:

```bash
npm run landmarks:google -- besao --text-sweep --dry-run
```

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
