# Roblox benchmark test matrix

Recorded on 2026-08-15. A row marked `pending` is not presented as tested evidence.

| Component | Version / environment | Status | Evidence |
| --- | --- | --- | --- |
| Windows host | Windows NT 10.0.26200.0 | verified | Repository tests and both Rojo builds completed on this host. |
| Roblox Studio | 0.734.0.7340915 | partial | Installed Studio build and imported scene serialization verified; final runtime capture is pending. |
| Rojo | 7.6.1 | verified | Built `Stormwatch.rbxlx` and `CourierCircuit.rbxlx` successfully. |
| Python | 3.13.14 | verified | All 13 Roblox engine tests pass without third-party packages. |
| macOS host | Not run | pending | Installation and fallback instructions are documented but not claimed as tested. |
| WSL host boundary | Not run | pending | Windows-host Studio boundary is documented but not claimed as tested. |
| Desktop runtime | Account-bound Studio run | pending | Record screenshots, self-test JSON, and frame-rate evidence before marking the PR ready. |
| Mobile viewport | Account-bound Studio emulation | pending | Record viewport and frame-rate evidence before marking the PR ready. |
