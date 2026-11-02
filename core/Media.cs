using System.Diagnostics;
using NAudio.CoreAudioApi;
using NAudio.Dsp;
using NAudio.Wave;

namespace HyperCore;

/// WASAPI loopback (what the laptop is playing) or any input -> FFT -> bass/mid/treble + spectrum + beats at ~60 Hz.
public sealed class AudioEngine
{
    const int N = 2048, M = 11, Bins = 48;
    static readonly Guid IeeeFloat = new("00000003-0000-0010-8000-00aa00389b71"); // KSDATAFORMAT_SUBTYPE_IEEE_FLOAT
    readonly float[] _ring = new float[N * 4];
    int _w;
    readonly object _l = new();
    IWaveIn _cap;
    int _sr = 48000;
    long _lastData;
    Thread _thread;
    volatile bool _run;
    public string Source = "default", Error;

    // analysis state
    readonly double[] _peak = new double[4];
    readonly double[] _smooth = new double[4];
    double _specPeak = 1e-3;
    readonly Queue<double> _bassHist = new();
    long _lastBeat;
    int _beatCount;

    public bool Running => _run;
    readonly object _startLock = new();
    int _gen;

    public void Start(string source)
    {
        lock (_startLock) StartInner(source);
    }

    public void Stop()
    {
        lock (_startLock) StopInner();
    }

    void StartInner(string source)
    {
        StopInner();
        Source = source ?? "default";
        try
        {
            var en = new MMDeviceEnumerator();
            if (Source.StartsWith("capture:")) _cap = new WasapiCapture(en.GetDevice(Source[8..]));
            else if (Source.StartsWith("render:")) _cap = new WasapiLoopbackCapture(en.GetDevice(Source[7..]));
            else _cap = new WasapiLoopbackCapture();
            _sr = _cap.WaveFormat.SampleRate;
            _cap.DataAvailable += OnData;
            _cap.RecordingStopped += (_, e) => { if (e.Exception != null) Error = e.Exception.Message; };
            _cap.StartRecording();
            Error = null;
        }
        catch (Exception e) { Error = e.Message; _cap = null; Log.W("audio start: " + e.Message); }
        _run = true;
        int gen = ++_gen;
        _bassHist.Clear();
        _thread = new Thread(() => Loop(gen)) { IsBackground = true, Priority = ThreadPriority.AboveNormal, Name = "fft" };
        _thread.Start();
    }

    void StopInner()
    {
        _run = false;
        _thread?.Join(1000);
        _thread = null;
        try { _cap?.StopRecording(); _cap?.Dispose(); } catch { }
        _cap = null;
    }

    void OnData(object s, WaveInEventArgs e)
    {
        var wf = _cap.WaveFormat;
        int ch = Math.Max(1, wf.Channels), bits = wf.BitsPerSample;
        bool isFloat = wf.Encoding == WaveFormatEncoding.IeeeFloat ||
                       (wf is WaveFormatExtensible x && x.SubFormat == IeeeFloat);
        int bps = bits / 8, frame = bps * ch, frames = e.BytesRecorded / frame;
        lock (_l)
        {
            for (int i = 0; i < frames; i++)
            {
                float sum = 0;
                for (int c = 0; c < ch; c++)
                {
                    int o = i * frame + c * bps;
                    sum += isFloat && bits == 32 ? BitConverter.ToSingle(e.Buffer, o)
                         : bits == 16 ? BitConverter.ToInt16(e.Buffer, o) / 32768f
                         : bits == 24 ? ((e.Buffer[o] | (e.Buffer[o + 1] << 8) | ((sbyte)e.Buffer[o + 2] << 16)) / 8388608f)
                         : bits == 32 ? BitConverter.ToInt32(e.Buffer, o) / 2147483648f : 0;
                }
                _ring[_w] = sum / ch;
                _w = (_w + 1) % _ring.Length;
            }
        }
        _lastData = Stopwatch.GetTimestamp();
    }

    void Loop(int gen)
    {
        try { Analyze(gen); }
        catch (Exception e) { Log.W("fft loop: " + e); }
    }

    void Analyze(int gen)
    {
        var buf = new Complex[N];
        var mags = new double[N / 2];
        var spec = new int[Bins];
        var binv = new double[Bins];
        var win = new double[N];
        for (int i = 0; i < N; i++) win[i] = 0.5 * (1 - Math.Cos(2 * Math.PI * i / (N - 1)));
        var sw = Stopwatch.StartNew();
        long next = 0;
        while (_run && gen == _gen)
        {
            next += 16;
            var wait = next - sw.ElapsedMilliseconds;
            if (wait > 0) Thread.Sleep((int)wait); else if (wait < -100) next = sw.ElapsedMilliseconds;

            // WASAPI loopback delivers nothing while the system is silent: treat that as zeros.
            bool silent = Stopwatch.GetElapsedTime(_lastData).TotalMilliseconds > 150;
            lock (_l)
            {
                for (int i = 0; i < N; i++)
                {
                    float v = silent ? 0 : _ring[(_w - N + i + _ring.Length) % _ring.Length];
                    buf[i].X = (float)(v * win[i]);
                    buf[i].Y = 0;
                }
            }
            FastFourierTransform.FFT(true, M, buf);
            for (int i = 0; i < N / 2; i++) mags[i] = Math.Sqrt(buf[i].X * buf[i].X + buf[i].Y * buf[i].Y);

            double hz = _sr / (double)N;
            double Band(double lo, double hi)
            {
                int a = Math.Max(1, (int)(lo / hz)), b = Math.Min(N / 2 - 1, (int)(hi / hz));
                double s = 0;
                for (int i = a; i <= b; i++) s += mags[i] * mags[i];
                return Math.Sqrt(s / Math.Max(1, b - a + 1));
            }
            var raw = new[] { Band(20, 250), Band(250, 4000), Band(4000, 16000), 0 };
            raw[3] = (raw[0] + raw[1] + raw[2]) / 3;

            var outv = new double[4];
            for (int k = 0; k < 4; k++)
            {
                _peak[k] = Math.Max(Math.Max(raw[k], _peak[k] * 0.9985), 2e-4); // slow auto-gain
                var n = Math.Min(1, raw[k] / _peak[k]);
                _smooth[k] += (n - _smooth[k]) * (n > _smooth[k] ? 0.6 : 0.18);
                outv[k] = Math.Round(_smooth[k], 3);
            }

            // log-spaced spectrum 30 Hz .. 16 kHz
            double maxBin = 0;
            for (int b = 0; b < Bins; b++)
            {
                double lo = 30 * Math.Pow(16000 / 30.0, b / (double)Bins), hi = 30 * Math.Pow(16000 / 30.0, (b + 1) / (double)Bins);
                int i0 = Math.Max(1, (int)(lo / hz)), i1 = Math.Max(i0, Math.Min(N / 2 - 1, (int)(hi / hz)));
                double m = 0;
                for (int i = i0; i <= i1; i++) m = Math.Max(m, mags[i]);
                binv[b] = m;
                maxBin = Math.Max(maxBin, m);
            }
            _specPeak = Math.Max(Math.Max(maxBin, _specPeak * 0.998), 2e-4);
            for (int b = 0; b < Bins; b++) spec[b] = (int)Math.Round(255 * Math.Min(1, Math.Sqrt(binv[b] / _specPeak)));

            // beat: bass jumps above its recent average
            _bassHist.Enqueue(raw[0]);
            if (_bassHist.Count > 43) _bassHist.Dequeue();
            double avg = _bassHist.Average();
            bool beat = false;
            long now = sw.ElapsedMilliseconds;
            if (!silent && raw[0] > avg * 1.35 && outv[0] > 0.35 && now - _lastBeat > 280) { beat = true; _lastBeat = now; _beatCount++; }

            Program.Event("audio", new { b = outv, s = spec, beat, n = _beatCount, silent });
        }
    }
}

public sealed class AudioDevices
{
    public object List()
    {
        using var en = new MMDeviceEnumerator();
        string defOut = null, defIn = null;
        try { defOut = en.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia).ID; } catch { }
        try { defIn = en.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Multimedia).ID; } catch { }
        object Map(MMDevice d, string def) => new { id = d.ID, name = d.FriendlyName, kind = Kind(d.FriendlyName), isDefault = d.ID == def };
        var outs = en.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active).Select(d => Map(d, defOut)).ToList();
        var ins = en.EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active).Select(d => Map(d, defIn)).ToList();
        return new { outputs = outs, inputs = ins };
    }

    static string Kind(string n)
    {
        n = n.ToLowerInvariant();
        string[] bt = { "bluetooth", "hands-free", "airpods", "buds", "bt ", "jbl", "bose", "beats", "flip", "charge", "boom", "sony wh", "wf-", "soundlink", "marshall", "ultimate ears" };
        if (bt.Any(n.Contains)) return "bluetooth";
        if (n.Contains("voicemeeter") || n.Contains("cable") || n.Contains("virtual")) return "virtual";
        if (n.Contains("headphone") || n.Contains("headset")) return "headphones";
        if (n.Contains("hdmi") || n.Contains("display") || n.Contains("nvidia") || n.Contains("monitor")) return "display";
        if (n.Contains("speaker") || n.Contains("realtek")) return "speakers";
        return "interface";
    }

    public void SetDefault(string id)
    {
        var pc = (IPolicyConfig)new PolicyConfigClient();
        for (int role = 0; role < 3; role++) pc.SetDefaultEndpoint(id, role);
    }

    public object Volume()
    {
        using var en = new MMDeviceEnumerator();
        var d = en.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
        return new { level = Math.Round(d.AudioEndpointVolume.MasterVolumeLevelScalar, 3), muted = d.AudioEndpointVolume.Mute, device = d.FriendlyName };
    }

    public object SetVolume(double? level, bool? muted)
    {
        using var en = new MMDeviceEnumerator();
        var d = en.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
        if (level != null) d.AudioEndpointVolume.MasterVolumeLevelScalar = (float)Math.Clamp(level.Value, 0, 1);
        if (muted != null) d.AudioEndpointVolume.Mute = muted.Value;
        return Volume();
    }

    /// Processes with an active (sounding) audio session - protected from the RAM vacuum.
    public HashSet<int> PlayingPids()
    {
        var set = new HashSet<int>();
        try
        {
            using var en = new MMDeviceEnumerator();
            foreach (var dev in en.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active))
            {
                var sessions = dev.AudioSessionManager.Sessions;
                for (int i = 0; i < sessions.Count; i++)
                    if (sessions[i].State == NAudio.CoreAudioApi.Interfaces.AudioSessionState.AudioSessionStateActive)
                        set.Add((int)sessions[i].GetProcessID);
            }
        }
        catch { }
        return set;
    }
}

/// Now-playing + transport via the Windows media session API, with media keys as a fallback.
public sealed class MediaControl
{
    Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager _mgr;
    string _last;

    async Task<Windows.Media.Control.GlobalSystemMediaTransportControlsSession> Session()
    {
        try
        {
            _mgr ??= await Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
            return _mgr.GetCurrentSession();
        }
        catch { return null; }
    }

    public async Task<object> Get()
    {
        var s = await Session();
        if (s == null) return new { available = false };
        try
        {
            var p = await s.TryGetMediaPropertiesAsync();
            var pb = s.GetPlaybackInfo();
            return new
            {
                available = true, title = p.Title, artist = p.Artist, album = p.AlbumTitle,
                app = s.SourceAppUserModelId, status = pb.PlaybackStatus.ToString().ToLowerInvariant(),
            };
        }
        catch { return new { available = false }; }
    }

    public async Task<object> Command(string action)
    {
        var s = await Session();
        bool ok = false;
        try
        {
            if (s != null)
                ok = action switch
                {
                    "toggle" => await s.TryTogglePlayPauseAsync(),
                    "next" => await s.TrySkipNextAsync(),
                    "prev" => await s.TrySkipPreviousAsync(),
                    _ => false,
                };
        }
        catch { }
        if (!ok)
        {
            byte vk = action switch { "next" => 0xB0, "prev" => 0xB1, _ => 0xB3 };
            UserApi.Key(vk);
        }
        await Task.Delay(250);
        return await Get();
    }

    /// Push now-playing changes to the app.
    public async Task Poll()
    {
        var info = await Get();
        var key = System.Text.Json.JsonSerializer.Serialize(info);
        if (key != _last) { _last = key; Program.Event("media", info); }
    }
}
