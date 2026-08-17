"""Normalize face winding while exporting a Roblox-ready GLB.

Run with Blender, not the system Python:

    blender --background --python repair_mesh_winding.py -- input.glb output.glb
    blender --background --python repair_mesh_winding.py -- input.fbx output.glb
    blender --background --python repair_mesh_winding.py -- input.glb output.glb --seal-holes
    blender --background --python repair_mesh_winding.py -- input.glb output.glb --voxel-remesh-nonmanifold
    blender --background --python repair_mesh_winding.py -- input.glb output.glb --voxel-remesh-nonmanifold --max-triangles=18000

The pass operates on each disconnected surface independently. It first makes
adjacent faces consistent, then flips any closed component whose signed volume
points inward. Materials, object transforms, and scene hierarchy are preserved
by Blender's glTF importer/exporter.

Pass ``--seal-holes`` only after validation reports open boundaries on geometry
that was intended to be a closed solid. The option fills every remaining
boundary loop before recalculating normals; do not use it on intentionally open
surfaces.

Pass ``--voxel-remesh-nonmanifold`` only after Thrixel autofix and the normal
repair pass still leave non-manifold edges. It remeshes only the affected
semantic objects at a conservative local resolution, then normalizes winding
again. This is a last-resort Roblox compatibility pass, not a styling tool.
Use ``--max-triangles`` with it to cap any remeshed semantic object below the
Roblox per-mesh import limit.
"""

from __future__ import annotations

from pathlib import Path
import json
import struct
import sys

import bmesh
import bpy


def _arguments() -> tuple[Path, Path, dict[str, str], bool, bool, bool, int | None]:
    try:
        separator = sys.argv.index("--")
        source, destination = sys.argv[separator + 1 : separator + 3]
        options = sys.argv[separator + 3 :]
    except (ValueError, IndexError):
        raise SystemExit("usage: blender ... -- input.(glb|fbx) output.glb")
    collapse_materials = "--collapse-materials" in options
    seal_holes = "--seal-holes" in options
    voxel_remesh_nonmanifold = "--voxel-remesh-nonmanifold" in options
    max_triangles_option = next((value for value in options if value.startswith("--max-triangles=")), None)
    max_triangles = int(max_triangles_option.split("=", 1)[1]) if max_triangles_option else None
    renames = dict(pair.split("=", 1) for pair in options if "=" in pair and not pair.startswith("--"))
    return (
        Path(source).resolve(),
        Path(destination).resolve(),
        renames,
        collapse_materials,
        seal_holes,
        voxel_remesh_nonmanifold,
        max_triangles,
    )


def _face_components(bm: bmesh.types.BMesh) -> list[list[bmesh.types.BMFace]]:
    unseen = set(bm.faces)
    components: list[list[bmesh.types.BMFace]] = []
    while unseen:
        seed = unseen.pop()
        component = [seed]
        stack = [seed]
        while stack:
            face = stack.pop()
            for edge in face.edges:
                for neighbor in edge.link_faces:
                    if neighbor in unseen:
                        unseen.remove(neighbor)
                        component.append(neighbor)
                        stack.append(neighbor)
        components.append(component)
    return components


def _signed_volume(faces: list[bmesh.types.BMFace]) -> float:
    volume = 0.0
    for face in faces:
        vertices = [loop.vert.co for loop in face.loops]
        anchor = vertices[0]
        for index in range(1, len(vertices) - 1):
            volume += anchor.dot(vertices[index].cross(vertices[index + 1])) / 6.0
    return volume


def _repair(mesh: bpy.types.Mesh, seal_holes: bool) -> tuple[int, int, int, int]:
    bm = bmesh.new()
    bm.from_mesh(mesh)
    # glTF commonly duplicates the same geometric vertex at UV/normal seams.
    # Blender stores UVs per face loop, so welding these coincident vertices
    # preserves texture seams while restoring the real topological adjacency.
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    sealed_faces = 0
    if seal_holes:
        boundary_edges = [edge for edge in bm.edges if len(edge.link_faces) == 1]
        if boundary_edges:
            result = bmesh.ops.holes_fill(bm, edges=boundary_edges, sides=0)
            sealed_faces = len(result.get("faces", []))
    bm.faces.ensure_lookup_table()
    components = _face_components(bm)
    flipped = 0
    for component in components:
        bmesh.ops.recalc_face_normals(bm, faces=component)
        if _signed_volume(component) < 0.0:
            bmesh.ops.reverse_faces(bm, faces=component)
            flipped += 1
    bm.to_mesh(mesh)
    nonmanifold_edges = sum(1 for edge in bm.edges if not edge.is_manifold)
    bm.free()
    mesh.update()
    return len(components), flipped, sealed_faces, nonmanifold_edges


def _voxel_remesh(obj: bpy.types.Object, resolution: int = 72) -> None:
    longest_axis = max(obj.dimensions)
    modifier = obj.modifiers.new(name="RobloxVoxelRemesh", type="REMESH")
    modifier.mode = "VOXEL"
    modifier.voxel_size = max(longest_axis / resolution, 1e-4)
    modifier.adaptivity = 0.0
    modifier.use_remove_disconnected = False
    modifier.use_smooth_shade = False
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.select_set(False)


def _triangle_count(mesh: bpy.types.Mesh) -> int:
    mesh.calc_loop_triangles()
    return len(mesh.loop_triangles)


def _decimate(obj: bpy.types.Object, target_triangles: int) -> bool:
    current = _triangle_count(obj.data)
    if current <= target_triangles:
        return False
    modifier = obj.modifiers.new(name="RobloxTriangleCap", type="DECIMATE")
    modifier.decimate_type = "COLLAPSE"
    modifier.ratio = max(min(target_triangles / current, 1.0), 0.01)
    modifier.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.select_set(False)
    return True


def _copy_node_names_to_glb_meshes(path: Path) -> None:
    """Make semantic node names survive importers that expose mesh names only."""
    data = path.read_bytes()
    json_length, json_type = struct.unpack_from("<II", data, 12)
    if json_type != 0x4E4F534A:
        raise RuntimeError("first GLB chunk is not JSON")
    document = json.loads(data[20 : 20 + json_length].decode("utf-8"))
    meshes = document.get("meshes", [])
    for node in document.get("nodes", []):
        mesh_index = node.get("mesh")
        if isinstance(mesh_index, int) and mesh_index < len(meshes) and node.get("name"):
            meshes[mesh_index]["name"] = node["name"]
    payload = json.dumps(document, separators=(",", ":")).encode("utf-8")
    payload += b" " * ((-len(payload)) % 4)
    remainder = data[20 + json_length :]
    rebuilt = data[:12] + struct.pack("<II", len(payload), json_type) + payload + remainder
    rebuilt = rebuilt[:8] + struct.pack("<I", len(rebuilt)) + rebuilt[12:]
    path.write_bytes(rebuilt)


def main() -> None:
    (
        source,
        destination,
        renames,
        collapse_materials,
        seal_holes,
        voxel_remesh_nonmanifold,
        max_triangles,
    ) = _arguments()
    if source.suffix.lower() not in {".glb", ".fbx"} or destination.suffix.lower() != ".glb":
        raise SystemExit("input must be .glb or .fbx and output must be .glb")
    destination.parent.mkdir(parents=True, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    if source.suffix.lower() == ".fbx":
        bpy.ops.import_scene.fbx(filepath=str(source))
    else:
        bpy.ops.import_scene.gltf(filepath=str(source))

    for obj in bpy.data.objects:
        replacement = renames.get(obj.name)
        if replacement:
            obj.name = replacement
            if obj.type == "MESH":
                obj.data.name = replacement
        if collapse_materials and obj.type == "MESH":
            obj.data.materials.clear()

    repaired: set[int] = set()
    component_total = 0
    flipped_total = 0
    sealed_face_total = 0
    remeshed_total = 0
    decimated_total = 0
    for obj in bpy.data.objects:
        if obj.type != "MESH" or obj.data.as_pointer() in repaired:
            continue
        repaired.add(obj.data.as_pointer())
        components, flipped, sealed_faces, nonmanifold_edges = _repair(obj.data, seal_holes)
        if voxel_remesh_nonmanifold and nonmanifold_edges:
            _voxel_remesh(obj)
            components, flipped_after, sealed_after, nonmanifold_edges = _repair(obj.data, False)
            flipped += flipped_after
            sealed_faces += sealed_after
            remeshed_total += 1
        if max_triangles is not None and _decimate(obj, max_triangles):
            components, flipped_after, sealed_after, nonmanifold_edges = _repair(obj.data, False)
            flipped += flipped_after
            sealed_faces += sealed_after
            decimated_total += 1
        component_total += components
        flipped_total += flipped
        sealed_face_total += sealed_faces

    bpy.ops.export_scene.gltf(
        filepath=str(destination),
        export_format="GLB",
        export_yup=True,
        export_apply=False,
    )
    if renames:
        _copy_node_names_to_glb_meshes(destination)
    print(
        f"repaired {len(repaired)} meshes / {component_total} components; "
        f"flipped {flipped_total} inward components; "
        f"sealed {sealed_face_total} boundary faces; "
        f"voxel-remeshed {remeshed_total} non-manifold meshes; "
        f"decimated {decimated_total} meshes"
    )


if __name__ == "__main__":
    main()
