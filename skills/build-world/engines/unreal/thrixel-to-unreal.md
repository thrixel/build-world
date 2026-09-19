# Thrixel assets into Unreal 5.8 through MCP

Engine-specific companion to the `thrixel:build-world` skill: how to get Thrixel output into an
Unreal level correctly, and what to build in engine instead of generating. Design choices (what to
generate, how to lay a scene out) belong to the build-world skill and the request; nothing here
prescribes them. Read together with `unreal.md` (inspection loop) and
`community-field-notes/headless-autonomy.md`.

## Which Thrixel path, and what not to send to Thrixel at all

| Asset kind | Use | Why |
|---|---|---|
| Furniture, fixtures, buildings, vehicles, tools, fences, any manufactured object | **Architect** (`thrixel_create_model`), then `thrixel_retexture_model` if the Architect texture is flat | Clean planar geometry, straight edges, named parts you can keep separate (doors, wheels, lids). Sculptor rounds off hard-surface shapes and bakes seams into the texture. |
| Creatures, plants, rocks, food, cloth, anything organic and static | **Sculptor** | Best organic silhouettes and textures, one mesh, cheaper than Architect + Detailer. |
| Terrain, water surfaces, roads/paths, and anything placed in the hundreds (grass, pebbles, litter, forest) | **Engine, not Thrixel** | A generated mesh is one object at one scale. Large surfaces want a procedural material and a mesh shaped to the level; mass placement wants instancing driven by a function. Thrixel still makes the *unit* (one tuft, one tree); the engine makes the field. |

The style guide (`thrixel_add_project_source`) is where shared rules live: real-world sizes, "no
ground plane / base", resting on Y=0 facing +Z, texture size. Prompts inherit it.

## Generate in waves, convert early

- Submit `wait=false` in waves, poll `thrixel_job_status`, keep working in the editor. On a busy
  shared GPU lane sculpts took 3-12 minutes; Architect jobs are metered and slow (props ~20
  minutes, buildings 25-55 minutes). Submit them first and place a scaled primitive as a stand-in
  rather than blocking on them.
- `thrixel_retexture_model` on a finished mesh gives colour variants for the price of a texture
  pass; use it before generating a second near-identical asset.
- Anything to be instanced many times goes through `thrixel_reduce_triangles` (free) first: a
  150k-triangle sculpted tree at ~14k reads the same past a few metres and can be instanced in
  the hundreds. Keep the full-resolution original for close-up placements.
- For multipart models, reduce **before** `thrixel_group_parts` when the original ungrouped
  source is available. Inspect triangle counts after reduction and grouping to make sure it worked.
- Group static parts before downloading; retain only parts that must move separately. Material
  slots survive grouping, so one grouped mesh is not necessarily one draw call.
- **Order of operations for multipart models: Texture and Edit on the ungrouped parent, group
  last.** `thrixel_retexture_model` on an already-grouped result splits it again (a one-mesh
  grouped prop came back as 36 parts) and needs a second grouping; run on the parent, the named
  groups survive and `thrixel_group_parts` works once at the end.
- Architect doesn't paint detailed pictures: framed art arrives with blank canvases, book covers and
  small props can come back in one flat colour, and wood can arrive without grain. Look at the
  thumbnail and budget a Texture pass for artwork and for anything that will be a focal point.
  On furniture with open interiors a Texture pass can project interior shelf lines onto outer
  panels; check the outside faces, and if they are marked, keep the untextured model and assign
  an existing grained material to its named slots instead (see Materials below).
- A Sculptor prompt for a flat-lying subject (a curled animal, a rug) can return a flat card
  with a picture on it. Say "fully three-dimensional", give dimensions, add "no picture frame, no
  base", and check the bounds: a depth of a few millimetres is the giveaway.
- Scope `thrixel_edit_model` with `focus_on_node_names` (exact names from
  `thrixel_inspect_model`) rather than describing the target parts only in prose.
- `thrixel_inspect_model` pages long models heaviest-first and lists **groups last**; page with
  `offset` to find names such as `Left_Door_Group`, which work directly as `aliases` in
  `keep_groups`.
- `thrixel_download` on a job that has not completed errors out; poll status first.

## Download the right format

`StaticMeshTools.import_file` uses the FBX factory: **only `.fbx` and `.obj`**, GLB is refused.
The first `thrixel_download(format="fbx")` for an asset starts a server-side conversion and
returns a **small JSON stub** (`"status":"queued"`, under 1 KB) instead of the model. Check the
contents, wait, request again; valid small FBXs can be only tens or hundreds of KB. Binary FBX
starts with `Kaydara FBX Binary`, while the stub is JSON. `tools/fbx_texture_map.py` rejects
stubs and reads binary FBX material/texture connections. Request FBX for every asset as soon
as it completes so the latency overlaps other work.

Downloads land under `<cwd>/thrixel_assets/`. If the working directory is a repo, `.gitignore` it.

## Import

```
StaticMeshTools.import_file(folder_path="/Game/<Game>/<Category>/<Asset>", asset_name="SM_<Asset>",
                            source_file="<abs>.fbx", import_materials=true, import_textures=true, combine_meshes=true)
```

- **`combine_meshes`**: `true` for anything that is one rigid object (Sculptor output, or Architect
  output grouped into a single `Body`). `false` when `thrixel_group_parts` kept groups you intend
  to move: the importer then creates one StaticMesh per FBX node, named
  `<asset_name>_<node name>` with spaces as underscores (`SM_Bench_Body`,
  `SM_Bench_Left_flat_steel_sled_leg`), all sharing one `Material_0`/`Image_0`. Verified on 5.8.
- **Part pivots are baked away by the importer, not by Thrixel.** The FBX carries a proper
  transform tree with each kept part pivoted at its own bounding-box centre (checked in Blender
  and by importing with the option below). Unreal's FBX factory defaults to *Transform Vertex
  To Absolute*, which bakes every node transform into the vertices, so after `import_file` each
  part's pivot is the model origin (a leg's bounds sit at x -88..-83 instead of around 0).
  `import_file` does not expose the option. Two workable routes:
  1. Keep the baked import (parts reassemble exactly at relative location 0) and re-pivot in
     engine: wrap each moving part in a scene component at the pivot origin that
     `thrixel_group_parts` reported (x100 for cm, glTF (x,y,z) -> UE (x,z,y)) and offset the mesh
     by the negative of that.
  2. Import through editor Python (`unreal.AssetImportTask` + `FbxImportUI`, `static_mesh_import_data.
     transform_vertex_to_absolute = False`, `bake_pivot_in_vertex = False`, `combine_meshes = False`)
     - pivots come in at the part centres, but node scale is not applied either (meshes arrive in
     raw file units), so you then rebuild the hierarchy with the node transforms yourself. Route 1
     is less work for a handful of moving parts.
- **Hinges, lids and drawers with route 1.** `thrixel_group_parts` pivots are part centers, good for
  wheels and rotors, but not doors which should pivot on an edge. After a `combine_meshes=false`
  import every part mesh is in model space, so read the part's own `get_bounds` and pick the
  hinge line from it (for a door whose front is +Y: the outer vertical edge, `x = min or max`,
  `y =` the carcass front). Then, for a cabinet placed at `P` with yaw `θ` and scale `s`:
  spawn one movable actor per part at `P + Rz(θ)·(hinge·s)` with the same yaw and scale, give it
  the part mesh, and offset the mesh component by `-hinge` (unscaled local units) so the part
  sits exactly where it did in the closed model. Rotate or slide the *actor*:
  - door: yaw about Z, opposite signs for left and right leaves;
  - lid hinged along the model's X axis: yaw the actor `θ+90`, counter-rotate the mesh component
    by `-90` and offset it by `(-hinge.y, hinge.x, -hinge.z)`, then drive pitch;
  - drawer: no offset, slide along the model's front axis rotated into world space.
  The component offset must be written through editor Python, not `set_properties` (only the
  first member of a vector lands on a Blueprint actor's component - gotchas file, ObjectTools).
  Turn collision off on the moving part and leave it on the body.
- **One folder per asset.** Atlas exports often reuse `Image_0` and `Material_0`; multipart
  exports can instead contain many named materials and PNGs. A dedicated folder avoids name
  collisions between unrelated assets.
- **Measure normalized scale.** Import dimensions vary with the generation/conversion path
  (both 100 and 200 UE units along the longest axis were observed). Keep a desired size table and
  derive scale from the actual imported bounds; do not assume every export is one metre.
- **Axes.** After FBX conversion glTF Y (up) -> UE Z and glTF Z -> UE Y; X stays. Record each
  mesh's long axis from `get_bounds` - shaders and facing depend on it.
- **Facing.** Derive it, do not guess. Thrixel thumbnails are rendered from the (+X, +Y up, +Z)
  octant: screen-left is glTF +Z, screen-right is glTF +X. A front that appears lower-left is at
  glTF +Z = UE +Y after import. Then confirm once in a floating PIE window from close range.
  For creatures, settle it from geometry instead of a thumbnail. Verify with two frames a second apart:
  displacement must point the same way as the head. If a facing offset lives on a Blueprint component's
  `relativeRotation`, remember only `pitch` is written by `set_properties`; a yaw that "did not take"
  leaves the mesh sideways to its motion.
- **Check back faces.** Thin parts or surfaces visible from inside may need two-sided
  materials. Keep closed opaque surfaces single-sided unless inspection shows a need; blanket
  two-sided shading adds work. Recompile/save changed materials.
- Enable Nanite where compatible and useful; inspect small props and unsupported/translucent
  surfaces separately rather than assuming every import benefits.
- Swapping a component's `staticMesh` through `set_properties` **clears its `overrideMaterials`**;
  set both in the same call or reapply the override.

## Persist material usage flags after enabling Nanite or instancing

Enabling Nanite on a mesh also requires its materials to support Nanite. UE 5.8.2 can
repair a missing usage flag in memory when loading the scene and report a Map Check warning:
"missing the usage flag Nanite". Save the material itself after this repair; saving only the
map does not persist the material flag. Apply this to material overrides as well as imported
materials. Instanced foliage can similarly need `InstancedStaticMeshes` usage.

Set the intended usage explicitly in authoring scripts before their final material save:

```python
unreal.MaterialEditingLibrary.set_base_material_usage(material, unreal.MaterialUsage.MATUSAGE_NANITE, True)
unreal.MaterialEditingLibrary.recompile_material(material)
assert unreal.EditorAssetLibrary.save_loaded_asset(material, only_if_is_dirty=False)
```

For instanced meshes use `unreal.MaterialUsage.MATUSAGE_INSTANCED_STATIC_MESHES`. These are
UE 5.8.2 APIs. Check usage with `MaterialEditingLibrary.has_material_usage` after loading the
saved material in a fresh process, and rerun Map Check. Fix usage on the existing materials;
do not regenerate the level to clear these warnings when a user has manual layout edits.
Cook/package again when the updated assets need to be included in a standalone build.

## Repair missing imported texture connections

A successful FBX import can leave TextureSample nodes without a texture, even though the PNGs
were extracted beside the FBX in `<model>.fbm/`. Check shader warnings and the material graph;
a saved mesh or clean-looking thumbnail does not establish that the material will cook.

For an atlas export, bind the intended atlas explicitly. For a multipart export, **do not bind
Image_0 to every slot**: resolve each Material→Texture DiffuseColor connection in the FBX.
`tools/fbx_texture_map.py model.fbx` emits that mapping. `tools/ue_bind_fbx_textures.py` can plan
or apply bindings inside a dedicated fresh-import folder; see `tools/README.md` for usage.
It defaults to dry run. Applying replaces those imported material graphs, so it is unsuitable
for materials someone has already authored. Keep user material overrides separate.

The FBX can itself be wrong: normal-map-purple images were observed on diffuse connections.
Inspect source maps and the in-level result. The binding helper rejects textures Unreal marks
as normal maps; this heuristic does not detect every semantic mismatch. Choose a correct source
map or an appropriate material manually instead of blindly accepting the connection metadata.

## Materials the import does not give you

The imported `Material_0` is a plain textured material. For anything more, author one master
material with `MaterialTools` and one `MaterialInstanceConstant` per asset that plugs the imported
`Image_0` in via `MaterialInstanceTools.set_texture_parameter`. This is how independent imports
get shared behaviour (wind, swim, wetness, emissive) without touching each mesh.

Wiring notes for scripts:

- Single-input nodes (`Sine`, `Saturate`, `Transform`) report their input name as `"None"`;
  connect with `to_input_name: ""`. For multi-input nodes read the names (`A`/`B`, `Coordinate`,
  `UVs`, `VectorInput`, `World Position`) and let a wrong name fail before the script grows.
- `connect_to_output(..., output_name: "")` works for every node's first output.
- Through MCP `set_properties`, property names are camelCase of the UPROPERTY (`constant`, `defaultValue`, `parameterName`,
  `noiseFunction`, `outputMin`); enums use the C++ short form (`BLEND_Translucent`,
  `NOISEFUNCTION_GradientALU`, `TRANSFORMSOURCE_Local`).
- **Procedural surface colour**: world-position-driven Noise can blend colors without UVs,
  but profile its shader cost. For static variation, baking tileable procedural noise to a
  texture and sampling it at several world scales is often cheaper. Inspect tiling and seams.
- In editor Python, use `set_editor_property` for editor-only expression fields such as
  ComponentMask `r/g/b/a`, Multiply `const_b` and Lerp `const_alpha`; direct attributes may be
  absent. TextureSample takes the `UVs` input pin. Check every connection return value.
- **Water**: `blendMode: BLEND_Translucent`, `translucencyLightingMode:
  TLM_SurfacePerPixelLighting`, `bScreenSpaceReflections`, `refractionMethod:
  RM_IndexOfRefraction`. Project the normal map from `WorldPosition` (mask R,G, scale) rather
  than mesh UVs, pan two or three layers at different scales and directions, sum and normalise -
  mesh-UV panning at one scale reads as a static tiled pattern. For a surface that visibly
  rolls, give the mesh vertices (a subdivided plane) and add a few directional sines of world XY
  and `Time` to World Position Offset. Opacity below ~0.35 disappears against a bright background.
- **Reusing a material on a new mesh.** Multipart imports keep named material slots
  (`Oak | natural clear oil`, `Pulls | matte black steel`). `StaticMeshTools.get_material_slots`
  then `set_material(mesh, slot_name, material)` assigns a project material, or one from an
  earlier import, per slot - useful when a regenerated or edited model lost its surface detail.

## Terrain and other large meshes: build them, do not generate them

The 5.8 toolset has no landscape or mesh-generation tool, but it imports OBJ. A grid mesh written
from a height function in plain Python (vertices `v x y z` in UE units, two triangles per cell)
imports quickly; grid resolution is a geometry budget, not just a visual parameter. Include
explicit `vt` UV records and `f v/vt` indices: a UV-less reimport triggered an Interchange OBJ
translator ensure on 5.8.2. Validate upward triangle winding separately for grids and path strips.
Reimport when the generated file changes; an asset-exists guard alone retains stale geometry. After import:

- set the mesh's `bodySetup` -> `collisionTraceFlag: CTF_UseComplexAsSimple` via `ObjectTools`
  (BodySetup ref from `get_properties(mesh, ["bodySetup"])`) so characters walk on the real
  surface rather than an auto-generated box;
- enable Nanite (not for translucent water surfaces); assign your material as an override.

The OBJ importer **negates Y** (right- to left-handed): write `v x -y z` and flip the winding, or
the mesh comes in mirrored across X - invisible on a flat area, obvious later. Probe after import
with a straight-down `SceneTools.trace_world` where nothing is overhead and compare with the
function (details in `community-field-notes/UE-field-guide.md`, "OBJ import mirrors Y").

Keep the height function in one file that both the exporter and every placement script import,
and take every placed object's Z from an exact sample of the *mesh* (same grid and triangle
split as the exporter), not from a trace: a top-down trace hits roofs and canopies and lifts
things. Re-check from a low camera after every terrain or placement change (`unreal.md`).

Editor Python (`py <file>` via the Cmd box, `tools/ue_console.sh`) can do the same with
Geometry Script, but only classes from *enabled* plugins are exposed, and enabling one means an
editor restart. The OBJ route needs neither.

## Instancing anything placed in quantity

Use one actor with an `InstancedStaticMeshComponent` per mesh and write `perInstanceSMData` in one
`set_properties` call. Each entry is
`{"transform": {"xPlane": {x,y,z,w}, "yPlane": ..., "zPlane": ..., "wPlane": {x,y,z,1}}}` - a 4x4
matrix, rotation*scale in the first three rows, translation in the fourth. Thousands of instances
go in as one call. Three rules from the gotchas file:

- To replace a list with one of a different length: set `[]`, write the list, **write it again**,
  read back. A length-changing write leaves the last element as an identity instance at the
  actor origin.
- `set_properties` does not dirty the actor; write its transform back unchanged before saving or
  the instances are lost on reload.
- Give the component collision only if the instances need it (trees yes, grass no).
- **Per-instance data for shaders:** set `numCustomDataFloats`, then `perInstanceSMCustomData` as a
  flat float list in instance order (`count x numCustomDataFloats`), read in the material with a
  `PerInstanceCustomData` node (`dataIndex`). Expect the write to block the editor for minutes
  at a few thousand instances; poll until the server answers rather than retrying.
- **Dense thin geometry (grass blades, reeds, hair cards) stays off Nanite.** Thousands of tiny
  disconnected triangles are decimated even in the fallback mesh (1700 -> ~1250 triangles per
  tile) and thin out further with distance. Use a plain mesh with instance cull distances, and
  turn off everything it does not need: `castShadow`, `bCastDynamicShadow`,
  `bCastContactShadow`, `bAffectDistanceFieldLighting`, `bAffectDynamicIndirectLighting`.
- Procedural meshes that carry data in UVs: the OBJ importer flips V (`UE-field-guide.md` §4.4).

## Motion without animation

Sculpts have no bones. A static mesh can still read as alive with a Blueprint that steers the
actor toward random targets inside an instance-editable box (`MakeRotfromX`, `RInterpTo`,
`SetActorRotation`, `AddActorWorldOffset` along `GetActorForwardVector`,
`RandomPointinBoundingBox`), with state changes expressed as speed multipliers and target boxes
so nothing jumps, plus the WPO shader above for secondary motion. A `RotatingMovementComponent`
orbit is cheaper but reads as an object pinned to a spinning parent; suitable for machinery, not
creatures.

## Pitfalls

- Choosing the generation path by what is easiest to prompt instead of by object type: a
  sculpted manufactured object comes back soft-edged with shading baked into the texture.
- Repeating one generated asset as a surface or ground cover: it reads as tiles however good the
  asset is. Surfaces are the engine's job; Thrixel makes the unit that gets instanced.
- Trusting a single screenshot for orientation or scale: compare against a known-size object in
  the same frame, and derive orientation from the export convention.
- Placing from a height function and never checking against the mesh: sample the mesh exactly,
  sink bases a little, and look from a low camera after every change.
- Assuming a real-world or fixed normalized import size: measure bounds for each export.
- Trusting a written transform: a uniform scale or a facing yaw written to a Blueprint actor's
  component through `set_properties` lands on one axis only. Stretched or sideways meshes that
  "look a bit off" for days are this; read the struct back.
- Filtering assets by class with a full path: `get_asset_class` returns short names, so the
  filter silently matches nothing and the pass you thought you ran never happened.
