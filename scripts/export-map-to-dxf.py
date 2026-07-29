#!/usr/bin/env python3
"""Export a municipality's map layers to an editable AutoCAD DXF.

The app stores map data as WGS84 GeoJSON. This exporter transforms that data
to a projected CRS (PRS92 / Philippines Zone III by default) and writes
separate CAD layers for SMV zones, parcels, roads, boundaries, and labels.

Usage:
  python3 scripts/export-map-to-dxf.py bontoc exports/bontoc_smv_map.dxf

Requirements:
  pip install ezdxf pyproj shapely
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import ezdxf
from ezdxf.enums import TextEntityAlignment
from pyproj import Transformer
from shapely.geometry import Point, shape
from shapely.ops import transform


SOURCE_CRS = "EPSG:4326"
DEFAULT_TARGET_CRS = "EPSG:3123"  # PRS92 / Philippines Zone III
MAX_LAYER_NAME_LENGTH = 65

# Match the app's current SMV palette. DXF true-color values are used so the
# colors survive in AutoCAD/QGIS even when an exact ACI color is unavailable.
CLASS_COLORS = {
    "C-1": "#FF0000",
    "C-2": "#800080",
    "C-3": "#D8B868",
    "C-4": "#684838",
    "C-5": "#C87838",
    "C-6": "#788038",
    "C-7": "#989878",
    "C-8": "#784878",
    "C-9": "#998858",
    "C-10": "#B89888",
    "C-11": "#704848",
    "C-12": "#A8A858",
    "R-1": "#FFFF00",
    "R-2": "#F1F237",
    "R-3": "#88C898",
    "R-4": "#8858D8",
    "R-5": "#9888B8",
    "R-6": "#D858A8",
    "R-7": "#683858",
    "R-8": "#588838",
    "R-9": "#583888",
    "R-10": "#D888A8",
    "R-11": "#887838",
    "R-12": "#D858D8",
    "R-13": "#C888D8",
    "R-14": "#98C868",
    "R-15": "#A88878",
    "UNCLASSIFIED": "#9CA3AF",
}

ROAD_COLORS = {
    "NATIONAL": "#FCD34D",
    "PROVINCIAL": "#FB923C",
    "BARANGAY": "#FFFFFF",
    "OTHER": "#A8A39B",
}


def load_json(path: Path):
    if not path.exists():
        return {"type": "FeatureCollection", "features": []}
    return json.loads(path.read_text(encoding="utf-8"))


def features(data):
    return data.get("features", [])


def safe_layer_name(name: str) -> str:
    # Keep layer names friendly to older CAD software.
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "_", name).strip("_")
    return cleaned[:MAX_LAYER_NAME_LENGTH] or "MAP"


def hex_to_true_color(value: str) -> int:
    value = value.lstrip("#")
    return int(value, 16)


def add_layer(doc, name: str, color: str = "#111827") -> str:
    name = safe_layer_name(name)
    if name not in doc.layers:
        layer = doc.layers.add(name, color=7)
    else:
        layer = doc.layers.get(name)
    layer.dxf.true_color = hex_to_true_color(color)
    return name


def iter_polygons(geometry):
    if geometry.is_empty:
        return
    if geometry.geom_type == "Polygon":
        yield geometry
    elif geometry.geom_type in {"MultiPolygon", "GeometryCollection"}:
        for part in geometry.geoms:
            yield from iter_polygons(part)


def iter_lines(geometry):
    if geometry.is_empty:
        return
    if geometry.geom_type in {"LineString", "LinearRing"}:
        yield geometry
    elif geometry.geom_type in {"MultiLineString", "GeometryCollection"}:
        for part in geometry.geoms:
            yield from iter_lines(part)


def ring_points(ring):
    return [(float(x), float(y)) for x, y, *_ in ring.coords]


def add_polygon_boundaries(msp, geometry, layer: str):
    count = 0
    for polygon in iter_polygons(geometry):
        rings = [polygon.exterior, *polygon.interiors]
        for ring in rings:
            points = ring_points(ring)
            if len(points) < 3:
                continue
            msp.add_lwpolyline(
                points,
                close=True,
                dxfattribs={"layer": layer},
            )
            count += 1
    return count


def add_polygon_features(msp, data, transformer, layer_for_feature):
    count = 0
    for feature in features(data):
        geometry = feature.get("geometry")
        if not geometry:
            continue
        projected = transform(transformer.transform, shape(geometry))
        count += add_polygon_boundaries(
            msp,
            projected,
            layer_for_feature(feature),
        )
    return count


def add_solid_hatch(msp, geometry, layer: str, color: str):
    """Add lightweight solid hatches for SMV polygons.

    Boundaries are also emitted separately, so the export remains useful in
    CAD programs that choose not to display hatch fills.
    """
    count = 0
    for polygon in iter_polygons(geometry):
        points = ring_points(polygon.exterior)
        if len(points) < 3:
            continue
        hatch = msp.add_hatch(color=7, dxfattribs={"layer": layer})
        hatch.dxf.true_color = hex_to_true_color(color)
        hatch.paths.add_polyline_path(points, is_closed=True)
        count += 1
    return count


def add_text(msp, text: str, x: float, y: float, layer: str, height: float):
    entity = msp.add_text(
        str(text),
        dxfattribs={"layer": layer, "height": height},
    )
    entity.set_placement((float(x), float(y)), align=TextEntityAlignment.MIDDLE_CENTER)


def road_tier(highway: str) -> str:
    if highway in {"trunk", "primary"}:
        return "NATIONAL"
    if highway == "secondary":
        return "PROVINCIAL"
    if highway in {"unclassified", "residential"}:
        return "BARANGAY"
    return "OTHER"


def add_line_features(msp, data, transformer, layer_for_feature):
    count = 0
    for feature in features(data):
        geometry = feature.get("geometry")
        if not geometry:
            continue
        projected = transform(transformer.transform, shape(geometry))
        layer = layer_for_feature(feature)
        for line in iter_lines(projected):
            points = [(float(x), float(y)) for x, y, *_ in line.coords]
            if len(points) < 2:
                continue
            msp.add_lwpolyline(points, dxfattribs={"layer": layer})
            count += 1
    return count


def add_point_features(
    msp,
    data,
    transformer,
    point_layer,
    label_layer,
    label_height,
    include_labels=True,
):
    points_added = 0
    labels_added = 0
    for feature in features(data):
        geometry = feature.get("geometry")
        if not geometry:
            continue
        projected = transform(transformer.transform, shape(geometry))
        if projected.geom_type != "Point":
            projected = projected.representative_point()
        x, y = projected.x, projected.y
        msp.add_point((x, y), dxfattribs={"layer": point_layer})
        points_added += 1
        name = feature.get("properties", {}).get("name")
        if include_labels and name:
            add_text(msp, name, x, y, label_layer, label_height)
            labels_added += 1
    return points_added, labels_added


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("slug", help="Municipality slug, for example bontoc")
    parser.add_argument("output_dxf", type=Path)
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=Path("public/data"),
        help="Directory containing the municipality GeoJSON files",
    )
    parser.add_argument(
        "--target-crs",
        default=DEFAULT_TARGET_CRS,
        help=f"Projected output CRS (default: {DEFAULT_TARGET_CRS})",
    )
    parser.add_argument("--no-hatches", action="store_true", help="Export SMV boundaries without filled hatches")
    parser.add_argument("--no-labels", action="store_true", help="Skip SMV, barangay, road, and landmark labels")
    args = parser.parse_args()

    data_dir = args.data_dir
    slug = args.slug
    transformer = Transformer.from_crs(SOURCE_CRS, args.target_crs, always_xy=True)

    municipality = load_json(data_dir / f"{slug}.geojson")
    barangays = load_json(data_dir / f"{slug}_barangays.geojson")
    zones = load_json(data_dir / f"{slug}_zones.geojson")
    parcels = load_json(data_dir / f"{slug}_parcels.geojson")
    roads = load_json(data_dir / f"{slug}_osm_roads.geojson")
    landmarks = load_json(data_dir / f"{slug}_landmarks.geojson")
    custom_landmarks = load_json(data_dir / f"{slug}_custom_landmarks.geojson")
    places = load_json(data_dir / f"{slug}_osm_places.geojson")

    doc = ezdxf.new("R2018")
    doc.header["$INSUNITS"] = 6  # meters
    doc.header["$MEASUREMENT"] = 1
    msp = doc.modelspace()

    municipality_layer = add_layer(doc, "MUNICIPAL_BOUNDARY", "#000000")
    barangay_layer = add_layer(doc, "BARANGAY_BOUNDARIES", "#1F2937")
    parcel_layer = add_layer(doc, "PARCELS", "#111827")
    add_polygon_features(
        msp,
        municipality,
        transformer,
        lambda _: municipality_layer,
    )
    add_polygon_features(msp, barangays, transformer, lambda _: barangay_layer)
    add_polygon_features(msp, parcels, transformer, lambda _: parcel_layer)

    zone_count = 0
    hatch_count = 0
    for feature in features(zones):
        geometry = feature.get("geometry")
        if not geometry:
            continue
        projected = transform(transformer.transform, shape(geometry))
        klass = str(feature.get("properties", {}).get("classification") or "UNCLASSIFIED").upper()
        color = CLASS_COLORS.get(klass, CLASS_COLORS["UNCLASSIFIED"])
        layer = add_layer(doc, f"SMV_{klass}", color)
        zone_count += add_polygon_boundaries(msp, projected, layer)
        if not args.no_hatches:
            hatch_count += add_solid_hatch(msp, projected, layer, color)
        if not args.no_labels:
            point = projected.representative_point()
            label_layer = add_layer(doc, "SMV_LABELS", "#111827")
            add_text(msp, klass, point.x, point.y, label_layer, 12)

    road_count = add_line_features(
        msp,
        roads,
        transformer,
        lambda feature: add_layer(
            doc,
            f"ROADS_{road_tier(feature.get('properties', {}).get('highway', ''))}",
            ROAD_COLORS[road_tier(feature.get("properties", {}).get("highway", ""))],
        ),
    )

    label_count = 0
    for feature in features(roads):
        if args.no_labels:
            break
        geometry = feature.get("geometry")
        name = feature.get("properties", {}).get("name")
        if not geometry or not name:
            continue
        projected = transform(transformer.transform, shape(geometry))
        for line in iter_lines(projected):
            point = line.interpolate(0.5, normalized=True)
            add_text(msp, name, point.x, point.y, add_layer(doc, "ROAD_LABELS", "#4B5563"), 8)
            label_count += 1
            break

    barangay_label_count = 0
    if not args.no_labels:
        for feature in features(barangays):
            name = feature.get("properties", {}).get("name")
            geometry = feature.get("geometry")
            if not name or not geometry:
                continue
            point = transform(transformer.transform, shape(geometry)).representative_point()
            add_text(msp, name, point.x, point.y, add_layer(doc, "BARANGAY_LABELS", "#111827"), 16)
            barangay_label_count += 1

    landmark_count = 0
    landmark_label_count = 0
    for landmark_data in (landmarks, custom_landmarks, places):
        points, labels = add_point_features(
            msp,
            landmark_data,
            transformer,
            add_layer(doc, "LANDMARKS", "#7C3AED"),
            add_layer(doc, "LANDMARK_LABELS", "#111827"),
            10,
            include_labels=not args.no_labels,
        )
        landmark_count += points
        landmark_label_count += labels

    args.output_dxf.parent.mkdir(parents=True, exist_ok=True)
    doc.saveas(args.output_dxf)
    print(
        f"Wrote {args.output_dxf} in {args.target_crs}: "
        f"{zone_count} zone rings, {hatch_count} hatches, "
        f"{len(features(parcels))} parcels, {road_count} roads, "
        f"{len(features(barangays))} barangays, "
        f"{label_count + barangay_label_count + landmark_label_count} labels, "
        f"{landmark_count} points."
    )


if __name__ == "__main__":
    main()
