using System.Runtime.InteropServices;
using System.Text;

namespace HyperCore;

// ---------------- NVIDIA NVML (ships with the driver in System32) ----------------
static class Nvml
{
    const string D = "nvml.dll";
    [StructLayout(LayoutKind.Sequential)] public struct Util { public uint gpu, memory; }
    [StructLayout(LayoutKind.Sequential)] public struct Mem { public ulong total, free, used; }

    [DllImport(D)] public static extern int nvmlInit_v2();
    [DllImport(D)] public static extern int nvmlShutdown();
    [DllImport(D)] public static extern int nvmlDeviceGetHandleByIndex_v2(uint i, out IntPtr dev);
    [DllImport(D, CharSet = CharSet.Ansi)] public static extern int nvmlDeviceGetName(IntPtr d, StringBuilder name, uint len);
    [DllImport(D)] public static extern int nvmlDeviceGetTemperature(IntPtr d, int sensor, out uint t);
    [DllImport(D)] public static extern int nvmlDeviceGetTemperatureThreshold(IntPtr d, int type, out uint t);
    [DllImport(D)] public static extern int nvmlDeviceGetClockInfo(IntPtr d, int type, out uint mhz);
    [DllImport(D)] public static extern int nvmlDeviceGetMaxClockInfo(IntPtr d, int type, out uint mhz);
    [DllImport(D)] public static extern int nvmlDeviceGetPowerUsage(IntPtr d, out uint mw);
    [DllImport(D)] public static extern int nvmlDeviceGetEnforcedPowerLimit(IntPtr d, out uint mw);
    [DllImport(D)] public static extern int nvmlDeviceGetUtilizationRates(IntPtr d, out Util u);
    [DllImport(D)] public static extern int nvmlDeviceGetMemoryInfo(IntPtr d, out Mem m);
    [DllImport(D)] public static extern int nvmlDeviceGetPerformanceState(IntPtr d, out int p);
    [DllImport(D)] public static extern int nvmlDeviceGetCurrentClocksThrottleReasons(IntPtr d, out ulong r);
    [DllImport(D)] public static extern int nvmlDeviceSetGpuLockedClocks(IntPtr d, uint min, uint max);
    [DllImport(D)] public static extern int nvmlDeviceResetGpuLockedClocks(IntPtr d);
    [DllImport(D)] public static extern int nvmlDeviceSetMemoryLockedClocks(IntPtr d, uint min, uint max);
    [DllImport(D)] public static extern int nvmlDeviceResetMemoryLockedClocks(IntPtr d);

    public static string Err(int r) => r switch
    {
        0 => "ok", 2 => "invalid argument", 3 => "not supported on this GPU", 4 => "needs admin",
        6 => "not found", 9 => "driver not loaded", 15 => "GPU is asleep or lost", _ => "NVML error " + r,
    };
}

// ---------------- NVAPI (undocumented, read-only voltage) ----------------
static class NvApi
{
    [DllImport("nvapi64.dll", EntryPoint = "nvapi_QueryInterface", CallingConvention = CallingConvention.Cdecl)]
    static extern IntPtr QueryInterface(uint id);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int InitFn();
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int EnumFn([Out] IntPtr[] handles, out int count);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int VoltFn(IntPtr gpu, IntPtr status);

    static VoltFn _volt;
    static IntPtr _gpu;
    static bool _tried;

    /// Core voltage in volts via NvAPI_GPU_ClientVoltRailsGetStatus, or null when unavailable.
    public static double? CoreVoltage()
    {
        try
        {
            if (!_tried)
            {
                _tried = true;
                var init = Marshal.GetDelegateForFunctionPointer<InitFn>(QueryInterface(0x0150E828));
                if (init() != 0) return null;
                var en = Marshal.GetDelegateForFunctionPointer<EnumFn>(QueryInterface(0xE5AC921F));
                var hs = new IntPtr[64];
                if (en(hs, out int n) != 0 || n < 1) return null;
                _gpu = hs[0];
                var p = QueryInterface(0x465F9BCF);
                if (p == IntPtr.Zero) return null;
                _volt = Marshal.GetDelegateForFunctionPointer<VoltFn>(p);
            }
            if (_volt == null) return null;
            const int size = 76; // version, flags, 8 reserved, value (uV), 8 reserved
            var buf = Marshal.AllocHGlobal(size);
            try
            {
                for (int i = 0; i < size; i++) Marshal.WriteByte(buf, i, 0);
                Marshal.WriteInt32(buf, 0, size | (1 << 16));
                if (_volt(_gpu, buf) != 0) return null;
                var uv = (uint)Marshal.ReadInt32(buf, 40);
                return uv is > 300_000 and < 1_600_000 ? uv / 1e6 : null;
            }
            finally { Marshal.FreeHGlobal(buf); }
        }
        catch { _volt = null; return null; }
    }
}

// ---------------- Power plans ----------------
static class PowerApi
{
    [DllImport("powrprof.dll")] public static extern uint PowerGetActiveScheme(IntPtr root, out IntPtr guid);
    [DllImport("powrprof.dll")] public static extern uint PowerSetActiveScheme(IntPtr root, ref Guid scheme);
    [DllImport("powrprof.dll")] public static extern uint PowerReadACValueIndex(IntPtr root, ref Guid scheme, ref Guid sub, ref Guid setting, out uint value);
    [DllImport("powrprof.dll")] public static extern uint PowerWriteACValueIndex(IntPtr root, ref Guid scheme, ref Guid sub, ref Guid setting, uint value);
    [DllImport("powrprof.dll")] public static extern uint PowerWriteDCValueIndex(IntPtr root, ref Guid scheme, ref Guid sub, ref Guid setting, uint value);
    [DllImport("powrprof.dll")] public static extern uint PowerGetEffectiveOverlayScheme(out Guid overlay);
    [DllImport("powrprof.dll")] public static extern uint PowerSetActiveOverlayScheme(Guid overlay);
    [DllImport("kernel32.dll")] public static extern IntPtr LocalFree(IntPtr p);

    public static readonly Guid SubProcessor = new("54533251-82be-4824-96c1-47b60b740d00");
    public static readonly Guid ProcThrottleMax = new("bc5038f7-23e0-4960-96da-33abaf5935ec");
    public static readonly Guid ProcThrottleMax1 = new("bc5038f7-23e0-4960-96da-33abaf5935ed"); // E-cores
    public static readonly Guid PerfBoostMode = new("be337238-0d82-4146-a960-4f3749d470c7");

    public static readonly Guid OverlayEfficiency = new("961cc777-2547-4f9d-8174-7d86181b8a7a");
    public static readonly Guid OverlayBalanced = Guid.Empty;
    public static readonly Guid OverlayPerformance = new("ded574b5-45a0-4f42-8737-46345c09c238");

    public static Guid ActiveScheme()
    {
        PowerGetActiveScheme(IntPtr.Zero, out var p);
        var g = Marshal.PtrToStructure<Guid>(p);
        LocalFree(p);
        return g;
    }
}

// ---------------- Memory lists / privileges / process trimming ----------------
static class MemApi
{
    [DllImport("ntdll.dll")] public static extern int NtSetSystemInformation(int infoClass, ref int info, int length);
    public const int SystemMemoryListInformation = 80;
    public const int MemoryEmptyWorkingSets = 2, MemoryFlushModifiedList = 3, MemoryPurgeStandbyList = 4;

    [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", EntryPoint = "K32EmptyWorkingSet")] public static extern bool EmptyWorkingSet(IntPtr h);
    public const uint PROCESS_SET_QUOTA = 0x0100, PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

    [StructLayout(LayoutKind.Sequential)] struct LUID { public uint Low; public int High; }
    [StructLayout(LayoutKind.Sequential)] struct TOKEN_PRIVILEGES { public int Count; public LUID Luid; public int Attributes; }
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr h, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool LookupPrivilegeValue(string sys, string name, out LUID luid);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool AdjustTokenPrivileges(IntPtr token, bool disableAll, ref TOKEN_PRIVILEGES tp, int len, IntPtr prev, IntPtr retLen);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();

    public static bool EnablePrivilege(string name)
    {
        if (!OpenProcessToken(GetCurrentProcess(), 0x0020 | 0x0008, out var tok)) return false;
        try
        {
            if (!LookupPrivilegeValue(null, name, out var luid)) return false;
            var tp = new TOKEN_PRIVILEGES { Count = 1, Luid = luid, Attributes = 2 };
            return AdjustTokenPrivileges(tok, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero) && Marshal.GetLastWin32Error() == 0;
        }
        finally { CloseHandle(tok); }
    }
}

// ---------------- Displays ----------------
static class DisplayApi
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct DISPLAY_DEVICE
    {
        public int cb;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceString;
        public int StateFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceID;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceKey;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct DEVMODE
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
        public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
        public int dmFields;
        public int dmPositionX, dmPositionY, dmDisplayOrientation, dmDisplayFixedOutput;
        public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
        public short dmLogPixels;
        public int dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
        public int dmICMMethod, dmICMIntent, dmMediaType, dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool EnumDisplayDevices(string device, uint devNum, ref DISPLAY_DEVICE dd, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool EnumDisplaySettingsEx(string device, int modeNum, ref DEVMODE dm, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int ChangeDisplaySettingsEx(string device, ref DEVMODE dm, IntPtr hwnd, uint flags, IntPtr lparam);
    [DllImport("user32.dll")] public static extern int SetDisplayConfig(uint numPaths, IntPtr paths, uint numModes, IntPtr modes, uint flags);
    [DllImport("user32.dll")] public static extern int GetDisplayConfigBufferSizes(uint flags, out uint numPaths, out uint numModes);
    [DllImport("user32.dll")] public static extern int QueryDisplayConfig(uint flags, ref uint numPaths, IntPtr paths, ref uint numModes, IntPtr modes, out int topology);

    public const int ENUM_CURRENT_SETTINGS = -1;
    public const uint CDS_UPDATEREGISTRY = 1, CDS_TEST = 2;
    public const int DM_PELSWIDTH = 0x80000, DM_PELSHEIGHT = 0x100000, DM_DISPLAYFREQUENCY = 0x400000;
    public const uint SDC_APPLY = 0x80, QDC_DATABASE_CURRENT = 0x4;

    public static DEVMODE NewMode() => new() { dmSize = (short)Marshal.SizeOf<DEVMODE>() };
    public static DISPLAY_DEVICE NewDevice() => new() { cb = Marshal.SizeOf<DISPLAY_DEVICE>() };
}

// ---------------- Input / windows ----------------
static class UserApi
{
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out int pid);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int pid);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int cmd);
    [DllImport("user32.dll")] public static extern bool LockWorkStation();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder s, int max);

    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public InputUnion u; }
    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);

    public static void Key(byte vk)
    {
        keybd_event(vk, 0, 0, UIntPtr.Zero);
        keybd_event(vk, 0, 2, UIntPtr.Zero);
    }

    // arrows, nav cluster, Windows keys, media keys need the extended flag to mean what they say
    static bool Extended(int vk) => vk is >= 0x21 and <= 0x2E or 0x5B or 0x5C or 0x5D or 0x6F or 0x90 or 0xA3 or 0xA5 || vk is >= 0xA6 and <= 0xB7;

    /// Press a chord: modifiers + key down in order, then release in reverse.
    public static bool Chord(int[] vks)
    {
        var list = new List<INPUT>();
        foreach (var vk in vks) list.Add(Make(vk, false));
        for (int i = vks.Length - 1; i >= 0; i--) list.Add(Make(vks[i], true));
        var arr = list.ToArray();
        return SendInput((uint)arr.Length, arr, Marshal.SizeOf<INPUT>()) == arr.Length;
    }

    static INPUT Make(int vk, bool up) => new()
    {
        type = 1,
        u = new InputUnion { ki = new KEYBDINPUT { wVk = (ushort)vk, dwFlags = (Extended(vk) ? 1u : 0u) | (up ? 2u : 0u) } },
    };

    /// Bring a window forward. The Alt tap satisfies Windows' foreground-lock rules for a background process.
    public static void Focus(IntPtr h)
    {
        if (h == IntPtr.Zero || !IsWindow(h)) return;
        if (IsIconic(h)) ShowWindow(h, 9);
        keybd_event(0x12, 0, 0, UIntPtr.Zero);
        keybd_event(0x12, 0, 2, UIntPtr.Zero);
        SetForegroundWindow(h);
    }
}

// ---------------- Default audio endpoint (undocumented IPolicyConfig, used by the Windows sound panel) ----------------
[ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")] class PolicyConfigClient { }

[ComImport, Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPolicyConfig
{
    [PreserveSig] int GetMixFormat(IntPtr a, IntPtr b);
    [PreserveSig] int GetDeviceFormat(IntPtr a, int b, IntPtr c);
    [PreserveSig] int ResetDeviceFormat(IntPtr a);
    [PreserveSig] int SetDeviceFormat(IntPtr a, IntPtr b, IntPtr c);
    [PreserveSig] int GetProcessingPeriod(IntPtr a, int b, IntPtr c, IntPtr d);
    [PreserveSig] int SetProcessingPeriod(IntPtr a, IntPtr b);
    [PreserveSig] int GetShareMode(IntPtr a, IntPtr b);
    [PreserveSig] int SetShareMode(IntPtr a, IntPtr b);
    [PreserveSig] int GetPropertyValue(IntPtr a, int b, IntPtr c, IntPtr d);
    [PreserveSig] int SetPropertyValue(IntPtr a, int b, IntPtr c, IntPtr d);
    [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
    [PreserveSig] int SetEndpointVisibility(IntPtr a, int b);
}
