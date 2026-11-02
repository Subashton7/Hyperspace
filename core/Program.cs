using System.Net.Sockets;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace HyperCore;

public static class Program
{
    static StreamWriter _out;
    static readonly object WriteLock = new();
    static readonly JsonSerializerOptions Json = new()
    {
        NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.AllowNamedFloatingPointLiterals,
    };

    public static bool Elevated { get; private set; }
    public static void CheckElevated() => Elevated = new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);

    // `--dpapi protect|unprotect <file>`: base64 on stdin / stdout, sealed to this Windows account with DPAPI.
    // NOTES keeps its laptop copy of the notes key this way too: Electron's own safeStorage key changed in the
    // Electron 44 upgrade and could no longer open the copy it had made, which made NOTES ask for the password again.
    static int Dpapi(string[] args)
    {
        var entropy = System.Text.Encoding.UTF8.GetBytes("HYPERSPACE notes key");
        int i = Array.IndexOf(args, "--dpapi");
        if (i + 2 >= args.Length) return 2;
        var file = args[i + 2];
        try
        {
            if (args[i + 1] == "protect")
            {
                var data = Convert.FromBase64String(Console.In.ReadToEnd().Trim());
                File.WriteAllBytes(file, System.Security.Cryptography.ProtectedData.Protect(data, entropy, System.Security.Cryptography.DataProtectionScope.CurrentUser));
                return 0;
            }
            Console.Write(Convert.ToBase64String(System.Security.Cryptography.ProtectedData.Unprotect(File.ReadAllBytes(file), entropy, System.Security.Cryptography.DataProtectionScope.CurrentUser)));
            return 0;
        }
        catch { return 1; }
    }

    public static int Main(string[] args)
    {
        if (args.Contains("--task-install") || args.Contains("--task-remove")) return TaskSetup.Cli(args);
        if (args.Contains("--spout")) return SpoutHost.Run(args);
        if (args.Contains("--spout-probe")) return SpoutHost.Probe(args);
        if (args.Contains("--wallpaper")) return Wallpaper.Run(args);
        if (args.Contains("--keyagent-stop")) return KeyAgent.Stop();
        if (args.Contains("--keyagent")) return KeyAgent.Run(args);
        if (args.Contains("--library")) return Library.Cli(args);
        if (args.Contains("--fan-cal")) return FanCal.Run(args);
        if (args.Contains("--analyze-serve")) return Analyze.Serve();
        if (args.Contains("--analyze")) return Analyze.Run(args);
        if (args.Contains("--usb-tree")) return UsbTree.Run(args);
        if (args.Contains("--dpapi")) return Dpapi(args);
        if (args.Contains("--retag")) return Retag.Run(args);
        if (args.Contains("--retag-undo")) return Retag.Undo(args);
        if (args.Contains("--library-json")) return Retag.LibraryJson(args);
        if (args.Contains("--tag-dump")) return Retag.Dump(args);
        if (args.Contains("--rb-sql")) return RbProbe.Run(args);
        if (args.Contains("--rb-add")) return RbWriter.Add(args);
        if (args.Contains("--drops-eval")) return DropModel.Eval(args);
        if (args.Contains("--make-certs")) return PhoneCerts.Run(args);
        if (args.Contains("--onenote-convert")) return OneNoteExport.Run(args);
        string port = null, token = null, connFile = null, app = null;
        for (int i = 0; i < args.Length - 1; i++)
        {
            if (args[i] == "--port") port = args[i + 1];
            else if (args[i] == "--token") token = args[i + 1];
            else if (args[i] == "--conn-file") connFile = args[i + 1];
            else if (args[i] == "--app") app = args[i + 1];
        }
        Log.W($"boot args=[{string.Join(" | ", args.Where(x => !x.All(char.IsLetterOrDigit) || x.Length < 40))}] cwd={Environment.CurrentDirectory}");
        // launched with nothing (e.g. by the scheduled task): use the app's standard connection file
        if (port == null && connFile == null)
            connFile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "HYPERSPACE", "core-conn.json");
        // The scheduled-task launch path can't pass per-run arguments, so the app writes them to a file first.
        if (connFile != null)
        {
            try
            {
                var j = JsonNode.Parse(File.ReadAllText(connFile));
                port = j["port"]?.ToString();
                token = (string)j["token"];
            }
            catch (Exception e) { Log.W("conn-file: " + e.Message); }
        }
        if (port == null || token == null) { Log.W($"no connection info (conn-file={connFile ?? "none"})"); return 2; }
        // started by the silent-admin task from a file anything could have written: only talk to HYPERSPACE itself
        if (connFile != null && !TaskSetup.PeerIsApp(int.Parse(port), app)) return 4;

        AppDomain.CurrentDomain.UnhandledException += (_, e) => Log.W("FATAL " + e.ExceptionObject);
        Elevated = new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);
        Log.W($"start elevated={Elevated} port={port} via={(connFile != null ? "silent-admin task" : "app launch")}");

        using var client = new TcpClient();
        try { client.Connect("127.0.0.1", int.Parse(port)); }
        catch (Exception e) { Log.W("connect: " + e.Message); return 3; }
        var stream = client.GetStream();
        _out = new StreamWriter(stream, new UTF8Encoding(false)) { NewLine = "\n" };
        // user: on a standard account the admin prompt runs the core as the admin account, whose HKCU isn't yours
        Send(new { hello = token, elevated = Elevated, pid = Environment.ProcessId, version = 3, path = Environment.ProcessPath, hash = TaskSetup.SelfHash(), user = Environment.UserName });

        var hub = new Hub();
        hub.Start();
        using var reader = new StreamReader(stream, new UTF8Encoding(false));
        try
        {
            string line;
            while ((line = reader.ReadLine()) != null)
            {
                var l = line;
                ThreadPool.QueueUserWorkItem(_ => Handle(hub, l));
            }
        }
        catch (IOException) { }
        catch (Exception e) { Log.W("read loop: " + e); }

        // App went away: put the hardware back in a safe state before exiting.
        hub.Shutdown();
        Log.W("exit");
        return 0;
    }

    static async void Handle(Hub hub, string line)
    {
        JsonNode msg;
        try { msg = JsonNode.Parse(line); } catch { return; }
        int id = 0;
        try { id = msg?["id"]?.GetValue<int>() ?? 0; } catch { }
        var cmd = (string)msg?["cmd"];
        var a = msg?["args"] as JsonObject ?? new JsonObject();
        try
        {
            var data = await hub.Dispatch(cmd, a);
            Send(new { id, ok = true, data });
        }
        catch (Exception e)
        {
            Log.W($"{cmd}: {e}");
            Send(new { id, ok = false, error = e.Message });
        }
    }

    public static void Send(object o)
    {
        string s;
        try { s = JsonSerializer.Serialize(o, Json); }
        catch (Exception e) { s = JsonSerializer.Serialize(new { ev = "log", data = "serialize: " + e.Message }); }
        lock (WriteLock)
        {
            try { _out.Write(s); _out.Write('\n'); _out.Flush(); } catch { }
        }
    }

    public static void Event(string ev, object data) => Send(new { ev, data });
}

public static class A
{
    public static int I(JsonObject a, string k, int d = 0) =>
        a[k] is JsonValue v && v.TryGetValue<double>(out var x) ? (int)Math.Round(x) : d;
    public static double D(JsonObject a, string k, double d = 0) =>
        a[k] is JsonValue v && v.TryGetValue<double>(out var x) ? x : d;
    public static string S(JsonObject a, string k, string d = null) =>
        a[k] is JsonValue v && v.TryGetValue<string>(out var s) ? s : d;
    public static bool B(JsonObject a, string k, bool d = false) =>
        a[k] is JsonValue v && v.TryGetValue<bool>(out var b) ? b : d;

    /// [[temp, pct], ...] -> int[][]
    public static int[][] Curve(JsonNode n)
    {
        if (n is not JsonArray arr) return null;
        var pts = new List<int[]>();
        foreach (var p in arr)
            if (p is JsonArray xy && xy.Count == 2)
                pts.Add(new[] { (int)Math.Round(xy[0].GetValue<double>()), (int)Math.Round(xy[1].GetValue<double>()) });
        return pts.Count >= 2 ? pts.OrderBy(p => p[0]).ToArray() : null;
    }
}

public static class Log
{
    static readonly object L = new();
    static readonly string PathName = System.IO.Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "HYPERSPACE", "core.log");

    public static void W(string s)
    {
        lock (L)
        {
            try
            {
                Directory.CreateDirectory(System.IO.Path.GetDirectoryName(PathName));
                var fi = new FileInfo(PathName);
                if (fi.Exists && fi.Length > 1_000_000) fi.Delete();
                File.AppendAllText(PathName, $"{DateTime.Now:HH:mm:ss.fff} {s}\n");
            }
            catch { }
        }
    }
}
