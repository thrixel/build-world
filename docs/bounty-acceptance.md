# Bounty acceptance checklist

Source of truth: `thrixel/goal-to-game` issue #3, re-checked August 17, 2026. This file tracks evidence; it does not replace the issue.

## Engine instructions

- [x] `engines/roblox.md` gives direct, verifiable agent instructions.
- [x] Toolchain detection and hard-stop behavior cover macOS, Linux/WSL, and Windows PowerShell.
- [x] Project layout and downloaded-asset locations are explicit.
- [x] Asset ingest documents `thrixel_download(...)` through a visible Roblox result.
- [x] Import approach resolves or explicitly gates Model ID versus child MeshId handling.
- [x] Upload size/rate limits and moderation-pending behavior are covered.
- [x] `thrixel_group_parts` keeps material slots distinct and supports `keep_groups` for moving parts.
- [x] Every mesh is watertight, nonzero-thickness, outward-facing, and below 20,000 triangles.
- [x] SurfaceAppearance maps, image limits, and texture troubleshooting are explicit.
- [x] Scale conversion, orientation detection/correction, and ground alignment are verifiable.
- [x] CollisionFidelity/RenderFidelity, part-count budgets, FPS targets, and mobile guidance are explicit.
- [x] Animation is code-first and avoids detailed humanoid rigs.
- [x] Agent self-checking produces repeatable visual and runtime evidence.
- [x] Failure behavior covers failed upload, pending moderation, exhausted Cubes, and account-wide concurrency.

## Repository integration

- [x] Update shared `SKILL.md` target-engine routing without duplicating or contradicting its pipeline.
- [x] Add Roblox to upstream `README.md` engine list.
- [x] Update `SetupAndInstallationFlow.md` for all required operating systems.
- [x] Use `thrixel_start_project`.
- [x] Use `thrixel_group_parts`.
- [x] Use `thrixel_download`.
- [x] Use `thrixel_account_status` and respect its account-wide cap.

## Submission evidence

- [x] Orrery Lock is complete and published to a stable Roblox experience record.
- [x] Moonmarket Mix-Up is complete and published to a stable Roblox experience record.
- [x] Games are demonstrably different genres (collection/puzzle vault versus timed recipe/order fulfillment).
- [x] Orrery hero asset has independently moving imported rings, crank, and pointer with corrected pivots.
- [x] Each game has a tightly cropped gameplay video.
- [x] Writeup covers approach, problems, decisions, and exact tested versions.
- [x] Running-game performance metrics are recorded for each game; the engine instructions also
  impose a separate 30 FPS mobile-emulator gate on future generated games.
- [x] Developer Program account exists and GitHub is linked.

## Review priority

Reproduction on a clean machine has the most weight. Every dependency must be detectable, installable, pinned where appropriate, and paired with a clear stop/recovery action.

## Live integration findings

- Published Roblox records: Orrery Lock universe `10714402761` / place `134480882203670`; Moonmarket Mix-Up universe `10714381924` / place `72183482324028`. Both have stable experience links and a Minimal content-maturity label.
- Both experiences have Public audience access and stable place links. On August 17, 2026, each
  public experience page was verified from a signed-out browser and no longer returned Roblox's
  private-content block. Both retain a Minimal content-maturity label (Ages 16+).

- Thrixel's active project is global state. Parallel cross-project jobs can be filed under the wrong active project even when a job schema exposes `project_id`; resume the intended project and run project-changing jobs sequentially.
- The live detail endpoint currently accepts 2048 or 4096 textures, not 1024. Generate at the minimum accepted size, then document Roblox-side texture sizing and mobile tradeoffs.
- A first non-GLB `thrixel_download` can return queued conversion JSON from the deprecated conversion endpoint and save it with the requested extension. Verify file type and retry after conversion; never trust the extension alone.
- Studio's Import Queue may insert an asset while still showing a `0/1` selection tooltip. Verify Workspace/Explorer after every import and avoid repeated clicks.
- Detailed output is a candidate, not an automatic upgrade. The Orrery detail pass was rejected because it weakened color separation and focal emissive readability compared with the grouped source.
- `MeshPart.RenderFidelity` cannot be assigned by an ordinary server script (`lacking capability Plugin`). Fidelity belongs in the Studio/plugin build step; runtime scripts only control gameplay-safe properties such as anchoring and collision enablement.
- All 15 manifest-selected GLBs now pass the strict per-mesh geometry gate with fresh recorded reports. The final Thrixel polish pass adds a telescope, celestial lectern, astrolabe pillar, and equipment workbench to Orrery Lock; replaces both games' overbright pickup assets; and restores a layered mechanical vault door. Thrixel autofix was used before the deterministic Roblox compatibility pass, which preserves semantic groups and keeps every individual MeshPart below 20,000 triangles.
- The accepted Orrery GLB and optional FBX fallback both retained the six semantic nodes but previewed white in Studio because their source material assignments did not survive as Roblox appearances. The game now assigns Roblox colors/materials per grouped node (`OrreryBody`, rings, crank, pointer, and vault groups), demonstrating why material boundaries must remain separate MeshParts.
- The August 15 final builds were republished in place: Orrery Lock version 30 and Moonmarket Mix-Up version 24. Studio play tests confirmed grounded spawning, below-map recovery, collectible interaction, one wall-clear exhibit per maze alcove, clear circulation, a fully clearing vault door, a flush stair/landing transition, the original Moonmarket footprint, the leaderboard, a centered 11-stud cauldron with an accessible front-edge brewing prompt, randomized collision-checked pickup placement, personal recipes with explicit brewing instructions, a 75-second solo-capable win loop, restrained collectible lighting, and successful construction from all required asset templates.
