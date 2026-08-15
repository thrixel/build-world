#!/usr/bin/env python3
"""Blender 4.x script: normalize GLB objects for Roblox 3D Importer.

Run with:
  blender --background --python normalize_glb.py -- --input in.glb --output out.glb
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

import bmesh  # type: ignore
import bpy  # type: ignore
from mathutils import Matrix  # type: ignore


def cli() -> argparse.Namespace:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--target-triangles", type=int, default=18_000)
    parser.add_argument("--rotate-x-degrees", type=float, default=0.0)
    parser.add_argument("--rotate-y-degrees", type=float, default=0.0)
    parser.add_argument("--rotate-z-degrees", type=float, default=0.0)
    return parser.parse_args(values)


def activate(obj: bpy.types.Object) -> None:
    bpy.ops.object.mode_set(mode="OBJECT") if bpy.context.object and bpy.context.object.mode != "OBJECT" else None
    bpy.ops.object.select_all(action="DESELECT")
    obj.hide_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def used_materials(obj: bpy.types.Object) -> list[str]:
    indices = sorted({polygon.material_index for polygon in obj.data.polygons})
    result: list[str] = []
    for index in indices:
        slot = obj.material_slots[index] if index < len(obj.material_slots) else None
        result.append(slot.material.name if slot and slot.material else f"material-{index}")
    return result


def triangles(obj: bpy.types.Object) -> int:
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


def weld_and_triangulate(obj: bpy.types.Object) -> None:
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    if bm.verts:
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.00001)
    if bm.faces:
        bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()


def non_manifold_edges(obj: bpy.types.Object) -> int:
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    count = sum(1 for edge in bm.edges if not edge.is_manifold)
    bm.free()
    return count


def safe_label(value: str) -> str:
    label = re.sub(r"[^A-Za-z0-9_-]+", "_", value).strip("_")
    return label or "Material"


def split_materials() -> None:
    originals = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    for obj in originals:
        source_group = obj.name
        obj["thrixelSourceGroup"] = source_group
        if len(used_materials(obj)) <= 1:
            continue
        activate(obj)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.separate(type="MATERIAL")
        bpy.ops.object.mode_set(mode="OBJECT")
        pieces = [candidate for candidate in bpy.context.selected_objects if candidate.type == "MESH"]
        for piece in pieces:
            piece["thrixelSourceGroup"] = source_group
            material = used_materials(piece)[0]
            piece.name = f"{source_group}__{safe_label(material)}"


def apply_orientation(args: argparse.Namespace) -> None:
    rotation = Matrix.Identity(4)
    for degrees, axis in (
        (args.rotate_x_degrees, "X"),
        (args.rotate_y_degrees, "Y"),
        (args.rotate_z_degrees, "Z"),
    ):
        if degrees:
            rotation = Matrix.Rotation(math.radians(degrees), 4, axis) @ rotation
    if rotation != Matrix.Identity(4):
        for obj in bpy.context.scene.objects:
            if obj.type == "MESH":
                obj.matrix_world = rotation @ obj.matrix_world


def main() -> int:
    args = cli()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(args.input.resolve()))
    apply_orientation(args)
    split_materials()

    rows: list[dict[str, object]] = []
    errors: list[str] = []
    mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    for obj in mesh_objects:
        activate(obj)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        weld_and_triangulate(obj)
        before = triangles(obj)
        if before > args.target_triangles:
            modifier = obj.modifiers.new(name="RobloxTriangleBudget", type="DECIMATE")
            modifier.decimate_type = "COLLAPSE"
            modifier.ratio = max(0.01, args.target_triangles / before)
            modifier.use_collapse_triangulate = True
            bpy.ops.object.modifier_apply(modifier=modifier.name)
            weld_and_triangulate(obj)
        after = triangles(obj)
        materials = used_materials(obj)
        open_edges = non_manifold_edges(obj)
        if after > args.target_triangles:
            errors.append(f"{obj.name}: {after} triangles exceeds {args.target_triangles}")
        if len(materials) > 1:
            errors.append(f"{obj.name}: material split failed ({materials})")
        if open_edges:
            errors.append(f"{obj.name}: {open_edges} non-manifold/boundary edges")
        rows.append(
            {
                "name": obj.name,
                "sourceGroup": str(obj.get("thrixelSourceGroup", obj.name)),
                "trianglesBefore": before,
                "trianglesAfter": after,
                "materials": materials,
                "nonManifoldEdges": open_edges,
            }
        )

    if not mesh_objects:
        errors.append("no mesh objects imported")
    report = {
        "ok": not errors,
        "input": str(args.input),
        "output": str(args.output),
        "targetTrianglesPerMesh": args.target_triangles,
        "orientationDegrees": {
            "x": args.rotate_x_degrees,
            "y": args.rotate_y_degrees,
            "z": args.rotate_z_degrees,
        },
        "errors": errors,
        "objects": rows,
    }
    report_path = args.report or args.output.with_suffix(".normalize.json")
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    if errors:
        return 1

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=str(args.output.resolve()),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_materials="EXPORT",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
