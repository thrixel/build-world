# Vaultbreak

Prompt used with the skill:

> Build a top-down Roblox stealth puzzle called Vaultbreak. The player infiltrates a clockwork
> museum, collects three fuse keys while avoiding scanning sentinels, then opens a mechanical
> vault. Generate the vault with Architect, keep `VaultDoor` independently movable, group it,
> prepare it for Roblox, and use primitive collision hitboxes.

Generate and group `ClockworkVault` through the Thrixel MCP, replace the manifest submission ID,
run the normalize/inspect tools, and import the GLB in Studio. Put the Model at
`Workspace/ThrixelAssets/ClockworkVault` and set:

- `ThrixelExpectedMovingGroups = "VaultDoor"`
- `ThrixelTargetLongestAxis = 18`

The game has a 150-second round, three required fuse keys, sentinel line-of-sight alarms, a vault
opening sequence, win/lose/reset states, keyboard/gamepad default movement, a top-down follow
camera, seven review shots, and visible HUD feedback.
