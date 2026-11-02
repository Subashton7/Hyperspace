using System.Diagnostics;
using System.Text.RegularExpressions;

namespace HyperCore;

/// Processes (CPU / private RAM) plus per-process GPU VRAM and engine load.
/// CPU and memory come from one NtQuerySystemInformation call (the list Task Manager itself reads): the old
/// "Process" perf-counter category took ~0.9 s on a cold read and parsed every counter of every process each time.
/// The GPU counters are still perf counters and cost more, so they're only read when asked for (the task list on
/// screen, VRAM), at most every 3 s.
public sealed class ProcSampler
{
    readonly Dictionary<int, (long create, long cpu)> _prevCpu = new();
    readonly Dictionary<string, CounterSample> _prevEng = new();
    readonly int _cores = Environment.ProcessorCount;
    static readonly Regex Pid = new(@"pid_(\d+)_", RegexOptions.Compiled);
    readonly Stopwatch _clock = Stopwatch.StartNew();
    long _prevAt;
    long _gpuAt = -10000;
    public List<ProcInfo> Last = new();
    public Dictionary<int, long> Vram = new();
    public Dictionary<int, double> GpuLoad = new();
    readonly object _l = new();

    public record ProcInfo(int pid, string name, double cpu, long mem, long vram, double gpu);

    public List<ProcInfo> Sample(bool gpu = false)
    {
        lock (_l)
        {
            if (gpu && _clock.ElapsedMilliseconds - _gpuAt >= 3000) { SampleGpu(); _gpuAt = _clock.ElapsedMilliseconds; }
            long now = _clock.ElapsedTicks, wall = (now - _prevAt) * 10_000_000 / Stopwatch.Frequency; // in 100 ns, like the CPU times
            var list = new List<ProcInfo>();
            var seen = new HashSet<int>();
            SysProcs.Walk((pid, name, create, cpuTime, privateWs) =>
            {
                if (pid == 0 || !seen.Add(pid)) return; // 0 = the Idle "process"
                double c = 0;
                if (_prevCpu.TryGetValue(pid, out var prev) && prev.create == create && wall > 0)
                    c = Math.Max(0, (cpuTime - prev.cpu) * 100.0 / wall / _cores);
                _prevCpu[pid] = (create, cpuTime);
                list.Add(new ProcInfo(pid, name, Math.Round(Math.Min(100, c), 2), privateWs, Vram.GetValueOrDefault(pid), Math.Round(GpuLoad.GetValueOrDefault(pid), 1)));
            });
            _prevAt = now;
            foreach (var dead in _prevCpu.Keys.Where(k => !seen.Contains(k)).ToList()) _prevCpu.Remove(dead);
            Last = list;
            return list;
        }
    }

    /// Just the running programs' file names, lower case ("obs64.exe"): what tasklist was spawned for.
    public static HashSet<string> Names()
    {
        var set = new HashSet<string>();
        SysProcs.Walk((pid, name, _, _, _) => { if (pid != 0) set.Add(name.ToLowerInvariant()); }, keepExt: true);
        return set;
    }

    void SampleGpu()
    {
        var vram = new Dictionary<int, long>();
        try
        {
            var mem = new PerformanceCounterCategory("GPU Process Memory").ReadCategory()["Dedicated Usage"];
            foreach (InstanceData d in mem.Values)
            {
                var m = Pid.Match(d.InstanceName);
                if (m.Success) { int pid = int.Parse(m.Groups[1].Value); vram[pid] = vram.GetValueOrDefault(pid) + d.RawValue; }
            }
        }
        catch { }
        Vram = vram;

        var load = new Dictionary<int, double>();
        try
        {
            var eng = new PerformanceCounterCategory("GPU Engine").ReadCategory()["Utilization Percentage"];
            var seen = new HashSet<string>();
            foreach (InstanceData d in eng.Values)
            {
                seen.Add(d.InstanceName);
                if (_prevEng.TryGetValue(d.InstanceName, out var prev))
                {
                    var m = Pid.Match(d.InstanceName);
                    if (m.Success)
                    {
                        int pid = int.Parse(m.Groups[1].Value);
                        load[pid] = Math.Max(load.GetValueOrDefault(pid), CounterSample.Calculate(prev, d.Sample));
                    }
                }
                _prevEng[d.InstanceName] = d.Sample;
            }
            foreach (var dead in _prevEng.Keys.Where(k => !seen.Contains(k)).ToList()) _prevEng.Remove(dead);
        }
        catch { }
        GpuLoad = load;
    }
}

/// Walks Windows' process list (SystemProcessInformation) without opening any process: sees protected and
/// system processes too, no admin needed. Layout of SYSTEM_PROCESS_INFORMATION on 64-bit Windows (x64 and ARM64).
static class SysProcs
{
    public delegate void Each(int pid, string name, long createTime, long cpuTime, long privateWorkingSet);
    static IntPtr _buf = IntPtr.Zero;
    static int _size = 1 << 20;
    static readonly object L = new();

    public static void Walk(Each each, bool keepExt = false)
    {
        lock (L)
        {
            if (IntPtr.Size != 8) throw new PlatformNotSupportedException("64-bit Windows only");
            while (true)
            {
                if (_buf == IntPtr.Zero) _buf = System.Runtime.InteropServices.Marshal.AllocHGlobal(_size);
                int st = NtQuerySystemInformation(5, _buf, _size, out int need);
                if (st == 0) break;
                if (st != unchecked((int)0xC0000004)) throw new Exception($"process list unavailable (0x{st:X8})");
                // the list grew: make room with some spare (processes start all the time)
                System.Runtime.InteropServices.Marshal.FreeHGlobal(_buf);
                _buf = IntPtr.Zero;
                _size = Math.Max(_size * 2, need + (64 << 10));
            }
            long off = 0;
            while (true)
            {
                var p = _buf + (int)off;
                long privateWs = System.Runtime.InteropServices.Marshal.ReadInt64(p, 8);
                long create = System.Runtime.InteropServices.Marshal.ReadInt64(p, 32);
                long cpu = System.Runtime.InteropServices.Marshal.ReadInt64(p, 40) + System.Runtime.InteropServices.Marshal.ReadInt64(p, 48); // user + kernel
                int len = System.Runtime.InteropServices.Marshal.ReadInt16(p, 56) & 0xFFFF;
                var str = System.Runtime.InteropServices.Marshal.ReadIntPtr(p, 64);
                int pid = (int)System.Runtime.InteropServices.Marshal.ReadInt64(p, 80);
                string name = str == IntPtr.Zero ? (pid == 4 ? "System" : "Idle") : System.Runtime.InteropServices.Marshal.PtrToStringUni(str, len / 2);
                // the perf counters (and so the task list) name processes without ".exe"
                if (!keepExt && name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) name = name[..^4];
                each(pid, name, create, cpu, privateWs);
                int next = System.Runtime.InteropServices.Marshal.ReadInt32(p, 0);
                if (next == 0) break;
                off += next;
            }
        }
    }

    [System.Runtime.InteropServices.DllImport("ntdll.dll")]
    static extern int NtQuerySystemInformation(int infoClass, IntPtr info, int length, out int returnLength);
}

/// Drives, battery and network adapter names: what the app used systeminformation and Get-NetAdapter for.
static class SysInfo
{
    public static object Slow()
    {
        var drives = new List<object>();
        foreach (var d in DriveInfo.GetDrives())
        {
            try
            {
                if (!d.IsReady || d.DriveType is not (DriveType.Fixed or DriveType.Removable)) continue;
                drives.Add(new { mount = d.Name.TrimEnd('\\'), size = d.TotalSize, used = d.TotalSize - d.TotalFreeSpace });
            }
            catch { } // a card reader with no card, a drive going to sleep
        }
        object battery = null;
        if (GetSystemPowerStatus(out var ps) && ps.BatteryFlag != 128 && ps.BatteryFlag != 255 && ps.BatteryLifePercent <= 100)
            battery = new { pct = (int)ps.BatteryLifePercent, charging = (ps.BatteryFlag & 8) != 0, plugged = ps.ACLineStatus == 1 };
        return new { drives, battery };
    }

    // name -> description ("ProtonVPN" -> "WireGuard Tunnel"), hidden adapters included; instant (Get-NetAdapter took ~9 s)
    public static object Adapters() => System.Net.NetworkInformation.NetworkInterface.GetAllNetworkInterfaces()
        .Select(n => new { name = n.Name, desc = n.Description }).ToList();

    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
    struct SYSTEM_POWER_STATUS { public byte ACLineStatus, BatteryFlag, BatteryLifePercent, SystemStatusFlag; public int BatteryLifeTime, BatteryFullLifeTime; }
    [System.Runtime.InteropServices.DllImport("kernel32.dll")] static extern bool GetSystemPowerStatus(out SYSTEM_POWER_STATUS s);
}

/// Disk + network throughput.
public sealed class IoSampler
{
    PerformanceCounter _dPct, _dR, _dW;
    readonly Dictionary<string, CounterSample> _prevRx = new(), _prevTx = new();

    public IoSampler()
    {
        try
        {
            _dPct = new("PhysicalDisk", "% Disk Time", "_Total"); _dPct.NextValue();
            _dR = new("PhysicalDisk", "Disk Read Bytes/sec", "_Total"); _dR.NextValue();
            _dW = new("PhysicalDisk", "Disk Write Bytes/sec", "_Total"); _dW.NextValue();
        }
        catch { }
    }

    public object Read()
    {
        double pct = 0, r = 0, w = 0, rx = 0, tx = 0;
        try { pct = Math.Min(100, _dPct.NextValue()); r = _dR.NextValue(); w = _dW.NextValue(); } catch { }
        try
        {
            var cat = new PerformanceCounterCategory("Network Interface").ReadCategory();
            rx = Rate(cat["Bytes Received/sec"], _prevRx);
            tx = Rate(cat["Bytes Sent/sec"], _prevTx);
        }
        catch { }
        return new { disk = new { pct = Math.Round(pct, 1), read = r, write = w }, net = new { rx, tx } };
    }

    static double Rate(InstanceDataCollection col, Dictionary<string, CounterSample> prev)
    {
        double sum = 0;
        foreach (InstanceData d in col.Values)
        {
            if (prev.TryGetValue(d.InstanceName, out var p)) sum += Math.Max(0, CounterSample.Calculate(p, d.Sample));
            prev[d.InstanceName] = d.Sample;
        }
        return sum;
    }
}

/// RAM vacuum: trim background apps, flush modified pages, purge the standby cache.
public sealed class MemoryVac
{
    PerformanceCounter _sCore, _sNorm, _sRes, _mod, _free, _avail;
    readonly AudioDevices _audio;
    public string[] Exclude = { "Ableton*", "Arena", "Avenue", "Synesthesia", "obs64", "Waveform*", "Resolume*", "TouchDesigner*", "voicemeeter*", "MagicDemo", "Magic*", "Serato*", "rekordbox*", "Traktor*", "VirtualDJ*" };
    static readonly HashSet<string> Never = new(StringComparer.OrdinalIgnoreCase)
    {
        "System", "Registry", "smss", "csrss", "wininit", "winlogon", "services", "lsass", "Memory Compression", "dwm",
        "audiodg", "MsMpEng", "HyperCore", "electron", "HYPERSPACE", "svchost", "fontdrvhost", "LsaIso", "Secure System",
    };

    public MemoryVac(AudioDevices audio)
    {
        _audio = audio;
        try
        {
            _sCore = new("Memory", "Standby Cache Core Bytes");
            _sNorm = new("Memory", "Standby Cache Normal Priority Bytes");
            _sRes = new("Memory", "Standby Cache Reserve Bytes");
            _mod = new("Memory", "Modified Page List Bytes");
            _free = new("Memory", "Free & Zero Page List Bytes");
            _avail = new("Memory", "Available Bytes");
        }
        catch { }
    }

    static bool Match(string name, string pattern) =>
        pattern.EndsWith('*') ? name.StartsWith(pattern[..^1], StringComparison.OrdinalIgnoreCase) : name.Equals(pattern, StringComparison.OrdinalIgnoreCase);

    (List<ProcSampler.ProcInfo> targets, List<object> skipped) Targets(List<ProcSampler.ProcInfo> procs)
    {
        var playing = _audio.PlayingPids();
        var self = Environment.ProcessId;
        var targets = new List<ProcSampler.ProcInfo>();
        var skipped = new List<object>();
        foreach (var p in procs)
        {
            if (p.pid <= 4 || p.pid == self || Never.Contains(p.name)) continue;
            if (playing.Contains(p.pid)) { skipped.Add(new { p.name, why = "playing audio" }); continue; }
            if (Exclude.Any(x => Match(p.name, x))) { skipped.Add(new { p.name, why = "protected VJ/audio app" }); continue; }
            if (p.mem < 8 * 1024 * 1024) continue; // not worth touching
            targets.Add(p);
        }
        return (targets, skipped.GroupBy(s => s.ToString()).Select(g => g.First()).ToList());
    }

    public object Plan(List<ProcSampler.ProcInfo> procs, bool trim)
    {
        long standby = (long)((_sCore?.NextValue() ?? 0) + (_sNorm?.NextValue() ?? 0) + (_sRes?.NextValue() ?? 0));
        long modified = (long)(_mod?.NextValue() ?? 0), free = (long)(_free?.NextValue() ?? 0), avail = (long)(_avail?.NextValue() ?? 0);
        var (targets, skipped) = Targets(procs);
        long trimBytes = targets.Sum(t => t.mem);
        var actions = new List<string>();
        if (trim) actions.Add($"Trim the working sets of {targets.Count} background apps ({Fmt(trimBytes)} resident). Their pages move to standby and reload on demand.");
        actions.Add($"Flush {Fmt(modified)} of modified pages to disk");
        actions.Add($"Purge {Fmt(standby)} of standby cache back to free memory");
        return new
        {
            elevated = Program.Elevated, standby, modified, free, available = avail, trimCount = targets.Count, trimBytes, trim,
            actions, skipped = skipped.Take(12), top = targets.OrderByDescending(t => t.mem).Take(5).Select(t => new { t.name, t.mem }),
        };
    }

    public object Run(List<ProcSampler.ProcInfo> procs, bool trim)
    {
        if (!Program.Elevated) throw new Exception("RAM vacuum needs the core running as admin");
        long before = (long)(_avail?.NextValue() ?? 0);
        MemApi.EnablePrivilege("SeProfileSingleProcessPrivilege");
        MemApi.EnablePrivilege("SeIncreaseQuotaPrivilege");
        int trimmed = 0;
        if (trim)
        {
            foreach (var t in Targets(procs).targets)
            {
                var h = MemApi.OpenProcess(MemApi.PROCESS_SET_QUOTA | MemApi.PROCESS_QUERY_LIMITED_INFORMATION, false, t.pid);
                if (h == IntPtr.Zero) continue;
                if (MemApi.EmptyWorkingSet(h)) trimmed++;
                MemApi.CloseHandle(h);
            }
        }
        int cmd = MemApi.MemoryFlushModifiedList;
        int flush = MemApi.NtSetSystemInformation(MemApi.SystemMemoryListInformation, ref cmd, sizeof(int));
        cmd = MemApi.MemoryPurgeStandbyList;
        int purge = MemApi.NtSetSystemInformation(MemApi.SystemMemoryListInformation, ref cmd, sizeof(int));
        Thread.Sleep(400);
        long after = (long)(_avail?.NextValue() ?? 0);
        long freeAfter = (long)(_free?.NextValue() ?? 0);
        return new { trimmed, flushOk = flush == 0, purgeOk = purge == 0, availableBefore = before, availableAfter = after, freeAfter };
    }

    public static string Fmt(long b) => b >= 1L << 30 ? $"{b / (double)(1L << 30):0.0} GB" : $"{b / (double)(1L << 20):0} MB";
}

/// Monitors: list modes, switch resolution/refresh (auto-reverts unless kept), switch topology.
public sealed class Displays
{
    readonly object _l = new();
    (string device, DisplayApi.DEVMODE mode)? _pendingMode;
    int? _pendingTopology;
    Timer _revert;
    int _token;

    public object List()
    {
        var list = new List<object>();
        var ad = DisplayApi.NewDevice();
        for (uint i = 0; DisplayApi.EnumDisplayDevices(null, i, ref ad, 0); i++, ad = DisplayApi.NewDevice())
        {
            if ((ad.StateFlags & 1) == 0) continue; // attached to desktop
            var mon = DisplayApi.NewDevice();
            DisplayApi.EnumDisplayDevices(ad.DeviceName, 0, ref mon, 0);
            var cur = DisplayApi.NewMode();
            DisplayApi.EnumDisplaySettingsEx(ad.DeviceName, DisplayApi.ENUM_CURRENT_SETTINGS, ref cur, 0);
            var modes = new HashSet<(int w, int h, int hz)>();
            var m = DisplayApi.NewMode();
            for (int n = 0; DisplayApi.EnumDisplaySettingsEx(ad.DeviceName, n, ref m, 0); n++, m = DisplayApi.NewMode())
                if (m.dmBitsPerPel == 32 && m.dmPelsWidth >= 800) modes.Add((m.dmPelsWidth, m.dmPelsHeight, m.dmDisplayFrequency));
            bool internalPanel = Regex.IsMatch(mon.DeviceID ?? "", @"\\(CMN|AUO|BOE|LGD|SHP|SDC|IVO|LEN40|NCP|CSO)", RegexOptions.IgnoreCase);
            list.Add(new
            {
                device = ad.DeviceName, adapter = ad.DeviceString, name = string.IsNullOrWhiteSpace(mon.DeviceString) ? "Display" : mon.DeviceString,
                primary = (ad.StateFlags & 4) != 0, internalPanel,
                width = cur.dmPelsWidth, height = cur.dmPelsHeight, hz = cur.dmDisplayFrequency, x = cur.dmPositionX, y = cur.dmPositionY,
                modes = modes.OrderByDescending(x => x.w * x.h).ThenByDescending(x => x.hz).Select(x => new[] { x.w, x.h, x.hz }),
            });
        }
        return new { displays = list, topology = Topology(), pending = _pendingMode != null || _pendingTopology != null };
    }

    static string Topology()
    {
        try
        {
            DisplayApi.GetDisplayConfigBufferSizes(DisplayApi.QDC_DATABASE_CURRENT, out var np, out var nm);
            var paths = System.Runtime.InteropServices.Marshal.AllocHGlobal((int)Math.Max(1, np) * 72);
            var modes = System.Runtime.InteropServices.Marshal.AllocHGlobal((int)Math.Max(1, nm) * 64);
            try
            {
                int r = DisplayApi.QueryDisplayConfig(DisplayApi.QDC_DATABASE_CURRENT, ref np, paths, ref nm, modes, out int topo);
                return r != 0 ? null : topo switch { 1 => "internal", 2 => "clone", 4 => "extend", 8 => "external", _ => null };
            }
            finally
            {
                System.Runtime.InteropServices.Marshal.FreeHGlobal(paths);
                System.Runtime.InteropServices.Marshal.FreeHGlobal(modes);
            }
        }
        catch { return null; }
    }

    public object SetMode(string device, int w, int h, int hz)
    {
        lock (_l)
        {
            var cur = DisplayApi.NewMode();
            if (!DisplayApi.EnumDisplaySettingsEx(device, DisplayApi.ENUM_CURRENT_SETTINGS, ref cur, 0)) throw new Exception("display not found");
            var dm = DisplayApi.NewMode();
            dm.dmPelsWidth = w; dm.dmPelsHeight = h; dm.dmDisplayFrequency = hz;
            dm.dmFields = DisplayApi.DM_PELSWIDTH | DisplayApi.DM_PELSHEIGHT | DisplayApi.DM_DISPLAYFREQUENCY;
            int test = DisplayApi.ChangeDisplaySettingsEx(device, ref dm, IntPtr.Zero, DisplayApi.CDS_TEST, IntPtr.Zero);
            if (test != 0) throw new Exception("this mode was rejected by the driver");
            int r = DisplayApi.ChangeDisplaySettingsEx(device, ref dm, IntPtr.Zero, DisplayApi.CDS_UPDATEREGISTRY, IntPtr.Zero);
            if (r != 0) throw new Exception("mode change failed (" + r + ")");
            _pendingTopology = null;
            _pendingMode = (device, cur);
            return Arm();
        }
    }

    public object SetTopology(string mode)
    {
        lock (_l)
        {
            uint flag = mode switch { "internal" => 1u, "clone" => 2u, "extend" => 4u, "external" => 8u, _ => throw new Exception("unknown topology") };
            var before = Topology();
            int r = DisplayApi.SetDisplayConfig(0, IntPtr.Zero, 0, IntPtr.Zero, DisplayApi.SDC_APPLY | flag);
            if (r != 0) throw new Exception("Windows refused that arrangement (" + r + ")");
            _pendingMode = null;
            _pendingTopology = before switch { "internal" => 1, "clone" => 2, "extend" => 4, "external" => 8, _ => null };
            return Arm();
        }
    }

    object Arm()
    {
        int token = ++_token;
        _revert?.Dispose();
        _revert = new Timer(_ => Revert(token), null, 15000, Timeout.Infinite);
        return new { token, revertIn = 15 };
    }

    public object Keep(int token)
    {
        lock (_l)
        {
            if (token != _token) return new { kept = false };
            _revert?.Dispose(); _revert = null; _pendingMode = null; _pendingTopology = null;
            return new { kept = true };
        }
    }

    public object RevertNow(int token) { Revert(token); return true; }

    void Revert(int token)
    {
        lock (_l)
        {
            if (token != _token) return;
            if (_pendingMode is { } pm)
            {
                var dm = pm.mode;
                dm.dmFields = DisplayApi.DM_PELSWIDTH | DisplayApi.DM_PELSHEIGHT | DisplayApi.DM_DISPLAYFREQUENCY;
                DisplayApi.ChangeDisplaySettingsEx(pm.device, ref dm, IntPtr.Zero, DisplayApi.CDS_UPDATEREGISTRY, IntPtr.Zero);
            }
            if (_pendingTopology is { } t) DisplayApi.SetDisplayConfig(0, IntPtr.Zero, 0, IntPtr.Zero, DisplayApi.SDC_APPLY | (uint)t);
            _pendingMode = null; _pendingTopology = null;
            Program.Event("display-reverted", new { token });
        }
    }

    /// Dry-run: ask the driver whether a mode would work without applying it.
    public bool Test(string device, int w, int h, int hz)
    {
        var dm = DisplayApi.NewMode();
        dm.dmPelsWidth = w; dm.dmPelsHeight = h; dm.dmDisplayFrequency = hz;
        dm.dmFields = DisplayApi.DM_PELSWIDTH | DisplayApi.DM_PELSHEIGHT | DisplayApi.DM_DISPLAYFREQUENCY;
        return DisplayApi.ChangeDisplaySettingsEx(device, ref dm, IntPtr.Zero, DisplayApi.CDS_TEST, IntPtr.Zero) == 0;
    }
}
