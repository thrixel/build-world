# Roblox Studio

Roblox-specific rules for Goal to Game. The shared Thrixel workflow remains in
[../SKILL.md](../SKILL.md). Read that file first and do not duplicate its generation, pricing, or
grouping logic here.

## Non-negotiable completion contract

A Roblox build is not complete when the Luau parses or when a place opens. Before presenting it:

1. Verify Roblox Studio is available using
   [SetupAndInstallationFlow.md](../SetupAndInstallationFlow.md). Stop if it is unavailable.
2. Use `thrixel_start_project`, `thrixel_group_parts`, `thrixel_download`, and
   `thrixel_account_status`; do not replace them with direct API polling.
3. Produce and validate an asset manifest for every imported Thrixel model.
4. Run the game in Studio and capture repeatable evidence from multiple camera positions.
5. Test both a desktop and a mobile-sized viewport.
6. Publish only after the user authorizes the Roblox account boundary.
7. Record tested Studio/tool versions, performance results, upload status, and known moderation
   delays in the project report.

## Supported automation boundary

Roblox has two distinct paths. Choose deliberately and record which one was used.

### Open Cloud path

Use Open Cloud to upload the prepared model when credentials and permissions are available. Treat
the returned ID as the uploaded Model container, not as proof that descendant `MeshPart.MeshId`
values are known. Wait for the upload operation to finish, then use a Studio-side script or plugin
to load the owned model, walk its descendants, and write the resolved mesh and texture IDs into the
project asset manifest.

Never print, commit, or ask the user to paste an API key into source. If Open Cloud permission or
account authorization is missing, stop at that boundary and ask the user to complete it.

### Studio Importer fallback

If the Open Cloud route cannot resolve descendant mesh IDs reliably, prepare the FBX and manifest,
then use Studio's 3D Importer. This is an explicit supported fallback, not a hidden manual step.
After import, run the same Studio-side descendant scan and update the manifest before building the
scene. Do not continue with placeholder IDs.

An upload may be correct but invisible while moderation is pending. Report `pending moderation`
separately from `broken reference`; do not repeatedly re-upload the same asset to diagnose a review
delay.

## Project shape

Keep engine source, generated evidence, and imported artifacts separate:

```text
game/
  default.project.json
  src/
    client/
    server/
    shared/
  assets/
    manifest.json
    source/
  evidence/
    screenshots/
    performance.json
    validation.json
```

Use a Rojo-compatible layout when Rojo is available. Generated place files and uploaded binaries
must not replace editable Luau source as the source of truth.

Copy
[`templates/asset-manifest.example.json`](roblox/templates/asset-manifest.example.json) to the
game's `assets/manifest.json`, then run:

```bash
python engines/roblox/tools/validate_manifest.py path/to/game/assets/manifest.json
```

The validator is a metadata gate. It does not inspect FBX geometry itself. Triangle count,
watertightness, and texture dimensions must come from the preparation/inspection tools and then be
recorded honestly in the manifest.

## Asset ingest

For every Thrixel asset:

1. Call `thrixel_inspect_model` and record the actual node names, bounds, and likely forward axis.
2. Decide which parts move. Pass only those names to `keep_groups`; a door, wheel, beacon, or
   propeller welded into `Body` is a failed ingest.
3. Call `thrixel_group_parts`. Keep material slots separated while merging static geometry.
4. Reduce each resulting mesh group to at most 20,000 triangles. Validate that it is watertight,
   has no exposed backfaces or zero-thickness surfaces, and has no detached fragments.
5. Download FBX for the Roblox path. Keep the original Thrixel submission ID in the manifest.
6. Import through Open Cloud or Studio Importer and resolve the actual descendant IDs.
7. Place the asset beside a reference avatar before deciding final scale and orientation.

Do not infer a universal forward axis. Store the correction per asset so game code never contains
scattered trial-and-error rotations.

## Materials and textures

One `MeshPart` carries one `SurfaceAppearance`. Preserve semantic material slots as separate mesh
objects when they need different appearances. A single mesh cannot reproduce arbitrary submesh
materials at runtime.

The supported PBR maps are color, normal, roughness, metalness, and emissive. Keep textures at or
below 4096 pixels per side and record their size in the manifest. Material decisions belong to the
build pipeline because most `SurfaceAppearance` properties are not a runtime customization system.

When a texture is missing, check in this order:

1. moderation state;
2. ownership and experience permissions;
3. resolved asset ID;
4. `SurfaceAppearance` parent and map assignment;
5. UV presence and orientation.

Do not change five variables and re-upload before identifying which layer failed.

## Moving parts and pivots

`thrixel_group_parts` preserves a kept group's geometric center. That is suitable for wheels and
some propellers, but not automatically for hinges, turrets, doors, or heads. Record each moving
group's pivot in the manifest. In Roblox, create a stable pivot attachment or parent model at the
real mechanical axis and animate that parent. Never compensate for a bad pivot with frame-by-frame
position offsets.

At least one verification scene must contain an independently moving Thrixel part and prove that it
rotates around the intended axis without orbiting the model root.

## Collision, fidelity, and budgets

Set collision intentionally per role:

- static architecture: simple or hull collision unless exact collision is gameplay-critical;
- decorative props: collision off;
- moving gameplay pieces: simple collision with a dedicated collision group;
- player-critical surfaces: test traversal at seams, slopes, and doorways.

Set `RenderFidelity` and `CollisionFidelity` explicitly rather than relying on changing defaults.
Start with these mobile-oriented budgets and tighten them if the game misses target frame time:

- no imported mesh group above 20,000 triangles;
- no ungrouped 99-342 node Thrixel hierarchy in the live scene;
- avoid unique textures for repeated props;
- pool repeated effects and reuse models;
- maintain 30 FPS or better on the tested mobile profile and record the device/profile used.

## Repeatable self-check

Copy [`tools/selftest.server.lua`](roblox/tools/selftest.server.lua) into
`ServerScriptService` as `ThrixelSelftest.server.lua`. Tag each imported model root
`ThrixelAsset` with `CollectionService`; tag independently moving `MeshPart` instances
`ThrixelMovingPart`. After the motion test has exercised the intended mechanical axis, set that
part's `ThrixelPivotVerified` attribute to `true`.

Run Play in Studio and capture the Output line beginning `THRIXEL_SELFTEST_JSON=`. Save its JSON
payload as `evidence/validation.json`. A script error or `passed: false` is a hard failure. Warnings
must be reviewed and either corrected or justified in the report. This script validates the live
scene hierarchy and resolved IDs; it does not replace pre-import geometry inspection or visual
review.

Build a deterministic verification scene or mode that:

1. positions named cameras at front, rear, both sides, top, and gameplay distance;
2. captures the same shots after every material or import change;
3. runs a movement script through collision-critical areas;
4. exercises every independently moving part;
5. records frame time, instance count, mesh-part count, and visible moderation failures;
6. emits machine-readable `evidence/validation.json` and `evidence/performance.json`.

For the required stills, copy [`tools/camera-tour.client.lua`](roblox/tools/camera-tour.client.lua)
into `StarterPlayerScripts`. It frames the first model tagged `ThrixelAsset` and selects the six
required views deterministically. Use `[` and `]` to move between views and match each capture to
the emitted `THRIXEL_CAMERA_VIEW=` marker.

Copy [`tools/performance.client.lua`](roblox/tools/performance.client.lua) into
`StarterPlayerScripts` for each desktop and mobile-emulation run. Set the optional Workspace
attribute `ThrixelPerformanceProfile` to `desktop` or `mobile`; otherwise the script infers the
profile from touch input. Save the `THRIXEL_PERFORMANCE_JSON=` payload for each run in
`evidence/performance.json` and reject mobile results below 30 FPS.

Review the captures for scale, sideways orientation, floating pieces, missing faces, black or blank
textures, incorrect pivots, collision gaps, and mobile UI obstruction. A green script result does
not override a visibly broken frame.

## Failure behavior

The agent must stop or downgrade cleanly:

- no Studio: stop and request official installation;
- no Roblox authorization: prepare files, state the exact blocked operation, and ask once;
- no Open Cloud permission: use the explicit Studio Importer fallback;
- moderation pending: retain IDs and report pending status without regenerating;
- exhausted Thrixel Cubes: follow the shared skill's placeholder and upgrade rules;
- manifest validation failure: do not publish;
- performance target missed: simplify collision, grouping, materials, or effects and remeasure.

## Final evidence

Before handoff, provide:

- editable source and project configuration;
- validated asset manifest;
- public playable link after authorization;
- public gameplay video for each finished benchmark;
- deterministic screenshots from all required cameras;
- desktop and mobile performance results;
- tested version matrix;
- import/upload/moderation log;
- a concise list of manual boundaries that remain.

For a benchmark or bounty submission, build two different genres end to end and include at least one
Thrixel asset with independently moving parts. A documentation-only PR does not prove this engine
path works.

Record those two games using
[`templates/submission-evidence.example.json`](roblox/templates/submission-evidence.example.json)
as a scaffold, replace every `replace-with-*` value with captured evidence, and run the final gate:

```bash
python engines/roblox/tools/validate_submission.py path/to/submission-evidence.json
```
