# Roblox pitfalls

Every entry here cost at least one full iteration round on this path. Read before importing any
mesh or assigning any `SurfaceAppearance`.

---

## A. Import validation failures are silent-ish until they are not

Roblox validates geometry at the import boundary, and the failure modes are uneven:

- **Over 20,000 triangles** → the importer refuses the mesh outright (usually a clear error). But a
  model with several meshes near the cap can import while *one* over-cap mesh is silently dropped,
  leaving a missing part you only notice in play mode.
- **Non-manifold / holes / backfaces** → refused or, worse, auto-"repaired" by the importer into a
  visibly wrong mesh (flipped faces, a hole welded shut across geometry that should stay open).

**Rule:** run the pre-import checklist (group → decimate to ≤20k → watertight/thickness check in
Blender) *before* every import. Catching it in Blender is one round-trip; catching it after a
Studio import that half-worked is several.

## B. The material slots die on `thrixel_group_parts`

`thrixel_group_parts` joins everything that does not move into one `Body` mesh. The semantic slots
(`Paint`, `Glass`, `Chrome`, `Rubber`, `Rim`) survive the join in the FBX as submesh/material data
— which Roblox **cannot read**. If you import `Body` whole and assign one `SurfaceAppearance`, the
glass and chrome read as painted, and no amount of re-texturing fixes it because the slot
addressing is gone.

**Rule:** split `Body` by material in Blender before import (Edit Mode → P → By Material), one
`MeshPart` per slot, one `SurfaceAppearance` per `MeshPart`. If a prop has no slot worth
distinguishing, say so and import whole — deliberately, not accidentally.

## C. `SurfaceAppearance` only attaches to a `MeshPart` (or `Part`), not to a `Model`

A `SurfaceAppearance` parented to a `Model` (or to `Workspace`) does nothing. Each `MeshPart` needs
its own `SurfaceAppearance` child. After a split-by-material import you have N meshes and need N
appearances — script the assignment (iterate the model's `MeshPart`s) rather than hand-assigning
and missing one. A missing appearance renders as the part's default grey, which is exactly the
"purple/untextured mesh" the critic will flag.

## D. `TextureID` vs `SurfaceAppearance` — pick one, not both

A `MeshPart` can show a texture either as a decal `TextureID` (on the `MeshPart` itself) or via a
`SurfaceAppearance.ColorMap`. Using both on the same part double-applies and fights. For PBR, use
`SurfaceAppearance` and leave `TextureID` empty. For a flat, unlit decal (a screen, a sign), a
`TextureID` on a `Part` is fine — but not on a mesh you also want physically shaded.

## E. Forward axis is inconsistent per asset, and Roblox exposes it immediately

glTF does not define a forward axis, so Thrixel assets arrive facing different ways. Unity and
three.js let you rotate a root at spawn; in Roblox the imported model's `PrimaryPart`/root
orientation is what it is, and a lighthouse that faces sideways is obvious the first time you look.
Decide facing per asset at import, and set it once on the root — do not discover it when a vehicle
drives sideways.

## F. Moving parts welded into the body

`thrixel_group_parts` welds everything that does not move into `Body`. If you omit a `keep_groups`
entry (or a `keep_groups` name matches nothing — which fails the job on purpose, good), a wheel
becomes part of `Body` and will never spin. Symmetrically, structural parts nested *inside* a
moving group (`FL_arch`, `FL_Coil3` under `FL_Wheel_Group`) must be excluded or the wheel arch
spins with the tyre. Call `thrixel_inspect_model` first and read the real part names.

## G. Pivot/attachment placement

`thrixel_group_parts` reports each kept group's pivot origin at the group's **geometric centre**.
That is right for a wheel and wrong for a turret, a door on hinges, or a head on a swivel — the
real axis is the mount point. In Roblox, fix it by parenting the `MeshPart` under an `Attachment`
(or a small invisible `Part` used as the mount) and rotating the parent, or by editing the pivot in
Studio (Model → Edit Pivot). Rotating a turret around its geometric centre reads as "floating and
off-axis" to the critic.

## H. Decimating by hand cracks the UV seams

If you reduce a Thrixel GLB/FBX with your own tooling instead of `thrixel_reduce_triangles`, weld
coincident vertices first (Blender: Merge by Distance). Thrixel meshes arrive with vertices split
along every UV-island boundary, and a collapse decimator pulls those seams apart into large visible
cracks. `thrixel_reduce_triangles` welds first, which is why it does not. Better still: do not
decimate by hand at all — the tool is free and correct.

## I. Scale mismatch at import

Roblox's unit is the stud; FBX/OBJ units are whatever the exporter said they were. The Studio 3D
Importer offers a scale factor, and if you leave it wrong a Thrixel car imports at 1/100th or 100×
scale. After the first import, place a 1-stud `Part` next to the model and eyeball it against a
door, a character, or the ground — wrong proportions only show up next to something of known size.
Fix once, note the scale factor, and reuse it for every asset in the project.

## J. `StreamingEnabled` breaks "everything is loaded" assumptions

Enable `StreamingEnabled` and the whole `Workspace` is no longer loaded at once. Any system that
iterates `Workspace:GetDescendants()` at boot, or assumes a distant prop is already replicated,
breaks. Either design systems to work with streaming (wait for `:WaitForChild`, use
`CollectionService` tags), or leave streaming off and accept the memory cost on large places. Do
not discover this mid-build.

## K. Physics steps independently of your scripts

Roblox's physics steps on its own clock, independent of `RunService` callbacks, so gameplay that
reads physics state must not assume it is synchronised with the frame. Bit-identical captures are
not achievable the way they are in three.js. If determinism matters, drive the camera from a
scripted path and treat "reproducible to the eye" as the bar — and say so in the report rather
than claiming bit-identical.
