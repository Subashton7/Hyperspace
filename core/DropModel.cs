using System.Buffers.Binary;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace HyperCore;

/// Finds drops. Every bar of a track is a candidate, described by a handful of clues read from rekordbox's
/// colour waveform and beat grid: how much louder it gets, the quiet build-up just before, whether it lands on
/// a 16 / 8 / 4-bar phrase line, how long it stays loud, the shift in the waveform's colour (the bass coming in),
/// whether anything that loud came before, and where in the track it sits. A weighted sum of the clues scores
/// each bar; the best one is DROP 1, the best one well after it is DROP 2.
///
/// The weights learn. Each correction you make (SET DROP on a deck) is stored, your exact spot is used for that
/// track from then on, and the weights are retrained so the bar you picked outranks the ones the finder
/// preferred, nudging every other track's result the same way. Files (in %LOCALAPPDATA%\HYPERSPACE):
/// drop-model.json (weights) and drop-corrections.json ({ trackId: { d1, d2 } in ms }).
public static class DropModel
{
    public static readonly string[] Names = { "bias", "jump", "loud", "dip", "p16", "p8", "p4", "pos", "early", "sustain", "dR", "dG", "dB", "novelty", "late" };
    // starting weights, set by hand from reading dubstep / bass tracks bar by bar (--drops-eval --verbose)
    static readonly double[] W0 = { -0.5, 3.0, 1.5, 1.2, 0.8, 0.5, 0.15, -0.4, -1.2, 1.0, 0.3, 0.0, -0.3, -1.4, -1.0 };

    static readonly string Dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "HYPERSPACE");
    static readonly string ModelFile = Path.Combine(Dir, "drop-model.json"), FixFile = Path.Combine(Dir, "drop-corrections.json");
    static readonly object L = new();
    static double[] _w;
    static int _version;
    static Dictionary<string, Fix> _fixes;

    public record Fix(int d1, int d2);
    /// per-bar summary of one track
    public sealed record Bars(int[] ms, double[] E, double[] R, double[] G, double[] B, double bpm);

    public static int Version { get { Ensure(); return _version; } }
    public static double[] Weights { get { Ensure(); return _w; } }

    static void Ensure()
    {
        lock (L)
        {
            if (_w != null) return;
            _w = (double[])W0.Clone();
            _version = 1;
            try
            {
                var j = JsonNode.Parse(File.ReadAllText(ModelFile));
                var w = j["w"].AsArray().Select(x => (double)x).ToArray();
                if (w.Length == W0.Length) { _w = w; _version = (int)j["v"]; }
            }
            catch { }
            _fixes = new();
            try { _fixes = JsonSerializer.Deserialize<Dictionary<string, Fix>>(File.ReadAllText(FixFile)) ?? new(); } catch { }
        }
    }

    public static Fix FixFor(string id) { Ensure(); lock (L) return _fixes.TryGetValue(id, out var f) ? f : null; }
    public static int FixCount { get { Ensure(); lock (L) return _fixes.Count; } }

    // ---------------- reading ----------------
    public static Bars Read(string dat, string ext)
    {
        byte[] wave = null;
        foreach (var (tag, body, _) in Library.SectionsOf(File.ReadAllBytes(ext))) if (tag == "PWV5") { wave = body.ToArray(); break; }
        var beats = new List<(uint ms, int beat, double bpm)>();
        foreach (var (tag, body, hdr) in Library.SectionsOf(File.ReadAllBytes(dat)))
            if (tag == "PQTZ")
            {
                var h = hdr.Span; var b = body.Span;
                int count = h.Length >= 24 ? (int)BinaryPrimitives.ReadUInt32BigEndian(h.Slice(20)) : b.Length / 8;
                for (int i = 0; i < count && (i + 1) * 8 <= b.Length; i++)
                {
                    var x = b.Slice(i * 8);
                    beats.Add((BinaryPrimitives.ReadUInt32BigEndian(x.Slice(4)), BinaryPrimitives.ReadUInt16BigEndian(x), BinaryPrimitives.ReadUInt16BigEndian(x.Slice(2)) / 100.0));
                }
            }
        if (wave == null || wave.Length < 300 || beats.Count < 16) return null;
        int n = wave.Length / 2;
        var bars = beats.Where(b => b.beat == 1).Select(b => (int)b.ms).ToArray();
        if (bars.Length < 8) return null;
        int nb = bars.Length;
        var E = new double[nb]; var R = new double[nb]; var G = new double[nb]; var B = new double[nb];
        for (int i = 0; i < nb; i++)
        {
            int a = (int)(bars[i] * 0.15), z = Math.Min(n, i + 1 < nb ? (int)(bars[i + 1] * 0.15) : a + 300);
            double sum = 0, r = 0, g = 0, bl = 0; int cnt = 0;
            for (int k = Math.Max(0, a); k < z; k++)
            {
                int v = (wave[k * 2] << 8) | wave[k * 2 + 1];
                int hgt = (v >> 2) & 31;
                sum += hgt; r += ((v >> 13) & 7) * hgt; g += ((v >> 10) & 7) * hgt; bl += ((v >> 7) & 7) * hgt; cnt++;
            }
            E[i] = cnt > 0 ? sum / cnt : 0;
            double w = Math.Max(1, sum); R[i] = r / w; G[i] = g / w; B[i] = bl / w;
        }
        return new Bars(bars, E, R, G, B, beats[beats.Count / 2].bpm);
    }

    // ---------------- clues ----------------
    static double Mean(double[] a, int from, int to) { from = Math.Max(0, from); to = Math.Min(a.Length, to); double s = 0; for (int i = from; i < to; i++) s += a[i]; return to > from ? s / (to - from) : 0; }

    public static double[] Clues(Bars t, int b)
    {
        int nb = t.E.Length;
        double mx = Math.Max(1e-6, t.E.Max());
        double pre8 = Mean(t.E, b - 8, b), post4 = Mean(t.E, b, b + 4), pre2 = Mean(t.E, b - 2, b), post16 = Mean(t.E, b, b + 16);
        int louder = 0;
        for (int i = 0; i < b; i++) if (t.E[i] >= post4 * 0.92) louder++;
        return new double[]
        {
            1,
            (post4 - pre8) / mx,
            post4 / mx,
            Math.Max(0, Mean(t.E, b - 8, b - 3) - pre2) / mx,
            Ph(b, 16), Ph(b, 8), Ph(b, 4),
            (double)b / nb,
            b < 16 ? 1 : 0,
            post16 / mx,
            (Mean(t.R, b, b + 4) - Mean(t.R, b - 8, b)) / 7, (Mean(t.G, b, b + 4) - Mean(t.G, b - 8, b)) / 7, (Mean(t.B, b, b + 4) - Mean(t.B, b - 8, b)) / 7,
            b > 0 ? (double)louder / b : 0,
            b > nb * 0.8 ? 1 : 0,
        };
    }

    static double Ph(int x, int n) => ((x % n) + n) % n == 0 ? 1 : 0;

    static double Dot(double[] w, double[] f) { double s = 0; for (int i = 0; i < w.Length; i++) s += w[i] * f[i]; return s; }

    // a candidate must actually get louder
    static bool Rises(Bars t, int b) => Mean(t.E, b, b + 4) > Mean(t.E, b - 8, b) * 1.08;

    /// DROP 1 and DROP 2 as bar indexes (-1 = none), by the given weights
    public static (int d1, int d2, double s1, double s2) Find(Bars t, double[] w)
    {
        int nb = t.E.Length;
        int d1 = -1; double s1 = double.NegativeInfinity;
        for (int b = 8; b < Math.Min(nb - 4, (int)(nb * 0.8)); b++)
        {
            if (!Rises(t, b)) continue;
            double s = Dot(w, Clues(t, b));
            if (s > s1) { s1 = s; d1 = b; }
        }
        if (d1 < 0) return (-1, -1, 0, 0);
        int d2 = -1; double s2 = double.NegativeInfinity;
        for (int b = d1 + 24; b < nb - 4; b++)
        {
            if (!Rises(t, b)) continue;
            // the second drop: loud again after a breakdown, so "anything louder before" doesn't count against it
            var f = Clues(t, b); f[13] = 0; f[7] = 0; f[14] = 0;
            double s = Dot(w, f);
            if (s > s2) { s2 = s; d2 = b; }
        }
        if (d2 >= 0 && s2 < s1 - 1.6) d2 = -1;
        return (d1, d2, s1, s2);
    }

    static int NearestBar(int[] bars, int ms)
    {
        int best = 0;
        for (int i = 1; i < bars.Length; i++) if (Math.Abs(bars[i] - ms) < Math.Abs(bars[best] - ms)) best = i;
        return best;
    }

    // ---------------- learning ----------------
    /// pairwise ranking: the bar you picked should score above every other rising bar of that track.
    /// Logistic loss, pulled gently back toward the starting weights so a few corrections can't wreck it.
    public static double[] Train(List<(Bars t, int pos, bool second)> ex, double[] start, int epochs = 120)
    {
        var w = (double[])start.Clone();
        var sets = new List<(double[] p, List<double[]> neg)>();
        foreach (var (t, pos, second) in ex)
        {
            int nb = t.E.Length;
            Func<int, double[]> clue = b => { var f = Clues(t, b); if (second) { f[13] = 0; f[7] = 0; f[14] = 0; } return f; };
            var p = clue(pos);
            var neg = new List<double[]>();
            int from = second ? 8 : 8, to = second ? nb - 4 : Math.Min(nb - 4, (int)(nb * 0.8));
            for (int b = from; b < to; b++) if (Math.Abs(b - pos) > 1 && Rises(t, b)) neg.Add(clue(b));
            if (neg.Count > 0) sets.Add((p, neg));
        }
        if (sets.Count == 0) return w;
        // trust grows with evidence: one correction barely moves the shared weights (that track already uses
        // your exact spot), twenty or more consistent ones move them fully
        double lr = 0.05, lambda = 0.3, trust = Math.Min(1, sets.Count / 20.0);
        // smallest change that works: stop as soon as most corrected bars win by a margin, so a handful of
        // corrections nudges the rest of the library instead of rewriting it
        bool Satisfied()
        {
            int ok = 0;
            foreach (var (p, neg) in sets) { double sp = Dot(w, p); if (neg.All(q => sp - Dot(w, q) >= 0.25)) ok++; }
            return ok >= Math.Ceiling(sets.Count * 0.9);
        }
        for (int e = 0; e < epochs && !Satisfied(); e++)
        {
            var g = new double[w.Length];
            int n = 0;
            foreach (var (p, neg) in sets)
                foreach (var q in neg)
                {
                    double m = 0; for (int i = 0; i < w.Length; i++) m += w[i] * (p[i] - q[i]);
                    double sg = 1 / (1 + Math.Exp(Math.Min(30, m)));
                    for (int i = 0; i < w.Length; i++) g[i] += sg * (p[i] - q[i]);
                    n++;
                }
            for (int i = 0; i < w.Length; i++) w[i] += lr * (trust * g[i] / Math.Max(1, n) * 3 - lambda * (w[i] - start[i]));
        }
        return w;
    }

    /// store a correction (which = 1 or 2, ms = where the drop really is, 0 = clear it) and retrain
    public static object Correct(Library lib, string id, int which, int ms)
    {
        Ensure();
        var bars = lib.BarsFor(id) ?? throw new InvalidOperationException("this track isn't analysed in rekordbox");
        lock (L)
        {
            var old = _fixes.TryGetValue(id, out var f) ? f : new Fix(-1, -1);
            if (ms > 0) ms = bars.ms[NearestBar(bars.ms, ms)]; // drops land on a bar line
            var nf = which == 2 ? old with { d2 = ms > 0 ? ms : -1 } : old with { d1 = ms > 0 ? ms : -1 };
            if (nf.d1 <= 0 && nf.d2 <= 0) _fixes.Remove(id); else _fixes[id] = nf;
            Directory.CreateDirectory(Dir);
            File.WriteAllText(FixFile, JsonSerializer.Serialize(_fixes));
        }
        int used = Retrain(lib);
        return new { ok = true, corrections = FixCount, trainedOn = used, version = _version, ms };
    }

    static int Retrain(Library lib)
    {
        var ex = new List<(Bars, int, bool)>();
        Dictionary<string, Fix> fx;
        lock (L) fx = new(_fixes);
        foreach (var (id, f) in fx)
        {
            var t = lib.BarsFor(id);
            if (t == null) continue;
            if (f.d1 > 0) ex.Add((t, NearestBar(t.ms, f.d1), false));
            if (f.d2 > 0) ex.Add((t, NearestBar(t.ms, f.d2), true));
        }
        var w = Train(ex, W0);
        lock (L)
        {
            _w = w; _version++;
            File.WriteAllText(ModelFile, new JsonObject { ["v"] = _version, ["w"] = new JsonArray(w.Select(x => (JsonNode)Math.Round(x, 4)).ToArray()), ["names"] = new JsonArray(Names.Select(x => (JsonNode)x).ToArray()), ["examples"] = ex.Count }.ToJsonString());
        }
        return ex.Count;
    }

    /// HyperCore --drops-eval [--tune]: how often DROP 1 lands on one of your rekordbox cue points
    /// (old rule vs this finder), and with --tune prints weights fitted to those cues.
    public static int Eval(string[] args)
    {
        var lib = new Library();
        var data = JsonSerializer.SerializeToNode(lib.Load(true));
        var ex = new List<(Bars, int, bool)>();
        int n = 0, hitOld = 0, hitNew = 0, found = 0;
        foreach (var tr in data["tracks"].AsArray())
        {
            var cues = tr["cues"]?.AsArray().Select(c => (int)(double)c[0]).ToList();
            var t = lib.BarsFor((string)tr["id"]);
            if (t == null || cues == null || cues.Count == 0) continue;
            n++;
            var cueBars = cues.Select(c => NearestBar(t.ms, c)).Distinct().ToList();
            if (args.Contains("--verbose") && n <= 6)
            {
                var (vd1, vd2, _, _) = Find(t, Weights);
                Console.WriteLine($"{tr["title"]} | bars={t.ms.Length} first={t.ms[0]} last={t.ms[^1]} | cues ms={string.Join(",", cues.Take(8))} -> bars {string.Join(",", cueBars.Take(8))} | old={OldRule(t)} new={vd1},{vd2}");
                Console.WriteLine("   E: " + string.Join(" ", t.E.Select(x => ((int)x).ToString())));
            }
            bool Hit(int b) => b >= 0 && cueBars.Any(c => Math.Abs(c - b) <= 1);
            int old = OldRule(t);
            var (d1, _, _, _) = Find(t, args.Contains("--tune") ? W0 : Weights);
            if (Hit(old)) hitOld++;
            if (Hit(d1)) hitNew++;
            if (d1 >= 0) found++;
            // for tuning: the cue the finder rates best among cues that sit on a real rise
            var best = cueBars.Where(b => b >= 8 && b < t.E.Length * 0.8 && Rises(t, b)).OrderByDescending(b => Dot(W0, Clues(t, b))).FirstOrDefault(-1);
            if (best >= 0) ex.Add((t, best, false));
        }
        // --learn-demo <title part> <bar>: pretend you corrected that track's DROP 1 to <bar> (nothing is saved)
        int li = Array.IndexOf(args, "--learn-demo");
        if (li >= 0)
        {
            var tr = data["tracks"].AsArray().First(x => ((string)x["title"] ?? "").Contains(args[li + 1], StringComparison.OrdinalIgnoreCase));
            var t = lib.BarsFor((string)tr["id"]);
            int bar = int.Parse(args[li + 2]);
            var all = data["tracks"].AsArray().Select(x => lib.BarsFor((string)x["id"])).Where(x => x != null).ToList();
            var before = all.Select(x => Find(x, W0).d1).ToList();
            var w = Train(new() { (t, bar, false) }, W0);
            var after = all.Select(x => Find(x, w).d1).ToList();
            Console.WriteLine($"{tr["title"]}: finder said bar {Find(t, W0).d1}, corrected to {bar}, after learning: {Find(t, w).d1} · other tracks whose DROP 1 moved: {before.Zip(after).Count(p => p.First != p.Second) - 1} of {all.Count}");
            Console.WriteLine("weights: " + string.Join(" ", Names.Zip(w, (nm, x) => $"{nm}={x:0.00}")));
            return 0;
        }
        Console.WriteLine($"tracks with cues: {n} · drop found: {found} · DROP 1 on a cue (±1 bar): old rule {hitOld} ({100.0 * hitOld / Math.Max(1, n):0}%), finder {hitNew} ({100.0 * hitNew / Math.Max(1, n):0}%)");
        // (cue points here mostly mark song starts, so --tune is only meaningful once corrections are many)
        if (args.Contains("--tune"))
        {
            // fit on half, check on the other half
            var rnd = new Random(7);
            var shuffled = ex.OrderBy(_ => rnd.Next()).ToList();
            var trainSet = shuffled.Take(shuffled.Count / 2).ToList();
            var testSet = shuffled.Skip(shuffled.Count / 2).ToList();
            var w = Train(trainSet, W0, 300);
            int Top(List<(Bars t, int pos, bool s)> set, double[] ww) => set.Count(x => Math.Abs(Find(x.t, ww).d1 - x.pos) <= 1);
            Console.WriteLine($"held-out: start weights {Top(testSet, W0)}/{testSet.Count} · tuned {Top(testSet, w)}/{testSet.Count}");
            Console.WriteLine("tuned: { " + string.Join(", ", w.Select(x => x.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture))) + " }");
        }
        return 0;
    }

    // the previous finder, kept for comparison
    static int OldRule(Bars t)
    {
        var E = t.E; int nb = E.Length;
        var sorted = E.OrderBy(x => x).ToArray();
        double p70 = sorted[(int)(sorted.Length * 0.7)];
        for (int b = 8; b < nb - 4; b++)
        {
            double pre = Mean(E, b - 8, b), post = Mean(E, b, b + 4);
            if (post > pre * 1.25 && post >= p70 * 0.97) { int snap = (int)Math.Round(b / 8.0) * 8; return Math.Abs(snap - b) <= 2 && snap > 0 ? snap : b; }
        }
        return -1;
    }
}
