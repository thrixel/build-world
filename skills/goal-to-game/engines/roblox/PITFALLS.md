# Roblox Pitfalls

Roblox can look like a simple import target, but the failures are usually at the
boundary between generated assets, cloud moderation, Studio security, and mobile
performance. Check this file before deciding a Roblox build is broken.

## A. Import and asset IDs

### The Open Cloud result is a Model ID, not your final mesh list

The Assets API can upload an `.fbx` as a Model, but the useful runtime objects are
the `MeshPart` descendants created when Studio inserts that model. Always resolve
the uploaded Model inside Studio and write a resolved manifest. Do not assume the
operation ID or Model asset ID is a `MeshId`.

### Moderation can masquerade as a broken material

Freshly uploaded meshes or textures can be referenced correctly and still render
blank while moderation is pending. Check ownership and moderation before changing
materials, UVs, or import format.

### Studio importer settings matter

If "Merge Meshes" is enabled, separate material-slot objects can collapse into a
shape that Roblox cannot shade the way the Thrixel asset expects. Keep material
slots separate unless the asset is deliberately single-material.

## B. Geometry

### One big beautiful mesh can fail import

Roblox enforces a 20,000-triangle limit per individual mesh dependency and expects
watertight, nonzero-thickness geometry. Grouping is not enough if one group stays
too large. Split or decimate before import.

### Shells are not solid gameplay objects

Thin one-sided shells may look fine in Blender and fail collision, boolean
operations, or import validation. If the asset is meant to collide, make it
watertight or build separate invisible collision parts.

### Origins decide whether moving parts feel broken

If a wheel, hinge, turret, or door is not in `keep_groups`, it may rotate around
the model root. Preserve it as its own object and verify the pivot in Studio
before writing animation code.

## C. Materials

### SurfaceAppearance is not a runtime material system

Treat `SurfaceAppearance` maps as baked build data. If gameplay needs stateful
looks, prepare multiple assets or combine static SurfaceAppearance with simple
runtime changes such as lights, particles, decals, transparency, or color.

### One MeshPart gets one appearance

Roblox does not give a single MeshPart several independently addressable material
slots. Keep `Paint`, `Glass`, `Chrome`, `Rubber`, and similar semantic slots as
separate imported objects.

### Texture ownership matters

A texture ID that works in one account or group may not render in another
experience. Keep creator IDs consistent, and verify assets from the target place,
not only from the upload script.

## D. Scale, orientation, and controls

### Stud conversion must be explicit

Thrixel assets are not guaranteed to arrive at a Roblox character scale. Check
against a default R15 rig and record `studsPerMeter` in the import manifest.

### Forward is a gameplay contract

Vehicles, doors, cameras, and projectiles need one shared idea of forward. Fix
orientation at the parent model/pivot layer, not by scattering ad hoc rotations
through movement scripts.

## E. Performance

### MeshPart count is often worse than triangle count

Hundreds of tiny MeshParts cost draw calls, replication, physics broadphase, and
Studio editing time. Group by material and gameplay motion before import.

### Exact collision is expensive and rarely right

Use invisible primitive collision for buildings, terrain, and large props. Reserve
exact collision for small objects where the difference is obvious to the player.

### Mobile catches first-view mistakes

Roblox games are often played on phones. Verify the first playable view with
mobile framing, modest graphics quality, and touch UI visible. A scene that only
works on a desktop viewport is not done.
