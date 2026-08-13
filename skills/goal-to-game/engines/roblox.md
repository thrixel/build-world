# Roblox Studio

Engine-specific rules for the Roblox Studio path. The shared Thrixel asset
pipeline is in [../SKILL.md](../SKILL.md); this file covers only what differs
for Roblox.

Roblox is a good target for Goal to Game when the user wants a shareable place
file, quick multiplayer affordances, mobile support, or Roblox-native physics and
UI. It is a stricter import target than Unity or three.js: asset preparation,
moderation, and Studio verification decide whether the result is usable.

Before building, read [roblox/PITFALLS.md](roblox/PITFALLS.md).

## Rules for Roblox game dev

When developing in Roblox Studio, you MUST set up this checklist and verifiably
check each item off:

1. You MUST use Roblox Studio plus Rojo. If either cannot be found, stop and ask
   the user to install or enable it. Do not fake a Roblox build with local HTML or
   engine primitives.
2. You MUST create a Rojo project and keep source in files, not only inside a
   `.rbxl` place. The repo should have `default.project.json`, `src/`, and a
   repeatable sync/run path.
3. You MUST use `thrixel_group_parts` before download. Keep semantic material
   slots as separate objects and pass moving parts through `keep_groups`.
4. Download grouped Thrixel assets as `.fbx` for Roblox unless a specific asset
   fails and `.gltf` imports more cleanly. Do not use `.obj` unless textures are
   intentionally being rebuilt in Studio.
5. Every imported mesh dependency MUST be below Roblox's 20,000-triangle per-mesh
   limit, watertight, and nonzero thickness before the user is asked to import it.
6. The skill MUST make imported assets visible through either the Open Cloud
   upload plus Studio insertion path or the explicit manual Studio Importer
   fallback below. Never leave the user with "upload it somehow."
7. You MUST set `CollisionFidelity`, `RenderFidelity`, anchoring, collision
   groups, and physical properties deliberately for every imported model.
8. You MUST verify in Studio from several named camera positions and in Play Solo.
   If Studio automation is not available on the machine, create the scripts,
   project structure, and import manifest, then stop at the exact manual Studio
   step and say what remains unverified.
9. Prefer code-driven animation in Luau. Avoid detailed humanoid rigs unless the
   user explicitly asks for avatar work.

## Toolchain

Check these before doing Roblox-specific work:

```bash
rojo --version
```

Roblox Studio itself is not reliably scriptable from a single cross-platform CLI.
Look for it in the normal places and stop if it is absent:

- macOS: `/Applications/RobloxStudio.app`
- Windows: `%LOCALAPPDATA%\Roblox\Versions\*\RobloxStudioBeta.exe`

Recommended optional tools:

- Blender CLI for final mesh validation, decimation, origin cleanup, and format
  conversion.
- `run-in-roblox` or an equivalent Studio test runner if it is already present in
  the project. Do not add a brittle runner unless you can prove it works.

## Project shape

Use Rojo's standard layout:

```text
default.project.json
src/
  client/
  server/
  shared/
  assets/
    manifests/
    roblox/
```

`src/assets/manifests/` holds generated JSON manifests from the asset prep step.
`src/assets/roblox/` holds Studio-side helper ModuleScripts that read those
manifests after import. Do not commit user secrets, Open Cloud API keys, `.rbxl`
binary files, or generated asset IDs unless the user explicitly wants those IDs
in source.

## Asset ingest

Use this path for each Thrixel asset:

1. Generate through the shared pipeline in `SKILL.md`.
2. Run `thrixel_group_parts` before download:
   - keep each material slot as a separate object so one `MeshPart` maps to one
     appearance;
   - pass `keep_groups` for moving parts such as wheels, doors, turrets,
     propellers, drawers, levers, and hinges;
   - name groups by gameplay purpose, not by generated mesh IDs.
3. Download `.fbx`.
4. Validate locally if Blender is available:
   - no object above 20,000 triangles;
   - no open boundary edges or obvious non-manifold geometry;
   - each moving group origin is at its own geometric center or hinge point;
   - transforms are applied and scale is normalized.
5. Produce an import manifest with one record per expected Roblox `MeshPart`:

```json
{
  "assetName": "storm_lighthouse",
  "sourceFile": "build/import/storm_lighthouse.fbx",
  "studsPerMeter": 3.571,
  "parts": [
    {
      "name": "Body_Paint",
      "semantic": "body",
      "materialSlot": "Paint",
      "trianglesMax": 20000,
      "collision": "Hull",
      "render": "Automatic",
      "pivot": [0, 0, 0]
    }
  ]
}
```

### Preferred import path

If the user has a Roblox Open Cloud key with asset write permissions and a user
or group creator ID, upload the `.fbx` as a Model asset. The Assets API accepts
`.fbx`, `.gltf`, `.glb`, `.rbxm`, and `.rbxmx` for Model uploads and returns an
operation. Poll that operation until it is done and record the returned Model
asset ID.

Then use a Studio-side build step to insert the owned model:

```lua
local InsertService = game:GetService("InsertService")

local function loadOwnedModel(assetId: number): Model
	local ok, result = pcall(function()
		return InsertService:LoadAsset(assetId)
	end)
	assert(ok, ("failed to load model asset %d: %s"):format(assetId, tostring(result)))
	local model = result:FindFirstChildWhichIsA("Model") or result
	model.Parent = workspace.GeneratedAssets
	return model
end
```

After insertion, walk the `MeshPart` descendants, match them to the generated
manifest by name, set properties, and emit a resolved manifest containing
`MeshId`, texture asset IDs, pivots, bounding boxes, and moderation status if it
is available.

This path is preferred because it gives the agent an asset ID and a repeatable
place-building script. It is still not a promise that everything can be fully
headless: moderation, permission scope, and Studio security can block rendering
or insertion. If any of those fail, use the fallback immediately.

### Manual Studio Importer fallback

If Open Cloud upload is unavailable or the returned Model cannot be resolved into
usable `MeshPart` descendants, stop at a precise import handoff:

1. Open Roblox Studio.
2. Open or create the target place.
3. Use Avatar / Import 3D or the Studio Importer to import the generated `.fbx`.
4. Keep "Merge Meshes" off so material-slot objects remain separate MeshParts.
5. Put the imported model under `Workspace/GeneratedAssets/<assetName>`.
6. Run the generated Studio command or plugin script named in the manifest.

The agent should prepare every file and script before this handoff. The human's
manual work should be only the import operation that Studio refuses to expose
reliably.

## Materials and textures

Roblox `MeshPart` does not support submesh-level material assignment. Treat each
semantic material slot as a separate object before import. For rich materials,
parent one `SurfaceAppearance` to the relevant `MeshPart` and set the maps at
build time:

- `ColorMap` for albedo/base color;
- `NormalMap` for tangent-space normals;
- `RoughnessMap` for roughness;
- `MetalnessMap` for metalness;
- `EmissiveMap` for glow masks when needed.

Most `SurfaceAppearance` properties are preprocessing-heavy and should be
treated as build-time data. Do not script live material swaps by mutating
SurfaceAppearance maps every frame. For gameplay state changes, swap whole
prepared MeshParts, toggle prebuilt variants, adjust lights, or use simple
`BasePart` color/transparency changes.

Roblox image uploads have size limits; keep source textures at or below 4096 on
the long side by default and never above 8000 x 8000. If a texture shows blank:

- first check moderation status and ownership, because pending assets can render
  as missing even when references are correct;
- then check the map is parented through `SurfaceAppearance`, not only left as a
  file next to the mesh;
- then verify the texture ID belongs to the same user or group that owns the
  experience or is otherwise usable by it.

## Scale and orientation

Use studs deliberately. A practical default is:

```text
1 meter = 3.571 studs
1 stud = 0.28 meters
```

Check every major asset next to a default R15 character before building gameplay
around it. Thrixel forward axes can vary between assets, so determine forward
from the actual mesh after import. Do not fix a sideways vehicle by rotating the
visible mesh only; put it under a pivot `Model` or parent `Folder`, align the
parent with gameplay forward, and keep moving child parts in local space.

For ground placement:

- set the model pivot to the intended gameplay origin;
- move the model so the lowest collision-relevant point is on the floor plane;
- keep decorative overhangs from defining the gameplay footprint.

## Collision and performance

Set these deliberately:

- Decorative distant props: `CanCollide = false`, `RenderFidelity = Automatic`.
- Walkable large static forms: simplified invisible collision parts plus visible
  MeshParts with collision off.
- Player-blocking props: `CollisionFidelity = Hull` or `Box` when possible.
- Exact collision: use only for small, important interaction objects where Hull
  is visibly wrong.

Budget for mobile first unless the user says desktop-only:

- keep imported MeshPart count low by grouping before download;
- keep visible triangles under control per scene zone, not only per asset;
- use streaming-friendly placement and avoid hundreds of unique texture assets
  in the first view;
- prefer Roblox `Terrain` and primitive Parts for large terrain masses, using
  Thrixel for signature props, structures, vehicles, and interactables.

## Verification loop

Create a deterministic verification pass for every Roblox build:

1. A Studio build script creates or updates the scene from Rojo source and import
   manifests.
2. A smoke test spawns the player, moves through the main route, triggers the
   core interaction, and records a pass/fail summary in `ServerStorage` or a
   generated output file.
3. Named cameras cover at least:
   - establishing view;
   - close material view;
   - player-scale view;
   - collision/interaction view;
   - mobile-framing view.
4. Capture screenshots from Studio if automation is available. If not, leave the
   cameras in `Workspace/VerificationCameras` and tell the user exactly which
   screenshots remain manual.
5. Inspect screenshots for missing moderated assets, invisible textures,
   sideways orientation, floating meshes, over-large collision, frame-rate drops,
   and UI overlap.

A Roblox build is not done until the Rojo source syncs, the generated Studio
scripts run without errors, and the manual or automated Studio inspection confirms
that imported Thrixel assets are visible at the right scale.

## Multiple concurrent game builds

Skip this section unless the user has explicitly said several agents are building
Roblox games on one machine.

- Use different project folders and different Roblox places.
- Do not share an Open Cloud API key file between writable projects; each project
  should read secrets from the user's environment or local secret store.
- Thrixel concurrency is account-wide, not per project.
- Studio windows compete for focus and plugin state, so screenshot automation must
  identify the place name and camera name in every output.
