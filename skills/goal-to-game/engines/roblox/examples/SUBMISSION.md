# Roblox engine submission writeup

## Approach

The engine path separates deterministic preparation from the Roblox account boundary. The agent
groups and validates Thrixel output, records material and pivot intent in a manifest, and builds the
gameplay source with Rojo. It then uses either Open Cloud where permissions are sufficient or an
explicit Studio 3D Importer handoff. Studio remains the authority for resolved MeshPart and texture
IDs, moderation state, runtime collision, screenshots, performance, and publishing.

The repository includes two different benchmark genres:

- **Stormwatch** is a survival loop with timed storms and a rotating lighthouse lantern.
- **Courier Circuit** is a driving/delivery loop with four independently grouped wheels.

Both have editable Rojo projects, standalone place files, imported Thrixel place variants, and the
original generated assets. The imported scenes are checked directly for expected mesh names,
resolved asset IDs, textures, collision, and moving-group structure.

## Asset decisions

- FBX is the Studio import format because it retains object grouping and companion material
  textures while using Roblox's documented importer path.
- Material slots remain separate grouped objects instead of relying on unsupported submesh
  materials in a single MeshPart.
- Moving groups are retained before download so wheels and the lighthouse lantern preserve their
  own pivots.
- The lighthouse contains 2,448 triangles across two mesh objects. The delivery cart contains 664
  triangles across five mesh objects. Both remain below the 20,000-triangle per-mesh limit.
- Generated project IDs, submission IDs, pivots, and file paths are recorded in
  `thrixel_assets/roblox/generation-evidence.json`.

## Verification design

- `validate_manifest.py` rejects oversized meshes/textures, duplicate groups, and invalid moving
  pivots before import.
- `selftest.server.lua` checks the live Studio hierarchy, resolved IDs, collision settings, and
  moving-part pivot verification.
- `camera-tour.client.lua` produces repeatable front, rear, left, right, top, and gameplay views.
- `performance.client.lua` records profile, viewport, FPS, frame time, instance count, and mesh
  count as JSON.
- `validate_submission.py` is the final gate for two genres, public games, public videos, six-view
  screenshot sets, moving-part verification, and desktop/mobile performance at 30 FPS or better.

## Issues encountered

- Open Cloud returns a Model container ID without a dependable unattended route to each child
  MeshId. The workflow therefore keeps Studio import as an explicit supported boundary.
- Uploaded assets may remain blank while moderation is pending. The workflow records this state and
  does not regenerate assets as a false fix.
- Roblox Studio rewrites place XML extensively even when content is unchanged. Generated build
  sources and imported evidence variants are kept distinct so serialization noise is not mistaken
  for meaningful work.
- Studio does not run natively under Linux or WSL. Those environments must use an official Windows
  or macOS Studio host.

## Tested versions

See [`TESTED_VERSIONS.md`](TESTED_VERSIONS.md). Automated tests, both Rojo builds, account-bound
Studio self-tests, six-view captures, and desktop/mobile performance runs are verified on Windows.
macOS and WSL host bridging are documented but are not claimed as tested.

## Completion status

The code, generated assets, imported scenes, evidence tooling, screenshots, gameplay recordings,
Studio self-test JSON, and desktop/mobile performance JSON are complete. Account-bound publishing
is the remaining external step before the draft PR is marked ready; the public Roblox links are
then recorded in `submission-evidence.json` and validated with `validate_submission.py`.
