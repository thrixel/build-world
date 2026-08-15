# Roblox reference games

These are two independent Rojo projects used to exercise the Roblox engine path end to end:

- `vaultbreak/` — a top-down stealth/puzzle game with a hinged vault door.
- `skyrail-salvage/` — a three-lane arcade runner with a spinning airship propeller.

Both projects run with clearly labelled blockout parts before import, but the shared audit fails
until the manifest-named Thrixel Models are present under `Workspace/ThrixelAssets`. A submission
must not describe either game as finished while that audit fails.

For each project:

```bash
python ../../tools/validate_manifest.py thrixel-manifest.json
rojo build default.project.json -o build.rbxlx
```

Open `build.rbxlx`, import the manifest asset through Studio's 3D Importer, put it under
`Workspace/ThrixelAssets`, set the manifest attributes listed in the game README, and press Play.
F8 runs the camera review. F9 prints the accumulated performance sample.
