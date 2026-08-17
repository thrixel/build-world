# Issue #3 traceability

Source of truth: [thrixel/goal-to-game issue #3](https://github.com/thrixel/goal-to-game/issues/3),
re-checked August 17, 2026. The issue was still open and unchanged at that check. This matrix makes
the submission's coverage mechanically reviewable; it does not replace the issue.

| Issue #3 requirement | Implementation | Verification/evidence |
|---|---|---|
| Direct Roblox agent instructions | [`skills/goal-to-game/engines/roblox.md`](../skills/goal-to-game/engines/roblox.md) | Imperative gates, numbered ingest/import/publish flow |
| Toolchain detection and hard stops | Roblox engine file, Toolchain gate; [`SetupAndInstallationFlow.md`](../skills/goal-to-game/SetupAndInstallationFlow.md) | macOS, Windows PowerShell, Linux/WSL host boundary; version checks before work |
| Project layout and asset locations | Roblox engine file, Project layout | Exact downloaded files are staged under [`thrixel_assets/`](../thrixel_assets/) and referenced by both manifests |
| Required Thrixel MCP tools | Roblox engine file, Non-negotiable rules and Grouping sections | Project/submission IDs and observed account-cap behavior in [`thrixel-assets.md`](thrixel-assets.md) |
| Account-wide concurrency | Roblox engine file and pitfalls | Final recorded status: 0 jobs running; sequential active-project warning documented |
| Download-to-visible ingest | Roblox engine file, Download/validate and Studio import sections | Exact FBX/GLB sources, magic-byte failure evidence, published experience records, videos |
| Model ID versus child MeshIds | Roblox engine file, Studio import boundary | Honest one-step Studio insertion/enumeration gate; no cookie auth or false Model-ID assignment |
| Upload/rate/moderation behavior | Roblox engine file and [`PITFALLS.md`](../skills/goal-to-game/engines/roblox/PITFALLS.md) | Explicit pending, permission, retry, and fresh-client gates |
| Grouping, material splits, and decimation | Roblox engine file, Group before download | Exact accepted groups and per-object triangle counts in `thrixel-assets.md` |
| `keep_groups` and moving pivots | Roblox engine file, Grouping and import checklists | Orrery rings/crank/pointer and cauldron lid/paddle/handles retained; Orrery video shows animation |
| Watertightness, outward winding, thickness, 20k cap | [`validate_mesh.py`](../skills/goal-to-game/engines/roblox/tools/validate_mesh.py) and [`repair_mesh_winding.py`](../skills/goal-to-game/engines/roblox/tools/repair_mesh_winding.py) | Regression fixtures directly exercise valid, open, inward, thin, over-limit, and masquerading non-GLB inputs; all 15 accepted GLBs have fresh recorded reports; the repair pass only normalizes closed grouped output and cannot hide holes |
| SurfaceAppearance and texture failures | Roblox engine file, Appearance section; pitfalls | One appearance per MeshPart, five map fields, size checks, moderation/permission diagnostics |
| Scale, orientation, grounding | Roblox engine file, Scale/orientation section | Character-relative target height, candidate forward-axis shots, bounds-based grounding |
| Collision and performance | Roblox engine file, Collision/performance section | Collision/RenderFidelity rules, mobile/desktop budgets, runtime metrics tools and [`performance.md`](performance.md) |
| Code-first animation; no humanoid rigs | Roblox engine file, Animation section | Both demos animate retained mechanical groups in Luau |
| Repeatable agent self-checking | [`runtime-selftest.server.luau`](../skills/goal-to-game/engines/roblox/tools/runtime-selftest.server.luau), [`metrics.client.luau`](../skills/goal-to-game/engines/roblox/tools/metrics.client.luau), [`shot-harness.client.luau`](../skills/goal-to-game/engines/roblox/tools/shot-harness.client.luau) | Machine-readable runtime report, frame-time percentiles, named deterministic viewport shots |
| Clean-machine submission verification | [`verify_roblox_submission.py`](../scripts/verify_roblox_submission.py) | Cross-platform JSON/link/checksum gates, four Rojo builds, validator regression fixtures, recorded real-asset report comparison, and required-media checks |
| Failed upload/pending moderation/out of Cubes | Roblox engine file, Failure matrix; pitfalls | Every state has a stop/retry/fallback outcome; no silent primitive substitution for required assets |
| Shared repo integration | [`SKILL.md`](../skills/goal-to-game/SKILL.md), root [`README.md`](../README.md), setup flow | Roblox routing, engine list/example, all required OS setup paths |
| Two complete different-genre games | [`games/orrery-lock/`](../games/orrery-lock/), [`games/moonmarket-mixup/`](../games/moonmarket-mixup/) | Stable Roblox links and viewport-only videos indexed in [`roblox-submission.md`](roblox-submission.md) |
| At least one independently moving asset | Orrery grouped source and gameplay code | Three rings, crank, and pointer remain separately addressable and animate around corrected pivots |
| Published playable links | Submission writeup, Demo games table | Stable Public experience records for both games; both pages were verified from a signed-out browser on August 17, 2026 |
| Video for each game | [`evidence/videos/`](../evidence/videos/) | Cap window recordings cropped to the game viewport; no unrelated desktop content |
| Approach/issues/decisions/tested versions | [`roblox-submission.md`](roblox-submission.md) | Includes both open questions, build narrative, failure discoveries, version matrix |
| Performance metrics | [`performance.md`](performance.md) | Measured running-scene FPS, render/physics cost, primitives, runtime asset checks |
| Developer Program and linked GitHub | [`bounty-acceptance.md`](bounty-acceptance.md) | Registration and GitHub linking complete; Thrixel workspace IDs make generation verifiable |
