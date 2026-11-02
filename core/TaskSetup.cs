using System.Diagnostics;
using System.Net;
using System.Runtime.InteropServices;
using System.Security.Cryptography;

namespace HyperCore;

/// "Silent admin": a scheduled task that starts the core with admin rights at launch, without a UAC prompt.
/// Two things keep that from becoming a way in for other programs running as you:
///  1. the task runs a copy of the core in Program Files\HYPERSPACE Core, where only admins can write
///     (the installed app folder is yours to write, so anything could swap the exe there);
///  2. before talking to anyone, a task-started core checks that the program it connects to really is the
///     HYPERSPACE.exe recorded when the task was made (the connection file it reads is writable by anything).
public static class TaskSetup
{
    const string TaskName = "HYPERSPACE Core";
    static string DataDir => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "HYPERSPACE");
    public static string SafeDir => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "HYPERSPACE Core");

    public static object Install(string conn, string app)
    {
        if (!Program.Elevated) throw new Exception("needs admin");
        conn = Path.GetFullPath(conn ?? "");
        if (!conn.StartsWith(DataDir + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new Exception("connection file must live in the app's data folder");
        app = Path.GetFullPath(app ?? "");
        if (!app.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) || !File.Exists(app)) throw new Exception("HYPERSPACE.exe not found");
        Directory.CreateDirectory(SafeDir);
        var exe = Path.Combine(SafeDir, "HyperCore.exe");
        if (!string.Equals(Environment.ProcessPath, exe, StringComparison.OrdinalIgnoreCase)) File.Copy(Environment.ProcessPath!, exe, true);
        string Q(string s) => "'" + s.Replace("'", "''") + "'";
        var script =
            $"$a = New-ScheduledTaskAction -Execute {Q(exe)} -Argument {Q($"--conn-file \"{conn}\" --app \"{app}\"")}; " +
            $"$p = New-ScheduledTaskPrincipal -UserId {Q(Environment.UserDomainName + "\\" + Environment.UserName)} -LogonType Interactive -RunLevel Highest; " +
            "$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit 0 -MultipleInstances IgnoreNew; " +
            $"Register-ScheduledTask -TaskName '{TaskName}' -Description 'Starts the HYPERSPACE hardware core with admin rights, without a UAC prompt.' -Action $a -Principal $p -Settings $s -Force | Out-Null";
        return Ps(script);
    }

    public static object Remove()
    {
        if (!Program.Elevated) throw new Exception("needs admin");
        var r = Ps($"Unregister-ScheduledTask -TaskName '{TaskName}' -Confirm:$false -ErrorAction SilentlyContinue");
        try { Directory.Delete(SafeDir, true); } catch { }
        return r;
    }

    // command-line entry points for the UAC route (the app runs: HyperCore.exe --task-install --conn X --app Y)
    public static int Cli(string[] args)
    {
        string Arg(string k) { var i = Array.IndexOf(args, k); return i >= 0 && i + 1 < args.Length ? args[i + 1] : null; }
        Program.CheckElevated();
        try
        {
            if (args.Contains("--task-remove")) Remove(); else Install(Arg("--conn"), Arg("--app"));
            return 0;
        }
        catch (Exception e) { Log.W("task setup: " + e.Message); return 1; }
    }

    static object Ps(string script)
    {
        var psi = new ProcessStartInfo("powershell.exe") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardError = true, RedirectStandardOutput = true };
        foreach (var x in new[] { "-NoProfile", "-NonInteractive", "-Command", script }) psi.ArgumentList.Add(x);
        using var p = Process.Start(psi)!;
        var err = p.StandardError.ReadToEnd();
        p.WaitForExit(30000);
        if (p.ExitCode != 0) throw new Exception(string.IsNullOrWhiteSpace(err) ? "powershell failed" : err.Trim().Split('\n')[0]);
        return true;
    }

    // ---------------- who is listening on that port? ----------------
    [StructLayout(LayoutKind.Sequential)]
    struct Row { public uint state, localAddr, localPort, remoteAddr, remotePort, pid; }
    [DllImport("iphlpapi.dll", SetLastError = true)]
    static extern uint GetExtendedTcpTable(IntPtr table, ref int size, bool sort, int af, int tableClass, uint reserved);

    public static int ListenerPid(int port)
    {
        int size = 0;
        GetExtendedTcpTable(IntPtr.Zero, ref size, false, 2 /* AF_INET */, 3 /* OWNER_PID_LISTENER */, 0);
        var buf = Marshal.AllocHGlobal(size);
        try
        {
            if (GetExtendedTcpTable(buf, ref size, false, 2, 3, 0) != 0) return -1;
            int n = Marshal.ReadInt32(buf), rs = Marshal.SizeOf<Row>();
            for (int i = 0; i < n; i++)
            {
                var r = Marshal.PtrToStructure<Row>(buf + 4 + i * rs);
                if ((ushort)IPAddress.NetworkToHostOrder((short)(r.localPort & 0xFFFF)) == port) return (int)r.pid;
            }
            return -1;
        }
        finally { Marshal.FreeHGlobal(buf); }
    }

    /// true when the program listening on `port` is `app` (or, for a task made before this check existed,
    /// the HYPERSPACE.exe that sits next to this core's resources folder)
    public static bool PeerIsApp(int port, string app)
    {
        try
        {
            var pid = ListenerPid(port);
            if (pid <= 0) { Log.W($"peer check: nobody listening on {port}"); return false; }
            using var p = Process.GetProcessById(pid);
            var img = Path.GetFullPath(p.MainModule?.FileName ?? "");
            var want = Path.GetFullPath(app ?? Path.Combine(Path.GetDirectoryName(Environment.ProcessPath)!, "..", "HYPERSPACE.exe"));
            var ok = string.Equals(img, want, StringComparison.OrdinalIgnoreCase);
            if (!ok) Log.W($"peer check: {img} is not {want}: refusing");
            return ok;
        }
        catch (Exception e) { Log.W("peer check: " + e.Message); return false; }
    }

    public static string SelfHash()
    {
        try { using var f = File.OpenRead(Environment.ProcessPath!); return Convert.ToHexString(SHA256.HashData(f)); }
        catch { return null; }
    }
}
