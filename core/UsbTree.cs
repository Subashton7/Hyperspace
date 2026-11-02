using System.Management;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

namespace HyperCore;

/// HARDWARE → PORTS: every USB path from the laptop's controllers through hubs to each device, read the way
/// Microsoft's USBView does (each hub is asked about each of its ports). Per device: speed and the power it asked
/// for. Laptops have no sensors on their ports, so "power" is what the device requested, not a measurement; the
/// battery's voltage and watts are real readings.
///   HyperCore --usb-tree    prints { controllers: [...], power: {...} }
public static class UsbTree
{
    public static int Run(string[] args)
    {
        object r;
        try { r = Read(); } catch (Exception e) { r = new { ok = false, error = e.Message }; }
        Console.WriteLine(JsonSerializer.Serialize(r));
        return 0;
    }

    // ---------- the device tree ----------
    sealed class Node
    {
        public string Id, Parent, Name, Class, Driver, Service, Location;
        public List<Node> Kids = new();
    }

    static readonly Guid DevProps = new("a45c254e-df1c-4efd-8020-67d146a850e0");
    static readonly DEVPROPKEY KDesc = new(DevProps, 2), KService = new(DevProps, 6), KClass = new(DevProps, 9), KDriver = new(DevProps, 11),
        KFriendly = new(DevProps, 14), KLocation = new(DevProps, 15), KParent = new(new Guid("4340a6c5-93fa-4706-972c-7b648008a5a7"), 8),
        KBusDesc = new(new Guid("540b947e-8b40-45bc-a8a2-6a0b894cbda2"), 4);
    static readonly Guid HubIface = new("f18a0e88-c30c-11d0-8815-00a0c906bed8");

    static object Read()
    {
        var nodes = new Dictionary<string, Node>(StringComparer.OrdinalIgnoreCase);
        var set = SetupDiGetClassDevsW(IntPtr.Zero, null, IntPtr.Zero, DIGCF_PRESENT | DIGCF_ALLCLASSES);
        try
        {
            var d = new SP_DEVINFO_DATA { cbSize = Marshal.SizeOf<SP_DEVINFO_DATA>() };
            for (int i = 0; SetupDiEnumDeviceInfo(set, i, ref d); i++)
            {
                var sb = new StringBuilder(512);
                if (!SetupDiGetDeviceInstanceIdW(set, ref d, sb, sb.Capacity, out _)) continue;
                var n = new Node
                {
                    Id = sb.ToString(), Parent = Prop(set, ref d, KParent), Class = Prop(set, ref d, KClass), Driver = Prop(set, ref d, KDriver),
                    Service = Prop(set, ref d, KService), Location = Prop(set, ref d, KLocation),
                };
                // the name the device gives itself beats Windows' generic "USB Composite Device" / "USB Input Device"
                var friendly = Prop(set, ref d, KFriendly); var desc = Prop(set, ref d, KDesc); var bus = Prop(set, ref d, KBusDesc);
                n.Name = friendly ?? (Generic(desc) && bus != null ? bus : desc) ?? bus ?? n.Id;
                nodes[n.Id] = n;
            }
        }
        finally { SetupDiDestroyDeviceInfoList(set); }
        foreach (var n in nodes.Values) if (n.Parent != null && nodes.TryGetValue(n.Parent, out var p)) p.Kids.Add(n);
        var byDriver = nodes.Values.Where(n => n.Driver != null).GroupBy(n => n.Driver, StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);
        var hubPaths = HubPaths();

        object Hub(Node hubNode, int depth)
        {
            if (!hubPaths.TryGetValue(hubNode.Id, out var path) || depth > 8) return null;
            using var h = CreateFileW(path, GENERIC_WRITE, FILE_SHARE_WRITE, IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero);
            if (h.IsInvalid) return new { error = "can't open hub" };
            // hub descriptor: number of ports, and whether the hub runs off its own power supply
            var info = new byte[80];
            int ports = 0; bool? busPowered = null;
            if (DeviceIoControl(h, IOCTL_USB_GET_NODE_INFORMATION, info, info.Length, info, info.Length, out _, IntPtr.Zero))
            { ports = info[6]; busPowered = info[4 + 7 + 64] != 0; }
            var list = new List<object>();
            for (int port = 1; port <= ports; port++)
            {
                var c = new byte[35 + 32 * 11];
                BitConverter.GetBytes(port).CopyTo(c, 0);
                if (!DeviceIoControl(h, IOCTL_USB_GET_NODE_CONNECTION_INFORMATION_EX, c, c.Length, c, c.Length, out _, IntPtr.Zero)) continue;
                bool connected = BitConverter.ToInt32(c, 31) == 1;
                int speed = c[23];
                ushort bcdUsb = BitConverter.ToUInt16(c, 6), vid = BitConverter.ToUInt16(c, 12), pid = BitConverter.ToUInt16(c, 14), bcdDev = BitConverter.ToUInt16(c, 16);
                byte devClass = c[8], iMaker = c[18], iProduct = c[19];
                ushort address = BitConverter.ToUInt16(c, 25);
                int pipes = BitConverter.ToInt32(c, 27);
                bool isHub = c[24] != 0;
                // USB-C connector? user-reachable at all? (internal ports carry the webcam, Bluetooth, card reader…)
                // a USB 3 socket is two ports to Windows (its USB 2 lanes and its 5+ Gbps lanes): the companion links them
                bool typeC = false, user = true; int companion = 0;
                var pc = new byte[512];
                BitConverter.GetBytes(port).CopyTo(pc, 0);
                if (DeviceIoControl(h, IOCTL_USB_GET_PORT_CONNECTOR_PROPERTIES, pc, pc.Length, pc, pc.Length, out _, IntPtr.Zero))
                { int props = BitConverter.ToInt32(pc, 8); user = (props & 1) != 0; typeC = (props & 8) != 0; companion = BitConverter.ToUInt16(pc, 14); }
                // SuperSpeed+ (10/20 Gbps) only shows in the V2 query
                bool ssPlus = false, ss = speed >= 3;
                var v2 = new byte[16];
                BitConverter.GetBytes(port).CopyTo(v2, 0); BitConverter.GetBytes(16).CopyTo(v2, 4); BitConverter.GetBytes(7).CopyTo(v2, 8);
                if (DeviceIoControl(h, IOCTL_USB_GET_NODE_CONNECTION_INFORMATION_EX_V2, v2, v2.Length, v2, v2.Length, out _, IntPtr.Zero))
                { int fl = BitConverter.ToInt32(v2, 12); ss |= (fl & 1) != 0; ssPlus = (fl & 4) != 0; }
                object dev = null;
                if (connected)
                {
                    // power the device asked for (config descriptor bMaxPower: 2 mA units on USB 2, 8 mA on USB 3)
                    int maxMa = -1; bool selfPowered = false;
                    var rq = new byte[12 + 9];
                    BitConverter.GetBytes(port).CopyTo(rq, 0);
                    rq[4] = 0x80; rq[5] = 6; BitConverter.GetBytes((ushort)(2 << 8)).CopyTo(rq, 6); BitConverter.GetBytes((ushort)9).CopyTo(rq, 10);
                    if (DeviceIoControl(h, IOCTL_USB_GET_DESCRIPTOR_FROM_NODE_CONNECTION, rq, rq.Length, rq, rq.Length, out int got, IntPtr.Zero) && got >= 21 && rq[13] == 2)
                    { selfPowered = (rq[12 + 7] & 0x40) != 0; maxMa = rq[12 + 8] * (ss ? 8 : 2); }
                    var node = DriverKey(h, port) is string dk && byDriver.TryGetValue(dk, out var nd) ? nd : null;
                    dev = new
                    {
                        name = node?.Name ?? $"USB device {vid:X4}:{pid:X4}", id = node?.Id, vid = vid.ToString("X4"), pid = pid.ToString("X4"),
                        usb = $"{bcdUsb >> 8}.{(bcdUsb >> 4) & 0xF}", isHub, maxMa, selfPowered,
                        // what the device itself says it is (its own text, in English), and the rest of its ID card
                        maker = StringDesc(h, port, iMaker), product = StringDesc(h, port, iProduct),
                        version = $"{bcdDev >> 8}.{bcdDev & 0xFF:X2}", cls = ClassName(devClass), address, pipes,
                        driver = node?.Service, kind = node?.Class,
                        functions = node == null ? Array.Empty<string>() : Functions(node).Distinct().Take(6).ToArray(),
                        drives = node == null ? null : Drives(node), nets = node == null ? null : Nets(node),
                        hub = isHub && node != null ? Hub(node, depth + 1) : null,
                    };
                }
                list.Add(new
                {
                    port, companion, connected, typeC, user, speed = !connected ? null : ssPlus ? "10 Gbps+" : ss ? "5 Gbps" : speed switch { 2 => "480 Mbps", 1 => "12 Mbps", 0 => "1.5 Mbps", _ => "?" },
                    gen = !connected ? null : ssPlus ? "USB 3.2 Gen 2" : ss ? "USB 3" : speed == 2 ? "USB 2" : "USB 1", device = dev,
                });
            }
            return new { name = hubNode.Name, ports = list, busPowered };
        }

        // USB host controllers: class USB, not themselves on a USB bus
        var controllers = nodes.Values
            .Where(n => string.Equals(n.Class, "USB", StringComparison.OrdinalIgnoreCase) && !n.Id.StartsWith("USB\\", StringComparison.OrdinalIgnoreCase)
                && n.Kids.Any(k => k.Id.StartsWith("USB\\ROOT_HUB", StringComparison.OrdinalIgnoreCase)))
            .Select(n => new { name = n.Name, id = n.Id, hubs = n.Kids.Where(k => k.Id.StartsWith("USB\\ROOT_HUB", StringComparison.OrdinalIgnoreCase)).Select(k => Hub(k, 0)).Where(x => x != null).ToArray() })
            .ToArray();
        return new { ok = true, at = DateTime.UtcNow, controllers, power = Power() };
    }

    // what a USB device actually is underneath: keyboard, disk, audio… (its child devices' names)
    static IEnumerable<string> Functions(Node n)
    {
        foreach (var k in n.Kids)
        {
            if (k.Id.StartsWith("USB\\", StringComparison.OrdinalIgnoreCase) && k.Kids.Count > 0) { foreach (var f in Functions(k)) yield return f; continue; }
            if (!Generic(k.Name)) yield return k.Name;
            foreach (var g in k.Kids) if (!Generic(g.Name)) yield return g.Name;
        }
    }
    static bool Generic(string s) => s == null || s.StartsWith("USB Composite", StringComparison.OrdinalIgnoreCase) || s.StartsWith("USB Input Device", StringComparison.OrdinalIgnoreCase)
        || s.StartsWith("HID-compliant vendor", StringComparison.OrdinalIgnoreCase) || s.StartsWith("HID-compliant device", StringComparison.OrdinalIgnoreCase);

    static string StringDesc(SafeFileHandle h, int port, byte index)
    {
        if (index == 0) return null;
        var rq = new byte[12 + 255];
        BitConverter.GetBytes(port).CopyTo(rq, 0);
        rq[4] = 0x80; rq[5] = 6; BitConverter.GetBytes((ushort)(3 << 8 | index)).CopyTo(rq, 6);
        BitConverter.GetBytes((ushort)0x0409).CopyTo(rq, 8); BitConverter.GetBytes((ushort)255).CopyTo(rq, 10);
        if (!DeviceIoControl(h, IOCTL_USB_GET_DESCRIPTOR_FROM_NODE_CONNECTION, rq, rq.Length, rq, rq.Length, out int got, IntPtr.Zero) || got < 14 || rq[13] != 3) return null;
        int len = Math.Min(rq[12], got - 12);
        var s = Encoding.Unicode.GetString(rq, 14, Math.Max(0, len - 2)).Trim('\0', ' ');
        return s.Length == 0 ? null : s;
    }

    static string ClassName(byte c) => c switch
    {
        0 => "per interface", 1 => "audio", 2 => "communications", 3 => "human input", 6 => "imaging", 7 => "printer", 8 => "storage",
        9 => "hub", 0x0A => "data", 0x0E => "video", 0x0F => "health", 0x10 => "audio/video", 0xE0 => "wireless", 0xEF => "multi-function",
        0xFE => "application", 0xFF => "vendor-specific", _ => $"0x{c:X2}",
    };

    static IEnumerable<Node> Below(Node n) { foreach (var k in n.Kids) { yield return k; foreach (var g in Below(k)) yield return g; } }

    // USB drives: their letters, size, free space and cumulative bytes read / written (the app turns those into MB/s)
    static object[] Drives(Node n)
    {
        var disks = Below(n).Where(k => string.Equals(k.Class, "DiskDrive", StringComparison.OrdinalIgnoreCase)).ToList();
        if (disks.Count == 0) return null;
        var list = new List<object>();
        try
        {
            foreach (var d in disks)
            {
                using var ds = new ManagementObjectSearcher($"SELECT DeviceID FROM Win32_DiskDrive WHERE PNPDeviceID = '{d.Id.Replace("\\", "\\\\").Replace("'", "\\'")}'");
                foreach (ManagementObject disk in ds.Get())
                    foreach (ManagementObject part in disk.GetRelated("Win32_DiskPartition"))
                        foreach (ManagementObject ld in part.GetRelated("Win32_LogicalDisk"))
                        {
                            var letter = (string)ld["DeviceID"];
                            ulong rd = 0, wr = 0;
                            try
                            {
                                using var pc = new ManagementObjectSearcher($"SELECT DiskReadBytesPersec, DiskWriteBytesPersec FROM Win32_PerfRawData_PerfDisk_LogicalDisk WHERE Name = '{letter}'");
                                foreach (ManagementObject o in pc.Get()) { rd = (ulong)o["DiskReadBytesPersec"]; wr = (ulong)o["DiskWriteBytesPersec"]; }
                            }
                            catch { }
                            list.Add(new { letter, label = (string)ld["VolumeName"], size = (ulong?)ld["Size"], free = (ulong?)ld["FreeSpace"], fs = (string)ld["FileSystem"], read = rd, written = wr });
                        }
            }
        }
        catch { }
        return list.Count > 0 ? list.ToArray() : null;
    }

    // USB network links (phone tethering, USB Ethernet): link speed and cumulative bytes in / out
    static object[] Nets(Node n)
    {
        var names = Below(n).Where(k => string.Equals(k.Class, "Net", StringComparison.OrdinalIgnoreCase)).Select(k => k.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (names.Count == 0) return null;
        var list = new List<object>();
        foreach (var ni in System.Net.NetworkInformation.NetworkInterface.GetAllNetworkInterfaces())
        {
            if (!names.Contains(ni.Description)) continue;
            long rx = 0, tx = 0;
            try { var st = ni.GetIPStatistics(); rx = st.BytesReceived; tx = st.BytesSent; } catch { }
            list.Add(new { name = ni.Name, up = ni.OperationalStatus == System.Net.NetworkInformation.OperationalStatus.Up, mbps = ni.Speed > 0 ? ni.Speed / 1_000_000 : 0, rx, tx });
        }
        return list.Count > 0 ? list.ToArray() : null;
    }

    static string DriverKey(SafeFileHandle h, int port)
    {
        var b = new byte[1024];
        BitConverter.GetBytes(port).CopyTo(b, 0);
        if (!DeviceIoControl(h, IOCTL_USB_GET_NODE_CONNECTION_DRIVERKEY_NAME, b, b.Length, b, b.Length, out _, IntPtr.Zero)) return null;
        int len = BitConverter.ToInt32(b, 4);
        return len <= 8 ? null : Encoding.Unicode.GetString(b, 8, Math.Min(len, b.Length) - 8).TrimEnd('\0');
    }

    // device-instance id → path to open each hub
    static Dictionary<string, string> HubPaths()
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var g = HubIface;
        var set = SetupDiGetClassDevsW(ref g, null, IntPtr.Zero, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE);
        try
        {
            var ifd = new SP_DEVICE_INTERFACE_DATA { cbSize = Marshal.SizeOf<SP_DEVICE_INTERFACE_DATA>() };
            for (int i = 0; SetupDiEnumDeviceInterfaces(set, IntPtr.Zero, ref g, i, ref ifd); i++)
            {
                var dd = new SP_DEVINFO_DATA { cbSize = Marshal.SizeOf<SP_DEVINFO_DATA>() };
                SetupDiGetDeviceInterfaceDetailW(set, ref ifd, IntPtr.Zero, 0, out int need, ref dd);
                var buf = Marshal.AllocHGlobal(need);
                try
                {
                    Marshal.WriteInt32(buf, IntPtr.Size == 8 ? 8 : 6);
                    if (!SetupDiGetDeviceInterfaceDetailW(set, ref ifd, buf, need, out _, ref dd)) continue;
                    var path = Marshal.PtrToStringUni(buf + 4);
                    var sb = new StringBuilder(512);
                    if (SetupDiGetDeviceInstanceIdW(set, ref dd, sb, sb.Capacity, out _)) map[sb.ToString()] = path;
                }
                finally { Marshal.FreeHGlobal(buf); }
            }
        }
        finally { SetupDiDestroyDeviceInfoList(set); }
        return map;
    }

    // the battery's real readings: voltage, current, watts in or out, charge, wear, cycles, time left
    static object Power()
    {
        static ManagementObject First(string ns, string q)
        {
            try { using var s = new ManagementObjectSearcher(ns, q); foreach (ManagementObject o in s.Get()) return o; } catch { }
            return null;
        }
        static double N(ManagementObject o, string k) { try { return o == null || o[k] == null ? 0 : Convert.ToDouble(o[k]); } catch { return 0; } }
        static bool B(ManagementObject o, string k) { try { return o != null && o[k] is bool b && b; } catch { return false; } }
        var st = First(@"root\wmi", "SELECT * FROM BatteryStatus");
        if (st == null) return new { battery = false };
        var full = First(@"root\wmi", "SELECT FullChargedCapacity FROM BatteryFullChargedCapacity");
        var stat = First(@"root\wmi", "SELECT DesignedCapacity, ManufactureName, DeviceName, Chemistry FROM BatteryStaticData");
        var cyc = First(@"root\wmi", "SELECT CycleCount FROM BatteryCycleCount");
        var run = First(@"root\wmi", "SELECT EstimatedRuntime FROM BatteryRuntime");
        double volts = N(st, "Voltage") / 1000, inW = N(st, "ChargeRate") / 1000, outW = N(st, "DischargeRate") / 1000;
        double remain = N(st, "RemainingCapacity"), fullCap = N(full, "FullChargedCapacity"), design = N(stat, "DesignedCapacity");
        string chem = null;
        try { var c = (uint)N(stat, "Chemistry"); chem = c == 0 ? null : Encoding.ASCII.GetString(BitConverter.GetBytes(c)).Trim('\0', ' '); } catch { }
        double runtime = N(run, "EstimatedRuntime");
        bool charging = B(st, "Charging"), plugged = B(st, "PowerOnline");
        return new
        {
            battery = true, volts = Math.Round(volts, 3), plugged, charging, critical = B(st, "Critical"),
            chargeW = Math.Round(inW, 2), dischargeW = Math.Round(outW, 2),
            amps = volts > 0 ? Math.Round((charging ? inW : -outW) / volts, 3) : 0,   // + into the battery, − out of it
            remainWh = Math.Round(remain / 1000, 2), fullWh = Math.Round(fullCap / 1000, 2), designWh = Math.Round(design / 1000, 2),
            percent = fullCap > 0 ? Math.Round(remain / fullCap * 100, 1) : (double?)null,
            health = design > 0 && fullCap > 0 ? Math.Round(fullCap / design * 100, 1) : (double?)null,
            cycles = cyc == null ? (int?)null : (int)N(cyc, "CycleCount"),
            // Windows' own estimate on battery; to full: the charge still missing at the current charging rate
            minutesLeft = !plugged && runtime > 0 && runtime < 0xFFFFFFF0 ? Math.Round(runtime / 60) : (double?)null,
            minutesToFull = charging && inW > 0.5 && fullCap > remain ? Math.Round((fullCap - remain) / 1000 / inW * 60) : (double?)null,
            maker = (string)stat?["ManufactureName"], model = (string)stat?["DeviceName"], chemistry = chem,
        };
    }

    // ---------- Windows plumbing ----------
    const int DIGCF_PRESENT = 2, DIGCF_ALLCLASSES = 4, DIGCF_DEVICEINTERFACE = 0x10;
    const uint GENERIC_WRITE = 0x40000000, FILE_SHARE_WRITE = 2, OPEN_EXISTING = 3;
    const uint IOCTL_USB_GET_NODE_INFORMATION = 0x220408, IOCTL_USB_GET_DESCRIPTOR_FROM_NODE_CONNECTION = 0x220410,
        IOCTL_USB_GET_NODE_CONNECTION_DRIVERKEY_NAME = 0x220420, IOCTL_USB_GET_NODE_CONNECTION_INFORMATION_EX = 0x220448,
        IOCTL_USB_GET_PORT_CONNECTOR_PROPERTIES = 0x220458, IOCTL_USB_GET_NODE_CONNECTION_INFORMATION_EX_V2 = 0x22045C;

    [StructLayout(LayoutKind.Sequential)] struct SP_DEVINFO_DATA { public int cbSize; public Guid ClassGuid; public int DevInst; public IntPtr Reserved; }
    [StructLayout(LayoutKind.Sequential)] struct SP_DEVICE_INTERFACE_DATA { public int cbSize; public Guid InterfaceClassGuid; public int Flags; public IntPtr Reserved; }
    [StructLayout(LayoutKind.Sequential)] struct DEVPROPKEY { public Guid fmtid; public int pid; public DEVPROPKEY(Guid g, int p) { fmtid = g; pid = p; } }

    static string Prop(IntPtr set, ref SP_DEVINFO_DATA d, DEVPROPKEY k)
    {
        var buf = new byte[1024];
        if (!SetupDiGetDevicePropertyW(set, ref d, ref k, out int type, buf, buf.Length, out int req, 0) || type != 0x12) return null;
        var s = Encoding.Unicode.GetString(buf, 0, Math.Min(req, buf.Length)).TrimEnd('\0');
        return s.Length == 0 ? null : s;
    }

    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr SetupDiGetClassDevsW(IntPtr guid, string enumerator, IntPtr hwnd, int flags);
    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr SetupDiGetClassDevsW(ref Guid guid, string enumerator, IntPtr hwnd, int flags);
    [DllImport("setupapi.dll", SetLastError = true)] static extern bool SetupDiEnumDeviceInfo(IntPtr set, int index, ref SP_DEVINFO_DATA data);
    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool SetupDiGetDeviceInstanceIdW(IntPtr set, ref SP_DEVINFO_DATA data, StringBuilder id, int size, out int required);
    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool SetupDiGetDevicePropertyW(IntPtr set, ref SP_DEVINFO_DATA data, ref DEVPROPKEY key, out int type, byte[] buf, int size, out int required, int flags);
    [DllImport("setupapi.dll", SetLastError = true)] static extern bool SetupDiEnumDeviceInterfaces(IntPtr set, IntPtr devinfo, ref Guid guid, int index, ref SP_DEVICE_INTERFACE_DATA data);
    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool SetupDiGetDeviceInterfaceDetailW(IntPtr set, ref SP_DEVICE_INTERFACE_DATA data, IntPtr detail, int size, out int required, ref SP_DEVINFO_DATA devinfo);
    [DllImport("setupapi.dll")] static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr sec, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool DeviceIoControl(SafeFileHandle h, uint code, byte[] inBuf, int inSize, byte[] outBuf, int outSize, out int returned, IntPtr overlapped);
}
