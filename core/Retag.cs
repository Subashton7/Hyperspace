using System.Globalization;
using System.Text.RegularExpressions;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace HyperCore;

/// Writes cleaned-up info and cover art into music files, so rekordbox's "Reload Tag" (and every other
/// DJ app) picks them up. Every file's original tag fields and covers are saved first; `--retag-undo`
/// puts them back exactly. Everything else in the tag (Serato's GEOB cue/grid frames, rekordbox's own) is kept.
///   HyperCore --retag <plan.json> <backupDir>      plan: [{ path, title, artist, genre, year, label, comment, art | noart, bpm, key }]
///   HyperCore --retag-undo <backupDir>
///   HyperCore --library-json <out.json>            the rekordbox library + beat grids, for building playlists
///   HyperCore --tag-dump <file>
static class Retag
{
    public static int Run(string[] args)
    {
        int i = Array.IndexOf(args, "--retag");
        var plan = JsonNode.Parse(File.ReadAllText(args[i + 1])).AsArray();
        var dir = args[i + 2];
        Directory.CreateDirectory(Path.Combine(dir, "pictures"));
        TagLib.Id3v2.Tag.DefaultVersion = 3; // new ID3 tags as v2.3, the most widely read; existing tags keep their version
        TagLib.Id3v2.Tag.ForceDefaultVersion = false;
        // one line per file, written before that file is touched, so even an interrupted run can be undone
        var backupFile = Path.Combine(dir, "backup.jsonl");
        int ok = 0, failed = 0, n = 0;
        var log = new List<string>();
        foreach (var e in plan)
        {
            n++;
            var path = (string)e["path"];
            try
            {
                var mtime = File.GetLastWriteTimeUtc(path);
                // WAV / AIFF keep tags in several chunk kinds that TagLib rewrites together, so their undo is the whole original file
                string copy = null;
                if (Regex.IsMatch(path, @"\.(wav|wave|aif|aiff)$", RegexOptions.IgnoreCase))
                {
                    Directory.CreateDirectory(Path.Combine(dir, "files"));
                    copy = $"{Math.Abs(path.GetHashCode()):x8}-{n}{Path.GetExtension(path)}";
                    File.Copy(path, Path.Combine(dir, "files", copy), true);
                }
                using (var f = TagLib.File.Create(path))
                {
                    var onDisk = f.TagTypesOnDisk;
                    var tag = Main(f);
                    int geob = Geob(tag);
                    var pics = new JsonArray();
                    int k = 0;
                    foreach (var p in Covers(tag))
                    {
                        var pf = $"{Math.Abs(path.GetHashCode()):x8}-{n}-{k++}.bin";
                        File.WriteAllBytes(Path.Combine(dir, "pictures", pf), p.Data.Data);
                        pics.Add(new JsonObject { ["file"] = pf, ["mime"] = p.MimeType, ["type"] = (int)p.Type, ["desc"] = p.Description });
                    }
                    // a BPM / key another app (Serato, Mixed In Key) left in the tag is set to rekordbox's analysis,
                    // so a Reload Tag can never pull an older value over it; absent frames stay absent
                    var id3 = tag as TagLib.Id3v2.Tag;
                    var tbpm = id3 == null ? null : TagLib.Id3v2.TextInformationFrame.Get(id3, "TBPM", false);
                    var tkey = id3 == null ? null : TagLib.Id3v2.TextInformationFrame.Get(id3, "TKEY", false);
                    File.AppendAllText(backupFile, new JsonObject
                    {
                        ["path"] = path, ["mtime"] = mtime.ToString("o"), ["copy"] = copy,
                        ["title"] = tag.Title, ["artists"] = Json(tag.Performers), ["genres"] = Json(tag.Genres), ["year"] = tag.Year,
                        ["comment"] = tag.Comment, ["publisher"] = Publisher(tag), ["pictures"] = pics,
                        ["tbpm"] = tbpm?.Text.FirstOrDefault(), ["tkey"] = tkey?.Text.FirstOrDefault(),
                    }.ToJsonString() + "\n");
                    if (tbpm != null && e["bpm"] is JsonNode bpm && (double)bpm > 0) tbpm.Text = new[] { Bpm((double)bpm) };
                    if (tkey != null && e["key"] is JsonNode key && !string.IsNullOrEmpty((string)key)) tkey.Text = new[] { (string)key };
                    // an empty string clears the field (used to put a wrongly matched track back the way it was)
                    if (e["title"] is JsonNode t) tag.Title = Text(t);
                    if (e["artist"] is JsonNode a) tag.Performers = Text(a) is string av ? new[] { av } : Array.Empty<string>();
                    if (e["genre"] is JsonNode g) tag.Genres = Text(g) is string gv ? new[] { gv } : Array.Empty<string>();
                    if (e["year"] is JsonNode y) tag.Year = (uint)y;
                    if (e["comment"] is JsonNode c) tag.Comment = Text(c);
                    if (e["label"] is JsonNode l) SetPublisher(tag, Text(l));
                    if (e["art"] is JsonNode art && File.Exists((string)art))
                        SetCovers(tag, new TagLib.IPicture[] { new TagLib.Picture(new TagLib.ByteVector(File.ReadAllBytes((string)art))) { Type = TagLib.PictureType.FrontCover, MimeType = "image/jpeg", Description = "Cover" } });
                    else if (e["noart"] is JsonNode na && (bool)na) SetCovers(tag, Array.Empty<TagLib.IPicture>());
                    if (Geob(tag) != geob) throw new InvalidOperationException("would change Serato data, skipped");
                    if ((onDisk & TagLib.TagTypes.Id3v1) == 0) f.RemoveTags(TagLib.TagTypes.Id3v1); // don't add an empty v1 tag
                    f.Save();
                }
                ok++;
            }
            catch (Exception ex) { failed++; log.Add($"{path}: {ex.Message}"); }
            if (n % 50 == 0) Console.WriteLine($"PROGRESS {n} {plan.Count}");
        }
        File.WriteAllLines(Path.Combine(dir, "errors.txt"), log);
        Console.WriteLine($"DONE ok={ok} failed={failed}");
        foreach (var l in log.Take(10)) Console.WriteLine("  " + l);
        return failed > 0 && ok == 0 ? 1 : 0;
    }

    public static int Undo(string[] args)
    {
        var dir = args[Array.IndexOf(args, "--retag-undo") + 1];
        var backup = File.ReadAllLines(Path.Combine(dir, "backup.jsonl")).Where(l => l.Trim().Length > 0).Select(l => JsonNode.Parse(l)).ToList();
        int ok = 0, failed = 0;
        foreach (var b in backup)
        {
            var path = (string)b["path"];
            try
            {
                if ((string)b["copy"] is string copy) File.Copy(Path.Combine(dir, "files", copy), path, true);
                else using (var f = TagLib.File.Create(path))
                {
                    var onDisk = f.TagTypesOnDisk;
                    var tag = Main(f);
                    tag.Title = (string)b["title"];
                    tag.Performers = b["artists"]?.AsArray().Select(x => (string)x).ToArray() ?? Array.Empty<string>();
                    tag.Genres = b["genres"]?.AsArray().Select(x => (string)x).ToArray() ?? Array.Empty<string>();
                    tag.Year = (uint)b["year"];
                    tag.Comment = (string)b["comment"];
                    SetPublisher(tag, (string)b["publisher"]);
                    SetCovers(tag, b["pictures"].AsArray().Select(p => (TagLib.IPicture)new TagLib.Picture(new TagLib.ByteVector(File.ReadAllBytes(Path.Combine(dir, "pictures", (string)p["file"]))))
                    { MimeType = (string)p["mime"], Type = (TagLib.PictureType)(int)p["type"], Description = (string)p["desc"] }).ToArray());
                    if (tag is TagLib.Id3v2.Tag id3)
                    {
                        if ((string)b["tbpm"] is string tb) TagLib.Id3v2.TextInformationFrame.Get(id3, "TBPM", true).Text = new[] { tb };
                        if ((string)b["tkey"] is string tk) TagLib.Id3v2.TextInformationFrame.Get(id3, "TKEY", true).Text = new[] { tk };
                    }
                    if ((onDisk & TagLib.TagTypes.Id3v1) == 0) f.RemoveTags(TagLib.TagTypes.Id3v1);
                    f.Save();
                }
                File.SetLastWriteTimeUtc(path, DateTime.Parse((string)b["mtime"], null, DateTimeStyles.RoundtripKind));
                ok++;
            }
            catch { failed++; }
        }
        Console.WriteLine($"UNDONE ok={ok} failed={failed}");
        return 0;
    }

    /// HyperCore --tag-dump <file>: what a tag reader sees, frame by frame (for checking a retag)
    public static int Dump(string[] args)
    {
        var path = args[Array.IndexOf(args, "--tag-dump") + 1];
        using var f = TagLib.File.Create(path);
        Console.WriteLine($"types={f.TagTypesOnDisk} title='{f.Tag.Title}' artist='{f.Tag.FirstPerformer}' genre='{f.Tag.FirstGenre}' year={f.Tag.Year} label='{Publisher(f.Tag)}' comment='{f.Tag.Comment}' bpm={f.Tag.BeatsPerMinute} covers={Covers(Main(f)).Length}");
        if (f.GetTag(TagLib.TagTypes.Id3v2, false) is TagLib.Id3v2.Tag id3)
            Console.WriteLine($"id3v2.{id3.Version} frames: " + string.Join(" ", id3.GetFrames().Select(x => x is TagLib.Id3v2.TextInformationFrame t ? $"{x.FrameId}='{string.Join("/", t.Text)}'" : x is TagLib.Id3v2.AttachmentFrame a ? $"{x.FrameId}[{a.Description}:{a.Data.Count}]" : x.FrameId.ToString())));
        return 0;
    }

    // ID3 for MP3, WAV and AIFF; the file's own tag format otherwise (MP4 atoms, FLAC comments)
    static TagLib.Tag Main(TagLib.File f) =>
        f is TagLib.Riff.File || f is TagLib.Aiff.File || f is TagLib.Mpeg.AudioFile ? f.GetTag(TagLib.TagTypes.Id3v2, true) : f.Tag;

    // Covers only. TagLib counts ID3 GEOB frames as "pictures" too, and that's where Serato keeps cues and beat grids.
    static TagLib.IPicture[] Covers(TagLib.Tag tag) =>
        tag is TagLib.Id3v2.Tag id3 ? id3.GetFrames<TagLib.Id3v2.AttachmentFrame>("APIC").Cast<TagLib.IPicture>().ToArray() : tag.Pictures ?? Array.Empty<TagLib.IPicture>();
    static void SetCovers(TagLib.Tag tag, TagLib.IPicture[] pics)
    {
        if (tag is not TagLib.Id3v2.Tag id3) { tag.Pictures = pics; return; }
        id3.RemoveFrames("APIC");
        foreach (var p in pics) id3.AddFrame(new TagLib.Id3v2.AttachmentFrame(p));
    }
    static int Geob(TagLib.Tag tag) => tag is TagLib.Id3v2.Tag id3 ? id3.GetFrames("GEOB").Count() : 0;

    static string Text(JsonNode n) => string.IsNullOrEmpty((string)n) ? null : (string)n;

    static string Bpm(double b) => Math.Abs(b - Math.Round(b)) < 0.005 ? Math.Round(b).ToString(CultureInfo.InvariantCulture) : b.ToString("0.00", CultureInfo.InvariantCulture);

    static JsonArray Json(string[] a) => new(a?.Select(x => (JsonNode)x).ToArray() ?? Array.Empty<JsonNode>());

    // the label lives in TPUB (ID3) / ©pub-style fields; not every tag format has one
    static string Publisher(TagLib.Tag t)
    {
        try { return t.Publisher; } catch { return null; }
    }
    static void SetPublisher(TagLib.Tag t, string v)
    {
        try { t.Publisher = v; } catch { }
    }

    /// The whole rekordbox library plus each track's beat grid as tempo segments [startSec, bpm, beatInBar].
    public static int LibraryJson(string[] args)
    {
        var outFile = args[Array.IndexOf(args, "--library-json") + 1];
        var lib = new Library();
        var data = JsonSerializer.SerializeToNode(lib.Load(true)).AsObject();
        var grids = new JsonObject();
        foreach (var t in data["tracks"].AsArray())
        {
            var w = JsonSerializer.SerializeToNode(lib.Wave((string)t["id"], 10));
            if (w?["beats"] is not JsonArray beats || beats.Count == 0) continue;
            var seg = new JsonArray();
            double lastBpm = -1;
            foreach (var b in beats)
            {
                double ms = (double)b[0], bpm = (double)b[2];
                if (Math.Abs(bpm - lastBpm) > 0.005) { seg.Add(new JsonArray(Math.Round(ms / 1000.0, 3), bpm, (int)b[1])); lastBpm = bpm; }
            }
            grids[(string)t["id"]] = seg;
        }
        data["grids"] = grids;
        data["features"] = JsonSerializer.SerializeToNode(lib.Features(false));
        File.WriteAllText(outFile, data.ToJsonString());
        Console.WriteLine($"OK tracks={data["tracks"].AsArray().Count} grids={grids.Count}");
        return 0;
    }
}
