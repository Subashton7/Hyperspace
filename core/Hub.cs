using System.Diagnostics;
using System.Text.Json.Nodes;

namespace HyperCore;

public sealed class Hub
{
    readonly Acer _acer = new();
    readonly Gpu _gpu = new();
    Cpu _cpu;
    readonly IoSampler _io = new();
    readonly ProcSampler _procs = new();
    readonly AudioEngine _audioEngine = new();
    readonly AudioDevices _audio = new();
    readonly MediaControl _media = new();
    readonly Displays _displays = new();
    readonly Library _lib = new();
    readonly Privacy _privacy = new();
    readonly MemoryVac _vac;
    readonly FanController _fans;
    readonly Power _power;
    readonly Overheat _overheat;
    volatile bool _run = true;
    Thread _telemetry;

    public Hub()
    {
        _vac = new MemoryVac(_audio);
        _fans = new FanController(_acer);
        _power = new Power(_acer, _gpu);
        _overheat = new Overheat(_fans, _power);
        Log.W($"acer={_acer.Ok} ({_acer.Error}) gpu={_gpu.Ok} {_gpu.Name} ({_gpu.Error})");
    }

    public void Start()
    {
        _telemetry = new Thread(TelemetryLoop) { IsBackground = true, Name = "telemetry" };
        _telemetry.Start();
        new Thread(TrackForeground) { IsBackground = true, Name = "foreground" }.Start();
        _privacy.Watch();
    }

    // The last window the user worked in that isn't HYPERSPACE: app shortcuts are sent there.
    IntPtr _lastApp;
    string _lastAppName;
    static readonly HashSet<string> Ours = new(StringComparer.OrdinalIgnoreCase) { "HYPERSPACE", "electron", "HyperCore" };
    void TrackForeground()
    {
        while (_run)
        {
            try
            {
                var h = UserApi.GetForegroundWindow();
                if (h != IntPtr.Zero && h != _lastApp)
                {
                    UserApi.GetWindowThreadProcessId(h, out int pid);
                    using var p = Process.GetProcessById(pid);
                    if (!Ours.Contains(p.ProcessName) && p.ProcessName != "explorer" || (p.ProcessName == "explorer" && WindowTitle(h).Length > 0))
                    { _lastApp = h; _lastAppName = p.ProcessName; }
                }
            }
            catch { }
            Thread.Sleep(400);
        }
    }

    static object RunPowerShell(string script)
    {
        var encoded = Convert.ToBase64String(System.Text.Encoding.Unicode.GetBytes(script));
        var psi = new ProcessStartInfo("powershell.exe", $"-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand {encoded}")
        { CreateNoWindow = true, UseShellExecute = false, RedirectStandardError = true };
        using var p = Process.Start(psi);
        var err = p.StandardError.ReadToEnd();
        p.WaitForExit(30000);
        if (p.ExitCode != 0) throw new Exception(string.IsNullOrWhiteSpace(err) ? $"powershell exit {p.ExitCode}" : err.Trim().Split('\n')[0]);
        return new { ok = true };
    }

    static string WindowTitle(IntPtr h)
    {
        var sb = new System.Text.StringBuilder(256);
        UserApi.GetWindowText(h, sb, 256);
        return sb.ToString();
    }

    public void Shutdown()
    {
        _run = false;
        try { _audioEngine.Stop(); } catch { }
        try { _fans.Restore(); } catch { }
        try { _power.Unthrottle(); } catch { }
        try { if (_gpu.LockMax != null) _gpu.LockClocks(0); if (_gpu.MemLockMax != null) _gpu.LockMemClocks(0); } catch { }
    }

    void TelemetryLoop()
    {
        _cpu = new Cpu(); // LibreHardwareMonitor init can take a moment; keep it off the connect path
        int tick = 0;
        while (_run)
        {
            var started = Stopwatch.StartNew();
            try
            {
                var (clock, util, power, volt, lhmTemp) = _cpu.Read();
                int? cpuT = _acer.Ok ? _acer.Sensor(0x01) : null;
                cpuT ??= lhmTemp is { } lt ? (int)Math.Round(lt) : null;
                int? cpuRpm = _acer.Ok ? _acer.Sensor(0x02) : null;
                int? gpuRpm = _acer.Ok ? _acer.Sensor(0x06) : null;
                var g = _gpu.Read();
                int? gpuT = (int?)g?.GetType().GetProperty("temp")?.GetValue(g);
                gpuT ??= _acer.Ok ? _acer.Sensor(0x0A) : null;

                _fans.Tick(cpuT, gpuT);
                _overheat.Tick(cpuT, gpuT);

                Program.Event("telemetry", new
                {
                    t = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                    cpu = new { clock, util, power, temp = cpuT, voltage = volt, fanRpm = cpuRpm, tjmax = 100 },
                    gpu = g, gpuTemp = gpuT, gpuFanRpm = gpuRpm,
                    io = _io.Read(),
                    fans = _fans.State(),
                    alarm = _overheat.State(),
                    acerProfile = tick % 5 == 0 && _acer.Ok ? _acer.Profile() : null,
                });
                if (tick % 2 == 0) _ = _media.Poll();
            }
            catch (Exception e) { Log.W("telemetry: " + e); }
            tick++;
            var rest = 1000 - (int)started.ElapsedMilliseconds;
            if (rest > 0) Thread.Sleep(rest);
        }
    }

    object Status() => new
    {
        elevated = Program.Elevated,
        acer = new { ok = _acer.Ok, error = _acer.Error },
        gpu = new
        {
            ok = _gpu.Ok, name = _gpu.Name, error = _gpu.Error, maxClock = _gpu.MaxClock, maxMemClock = _gpu.MaxMemClock,
            tSlowdown = _gpu.TSlowdown, tShutdown = _gpu.TShutdown, tMax = _gpu.TMax, tTarget = 87,
        },
        cpu = new { lhmVoltage = _cpu?.LhmVoltage ?? false, lhmNote = _cpu?.LhmNote, tjmax = 100, model = (Microsoft.Win32.Registry.GetValue(@"HKEY_LOCAL_MACHINE\HARDWARE\DESCRIPTION\System\CentralProcessor\0", "ProcessorNameString", "") as string)?.Trim() },
        presets = Power.Presets.ToDictionary(p => p.Key, p => new { label = p.Value.Label, desc = p.Value.Desc }),
        curves = FanController.Curves.ToDictionary(c => c.Key, c => new { cpu = c.Value.cpu, gpu = c.Value.gpu }),
        fans = _fans.State(),
        overheat = _overheat.State(),
        exclude = _vac.Exclude,
    };

    public async Task<object> Dispatch(string cmd, JsonObject a)
    {
        switch (cmd)
        {
            case "status": return Status();

            // ----- power / presets / fans / overheat -----
            case "power.get": return _power.Get();
            case "power.set": return new { result = _power.Set(A.S(a, "key"), a), state = _power.Get() };
            case "preset.apply":
                {
                    if (!Power.Presets.TryGetValue(A.S(a, "name") ?? "", out var p)) throw new Exception("unknown preset");
                    var steps = _power.ApplyPreset(p);
                    var c = FanController.Curves[p.Curve];
                    _fans.Configure(p.FanMode, c.cpu, c.gpu);
                    steps.Add(new { step = "Fans → " + (p.FanMode == "auto" ? "firmware auto" : p.Curve + " curve"), ok = _acer.Ok && Program.Elevated, msg = _acer.Ok ? "ok" : _acer.Error });
                    return new { steps, fans = _fans.State(), power = _power.Get() };
                }
            case "fans.set":
                _fans.Configure(A.S(a, "mode"), A.Curve(a["cpu"]), A.Curve(a["gpu"]));
                return _fans.State();
            case "overheat.set":
                _overheat.Enabled = A.B(a, "enabled", _overheat.Enabled);
                _overheat.CpuLimit = Math.Clamp(A.I(a, "cpu", _overheat.CpuLimit), 60, 100);
                _overheat.GpuLimit = Math.Clamp(A.I(a, "gpu", _overheat.GpuLimit), 60, 97);
                _overheat.MaxFans = A.B(a, "maxFans", _overheat.MaxFans);
                _overheat.ThrottlePower = A.B(a, "throttle", _overheat.ThrottlePower);
                return _overheat.State();
            case "overheat.simulate":
                _overheat.Simulate(A.B(a, "on"));
                return _overheat.State();

            // ----- processes / vram / memory -----
            case "procs": return _procs.Sample(A.B(a, "gpu"));
            case "procs.names": return ProcSampler.Names();
            case "vram":
                {
                    var list = _procs.Sample(true)
                        .Where(p => p.vram > 16 * 1024 * 1024 || p.gpu > 1)
                        .GroupBy(p => p.name)
                        .Select(g => new { name = g.Key, vram = g.Sum(x => x.vram), gpu = Math.Round(g.Max(x => x.gpu), 1), count = g.Count() })
                        .OrderByDescending(x => x.vram).Take(14);
                    return new { list, gpu = _gpu.Read() };
                }
            case "mem.plan": return _vac.Plan(_procs.Last.Count > 0 ? _procs.Last : _procs.Sample(), A.B(a, "trim", true));
            case "mem.run": return _vac.Run(_procs.Sample(), A.B(a, "trim", true));
            case "mem.exclude":
                if (a["list"] is JsonArray ex) _vac.Exclude = ex.Select(x => (string)x).Where(x => !string.IsNullOrWhiteSpace(x)).ToArray();
                return _vac.Exclude;
            case "proc.kill":
                {
                    using var p = Process.GetProcessById(A.I(a, "pid"));
                    Guard(p);
                    p.Kill();
                    return true;
                }
            case "proc.path":
                try { using var p = Process.GetProcessById(A.I(a, "pid")); return p.MainModule?.FileName; }
                catch { return null; }
            case "proc.tree": Guard(A.I(a, "pid")); return ProcCtl.KillTree(A.I(a, "pid"));
            case "proc.suspend": Guard(A.I(a, "pid")); return ProcCtl.Suspend(A.I(a, "pid"), A.B(a, "on", true));
            case "proc.priority":
                Guard(A.I(a, "pid"));
                if (A.S(a, "level") == "realtime") throw new Exception("REALTIME can freeze Windows: use HIGH instead");
                return ProcCtl.SetPriority(A.I(a, "pid"), A.S(a, "level"));
            case "proc.efficiency": return ProcCtl.Efficiency(A.I(a, "pid"), A.B(a, "on", true));
            case "proc.info": return ProcCtl.Info(A.I(a, "pid"));

            // ----- audio / media -----
            case "audio.devices": return _audio.List();
            case "audio.default": _audio.SetDefault(A.S(a, "id")); return _audio.List();
            case "audio.volume":
                return _audio.SetVolume(a.ContainsKey("level") ? A.D(a, "level") : (double?)null, a.ContainsKey("muted") ? A.B(a, "muted") : (bool?)null);
            case "audio.getVolume": return _audio.Volume();

            // ----- mic / camera (the app ran reg.exe and PowerShell for these) -----
            case "privacy.get": return _privacy.Get(A.B(a, "freshCams"));
            case "privacy.set": return _privacy.Set(A.S(a, "kind"), A.B(a, "allow"));
            case "mic.mute": return Privacy.SetMute(A.B(a, "muted"));

            // ----- slow-changing system facts: drives, battery, network adapters -----
            case "sys.slow": return SysInfo.Slow();
            case "net.adapters": return SysInfo.Adapters();
            case "audio.capture":
                if (A.B(a, "on")) { var src = A.S(a, "source", "default"); if (!_audioEngine.Running || src != _audioEngine.Source) _audioEngine.Start(src); }
                else _audioEngine.Stop();
                return new { running = _audioEngine.Running, source = _audioEngine.Source, error = _audioEngine.Error };
            case "media.get": return await _media.Get();
            case "media.cmd": return await _media.Command(A.S(a, "action", "toggle"));

            // ----- displays -----
            case "display.list": return _displays.List();
            case "display.set": return _displays.SetMode(A.S(a, "device"), A.I(a, "w"), A.I(a, "h"), A.I(a, "hz"));
            case "display.test": return _displays.Test(A.S(a, "device"), A.I(a, "w"), A.I(a, "h"), A.I(a, "hz"));
            case "display.topology": return _displays.SetTopology(A.S(a, "mode"));
            case "display.keep": return _displays.Keep(A.I(a, "token"));
            case "display.revert": return _displays.RevertNow(A.I(a, "token"));

            // ----- shortcuts -----
            case "keys.send":
                {
                    var vks = (a["vks"] as JsonArray)?.Select(x => x.GetValue<int>()).ToArray() ?? Array.Empty<int>();
                    if (vks.Length == 0 || vks.Length > 6) throw new Exception("bad key chord");
                    string target = A.S(a, "target", "system");
                    if (target == "app")
                    {
                        if (_lastApp == IntPtr.Zero) throw new Exception("no app to send to yet: click into the app first");
                        UserApi.Focus(_lastApp);
                        await Task.Delay(120);
                    }
                    bool ok = UserApi.Chord(vks);
                    return new { ok, app = target == "app" ? _lastAppName : null };
                }
            case "keys.lastApp": return new { app = _lastAppName };
            case "desk.covered": return Wallpaper.Covered();
            case "win.at": return WinTrack.At(A.I(a, "x"), A.I(a, "y"), (a["skip"] as System.Text.Json.Nodes.JsonArray)?.Select(v => (long)(double)v).ToArray());
            case "win.rect": return WinTrack.Rect((long)A.D(a, "hwnd"));
            case "win.find": return WinTrack.Find(A.S(a, "exe"), A.S(a, "title"));
            case "vpn.wg": return await Task.Run(() => WgTunnel.Run(A.S(a, "action"), A.S(a, "conf"), A.S(a, "name")));
            case "lib.load": return await Task.Run(() => _lib.Load(A.B(a, "refresh", false)));
            case "lib.wave": return await Task.Run(() => _lib.Wave(A.S(a, "id"), A.I(a, "cols")));
            case "lib.features": return await Task.Run(() => _lib.Features(A.B(a, "refresh", false)));
            case "lib.dropFix": return await Task.Run(() => DropModel.Correct(_lib, A.S(a, "id"), A.I(a, "which", 1), A.I(a, "ms")));
            case "lock": return UserApi.LockWorkStation();

            // ----- silent admin: a scheduled task that starts this core elevated without a UAC prompt -----
            case "task.install": return TaskSetup.Install(A.S(a, "conn"), A.S(a, "app"));
            case "task.remove": return TaskSetup.Remove();

            // ----- camera hard kill (disable/enable the device) without a separate prompt -----
            case "cam.hard":
                {
                    if (!Program.Elevated) throw new Exception("needs admin");
                    bool enable = A.B(a, "enable");
                    var ids = (a["ids"] as JsonArray)?.Select(x => (string)x).ToArray() ?? Array.Empty<string>();
                    var results = new List<object>();
                    foreach (var id in ids)
                    {
                        if (string.IsNullOrWhiteSpace(id) || id.Contains('"')) continue;
                        var psi = new ProcessStartInfo("pnputil.exe", $"{(enable ? "/enable-device" : "/disable-device")} \"{id}\"")
                        { CreateNoWindow = true, UseShellExecute = false, RedirectStandardOutput = true };
                        using var p = Process.Start(psi);
                        p.WaitForExit(20000);
                        results.Add(new { id, ok = p.ExitCode == 0 });
                    }
                    return results;
                }

            // ----- diagnostics -----
            case "acer.probe":
                return new
                {
                    ok = _acer.Ok, error = _acer.Error, cpuTemp = _acer.Sensor(0x01), gpuTemp = _acer.Sensor(0x0A), cpuFan = _acer.Sensor(0x02),
                    gpuFan = _acer.Sensor(0x06), profile = _acer.Profile(), fanBehavior = _acer.GetFanBehavior()?.ToString(),
                };
        }
        throw new Exception("unknown command " + cmd);
    }
    // Windows can't run without these: ending or freezing one crashes the PC (blue screen) or logs you out
    static readonly HashSet<string> Protected = new(StringComparer.OrdinalIgnoreCase) {
        "System", "Idle", "Registry", "smss", "csrss", "wininit", "winlogon", "services", "lsass", "lsaiso", "svchost",
        "dwm", "fontdrvhost", "Memory Compression", "MsMpEng", "sihost", "HyperCore" };
    static void Guard(int pid) { using var p = Process.GetProcessById(pid); Guard(p); }
    static void Guard(Process p)
    {
        if (p.Id <= 4 || Protected.Contains(p.ProcessName) || p.Id == Environment.ProcessId)
            throw new Exception($"Windows needs {p.ProcessName} running, so HYPERSPACE won't touch it");
    }

}
