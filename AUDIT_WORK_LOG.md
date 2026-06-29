# Audit Work Log - Mountain Province SMV Maps

Generated from the local repository on 2026-06-26 in Asia/Manila time.

This log reconstructs when work appears to have happened based on repository evidence. It does not alter commit dates or GitHub timestamps. It separates strong evidence, such as Git commits and reflog entries, from weaker supporting evidence, such as local file modification times.

## Evidence Sources

- Git commit history: `git log --all --date=iso-strict`
- Local Git reflog: `git reflog --date=iso-strict`
- Current working tree: `git status --short`, `git diff --shortstat`
- Local file modification times for currently changed files: `git ls-files -m -o --exclude-standard -z | xargs -0 stat ...`
- Remote checked locally: `origin` points to `https://github.com/RinarCOTO/mountain-province-smv-maps.git`

## Important Audit Notes

- The current local branch is `main` and tracks `origin/main`.
- The current remote-tracking HEAD is commit `25edefb` from 2026-06-18 14:24 +0800.
- Git commit dates are good evidence that work was committed locally, but they are not the same as GitHub push dates.
- GitHub push times should be confirmed from GitHub if the audit needs exact upload/push timing.
- Local file modification times support continued local work after the last pushed commit, but they are weaker than Git history because local mtimes can change when files are copied, generated, or rebuilt.

## Plain-English Version for Reviewers

This project was not worked on only when it was pushed to GitHub. A push is just the upload step. Much of the work was done locally on the computer first: drawing and correcting map shapes, editing municipality boundaries/zones, adding roads/water/building data, adjusting the map interface, saving map views, and generating printable map files.

In simple terms:

- **Committed work** means a saved project checkpoint exists in Git.
- **Unpushed local work** means the files were edited on the computer but were not uploaded to GitHub yet.
- **File timestamps** show when local files were last edited or generated.
- **Print SVG files** are printable map outputs.
- **GeoJSON files** are map/vector data files. Editing these usually means editing shapes, zones, roads, water, landmarks, or other map layers.

## Plain-English Work Diary

| Date | What the work looked like in normal terms | Evidence type |
| --- | --- | --- |
| 2026-05-07 | Started with raw Bauko mapping data. This looks like source map/data preparation before the app was fully organized in Git. | Local file timestamp |
| 2026-05-09 | Built the first batch of base map files: Mountain Province boundaries, Bauko barangay data, custom Bauko map data, and helper scripts for converting/merging map files. | Local file timestamps |
| 2026-05-10 | Added more municipality data, especially Barlig and Tadian, plus valuation files and validation/import helper scripts. | Local file timestamps |
| 2026-05-11 | Added Sagada base data and Bauko road/highlight files. This appears to be map-layer setup and road reference work. | Local file timestamps |
| 2026-05-12 | Generated or edited Bauko zone data. This is the kind of vector/map-zone work used by the interactive editor. | Local file timestamp |
| 2026-05-13 | Created the first major app version, added the save-to-project feature, added OSM roads for Barlig/Tadian/Sagada, and worked heavily on Sagada map zones. Many saves show Sagada zone features increasing from 46 to 88, which indicates repeated vector/zone editing on the map. Also fixed editor behavior such as selecting roads and opening/closing sidebar classes. | Git commits |
| 2026-05-14 | Prepared Bontoc map data, Bontoc roads, valuation scripts, Bauko schedule data, and Sagada DXF/zone import data. | Local file timestamps |
| 2026-05-15 | Improved the map editing workflow, DXF import/save tools, Bontoc data, frontage bands, multi-point editing tools, and road-corridor generation. This was a major app/tooling workday. | Git commits and file timestamps |
| 2026-05-16 | Added the script for downloading all offline tiles. This supports offline map use. | Local file timestamp |
| 2026-05-17 | Refined the editing interface, added smart offline tile downloading, added Bontoc landmarks and schedules, added hover details, carved roads out of zone shapes, and updated Tadian data. This includes both app interface work and map/vector editing. | Git commits and file timestamps |
| 2026-05-18 | Continued offline/local app packaging: tile download scripts, Bauko landmarks, static build helper, and local launcher files. | Local file timestamps |
| 2026-05-21 | Continued map data expansion, including Bontoc DXF zones and Sabangan roads/zones/frontage data. | Local file timestamps |
| 2026-05-23 | Added Besao map data, roads, frontage bands, zone auto data, plus Barlig roads/frontage/zones. | Local file timestamps |
| 2026-05-24 | Added Sadanga, Natonin, and Paracelis data; added roads, frontage bands, DXF/saved-view files, and scripts for buildings, landmarks, PSA boundaries, and road corridors. | Local file timestamps |
| 2026-05-26 | Added Sadanga DXF saved-view data. | Local file timestamp |
| 2026-06-01 | Committed a large batch of municipality mapping data and offline consultation tools. This likely collected work from the prior local-data days into one Git checkpoint. | Git commit |
| 2026-06-08 to 2026-06-17 | The local app appears to have been opened/tested on several days, based mainly on development-cache timestamps. This supports local activity, but it is weaker evidence than source-file changes. | Weak local app-run evidence |
| 2026-06-18 | Added the municipality mapping editor and print system, saved Bauko map views, added print APIs, saved-view APIs, OSM water/building/place data, and print SVG outputs. After the Git checkpoint, local edits also continued on Barlig/Natonin files and UI components. | Git commits and local file timestamps |
| 2026-06-19 | Continued unpushed local work. Added roads-save API, water layers for multiple municipalities, Natonin/Sagada valuation and zone data, Sagada print roads, print SVG generation, and Sabangan inner-zone helper work. This is a strong local-work day even though it was not pushed. | Local working-tree timestamps |
| 2026-06-22 | Continued unpushed local work on Paracelis, Sadanga, and Sagada: valuations, saved map views, DXF-related zone data, and municipality configuration files. | Local working-tree timestamps |
| 2026-06-23 | Continued unpushed local work across many municipalities: Barlig, Bauko, Besao, Bontoc, Sabangan, Tadian, classifications, editable zones, print-map builder, saved views, valuation files, zone files, and multiple print SVG outputs. | Local working-tree timestamps |
| 2026-06-26 | Continued print-output work for Bontoc, Paracelis, and Barlig print SVG files. | Local working-tree timestamps |

## Short Explanation to Give the Auditor

I did not push to GitHub every day. I worked locally on the app and map data over many sessions, then saved/uploaded larger batches later. The local repository shows both committed checkpoints and unpushed local file changes.

The work included editing vector map zones directly, updating municipality data, adding roads/water/building layers, adding valuation files, saving map views, improving the editor UI, adding offline-map support, and generating printable maps. GitHub may only show some upload/checkpoint dates, but the local project files show work continued on additional days before those changes were pushed.

## Approximate Local Time Windows

These are not time-clock records. They are the visible work windows suggested by commits and/or local file timestamps. All times are Asia/Manila.

| Date | Visible work window | Plain meaning |
| --- | --- | --- |
| 2026-05-07 | Around 18:30 | Raw Bauko source data existed/was prepared. |
| 2026-05-09 | Around 11:00 to 22:47 | Base map data conversion and Bauko setup work. |
| 2026-05-10 | Around 00:46 to 01:12 | Late-night/early-morning setup for Barlig and Tadian data. |
| 2026-05-11 | Around 09:07 to 14:39 | Sagada base data and Bauko road/highlight work. |
| 2026-05-12 | Around 10:30 | Bauko zone/vector data generation or edit. |
| 2026-05-13 | Around 09:11 to 16:28 | Major app build and repeated Sagada vector/zone editing. |
| 2026-05-14 | Around 09:05 to 21:30 | Bontoc, Bauko schedule, and Sagada DXF/zone prep. |
| 2026-05-15 | Around 13:08 to 23:25 | Major map editor, frontage-band, DXF, and road-corridor work. |
| 2026-05-16 | Around 22:53 | Offline tile download script work. |
| 2026-05-17 | Around 01:52 to 19:19 | Editor refinement, Bontoc landmarks, road carving, Tadian updates. |
| 2026-05-18 | Around 01:08 to 07:08 | Offline/local packaging, tile scripts, Bauko landmarks, static build. |
| 2026-05-21 | Around 06:27 to 23:57 | Bontoc and Sabangan map data work. |
| 2026-05-23 | Around 17:14 to 23:02 | Besao and Barlig map data expansion. |
| 2026-05-24 | Around 08:24 to 14:26 | Sadanga, Natonin, Paracelis, DXF/saved-view, and script work. |
| 2026-05-26 | Around 10:36 | Sadanga DXF saved-view data. |
| 2026-06-01 | Around 08:01 to 10:33 | Large committed checkpoint plus Natonin DXF saved-view data. |
| 2026-06-18 | Around 14:11 to 16:13 | Mapping editor, print system, saved views, Barlig/Natonin/UI follow-up edits. |
| 2026-06-19 | Around 09:17 to 16:03 | Unpushed work on roads, water layers, valuations, zones, print maps, and UI. |
| 2026-06-22 | Around 10:50 to 17:17 | Unpushed Paracelis, Sadanga, Sagada saved-view/zone/valuation work. |
| 2026-06-23 | Around 07:01 to 18:22 | Unpushed work across Barlig, Bauko, Besao, Bontoc, Sabangan, Tadian, and print outputs. |
| 2026-06-26 | Around 09:14 to 11:03 | Recent unpushed print-output work. |

## Summary Timeline

| Date | Evidence strength | Time window / signal | Work reconstructed |
| --- | --- | --- | --- |
| 2026-05-07 to 2026-05-12 | Supporting local file evidence | Local raw/data/source mtimes before first commit | Early data preparation for Bauko and base map assets appears to have started before the first Git commit. Treat as prep evidence, not committed work evidence. |
| 2026-05-13 | Strong Git evidence | 09:11 to 16:28 +0800 | Initial app commit, GitHub-backed save API, OSM roads for Barlig/Tadian/Sagada, Sagada zone work, class list/editor updates, sidebar/road selection fixes. |
| 2026-05-15 | Strong Git evidence | 13:08 to 23:25 +0800 | Major editing workflow improvements, DXF import/save work, Bontoc data and valuations, frontage bands, multi-vertex tooling, bake flow improvements, merge from remote. |
| 2026-05-17 | Strong Git evidence | 01:52 to 19:19 +0800 | SMV editing UI refinement, offline tile download workflow, Bontoc landmarks, schedules, hover details, road-carving script, Tadian zone/data updates. |
| 2026-05-18 | Supporting local file evidence | Around 00:34 to 07:08 +0800 | Offline tiles and local launcher/build helper files show local app packaging or offline-use work. |
| 2026-05-21 to 2026-05-24 | Supporting local file evidence, later committed on 2026-06-01 | Multiple data mtimes across Barlig, Besao, Natonin, Paracelis, Sadanga, Sabangan | Municipality expansion and data-generation work appears to have continued locally before being committed in the June 1 large commit. |
| 2026-06-01 | Strong Git evidence | Commit at 08:01 +0800; local app activity continues later that day | Large expansion of municipality mapping data and offline consultation tools. Commit touched 87 files with 159,689 insertions and 329 deletions. |
| 2026-06-08 to 2026-06-17 | Weak supporting local evidence | Dev cache mtimes only | Local app appears to have been run/tested on multiple days. Because this is mostly `.next` cache evidence, use only as supporting context. |
| 2026-06-18 | Strong Git evidence plus supporting local evidence | Git commits/rebase 14:11 to 14:24 +0800; local changes after 14:57 | Bauko save updates, municipality mapping editor, print system, APIs, saved views, print SVGs, OSM water/buildings/places data. Reflog shows local commits followed by rebases against `origin/main`. |
| 2026-06-19 | Supporting local working-tree evidence | 09:17 to 16:03 +0800 | Continued uncommitted local work: roads save API, water GeoJSON files for multiple municipalities, print roads, Sagada/Natonin values, print SVG generation, Sabangan inner-zone helper. |
| 2026-06-22 | Supporting local working-tree evidence | 10:50 to 17:17 +0800 | Continued uncommitted local work on Paracelis, Sadanga, Sagada saved views, valuations, zones, and DXF-related data. |
| 2026-06-23 | Supporting local working-tree evidence | 07:01 to 18:22 +0800 | Continued uncommitted local work across Barlig, Bauko, Besao, Bontoc, Sabangan, Tadian, classifications, print builder, saved views, valuations, zones, and print SVG outputs. |
| 2026-06-26 | Supporting local working-tree evidence | 09:14 to 11:03 +0800 | Recent print SVG output changes are present locally, including Bontoc and Paracelis print SVG files. |

## Confirmed Commit Log

All times below are from Git commit metadata as stored locally.

| Commit | Date/time | Author | Subject | Scope |
| --- | --- | --- | --- | --- |
| `3f5a0c5` | 2026-05-13 09:11 +0800 | Rinar COTO | Initial: Mountain Province SMV consultation maps | 86 files, 71,327 insertions |
| `526b61b` | 2026-05-13 02:03 UTC / 10:03 +0800 | Rinar COTO | feat: GitHub-backed Save to project with shared password auth | 3 files, 207 insertions, 98 deletions |
| `d5cd737` | 2026-05-13 11:55 +0800 | Rinar COTO | data: OSM roads for Barlig, Tadian, Sagada | 3 files |
| `3beea73` | 2026-05-13 11:57 +0800 | Rinar COTO | local changes sagada | 2 files, 2,253 insertions, 39 deletions |
| `472ba0e` | 2026-05-13 12:51 +0800 | Rinar COTO | Add Sagada active road stroke overlay in walkthrough | 1 file, 67 insertions |
| `a9ce345` to `6747f51` | 2026-05-13 12:53 to 16:28 +0800 | Rinar COTO | Multiple Sagada `/api/zones/save` updates | Sagada zone feature-count changes from 46 to 88 features |
| `5d59b9f` | 2026-05-13 13:08 +0800 | Rinar COTO | Make Sagada roads static and remove dashed edit stroke | 2 files |
| `ea1c0b8` | 2026-05-13 13:20 +0800 | Rinar COTO | Remove Sagada view-mode road highlight overlay | 1 file |
| `859a014` | 2026-05-13 13:25 +0800 | Rinar COTO | Use municipality class list in zone editor and add Sagada classes | 3 files |
| `e2aac2c` | 2026-05-13 13:38 +0800 | Rinar COTO | Fix sidebar class selection callback after municipality switch | 1 file |
| `522b229` | 2026-05-13 13:40 +0800 | Rinar COTO | Require Shift+click to select road segments in editor | 1 file |
| `e23b441` | 2026-05-13 16:06 +0800 | Rinar COTO | Make sidebar parent class click toggle open/close | 1 file |
| `910a045` | 2026-05-15 13:08 +0800 | Rinar COTO | Enhance SMV editing workflow and data tooling | 33 files, 176,532 insertions, 19,119 deletions |
| `49c48fa` | 2026-05-15 23:12 +0800 | Rinar COTO | Update sagada_zones.geojson via /api/zones/save (88 features) | Data save |
| `7bc20b3` | 2026-05-15 15:19 UTC | Rinar | Frontage bands + multi-vertex tool + bake flow improvements | 11 files, 100,912 insertions, 7,202 deletions |
| `bab7d18` | 2026-05-15 23:25 +0800 | Rinar | Merge branch 'main' of GitHub repo | Merge commit |
| `9ed6ce9` | 2026-05-17 01:52 +0800 | Rinar | Refine SMV editing UI and add smart offline tile download workflow | 11 files, 62,882 insertions, 51,184 deletions |
| `aafc755` | 2026-05-17 13:25 +0800 | Rinar | Add Bontoc landmarks and SMV map updates | 23 files, 17,138 insertions, 30 deletions |
| `edda129` | 2026-05-17 15:19 +0800 | Rinar | Add zone hover details and road carving updates | 10 files, 205,944 insertions, 39 deletions |
| `967c786` | 2026-05-17 19:19 +0800 | Rinar | Update editable zones and Tadian data | 2 files, 30,525 insertions, 9,506 deletions |
| `fd87e4d` | 2026-06-01 08:01 +0800 | Rinar | Expand municipality mapping data and offline consultation tools | 87 files, 159,689 insertions, 329 deletions |
| `7da98f4` to `4611dd4` | 2026-06-18 14:11 to 14:19 +0800 | Rinar COTO | Bauko zone save attempts | Bauko zones save activity |
| `c8e0063` | 2026-06-18 14:17 +0800 | Rinar | Add municipality mapping editor and print system | 85 files, 1,046,839 insertions, 94,560 deletions |
| `25edefb` | 2026-06-18 14:24 +0800 | Rinar | Update Bauko saved map views | 1 file, 105 insertions, 20 deletions |

## Current Uncommitted Work

As of the local inspection before this report file was added, the working tree had:

- 57 modified tracked files.
- 20 untracked files.
- Current unstaged diff size: 1,216,420 insertions and 790,830 deletions.

This means substantial local work exists after the last committed/pushed state. If the audit asks why GitHub does not show daily pushes, the defensible explanation is:

> Work continued locally across multiple days and was not pushed daily. The Git history confirms major committed milestones through 2026-06-18, and the current working tree plus local file modification times show additional local work on 2026-06-19, 2026-06-22, 2026-06-23, and 2026-06-26. Exact GitHub push timestamps should be read from GitHub, but the local repository evidence supports a non-daily push workflow.

## Uncommitted Work by Local Timestamp

### 2026-06-19

- `app/api/roads/save/route.js`
- `components/LeafletMap.js`
- `components/Sidebar.js`
- `app/globals.css`
- `lib/sagada.js`
- `public/data/*_osm_water.geojson` for Besao, Bontoc, Natonin, Paracelis, Sabangan, Sadanga, Sagada, and Tadian
- `public/data/natonin_valuations.json`
- `public/data/sagada_valuations.json`
- `public/data/sagada_zones.geojson`
- `public/data/sagada_print_roads.geojson`
- `scripts/add-sabangan-inner-zones.mjs`
- `scripts/build-print-svg.mjs`
- print SVG outputs for Barlig and Natonin

### 2026-06-22

- `lib/paracelis.js`
- `lib/sadanga.js`
- `public/data/paracelis*`
- `public/data/sadanga*`
- `public/data/sagada_saved_views.json`

### 2026-06-23

- `components/EditableZones.js`
- `lib/bauko.js`
- `lib/besao.js`
- `lib/bontoc.js`
- `lib/classifications.js`
- `lib/print-svg-builder.js`
- `lib/sabangan.js`
- `lib/tadian.js`
- `public/data/barlig_saved_views.json`
- `public/data/bauko_valuations.json`
- `public/data/bauko_zones.geojson`
- `public/data/besao*`
- `public/data/bontoc*`
- `public/data/sabangan*`
- `public/data/tadian*`
- print SVG outputs for Bauko, Besao, Sabangan, Sadanga, Sagada, and Tadian

### 2026-06-26

- `public/print/bontoc.svg`
- `public/print/paracelis.svg`
- `public/print/untitled folder/barlig.svg`

## Suggested Audit Explanation

I worked on the app locally over multiple sessions and did not push every day. The repository shows committed milestones on May 13, May 15, May 17, June 1, and June 18. The largest work periods were municipality data expansion, editing tools, offline consultation support, DXF/road/frontage tooling, saved views, print map generation, and municipality-specific valuation/zone data.

After the last pushed commit on June 18, local file evidence shows continued work on June 19, June 22, June 23, and June 26. Those changes are still in the local working tree and were not yet committed/pushed at the time this log was generated.

## Recommended Next Step

Before submitting this in an audit, confirm GitHub-side push dates from the GitHub web UI or API and attach this file as the local-repo reconstruction. If the uncommitted work needs to be part of the official timeline, commit it with a truthful commit message that says it contains accumulated local work.
