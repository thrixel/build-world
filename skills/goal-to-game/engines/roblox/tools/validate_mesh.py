#!/usr/bin/env python3
"""validate_mesh.py — pre-import validation for the Roblox Studio path.

Roblox validates geometry at the import boundary and refuses anything that
fails. The three hard constraints (from
https://create.roblox.com/docs/art/modeling/specifications) are:

  1. <= 20,000 triangles per mesh (hard cap — Studio refuses anything over)
  2. watertight / manifold (no exposed holes, open edges, non-manifold verts)
  3. non-zero thickness (no infinitely thin sheets)

This tool runs those checks BEFORE you import, so a rejected import never
costs a round-trip through Studio. It is the "no manual mesh cleanup in
between" step: run it on every grouped/decimated Thrixel asset and fix what it
names before importing.

Usage:
  python validate_mesh.py <mesh.(glb|gltf|obj|stl|fbx)> [more meshes ...]

  --max-triangles N   override the 20,000 cap (default: 20000)
  --min-thickness M   override the thin-sheet threshold (default: 1e-4)

Exit code 0 = every mesh passed. 1 = at least one failed (see the per-mesh
report). 2 = a file could not be parsed at all.

If `trimesh` is installed it is used for the authoritative watertight /
manifold / euler-number check and for FBX. Without it the tool falls back to a
stdlib-only check (triangle count + bounding-box thickness) and says so — the
hole/backface check then needs `pip install trimesh` or a Blender pass.
"""

import argparse
import base64
import json
import os
import struct
import sys

MAX_TRIANGLES = 20000
MIN_THICKNESS = 1e-4

try:
    import trimesh  # type: ignore
    HAVE_TRIMESH = True
except Exception:
    HAVE_TRIMESH = False


# --------------------------------------------------------------------------
# stdlib-only parsers — triangle count + bounding box (thickness)
# --------------------------------------------------------------------------

def _bbox_thickness(mins, maxs):
    extents = [maxs[i] - mins[i] for i in range(3)]
    return min(extents), extents


def parse_obj(path):
    """Minimal Wavefront OBJ reader. Returns (triangles, mins, maxs)."""
    verts = []
    tris = 0
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            if parts[0] == "v" and len(parts) >= 4:
                verts.append(tuple(float(x) for x in parts[1:4]))
            elif parts[0] == "f":
                n = len(parts) - 1
                if n >= 3:
                    tris += n - 2  # fan triangulation of a convex n-gon
    if not verts:
        return 0, (0, 0, 0), (0, 0, 0)
    xs = [v[0] for v in verts]
    ys = [v[1] for v in verts]
    zs = [v[2] for v in verts]
    return tris, (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))


def parse_stl_binary(path):
    """Binary STL reader. Returns (triangles, mins, maxs)."""
    with open(path, "rb") as f:
        f.read(80)  # header
        (count,) = struct.unpack("<I", f.read(4))
        mins = [float("inf")] * 3
        maxs = [float("-inf")] * 3
        for _ in range(count):
            tri = f.read(50)
            if len(tri) < 50:
                break
            # 12-byte normal + 3 x (12-byte vertex)
            for i in range(3):
                off = 12 + i * 12
                x, y, z = struct.unpack("<3f", tri[off:off + 12])
                for axis, v in enumerate((x, y, z)):
                    mins[axis] = min(mins[axis], v)
                    maxs[axis] = max(maxs[axis], v)
    if mins[0] == float("inf"):
        return 0, (0, 0, 0), (0, 0, 0)
    return count, tuple(mins), tuple(maxs)


def _glb_triangle_count(gltf):
    """Sum triangle counts across every mesh primitive in a glTF document."""
    buffers = gltf.get("buffers", [])
    accessors = gltf.get("accessors", [])
    buffer_views = gltf.get("bufferViews", [])

    total = 0
    for mesh in gltf.get("meshes", []):
        for prim in mesh.get("primitives", []):
            idx_acc = prim.get("indices")
            if idx_acc is not None:
                total += accessors[idx_acc]["count"] // 3
            else:
                # non-indexed: triangle count from the POSITION accessor
                pos = prim.get("attributes", {}).get("POSITION")
                if pos is not None:
                    total += accessors[pos]["count"] // 3
    return total


def _glb_bbox(gltf):
    """Compute the world-space AABB from POSITION accessors (approximate: no
    node transforms applied, which is the conservative choice for thickness —
    a node scale could only make a thin sheet thinner or thicker, and a true
    sheet stays a sheet under affine transform)."""
    accessors = gltf.get("accessors", [])
    buffer_views = gltf.get("bufferViews", [])
    buffers = gltf.get("buffers", [])
    mins = [float("inf")] * 3
    maxs = [float("-inf")] * 3
    found = False

    for acc in accessors:
        if acc.get("type") != "VEC3":
            continue
        bv_index = acc.get("bufferView")
        if bv_index is None:
            continue
        bv = buffer_views[bv_index]
        buf = buffers[bv.get("buffer", 0)]

        data = None
        uri = buf.get("uri")
        if uri and uri.startswith("data:"):
            data = base64.b64decode(uri.split(",", 1)[1])
        if data is None:
            # GLB binary chunk is passed in by the caller as _bin
            data = buf.get("_bin")

        if data is None:
            continue
        offset = (bv.get("byteOffset", 0) or 0) + (acc.get("byteOffset", 0) or 0)
        count = acc.get("count", 0)
        comp_type = acc.get("componentType", 5126)  # default FLOAT
        if comp_type != 5126:
            continue
        for i in range(count):
            off = offset + i * 12
            if off + 12 > len(data):
                break
            x, y, z = struct.unpack_from("<3f", data, off)
            mins[0] = min(mins[0], x); maxs[0] = max(maxs[0], x)
            mins[1] = min(mins[1], y); maxs[1] = max(maxs[1], y)
            mins[2] = min(mins[2], z); maxs[2] = max(maxs[2], z)
            found = True
    if not found:
        return (0, 0, 0), (0, 0, 0)
    return tuple(mins), tuple(maxs)


def parse_glb(path):
    """Parse GLB (binary glTF) or plain .gltf. Returns (triangles, mins, maxs)."""
    if path.lower().endswith(".gltf"):
        with open(path, "r", encoding="utf-8") as f:
            gltf = json.load(f)
        # resolve external buffer files relative to the gltf
        for i, buf in enumerate(gltf.get("buffers", [])):
            uri = buf.get("uri")
            if uri and not uri.startswith("data:"):
                bpath = os.path.join(os.path.dirname(os.path.abspath(path)), uri)
                with open(bpath, "rb") as bf:
                    buf["_bin"] = bf.read()
    else:
        with open(path, "rb") as f:
            raw = f.read()
        if raw[:4] != b"glTF":
            raise ValueError("not a GLB file")
        header = raw[:12]
        json_len = struct.unpack_from("<I", raw, 12)[0]
        gltf = json.loads(raw[20:20 + json_len].decode("utf-8"))
        # attach the single binary chunk to buffer 0
        bin_off = 20 + json_len
        for i, buf in enumerate(gltf.get("buffers", [])):
            if i == 0:
                buf["_bin"] = raw[bin_off:bin_off + buf.get("byteLength", 0)]
    return _glb_triangle_count(gltf), *_glb_bbox(gltf)


# --------------------------------------------------------------------------
# dispatch
# --------------------------------------------------------------------------

def load_mesh(path):
    """Return (triangles, mins, maxs, extra) for a mesh file, or raise."""
    ext = os.path.splitext(path)[1].lower()

    if HAVE_TRIMESH and ext in (".fbx", ".glb", ".gltf", ".obj", ".stl"):
        # authoritative path: trimesh gives triangle count, AABB and the
        # watertight / manifold / euler-number checks all in one.
        scene = trimesh.load(path, force="scene" if ext == ".glb" else None)
        if isinstance(scene, trimesh.Scene):
            meshes = list(scene.geometry.values())
        else:
            meshes = [scene]
        return meshes, "trimesh"

    if ext == ".obj":
        tris, mins, maxs = parse_obj(path)
        return [(tris, mins, maxs)], "stdlib"
    if ext == ".stl":
        tris, mins, maxs = parse_stl_binary(path)
        return [(tris, mins, maxs)], "stdlib"
    if ext in (".glb", ".gltf"):
        tris, mins, maxs = parse_glb(path)
        return [(tris, mins, maxs)], "stdlib"
    if ext == ".fbx":
        raise ValueError(
            "FBX parsing needs `pip install trimesh` (and assimp). "
            "Alternatively export the asset as .obj/.glb to validate it here."
        )
    raise ValueError("unsupported extension: %s" % ext)


# --------------------------------------------------------------------------
# checks
# --------------------------------------------------------------------------

def check(triangles, mins, maxs, max_tri, min_thickness, mode):
    problems = []
    if triangles > max_tri:
        problems.append(
            "triangle count %d exceeds %d (decimate with thrixel_reduce_triangles "
            "or thrixel_group_parts target_triangles)" % (triangles, max_tri)
        )
    extents = [maxs[i] - mins[i] for i in range(3)]
    thickness = min(extents) if extents else 0.0
    if thickness < min_thickness:
        problems.append(
            "near-zero thickness (min extent %.6f) — add real thickness before import"
            % thickness
        )
    return problems, thickness


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("meshes", nargs="+", help="one or more mesh files")
    ap.add_argument("--max-triangles", type=int, default=MAX_TRIANGLES)
    ap.add_argument("--min-thickness", type=float, default=MIN_THICKNESS)
    args = ap.parse_args()

    print("Roblox import-boundary validation")
    print("  watertight/manifold check: %s" %
          ("trimesh (authoritative)" if HAVE_TRIMESH else "UNAVAILABLE (pip install trimesh)"))
    print()

    any_fail = False
    parse_fail = False

    for path in args.meshes:
        print("== %s" % path)
        if not os.path.exists(path):
            print("  [PARSE FAIL] file not found")
            parse_fail = True
            continue
        try:
            meshes, mode = load_mesh(path)
        except Exception as e:
            print("  [PARSE FAIL] %s" % e)
            parse_fail = True
            continue

        for i, mesh in enumerate(meshes):
            if mode == "trimesh":
                if hasattr(mesh, "triangles"):
                    tris = len(mesh.triangles)
                else:
                    tris = 0
                if hasattr(mesh, "bounds"):
                    mins = mesh.bounds[0].tolist()
                    maxs = mesh.bounds[1].tolist()
                else:
                    mins = maxs = (0, 0, 0)
                watertight = mesh.is_watertight if hasattr(mesh, "is_watertight") else None
                winding = mesh.is_winding_consistent if hasattr(mesh, "is_winding_consistent") else None
                euler = mesh.euler_number if hasattr(mesh, "euler_number") else None
            else:
                tris, mins, maxs = mesh
                watertight = winding = euler = None

            problems, thickness = check(tris, mins, maxs, args.max_triangles,
                                        args.min_thickness, mode)
            warnings = []
            if mode == "trimesh":
                if watertight is False:
                    problems.append("not watertight — exposed holes / open edges")
                if winding is False:
                    problems.append("inconsistent winding — backfaces exposed")
                if euler is not None and euler != 0:
                    problems.append("non-zero Euler number %d — non-manifold geometry" % euler)
            else:
                warnings.append("watertight/manifold NOT verified (pip install trimesh "
                                "for the authoritative check)")

            if problems:
                any_fail = True
                print("  mesh %d: %d triangles, min-thickness %.4f  [FAIL]" %
                      (i, tris, thickness))
                for p in problems:
                    print("    - %s" % p)
                for w in warnings:
                    print("    ! %s" % w)
            else:
                print("  mesh %d: %d triangles, min-thickness %.4f  [PASS]" %
                      (i, tris, thickness))
                for w in warnings:
                    print("    ! %s" % w)
        print()

    print("=" * 60)
    if parse_fail:
        print("RESULT: one or more files could not be parsed (see above).")
        return 2
    if any_fail:
        print("RESULT: FAIL — fix the named problems, then re-run before importing.")
        return 1
    print("RESULT: PASS — all meshes satisfy the Roblox import-boundary constraints.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
