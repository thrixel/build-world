# Roblox benchmark games

These two Rojo projects are the editable source for the bounty's end-to-end evidence:

- `stormwatch`: survival loop with timed storms and a rotating lighthouse beacon.
- `courier-circuit`: vehicle delivery loop with sequential city checkpoints.

The base `.rbxlx` scenes use deterministic primitive stand-ins so the gameplay source can be built
and tested without account access. The matching `*-Imported.rbxlx` variants contain the grouped
Thrixel meshes placed in each scene. Their source FBX files and companion `.fbm` material textures
live under `../../../../../thrixel_assets/roblox/`. Open the imported variants in Studio when
publishing and recording final evidence; the stand-ins are not presented as generated Thrixel
assets.

Generation IDs, triangle counts, kept moving groups, and pivots are recorded in
`../../../../../thrixel_assets/roblox/generation-evidence.json`.
The verified toolchain versions and remaining account-bound checks are recorded in
[`TESTED_VERSIONS.md`](TESTED_VERSIONS.md).
The consolidated approach, decisions, encountered issues, and completion status are recorded in
[`SUBMISSION.md`](SUBMISSION.md).

Build locally with:

```text
rojo build stormwatch/default.project.json -o stormwatch/Stormwatch.rbxlx
rojo build courier-circuit/default.project.json -o courier-circuit/CourierCircuit.rbxlx
```
