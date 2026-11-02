using System.Diagnostics;
using System.Management;
using System.Text;
using System.Text.Json.Nodes;

namespace HyperCore;

/// Acer gaming WMI (root\WMI AcerGamingFunction) - the interface NitroSense uses.
/// Bit layouts follow the Linux acer-wmi driver, which lists the Nitro AN515-58 as supported.
public sealed class Acer
{
    readonly object _l = new();
    ManagementObject _o;
    public bool Ok { get; private set; }
    public string Error { get; private set; }

    public const int FanAuto = 1, FanMax = 2, FanCustom = 3;
    public const int CpuFan = 0x01, GpuFan = 0x04;
    public static readonly Dictionary<string, int> Profiles = new()
    {
        ["quiet"] = 0x00, ["balanced"] = 0x01, ["performance"] = 0x04, ["turbo"] = 0x05, ["eco"] = 0x06,
    };

    public Acer()
    {
        try
        {
            using var s = new ManagementObjectSearcher(new ManagementScope(@"root\WMI"), new ObjectQuery("SELECT * FROM AcerGamingFunction"));
            foreach (ManagementObject m in s.Get()) { _o = m; break; }
            Ok = _o != null;
            if (!Ok) Error = "Acer gaming interface not found";
        }
        catch (Exception e) { Error = e.Message.Contains("denied", StringComparison.OrdinalIgnoreCase) ? "needs admin" : e.Message; }
    }

    ulong Call(string method, ulong input, bool wide)
    {
        lock (_l)
        {
            var p = _o.GetMethodParameters(method);
            p["gmInput"] = wide ? (object)input : (uint)input;
            using var r = _o.InvokeMethod(method, p, null);
            return Convert.ToUInt64(r["gmOutput"]);
        }
    }

    /// Sensor ids: 0x01 CPU temp, 0x02 CPU fan rpm, 0x03 ext temp, 0x06 GPU fan rpm, 0x0A GPU temp.
    public int? Sensor(int id)
    {
        if (!Ok) return null;
        try
        {
            var r = Call("GetGamingSysInfo", (ulong)(0x0001 | (id << 8)), false);
            return (r & 0xFF) == 0 ? (int)((r >> 8) & 0xFFFF) : null;
        }
        catch { return null; }
    }

    public bool SetFanBehavior(int cpuMode, int gpuMode)
    {
        ulong v = 0;
        if (cpuMode > 0) v |= 0x1UL | ((ulong)cpuMode << 16);
        if (gpuMode > 0) v |= 0x8UL | ((ulong)gpuMode << 22);
        try { return (Call("SetGamingFanBehavior", v, true) & 0xFF) == 0; }
        catch (Exception e) { Error = e.Message; return false; }
    }

    public (int cpu, int gpu)? GetFanBehavior()
    {
        try
        {
            var r = Call("GetGamingFanBehavior", 0x9, false);
            if ((r & 0xFF) != 0) return null;
            return ((int)((r >> 8) & 3), (int)((r >> 14) & 3));
        }
        catch { return null; }
    }

    public bool SetFanSpeed(int fan, int pct)
    {
        pct = Math.Clamp(pct, 0, 100);
        try { return (Call("SetGamingFanSpeed", (ulong)(fan | (pct << 8)), true) & 0xFF) == 0; }
        catch (Exception e) { Error = e.Message; return false; }
    }

    public int? GetMisc(int index)
    {
        try
        {
            var r = Call("GetGamingMiscSetting", (ulong)index, false);
            return (r & 0xFF) == 0 ? (int)((r >> 8) & 0xFF) : null;
        }
        catch { return null; }
    }

    public bool SetMisc(int index, int value)
    {
        try { return (Call("SetGamingMiscSetting", (ulong)(index | (value << 8)), true) & 0xFF) == 0; }
        catch (Exception e) { Error = e.Message; return false; }
    }

    public string Profile()
    {
        var v = GetMisc(0x0B);
        return v == null ? null : Profiles.FirstOrDefault(p => p.Value == v).Key ?? $"0x{v:X}";
    }

    public bool SetProfile(string name) => Profiles.TryGetValue(name, out var v) && SetMisc(0x0B, v);
}

/// NVIDIA dGPU via NVML (+ NVAPI for voltage).
public sealed class Gpu
{
    IntPtr _dev;
    public bool Ok { get; private set; }
    public string Name = "", Error;
    public uint MaxClock, MaxMemClock, TSlowdown, TShutdown, TMax;
    public uint? LockMax, MemLockMax;
    readonly object _l = new();

    public Gpu()
    {
        try
        {
            int r = Nvml.nvmlInit_v2();
            if (r != 0) { Error = Nvml.Err(r); return; }
            r = Nvml.nvmlDeviceGetHandleByIndex_v2(0, out _dev);
            if (r != 0) { Error = Nvml.Err(r); return; }
            var sb = new StringBuilder(96);
            Nvml.nvmlDeviceGetName(_dev, sb, 96);
            Name = sb.ToString();
            Nvml.nvmlDeviceGetMaxClockInfo(_dev, 0, out MaxClock);
            Nvml.nvmlDeviceGetMaxClockInfo(_dev, 2, out MaxMemClock);
            Nvml.nvmlDeviceGetTemperatureThreshold(_dev, 0, out TShutdown);
            Nvml.nvmlDeviceGetTemperatureThreshold(_dev, 1, out TSlowdown);
            Nvml.nvmlDeviceGetTemperatureThreshold(_dev, 3, out TMax);
            Ok = true;
        }
        catch (DllNotFoundException) { Error = "no NVIDIA driver"; }
        catch (Exception e) { Error = e.Message; }
    }

    public object Read()
    {
        if (!Ok) return null;
        lock (_l)
        {
            uint t = 0, gr = 0, mem = 0, mw = 0, lim = 0;
            bool hasT = Nvml.nvmlDeviceGetTemperature(_dev, 0, out t) == 0;
            Nvml.nvmlDeviceGetClockInfo(_dev, 0, out gr);
            Nvml.nvmlDeviceGetClockInfo(_dev, 2, out mem);
            bool hasP = Nvml.nvmlDeviceGetPowerUsage(_dev, out mw) == 0;
            Nvml.nvmlDeviceGetEnforcedPowerLimit(_dev, out lim);
            Nvml.nvmlDeviceGetUtilizationRates(_dev, out var u);
            Nvml.nvmlDeviceGetMemoryInfo(_dev, out var m);
            Nvml.nvmlDeviceGetPerformanceState(_dev, out int ps);
            Nvml.nvmlDeviceGetCurrentClocksThrottleReasons(_dev, out ulong reasons);
            return new
            {
                temp = hasT ? (int?)t : null, clock = gr, memClock = mem, power = hasP ? mw / 1000.0 : (double?)null,
                powerLimit = lim / 1000.0, util = u.gpu, memUtil = u.memory, memUsed = m.used, memTotal = m.total,
                pstate = ps, throttle = Throttle(reasons), voltage = NvApi.CoreVoltage(),
            };
        }
    }

    static string[] Throttle(ulong r)
    {
        var l = new List<string>();
        if ((r & 0x4) != 0) l.Add("power cap");
        if ((r & 0x20) != 0) l.Add("thermal (sw)");
        if ((r & 0x40) != 0) l.Add("thermal (hw)");
        if ((r & 0x80) != 0) l.Add("power brake");
        if ((r & 0x2) != 0) l.Add("app clocks");
        return l.ToArray();
    }

    public string LockClocks(uint max)
    {
        if (!Ok) return Error;
        lock (_l)
        {
            int r = max == 0 ? Nvml.nvmlDeviceResetGpuLockedClocks(_dev) : Nvml.nvmlDeviceSetGpuLockedClocks(_dev, 210, max);
            if (r == 0) LockMax = max == 0 ? null : max;
            return Nvml.Err(r);
        }
    }

    public string LockMemClocks(uint max)
    {
        if (!Ok) return Error;
        lock (_l)
        {
            int r = max == 0 ? Nvml.nvmlDeviceResetMemoryLockedClocks(_dev) : Nvml.nvmlDeviceSetMemoryLockedClocks(_dev, 405, max);
            if (r == 0) MemLockMax = max == 0 ? null : max;
            return Nvml.Err(r);
        }
    }
}

/// CPU: effective clock and package power from Windows perf counters (no driver needed);
/// voltage/per-core temps from LibreHardwareMonitor when the optional PawnIO driver is installed.
public sealed class Cpu
{
    PerformanceCounter _perf, _freq, _util, _power;
    LibreHardwareMonitor.Hardware.Computer _lhm;
    public bool LhmVoltage { get; private set; }
    public string LhmNote = "PawnIO driver not installed";

    public Cpu()
    {
        try { _perf = new("Processor Information", "% Processor Performance", "_Total"); _perf.NextValue(); } catch { }
        try { _freq = new("Processor Information", "Processor Frequency", "_Total"); } catch { }
        try { _util = new("Processor Information", "% Processor Utility", "_Total"); _util.NextValue(); } catch { }
        try { _power = new("Energy Meter", "Power", "RAPL_Package0_PKG"); } catch { }
        if (Program.Elevated)
        {
            try
            {
                _lhm = new LibreHardwareMonitor.Hardware.Computer { IsCpuEnabled = true };
                _lhm.Open();
                foreach (var h in _lhm.Hardware)
                {
                    h.Update();
                    if (h.Sensors.Any(s => s.SensorType == LibreHardwareMonitor.Hardware.SensorType.Voltage && s.Value is > 0.3f and < 2f))
                    { LhmVoltage = true; LhmNote = null; }
                }
                if (!LhmVoltage) { _lhm.Close(); _lhm = null; }
            }
            catch (Exception e) { LhmNote = e.Message; _lhm = null; }
        }
        else LhmNote = "needs admin";
    }

    public (double? clock, double? util, double? power, double? voltage, double? lhmTemp) Read()
    {
        double? clock = null, util = null, power = null, volt = null, temp = null;
        try { if (_perf != null && _freq != null) clock = _freq.NextValue() * _perf.NextValue() / 100.0; } catch { }
        try { if (_util != null) util = Math.Min(100, _util.NextValue()); } catch { }
        try { if (_power != null) power = _power.NextValue() / 1000.0; } catch { }
        if (_lhm != null)
        {
            try
            {
                foreach (var h in _lhm.Hardware)
                {
                    h.Update();
                    var v = h.Sensors.Where(s => s.SensorType == LibreHardwareMonitor.Hardware.SensorType.Voltage && s.Value is > 0.3f and < 2f)
                        .OrderByDescending(s => s.Name.Contains("Core") ? 1 : 0).FirstOrDefault();
                    if (v != null) volt = v.Value;
                    var t = h.Sensors.FirstOrDefault(s => s.SensorType == LibreHardwareMonitor.Hardware.SensorType.Temperature && s.Name.Contains("Package"));
                    if (t?.Value != null) temp = t.Value;
                }
            }
            catch { }
        }
        return (clock, util, power, volt, temp);
    }
}

/// Fan curves -> Acer custom fan speed. Safety: floors above 88C and falls back to auto if temps disappear.
/// Acer's custom percentage is measured from the fans' idle speed, not from zero (AN515-58, measured with
/// `--fan-cal`): 0% ≈ 2,800 rpm (the same as firmware auto at idle), 30% ≈ 4,200, 50% ≈ 5,000, 100% ≈ 7,500.
/// Laptop CPUs also jump 20-30°C for a second whenever something starts, so the curve follows a smoothed
/// temperature and the speed moves a few percent per second: short spikes never become a fan roar.
public sealed class FanController
{
    readonly Acer _acer;
    public string Mode = "auto"; // auto | max | curve
    public int[][] CpuCurve = Curves["balanced"].cpu, GpuCurve = Curves["balanced"].gpu;
    public bool Override; // overheat protocol forces max
    public string Applied, LastError;
    int _cpuPct = -1, _gpuPct = -1, _missing;
    DateTime _cpuLower, _gpuLower;
    double _cpuSm = double.NaN, _gpuSm = double.NaN;
    readonly object _l = new();

    public static readonly Dictionary<string, (int[][] cpu, int[][] gpu)> Curves = new()
    {
        // quiet stays at the idle speed until the laptop is properly warm, like the firmware does
        ["quiet"] = (new[] { new[] { 50, 0 }, new[] { 65, 0 }, new[] { 75, 10 }, new[] { 82, 25 }, new[] { 88, 50 }, new[] { 95, 100 } },
                     new[] { new[] { 50, 0 }, new[] { 62, 0 }, new[] { 70, 12 }, new[] { 77, 30 }, new[] { 83, 55 }, new[] { 87, 100 } }),
        ["balanced"] = (new[] { new[] { 45, 0 }, new[] { 60, 5 }, new[] { 70, 18 }, new[] { 78, 35 }, new[] { 85, 60 }, new[] { 92, 100 } },
                        new[] { new[] { 45, 0 }, new[] { 58, 5 }, new[] { 66, 20 }, new[] { 74, 40 }, new[] { 80, 65 }, new[] { 86, 100 } }),
        ["aggressive"] = (new[] { new[] { 40, 10 }, new[] { 55, 22 }, new[] { 65, 38 }, new[] { 75, 60 }, new[] { 82, 85 }, new[] { 88, 100 } },
                          new[] { new[] { 40, 10 }, new[] { 52, 25 }, new[] { 62, 45 }, new[] { 70, 70 }, new[] { 77, 90 }, new[] { 82, 100 } }),
    };

    /// Exponential average: rises over ~7 s, falls over ~3 s. The first reading is capped so the burst of
    /// launching HYPERSPACE itself doesn't pick the starting speed; real heat catches up within seconds.
    static double Smooth(ref double s, int t)
    {
        if (double.IsNaN(s)) s = Math.Min(t, 70);
        else s += (t - s) * (t > s ? 0.15 : 0.3);
        return s;
    }

    public FanController(Acer acer) { _acer = acer; }

    public void Configure(string mode, int[][] cpu, int[][] gpu)
    {
        lock (_l)
        {
            if (mode is "auto" or "max" or "curve") Mode = mode;
            if (cpu != null) CpuCurve = cpu;
            if (gpu != null) GpuCurve = gpu;
            _cpuPct = _gpuPct = -1;
        }
    }

    public static int Target(int[][] c, int t)
    {
        int v;
        if (t <= c[0][0]) v = c[0][1];
        else if (t >= c[^1][0]) v = c[^1][1];
        else
        {
            v = c[^1][1];
            for (int i = 1; i < c.Length; i++)
                if (t <= c[i][0])
                {
                    double f = (t - c[i - 1][0]) / (double)Math.Max(1, c[i][0] - c[i - 1][0]);
                    v = (int)Math.Round(c[i - 1][1] + f * (c[i][1] - c[i - 1][1]));
                    break;
                }
        }
        if (t >= 88) v = Math.Max(v, Math.Min(100, 40 + (t - 88) * 10)); // safety floor on sustained heat
        return Math.Clamp(v, 0, 100);
    }

    public void Tick(int? cpuT, int? gpuT)
    {
        if (!_acer.Ok || !Program.Elevated) return;
        lock (_l)
        {
            if (cpuT != null) Smooth(ref _cpuSm, cpuT.Value);
            if (gpuT != null) Smooth(ref _gpuSm, gpuT.Value);
            var want = Override ? "max" : Mode;
            if (want == "curve" && (cpuT == null || gpuT == null))
            {
                if (++_missing > 5) want = "auto"; // can't see temps -> let the firmware drive
            }
            else _missing = 0;

            if (want != Applied)
            {
                int m = want == "auto" ? Acer.FanAuto : want == "max" ? Acer.FanMax : Acer.FanCustom;
                if (_acer.SetFanBehavior(m, m)) { Applied = want; _cpuPct = _gpuPct = -1; LastError = null; }
                else { LastError = "fan mode rejected: " + _acer.Error; return; }
            }
            if (Applied != "curve" || cpuT == null || gpuT == null) return;
            Apply(Acer.CpuFan, Target(CpuCurve, (int)Math.Round(_cpuSm)), ref _cpuPct, ref _cpuLower);
            Apply(Acer.GpuFan, Target(GpuCurve, (int)Math.Round(_gpuSm)), ref _gpuPct, ref _gpuLower);
        }
    }

    /// Next speed toward the target: up at most 6%/s; down only after it has wanted lower for 5 s, then 4%/s.
    public static int Step(int cur, int target, ref DateTime lowerSince, DateTime now)
    {
        if (cur < 0) return target;
        if (target > cur) { lowerSince = default; return Math.Min(target, cur + 6); }
        if (target > cur - 3) { lowerSince = default; return cur; }
        if (lowerSince == default) { lowerSince = now; return cur; }
        return (now - lowerSince).TotalSeconds < 5 ? cur : Math.Max(target, cur - 4);
    }

    void Apply(int fan, int target, ref int cur, ref DateTime lowerSince)
    {
        int next = Step(cur, target, ref lowerSince, DateTime.UtcNow);
        if (next == cur) return;
        if (_acer.SetFanSpeed(fan, next)) cur = next;
        else LastError = "fan speed rejected";
    }

    public object State() => new
    {
        mode = Mode, applied = Applied, overridden = Override, cpuPct = _cpuPct, gpuPct = _gpuPct, error = LastError,
        cpuCurve = CpuCurve, gpuCurve = GpuCurve,
        cpuSmooth = double.IsNaN(_cpuSm) ? (int?)null : (int)Math.Round(_cpuSm), gpuSmooth = double.IsNaN(_gpuSm) ? (int?)null : (int)Math.Round(_gpuSm),
    };

    public void Restore()
    {
        lock (_l)
        {
            if (Applied != null && Applied != "auto") _acer.SetFanBehavior(Acer.FanAuto, Acer.FanAuto);
            Applied = "auto";
        }
    }
}

/// CPU max state, boost, Windows power mode, Acer thermal profile, GPU clock caps, presets.
public sealed class Power
{
    readonly Acer _acer;
    readonly Gpu _gpu;
    (uint cpuMax, uint boost, uint? gpu)? _saved;

    public Power(Acer acer, Gpu gpu) { _acer = acer; _gpu = gpu; }

    public static readonly Dictionary<string, Preset> Presets = new()
    {
        ["gamer"] = new("GAMER / OC", "turbo", "performance", 100, 2, 0, "curve", "aggressive",
            "Acer TURBO profile (factory GPU overclock + max power), Windows Best Performance, CPU 100% with aggressive boost, GPU clocks unlocked, aggressive fan curve"),
        ["silent"] = new("SILENT / RENDER", "quiet", "balanced", 99, 0, 1500, "curve", "quiet",
            "Acer QUIET profile, Windows Balanced, CPU capped at 99% (turbo boost off: much cooler, steady all-core for renders), GPU capped at 1500 MHz, quiet fan curve (idle speed until 65°C)"),
        ["eco"] = new("ECO / LOW POWER", "eco", "efficiency", 70, 0, 900, "auto", "quiet",
            "Acer ECO profile, Windows Best Power Efficiency, CPU capped at 70% with boost off, GPU capped at 900 MHz, fans on firmware auto"),
    };

    public record Preset(string Label, string Acer, string Overlay, uint CpuMax, uint Boost, uint GpuMax, string FanMode, string Curve, string Desc);

    static uint Read(Guid setting)
    {
        var scheme = PowerApi.ActiveScheme();
        var sub = PowerApi.SubProcessor;
        PowerApi.PowerReadACValueIndex(IntPtr.Zero, ref scheme, ref sub, ref setting, out var v);
        return v;
    }

    static bool Write(Guid setting, uint value)
    {
        var scheme = PowerApi.ActiveScheme();
        var sub = PowerApi.SubProcessor;
        var a = PowerApi.PowerWriteACValueIndex(IntPtr.Zero, ref scheme, ref sub, ref setting, value);
        var d = PowerApi.PowerWriteDCValueIndex(IntPtr.Zero, ref scheme, ref sub, ref setting, value);
        PowerApi.PowerSetActiveScheme(IntPtr.Zero, ref scheme);
        return a == 0 && d == 0;
    }

    static string Overlay()
    {
        if (PowerApi.PowerGetEffectiveOverlayScheme(out var g) != 0) return null;
        if (g == PowerApi.OverlayEfficiency) return "efficiency";
        if (g == PowerApi.OverlayPerformance) return "performance";
        if (g == Guid.Empty) return "balanced";
        return "custom";
    }

    static bool SetOverlay(string name)
    {
        var g = name switch { "efficiency" => PowerApi.OverlayEfficiency, "performance" => PowerApi.OverlayPerformance, _ => PowerApi.OverlayBalanced };
        return PowerApi.PowerSetActiveOverlayScheme(g) == 0;
    }

    public object Get() => new
    {
        overlay = Overlay(),
        cpuMax = Read(PowerApi.ProcThrottleMax),
        boost = Read(PowerApi.PerfBoostMode),
        acerProfile = _acer.Ok ? _acer.Profile() : null,
        gpuMax = _gpu.LockMax, gpuRange = new[] { 300u, _gpu.MaxClock },
        memMax = _gpu.MemLockMax, memRange = new[] { 405u, _gpu.MaxMemClock },
    };

    public string Set(string key, JsonObject a)
    {
        switch (key)
        {
            case "overlay": return SetOverlay(A.S(a, "value")) ? "ok" : "Windows refused the power mode (only works on a Balanced-based plan)";
            case "cpuMax":
                {
                    var v = (uint)Math.Clamp(A.I(a, "value", 100), 5, 100);
                    bool ok = Write(PowerApi.ProcThrottleMax, v);
                    Write(PowerApi.ProcThrottleMax1, v);
                    return ok ? "ok" : "power plan write failed";
                }
            case "boost": return Write(PowerApi.PerfBoostMode, (uint)Math.Clamp(A.I(a, "value", 2), 0, 6)) ? "ok" : "power plan write failed";
            case "acerProfile":
                if (!_acer.Ok) return "Acer interface unavailable (" + _acer.Error + ")";
                return _acer.SetProfile(A.S(a, "value")) ? "ok" : "this profile isn't supported by the firmware";
            case "gpuMax": return _gpu.LockClocks((uint)Math.Max(0, A.I(a, "value")));
            case "memMax": return _gpu.LockMemClocks((uint)Math.Max(0, A.I(a, "value")));
        }
        return "unknown setting " + key;
    }

    public List<object> ApplyPreset(Preset p)
    {
        var steps = new List<object>();
        void Step(string name, string r) => steps.Add(new { step = name, ok = r == "ok", msg = r });
        Step("Acer profile → " + p.Acer, Set("acerProfile", new JsonObject { ["value"] = p.Acer }));
        Step("Windows power mode → " + p.Overlay, Set("overlay", new JsonObject { ["value"] = p.Overlay }));
        Step($"CPU max state → {p.CpuMax}%", Set("cpuMax", new JsonObject { ["value"] = p.CpuMax }));
        Step("CPU boost → " + p.Boost, Set("boost", new JsonObject { ["value"] = p.Boost }));
        Step(p.GpuMax == 0 ? "GPU clocks → unlocked" : $"GPU clock cap → {p.GpuMax} MHz", Set("gpuMax", new JsonObject { ["value"] = p.GpuMax }));
        return steps;
    }

    /// Overheat throttle: remember current limits, clamp them, restore later.
    public void Throttle()
    {
        if (_saved != null) return;
        _saved = (Read(PowerApi.ProcThrottleMax), Read(PowerApi.PerfBoostMode), _gpu.LockMax);
        Write(PowerApi.ProcThrottleMax, 80); Write(PowerApi.ProcThrottleMax1, 80);
        Write(PowerApi.PerfBoostMode, 0);
        _gpu.LockClocks(1200);
    }

    public void Unthrottle()
    {
        if (_saved is not { } s) return;
        Write(PowerApi.ProcThrottleMax, s.cpuMax); Write(PowerApi.ProcThrottleMax1, s.cpuMax);
        Write(PowerApi.PerfBoostMode, s.boost);
        _gpu.LockClocks(s.gpu ?? 0);
        _saved = null;
    }
}

/// Overheat emergency protocol. Defaults come from this laptop's specs:
/// i5-12500H Tjmax 100C (alarm 95), RTX 3050 Ti Laptop target 87C / slowdown 97C / shutdown 100C (alarm 87).
public sealed class Overheat
{
    public bool Enabled = true, MaxFans = true, ThrottlePower;
    public int CpuLimit = 95, GpuLimit = 87, Hysteresis = 8;
    public bool Active, Simulated;
    public string Reason;
    public int PeakCpu, PeakGpu;
    DateTime _coolSince, _since;
    readonly FanController _fans;
    readonly Power _power;

    public Overheat(FanController fans, Power power) { _fans = fans; _power = power; }

    int _hotFor;
    public void Tick(int? cpuT, int? gpuT)
    {
        if (Simulated) return;
        bool cpuHot = cpuT >= CpuLimit, gpuHot = gpuT >= GpuLimit;
        if (!Active)
        {
            // one hot second (launching an app does that to a laptop CPU) isn't an emergency: 5 s in a row is
            _hotFor = cpuHot || gpuHot ? _hotFor + 1 : 0;
            if (Enabled && _hotFor >= 5)
            {
                Active = true; _since = DateTime.UtcNow; _coolSince = default;
                PeakCpu = cpuT ?? 0; PeakGpu = gpuT ?? 0;
                Reason = cpuHot && gpuHot ? $"CPU {cpuT}°C + GPU {gpuT}°C" : cpuHot ? $"CPU {cpuT}°C ≥ {CpuLimit}°C" : $"GPU {gpuT}°C ≥ {GpuLimit}°C";
                if (MaxFans) _fans.Override = true;
                if (ThrottlePower) _power.Throttle();
                Log.W("OVERHEAT " + Reason);
                Program.Event("alarm", State());
            }
            return;
        }
        PeakCpu = Math.Max(PeakCpu, cpuT ?? 0); PeakGpu = Math.Max(PeakGpu, gpuT ?? 0);
        bool cool = (cpuT ?? 0) < CpuLimit - Hysteresis && (gpuT ?? 0) < GpuLimit - Hysteresis;
        if (!Enabled) { Clear(); return; }
        if (!cool) { _coolSince = default; return; }
        if (_coolSince == default) _coolSince = DateTime.UtcNow;
        else if ((DateTime.UtcNow - _coolSince).TotalSeconds > 20) Clear();
    }

    public void Simulate(bool on)
    {
        Simulated = on; Active = on; Reason = on ? "SIMULATION (no hardware changes)" : null;
        Program.Event("alarm", State());
    }

    void Clear()
    {
        Active = false; Simulated = false; _hotFor = 0;
        _fans.Override = false;
        _power.Unthrottle();
        Log.W("overheat cleared");
        Program.Event("alarm", State());
    }

    public object State() => new
    {
        enabled = Enabled, active = Active, simulated = Simulated, reason = Reason, cpuLimit = CpuLimit, gpuLimit = GpuLimit,
        maxFans = MaxFans, throttle = ThrottlePower, peakCpu = PeakCpu, peakGpu = PeakGpu,
        since = Active ? (long?)new DateTimeOffset(_since).ToUnixTimeMilliseconds() : null,
    };
}
