# HYPERSPACE hardware helper.
# Long-lived process: reads "<id> <command> [arg]" lines on stdin, answers "<id>|<json>" on stdout.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
  int j();
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int k(); int l(); int m(); int n();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
  int GetMute(out bool pbMute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev);
}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int f();
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }

public static class HsAudio {
  // dataFlow 1 = capture; roles 0 = console, 2 = communications
  static IAudioEndpointVolume Vol(int role) {
    var en = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
    IMMDevice dev;
    Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(1, role, out dev));
    IAudioEndpointVolume epv;
    var iid = typeof(IAudioEndpointVolume).GUID;
    Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, 0, out epv));
    return epv;
  }
  public static bool GetMute() {
    bool m; Marshal.ThrowExceptionForHR(Vol(0).GetMute(out m)); return m;
  }
  public static void SetMute(bool mute) {
    Marshal.ThrowExceptionForHR(Vol(0).SetMute(mute, Guid.Empty));
    try { Marshal.ThrowExceptionForHR(Vol(2).SetMute(mute, Guid.Empty)); } catch { }
  }
  public static float GetLevel() {
    float l; Marshal.ThrowExceptionForHR(Vol(0).GetMasterVolumeLevelScalar(out l)); return l;
  }
}
'@

function Out-Reply($id, $obj) {
  $json = $obj | ConvertTo-Json -Compress -Depth 5
  [Console]::Out.WriteLine("$id|$json")
  [Console]::Out.Flush()
}

function Get-Perf {
  $disk = Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk -Filter "Name='_Total'"
  $gpu = 0
  try {
    $eng = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine |
      Where-Object { $_.Name -like '*engtype_3D' }
    $gpu = ($eng | Measure-Object -Property UtilizationPercentage -Sum).Sum
    if ($gpu -gt 100) { $gpu = 100 }
  } catch { }
  $nics = @(Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface)
  @{
    diskPct   = [math]::Min(100, [double]$disk.PercentDiskTime)
    diskRead  = [double]$disk.DiskReadBytesPersec
    diskWrite = [double]$disk.DiskWriteBytesPersec
    gpuPct    = [double]$gpu
    netRx     = [double]($nics | Measure-Object -Property BytesReceivedPersec -Sum).Sum
    netTx     = [double]($nics | Measure-Object -Property BytesSentPersec -Sum).Sum
  }
}

# Compact process snapshot: [pid, name, cpuPercentOfOneCore, privateWorkingSetBytes].
# Perf counters see protected/system processes too, without admin (same numbers Task Manager uses).
$cores = [Environment]::ProcessorCount
function Get-Procs {
  $out = New-Object System.Collections.Generic.List[object]
  foreach ($p in Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Property IDProcess, Name, PercentProcessorTime, WorkingSetPrivate) {
    if ($p.IDProcess -eq 0) { continue } # _Total and Idle
    $out.Add(@([int]$p.IDProcess, ($p.Name -replace '#\d+$', ''), [math]::Round($p.PercentProcessorTime / $cores, 2), [long]$p.WorkingSetPrivate))
  }
  , $out.ToArray()
}

function Get-Cams {
  @(Get-PnpDevice -Class Camera, Image -PresentOnly -ErrorAction SilentlyContinue |
    ForEach-Object { @{ name = $_.FriendlyName; id = $_.InstanceId; status = "$($_.Status)" } })
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
  $parts = $line.Trim() -split ' ', 3
  if ($parts.Count -lt 2) { continue }
  $id = $parts[0]; $cmd = $parts[1]; $arg = if ($parts.Count -gt 2) { $parts[2] } else { '' }
  try {
    switch ($cmd) {
      'mute-get' { Out-Reply $id @{ ok = $true; muted = [HsAudio]::GetMute(); level = [HsAudio]::GetLevel() } }
      'mute-set' { [HsAudio]::SetMute($arg -eq '1'); Out-Reply $id @{ ok = $true; muted = [HsAudio]::GetMute() } }
      'perf'     { Out-Reply $id (@{ ok = $true } + (Get-Perf)) }
      'cams'     { Out-Reply $id @{ ok = $true; cams = (Get-Cams) } }
      'procs'    { Out-Reply $id @{ ok = $true; list = (Get-Procs) } }
      'path'     { $pp = $null; try { $pp = (Get-Process -Id ([int]$arg)).Path } catch { }; Out-Reply $id @{ ok = $true; path = $pp } }
      default    { Out-Reply $id @{ ok = $false; error = "unknown command $cmd" } }
    }
  } catch {
    Out-Reply $id @{ ok = $false; error = "$($_.Exception.Message)" }
  }
}
