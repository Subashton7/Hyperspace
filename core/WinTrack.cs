using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace HyperCore;

/// Other apps' windows, for the SIDE DOCK to attach to: which window is under a point (skipping the dock
/// itself), where a window is now (and whether it's minimised / in front), and finding an app's window again
/// after a restart. Rectangles are physical pixels [left, top, right, bottom], the visible frame (no shadow).
static class WinTrack
{
    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern int GetWindowLongW(IntPtr h, int i);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT v, int size);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int size);
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }

    const int GWL_EXSTYLE = -20, WS_EX_TOOLWINDOW = 0x80, WS_EX_TRANSPARENT = 0x20;

    static RECT Frame(IntPtr h)
    {
        if (DwmGetWindowAttribute(h, 9 /* EXTENDED_FRAME_BOUNDS */, out RECT r, Marshal.SizeOf<RECT>()) != 0) GetWindowRect(h, out r);
        return r;
    }
    static bool Cloaked(IntPtr h) => DwmGetWindowAttribute(h, 14 /* CLOAKED */, out int c, 4) == 0 && c != 0;
    static string Title(IntPtr h) { var sb = new StringBuilder(256); GetWindowTextW(h, sb, 256); return sb.ToString(); }
    static string Exe(IntPtr h)
    {
        GetWindowThreadProcessId(h, out uint pid);
        try { using var p = Process.GetProcessById((int)pid); return p.ProcessName; } catch { return null; }
    }
    // a real app window: visible, not cloaked (other desktops / suspended UWP), not a tool window, has a title
    static bool AppWindow(IntPtr h)
    {
        if (!IsWindowVisible(h) || IsIconic(h) || Cloaked(h)) return false;
        int ex = GetWindowLongW(h, GWL_EXSTYLE);
        if ((ex & WS_EX_TOOLWINDOW) != 0 || (ex & WS_EX_TRANSPARENT) != 0) return false;
        if (GetWindow(h, 4 /* GW_OWNER */) != IntPtr.Zero) return false;
        var r = Frame(h);
        return r.R - r.L > 200 && r.B - r.T > 150 && Title(h).Length > 0;
    }
    static object Info(IntPtr h)
    {
        var r = Frame(h);
        return new { hwnd = h.ToInt64(), title = Title(h), exe = Exe(h), rect = new[] { r.L, r.T, r.R, r.B }, fg = GetForegroundWindow() == h };
    }

    /// the top-most app window under (x, y), skipping the given windows (the dock); null over the desktop
    public static object At(int x, int y, long[] skip)
    {
        object hit = null;
        EnumWindows((h, _) =>
        {
            if (skip != null && skip.Contains(h.ToInt64())) return true;
            if (!AppWindow(h)) return true;
            var r = Frame(h);
            if (x < r.L || x >= r.R || y < r.T || y >= r.B) return true;
            var exe = Exe(h);
            if (exe is "explorer" && Title(h) is "Program Manager") return false; // the desktop itself
            hit = Info(h);
            return false;
        }, IntPtr.Zero);
        return new { ok = hit != null, win = hit };
    }

    /// where a window is now
    public static object Rect(long hwnd)
    {
        var h = new IntPtr(hwnd);
        if (!IsWindow(h)) return new { exists = false };
        var r = Frame(h);
        return new { exists = true, visible = IsWindowVisible(h) && !Cloaked(h), minimized = IsIconic(h), rect = new[] { r.L, r.T, r.R, r.B }, fg = GetForegroundWindow() == h, title = Title(h) };
    }

    /// an app's main window again (after it or HYPERSPACE restarted): by process name, title as a tie-breaker
    public static object Find(string exe, string title)
    {
        IntPtr best = IntPtr.Zero; int bestScore = -1;
        EnumWindows((h, _) =>
        {
            if (!AppWindow(h) || !string.Equals(Exe(h), exe, StringComparison.OrdinalIgnoreCase)) return true;
            int s = title != null && Title(h) == title ? 2 : 1;
            if (s > bestScore) { bestScore = s; best = h; }
            return true;
        }, IntPtr.Zero);
        return best == IntPtr.Zero ? new { ok = false, win = (object)null } : new { ok = true, win = Info(best) };
    }
}
