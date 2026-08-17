# Performance and visual QA

Measured in Roblox Studio `0.734.0.7340915` on macOS 26.6 (Apple silicon, arm64) with Rojo 7.7.0. These are Studio measurements, not claims about every Roblox client or device.

## Orrery Lock

- 58.8 FPS in the completed playable scene.
- Render: approximately 0.5 ms (3%).
- Physics: 60 steps/s, approximately 0.2 ms (1%).
- 140 primitives, 17 moving primitives, 31 joints, and 0 contacts in the sampled frame.
- Runtime self-check: passed; 63 runtime MeshParts; all five required Thrixel asset templates present.
- Full progression exercised: three real Star Cells collected, crank unlocked and triggered, imported rings animated, and the vault objective completed.
- Visual QA: exposure reduced and local light intensity constrained; navy, brass, and teal semantic material groups remain readable without the former white/overexposed wash.

## Moonmarket Mix-Up

- 59–60 FPS in the playable market scene.
- Render: approximately 0.4 ms (2%).
- Physics: approximately 0.1 ms (0%).
- 217 primitives, 17 moving primitives, and 31 joints in the sampled frame.
- Runtime self-check: passed; all six required Thrixel asset templates present.
- Real imported Glowcap pickup exercised and the inventory advanced from 0 to 1.
- Visual QA: fixed Scriptable camera tested at the intended overview; dark plum wood, brass trim, and warm lantern groups remain distinct without the former peach/overexposed wash.

## Evidence and scope

Viewport-only gameplay videos and app-only screenshots are collected under `evidence/`. The
measurements above satisfy issue #3's request for performance metrics from running games. The
reusable engine instructions additionally require each generated game to select a mobile emulator,
record frame-time percentiles, and optimize until it sustains at least 30 FPS.
