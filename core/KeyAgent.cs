using System.Diagnostics;
using System.Management;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace HyperCore;

/// `HyperCore --keyagent`: a small, NON-elevated background process started at logon. Acer's NitroSense
/// service answers the NitroSense key (above the numpad) by raising an AcerGenericEvent and opening the
/// NitroSense app. The agent watches for that window; when it appears right after the key (or at all, until
/// the key has been seen to raise an event), it closes NitroSense and opens / focuses HYPERSPACE instead.
/// Opening NitroSense from the Start menu still works once the key's event has been seen.
static class KeyAgent
{
    const string MutexName = @"Local\HYPERSPACE_KeyAgent", StopName = @"Local\HYPERSPACE_KeyAgent_Stop";
    static string _app, _appArgs, _mode = "key", _statusFile, _logFile;
    static long _lastAcerEvent, _lastTrigger;
    static int _acerEvents, _triggers;
    static string _lastDetail;
    static readonly int Self = Environment.ProcessId;

    public static int Stop()
    {
        try { using var e = EventWaitHandle.OpenExisting(StopName); e.Set(); return 0; } catch { return 1; }
    }

    public static int Run(string[] args)
    {
        string Arg(string k) { int i = Array.IndexOf(args, k); return i >= 0 && i + 1 < args.Length ? args[i + 1] : null; }
        _app = Arg("--app");
        _appArgs = Arg("--app-args");
        _mode = Arg("--mode") ?? "key";
        var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "HYPERSPACE");
        Directory.CreateDirectory(dir);
        _statusFile = Path.Combine(dir, "keyagent.json");
        _logFile = Path.Combine(dir, "keyagent.log");

        using var mutex = new Mutex(true, MutexName, out bool first);
        if (!first) return 3; // already running
        using var stop = new EventWaitHandle(false, EventResetMode.AutoReset, StopName);
        W($"start mode={_mode} app={_app}");

        ManagementEventWatcher watcher = null;
        try
        {
            watcher = new ManagementEventWatcher(new ManagementScope(@"root\WMI"), new WqlEventQuery("SELECT * FROM AcerGenericEvent"));
            watcher.EventArrived += (_, e) =>
            {
                _lastAcerEvent = Environment.TickCount64;
                _acerEvents++;
                try { _lastDetail = e.NewEvent["EventDetail"] is byte[] b ? Convert.ToHexString(b, 0, Math.Min(b.Length, 16)) : null; } catch { }
                W($"acer event {_lastDetail}");
                Status();
            };
            watcher.Start();
        }
        catch (Exception ex) { W("wmi: " + ex.Message); }

        var ui = new Thread(HookLoop) { IsBackground = true, Name = "winevents" };
        ui.SetApartmentState(ApartmentState.STA);
        ui.Start();
        Status();
        stop.WaitOne();
        W("stop");
        try { watcher?.Stop(); } catch { }
        try { File.Delete(_statusFile); } catch { }
        return 0;
    }

    static void Status()
    {
        try
        {
            File.WriteAllText(_statusFile, JsonSerializer.Serialize(new
            {
                pid = Self, mode = _mode, started = Process.GetCurrentProcess().StartTime.ToUniversalTime(),
                acerEvents = _acerEvents, lastDetail = _lastDetail, triggers = _triggers,
            }));
        }
        catch { }
    }

    static void W(string s)
    {
        try
        {
            var fi = new FileInfo(_logFile);
            if (fi.Exists && fi.Length > 256 * 1024) fi.Delete();
            File.AppendAllText(_logFile, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} {s}\n");
        }
        catch { }
    }

    // ---------------- window events ----------------
    const uint EVENT_SYSTEM_FOREGROUND = 0x0003, EVENT_OBJECT_SHOW = 0x8002, WINEVENT_OUTOFCONTEXT = 0;
    delegate void WinEventProc(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time);
    [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr mod, WinEventProc proc, uint pid, uint tid, uint flags);
    [DllImport("user32.dll")] static extern int GetMessage(out MSG msg, IntPtr hwnd, uint min, uint max);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG msg);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG msg);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n);
    delegate bool EnumProc(IntPtr hwnd, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc, IntPtr l);
    [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr w, l; public uint time; public int x, y; }
    static WinEventProc _proc; // kept alive: the hook calls back into it

    static void HookLoop()
    {
        _proc = OnWinEvent;
        SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, IntPtr.Zero, _proc, 0, 0, WINEVENT_OUTOFCONTEXT);
        SetWinEventHook(EVENT_OBJECT_SHOW, EVENT_OBJECT_SHOW, IntPtr.Zero, _proc, 0, 0, WINEVENT_OUTOFCONTEXT);
        while (GetMessage(out var m, IntPtr.Zero, 0, 0) > 0) { TranslateMessage(ref m); DispatchMessage(ref m); }
    }

    // Opening NitroSense yourself means the Start menu, Windows search or the taskbar was in front a moment before
    // it appeared. The NitroSense key opens it while you're still in whatever you were using, the desktop and File
    // Explorer included (those are explorer.exe too, so explorer only counts when it's the taskbar).
    // (This laptop's key never raises Acer's key event, so that alone can't tell the two apart.)
    static readonly string[] Shell = { "StartMenuExperienceHost", "SearchHost", "SearchApp", "SearchUI", "ShellExperienceHost", "ShellHost" };
    static readonly string[] Taskbar = { "Shell_TrayWnd", "Shell_SecondaryTrayWnd" };
    static long _lastShell, _swallowUntil;

    static bool IsShell(IntPtr hwnd)
    {
        var name = ProcName(hwnd);
        if (name == null) return false;
        if (Shell.Any((x) => x.Equals(name, StringComparison.OrdinalIgnoreCase))) return true;
        if (!name.Equals("explorer", StringComparison.OrdinalIgnoreCase)) return false;
        var sb = new System.Text.StringBuilder(64);
        GetClassName(GetAncestor(hwnd, 2 /* GA_ROOT */), sb, 64);
        return Taskbar.Contains(sb.ToString());
    }

    static void OnWinEvent(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time)
    {
        if (hwnd == IntPtr.Zero || idObject != 0 || idChild != 0) return;
        if (ev == EVENT_SYSTEM_FOREGROUND && IsShell(hwnd)) _lastShell = Environment.TickCount64;
        if (GetAncestor(hwnd, 2 /* GA_ROOT */) != hwnd || !IsWindowVisible(hwnd)) return;
        if (!IsNitroSense(hwnd)) return;
        var now = Environment.TickCount64;
        // NitroSense shows a logo window first and its main window a moment later: after a key press, every
        // NitroSense window in the next few seconds goes too (without opening HYPERSPACE twice)
        if (now < _swallowUntil) { Shut(hwnd); return; }
        bool keyJustPressed = now - _lastAcerEvent < 4000;
        bool openedByYou = now - _lastShell < 8000;
        if (openedByYou && !keyJustPressed) { W("nitrosense opened from the Start menu / search / taskbar: left open"); return; }
        // until the key has been seen raising an event, any other NitroSense window counts as the key
        bool redirect = _mode == "always" || keyJustPressed || _acerEvents == 0;
        if (!redirect || now - _lastTrigger < 1500) return;
        _lastTrigger = now;
        _triggers++;
        W($"nitrosense window (key {(keyJustPressed ? "event" : "no event")}) -> HYPERSPACE");
        _swallowUntil = now + 8000;
        Shut(hwnd);
        ThreadPool.QueueUserWorkItem(_ => OpenHyperspace());
        Status();
    }

    // ends NitroSense outright (closing only the logo window lets the main window open anyway)
    static void Shut(IntPtr hwnd)
    {
        try { UserApi.GetWindowThreadProcessId(hwnd, out int pid); using var p = Process.GetProcessById(pid); p.Kill(); }
        catch { PostMessage(hwnd, 0x0010 /* WM_CLOSE */, IntPtr.Zero, IntPtr.Zero); }
    }

    static string ProcName(IntPtr hwnd)
    {
        try { UserApi.GetWindowThreadProcessId(hwnd, out int pid); using var p = Process.GetProcessById(pid); return p.ProcessName; }
        catch { return null; }
    }

    static bool IsNitroSense(IntPtr hwnd)
    {
        try
        {
            UserApi.GetWindowThreadProcessId(hwnd, out int pid);
            if (pid == Self) return false;
            using var p = Process.GetProcessById(pid);
            return p.ProcessName.Equals("NitroSense", StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    static void OpenHyperspace()
    {
        Thread.Sleep(150);
        // a synthetic Alt tap gives this background agent the right to hand over the foreground, and it passes
        // that on to HYPERSPACE: the window comes up over whatever you were looking at
        UserApi.Key(0x12);
        UserApi.AllowSetForegroundWindow(-1 /* ASFW_ANY */);
        var win = FindHyperspace();
        if (win != IntPtr.Zero)
        {
            if (UserApi.IsIconic(win)) UserApi.ShowWindow(win, 9 /* SW_RESTORE */);
            UserApi.SetForegroundWindow(win);
        }
        if (string.IsNullOrEmpty(_app)) { W("no app path"); return; }
        // launching again reaches the running app as a "second instance": it raises itself and replays the intro
        try { Process.Start(new ProcessStartInfo(_app, _appArgs ?? "") { UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(_app) }); }
        catch (Exception e) { W("launch: " + e.Message); }
    }

    static IntPtr FindHyperspace()
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows((h, _) =>
        {
            if (!IsWindowVisible(h) && !UserApi.IsIconic(h)) return true;
            var sb = new StringBuilder(64);
            UserApi.GetWindowText(h, sb, 64);
            if (sb.ToString() != "HYPERSPACE") return true;
            UserApi.GetWindowThreadProcessId(h, out int pid);
            try
            {
                using var p = Process.GetProcessById(pid);
                if (p.ProcessName is "HYPERSPACE" or "electron") { found = h; return false; }
            }
            catch { }
            return true;
        }, IntPtr.Zero);
        return found;
    }
}
