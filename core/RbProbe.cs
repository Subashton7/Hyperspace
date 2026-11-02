using Microsoft.Data.Sqlite;

namespace HyperCore;

/// HyperCore --rb-sql "<select>" [rekordboxDir] : runs one read-only query against a private copy of rekordbox's master.db
/// (for working out how rekordbox stores things before writing to it).
static class RbProbe
{
    public static int Run(string[] args)
    {
        int a = Array.IndexOf(args, "--rb-sql");
        var sql = args[a + 1];
        SQLitePCL.Batteries_V2.Init();
        var dir = args.Length > a + 2 ? args[a + 2] : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Pioneer", "rekordbox");
        var db = Path.Combine(dir, "master.db");
        var tmp = Path.Combine(Path.GetTempPath(), $"hs-rbprobe-{Environment.ProcessId}.db");
        using (var src = new FileStream(db, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
        using (var dst = File.Create(tmp)) src.CopyTo(dst);
        try
        {
            using var c = new SqliteConnection($"Data Source={tmp};Mode=ReadOnly;Pooling=False");
            c.Open();
            using (var k = c.CreateCommand()) { k.CommandText = $"PRAGMA key = '{RbWriter.Key}';"; k.ExecuteNonQuery(); }
            using var q = c.CreateCommand();
            q.CommandText = sql;
            using var r = q.ExecuteReader();
            while (r.Read())
                Console.WriteLine(string.Join(" | ", Enumerable.Range(0, r.FieldCount).Select(i => $"{r.GetName(i)}={(r.IsDBNull(i) ? "NULL" : r.GetValue(i))}")));
        }
        finally { SqliteConnection.ClearAllPools(); try { File.Delete(tmp); } catch { } }
        return 0;
    }
}
