# Capture time

`LilToonMaterial.renderTimeSeconds` is a nullable, finite, nonnegative number.
The constructor accepts the same option. Set it on each material participating in
capture before rendering; restore the previous value after capture. `null` uses
the original per-material elapsed clock. Clearing it resumes that clock rather
than restarting it. Zero is a valid capture time.

The normal material callback derives `uTime = (t / 20, t, 2t, 3t)` from this
clock. Automatic outlines and auxiliary LilToon passes inherit the source clock
on each render, even when no material property revision changed. Cloning also
preserves it. This is transient renderer state, excluded from lilToon JSON and
all asset schemas. Applications must use this public property rather than
rewriting private uniform payloads.

The unit tests compare every uniform recursively, including nested `_Globals`,
under changing wall clocks. The real WebGL integration fixture compares two
actual MSAA-4 draws (forward and automatic outline) at 0.65 seconds. Its snapshots
are read-only observations after the ordinary renderer callbacks. Pixel equality
is a separate application-level criterion; fixing time does not claim raster
samples are bitwise deterministic.

## CI toolchain

The existing 4090 `three-chara-light` self-hosted runner uses Node 24.22.1,
`npm ci`, the pinned lilToon git submodule, and the Vulkan SDK 1.4.357.1
binaries under `/home/kurasuai4090/.local/share/vulkan-sdk/1.4.357.1/x86_64`.
This persistent tool installation is independent of review worktrees.
`tools:check` checks the repository's pinned DXC/SPIRV-Tools versions before
shader generation. The installed executable SHA-256 values are:

| Executable | SHA-256 |
| --- | --- |
| dxc | 52c46bfb0019a7a39757fe925f33249f61b7473800d85bb911a6b9d07fd65e50 |
| spirv-cross | f7ff9850a0e8e3bb93f27b43689b898c9fb2c02cf22f40d08f209a7f533c8da6 |
| spirv-val | d8db252e34aa10c388248d21bc834096e9b54587000e7a3ca2db56e9c36ea450 |

CI runs shader generation, strict type checking, the unit suite, and package
staging. Browser verification runs on the managed MotionAtelier review preview;
CI does not launch an unmanaged web server.

## Measured verification

On 2026-11-04, 4090 Windows Chrome/D3D11 rendered the MSAA-4 fixture twice
with a 30 ms wall-clock gap. Forward and automatic outline snapshots matched
exactly: two draws, all uniforms including 374 nested `_Globals` fields,
`uTime = [0.0325, 0.65, 1.3, 1.9500000000000002]`, WebGL error 0, browser
errors 0. The fixture also displays the synthetic scene for inspection.
The detached Linux validation passed strict type checking, all 209 unit tests
in 27 files, and package staging. MotionAtelier product captures still require
the separately merged native/API vendor bump and application integration.
