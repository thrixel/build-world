# Roblox Studio engine support — submission writeup

This package addresses [goal-to-game issue #3](https://github.com/thrixel/goal-to-game/issues/3).
It is intentionally based on the current upstream `main`; the engine documentation and tooling
sit inside the existing skill rather than beside a forked copy. The two demo games are included as
source and published experiences.

## What changed

- Added `skills/goal-to-game/engines/roblox.md`, a direct agent contract covering toolchain gates,
  project layout, Thrixel grouping, strict geometry validation, Studio import, Model-ID handling,
  appearances, scale/orientation, collision, performance, visual verification, and publishing.
- Added `skills/goal-to-game/engines/roblox/PITFALLS.md` with failure symptoms and recoveries.
- Added executable mesh validation, runtime self-test, deterministic shot, and frame-time tools.
- Added Rojo/Rokit templates and cross-platform installation instructions for macOS, Windows
  PowerShell, and the explicit WSL/Windows-host boundary.
- Added Roblox routing to `SKILL.md` and the engine list/examples in `README.md`.
- Added two different complete games, asset provenance, testing notes, and performance evidence.

## The two open questions

### Asset upload and child MeshIds

The primary path is deliberately Studio's Importer. Open Cloud returns the uploaded Model container
ID; it does not expose a documented, reliable Model-to-child-MeshId resolution step. Rojo also does
not authenticate uploads with an Open Cloud key. Pretending otherwise would make clean-machine
reproduction fragile and encourage cookie automation.

The agent therefore prepares, groups, downloads, checks magic bytes, and validates every mesh
before one explicit human/Studio import boundary. Merge Meshes stays off, imported child pivots stay
on, and Studio grants the target experience access. The agent then reads actual child MeshIds from
the inserted MeshParts and resumes automated source sync/self-checking. An optional Open Cloud route
is allowed only when it completes that Studio-side insertion/enumeration gate; otherwise it falls
back without losing work.

### Agent self-checking

Verification has three independent layers:

1. `validate_mesh.py` checks the downloaded GLB before Studio: 20,000 triangles per object,
   watertightness, winding, nonzero volume/thickness, and a SHA-256 report. It welds only an
   in-memory copy so UV/normal seam splits are not false holes.
2. `runtime-selftest.server.luau` checks tagged imported assets inside the actual place and emits a
   machine-readable JSON report for IDs, bounds, anchoring, collision, and moving pivots.
3. `shot-harness.client.luau` drives named deterministic camera shots and previews a
   `CaptureService` viewport capture. `metrics.client.luau` records frame-time percentiles and
   scene counts. The engine file requires desktop, mobile-emulator, and full-progression review.

This does not equate a clean hierarchy with a visible asset: moderation and permission remain a
separate fresh-client visual gate.

## Demo games

| Game | Genre and complete loop | Independently moving imported parts | Published experience | Video |
|---|---|---|---|---|
| Orrery Lock | roofed third-person maze puzzle: collect three cells, power the center Orrery, open the vault, claim the prism, climb to the exit, and reset | grouped Orrery crank, three orbit rings, pointer; complete grouped vault door | [Play Orrery Lock](https://www.roblox.com/games/134480882203670/Orrery-Lock) | [Gameplay video](../evidence/videos/orrery-lock.mp4) |
| Moonmarket Mix-Up | fixed-isometric timed collection/order game with round reset and persistent session leaderboard | grouped cauldron lid, paddle, and handles | [Play Moonmarket Mix-Up](https://www.roblox.com/games/72183482324028/Moonmarket-Mix-Up) | [Gameplay video](../evidence/videos/moonmarket-mix-up.mp4) |

Both experiences have stable published place IDs, Public audience access, and a Minimal
content-maturity label (Ages 16+). On August 17, 2026, both links were verified from a signed-out
browser: each public experience page resolved with its title, description, maturity label, and
server information instead of Roblox's private-content block.

## How the demos were built

The games followed the proposed skill, not a manual asset-cleanup pipeline:

1. Called `thrixel_account_status`, created/resumed a named project with
   `thrixel_start_project`, and kept the account-wide concurrent cap in mind.
2. Generated an asset-ranked scene for each genre and visually reviewed every thumbnail.
3. Inspected real node names, grouped with `thrixel_group_parts`, and retained moving groups.
4. Downloaded all accepted sources as GLB with `thrixel_download`. Conversion responses were
   detected by content rather than extension; FBX retries are retained only as fallback evidence.
   Strict validation exposed genuine sculpt holes and grouped-output winding defects, so the
   collectibles were regenerated as closed-solid Architect assets and the grouped GLBs received
   the documented deterministic winding-only pass.
5. Imported in Studio with hierarchy preserved, assigned Roblox-side appearances per semantic
   object where source materials did not survive, and used Rojo for all gameplay/UI scripts.
6. Tested cold spawn, respawn recovery, map boundaries, controls, every objective transition,
   lighting, and the end state in Studio and the published client.

Full submission IDs, group names, triangle counts, rejected variants, and Cube use are in
[thrixel-assets.md](thrixel-assets.md). This evidence lets Thrixel verify the generation history in
the linked Developer Program workspace.

## Problems encountered and decisions

- **Model ID versus MeshId:** chose the honest Studio boundary described above instead of an
  unverified headless mapping.
- **Conversion queue saved as `.fbx`:** added magic-byte/file-type verification and an explicit
  retry state.
- **Import queue duplicate risk:** require Explorer/Workspace verification before retrying.
- **Grouped appearances imported white:** preserved semantic objects and assigned deliberate
  Roblox materials/colors per group instead of merging away addressability.
- **Geometry validation failures:** kept the validator strict. Genuine open/non-manifold sculpt
  derivatives were regenerated; closed grouped outputs with seam-induced mixed winding were
  normalized by `repair_mesh_winding.py`, then all 15 accepted GLBs were revalidated and recorded.
- **Moving rings initially orbited/fell:** set group pivots from their own bounds, anchored rigid
  visuals, and animated the retained groups with code.
- **Runtime fidelity assignment failed capability checks:** moved fidelity decisions to edit/import
  time and kept runtime code to gameplay-safe properties.
- **Lighting first overexposed, then too dark:** evaluated full gameplay views and tuned exposure,
  ambient light, local ranges, and color correction as one system.
- **Cold loads caused initial falls:** created spawn/recovery geometry before the world-ready gate
  and covered/held the player until construction completed.
- **Collectible/end-state defects:** exercised the complete loops, not only screenshots; the final
  Orrery prism and Moonmarket round reset have explicit, tested completion behavior.

## Tested versions

| Component | Version/environment |
|---|---|
| Roblox Studio | `0.734.0.7340915` |
| Rojo | `7.7.0` (pinned by Rokit) |
| Rokit | `1.2.0` |
| Python | `3.14.3` |
| uv | `0.12.5` |
| Validation libraries | installed ephemerally by `uv run --with trimesh --with numpy` |
| OS | macOS 26.6, Apple silicon (`arm64`) |

Installation commands are documented for macOS, Windows PowerShell, and Linux/WSL. Studio import
and execution were tested on macOS. The Linux text deliberately makes the Windows/macOS Studio-host
boundary explicit rather than claiming an unsupported native Linux installation was tested.

## Performance and visual results

Detailed evidence is in [performance.md](performance.md). Desktop Studio playtests held 58.8–60
FPS in the sampled completed scenes. Orrery Lock reported roughly 0.5 ms render / 0.2 ms physics
with 140 primitives; Moonmarket reported roughly 0.4 ms render / 0.1 ms physics with 217
primitives. Both passed runtime asset-template checks and were visually inspected after correcting
exposure.

These desktop Studio measurements accompany a reusable engine gate that requires a selected mobile
emulator, recorded frame-time percentiles, and a sustained 30 FPS minimum for each generated game.

## Reproduction path for reviewers

1. Install/sign into Roblox Studio and install Rokit using
   `skills/goal-to-game/SetupAndInstallationFlow.md`, then run `rokit install` from the repository
   root.
2. Run the portable repository checks:

   ```sh
   uv run --with trimesh --with numpy --with networkx python scripts/verify_roblox_submission.py
   ```

3. For a new generated asset, run the documented `thrixel_*` MCP flow and the mesh validator.
4. Open the built place, perform the explicit Studio import checklist, and connect
   `rojo serve <game>/studio-sync.project.json`.
5. Run Play Solo; require the JSON self-test/metrics pass and inspect the named desktop/mobile
   camera shots.
6. The published links above allow direct gameplay review without opening Studio.

## Known platform boundary

Roblox moderation and new-creator eligibility are external asynchronous gates. The workflow never
turns those into silent success: it records pending status, preserves the validated source, and
requires a fresh-client visibility check before claiming completion.
