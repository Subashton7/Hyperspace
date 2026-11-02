# HYPERSPACE performance audit: before and after

Measured 2026-10-30 on the Acer Nitro AN515-58 (Windows 11, 24 GB RAM), base commit d7089a8 (v0.13.3).

## Background work of the running app

Installed HYPERSPACE 0.13.3 with the real settings: side dock on (apps, thermals, VPN, temps, CPU, GPU, RAM, net,
shield, media, fans, disk, drives, CRATE), phone link on, Spout on (starts with a VJ app), live wallpaper on,
silent admin core. Two minutes, measured from outside (`measure.ps1`: new processes from a WMI creation watch,
CPU from each process's total CPU time).

| What | Before |
| --- | --- |
| Helper programs started by HYPERSPACE | **~64 per minute**: reg.exe 33/min, tasklist 14/min, PowerShell 14/min, netsh 2/min |
| CPU of all HYPERSPACE processes (not the admin core: Windows hides its numbers) | ~28% of one core (1.8% of the whole 16-thread CPU) |

A clean "NEXUS for 2 min, then minimised for 2 min" run on a separate test copy wasn't possible: this laptop runs at
~94% of its memory limit (RAM + a fixed 4 GB page file), and a second HYPERSPACE made the running one close.

## HyperCore

`corestart.js`: start HyperCore.exe, time the hello (online), the first telemetry and two `procs` calls. Median of 5.

| What | Before |
| --- | --- |
| Start → online (hello) | 327 ms |
| Start → first telemetry | 1219 ms |
| First `procs` answer after the hello | 876 ms |
| Warm `procs` | 27 ms |
| Mic / camera state (`hw.getState`, reg.exe ×4 + PowerShell) | 3858 ms |
| 6 tracks analysed (one HyperCore per track, one after another) | 8857 ms |

# After (branch perf/background-work), 2026-11-02

Same test profile (copy of the real settings, core without admin, wallpaper off), old version (d7089a8) and new
version each run in turn next to the installed HYPERSPACE: 45 s to settle, 2 min on NEXUS, 2 min minimised.

| What | Before | After |
| --- | --- | --- |
| Helper programs started, NEXUS | 77 per minute (reg.exe 46, PowerShell 14, tasklist 14, netsh 2.5) | **0.5 per minute** (just the analysis/GPU helper once) |
| Helper programs started, minimised | 75 per minute | **0** |
| Main process CPU (10 s samples, NEXUS) | 13–16% of one core | **1–5%** |
| All HYPERSPACE processes, minimised | 85% of one core | **53%** |
| All HYPERSPACE processes, NEXUS | 82% of one core | 208% in the first run, but see below |
| HyperCore CPU, NEXUS / minimised | 3.3% / 2.7% | 2.0% / 0.7% |

The NEXUS total is dominated by the graphics process (the animated background), which swung between 33% and 77% of
one core in back-to-back 10 s samples of the *same* version; the 208% A/B run caught it at a high point. The
per-process probe shows the parts this branch changed (main process, core, child programs) all went down; the
background animation itself wasn't touched (lite mode already handles it).

HyperCore on its own (median of 5–7 starts):

| What | Before | After |
| --- | --- | --- |
| Start → online | 327 ms | ~390 ms (single-file unpack; ReadyToRun makes the exe bigger) |
| First process list after online | 876 ms | 731 ms |
| Warm process list | 27 ms | 5 ms |
| Mic / camera state | 3858 ms (reg.exe ×4 + PowerShell) | 9–12 ms (first call ~1.5 s: camera list from WMI) |
| 6 tracks analysed | 8857 ms | 3740 ms (same BPM and key) |
| VPN adapter + app check | ~9 s (Get-NetAdapter) + tasklist | ~30 ms |

## Hands-on checks (new version, core without admin)

- NEXUS task list: 308 processes, 123 rows shown, CPU on 65, VRAM/GPU columns filled. ✓
- Drives (C:) and battery (96%, charging) in perf. ✓
- Mic and camera switches: flipped and flipped back through the core; Windows' settings read Deny/muted again
  afterwards, exactly as before the test. ✓ Orbs show SEALED. ✓
- VPN: Proton VPN app detected (tunnel was off at the time). ✓
- VJ tab: 247 audio (FFT) events in 4 s reached the window holding the lease. ✓
- CRATE: rekordbox library loaded, 3,295 tracks. ✓
- Side dock: started and attached, but the test screenshot caught it slid away, so its cards weren't seen by eye.
  It uses the same calls checked above.

## Not tested here (test by hand)

- The admin (silent-admin task) core: fans, RAM vacuum, camera hard kill. Nothing in those paths changed, but the
  new core build hasn't run elevated yet.
- The side dock's cards by eye, and the phone link on a real phone.
- arm64 build: compiles, not run (no ARM laptop).

## Follow-ups (not done)

- Spout shared-texture rewrite (frames copied off the graphics chip every frame; big change).
- The animated background's graphics-process cost is now the largest steady cost on NEXUS.
