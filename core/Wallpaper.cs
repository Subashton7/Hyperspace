using System.Runtime.InteropServices;
using System.Text;

namespace HyperCore;

/// Live wallpaper: `HyperCore --wallpaper attach <hwnd> <x> <y> <w> <h>` re-parents a HYPERSPACE window into
/// the desktop's WorkerW, the layer Windows paints the wallpaper on, so it sits under the desktop icons and
/// every app. Coordinates are physical screen pixels. `--wallpaper refresh` repaints the stock wallpaper.
static class Wallpaper
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string title);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
    [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
    [DllImport("user32.dll")] static extern IntPtr SetParent(IntPtr child, IntPtr parent);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] static extern IntPtr SetWindowLongPtr(IntPtr h, int i, IntPtr v);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint flags);
    [DllImport("user32.dll")] static extern bool ScreenToClient(IntPtr h, ref POINT p);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool RedrawWindow(IntPtr h, IntPtr rect, IntPtr rgn, uint flags);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int x, y; }

    const int GWL_STYLE = -16, GWL_EXSTYLE = -20;
    const long WS_CHILD = 0x40000000, WS_POPUP = 0x80000000, WS_CAPTION = 0xC00000, WS_THICKFRAME = 0x40000,
        WS_SYSMENU = 0x80000, WS_MINIMIZEBOX = 0x20000, WS_MAXIMIZEBOX = 0x10000;
    const long WS_EX_TOOLWINDOW = 0x80, WS_EX_NOACTIVATE = 0x8000000, WS_EX_APPWINDOW = 0x40000;
    static readonly IntPtr PerMonitorV2 = new(-4);

    public static int Run(string[] args)
    {
        SetThreadDpiAwarenessContext(PerMonitorV2); // physical pixels everywhere
        int i = Array.IndexOf(args, "--wallpaper");
        var verb = i + 1 < args.Length ? args[i + 1] : "";
        try
        {
            if (verb == "refresh") { Refresh(); Console.WriteLine("OK"); return 0; }
            if (verb != "attach" || args.Length < i + 7) { Console.WriteLine("ERROR usage: --wallpaper attach <hwnd> <x> <y> <w> <h>"); return 2; }
            var hwnd = new IntPtr(long.Parse(args[i + 2]));
            int x = int.Parse(args[i + 3]), y = int.Parse(args[i + 4]), w = int.Parse(args[i + 5]), h = int.Parse(args[i + 6]);
            if (!IsWindow(hwnd)) { Console.WriteLine("ERROR window not found"); return 1; }
            var worker = FindLayer(out var mode);
            if (worker == IntPtr.Zero) { Console.WriteLine("ERROR the desktop wallpaper layer was not found"); return 1; }

            var style = (long)GetWindowLongPtr(hwnd, GWL_STYLE);
            style = (style & ~(WS_POPUP | WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX)) | WS_CHILD;
            SetWindowLongPtr(hwnd, GWL_STYLE, new IntPtr(style));
            var ex = (long)GetWindowLongPtr(hwnd, GWL_EXSTYLE);
            SetWindowLongPtr(hwnd, GWL_EXSTYLE, new IntPtr((ex & ~WS_EX_APPWINDOW) | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE));
            SetParent(hwnd, worker);
            var p = new POINT { x = x, y = y };
            ScreenToClient(worker, ref p);
            // SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED | SWP_NOZORDER
            SetWindowPos(hwnd, IntPtr.Zero, p.x, p.y, w, h, 0x0010 | 0x0040 | 0x0020 | 0x0004);
            Console.WriteLine($"OK {mode} 0x{worker.ToInt64():X} at {p.x},{p.y}");
            return 0;
        }
        catch (Exception e) { Console.WriteLine("ERROR " + e.Message); return 1; }
    }

    /// The window the wallpaper is painted into. Windows 11 24H2+ keeps it as a WorkerW child of Progman,
    /// under SHELLDLL_DefView (the icons); older builds keep it as the top-level WorkerW after the one holding
    /// the icons. Message 0x052C asks Progman to create it if it doesn't exist yet.
    static IntPtr FindLayer(out string mode)
    {
        var progman = FindWindow("Progman", null);
        mode = "none";
        if (progman == IntPtr.Zero) return IntPtr.Zero;
        SendMessageTimeout(progman, 0x052C, new IntPtr(0xD), new IntPtr(1), 0, 1000, out _);
        SendMessageTimeout(progman, 0x052C, IntPtr.Zero, IntPtr.Zero, 0, 1000, out _);
        var child = FindWindowEx(progman, IntPtr.Zero, "WorkerW", null);
        if (child != IntPtr.Zero) { mode = "progman-child"; return child; }
        IntPtr worker = IntPtr.Zero;
        EnumWindows((top, _) =>
        {
            if (FindWindowEx(top, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero)
                worker = FindWindowEx(IntPtr.Zero, top, "WorkerW", null);
            return true;
        }, IntPtr.Zero);
        mode = "workerw";
        return worker;
    }

    public static void Refresh()
    {
        var progman = FindWindow("Progman", null);
        // RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN | RDW_UPDATENOW
        if (progman != IntPtr.Zero) RedrawWindow(progman, IntPtr.Zero, IntPtr.Zero, 0x1 | 0x4 | 0x80 | 0x100);
        var w = FindLayer(out _);
        if (w != IntPtr.Zero) RedrawWindow(w, IntPtr.Zero, IntPtr.Zero, 0x1 | 0x4 | 0x80 | 0x100);
    }

    // ---------------- "is a game / video covering this monitor?" (for pausing the wallpaper) ----------------
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr mon, ref MONITORINFO mi);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int l, t, r, b; }
    [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int cbSize; public RECT rcMonitor, rcWork; public uint dwFlags; }
    static readonly HashSet<string> ShellClasses = new() { "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd" };

    /// The monitor (physical rect) the foreground window fills, or null. Maximized counts: the wallpaper
    /// is hidden behind it either way.
    public static object Covered()
    {
        var old = SetThreadDpiAwarenessContext(PerMonitorV2);
        try
        {
            var h = GetForegroundWindow();
            if (h == IntPtr.Zero) return new { covered = (object)null };
            var sb = new StringBuilder(64);
            GetClassName(h, sb, 64);
            if (ShellClasses.Contains(sb.ToString())) return new { covered = (object)null };
            GetWindowRect(h, out var r);
            var mi = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() };
            GetMonitorInfo(MonitorFromWindow(h, 2), ref mi);
            var m = mi.rcMonitor;
            bool full = r.l <= m.l && r.t <= m.t && r.r >= m.r && r.b >= m.b;
            if (!full && !IsZoomed(h)) return new { covered = (object)null };
            return new { covered = (object)new[] { m.l, m.t, m.r - m.l, m.b - m.t }, fullscreen = full };
        }
        finally { SetThreadDpiAwarenessContext(old); }
    }
}
