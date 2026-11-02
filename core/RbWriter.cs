using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

namespace HyperCore;

/// Adds downloaded tracks to rekordbox's own library, each into a playlist (made if missing), the way
/// rekordbox itself stores them. Only runs while rekordbox is closed, copies master.db aside first, and does
/// everything in one transaction, so a failure leaves rekordbox exactly as it was. rekordbox analyses the
/// new tracks (BPM, key, waveform) when you load or select-and-analyse them.
///   HyperCore --rb-add <queue.json> <backupDir> [rekordboxDir]
///   queue: [{ id, path, title, artist, genre, label, year, art500, art240, art80, playlist }]
static class RbWriter
{
    // rekordbox 6+ encrypts master.db with SQLCipher 4 under this fixed key (the same one pyrekordbox uses)
    public const string Key = "402fd482c38817c35ffa8ffb8c7d93143b749e7d315df7a81732a1ff43608497";

    static readonly Dictionary<string, int> FileTypes = new(StringComparer.OrdinalIgnoreCase)
    { [".mp3"] = 1, [".m4a"] = 4, [".aac"] = 4, [".mp4"] = 3, [".flac"] = 5, [".wav"] = 11, [".aif"] = 12, [".aiff"] = 12 };

    public static int Add(string[] args)
    {
        int a = Array.IndexOf(args, "--rb-add");
        var queue = JsonNode.Parse(File.ReadAllText(args[a + 1])).AsArray();
        var backupDir = args[a + 2];
        var rbDir = args.Length > a + 3 ? args[a + 3] : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Pioneer", "rekordbox");
        if (args.Length <= a + 3 && Process.GetProcessesByName("rekordbox").Length > 0) { Console.WriteLine("BUSY rekordbox is open"); return 2; }

        var db = Path.Combine(rbDir, "master.db");
        Directory.CreateDirectory(backupDir);
        foreach (var ext in new[] { "", "-wal", "-shm" })
            if (File.Exists(db + ext)) File.Copy(db + ext, Path.Combine(backupDir, "master.db" + ext), true);

        SQLitePCL.Batteries_V2.Init();
        var done = new JsonArray();
        using (var c = new SqliteConnection($"Data Source={db};Pooling=False"))
        {
            c.Open();
            Exec(c, $"PRAGMA key = '{Key}';");
            using var tx = c.BeginTransaction();
            string now = Stamp();
            long usn = Scalar<long>(c, tx, "SELECT int_1 FROM agentRegistry WHERE registry_id='localUpdateCount'");
            long Next() => ++usn;
            string dbid = Scalar<string>(c, tx, "SELECT DBID FROM djmdProperty LIMIT 1");
            string device = Scalar<string>(c, tx, "SELECT DeviceID FROM djmdProperty LIMIT 1");

            foreach (var e in queue)
            {
                var path = Path.GetFullPath((string)e["path"]);
                var folderPath = path.Replace('\\', '/');
                string contentId = Scalar<string>(c, tx, "SELECT ID FROM djmdContent WHERE FolderPath=$p AND rb_local_deleted=0", ("$p", folderPath));
                bool added = false;
                if (contentId == null)
                {
                    contentId = Free(c, tx, "djmdContent", (string)e["id"]);
                    var uuid = Guid.NewGuid().ToString();
                    long len = 0, bitrate = 0, rate = 0, depth = 16;
                    try
                    {
                        using var f = TagLib.File.Create(path);
                        len = (long)Math.Round(f.Properties.Duration.TotalSeconds); bitrate = f.Properties.AudioBitrate; rate = f.Properties.AudioSampleRate;
                        if (f.Properties.BitsPerSample > 0) depth = f.Properties.BitsPerSample;
                    }
                    catch { }
                    string image = null;
                    if ((string)e["art500"] is string art && File.Exists(art))
                    {
                        var rel = $"/PIONEER/Artwork/{uuid[..3]}/{uuid[3..]}";
                        var dir = Path.Combine(rbDir, "share", rel.TrimStart('/').Replace('/', '\\'));
                        Directory.CreateDirectory(dir);
                        File.Copy(art, Path.Combine(dir, "artwork.jpg"), true);
                        if ((string)e["art240"] is string m && File.Exists(m)) File.Copy(m, Path.Combine(dir, "artwork_m.jpg"), true);
                        if ((string)e["art80"] is string s && File.Exists(s)) File.Copy(s, Path.Combine(dir, "artwork_s.jpg"), true);
                        image = rel + "/artwork.jpg";
                        var local = Path.Combine(dir, "artwork.jpg");
                        Exec(c, tx, @"INSERT INTO contentFile (ID, ContentID, Path, Hash, Size, rb_local_path, UUID, rb_local_usn, created_at, updated_at)
                                      VALUES ($id,$cid,$path,$hash,$size,$local,$uuid,$usn,$now,$now)",
                            ("$id", uuid + "_" + Uri.EscapeDataString(image)), ("$cid", contentId), ("$path", image),
                            ("$hash", Convert.ToHexString(MD5.HashData(File.ReadAllBytes(local))).ToLowerInvariant()), ("$size", new FileInfo(local).Length),
                            ("$local", local), ("$uuid", Guid.NewGuid().ToString()), ("$usn", Next()), ("$now", now));
                    }
                    string today = DateTime.Now.ToString("yyyy-MM-dd");
                    Exec(c, tx, @"INSERT INTO djmdContent (ID, FolderPath, FileNameL, FileNameS, Title, ArtistID, AlbumID, GenreID, BPM, Length, TrackNo, BitRate, BitDepth, Commnt,
                                  FileType, Rating, ReleaseYear, LabelID, KeyID, StockDate, ColorID, DJPlayCount, ImagePath, MasterDBID, MasterSongID, FileSize, DiscNo,
                                  Subtitle, SampleRate, Analysed, ReleaseDate, DateCreated, ContentLink, HotCueAutoLoad, DeliveryControl, DeliveryComment, Lyricist, ISRC,
                                  SamplerTrackInfo, SamplerPlayOffset, SamplerGain, VideoAssociate, LyricStatus, ServiceID, OrgFolderPath, Reserved1, DeviceID, UUID, rb_local_usn, created_at, updated_at)
                                  VALUES ($id,$fp,$fn,'',$title,$artist,'',$genre,0,$len,0,$br,$bd,$comment,$ft,0,$year,$label,NULL,$today,0,0,$img,$dbid,$id,$size,0,
                                  '',$rate,0,'',$today,0,'on','on','','','',0,0,0,0,0,0,'','',$device,$uuid,$usn,$now,$now)",
                        ("$id", contentId), ("$fp", folderPath), ("$fn", Path.GetFileName(path)), ("$title", (string)e["title"] ?? Path.GetFileNameWithoutExtension(path)),
                        ("$artist", Named(c, tx, "djmdArtist", (string)e["artist"], now, Next)), ("$genre", Named(c, tx, "djmdGenre", (string)e["genre"], now, Next)),
                        ("$len", len), ("$br", bitrate), ("$bd", depth), ("$comment", (string)e["comment"] ?? ""), ("$ft", FileTypes.GetValueOrDefault(Path.GetExtension(path), 1)),
                        ("$year", (long?)e["year"] ?? 0), ("$label", Named(c, tx, "djmdLabel", (string)e["label"], now, Next)), ("$today", today), ("$img", image),
                        ("$dbid", dbid), ("$size", new FileInfo(path).Length), ("$rate", rate), ("$device", device), ("$uuid", uuid), ("$usn", Next()), ("$now", now));
                    added = true;
                }

                string playlist = null;
                if ((string)e["playlist"] is string pname && pname.Trim().Length > 0)
                {
                    playlist = Scalar<string>(c, tx, "SELECT ID FROM djmdPlaylist WHERE Name=$n AND ParentID='root' AND Attribute=0 AND rb_local_deleted=0", ("$n", pname.Trim()));
                    if (playlist == null)
                    {
                        playlist = Free(c, tx, "djmdPlaylist", null);
                        long seq = Scalar<long>(c, tx, "SELECT COALESCE(MAX(Seq),0) FROM djmdPlaylist WHERE ParentID='root' AND rb_local_deleted=0") + 1;
                        Exec(c, tx, "INSERT INTO djmdPlaylist (ID, Seq, Name, Attribute, ParentID, UUID, rb_local_usn, created_at, updated_at) VALUES ($id,$seq,$n,0,'root',$uuid,$usn,$now,$now)",
                            ("$id", playlist), ("$seq", seq), ("$n", pname.Trim()), ("$uuid", Guid.NewGuid().ToString()), ("$usn", Next()), ("$now", now));
                    }
                    if (Scalar<string>(c, tx, "SELECT ID FROM djmdSongPlaylist WHERE PlaylistID=$p AND ContentID=$c AND rb_local_deleted=0", ("$p", playlist), ("$c", contentId)) == null)
                    {
                        long no = Scalar<long>(c, tx, "SELECT COALESCE(MAX(TrackNo),0) FROM djmdSongPlaylist WHERE PlaylistID=$p AND rb_local_deleted=0", ("$p", playlist)) + 1;
                        Exec(c, tx, "INSERT INTO djmdSongPlaylist (ID, PlaylistID, ContentID, TrackNo, UUID, rb_local_usn, created_at, updated_at) VALUES ($id,$p,$c,$no,$uuid,$usn,$now,$now)",
                            ("$id", Guid.NewGuid().ToString()), ("$p", playlist), ("$c", contentId), ("$no", no), ("$uuid", Guid.NewGuid().ToString()), ("$usn", Next()), ("$now", now));
                    }
                }
                done.Add(new JsonObject { ["path"] = path, ["id"] = contentId, ["added"] = added, ["playlist"] = playlist });
            }
            Exec(c, tx, "UPDATE agentRegistry SET int_1=$u, updated_at=$now WHERE registry_id='localUpdateCount'", ("$u", usn), ("$now", now));
            tx.Commit();
        }
        SqliteConnection.ClearAllPools();
        Console.WriteLine("OK " + done.ToJsonString());
        return 0;
    }

    static string Stamp() => DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss.fff") + " +00:00";

    // rekordbox's own ids are random 32-bit numbers; keep the one the app picked if it's free
    static string Free(SqliteConnection c, SqliteTransaction tx, string table, string want)
    {
        if (want != null && long.TryParse(want, out _) && Scalar<string>(c, tx, $"SELECT ID FROM {table} WHERE ID=$i", ("$i", want)) == null) return want;
        while (true)
        {
            var id = ((long)RandomNumberGenerator.GetInt32(100_000_000, int.MaxValue) + RandomNumberGenerator.GetInt32(0, int.MaxValue)).ToString();
            if (Scalar<string>(c, tx, $"SELECT ID FROM {table} WHERE ID=$i", ("$i", id)) == null) return id;
        }
    }

    // artist / genre / label rows are shared by name
    static string Named(SqliteConnection c, SqliteTransaction tx, string table, string name, string now, Func<long> next)
    {
        if (string.IsNullOrWhiteSpace(name)) return null;
        name = name.Trim();
        var id = Scalar<string>(c, tx, $"SELECT ID FROM {table} WHERE Name=$n AND rb_local_deleted=0", ("$n", name));
        if (id != null) return id;
        id = Free(c, tx, table, null);
        Exec(c, tx, $"INSERT INTO {table} (ID, Name, UUID, rb_local_usn, created_at, updated_at) VALUES ($i,$n,$u,$usn,$now,$now)",
            ("$i", id), ("$n", name), ("$u", Guid.NewGuid().ToString()), ("$usn", next()), ("$now", now));
        return id;
    }

    static void Exec(SqliteConnection c, string sql) { using var k = c.CreateCommand(); k.CommandText = sql; k.ExecuteNonQuery(); }
    static void Exec(SqliteConnection c, SqliteTransaction tx, string sql, params (string, object)[] p)
    {
        using var k = c.CreateCommand(); k.Transaction = tx; k.CommandText = sql;
        foreach (var (n, v) in p) k.Parameters.AddWithValue(n, v ?? DBNull.Value);
        k.ExecuteNonQuery();
    }
    static T Scalar<T>(SqliteConnection c, SqliteTransaction tx, string sql, params (string, object)[] p)
    {
        using var k = c.CreateCommand(); k.Transaction = tx; k.CommandText = sql;
        foreach (var (n, v) in p) k.Parameters.AddWithValue(n, v ?? DBNull.Value);
        var r = k.ExecuteScalar();
        if (r == null || r is DBNull) return default;
        return typeof(T) == typeof(string) ? (T)(object)r.ToString() : (T)Convert.ChangeType(r, typeof(T));
    }
}
