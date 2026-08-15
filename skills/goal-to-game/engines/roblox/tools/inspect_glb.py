#!/usr/bin/env python3
"""Static Roblox import checks for a GLB produced by the Thrixel pipeline."""

from __future__ import annotations

import argparse
import json
import math
import struct
import sys
from pathlib import Path
from typing import Any

JSON_CHUNK = 0x4E4F534A
TRIANGLES = 4
TRIANGLE_STRIP = 5
TRIANGLE_FAN = 6


def load_glb(path: Path) -> dict[str, Any]:
    data = path.read_bytes()
    if len(data) < 20:
        raise ValueError("file is too small to be a GLB")
    magic, version, declared_length = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF":
        raise ValueError("expected a binary .glb file")
    if version != 2:
        raise ValueError(f"expected glTF 2, got {version}")
    if declared_length != len(data):
        raise ValueError(
            f"GLB header length {declared_length} does not match file length {len(data)}"
        )

    offset = 12
    while offset + 8 <= len(data):
        length, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        payload = data[offset : offset + length]
        offset += length
        if chunk_type == JSON_CHUNK:
            return json.loads(payload.rstrip(b" \t\r\n\x00").decode("utf-8"))
    raise ValueError("GLB has no JSON chunk")


def primitive_triangles(doc: dict[str, Any], primitive: dict[str, Any]) -> int:
    accessors = doc.get("accessors", [])
    accessor_index = primitive.get("indices")
    if accessor_index is None:
        accessor_index = primitive.get("attributes", {}).get("POSITION")
    if accessor_index is None or not 0 <= accessor_index < len(accessors):
        return 0
    count = int(accessors[accessor_index].get("count", 0))
    mode = int(primitive.get("mode", TRIANGLES))
    if mode == TRIANGLES:
        return count // 3
    if mode in (TRIANGLE_STRIP, TRIANGLE_FAN):
        return max(0, count - 2)
    return 0


def inspect(doc: dict[str, Any], max_triangles: int) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    meshes = doc.get("meshes", [])
    nodes = doc.get("nodes", [])
    materials = doc.get("materials", [])
    mesh_rows: list[dict[str, Any]] = []

    if not meshes:
        errors.append("no meshes found")
    if doc.get("skins"):
        errors.append("skinned meshes are outside the Roblox engine path")

    referenced_meshes: dict[int, list[str]] = {}
    seen_names: set[str] = set()
    for index, node in enumerate(nodes):
        name = str(node.get("name", "")).strip()
        if not name:
            warnings.append(f"node[{index}] has no name")
            name = f"node[{index}]"
        elif name in seen_names:
            warnings.append(f"duplicate node name: {name}")
        seen_names.add(name)
        if "mesh" in node:
            referenced_meshes.setdefault(int(node["mesh"]), []).append(name)
        for key in ("matrix", "translation", "rotation", "scale"):
            values = node.get(key, [])
            if any(not math.isfinite(float(value)) for value in values):
                errors.append(f"{name} has a non-finite {key}")

    for mesh_index, mesh in enumerate(meshes):
        primitives = mesh.get("primitives", [])
        triangle_count = sum(primitive_triangles(doc, p) for p in primitives)
        material_ids = sorted({int(p["material"]) for p in primitives if "material" in p})
        names = referenced_meshes.get(mesh_index, [])
        display = names[0] if names else str(mesh.get("name") or f"mesh[{mesh_index}]")
        if not primitives:
            errors.append(f"{display} has no primitives")
        unsupported = [int(p.get("mode", TRIANGLES)) for p in primitives if int(p.get("mode", TRIANGLES)) not in (TRIANGLES, TRIANGLE_STRIP, TRIANGLE_FAN)]
        if unsupported:
            errors.append(f"{display} contains non-triangle primitive modes {unsupported}")
        if triangle_count > max_triangles:
            errors.append(
                f"{display} has {triangle_count} triangles; Roblox boundary is {max_triangles}"
            )
        if len(material_ids) > 1:
            labels = [str(materials[i].get("name") or i) if i < len(materials) else str(i) for i in material_ids]
            errors.append(
                f"{display} uses {len(material_ids)} materials {labels}; split it into one object per material"
            )
        if mesh_index not in referenced_meshes:
            warnings.append(f"mesh[{mesh_index}] is not referenced by a node")
        mesh_rows.append(
            {
                "mesh": display,
                "nodes": names,
                "triangles": triangle_count,
                "primitiveCount": len(primitives),
                "materialCount": len(material_ids),
            }
        )

    return {
        "ok": not errors,
        "errors": errors,
        "warnings": warnings,
        "summary": {
            "nodes": len(nodes),
            "meshes": len(meshes),
            "materials": len(materials),
            "triangles": sum(row["triangles"] for row in mesh_rows),
            "maxTrianglesPerMesh": max_triangles,
        },
        "meshParts": mesh_rows,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("glb", type=Path)
    parser.add_argument("--max-triangles", type=int, default=18_000)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    try:
        result = inspect(load_glb(args.glb), args.max_triangles)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        result = {"ok": False, "errors": [str(exc)], "warnings": []}

    output = json.dumps(result, indent=2, sort_keys=True)
    print(output)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(output + "\n", encoding="utf-8")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
