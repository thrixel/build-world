#!/usr/bin/env python3
"""Validate a Thrixel GLB at Roblox's rigid-mesh import boundary."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

import numpy as np
import trimesh


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("mesh", type=Path)
    parser.add_argument("--json", dest="json_path", type=Path)
    parser.add_argument("--max-triangles", type=int, default=20_000)
    parser.add_argument("--min-thickness", type=float, default=1e-5)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    path = args.mesh.resolve()
    try:
        display_source = path.relative_to(Path.cwd().resolve()).as_posix()
    except ValueError:
        display_source = str(path)
    errors: list[str] = []
    warnings: list[str] = []

    if not path.is_file():
        print(f"ERROR: file does not exist: {path}", file=sys.stderr)
        return 2
    header = path.read_bytes()[:4]
    if path.suffix.lower() == ".glb" and header != b"glTF":
        print(f"ERROR: {path} is not a binary glTF file (header={header!r})", file=sys.stderr)
        return 2

    loaded = trimesh.load(path, force="scene", process=False)
    scene = loaded if isinstance(loaded, trimesh.Scene) else trimesh.Scene(loaded)
    meshes = []
    for name, source_geometry in scene.geometry.items():
        if not isinstance(source_geometry, trimesh.Trimesh):
            continue
        # glTF duplicates vertices at UV/normal seams. Weld an inspection copy so those
        # deliberate attribute splits are not misdiagnosed as topological holes. The
        # downloaded source and its UVs are never modified.
        geometry = source_geometry.copy()
        geometry.merge_vertices(merge_tex=True, merge_norm=True)
        geometry.remove_unreferenced_vertices()
        triangles = int(len(geometry.faces))
        extents = np.asarray(geometry.extents, dtype=float)
        signed_volume = float(geometry.volume)
        volume = float(abs(signed_volume)) if math.isfinite(signed_volume) else 0.0
        item_errors = []
        if triangles == 0:
            item_errors.append("has no triangles")
        if triangles > args.max_triangles:
            item_errors.append(f"has {triangles} triangles (limit {args.max_triangles})")
        if not geometry.is_watertight:
            item_errors.append("is not watertight")
        if not geometry.is_winding_consistent:
            item_errors.append("has inconsistent winding/backfaces")
        elif signed_volume < -(args.min_thickness**3):
            item_errors.append("has inward-facing winding")
        if not np.all(np.isfinite(extents)) or float(np.min(extents)) <= args.min_thickness:
            item_errors.append(f"has zero/invalid thickness (extents={extents.tolist()})")
        if not math.isfinite(volume) or volume <= args.min_thickness**3:
            item_errors.append(f"has zero/invalid enclosed volume ({volume})")
        errors.extend(f"{name}: {message}" for message in item_errors)
        meshes.append(
            {
                "name": name,
                "triangles": triangles,
                "watertight": bool(geometry.is_watertight),
                "windingConsistent": bool(geometry.is_winding_consistent),
                "isVolume": bool(geometry.is_volume),
                "volume": volume,
                "extents": [float(value) for value in extents],
                "errors": item_errors,
            }
        )

    if not meshes:
        errors.append("file contains no triangle mesh objects")

    report = {
        "schemaVersion": 1,
        "source": display_source,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "bytes": path.stat().st_size,
        "maxTrianglesPerMesh": args.max_triangles,
        "meshCount": len(meshes),
        "triangleTotal": sum(mesh["triangles"] for mesh in meshes),
        "meshes": meshes,
        "warnings": warnings,
        "errors": errors,
        "passed": not errors,
    }

    rendered = json.dumps(report, indent=2, sort_keys=True)
    print(rendered)
    if args.json_path:
        args.json_path.parent.mkdir(parents=True, exist_ok=True)
        args.json_path.write_text(rendered + "\n", encoding="utf-8")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
