# Roblox Studio

Engine-specific rules for the Roblox path. The shared Thrixel asset pipeline is in
[../SKILL.md](../SKILL.md); this file covers only what differs for Roblox. Read
[roblox/PITFALLS.md](roblox/PITFALLS.md) before importing the first asset.

Roblox is not a headless engine. Source and validation can be automated, but the supported,
reliable asset-ingest boundary is Studio's Importer. Do not invent a cookie-based uploader, do
not claim that an Open Cloud Model ID is a child `MeshId`, and do not hide the one Studio import
step from the user.

## Non-negotiable rules

1. Use `thrixel_account_status`, `thrixel_start_project`, `thrixel_inspect_model`,
   `thrixel_group_parts`, and `thrixel_download`. Never replace them with API polling.
2. Use Rojo for scripts and project structure. Pin it in `rokit.toml`; do not ask the user to
   hand-edit scripts in Studio.
3. Use binary glTF (`format="glb"`) for the primary import path. It is one portable file,
   preserves object hierarchy and PBR payloads, and can be validated before Studio. If the
   installed Studio build rejects that file, download FBX and use the same importer checklist.
4. Import grouped assets as a `Model` with **Merge Meshes off**, **Use Imported Pivot on**, and
   **Anchored on**. Import Only As Model may stay on.
5. Every imported mesh must be at most 20,000 triangles, watertight, consistently wound, and
   nonzero-thickness. A warning is a failed gate, not something to click through.
6. One `MeshPart` carries one appearance. Any surface that needs a distinct Roblox appearance
   must remain a distinct object through `thrixel_group_parts`; a Unity-style submesh/material
   assumption is invalid here.
7. Keep every independently moving part in `keep_groups`. Verify its pivot in Studio before
   writing animation. Animate with Luau (`Model:PivotTo`, constraints, or `Motor6D.Transform`),
   not baked humanoid animation.
8. Do not set `RenderFidelity`, `CollisionFidelity`, or `SurfaceAppearance` from an ordinary
   runtime Script and assume it persisted. Configure import/build properties in edit mode.
9. Playtest and inspect visually in both desktop and a mobile device-emulator preset. A Rojo
   build succeeding is not a gameplay test.
10. Publishing, permissions, API-key creation, and spending remain user-authorized actions.
    Stop at those boundaries unless the user already granted the specific authority.

## Toolchain gate — run before creating the project

Check all of these:

```sh
rojo --version
rokit --version
python3 --version
```

If a grouped GLB needs the deterministic winding-only repair described below, also require
`blender --version`. Blender is not needed for a source that already passes validation.

Also verify that Roblox Studio is installed and can open a place:

- macOS: `/Applications/RobloxStudio.app`
- Windows PowerShell: `$env:LOCALAPPDATA\Roblox\Versions\*\RobloxStudioBeta.exe`
- WSL: Studio must run on the Windows host. Native Linux Studio is unsupported.

If `rokit` or Rojo is missing, follow the Roblox section of
[../SetupAndInstallationFlow.md](../SetupAndInstallationFlow.md), then re-run the checks. If
Studio is missing, signed out, or cannot be controlled through the available app/UI tool, **stop
and ask the user to install, sign in, unlock, or take the explicit Studio step**. Do not replace
the game with primitives and do not automate authentication with a Roblox cookie.

For WSL, run `rojo serve --address 0.0.0.0` in WSL and connect the Windows Studio plugin to the
WSL address. If host networking or firewall policy prevents that connection, move the checkout
to the Windows filesystem and run the pinned Windows Rojo binary there. Native Linux can prepare
and validate the project, but the import and playtest gate requires a Windows or macOS Studio
host.

## Project contract

Create this layout before importing anything:

```text
game/
├── rokit.toml
├── default.project.json
├── studio-sync.project.json
├── assets.manifest.json
├── assets/
│   ├── source/              # exact thrixel_download results; never rename blindly
│   └── reports/             # mesh validation JSON
├── captures/                # ignored; viewport-only screenshots and videos
└── src/
    ├── assets/              # imported .rbxm/.rbxmx files when exportable
    ├── client/
    ├── server/
    ├── shared/
    └── verification/        # copy the supplied self-test and shot harness here
```

Start from [roblox/templates](roblox/templates). `default.project.json` builds a place file;
`studio-sync.project.json` deliberately syncs scripts and verification without deleting imported
Studio assets. Keep generated `.rbxlx` and captures out of source control unless the submission
specifically asks for them.

The manifest is the bridge between Thrixel and Studio. For every asset, record:

- Thrixel project ID, submission ID, downloaded path, and SHA-256
- expected model and group names
- per-object triangle counts and moving groups
- chosen target height in studs and the observed import orientation
- import date/status (`prepared`, `imported`, `moderation_pending`, `verified`, `failed`)
- Roblox Model asset ID if one exists; never put that value in `MeshPart.MeshId`

## Asset preparation: required loop for every asset

### 1. Inspect before grouping

Call `thrixel_inspect_model` and write down the real node names. Decide two lists:

- **moving groups** — wheels, doors, lids, rings, cranks, pointers, propellers
- **appearance groups** — static regions that need different `SurfaceAppearance` or Roblox
  material treatment, such as glass, emissive insets, chrome, painted body, or rubber

Pass the union of those names to `keep_groups`. This is the Roblox-specific difference from an
engine that can retain several independently assignable submesh materials on one renderer.

```text
thrixel_group_parts(
  submission_id="...",
  keep_groups=[
    {"name":"door_panel"},
    {"name":"lock_wheel"},
    {"name":"glass"},
    {"name":"emissive_insets"}
  ],
  target_triangles=18000
)
```

`keep_groups` matches must be exact enough that the tool succeeds for the intended nodes. If it
fails, inspect again and correct the names; never remove a moving name just to make the call pass.
The account concurrency cap is global, so do project-changing work sequentially and never submit
more simultaneous jobs than `thrixel_account_status` reports.

### 2. Re-inspect the grouped result

The 20,000-triangle rule applies to **each resulting mesh object**, not the model total. Confirm
every kept object and the merged body independently. If any object exceeds the cap, reduce the
source with `thrixel_reduce_triangles`, group again, and re-inspect. If a single semantic object
cannot be reduced below the cap without breaking, stop and revise the asset; Studio cannot import
an invalid mesh.

The grouping result reports pivots. Record them immediately in the manifest. Grouped origins are
normally geometric centers, which are right for wheels and rings but may be wrong for a hinged
door. In that case create a small anchored pivot `Part` or parent `Model` at the hinge in Studio
and rotate the parent.

### 3. Download and verify the real file

```text
thrixel_download(submission_id="<grouped id>", format="glb")
```

Save under `assets/source/<asset-name>.glb`. Do not trust the extension alone. Check the file is
nonempty and has a GLB header (`glTF`), then run:

```sh
uv run --with trimesh --with numpy \
  python skills/goal-to-game/engines/roblox/tools/validate_mesh.py \
  assets/source/<asset-name>.glb \
  --json assets/reports/<asset-name>.json
```

This gate checks every mesh object for triangle count, watertightness, winding, nonzero extent,
and nonzero volume. It welds coincident vertices on an in-memory inspection copy so glTF UV/normal
seams are not mistaken for holes; the source file and UVs are unchanged. Do not import while any
error remains. Thin intentional surfaces still need real thickness for Roblox; do not silence
that check by enabling double-sided rendering.

If the ungrouped Architect source passes and `thrixel_group_parts` produces a file that remains
watertight but fails only winding, normalize that closed grouped result deterministically:

```sh
blender --background \
  --python skills/goal-to-game/engines/roblox/tools/repair_mesh_winding.py \
  -- assets/source/<asset-name>.glb assets/source/<asset-name>-repaired.glb
```

Then rerun `validate_mesh.py` and keep both reports as evidence. The repair welds only coincident
geometric vertices, preserves UVs as face-loop data, recalculates each disconnected component,
and never fills holes or changes triangle count. Do not use it to turn a watertightness failure
into a pass: reduce the original parent or regenerate genuinely open/non-manifold geometry.

A download can be a queued conversion response saved under the requested filename. If the magic
bytes/file-type check fails, wait for conversion and call `thrixel_download` again. Never feed
JSON to Studio because its filename ends in `.glb`.

## Import boundary: the supported solution to asset IDs

### Preferred path — Studio Importer

The Open Cloud Assets API returns the uploaded **Model** ID. It does not provide a reliable,
documented mapping from that container to every child `MeshPart.MeshId`. Rojo also does not use
an Open Cloud key for asset uploads. Therefore the supported path is one explicit Studio import
step:

1. Open the Rojo-built place in Studio and sign in.
2. **File → Import**, choose the validated `.glb` (or FBX fallback).
3. In preview, verify:
   - hierarchy contains the manifest's expected groups;
   - Merge Meshes is off;
   - Use Imported Pivot is on for child objects;
   - Anchored is on for rigid environment/gameplay props;
   - World Up and World Forward match the preview;
   - dimensions are reasonable next to a 5-stud-tall reference block/default avatar;
   - each object is below 20,000 triangles and there are no importer warnings.
4. For iteration, start with Upload to Roblox off. For the accepted version, enable upload and
   Add to Workspace so the experience is granted access to the restricted asset.
5. Click Import once. Verify the model in Explorer and Workspace before retrying; a completed
   queue row can remain visible after insertion and a second click creates duplicates.
6. Rename the inserted model exactly as the manifest expects and place it under the project's
   asset container. If practical, save it as `.rbxm`/`.rbxmx` in `src/assets`; otherwise keep it
   in the cloud place and keep `studio-sync.project.json` scoped so Rojo does not delete it.
7. Record the Model asset ID separately. Read child `MeshId` values only from the inserted
   `MeshPart` instances; never derive them arithmetically and never assign the Model ID as one.

This manual boundary is acceptable only because everything before and after it is deterministic
and the stop is explicit. If no person can operate Studio, stop here with the prepared files and
exact checklist; do not claim the asset is in-game.

### Optional Open Cloud path

Use Open Cloud only if a current, tested workflow can insert the returned owned Model from inside
Studio and then inspect its descendants there. Keep API keys outside the repository and never
print them. Poll Open Cloud operations according to the response headers and current Roblox docs;
429 means back off, not parallelize harder. The path is not complete until Studio has loaded the
Model, enumerated nonempty child `MeshId` values, and written them to the manifest. If any of those
steps fails, fall back to the Studio Importer.

Moderation is asynchronous. An owned asset can reference a valid ID and render blank while
pending. Distinguish these states:

- importer/upload error: operation failed; report the error and stop
- pending moderation: ID exists but content is unavailable; preserve the source and retry later
- permission failure: grant the experience access by importing/inserting from the target place
- broken reference: moderation is complete but the ID is empty/wrong; fix the manifest/reference

Do not substitute an unrelated public mesh and call the pipeline successful.

## Materials and textures

Each `MeshPart` may use one `TextureID` or one `SurfaceAppearance`. A `SurfaceAppearance` can
carry color, normal, roughness, metalness, and emissive maps, but most of those properties are
build-time content and cannot be swapped reliably by gameplay scripts.

For each imported object:

1. Prefer the imported `SurfaceAppearance` when its maps render correctly.
2. If maps are missing, inspect the imported child and Asset Manager; do not assume lighting is
   the problem until the content IDs and moderation state are known.
3. Reconnect ColorMap, NormalMap, RoughnessMap, MetalnessMap, and EmissiveMask in edit mode.
4. Test under neutral white light before art-directed lighting. White/gray output with intact
   hierarchy usually means appearance data did not survive, not that the geometry is bad.
5. Use 2048 only where close-up detail justifies it. Prefer 1024 for ordinary props and 512 or
   less for small/mobile scenery. Texture memory scales with pixel count; a 1024-square map uses
   four times the pixels of a 512-square map.
6. Keep transparent layers sparse. Overdraw is expensive on mobile.

If semantic materials did not survive, the separate appearance-group objects are the recovery
path: apply deliberate Roblox materials/colors per object. Do not rejoin them into one MeshPart.

## Scale, orientation, and grounding

Never assume Thrixel's forward axis. In importer preview set World Up first, then select World
Forward by silhouette. After import:

1. Place a 5-stud reference block/default avatar next to the model.
2. Measure `Model:GetBoundingBox()` and choose an explicit target height in studs from gameplay,
   not from arbitrary source units.
3. Scale uniformly once with `Model:ScaleTo()` in edit/build code.
4. Ground with the bounding-box bottom, not the model pivot:

```luau
local boxCFrame, boxSize = model:GetBoundingBox()
local bottomY = boxCFrame.Position.Y - boxSize.Y * 0.5
model:PivotTo(model:GetPivot() + Vector3.new(0, groundY - bottomY, 0))
```

5. Verify front/side/back views and one gameplay-camera view. Record the corrective rotation in
   the manifest so every clone uses the same orientation.

## Collision and fidelity

Set collision intentionally per role:

| Role | `CanCollide` | Collision fidelity | Render fidelity |
|---|---:|---|---|
| tiny decoration/pickup | false | Box/Hull | Performance/Automatic |
| large static walkable prop | selected collider only | Hull or PreciseConvexDecomposition after profiling | Automatic |
| moving visual group | false | Box/Hull | Automatic |
| invisible gameplay collider | true | primitive Part preferred | n/a |

Do not make every decorative MeshPart collide. Use simple invisible Parts for floors, stalls,
walls, and interaction volumes. Keep visual assets anchored and animate them with pivots; physics
ownership is unnecessary for a decorative crank or ring.

Start with these budgets and tighten them if the target device misses 30 FPS:

- at least 30 FPS on the selected mobile emulator and 60 FPS target on desktop
- fewer than 250 visible BaseParts for a small prototype scene where practical
- no individual mesh over 20,000 triangles
- reuse the same imported MeshId/appearance for repeated props so Roblox can instance them
- limit shadow-casting local lights and disable `CastShadow` on tiny decoration
- use StreamingEnabled for worlds large enough to benefit, but test spawn/gameplay under streaming

Measure, do not infer. Record FPS percentiles, visible part/MeshPart counts, and the Studio Stats
render/physics timings in the final writeup.

## Verification loop — required after every visual pass

Copy the supplied scripts from [roblox/tools](roblox/tools) into the verification paths in the
Rojo project. Tag every imported root model `ThrixelAsset`; tag independently moving groups
`ThrixelMovingPart`.

### Machine-readable self-test

Run Play Solo. `runtime-selftest.server.luau` emits a JSON line prefixed
`[GOAL_TO_GAME_REPORT]` and creates `ReplicatedStorage.GoalToGameReport`. A pass requires:

- at least one tagged Thrixel asset and a nonempty MeshId in every imported MeshPart
- finite, nonzero bounds
- anchored rigid assets
- moving groups with pivots near their own bounds (or an explicit `AllowOffsetPivot` attribute)
- no moving visual mesh using the most expensive collision mode

Fix every `ERROR`. Warnings require a written decision. Missing/blank rendered content still needs
visual inspection because moderation cannot be proved from hierarchy alone.

### Repeatable visual shots

Create `Workspace.GoalToGameShots` with named `CFrameValue` children for at least:

- establishing/gameplay view
- close hero asset view
- front, side, and rear asset views
- darkest and brightest gameplay areas
- moving mechanism before and after activation
- busiest gameplay/UI state
- mobile-emulator gameplay view

`shot-harness.client.luau` makes the camera deterministic. `[` and `]` move between shots; `P`
uses `CaptureService` and previews the exact viewport capture inside the game. Inspect every shot
at full size. If the agent has window-scoped screenshot control, capture only the Studio/Roblox
game viewport. If it can only capture the whole desktop, **stop and ask the user to take the
captures**; never leak unrelated windows.

For each Thrixel asset inspect silhouette, forward axis, scale, ground contact, missing/inverted
faces, floating fragments, texture/moderation failures, overexposure, collision, and moving-part
pivots. Re-test the full objective path, respawn, map edges, round completion, and keyboard plus
touch controls. A beautiful establishing shot does not prove the game is completable.

### Performance pass

`metrics.client.luau` samples client frame time and prints a second JSON report. Run it once in
desktop play mode and once with Studio's Device Emulator on a representative phone/tablet. Record
p50/p95/p99 FPS and the selected preset. Also open Studio Stats/MicroProfiler for render and
physics timing. Optimize only after reproducing the slow shot.

## Publish gate

Before publishing or handing off:

- Rojo build succeeds from a clean checkout.
- Mesh validator reports zero errors for every downloaded source.
- Runtime self-test passes.
- Every named shot has been reviewed at desktop and mobile aspect ratios.
- The entire gameplay loop completes from a fresh spawn and restarts/ends clearly.
- All imported content is visible outside Studio and moderation is complete.
- The experience has no paid items, monetization, or unexpected permissions unless requested.
- Published title/description use player-facing language and omit development-only identifiers.
- Record exact Studio, Rojo, Rokit, Python, and OS versions plus performance measurements.

If publishing was not authorized, stop with a built place file and the exact remaining Studio
steps. If it was authorized, publish, open a fresh public client/server, and repeat the gameplay
and visibility checks there.

## Multiple simultaneous builds

Ignore this section unless the user explicitly runs several Roblox builds at once. If they do,
use different folders and different Rojo ports, keep Studio windows identifiable by place name,
and capture only the intended app window. The Thrixel concurrent-job cap remains account-wide;
project activation and generation should be serialized to avoid filing assets under the wrong
project.
