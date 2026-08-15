# Roblox submission evidence

This file is intentionally incomplete until every value is measured in Roblox Studio. Do not
replace a missing value with an estimate.

## Tested toolchain

| Component | Exact version | Platform/device |
|---|---|---|
| Roblox Studio | pending | pending |
| Rojo | pending | pending |
| Blender | pending | pending |
| Desktop playtest | pending | pending |
| Lowest-target mobile device | pending | pending |

## Vaultbreak — stealth/puzzle

- Thrixel project/submission IDs: pending
- Normalizer report: pending
- Independent GLB inspection report: pending
- Studio audit JSON: pending
- Public playable link: pending
- Video: pending
- 60-second route, p50/p95/worst frame: pending
- Moving-part proof (`VaultDoor` before/during/after): pending
- Moderation status and timestamp: pending

## Skyrail Salvage — arcade runner

- Thrixel project/submission IDs: pending
- Normalizer report: pending
- Independent GLB inspection report: pending
- Studio audit JSON: pending
- Public playable link: pending
- Video: pending
- Full-route p50/p95/worst frame: pending
- Moving-part proof (`Propeller` before/during): pending
- Moderation status and timestamp: pending

## Clean-machine reproduction

Record every step taken from a machine with no prior Rojo/Blender setup. Attach the terminal output
from toolchain verification, the clean `rojo build`, Studio import warnings, the first audit JSON,
and any point at which the written engine path was ambiguous. A workaround belongs in
`roblox.md` or `PITFALLS.md` before submission, not only in this report.

## Known limitations

- Studio remains the supported import and publishing boundary because Open Cloud's Model ID does
  not provide a dependable child MeshId mapping.
- Performance and moderation results cannot be inferred from local source or GLB preflight; both
  must be observed after Studio import on the intended creator account.
