# Roblox submission evidence

This file is intentionally incomplete until every value is measured in Roblox Studio. Do not
replace a missing value with an estimate.

## Tested toolchain

| Component | Exact version | Platform/device |
|---|---|---|
| Roblox Studio | pending | pending |
| Rojo | 7.7.0 | Ubuntu 24.04.3 x86_64 |
| Blender | 4.5.12 LTS | Ubuntu 24.04.3 x86_64 |
| Luau compiler | 0.734 | Ubuntu 24.04.3 x86_64 |
| Desktop playtest | pending | pending |
| Lowest-target mobile device | pending | pending |

## Vaultbreak — stealth/puzzle

- Thrixel project: `27408b38-3b83-4c2d-9492-bd12b48c901a`
- Thrixel Architect submission: `066618d2-aa3d-41ce-8475-839842f3327c`
- Thrixel grouped submission: `ea665f1e-e88f-4619-8e61-ba29827238a4`
- Normalizer report: `vaultbreak/evidence/audit/clockwork-vault-normalize.json` (`ok: true`)
- Independent GLB inspection: `vaultbreak/evidence/audit/clockwork-vault-inspect.json` (`ok: true`; 4,532 triangles across 10 MeshParts)
- Studio audit JSON: pending
- Public playable link: pending
- Video: pending
- 60-second route, p50/p95/worst frame: pending
- Moving-part proof (`VaultDoor` before/during/after): pending
- Moderation status and timestamp: pending

## Skyrail Salvage — arcade runner

- Thrixel project: `54592748-f81c-4a74-848f-fd6554be5767`
- Thrixel Architect submission: `fa42d2c9-bf20-41ab-a6db-5ab73b542d2c`
- Thrixel grouped submission: `f38b6e30-d64d-4d30-be30-817ec5390466`
- Normalizer report: `skyrail-salvage/evidence/audit/clockwork-glider-normalize.json` (`ok: true`)
- Independent GLB inspection: `skyrail-salvage/evidence/audit/clockwork-glider-inspect.json` (`ok: true`; 18,284 triangles across 10 MeshParts)
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

Local preparation currently passes both manifest validators, six Python tests, Luau syntax checks,
and clean Rojo builds for both games. Studio import, runtime audit, capture, moderation, public
publishing, and device performance remain explicit gates rather than inferred results.

## Known limitations

- Studio remains the supported import and publishing boundary because Open Cloud's Model ID does
  not provide a dependable child MeshId mapping.
- Performance and moderation results cannot be inferred from local source or GLB preflight; both
  must be observed after Studio import on the intended creator account.
