using System.Diagnostics;
using System.Management;
using System.Runtime.InteropServices;

namespace HyperCore;

/// Task Manager's process controls for NEXUS: end the whole tree, suspend / resume, priority, efficiency
/// mode (EcoQoS + idle priority, like Task Manager's leaf) and a details card.
static class ProcCtl
{
    [DllImport("ntdll.dll")] static extern int NtSuspendProcess(IntPtr h);
    [DllImport("ntdll.dll")] static extern int NtResumeProcess(IntPtr h);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetProcessInformation(IntPtr h, int cls, ref PowerThrottling info, int size);
    [StructLayout(LayoutKind.Sequential)] struct PowerThrottling { public uint Version, ControlMask, StateMask; }
    const uint PROCESS_SUSPEND_RESUME = 0x0800, PROCESS_SET_INFORMATION = 0x0200;
    static readonly HashSet<string> Critical = new(StringComparer.OrdinalIgnoreCase)
    { "System", "Idle", "csrss", "wininit", "winlogon", "smss", "services", "lsass", "Registry", "Memory Compression", "dwm", "fontdrvhost" };

    static void Guard(int pid)
    {
        if (pid <= 4 || pid == Environment.ProcessId) throw new Exception("that one keeps Windows (or HYPERSPACE) alive");
        using var p = Process.GetProcessById(pid);
        if (Critical.Contains(p.ProcessName)) throw new Exception($"{p.ProcessName} is a core Windows process");
    }

    public static object KillTree(int pid)
    {
        Guard(pid);
        // children first (WMI knows each process's parent), then the root
        var kids = new List<int>();
        void Walk(int parent, int depth)
        {
            if (depth > 12) return;
            using var s = new ManagementObjectSearcher($"SELECT ProcessId FROM Win32_Process WHERE ParentProcessId = {parent}");
            foreach (ManagementObject o in s.Get()) { var c = Convert.ToInt32(o["ProcessId"]); if (c != pid && !kids.Contains(c)) { kids.Add(c); Walk(c, depth + 1); } }
        }
        Walk(pid, 0);
        int killed = 0;
        foreach (var c in Enumerable.Reverse(kids)) { try { using var p = Process.GetProcessById(c); if (!Critical.Contains(p.ProcessName)) { p.Kill(); killed++; } } catch { } }
        using (var root = Process.GetProcessById(pid)) { root.Kill(); killed++; }
        return new { killed };
    }

    public static object Suspend(int pid, bool on)
    {
        Guard(pid);
        var h = MemApi.OpenProcess(PROCESS_SUSPEND_RESUME, false, pid);
        if (h == IntPtr.Zero) throw new Exception("access denied");
        try
        {
            int st = on ? NtSuspendProcess(h) : NtResumeProcess(h);
            if (st != 0) throw new Exception($"status 0x{st:X8}");
            return new { suspended = on };
        }
        finally { MemApi.CloseHandle(h); }
    }

    public static object SetPriority(int pid, string level)
    {
        Guard(pid);
        using var p = Process.GetProcessById(pid);
        p.PriorityClass = level switch
        {
            "idle" => ProcessPriorityClass.Idle, "below" => ProcessPriorityClass.BelowNormal, "above" => ProcessPriorityClass.AboveNormal,
            "high" => ProcessPriorityClass.High, "realtime" => ProcessPriorityClass.RealTime, _ => ProcessPriorityClass.Normal,
        };
        return new { priority = p.PriorityClass.ToString() };
    }

    public static object Efficiency(int pid, bool on)
    {
        Guard(pid);
        var h = MemApi.OpenProcess(PROCESS_SET_INFORMATION, false, pid);
        if (h == IntPtr.Zero) throw new Exception("access denied");
        try
        {
            // ProcessPowerThrottling (4): execution-speed throttling on = EcoQoS
            var s = new PowerThrottling { Version = 1, ControlMask = 1, StateMask = on ? 1u : 0u };
            if (!SetProcessInformation(h, 4, ref s, Marshal.SizeOf<PowerThrottling>())) throw new Exception($"refused ({Marshal.GetLastWin32Error()})");
        }
        finally { MemApi.CloseHandle(h); }
        using (var p = Process.GetProcessById(pid)) p.PriorityClass = on ? ProcessPriorityClass.Idle : ProcessPriorityClass.Normal;
        return new { efficiency = on };
    }

    public static object Info(int pid)
    {
        using var p = Process.GetProcessById(pid);
        string cmd = null, parent = null;
        try
        {
            using var s = new ManagementObjectSearcher($"SELECT CommandLine, ParentProcessId FROM Win32_Process WHERE ProcessId = {pid}");
            foreach (ManagementObject o in s.Get())
            {
                cmd = o["CommandLine"] as string;
                try { using var pp = Process.GetProcessById(Convert.ToInt32(o["ParentProcessId"])); parent = $"{pp.ProcessName} ({pp.Id})"; } catch { }
            }
        }
        catch { }
        string path = null, prio = null, desc = null, company = null; DateTime? start = null; int threads = 0, handles = 0; bool suspended = false;
        try { path = p.MainModule?.FileName; desc = p.MainModule?.FileVersionInfo.FileDescription; company = p.MainModule?.FileVersionInfo.CompanyName; } catch { }
        try { prio = p.PriorityClass.ToString(); } catch { }
        try { start = p.StartTime; } catch { }
        try { threads = p.Threads.Count; handles = p.HandleCount; suspended = p.Threads.Cast<ProcessThread>().All(t => t.ThreadState == System.Diagnostics.ThreadState.Wait && t.WaitReason == ThreadWaitReason.Suspended); } catch { }
        return new { pid, name = p.ProcessName, path, cmd, parent, priority = prio, start, threads, handles, description = desc, company, suspended };
    }
}
