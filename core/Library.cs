using System.Buffers.Binary;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

namespace HyperCore;

/// CRATE's music library: the rekordbox 6/7 collection with everything rekordbox analysed (BPM, key, rating,
/// colour, play count, hot/memory cues, playlists, the colour waveform and beat grid). Reads a private copy
/// of rekordbox's encrypted master.db, never the live file, so rekordbox is never locked or touched.
public sealed class Library
{
    static readonly string RbDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Pioneer", "rekordbox");
    // rekordbox 6+ encrypts master.db with SQLCipher 4 under this fixed key (the same one pyrekordbox uses)
    const string RbKey = "402fd482c38817c35ffa8ffb8c7d93143b749e7d315df7a81732a1ff43608497";
    static bool _sqlReady;
    readonly object _lock = new();
    object _cache;
    DateTime _stamp;
    Dictionary<string, string> _anlz = new();

    static void InitSql()
    {
        if (_sqlReady) return;
        SQLitePCL.Batteries_V2.Init();
        _sqlReady = true;
    }

    public object Load(bool refresh)
    {
        var db = Path.Combine(RbDir, "master.db");
        if (!File.Exists(db)) return new { ok = false, source = "none", error = "no rekordbox library on this PC", tracks = Array.Empty<object>(), playlists = Array.Empty<object>() };
        var stamp = File.GetLastWriteTimeUtc(db);
        lock (_lock) if (!refresh && _cache != null && stamp == _stamp) return _cache;

        InitSql();
        var tmp = Path.Combine(Path.GetTempPath(), $"hs-rekordbox-{Environment.ProcessId}.db");
        // rekordbox may hold the file open while running: copy with full sharing
        using (var src = new FileStream(db, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
        using (var dst = File.Create(tmp)) src.CopyTo(dst);
        try
        {
            using var c = new SqliteConnection($"Data Source={tmp};Mode=ReadOnly;Pooling=False");
            c.Open();
            Exec(c, $"PRAGMA key = '{RbKey}';");
            var result = Read(c);
            lock (_lock) { _cache = result; _stamp = stamp; }
            return result;
        }
        finally { try { File.Delete(tmp); } catch { } }
    }

    static void Exec(SqliteConnection c, string sql) { using var k = c.CreateCommand(); k.CommandText = sql; k.ExecuteNonQuery(); }

    static IEnumerable<SqliteDataReader> Rows(SqliteConnection c, string sql)
    {
        using var k = c.CreateCommand();
        k.CommandText = sql;
        using var r = k.ExecuteReader();
        while (r.Read()) yield return r;
    }
    static string S(SqliteDataReader r, int i) => r.IsDBNull(i) ? null : r.GetValue(i).ToString();
    static long L(SqliteDataReader r, int i) => r.IsDBNull(i) ? 0 : Convert.ToInt64(r.GetValue(i));

    object Read(SqliteConnection c)
    {
        var share = Path.Combine(RbDir, "share");
        string Abs(string rel) => string.IsNullOrEmpty(rel) ? null : Path.GetFullPath(Path.Combine(share, rel.TrimStart('/', '\\').Replace('/', Path.DirectorySeparatorChar)));

        var colors = new Dictionary<long, object>();
        foreach (var r in Rows(c, "SELECT ID, ColorCode, Commnt FROM djmdColor"))
            colors[L(r, 0)] = new { code = L(r, 1), name = S(r, 2) };

        var cues = new Dictionary<string, List<object>>();
        foreach (var r in Rows(c, "SELECT ContentID, InMsec, OutMsec, Kind, ColorTableIndex, Comment FROM djmdCue WHERE rb_local_deleted = 0 ORDER BY ContentID, InMsec"))
        {
            var id = S(r, 0);
            if (!cues.TryGetValue(id, out var list)) cues[id] = list = new();
            // [ms, kind (0 = memory cue, 1.. = hot cue A..), colour index, comment, loop end ms or -1]
            list.Add(new object[] { L(r, 1), L(r, 3), L(r, 4), S(r, 5) ?? "", r.IsDBNull(2) ? -1 : L(r, 2) });
        }

        var anlz = new Dictionary<string, string>();
        var tracks = new List<object>();
        const string sql = @"SELECT c.ID, c.FolderPath, c.Title, ar.Name, al.Name, g.Name, c.BPM, k.ScaleName, c.Length, c.Rating, c.ColorID,
            c.DJPlayCount, c.ImagePath, c.AnalysisDataPath, c.FileType, c.BitRate, c.SampleRate, c.ReleaseYear, c.Commnt, c.DateCreated,
            lb.Name, rm.Name, c.FileSize
          FROM djmdContent c
          LEFT JOIN djmdArtist ar ON ar.ID = c.ArtistID LEFT JOIN djmdAlbum al ON al.ID = c.AlbumID
          LEFT JOIN djmdGenre g ON g.ID = c.GenreID LEFT JOIN djmdKey k ON k.ID = c.KeyID
          LEFT JOIN djmdLabel lb ON lb.ID = c.LabelID LEFT JOIN djmdArtist rm ON rm.ID = c.RemixerID
          WHERE c.rb_local_deleted = 0";
        foreach (var r in Rows(c, sql))
        {
            var id = S(r, 0);
            var path = S(r, 1)?.Replace('/', Path.DirectorySeparatorChar);
            var ad = S(r, 13);
            if (!string.IsNullOrEmpty(ad)) anlz[id] = Abs(ad);
            var art = Abs(S(r, 12));
            tracks.Add(new
            {
                id, path, exists = path != null && File.Exists(path),
                title = S(r, 2), artist = S(r, 3), album = S(r, 4), genre = S(r, 5),
                bpm = L(r, 6) / 100.0, key = S(r, 7), len = L(r, 8), rating = L(r, 9), color = L(r, 10), plays = L(r, 11),
                art = art != null && File.Exists(art) ? art : null, wave = !string.IsNullOrEmpty(ad),
                type = L(r, 14), bitrate = L(r, 15), rate = L(r, 16), year = L(r, 17), comment = S(r, 18), added = S(r, 19),
                label = S(r, 20), remixer = S(r, 21), size = L(r, 22),
                cues = cues.TryGetValue(id, out var cl) ? cl : null,
            });
        }

        var songs = new Dictionary<string, List<string>>();
        foreach (var r in Rows(c, "SELECT PlaylistID, ContentID FROM djmdSongPlaylist WHERE rb_local_deleted = 0 ORDER BY PlaylistID, TrackNo"))
        {
            var pid = S(r, 0);
            if (!songs.TryGetValue(pid, out var l)) songs[pid] = l = new();
            l.Add(S(r, 1));
        }
        var playlists = new List<object>();
        foreach (var r in Rows(c, "SELECT ID, Name, ParentID, Attribute, Seq FROM djmdPlaylist WHERE rb_local_deleted = 0 ORDER BY ParentID, Seq"))
        {
            var id = S(r, 0);
            // attribute: 0 playlist, 1 folder, 4 smart playlist (its rules aren't evaluated here)
            playlists.Add(new { id, name = S(r, 1), parent = S(r, 2), kind = L(r, 3), seq = L(r, 4), tracks = songs.TryGetValue(id, out var l) ? l : new List<string>() });
        }

        var history = new List<object>();
        try
        {
            var hs = new Dictionary<string, List<string>>();
            foreach (var r in Rows(c, "SELECT HistoryID, ContentID FROM djmdSongHistory WHERE rb_local_deleted = 0 ORDER BY HistoryID, TrackNo"))
            {
                var hid = S(r, 0);
                if (!hs.TryGetValue(hid, out var l)) hs[hid] = l = new();
                l.Add(S(r, 1));
            }
            foreach (var r in Rows(c, "SELECT ID, Name, DateCreated FROM djmdHistory WHERE rb_local_deleted = 0 ORDER BY DateCreated DESC LIMIT 30"))
                if (hs.TryGetValue(S(r, 0), out var l)) history.Add(new { id = S(r, 0), name = S(r, 1), date = S(r, 2), tracks = l });
        }
        catch (Exception e) { Log.W("library history: " + e.Message); }

        _anlz = anlz;
        return new { ok = true, source = "rekordbox", db = Path.Combine(RbDir, "master.db"), loaded = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), colors, tracks, playlists, history };
    }

    // ---------------- track features for DOUBLES and transitions ----------------
    /// Per track, from rekordbox's colour waveform + beat grid: bar count, the first two drops (bar index,
    /// snapped to the 8-bar phrase), when the music really ends (for crossfades), loudness and its colour mix.
    /// Cached on disk by analysis-file timestamp, so only new or re-analysed tracks are read again.
    public object Features(bool refresh)
    {
        if (_anlz.Count == 0) Load(false);
        var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "HYPERSPACE");
        var file = Path.Combine(dir, "crate-features.json");
        Dictionary<string, JsonElement> cache = new();
        if (!refresh) try { cache = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(File.ReadAllText(file)) ?? new(); } catch { }
        var outp = new System.Collections.Concurrent.ConcurrentDictionary<string, object>();
        Parallel.ForEach(_anlz, new ParallelOptions { MaxDegreeOfParallelism = 4 }, kv =>
        {
            try
            {
                var ext = Path.ChangeExtension(kv.Value, ".EXT");
                if (!File.Exists(ext) || !File.Exists(kv.Value)) return;
                long stamp = File.GetLastWriteTimeUtc(ext).Ticks;
                // reused while neither the analysis nor the drop model (retrained by your corrections) changed
                if (cache.TryGetValue(kv.Key, out var c) && c.TryGetProperty("st", out var s) && s.GetInt64() == stamp
                    && c.TryGetProperty("mv", out var mv) && mv.GetInt32() == DropModel.Version) { outp[kv.Key] = c; return; }
                var f = Analyse(kv.Key, kv.Value, ext);
                if (f != null) outp[kv.Key] = f with { st = stamp, mv = DropModel.Version };
            }
            catch { }
        });
        try { Directory.CreateDirectory(dir); File.WriteAllText(file, JsonSerializer.Serialize(outp)); } catch (Exception e) { Log.W("features cache: " + e.Message); }
        return outp;
    }

    // d1 / d2: drop bar indexes; fx1 / fx2: that drop is your correction; mv: drop-model version it was scored with
    public record Feat(int bars, int d1, int d2, int d1ms, int d2ms, bool fx1, bool fx2, int endMs, int e, int lo, int mi, int hi, double bpm, long st, int mv);

    readonly System.Collections.Concurrent.ConcurrentDictionary<string, DropModel.Bars> _bars = new();
    internal static IEnumerable<(string tag, ReadOnlyMemory<byte> body, ReadOnlyMemory<byte> hdr)> SectionsOf(byte[] f) => Sections(f);

    /// a track's per-bar summary (kept in memory: re-scoring after a correction doesn't re-read every file)
    public DropModel.Bars BarsFor(string id)
    {
        if (_anlz.Count == 0) Load(false);
        if (_bars.TryGetValue(id, out var b)) return b;
        if (id == null || !_anlz.TryGetValue(id, out var dat) || dat == null) return null;
        var ext = Path.ChangeExtension(dat, ".EXT");
        if (!File.Exists(ext) || !File.Exists(dat)) return null;
        b = DropModel.Read(dat, ext);
        if (b != null) _bars[id] = b;
        return b;
    }

    Feat Analyse(string id, string dat, string ext)
    {
        var t = BarsFor(id);
        if (t == null) return null;
        var bars = t.ms; var E = t.E; var R = t.R; var G = t.G; var B = t.B;
        int nb = bars.Length;
        double max = E.Max();
        var (d1, d2, _, _) = DropModel.Find(t, DropModel.Weights);
        int d1ms = d1 >= 0 ? bars[d1] : -1, d2ms = d2 >= 0 ? bars[d2] : -1;
        // your corrections win
        var fx = DropModel.FixFor(id);
        bool fx1 = false, fx2 = false;
        int Bar(int ms) { int k = 0; for (int i = 1; i < nb; i++) if (Math.Abs(bars[i] - ms) < Math.Abs(bars[k] - ms)) k = i; return k; }
        if (fx?.d1 > 0) { d1ms = fx.d1; d1 = Bar(fx.d1); fx1 = true; if (d2 >= 0 && d2 < d1 + 16) { d2 = -1; d2ms = -1; } }
        if (fx?.d2 > 0) { d2ms = fx.d2; d2 = Bar(fx.d2); fx2 = true; }
        int last = nb - 1;
        while (last > 0 && E[last] < max * 0.3) last--;
        int endMs = last + 1 < nb ? bars[last + 1] : bars[last] + 2000;
        // loudness and colour of the drop section (or the loudest bars if no drop was found)
        var idx = d1 > 0 ? Enumerable.Range(d1, Math.Min(16, nb - d1)) : Enumerable.Range(0, nb).OrderByDescending(i => E[i]).Take(16);
        double er = 0, eg = 0, eb = 0, ee = 0; int m = 0;
        foreach (var i in idx) { er += R[i]; eg += G[i]; eb += B[i]; ee += E[i]; m++; }
        double tot = Math.Max(0.001, er + eg + eb);
        return new Feat(nb, d1, d2, d1ms, d2ms, fx1, fx2, endMs, (int)Math.Round(ee / Math.Max(1, m) / 31 * 100),
            (int)Math.Round(er / tot * 100), (int)Math.Round(eg / tot * 100), (int)Math.Round(eb / tot * 100), t.bpm, 0, 0);
    }

    // ---------------- ANLZ: rekordbox's analysis files (big-endian tagged sections) ----------------
    /// Colour waveform for the seek bar, `cols` columns of [r, g, b, height] (0-255), plus the beat grid
    /// [[ms, beat-in-bar, bpm], ...]. From PWV5 (colour detail, 150 entries/s), falling back to PWV3 (mono
    /// detail) or PWAV (400-column preview).
    public object Wave(string id, int cols)
    {
        if (cols <= 0 || cols > 80000) cols = 1200; // the DJ decks ask for ~75 columns a second
        if (_anlz.Count == 0) Load(false);
        if (id == null || !_anlz.TryGetValue(id, out var dat) || dat == null) return new { ok = false, error = "not analysed in rekordbox" };
        var ext = Path.ChangeExtension(dat, ".EXT");
        byte[] cells = null;
        string kind = null;
        var beats = new List<object>();
        try
        {
            if (File.Exists(ext))
                foreach (var (tag, body, hdr) in Sections(File.ReadAllBytes(ext)))
                {
                    if (tag == "PWV5") { cells = Pwv5(body, hdr, cols); kind = "color"; break; }
                    if (tag == "PWV3" && cells == null) { cells = Mono(body, hdr, cols, 1); kind = "mono"; }
                }
            if (File.Exists(dat))
                foreach (var (tag, body, hdr) in Sections(File.ReadAllBytes(dat)))
                {
                    if (tag == "PQTZ") beats = Grid(body, hdr);
                    if (tag == "PWAV" && cells == null) { cells = Mono(body, hdr, cols, 0); kind = "preview"; }
                }
        }
        catch (Exception e) { return new { ok = false, error = e.Message }; }
        if (cells == null) return new { ok = false, error = "no waveform in the analysis file", beats };
        return new { ok = true, kind, cols, data = Convert.ToBase64String(cells), beats };
    }

    static IEnumerable<(string tag, ReadOnlyMemory<byte> body, ReadOnlyMemory<byte> hdr)> Sections(byte[] f)
    {
        if (f.Length < 12 || f[0] != 'P' || f[1] != 'M' || f[2] != 'A' || f[3] != 'I') yield break;
        int pos = (int)BinaryPrimitives.ReadUInt32BigEndian(f.AsSpan(4));
        while (pos + 12 <= f.Length)
        {
            var tag = System.Text.Encoding.ASCII.GetString(f, pos, 4);
            int lh = (int)BinaryPrimitives.ReadUInt32BigEndian(f.AsSpan(pos + 4));
            int lt = (int)BinaryPrimitives.ReadUInt32BigEndian(f.AsSpan(pos + 8));
            if (lt < 12 || lh < 12 || pos + lt > f.Length) yield break;
            yield return (tag, new ReadOnlyMemory<byte>(f, pos + lh, lt - lh), new ReadOnlyMemory<byte>(f, pos, lh));
            pos += lt;
        }
    }

    // PWV5: 2 bytes per entry: red 3 bits, green 3, blue 3, height 5, 2 unused
    static byte[] Pwv5(ReadOnlyMemory<byte> body, ReadOnlyMemory<byte> hdr, int cols)
    {
        var b = body.Span;
        int n = b.Length / 2;
        var outp = new byte[cols * 4];
        if (n == 0) return outp;
        for (int c = 0; c < cols; c++)
        {
            int a = (int)((long)c * n / cols), e = Math.Max(a + 1, (int)((long)(c + 1) * n / cols));
            double r = 0, g = 0, bl = 0, wsum = 0; int hmax = 0;
            for (int i = a; i < e && i < n; i++)
            {
                int v = (b[i * 2] << 8) | b[i * 2 + 1];
                int h = (v >> 2) & 31;
                double w = h + 1;
                r += ((v >> 13) & 7) * w; g += ((v >> 10) & 7) * w; bl += ((v >> 7) & 7) * w; wsum += w;
                if (h > hmax) hmax = h;
            }
            outp[c * 4] = (byte)(r / wsum * 255 / 7);
            outp[c * 4 + 1] = (byte)(g / wsum * 255 / 7);
            outp[c * 4 + 2] = (byte)(bl / wsum * 255 / 7);
            outp[c * 4 + 3] = (byte)(hmax * 255 / 31);
        }
        return outp;
    }

    // PWV3 / PWAV: 1 byte per entry: height 5 bits, whiteness 3 bits. PWAV's header is 4 bytes shorter.
    static byte[] Mono(ReadOnlyMemory<byte> body, ReadOnlyMemory<byte> hdr, int cols, int _)
    {
        var b = body.Span;
        int n = b.Length;
        var outp = new byte[cols * 4];
        if (n == 0) return outp;
        for (int c = 0; c < cols; c++)
        {
            int a = (int)((long)c * n / cols), e = Math.Max(a + 1, (int)((long)(c + 1) * n / cols));
            int hmax = 0, white = 0;
            for (int i = a; i < e && i < n; i++) { int h = b[i] & 31; if (h > hmax) { hmax = h; white = b[i] >> 5; } }
            byte lum = (byte)(120 + white * 19);
            outp[c * 4] = (byte)(lum / 3); outp[c * 4 + 1] = lum; outp[c * 4 + 2] = (byte)(lum / 2);
            outp[c * 4 + 3] = (byte)(hmax * 255 / 31);
        }
        return outp;
    }

    // PQTZ: 8 bytes per beat: beat in bar (1-4), tempo (bpm x100), time (ms)
    static List<object> Grid(ReadOnlyMemory<byte> body, ReadOnlyMemory<byte> hdr)
    {
        var h = hdr.Span;
        var b = body.Span;
        int count = h.Length >= 24 ? (int)BinaryPrimitives.ReadUInt32BigEndian(h.Slice(20)) : b.Length / 8;
        var list = new List<object>(count);
        for (int i = 0; i < count && (i + 1) * 8 <= b.Length; i++)
        {
            var s = b.Slice(i * 8);
            list.Add(new object[] { BinaryPrimitives.ReadUInt32BigEndian(s.Slice(4)), BinaryPrimitives.ReadUInt16BigEndian(s), BinaryPrimitives.ReadUInt16BigEndian(s.Slice(2)) / 100.0 });
        }
        return list;
    }

    /// `HyperCore --library`: print a summary (for testing without the app).
    public static int Cli(string[] args)
    {
        try
        {
            var lib = new Library();
            var res = lib.Load(true);
            var j = JsonSerializer.SerializeToNode(res);
            var tracks = j["tracks"].AsArray();
            Console.WriteLine($"source={j["source"]} tracks={tracks.Count} playlists={j["playlists"].AsArray().Count} history={j["history"].AsArray().Count}");
            Console.WriteLine($"missing files={tracks.Count(t => !(bool)t["exists"])} with waveform={tracks.Count(t => (bool)t["wave"])} with art={tracks.Count(t => t["art"] != null)} with cues={tracks.Count(t => t["cues"] != null)}");
            foreach (var t in tracks.Take(3)) Console.WriteLine($"  {t["title"]} | {t["artist"]} | {t["bpm"]} | {t["key"]} | {t["len"]}s | cues {t["cues"]?.AsArray().Count ?? 0}");
            var withWave = tracks.FirstOrDefault(t => (bool)t["wave"]);
            if (withWave != null)
            {
                var w = JsonSerializer.SerializeToNode(lib.Wave((string)withWave["id"], 400));
                var data = w["data"] != null ? Convert.FromBase64String((string)w["data"]) : Array.Empty<byte>();
                Console.WriteLine($"wave ok={w["ok"]} kind={w["kind"]} bytes={data.Length} beats={w["beats"]?.AsArray().Count} first={w["beats"]?.AsArray().FirstOrDefault()?.ToJsonString()} sample={string.Join(",", data.Skip(800).Take(12))}");
            }
            var sw = System.Diagnostics.Stopwatch.StartNew();
            var feats = JsonSerializer.SerializeToNode(lib.Features(args.Contains("--refresh"))).AsObject();
            Console.WriteLine($"features: {feats.Count} tracks in {sw.ElapsedMilliseconds} ms · with a drop: {feats.Count(kv => (int)kv.Value["d1"] > 0)}");
            foreach (var t in tracks.Take(4)) if (feats[(string)t["id"]] is JsonNode f) Console.WriteLine($"  {t["title"]}: {f.ToJsonString()}");
            return 0;
        }
        catch (Exception e) { Console.WriteLine("ERROR " + e); return 1; }
    }
}
