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
import json
import math
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
        "--closed-only",
        action="store_true",
        help="Preserve closed CAD parcel polylines as polygons; ignore open linework",
    )
    args = parser.parse_args()
    layers = args.layers or ["PARCELS"]

    ogr2ogr = find_ogr2ogr()
    with tempfile.TemporaryDirectory(prefix="dxf-parcels-") as temp_dir:
        lines_path = Path(temp_dir) / "parcel-lines.geojson"
        subprocess.run(
            [
                ogr2ogr,
                "-f",
                "GeoJSON",
                "-a_srs",
                args.source_crs,
                "-where",
                " OR ".join(f"Layer = '{layer}'" for layer in layers),
                str(lines_path),
                str(args.input_dxf),
                "entities",
                "-nln",
                "parcel_lines",
                "-skipfailures",
            ],
            check=True,
        )
        source = json.loads(lines_path.read_text(encoding="utf-8"))

    source_features = source.get("features", [])
    if args.closed_only:
        source_features = [
            feature for feature in source_features if is_closed_linestring(feature)
        ]

    lines = [
        transform(
            lambda x, y, *rest: (x, y),
            shape(feature["geometry"]),
        )
        for feature in source_features
        if feature.get("geometry")
        and feature["geometry"].get("type") in {"LineString", "MultiLineString"}
        and finite_coordinates(feature["geometry"].get("coordinates"))
    ]
    if not lines:
        raise RuntimeError(
            f'No linework found on DXF layer(s): {", ".join(layers)}.'
        )

    merged = unary_union(lines)
    to_wgs84 = Transformer.from_crs(
        args.source_crs, "EPSG:4326", always_xy=True
    ).transform
    if args.closed_only:
        geometries = []
        for line in lines:
            if line.geom_type != "LineString" or not line.is_valid:
                continue
            polygon = Polygon(remove_repeated_points(line).coords)
            if polygon.is_valid and polygon.area >= args.min_area_m2:
                geometries.append(polygon)
        if not geometries:
            raise RuntimeError("No valid closed parcel polylines were found.")
    elif args.polygonize:
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
    for index, geometry in enumerate(geometries):
        area_m2 = geometry.area
        geometry = transform(to_wgs84, geometry)
        if clip_boundary is not None and not geometry.intersects(clip_boundary):
            continue
        properties = {
            "source": args.input_dxf.name,
            "layer": ",".join(layers),
            "parcel_id": index + 1,
        }
        if args.polygonize or args.closed_only:
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
