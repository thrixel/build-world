# Roblox Studio

Engine-specific rules for the Roblox path. The shared Thrixel generation, cost, inspection,
grouping, and concurrency rules are in [../SKILL.md](../SKILL.md); do not repeat or override them.
Read [roblox/PITFALLS.md](roblox/PITFALLS.md) before importing the first asset.

## Non-negotiable rules

1. Use **Rojo + Roblox Studio + Blender**. If `rojo --version` or `blender --version` fails,
   stop and use the installation section in `../SetupAndInstallationFlow.md`.
2. Roblox Studio is a hard gate. There is no supported unattended route that takes an uploaded
   Model asset ID and resolves all child MeshIds. Do not use a `.ROBLOSECURITY` cookie, browser
   storage, or undocumented upload endpoint. Prepare everything, then ask the user to perform the
   single Studio import step described below.
3. Download grouped Thrixel output as **GLB**. GLB retains hierarchy and PBR material inputs in one
   deterministic file. Do not use OBJ (no hierarchy/PBR) or FBX (material conversion is less
   inspectable) for this path.
4. Every imported MeshPart must have at most one material/SurfaceAppearance and fewer than 20,000
   triangles. Run both preflight tools; a successful Studio import is not a substitute.
5. Never make a Thrixel model into a humanoid rig. Animate named mechanical parts in Luau around
   explicit pivots.
6. Do not publish, enable paid access, or change monetization without the user's approval.

## Project contract

Use this layout. Keep generated Studio state out of Rojo's ownership so a sync cannot delete
imported assets:

```text
game/
  default.project.json
  src/client/
  src/server/
  src/shared/
  thrixel_assets/raw/
  thrixel_assets/ready/
  thrixel_assets/manifests/
  evidence/captures/
  evidence/audit/
```

Map only `ReplicatedStorage`, `ServerScriptService`, `StarterPlayer`, and authored UI from Rojo.
Do **not** map `Workspace` wholesale. Studio owns `Workspace/ThrixelAssets`, which preserves the
MeshIds and moderated asset references written by 3D Importer.

Minimal `default.project.json`:

```json
{
  "name": "GameName",
  "tree": {
    "$className": "DataModel",
    "ReplicatedStorage": {"Shared": {"$path": "src/shared"}},
    "ServerScriptService": {"Server": {"$path": "src/server"}},
    "StarterPlayer": {
      "StarterPlayerScripts": {"Client": {"$path": "src/client"}}
    }
  }
}
```

Run `rojo build default.project.json -o build.rbxlx` after every source change. Open the built
place for a clean reproduction test; use live sync only while iterating.

## Asset ingest: generation to a visible MeshPart

### 1. Plan the moving groups before generation

For every asset, write a manifest using
[asset-manifest.example.json](roblox/templates/asset-manifest.example.json). The manifest is the
contract between generation, geometry preparation, Studio import, placement, and audit. Record:

- target dimensions in studs and the gameplay purpose;
- the expected forward axis after import;
- named moving groups and the desired pivot behavior;
- collision/render fidelity by part;
- triangle and visible-instance budgets.

If something moves, choose Architect (or Architect → Detailer) per the shared rules. Call
`thrixel_inspect_model` and copy exact node names into `keep_groups`; never guess them.

### 2. Group on Thrixel, then download GLB

Always use the MCP tools, never hand-written API polling:

```text
thrixel_account_status()
thrixel_start_project(name="<game>")
thrixel_group_parts(
  submission_id="<id>",
  keep_groups=[{"name":"Propeller"}],
  target_triangles=54000
)
thrixel_download(submission_id="<grouped id>", format="glb")
```

The account-wide concurrency cap comes from `thrixel_account_status`; do not assume it. Keep the
whole model budget larger than 20,000 only when it will be split into several material/moving
parts. The 20,000 limit applies to each final MeshPart, not to the Model container.

### 3. Normalize and inspect deterministically

Run from this engine directory:

```bash
blender --background --python roblox/tools/normalize_glb.py -- \
  --input /abs/thrixel_assets/raw/airship.glb \
  --output /abs/thrixel_assets/ready/airship.glb \
  --report /abs/evidence/audit/airship-normalize.json \
  --target-triangles 18000

python roblox/tools/inspect_glb.py \
  /abs/thrixel_assets/ready/airship.glb \
  --report /abs/evidence/audit/airship-inspect.json
```

`normalize_glb.py` applies object rotation/scale, welds coincident vertices, separates material
slots into objects, triangulates, and uses a conservative decimator only when a part exceeds the
target. It fails when a result is non-manifold. It does not patch holes or add thickness because
those operations can destroy UVs and silhouette. On failure, use the free
`thrixel_reduce_triangles`, edit/regenerate the source, group again, and rerun preflight.

`inspect_glb.py` independently checks primitive counts, triangle counts, material cardinality,
missing names, and obvious hierarchy mistakes without Blender. Both reports must say `ok: true`.

### 4. The one required Studio gate

Stop and ask the user to do exactly this in Roblox Studio:

1. Open `build.rbxlx` while signed in to the intended Roblox creator account.
2. Open **File → 3D Import**, choose the prepared `.glb`, leave **Import as a Model** enabled and
   **Merge Meshes** disabled, then import.
3. Move the imported Model to `Workspace/ThrixelAssets` and rename it to the manifest `assetId`.
4. Save the place. Repeat for each prepared GLB.

Resume only after the user says the import completed. The MeshIds are now embedded in the saved
place. This is safer and more reproducible than uploading through cookie-authenticated Rojo. An
Open Cloud upload returns the Model container ID, not a dependable mapping to child MeshIds.

### 5. Bind appearances at build time

One normalized object becomes one MeshPart and one material. For PBR, each MeshPart gets one
`SurfaceAppearance` with the imported `ColorMap`, `NormalMap`, `RoughnessMap`, `MetalnessMap`, and
`EmissiveMaskContent` where available. Treat appearance as build-time state; most properties are
preprocessed and cannot be animated reliably at runtime.

If a mesh is invisible:

1. Check `MeshId` and the Output window for moderation/permission errors.
2. Check the asset on Creator Dashboard. A correct ID may render nothing while moderation is
   pending; wait and record `moderation: pending` rather than changing code.
3. Confirm every texture belongs to the same creator/group as the experience or is shared with it.
4. Temporarily remove `SurfaceAppearance`. If geometry appears, inspect the maps rather than the
   MeshId.
5. Never loop reuploads while moderation is pending.

## Scale, orientation, and pivots

Never assume the imported unit conversion or forward axis. After import:

1. Read `Model:GetBoundingBox()` and compare it with `targetBoundsStuds` in the manifest.
2. Use `Model:ScaleTo(targetLongestAxis / currentLongestAxis)` once. Store the applied scale as
   the `ThrixelScale` attribute so a later run does not compound it.
3. Place the asset beside a 5-stud reference rig and a labelled 1×1×1 stud cube, then capture it.
4. Rotate the Model once until its authored forward matches Roblox `-Z`. Store degrees in the
   `ThrixelYawDegrees` attribute; gameplay code reads the corrected pivot and never compensates
   again.

For wheels/propellers, rotate the kept MeshPart around its geometric centre. For a door, turret,
lid, or lever, create an invisible anchored pivot part at the real hinge, weld the visual part to
it, and rotate the pivot. Do not rotate an off-centre MeshPart and hope the generated origin is the
hinge. The runtime must verify that every manifest `movingGroup` resolved to at least one instance.

## Collision and performance budgets

Set collision by purpose, never uniformly:

| Purpose | `CanCollide` | `CollisionFidelity` | `RenderFidelity` |
|---|---:|---|---|
| Decorative or distant | false | Box | Performance |
| Pickup / trigger | false; separate primitive hitbox | Box | Automatic |
| Walkable hero object | true | PreciseConvexDecomposition | Automatic |
| Repeated obstacle | true; separate Box/Hull hitbox | Hull | Performance |
| Moving visual part | false; pivot/hitbox owns collision | Box | Automatic |

Use `PreciseConvexDecomposition` only on a few anchored, player-contact meshes. Never put it on
every decorative MeshPart. Prefer invisible primitive hitboxes for gameplay and `CanQuery`/`CanTouch`
only where code needs them.

Project budgets are stricter than platform import limits. Start with these and lower them if the
measurement fails:

- each MeshPart: ≤18,000 triangles (20,000 is a rejection boundary, not a target);
- hero model: ≤60,000 triangles across ≤12 MeshParts;
- repeated prop: ≤8,000 triangles and ≤4 MeshParts;
- mobile camera view: ≤250,000 visible triangles and ≤400 visible MeshParts;
- minimum sustained mobile result: 30 FPS, p95 frame time ≤33.3 ms, no single hitch >100 ms in
  the 60-second route.

Use instancing, StreamingEnabled for larger places, and distance-based detail reduction. Measure on
the lowest target device after assets have finished moderation; Studio on a desktop is not mobile
evidence.

## Self-check loop

Copy [audit.server.lua](roblox/tools/audit.server.lua) into `src/server` and
[camera-tour.client.lua](roblox/tools/camera-tour.client.lua) into `src/client`. Create a
`Workspace/ReviewShots` folder containing anchored parts named for the review:
`Establishing`, `PlayerScale`, `HeroClose`, `MovingPart`, `Collision`, `LightingDark`, and
`Gameplay`. Aim each part's `-Z` axis at its subject.

Then repeat until all gates pass:

1. Start Play mode. The audit prints exactly one line beginning `THRIXEL_AUDIT_JSON=` and creates
   a visible audit panel. Save that JSON in `evidence/audit/`.
2. Press **F8** to run the deterministic camera tour. Capture all seven named shots, including one
   frame before and one during independent-part motion.
3. Complete the 60-second scripted gameplay route. Record FPS/p95/worst hitch and verify win/lose,
   respawn, reset, touch/gamepad input, collision, and no Output errors.
4. Inspect at player distance and close range for inverted faces, holes, floating parts, missing
   textures, wrong scale/orientation, and moderation placeholders.
5. Build a new `.rbxlx` with Rojo and reopen it without live sync. Repeat the audit. This clean
   reproduction is the final gate.

Do not report success from source inspection alone. The final report names the exact Studio,
Rojo, Blender, OS, and device versions; attaches preflight/audit JSON; includes the captures and
performance route; and explicitly lists anything pending moderation.

## Publishing handoff

Publishing is account-bound and representational. Ask the user to approve it at the moment it is
needed. In Studio use **File → Publish to Roblox As…**, choose the intended owner/group, make the
experience public in Creator Dashboard, then test the public URL while signed out. Do not mark a
game complete until that public link loads and a new player can finish the core loop.
