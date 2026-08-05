#!/usr/bin/env python3
"""Write a DXF copy without selected layer entities.

Example:
  python3 scripts/remove-dxf-layers.py \
    input.dxf output_no_rivers.dxf \
    --layer creek \
    --layer RIVER

The original DXF is never modified. Matching entities are removed from model
space and block definitions so the cleaned copy does not bring the layers
back through an INSERT.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import ezdxf


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_dxf", type=Path)
    parser.add_argument("output_dxf", type=Path)
    parser.add_argument(
        "--layer",
        action="append",
        required=True,
        help="Layer to remove; repeatable and case-insensitive",
    )
    args = parser.parse_args()

    document = ezdxf.readfile(str(args.input_dxf))
    target_layers = {layer.casefold() for layer in args.layer}
    removed = 0
    removed_by_layer = {layer: 0 for layer in args.layer}

    for block in document.blocks:
        for entity in list(block):
            layer = str(entity.dxf.layer or "")
            if layer.casefold() not in target_layers:
                continue
            block.delete_entity(entity)
            removed += 1
            for requested in args.layer:
                if requested.casefold() == layer.casefold():
                    removed_by_layer[requested] += 1

    args.output_dxf.parent.mkdir(parents=True, exist_ok=True)
    document.saveas(str(args.output_dxf))
    detail = ", ".join(f"{layer}: {count}" for layer, count in removed_by_layer.items())
    print(f"Removed {removed} entities ({detail}).")
    print(f"Wrote {args.output_dxf}; original file was not changed.")


if __name__ == "__main__":
    main()
