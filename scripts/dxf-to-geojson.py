#!/usr/bin/env python3
"""
Convert an AutoCAD DXF land-value map (PRS92 zone III coordinates) into
GeoJSON for the consultation app.

Each SMV class is on its own DXF layer (R1, R2, R3, R4, R5, R6, R7, C-3,
Commercial, NATIONAL ROAD). We extract LWPOLYLINE entities from those
layers, reproject from EPSG:3123 to WGS84 (EPSG:4326), and write a
FeatureCollection with properties.classification set.

Usage:
  python3 scripts/dxf-to-geojson.py <input.dxf> <output.geojson>
"""

import json
import sys
import re
from collections import Counter, defaultdict
from pathlib import Path

import ezdxf
from pyproj import Transformer
from shapely.geometry import Polygon, MultiPolygon, GeometryCollection
from shapely.ops import unary_union
from shapely.validation import make_valid

SOURCE_CRS = "EPSG:3123"      # PRS92 / Philippines zone III
TARGET_CRS = "EPSG:4326"      # WGS84 lon/lat

# DXF layer name → canonical SMV class.
#
# Different LGU CAD offices use different naming conventions:
#   Sagada DXF: R1, R2, R3, Commercial
#   Bontoc DXF: R-1, R-2, R-3, commercial (lowercase), C-2 COMMERCIAL
# The classify_layer() function below normalises both styles. The
# explicit map here is for layer names that don't match the regex
# (e.g. lowercase "commercial" → "C-1" — the LGU's working commercial
# layer is their top tier).
#
# NOTE: `NATIONAL ROAD`, `C-1 AGRI`, `C-2 AGRI`, `PATHWAY`, `ROADS`,
# `road`, etc. are intentionally NOT mapped — they represent the road
# carriageway or agricultural land use, not classified SMV residential/
# commercial lots. Including them would mis-tag the asphalt strip and
# the farmland as commercial zones.
LAYER_TO_CLASS = {
    # Sagada-style lowercase Commercial → top commercial tier
    "Commercial": "C-1",
    "commercial": "C-1",
    # Sadanga DXF uses uppercase COMMERCIAL — same C-1 tier
    "COMMERCIAL": "C-1",
    # Natonin DXF uses "Commercial Lots" — same C-1 tier
    "Commercial Lots": "C-1",
    # Bontoc legacy small commercial layer ("com1" — 2 polys in Poblacion
    # alongside the main `commercial` layer; appears to be an older copy
    # of the same C-1 tier).
    "com1": "C-1",
    # Bontoc-style explicit C-2 layer
    "C-2 COMMERCIAL": "C-2",
    # Bauko 2026 DXF uses a "C-2COM." (with trailing dot) variant. Same
    # commercial-C2 tier — distinct from the AGRI-C2 layer which is
    # agricultural and intentionally NOT mapped.
    "C-2COM.": "C-2",
    "C-3": "C-3",
}

# Regex catches R1, R-1, R2, R-2, … R-15 and similar. Anything not
# caught by the explicit map above falls through to this.
import re as _re
_RX_CLASS = _re.compile(r"^\s*([CR])-?(\d+)\s*$")


def classify_layer(layer_name):
    """Map a DXF layer name to a canonical SMV class string, or None."""
    if layer_name in LAYER_TO_CLASS:
        return LAYER_TO_CLASS[layer_name]
    # Case-insensitive fallback: lots of LGU CAD offices use
    # mixed/inconsistent capitalisation (Commercial / commercial /
    # COMMERCIAL all mean the same C-1 tier). Try a lowercased
    # match before falling back to the regex.
    lower = layer_name.lower() if isinstance(layer_name, str) else ""
    for k, v in LAYER_TO_CLASS.items():
        if k.lower() == lower:
            return v
    m = _RX_CLASS.match(layer_name)
    if m:
        return f"{m.group(1)}-{m.group(2)}"
    return None


def main():
    if len(sys.argv) < 3:
        print(__doc__, file=sys.stderr)
        sys.exit(1)
    in_path = Path(sys.argv[1])
    out_path = Path(sys.argv[2])

    print(f"Loading {in_path.name} …")
    doc = ezdxf.readfile(str(in_path))
    msp = doc.modelspace()
    transformer = Transformer.from_crs(SOURCE_CRS, TARGET_CRS, always_xy=True)

    # Bucket polygons per class. Each polyline OR hatch boundary becomes
    # one Polygon candidate; we'll union per class at the end so adjacent
    # shapes snap into a single feature where they touch. Use defaultdict
    # so the regex-based classifier can introduce new classes (R-6 …
    # R-15 etc.) that aren't in LAYER_TO_CLASS.
    polys_by_class = defaultdict(list)
    source_layers_by_class = defaultdict(set)
    # Track per-class (centroid_x, centroid_y, area) for dedup. CAD files
    # routinely have a HATCH visually filling the SAME outline as an
    # LWPOLYLINE — without dedup we'd double-count those.
    seen_by_class = defaultdict(list)
    counts = Counter()
    skipped_open = 0
    skipped_short = 0
    large_gap_closures = 0
    hatches_added = 0
    dedup_skipped = 0

    def is_duplicate(cls, poly):
        """True if poly is already represented in seen_by_class[cls]."""
        try:
            cx = poly.centroid.x
            cy = poly.centroid.y
            area = poly.area
        except Exception:
            return False
        for ex_cx, ex_cy, ex_area in seen_by_class[cls]:
            # Centroid match in degrees: ~1m at PH latitudes ≈ 1e-5 deg.
            if abs(cx - ex_cx) < 2e-5 and abs(cy - ex_cy) < 2e-5:
                if ex_area > 0 and abs(area - ex_area) / ex_area < 0.05:
                    return True
        return False

    def remember(cls, poly):
        try:
            seen_by_class[cls].append((poly.centroid.x, poly.centroid.y, poly.area))
        except Exception:
            pass

    def finalize(lonlat):
        """Build a clean Polygon from a list of (lon,lat) tuples, or None."""
        try:
            poly = Polygon(lonlat)
            if not poly.is_valid:
                cleaned = poly.buffer(0)
                if cleaned.is_empty or cleaned.area == 0:
                    # Bowtie / figure-8 polygons collapse under buffer(0);
                    # make_valid keeps the non-overlapping pieces.
                    cleaned = make_valid(poly)
                poly = cleaned
            if poly.geom_type == "GeometryCollection":
                polys_only = [
                    g for g in poly.geoms
                    if g.geom_type in ("Polygon", "MultiPolygon")
                ]
                if not polys_only:
                    return None
                poly = unary_union(polys_only)
            if poly.is_empty or poly.area == 0:
                return None
            return poly
        except Exception:
            return None

    for ent in msp:
        layer = ent.dxf.layer
        cls = classify_layer(layer)
        if not cls:
            continue

        entity_type = ent.dxftype()

        # ---- LWPOLYLINEs (outline geometry) ----
        if entity_type == "LWPOLYLINE":
            source_layers_by_class[cls].add(layer)
            pts = [(p[0], p[1]) for p in ent.get_points("xy")]
            if len(pts) < 3:
                skipped_short += 1
                continue
            # Close-gap heuristic — see comment in v1 of this loop:
            #   4+ vertices → always close (real parcels often unsnapped)
            #   3 vertices → only close if gap < 50m (else it's a "V" line)
            closed_flag = bool(ent.dxf.flags & 1)
            if not closed_flag:
                dx = pts[0][0] - pts[-1][0]
                dy = pts[0][1] - pts[-1][1]
                gap_sq = dx * dx + dy * dy
                if len(pts) < 4 and gap_sq > 2500.0:
                    skipped_open += 1
                    continue
                if gap_sq > 100.0:
                    large_gap_closures += 1
            if pts[0] != pts[-1]:
                pts.append(pts[0])
            lonlat = [transformer.transform(x, y) for x, y in pts]
            poly = finalize(lonlat)
            if poly is None:
                continue
            if is_duplicate(cls, poly):
                dedup_skipped += 1
                continue
            polys_by_class[cls].append(poly)
            remember(cls, poly)
            counts[cls] += 1
            continue

        # ---- HATCHes (visual fill — often the ONLY representation of
        # a zone when the CAD operator didn't draw a separate outline).
        # Each HATCH can have multiple boundary paths; we take the
        # external ones (path_type_flags bit 0). Internal "hole" paths
        # are ignored — SMV zones rarely have donut shapes, and modelling
        # them as holes would complicate dedup. ----
        if entity_type == "HATCH":
            source_layers_by_class[cls].add(layer)
            for path in ent.paths:
                # Only PolylinePath boundaries are supported. EdgePath
                # (curves/arcs) would need interpolation; none observed
                # in current LGU DXFs.
                if type(path).__name__ != "PolylinePath":
                    continue
                if not (path.path_type_flags & 1):  # external bit
                    continue
                try:
                    pts = [(v[0], v[1]) for v in path.vertices]
                except Exception:
                    continue
                if len(pts) < 3:
                    continue
                if pts[0] != pts[-1]:
                    pts.append(pts[0])
                lonlat = [transformer.transform(x, y) for x, y in pts]
                poly = finalize(lonlat)
                if poly is None:
                    continue
                if is_duplicate(cls, poly):
                    dedup_skipped += 1
                    continue
                polys_by_class[cls].append(poly)
                remember(cls, poly)
                counts[cls] += 1
                hatches_added += 1
            continue

    print(
        f"Polygons extracted "
        f"({hatches_added} HATCH-only; {dedup_skipped} HATCH/poly duplicates; "
        f"{skipped_short} short, {skipped_open} open >50m; "
        f"{large_gap_closures} closed across 10–50m gap):"
    )
    for cls, n in sorted(counts.items()):
        print(f"  {cls:5s}  {n}")

    # Emit one feature per polygon so each is independently editable in
    # the in-app pencil tool. Pass --union to instead get one big
    # MultiPolygon per class (smaller file, but less editable).
    union_mode = "--union" in sys.argv
    features = []
    for cls, polys in polys_by_class.items():
        if not polys:
            continue
        if union_mode:
            merged = unary_union(polys)
            features.append({
                "type": "Feature",
                "properties": {
                    "classification": cls,
                    "source": "dxf",
                    "source_layers": sorted(source_layers_by_class[cls]),
                },
                "geometry": merged.__geo_interface__,
            })
        else:
            for poly in polys:
                features.append({
                    "type": "Feature",
                    "properties": {
                        "classification": cls,
                        "source": "dxf",
                    },
                    "geometry": poly.__geo_interface__,
                })

    fc = {"type": "FeatureCollection", "features": features}
    out_path.write_text(json.dumps(fc) + "\n", encoding="utf-8")
    print(f"\nWrote {out_path} ({len(features)} class features)")


if __name__ == "__main__":
    main()
