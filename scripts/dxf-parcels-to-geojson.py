#!/usr/bin/env python3
"""Convert a DXF parcel-boundary layer into WGS84 parcel polygons.

The DXF driver exposes CAD linework as individual LineStrings. This script
loads the requested layers in their projected CRS, preserves the boundary
linework by default (including open cadastral segments), and writes a
GeoJSON FeatureCollection in EPSG:4326 for the map. Use --polygonize when
closed parcel polygons are specifically required. Use --closed-only when the
source layer contains closed CAD parcel polylines; that preserves each source
shape instead of constructing new faces from all linework.

Example:
  python3 scripts/dxf-parcels-to-geojson.py \
    input.dxf public/data/bontoc_parcels.geojson \
    --layer "declared property" --closed-only --clip-to public/data/bontoc.geojson

The default source CRS is PRS92 / Philippines zone III (EPSG:3123), which is
the coordinate system used by the Bontoc parcel drawing.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from pyproj import Transformer
from shapely import remove_repeated_points
from shapely.geometry import Polygon, mapping, shape
from shapely.ops import polygonize, transform, unary_union


def find_ogr2ogr() -> str:
    candidates = [
        shutil.which("ogr2ogr"),
        "/Applications/Postgres.app/Contents/Versions/17/bin/ogr2ogr",
        "/Applications/QGIS.app/Contents/MacOS/ogr2ogr",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return candidate
    raise RuntimeError("ogr2ogr was not found. Install GDAL or QGIS first.")


def finite_coordinates(coordinates) -> bool:
    if not coordinates:
        return False
    if isinstance(coordinates[0], (int, float)):
        return all(math.isfinite(float(value)) for value in coordinates)
    return all(finite_coordinates(child) for child in coordinates)


def is_closed_linestring(feature) -> bool:
    geometry = feature.get("geometry") or {}
    if geometry.get("type") != "LineString":
        return False
    coordinates = geometry.get("coordinates") or []
    return (
        len(coordinates) >= 4
        and coordinates[0][:2] == coordinates[-1][:2]
    )


def feature_layer_name(feature) -> str:
    properties = feature.get("properties") or {}
    return str(properties.get("Layer") or properties.get("layer") or "")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input_dxf", type=Path)
    parser.add_argument("output_geojson", type=Path)
    parser.add_argument(
        "--layer",
        dest="layers",
        action="append",
        help="DXF layer to polygonize; repeat for multiple layers (default: PARCELS)",
    )
    parser.add_argument("--source-crs", default="EPSG:3123")
    parser.add_argument("--min-area-m2", type=float, default=10.0)
    parser.add_argument(
        "--clip-to",
        type=Path,
        help="Optional WGS84 GeoJSON boundary; retain only geometries intersecting it",
    )
    parser.add_argument(
        "--polygonize",
        action="store_true",
        help="Write closed polygons instead of preserving source linework",
    )
    parser.add_argument(
        "--polygonize-layer",
        dest="polygonize_layers",
        action="append",
        default=[],
        help="Polygonize one selected DXF layer while other layers use --closed-only; repeatable",
    )
    parser.add_argument(
        "--closed-only",
        action="store_true",
        help="Preserve closed CAD parcel polylines as polygons; ignore open linework",
    )
    parser.add_argument(
        "--line-layer",
        dest="line_layers",
        action="append",
        default=[],
        help="Also preserve open linework from this layer; repeatable",
    )
    parser.add_argument(
        "--all-layers",
        action="store_true",
        help="Read every DXF layer instead of using --layer selections",
    )
    parser.add_argument(
        "--all-linework",
        action="store_true",
        help="Preserve open linework from every accepted layer",
    )
    parser.add_argument(
        "--exclude-layer",
        dest="excluded_layers",
        action="append",
        default=[],
        help="Exclude this DXF layer; repeatable",
    )
    parser.add_argument(
        "--exclude-noncontinuous",
        action="store_true",
        help="Exclude layers whose linetype is not Continuous or ByLayer",
    )
    args = parser.parse_args()
    polygonize_layers = set(args.polygonize_layers)
    line_layers = set(args.line_layers)
    layers = list(args.layers or [])
    for layer in args.polygonize_layers:
        if layer not in layers:
            layers.append(layer)
    if not layers:
        layers = ["PARCELS"]

    ogr2ogr = find_ogr2ogr()
    ogr_environment = os.environ.copy()
    # Large AutoCAD drawings can store parcel linework inside blocks. GDAL's
    # default block limit silently drops entities after 10,000 per block.
    ogr_environment["DXF_FEATURE_LIMIT_PER_BLOCK"] = "-1"
    with tempfile.TemporaryDirectory(prefix="dxf-parcels-") as temp_dir:
        lines_path = Path(temp_dir) / "parcel-lines.geojson"
        ogr_args = [
                ogr2ogr,
                "-f",
                "GeoJSON",
                "-a_srs",
                args.source_crs,
                str(lines_path),
                str(args.input_dxf),
                "entities",
                "-nln",
                "parcel_lines",
                "-skipfailures",
            ]
        if not args.all_layers:
            ogr_args[5:5] = [
                "-where",
                " OR ".join(f"Layer = '{layer}'" for layer in layers),
            ]
        subprocess.run(
            ogr_args,
            check=True,
            env=ogr_environment,
        )
        source = json.loads(lines_path.read_text(encoding="utf-8"))

    source_features = source.get("features", [])
    excluded_layers = {layer.casefold() for layer in args.excluded_layers}

    def accepted_feature(feature) -> bool:
        layer = feature_layer_name(feature)
        if layer.casefold() in excluded_layers:
            return False
        if args.exclude_noncontinuous:
            linetype = str((feature.get("properties") or {}).get("Linetype") or "")
            if linetype.upper() not in {"", "CONTINUOUS", "BYLAYER"}:
                return False
        return True

    source_features = [feature for feature in source_features if accepted_feature(feature)]
    if args.closed_only:
        source_features = [
            feature
            for feature in source_features
            if args.all_linework
            or feature_layer_name(feature) in polygonize_layers
            or feature_layer_name(feature) in line_layers
            or is_closed_linestring(feature)
        ]

    line_records = []
    for feature in source_features:
        geometry = feature.get("geometry") or {}
        if (
            geometry.get("type") not in {"LineString", "MultiLineString"}
            or not finite_coordinates(geometry.get("coordinates"))
        ):
            continue
        line_records.append(
            (
                feature_layer_name(feature),
                transform(lambda x, y, *rest: (x, y), shape(geometry)),
            )
        )
    lines = [geometry for _, geometry in line_records]
    if not lines:
        raise RuntimeError(
            f'No linework found on DXF layer(s): {", ".join(layers)}.'
        )

    to_wgs84 = Transformer.from_crs(
        args.source_crs, "EPSG:4326", always_xy=True
    ).transform
    if polygonize_layers:
        geometries = []
        for layer in polygonize_layers:
            layer_lines = [
                geometry for source_layer, geometry in line_records if source_layer == layer
            ]
            if not layer_lines:
                continue
            merged = unary_union(layer_lines)
            geometries.extend(
                polygon
                for polygon in polygonize(merged)
                if polygon.is_valid and polygon.area >= args.min_area_m2
            )
        for layer, line in line_records:
            if layer in polygonize_layers:
                continue
            if line.geom_type != "LineString" or not line.is_valid:
                continue
            coordinates = list(remove_repeated_points(line).coords)
            if len(coordinates) < 4 or coordinates[0] != coordinates[-1]:
                continue
            polygon = Polygon(coordinates)
            if polygon.is_valid and polygon.area >= args.min_area_m2:
                geometries.append(polygon)
        if not geometries:
            raise RuntimeError("No valid parcel polygons were found.")
    elif args.closed_only:
        geometries = []
        for line in lines:
            if line.geom_type != "LineString" or not line.is_valid:
                continue
            coordinates = list(remove_repeated_points(line).coords)
            if len(coordinates) < 4 or coordinates[0] != coordinates[-1]:
                continue
            polygon = Polygon(coordinates)
            if polygon.is_valid and polygon.area >= args.min_area_m2:
                geometries.append(polygon)
        if not geometries:
            raise RuntimeError("No valid closed parcel polylines were found.")
    elif args.polygonize:
        merged = unary_union(lines)
        geometries = [
            polygon
            for polygon in polygonize(merged)
            if polygon.is_valid and polygon.area >= args.min_area_m2
        ]
        if not geometries:
            raise RuntimeError(
                "The parcel linework did not form any closed polygons."
            )
    else:
        geometries = lines

    # Some cadastral layers contain useful open boundaries that cannot be
    # converted into polygons yet. Keep those lines in the GeoJSON so they
    # still appear on the map. They are intentionally not treated as parcels.
    open_linework = [
        geometry
        for layer, geometry in line_records
        if args.all_linework or layer in line_layers
        and geometry.geom_type in {"LineString", "MultiLineString"}
        and not (geometry.geom_type == "LineString" and geometry.is_ring)
    ]
    geometry_records = [(geometry, "polygon") for geometry in geometries]
    geometry_records.extend((geometry, "line") for geometry in open_linework)

    output = {
        "type": "FeatureCollection",
        "name": args.output_geojson.stem,
        "features": [],
    }
    clip_boundary = None
    if args.clip_to:
        clip_source = json.loads(args.clip_to.read_text(encoding="utf-8"))
        clip_boundary = unary_union(
            [
                shape(feature["geometry"])
                for feature in clip_source.get("features", [])
                if feature.get("geometry")
            ]
        )
    seen_geometries = set()
    for index, (geometry, geometry_type) in enumerate(geometry_records):
        area_m2 = geometry.area if geometry_type == "polygon" else None
        geometry = transform(to_wgs84, geometry)
        if clip_boundary is not None and not geometry.intersects(clip_boundary):
            continue
        # Several DXF layers can contain the same parcel boundary. Keep the
        # first copy so adding another source layer does not duplicate parcels
        # on the map.
        geometry_key = geometry.wkb
        if geometry_key in seen_geometries:
            continue
        seen_geometries.add(geometry_key)
        properties = {
            "source": args.input_dxf.name,
            "layer": ",".join(layers),
            "parcel_id": len(output["features"]) + 1,
            "geometry_type": geometry_type,
            "parcel_key": hashlib.sha1(geometry_key).hexdigest()[:20],
        }
        if area_m2 is not None:
            properties["area_m2"] = round(area_m2, 2)
        output["features"].append(
            {
                "type": "Feature",
                "properties": properties,
                "geometry": mapping(geometry),
            }
        )
    args.output_geojson.parent.mkdir(parents=True, exist_ok=True)
    args.output_geojson.write_text(
        json.dumps(output, separators=(",", ":")) + "\n", encoding="utf-8"
    )
    print(
        f"Wrote {len(output['features'])} parcel geometries to {args.output_geojson} "
        f"from {len(lines)} line features on {', '.join(layers)}."
    )


if __name__ == "__main__":
    main()
