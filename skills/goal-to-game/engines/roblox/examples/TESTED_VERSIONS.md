# Roblox benchmark test matrix

Recorded on 2026-08-15. A row marked `pending` is not presented as tested evidence.

| Component | Version / environment | Status | Evidence |
| --- | --- | --- | --- |
| Windows host | Windows NT 10.0.26200.0 | verified | Repository tests and both Rojo builds completed on this host. |
| Roblox Studio | 0.734.0.7340915 | verified | Both imported places passed account-bound Studio self-tests with no failures or warnings. |
| Rojo | 7.6.1 | verified | Built `Stormwatch.rbxlx` and `CourierCircuit.rbxlx` successfully. |
| Python | 3.13.14 | verified | All 21 Roblox engine tests pass. The optional place-script injector uses `lxml`. |
| macOS host | Not run | pending | Installation and fallback instructions are documented but not claimed as tested. |
| WSL host boundary | Not run | pending | Windows-host Studio boundary is documented but not claimed as tested. |
| Desktop runtime | 788 x 673 Studio viewport | verified | Stormwatch averaged 58.4 FPS; Courier Circuit averaged 58.2 FPS. |
| Mobile viewport | iPhone XR emulator, 801 x 392 runtime viewport | verified | Stormwatch averaged 58.3 FPS; Courier Circuit averaged 58.5 FPS. |
