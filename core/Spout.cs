using System.IO.MemoryMappedFiles;
using System.Net;
using System.Net.Sockets;
using System.Numerics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;

namespace HyperCore;

/// Spout 2 sender: a DirectX 11 shared texture plus the standard Spout shared-memory registry
/// ("SpoutSenderNames", "ActiveSenderName", per-sender info), so Resolume, MilkDrop, OBS and
/// TouchDesigner list it as a source. Runs in its own NON-elevated process: Spout objects made by an
/// admin process are invisible to normal receivers.
public sealed class SpoutSender : IDisposable
{
    const int NameLen = 256, InfoSize = 280;
    const uint FormatBgra = 87; // DXGI_FORMAT_B8G8R8A8_UNORM
    readonly string _name;
    readonly ID3D11Device _dev;
    readonly ID3D11DeviceContext _ctx;
    ID3D11Texture2D _tex;
    uint _handle;
    MemoryMappedFile _namesMap, _activeMap, _infoMap;
    Mutex _namesMutex, _infoMutex;
    readonly Mutex _access;
    public string Adapter { get; }
    public int W { get; private set; }
    public int H { get; private set; }
    public long Frames;

    public SpoutSender(string name, string gpu)
    {
        _name = name;
        DXGI.CreateDXGIFactory1(out IDXGIFactory1 factory).CheckError();
        IDXGIAdapter1 pick = null;
        ulong best = 0;
        for (uint i = 0; factory.EnumAdapters1(i, out IDXGIAdapter1 a).Success; i++)
        {
            var d = a.Description1;
            if ((d.Flags & AdapterFlags.Software) != 0) { a.Dispose(); continue; }
            bool nvidia = d.VendorId == 0x10DE;
            bool wanted = gpu == "integrated" ? !nvidia : nvidia;
            ulong score = (wanted ? 1UL << 62 : 0) + (ulong)d.DedicatedVideoMemory;
            if (pick == null || score > best) { pick?.Dispose(); pick = a; best = score; }
            else a.Dispose();
        }
        Adapter = pick?.Description1.Description ?? "default";
        D3D11.D3D11CreateDevice(pick, pick == null ? DriverType.Hardware : DriverType.Unknown, DeviceCreationFlags.BgraSupport,
            new[] { FeatureLevel.Level_11_0 }, out _dev, out _ctx).CheckError();
        pick?.Dispose();
        factory.Dispose();
        _access = new Mutex(false, _name + "_SpoutAccessMutex");
        Register();
    }

    static int MaxSenders()
    {
        try
        {
            using var k = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Leading Edge\Spout");
            if (k?.GetValue("MaxSenders") is int v && v > 0) return Math.Max(v, 10);
        }
        catch { }
        return 64;
    }

    static bool Lock(Mutex m, int ms)
    {
        try { return m.WaitOne(ms); } catch (AbandonedMutexException) { return true; }
    }

    void Register()
    {
        _namesMutex = new Mutex(false, "SpoutSenderNames_mutex");
        _namesMap = MemoryMappedFile.CreateOrOpen("SpoutSenderNames", MaxSenders() * NameLen);
        EditNames(n => { if (!n.Contains(_name)) n.Add(_name); });
        _activeMap = MemoryMappedFile.CreateOrOpen("ActiveSenderName", NameLen);
        using (var v = _activeMap.CreateViewAccessor(0, NameLen)) WriteName(v, 0, _name);
        _infoMutex = new Mutex(false, _name + "_mutex");
        _infoMap = MemoryMappedFile.CreateOrOpen(_name, InfoSize);
    }

    void EditNames(Action<List<string>> edit)
    {
        bool locked = Lock(_namesMutex, 500);
        try
        {
            using var v = _namesMap.CreateViewAccessor(0, 0);
            int slots = (int)Math.Min(v.Capacity / NameLen, MaxSenders());
            var names = new List<string>();
            for (int i = 0; i < slots; i++)
            {
                var n = ReadName(v, i * NameLen);
                if (n.Length == 0) break;
                names.Add(n);
            }
            edit(names);
            names = names.Distinct().OrderBy(x => x, StringComparer.Ordinal).Take(slots).ToList(); // Spout keeps a sorted set
            for (int i = 0; i < slots; i++) WriteName(v, i * NameLen, i < names.Count ? names[i] : "");
        }
        finally { if (locked) _namesMutex.ReleaseMutex(); }
    }

    static string ReadName(MemoryMappedViewAccessor v, long off)
    {
        var b = new byte[NameLen];
        v.ReadArray(off, b, 0, NameLen);
        int z = Array.IndexOf(b, (byte)0);
        return Encoding.ASCII.GetString(b, 0, z < 0 ? NameLen : z);
    }

    static void WriteName(MemoryMappedViewAccessor v, long off, string s)
    {
        var b = new byte[NameLen];
        Encoding.ASCII.GetBytes(s, 0, Math.Min(s.Length, NameLen - 1), b, 0);
        v.WriteArray(off, b, 0, NameLen);
    }

    /// SharedTextureInfo: shareHandle, width, height, format, usage (uint32 each), description[256], partnerId.
    void WriteInfo()
    {
        bool locked = Lock(_infoMutex, 200);
        try
        {
            using var v = _infoMap.CreateViewAccessor(0, InfoSize);
            v.Write(0, _handle);
            v.Write(4, (uint)W);
            v.Write(8, (uint)H);
            v.Write(12, FormatBgra);
            v.Write(16, 0u);
            var desc = new byte[256];
            var exe = Encoding.ASCII.GetBytes(Environment.ProcessPath ?? "HYPERSPACE");
            Array.Copy(exe, desc, Math.Min(exe.Length, 255));
            v.WriteArray(20, desc, 0, 256);
            v.Write(276, 0u);
        }
        finally { if (locked) _infoMutex.ReleaseMutex(); }
    }

    void Ensure(int w, int h)
    {
        if (_tex != null && w == W && h == H) return;
        _tex?.Dispose();
        _tex = _dev.CreateTexture2D(new Texture2DDescription
        {
            Width = (uint)w, Height = (uint)h, MipLevels = 1, ArraySize = 1, Format = Format.B8G8R8A8_UNorm,
            SampleDescription = new SampleDescription(1, 0), Usage = ResourceUsage.Default,
            BindFlags = BindFlags.ShaderResource | BindFlags.RenderTarget, CPUAccessFlags = CpuAccessFlags.None,
            MiscFlags = ResourceOptionFlags.Shared,
        });
        using (var res = _tex.QueryInterface<IDXGIResource>()) _handle = (uint)(nint)res.SharedHandle;
        W = w; H = h;
        WriteInfo();
    }

    /// Upload one BGRA frame (top row first) into the shared texture.
    public unsafe void Send(int w, int h, byte[] data, int offset)
    {
        Ensure(w, h);
        bool locked = Lock(_access, 67);
        try
        {
            fixed (byte* p = &data[offset]) _ctx.UpdateSubresource(_tex, 0, null, (IntPtr)p, (uint)(w * 4), 0);
            _ctx.Flush();
        }
        finally { if (locked) _access.ReleaseMutex(); }
        Frames++;
    }

    public void Dispose()
    {
        try
        {
            EditNames(n => n.Remove(_name));
            using var v = _activeMap.CreateViewAccessor(0, NameLen);
            if (ReadName(v, 0) == _name) WriteName(v, 0, "");
        }
        catch { }
        _infoMap?.Dispose(); _namesMap?.Dispose(); _activeMap?.Dispose();
        _tex?.Dispose(); _ctx?.Dispose(); _dev?.Dispose();
    }
}

/// `HyperCore.exe --spout --token T [--name N] [--gpu nvidia|integrated]`: a localhost WebSocket that receives
/// frames from the app's hidden VJ renderer ([u32 width][u32 height][BGRA pixels]) and publishes them via Spout.
/// Prints "PORT <n>" on start and "STATS <frames> <w>x<h>" every 2 s; exits when the app closes its stdin.
public static class SpoutHost
{
    public static int Run(string[] args)
    {
        string Arg(string k, string d) { int i = Array.IndexOf(args, k); return i >= 0 && i + 1 < args.Length ? args[i + 1] : d; }
        var token = Arg("--token", null);
        if (string.IsNullOrEmpty(token)) return 2;
        SpoutSender sender;
        try { sender = new SpoutSender(Arg("--name", "HYPERSPACE"), Arg("--gpu", "nvidia")); }
        catch (Exception e) { Console.WriteLine("ERROR " + e.Message); Console.Out.Flush(); return 4; }

        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        Console.WriteLine($"PORT {((IPEndPoint)listener.LocalEndpoint).Port} ADAPTER {sender.Adapter}");
        Console.Out.Flush();

        void Quit() { try { sender.Dispose(); } catch { } Environment.Exit(0); }
        new Thread(() => { try { while (Console.In.Read() >= 0) { } } catch { } Quit(); }) { IsBackground = true }.Start();
        new Thread(() =>
        {
            while (true) { Thread.Sleep(2000); Console.WriteLine($"STATS {sender.Frames} {sender.W}x{sender.H}"); Console.Out.Flush(); }
        }) { IsBackground = true }.Start();

        while (true)
        {
            try { using var c = listener.AcceptTcpClient(); Serve(c, token, sender); }
            catch (Exception e) { Console.WriteLine("WARN " + e.Message); Console.Out.Flush(); }
        }
    }

    static bool ReadExact(Stream s, byte[] b, int off, int n)
    {
        while (n > 0) { int r = s.Read(b, off, n); if (r <= 0) return false; off += r; n -= r; }
        return true;
    }

    static void Unmask(byte[] b, int off, int n, uint mask)
    {
        var span = b.AsSpan(off, n);
        int words = n / 4;
        var u = MemoryMarshal.Cast<byte, uint>(span[..(words * 4)]);
        var vu = MemoryMarshal.Cast<uint, Vector<uint>>(u);
        var vm = new Vector<uint>(mask);
        for (int i = 0; i < vu.Length; i++) vu[i] ^= vm;
        for (int i = vu.Length * Vector<uint>.Count; i < u.Length; i++) u[i] ^= mask;
        for (int i = words * 4; i < n; i++) span[i] ^= (byte)(mask >> ((i & 3) * 8));
    }

    static void Serve(TcpClient c, string token, SpoutSender sender)
    {
        c.NoDelay = true;
        c.ReceiveBufferSize = 8 << 20;
        var s = c.GetStream();
        var head = new StringBuilder();
        var one = new byte[1];
        while (!head.ToString().EndsWith("\r\n\r\n"))
        {
            if (s.Read(one, 0, 1) <= 0 || head.Length > 8192) return;
            head.Append((char)one[0]);
        }
        var req = head.ToString();
        if (!req.StartsWith($"GET /?k={token} ")) return; // wrong or missing key: drop
        var key = Regex.Match(req, @"Sec-WebSocket-Key:\s*(\S+)", RegexOptions.IgnoreCase).Groups[1].Value;
        var accept = Convert.ToBase64String(SHA1.HashData(Encoding.ASCII.GetBytes(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")));
        s.Write(Encoding.ASCII.GetBytes($"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n"));

        var buf = new byte[8 << 20];
        var hdr = new byte[14];
        var mk = new byte[4];
        int len = 0;
        while (true)
        {
            if (!ReadExact(s, hdr, 0, 2)) return;
            bool fin = (hdr[0] & 0x80) != 0, masked = (hdr[1] & 0x80) != 0;
            int op = hdr[0] & 0x0F;
            long plen = hdr[1] & 0x7F;
            if (plen == 126) { if (!ReadExact(s, hdr, 2, 2)) return; plen = (hdr[2] << 8) | hdr[3]; }
            else if (plen == 127) { if (!ReadExact(s, hdr, 2, 8)) return; plen = 0; for (int i = 0; i < 8; i++) plen = (plen << 8) | hdr[2 + i]; }
            if (masked && !ReadExact(s, mk, 0, 4)) return;
            if (op == 8 || plen > 128L << 20) return; // close, or an absurd frame
            if (op != 0) len = 0; // start of a new message
            if (buf.Length < len + plen) Array.Resize(ref buf, (int)(len + plen));
            if (!ReadExact(s, buf, len, (int)plen)) return;
            if (masked) Unmask(buf, len, (int)plen, BitConverter.ToUInt32(mk, 0));
            len += (int)plen;
            if (!fin || op == 9 || op == 10 || op == 1) { if (fin) len = 0; continue; }
            if (len >= 8)
            {
                int w = BitConverter.ToInt32(buf, 0), h = BitConverter.ToInt32(buf, 4);
                if (w > 0 && h > 0 && w <= 8192 && h <= 8192 && len >= 8 + w * h * 4) sender.Send(w, h, buf, 8);
            }
            len = 0;
        }
    }

    /// `HyperCore.exe --spout-probe [name]`: act as a Spout receiver and report what a sender is publishing.
    public static int Probe(string[] args)
    {
        var want = args.SkipWhile(a => a != "--spout-probe").Skip(1).FirstOrDefault();
        try
        {
            using var names = MemoryMappedFile.OpenExisting("SpoutSenderNames");
            using var v = names.CreateViewAccessor(0, 0, MemoryMappedFileAccess.Read);
            var list = new List<string>();
            for (int i = 0; i < v.Capacity / 256; i++)
            {
                var b = new byte[256]; v.ReadArray(i * 256, b, 0, 256);
                int z = Array.IndexOf(b, (byte)0);
                if (z == 0) break;
                list.Add(Encoding.ASCII.GetString(b, 0, z < 0 ? 256 : z));
            }
            Console.WriteLine("senders: " + string.Join(", ", list));
            var name = want ?? list.FirstOrDefault();
            if (name == null) return 1;
            using var info = MemoryMappedFile.OpenExisting(name);
            using var iv = info.CreateViewAccessor(0, 280, MemoryMappedFileAccess.Read);
            uint handle = iv.ReadUInt32(0), w = iv.ReadUInt32(4), h = iv.ReadUInt32(8), fmt = iv.ReadUInt32(12);
            Console.WriteLine($"'{name}': {w}x{h} format {fmt} handle 0x{handle:X}");

            DXGI.CreateDXGIFactory1(out IDXGIFactory1 f).CheckError();
            foreach (var preferNvidia in new[] { true, false })
            {
                for (uint i = 0; f.EnumAdapters1(i, out IDXGIAdapter1 a).Success; i++)
                {
                    using var ad = a;
                    if ((ad.Description1.VendorId == 0x10DE) != preferNvidia || (ad.Description1.Flags & AdapterFlags.Software) != 0) continue;
                    try
                    {
                        D3D11.D3D11CreateDevice(ad, DriverType.Unknown, DeviceCreationFlags.BgraSupport, new[] { FeatureLevel.Level_11_0 }, out ID3D11Device dev, out ID3D11DeviceContext ctx).CheckError();
                        using (dev) using (ctx)
                        {
                            using var tex = dev.OpenSharedResource<ID3D11Texture2D>((IntPtr)handle);
                            var d = tex.Description;
                            d.Usage = ResourceUsage.Staging; d.BindFlags = BindFlags.None; d.CPUAccessFlags = CpuAccessFlags.Read; d.MiscFlags = ResourceOptionFlags.None;
                            using var staging = dev.CreateTexture2D(d);
                            ctx.CopyResource(staging, tex);
                            var map = ctx.Map(staging, 0, MapMode.Read);
                            long r = 0, g = 0, bl = 0, lit = 0, n = 0;
                            unsafe
                            {
                                for (int y = 0; y < d.Height; y += 8)
                                {
                                    byte* row = (byte*)map.DataPointer + y * map.RowPitch;
                                    for (int x = 0; x < d.Width; x += 8, n++)
                                    {
                                        bl += row[x * 4]; g += row[x * 4 + 1]; r += row[x * 4 + 2];
                                        if (row[x * 4 + 1] > 40) lit++;
                                    }
                                }
                            }
                            ctx.Unmap(staging, 0);
                            Console.WriteLine($"opened on {ad.Description1.Description}: avg RGB {r / n},{g / n},{bl / n} · {lit * 100 / n}% of pixels lit");
                            return 0;
                        }
                    }
                    catch (Exception e) { Console.WriteLine($"{ad.Description1.Description}: {e.Message.Split('\n')[0]}"); }
                }
            }
            return 3;
        }
        catch (Exception e) { Console.WriteLine("probe: " + e.Message); return 2; }
    }
}
