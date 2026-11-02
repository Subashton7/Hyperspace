using System.Diagnostics;

namespace HyperCore;

/// One-click VPN: turns a WireGuard tunnel on and off through WireGuard for Windows' own tunnel service.
/// The app keeps the config (from the user's Proton account) as <name>.conf; "up" installs it as a Windows
/// service (that's how WireGuard runs a tunnel), "down" removes the service again. Both need admin, which is
/// why they live here in the elevated core instead of asking Windows every time.
public static class WgTunnel
{
    static readonly string Exe = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "WireGuard", "wireguard.exe");

    public static object Run(string action, string conf, string name)
    {
        if (!File.Exists(Exe)) return new { ok = false, installed = false, error = "WireGuard isn't installed" };
        if (string.IsNullOrWhiteSpace(name) || name.Length > 32 || name.Any(c => !(char.IsLetterOrDigit(c) || "_=+.-".Contains(c))))
            return new { ok = false, installed = true, error = "bad tunnel name" };
        switch (action)
        {
            case "up":
                // only the app's own VPN folder (never a network share or another place), and the tunnel service gets
                // a copy in a folder only Windows and admins can open: the copy in your profile can't redirect it
                var own = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "HYPERSPACE", "vpn") + Path.DirectorySeparatorChar;
                conf = string.IsNullOrEmpty(conf) ? "" : Path.GetFullPath(conf);
                if (!conf.StartsWith(own, StringComparison.OrdinalIgnoreCase) || !File.Exists(conf) || !Path.GetFileName(conf).Equals(name + ".conf", StringComparison.OrdinalIgnoreCase))
                    return new { ok = false, installed = true, error = "the VPN config file is missing" };
                if (State(name) == "RUNNING") return new { ok = true, installed = true, state = "RUNNING" };
                if (State(name) != null) Exec($"/uninstalltunnelservice {name}"); // a stopped leftover
                var safe = SafeCopy(conf, name);
                var up = Exec($"/installtunnelservice \"{safe}\"");
                for (int i = 0; i < 20 && State(name) != "RUNNING"; i++) Thread.Sleep(250);
                return new { ok = State(name) == "RUNNING", installed = true, state = State(name), error = up.code == 0 ? null : up.output };
            case "down":
                if (State(name) == null) return new { ok = true, installed = true, state = (string)null };
                var down = Exec($"/uninstalltunnelservice {name}");
                for (int i = 0; i < 20 && State(name) != null; i++) Thread.Sleep(250);
                return new { ok = State(name) == null, installed = true, state = State(name), error = down.code == 0 ? null : down.output };
            default:
                return new { ok = true, installed = true, state = State(name) };
        }
    }

    // %ProgramFiles%\HYPERSPACE Core\vpn: SYSTEM and Administrators only (no inherited "Users can read")
    static string SafeCopy(string conf, string name)
    {
        var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "HYPERSPACE Core", "vpn");
        var di = Directory.CreateDirectory(dir);
        var sec = new System.Security.AccessControl.DirectorySecurity();
        sec.SetAccessRuleProtection(true, false);
        foreach (var sid in new[] { System.Security.Principal.WellKnownSidType.LocalSystemSid, System.Security.Principal.WellKnownSidType.BuiltinAdministratorsSid })
            sec.AddAccessRule(new System.Security.AccessControl.FileSystemAccessRule(new System.Security.Principal.SecurityIdentifier(sid, null),
                System.Security.AccessControl.FileSystemRights.FullControl, System.Security.AccessControl.InheritanceFlags.ContainerInherit | System.Security.AccessControl.InheritanceFlags.ObjectInherit,
                System.Security.AccessControl.PropagationFlags.None, System.Security.AccessControl.AccessControlType.Allow));
        di.SetAccessControl(sec);
        var dest = Path.Combine(dir, name + ".conf");
        File.Copy(conf, dest, true);
        return dest;
    }

    // the tunnel's Windows service: RUNNING, STOPPED, START_PENDING… or null when it isn't installed
    static string State(string name)
    {
        var r = Run("sc.exe", $"query \"WireGuardTunnel${name}\"");
        if (r.code != 0) return null;
        var line = r.output.Split('\n').FirstOrDefault(l => l.Contains("STATE"));
        return line?.Split(' ', StringSplitOptions.RemoveEmptyEntries).LastOrDefault()?.Trim();
    }

    static (int code, string output) Exec(string args) => Run(Exe, args);

    static (int code, string output) Run(string exe, string args)
    {
        try
        {
            var p = Process.Start(new ProcessStartInfo(exe, args) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true });
            var o = p.StandardOutput.ReadToEnd() + p.StandardError.ReadToEnd();
            p.WaitForExit(15000);
            return (p.ExitCode, o.Trim());
        }
        catch (Exception e) { return (-1, e.Message); }
    }
}
