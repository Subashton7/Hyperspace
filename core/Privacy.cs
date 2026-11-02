using System.Management;
using System.Runtime.InteropServices;
using Microsoft.Win32;
using NAudio.CoreAudioApi;

namespace HyperCore;

/// Mic / camera: the Windows privacy switch (HKCU ConsentStore), which apps used them and when, mic mute and the
/// camera devices. All read in-process: before this the app ran reg.exe four times plus PowerShell every few seconds.
/// The two consent keys are watched (RegNotifyChangeKeyValue), so a change (an app opening the mic, the switch
/// flipped in Windows Settings) is pushed as a `privacy` event straight away instead of waiting for the next poll.
public sealed class Privacy
{
    const string Consent = @"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore";
    static readonly Dictionary<string, string> KindKey = new() { ["mic"] = "microphone", ["cam"] = "webcam" };
    object _cams;
    long _camsAt;

    public object Get(bool freshCams = false) => new
    {
        mic = new { allow = Allowed("mic"), apps = Usage("mic"), mute = Mute() },
        cam = new { allow = Allowed("cam"), apps = Usage("cam"), devices = Cams(freshCams) },
    };

    static bool Allowed(string kind)
    {
        using var k = Registry.CurrentUser.OpenSubKey($@"{Consent}\{KindKey[kind]}");
        return k?.GetValue("Value") is not string v || v == "Allow"; // no value yet = Windows' default (allowed)
    }

    public object Set(string kind, bool allow)
    {
        if (!KindKey.ContainsKey(kind ?? "")) throw new Exception("unknown device " + kind);
        using var k = Registry.CurrentUser.CreateSubKey($@"{Consent}\{KindKey[kind]}");
        k.SetValue("Value", allow ? "Allow" : "Deny", RegistryValueKind.String);
        return Allowed(kind);
    }

    // Every app that ever touched the device: store apps are direct subkeys, desktop apps sit under NonPackaged
    // (named after their path with # for \). Times are Windows FILETIMEs; stop == 0 means it's in use right now.
    // The list is shaped by src/hardware.js (same as when it parses reg.exe), so both paths look identical.
    static List<object> Usage(string kind)
    {
        var list = new List<object>();
        using var root = Registry.CurrentUser.OpenSubKey($@"{Consent}\{KindKey[kind]}");
        if (root == null) return list;
        void Add(RegistryKey parent, string name)
        {
            using var k = parent.OpenSubKey(name);
            if (k == null) return;
            long start = k.GetValue("LastUsedTimeStart") is long s ? s : 0;
            long? stop = k.GetValue("LastUsedTimeStop") is long e ? e : null; // 0 = in use right now, missing = not recorded
            list.Add(new { key = name, start = Ms(start), stop = stop is { } x ? Ms(x) : (long?)null });
        }
        foreach (var n in root.GetSubKeyNames()) if (n != "NonPackaged") Add(root, n);
        using var np = root.OpenSubKey("NonPackaged");
        if (np != null) foreach (var n in np.GetSubKeyNames()) Add(np, n);
        return list;
    }
    static long Ms(long ft) => ft == 0 ? 0 : ft / 10000 - 11644473600000; // FILETIME (100 ns since 1601) -> unix ms

    // ---------- mic mute (the default recording device, like hw.ps1 did) ----------
    public static object Mute()
    {
        try
        {
            using var en = new MMDeviceEnumerator();
            var d = en.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Console);
            return new { muted = d.AudioEndpointVolume.Mute, level = Math.Round(d.AudioEndpointVolume.MasterVolumeLevelScalar, 3) };
        }
        catch { return new { muted = (bool?)null, level = (double?)null }; } // no microphone
    }

    public static object SetMute(bool muted)
    {
        using var en = new MMDeviceEnumerator();
        en.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Console).AudioEndpointVolume.Mute = muted;
        try { en.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Communications).AudioEndpointVolume.Mute = muted; } catch { }
        return Mute();
    }

    // ---------- camera devices (what Get-PnpDevice -Class Camera, Image -PresentOnly showed) ----------
    // Status is "OK" when enabled; a disabled (hard-killed) camera reads "Error". The WMI query takes ~0.6 s, so it's
    // cached and re-read every 30 s in the background (the answer it replaces is handed out meanwhile).
    int _camsBusy;
    public object Cams(bool fresh = false)
    {
        if (!fresh && _cams != null)
        {
            if (Environment.TickCount64 - _camsAt > 30000 && Interlocked.Exchange(ref _camsBusy, 1) == 0)
                Task.Run(() => { try { ReadCams(); } finally { _camsBusy = 0; } });
            return _cams;
        }
        return ReadCams();
    }

    object ReadCams()
    {
        var list = new List<object>();
        try
        {
            using var s = new ManagementObjectSearcher("SELECT Name, PNPDeviceID, Status FROM Win32_PnPEntity WHERE PNPClass = 'Camera' OR PNPClass = 'Image'");
            foreach (ManagementObject o in s.Get())
                using (o) list.Add(new { name = o["Name"] as string, id = o["PNPDeviceID"] as string, status = o["Status"] as string ?? "Unknown" });
        }
        catch (Exception e) { Log.W("cams: " + e.Message); if (_cams != null) return _cams; }
        _cams = list;
        _camsAt = Environment.TickCount64;
        return list;
    }

    // ---------- change watch ----------
    public void Watch()
    {
        new Thread(() =>
        {
            try
            {
                var keys = KindKey.Values.Select(n => Registry.CurrentUser.CreateSubKey($@"{Consent}\{n}")).ToArray();
                var evs = keys.Select(_ => new AutoResetEvent(false)).ToArray();
                for (int i = 0; i < keys.Length; i++) Arm(keys[i], evs[i]);
                while (true)
                {
                    int i = WaitHandle.WaitAny(evs);
                    Arm(keys[i], evs[i]);
                    // one change is usually several writes (start time, then stop time): send one event for the lot
                    Thread.Sleep(250);
                    for (int j = 0; j < evs.Length; j++) if (evs[j].WaitOne(0)) Arm(keys[j], evs[j]);
                    try { Program.Event("privacy", Get()); } catch (Exception e) { Log.W("privacy event: " + e.Message); }
                }
            }
            catch (Exception e) { Log.W("privacy watch: " + e.Message); } // the app's own poll still covers it
        }) { IsBackground = true, Name = "privacy" }.Start();
    }

    const int REG_NOTIFY_CHANGE_NAME = 1, REG_NOTIFY_CHANGE_LAST_SET = 4;
    static void Arm(RegistryKey k, AutoResetEvent ev) =>
        RegNotifyChangeKeyValue(k.Handle, true, REG_NOTIFY_CHANGE_NAME | REG_NOTIFY_CHANGE_LAST_SET, ev.SafeWaitHandle, true);

    [DllImport("advapi32.dll")]
    static extern int RegNotifyChangeKeyValue(Microsoft.Win32.SafeHandles.SafeRegistryHandle key, bool subtree, int filter, Microsoft.Win32.SafeHandles.SafeWaitHandle ev, bool async);
}
