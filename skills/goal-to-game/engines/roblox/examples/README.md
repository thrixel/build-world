# Roblox benchmark games

These two Rojo projects are the editable source for the bounty's end-to-end evidence:

- `stormwatch`: survival loop with timed storms and a rotating lighthouse beacon.
- `courier-circuit`: vehicle delivery loop with sequential city checkpoints.

Both scenes currently use deterministic primitive stand-ins so the gameplay source can be built and
tested without account access. The corresponding Thrixel models have been generated, grouped, and
downloaded under `../../../../../thrixel_assets/roblox/`. Import those FBX files through Studio's 3D
Importer and replace the stand-ins before recording final evidence. The stand-ins are not presented
as generated Thrixel assets.

Generation IDs, triangle counts, kept moving groups, and pivots are recorded in
`../../../../../thrixel_assets/roblox/generation-evidence.json`.

Build locally with:

```text
rojo build stormwatch/default.project.json -o stormwatch/Stormwatch.rbxlx
rojo build courier-circuit/default.project.json -o courier-circuit/CourierCircuit.rbxlx
```
