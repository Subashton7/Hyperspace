using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace HyperCore;

/// OneNote → HYPERSPACE NOTES, step 2 of 2: `HyperCore --onenote-convert` reads the JSON lines written by
/// src/onenote.ps1 on stdin (each page's raw OneNote XML) and writes them back out on stdout with the page as
/// Markdown and its pictures pulled out as base64. Everything stays in the pipe, never on disk.
/// (Reading OneNote happens in PowerShell because OneNote's automation won't answer .NET's calls on this
/// laptop: its type library isn't registered, and only PowerShell's way of calling copes with that.)
public static class OneNoteExport
{
    static readonly XNamespace One = "http://schemas.microsoft.com/office/onenote/2013/onenote";

    public static int Run(string[] args)
    {
        var input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
        var output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { NewLine = "\n" };
        int pages = 0, images = 0, snapshots = 0, errors = 0;
        string line;
        while ((line = input.ReadLine()) != null)
        {
            JsonObject o;
            try { o = JsonNode.Parse(line) as JsonObject; } catch { continue; }
            if (o == null) continue;
            var type = (string)o["type"];
            if (type == "page")
            {
                try
                {
                    var pics = new List<object>();
                    var md = ToMarkdown(XDocument.Parse((string)o["xml"]).Root, pics);
                    o.Remove("xml");
                    o["md"] = md;
                    o["images"] = JsonSerializer.SerializeToNode(pics);
                    if (o["title"] is JsonValue tv) o["title"] = ((string)tv ?? "").Trim();
                    pages++; images += pics.Count;
                    if (o["pdf"] is JsonValue pv && pv.GetValueKind() == JsonValueKind.String) snapshots++;
                }
                catch (Exception e) { errors++; o = new JsonObject { ["type"] = "page-error", ["notebook"] = o["notebook"]?.DeepClone(), ["title"] = o["title"]?.DeepClone(), ["error"] = e.Message }; }
            }
            else if (type == "end") o = new JsonObject { ["type"] = "done", ["pages"] = pages, ["images"] = images, ["snapshots"] = snapshots, ["errors"] = errors };
            else if (type == "page-error") errors++;
            output.WriteLine(o.ToJsonString());
            output.Flush();
        }
        return 0;
    }
    // ---------------- page XML → Markdown ----------------
    static string ToMarkdown(XElement page, List<object> pics)
    {
        var sb = new StringBuilder();
        foreach (var el in page.Elements())
        {
            if (el.Name == One + "Outline") Block(el.Element(One + "OEChildren"), 0, sb, pics);
            else if (el.Name == One + "Image") { Image(el, sb, pics); sb.Append("\n\n"); }
        }
        return Regex.Replace(sb.ToString(), @"\n{3,}", "\n\n").Trim() + "\n";
    }

    static void Block(XElement children, int depth, StringBuilder sb, List<object> pics)
    {
        if (children == null) return;
        int n = 0;
        foreach (var oe in children.Elements(One + "OE"))
        {
            var pad = new string(' ', depth * 2);
            var list = oe.Element(One + "List");
            var tag = oe.Element(One + "Tag");
            string lead = list?.Element(One + "Number") != null ? $"{++n}. " : list?.Element(One + "Bullet") != null ? "- " : "";
            if (tag != null && tag.Attribute("completed") != null) lead = (lead == "" ? "- " : lead) + (tag.Attribute("completed").Value == "true" ? "[x] " : "[ ] ");
            var text = string.Concat(oe.Elements(One + "T").Select(t => Inline(t.Value)));
            if (text.Length > 0 || lead.Length > 0) sb.Append(pad).Append(lead).Append(text.Replace("\n", "\n" + pad)).Append(lead.Length > 0 ? "\n" : "\n\n");
            foreach (var img in oe.Elements(One + "Image")) { sb.Append(pad); Image(img, sb, pics); sb.Append("\n\n"); }
            foreach (var tbl in oe.Elements(One + "Table")) Table(tbl, sb);
            if (oe.Element(One + "InsertedFile") is XElement f) sb.Append(pad).Append($"*(attached file: {f.Attribute("preferredName")?.Value ?? "file"} — not imported)*\n\n");
            Block(oe.Element(One + "OEChildren"), depth + (lead.Length > 0 ? 1 : 0), sb, pics);
        }
    }

    static void Image(XElement img, StringBuilder sb, List<object> pics)
    {
        var data = img.Element(One + "Data")?.Value;
        if (string.IsNullOrEmpty(data)) return;
        var fmt = (img.Attribute("format")?.Value ?? "png").ToLowerInvariant();
        var name = $"img{pics.Count + 1}";
        pics.Add(new { name, mime = fmt is "jpg" or "jpeg" ? "image/jpeg" : fmt == "gif" ? "image/gif" : fmt == "emf" ? "image/emf" : "image/png", b64 = data.Trim() });
        sb.Append($"![{name}](hs-image:{name})");
    }

    static void Table(XElement tbl, StringBuilder sb)
    {
        var rows = tbl.Elements(One + "Row").Select(r => r.Elements(One + "Cell").Select(c =>
            string.Join(" ", c.Descendants(One + "T").Select(t => Inline(t.Value).Replace("|", "\\|").Replace("\n", " "))).Trim()).ToList()).ToList();
        if (rows.Count == 0) return;
        int cols = rows.Max(r => r.Count);
        foreach (var (r, i) in rows.Select((r, i) => (r, i)))
        {
            while (r.Count < cols) r.Add("");
            sb.Append("| ").Append(string.Join(" | ", r)).Append(" |\n");
            if (i == 0) sb.Append("|").Append(string.Concat(Enumerable.Repeat(" --- |", cols))).Append('\n');
        }
        sb.Append('\n');
    }

    // OneNote stores each run of text as a little piece of HTML
    static string Inline(string html)
    {
        var s = html ?? "";
        s = Regex.Replace(s, @"<br\s*/?>", "\n", RegexOptions.IgnoreCase);
        s = Regex.Replace(s, @"<a\s[^>]*href=""([^""]*)""[^>]*>(.*?)</a>", m => $"[{m.Groups[2].Value}]({m.Groups[1].Value})", RegexOptions.IgnoreCase | RegexOptions.Singleline);
        s = Regex.Replace(s, @"<span[^>]*style='([^']*)'[^>]*>(.*?)</span>", m =>
        {
            var st = m.Groups[1].Value; var inner = m.Groups[2].Value;
            if (inner.Trim().Length == 0) return inner;
            if (st.Contains("font-weight:bold")) inner = $"**{inner}**";
            if (st.Contains("font-style:italic")) inner = $"*{inner}*";
            if (st.Contains("line-through")) inner = $"~~{inner}~~";
            return inner;
        }, RegexOptions.IgnoreCase | RegexOptions.Singleline);
        s = Regex.Replace(s, @"<[^>]+>", "");
        return WebUtility.HtmlDecode(s);
    }
}
