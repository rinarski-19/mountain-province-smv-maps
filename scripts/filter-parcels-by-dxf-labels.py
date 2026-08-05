#!/usr/bin/env python3
"""Keep only parcel polygons that contain qualifying text from a DXF.

The parcel boundary and its CAD label are treated as one record. A parcel is
kept when a TEXT/MTEXT object inside it contains either a lot number or a C-1
/ C-2 classification. The source parcel GeoJSON is never modified.

Example:
  python3 scripts/filter-parcels-by-dxf-labels.py \
    public/data/bauko_parcels.geojson \
    "/Users/rinar/Downloads/Bauko projection map 2023.dxf" \
    exports/bauko_labelled_parcels.geojson
"""

from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from numbers import Integral
from pathlib import Path

import ezdxf
from pyproj import Transformer
from shapely.geometry import Point, shape, mapping
from shapely.strtree import STRtree


LOT_PATTERN = re.compile(
    r"\bLOT\s*(?:N(?:O|0)?\.?\s*)?\d+[A-Z]?\b", re.IGNORECASE
)
CLASS_PATTERN = re.compile(r"\bC\s*[-–—]?\s*[12]\b", re.IGNORECASE)
TEXT_TYPES = {"TEXT", "MTEXT", "ATTRIB", "ATTDEF"}


def clean_dxf_text(value: str) -> str:
    """Remove common AutoCAD formatting codes from TEXT/MTEXT content."""
    text = str(value or "")
    text = re.sub(r"\\[fF][^;]*;", "", text)
    text = re.sub(r"\\[Cc][0-9]+;", "", text)
    text = text.replace("\\P", " ").replace("\\~", " ")
    text = re.sub(r"\{[^{}]*;", "", text).replace("}", "")
    return " ".join(text.split())


def text_matches(value: str, mode: str) -> tuple[bool, bool]:
    has_lot = bool(LOT_PATTERN.search(value))
    has_class = bool(CLASS_PATTERN.search(value))
    if mode == "lot":
        return has_lot, False
    if mode == "class":
        return False, has_class
    return has_lot, has_class


def dxf_text_points(dxf_path: Path, source_crs: str, text_layers: set[str]):
    doc = ezdxf.readfile(dxf_path)
    transformer = Transformer.from_crs(source_crs, "EPSG:4326", always_xy=True)
    points = []
    labels = []
    for entity in doc.modelspace():
        if entity.dxftype() not in TEXT_TYPES:
            continue
        layer = str(entity.dxf.layer)
        if text_layers and layer not in text_layers:
            continue
        raw = getattr(entity.dxf, "text", "") or getattr(entity.dxf, "tag", "")
        text = clean_dxf_text(raw)
        if not text:
            continue
        has_lot, has_class = text_matches(text, "either")
        if not (has_lot or has_class):
            continue
        try:
            x, y = transformer.transform(entity.dxf.insert.x, entity.dxf.insert.y)
        except (AttributeError, TypeError, ValueError):
            continue
        points.append(Point(x, y))
        labels.append(
            {
                "text": text,
                "layer": layer,
                "has_lot": has_lot,
                "has_class": has_class,
            }
        )
    return points, labels


def tree_result_index(candidate, points_by_wkb):
    """Support both Shapely 1.x geometry results and Shapely 2 indices."""
    if isinstance(candidate, Integral):
        return int(candidate)
    matches = points_by_wkb.get(candidate.wkb, [])
    return matches[0] if matches else None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("parcels_geojson", type=Path)
    parser.add_argument("input_dxf", type=Path)
    parser.add_argument("output_geojson", type=Path)
    parser.add_argument(
        "--source-crs",
        default="EPSG:3123",
        help="CRS used by the DXF text coordinates (default: EPSG:3123)",
    )
    parser.add_argument(
        "--match",
        choices=("either", "lot", "class"),
        default="either",
        help="Keep parcels with a lot label, C-1/C-2 label, or either (default)",
    )
    parser.add_argument(
        "--text-layer",
        action="append",
        default=[],
        help="Restrict matching to a DXF text layer; repeatable",
    )
    args = parser.parse_args()

    parcels = json.loads(args.parcels_geojson.read_text(encoding="utf-8"))
    points, labels = dxf_text_points(
        args.input_dxf,
        args.source_crs,
        set(args.text_layer),
    )
    if not points:
        raise RuntimeError("No qualifying lot or C-1/C-2 text was found in the DXF.")

    tree = STRtree(points)
    points_by_wkb = defaultdict(list)
    for index, point in enumerate(points):
        points_by_wkb[point.wkb].append(index)

    output_features = []
    for feature in parcels.get("features", []):
        geometry = feature.get("geometry")
        if not geometry or geometry.get("type") not in {"Polygon", "MultiPolygon"}:
            continue
        parcel = shape(geometry)
        matches = []
        for candidate in tree.query(parcel):
            index = tree_result_index(candidate, points_by_wkb)
            if index is None:
                continue
            point = points[index]
            if not parcel.covers(point):
                continue
            label = labels[index]
            has_lot, has_class = text_matches(label["text"], args.match)
            if has_lot or has_class:
                matches.append(label)
        if not matches:
            continue

        properties = dict(feature.get("properties") or {})
        properties["label_filter"] = args.match
        properties["matched_label_count"] = len(matches)
        properties["matched_label_types"] = ",".join(
            sorted(
                {
                    label_type
                    for label in matches
                    for label_type, present in (
                        ("lot", label["has_lot"]),
                        ("class", label["has_class"]),
                    )
                    if present
                }
            )
        )
        output_features.append(
            {
                "type": "Feature",
                "properties": properties,
                "geometry": mapping(parcel),
            }
        )

    output = {
        "type": "FeatureCollection",
        "name": args.output_geojson.stem,
        "features": output_features,
    }
    args.output_geojson.parent.mkdir(parents=True, exist_ok=True)
    args.output_geojson.write_text(
        json.dumps(output, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(
        f"Wrote {len(output_features)} labelled parcel geometries to "
        f"{args.output_geojson} from {len(parcels.get('features', []))} source parcels."
    )


if __name__ == "__main__":
    main()
