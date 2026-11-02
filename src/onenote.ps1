# OneNote → HYPERSPACE NOTES, step 1 of 2: read every page out of the OneNote desktop app through its own
# automation interface (no Microsoft sign-in) and write one JSON line per page to stdout: where it lives, its
# dates and its raw page XML with pictures inline. HyperCore (--onenote-convert) turns that into Markdown, and
# the app encrypts each page as it arrives, so pages never land on disk unencrypted. Pages with handwriting
# also get a PDF snapshot: OneNote can only publish that to a file, so it goes to a temp file that is read and
# deleted straight away.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
function Emit($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 4)); [Console]::Out.Flush() }

# OneNote may still be closing from a previous run: give it a few tries
$on = $null
for ($try = 0; $try -lt 6 -and -not $on; $try++) {
  try { $on = New-Object -ComObject OneNote.Application }
  catch { if ($try -eq 5) { Emit @{ type = 'error'; error = "OneNote desktop isn't available: $($_.Exception.Message)" }; exit 2 }; Start-Sleep -Seconds 5 }
}

$hier = ''; $on.GetHierarchy('', 4, [ref]$hier)   # 4 = every notebook down to pages
$x = [xml]$hier
$ns = New-Object Xml.XmlNamespaceManager $x.NameTable
$ns.AddNamespace('one', $x.DocumentElement.NamespaceURI)

$pages = New-Object System.Collections.ArrayList
function Walk($node, $nb, $path) {
  foreach ($c in $node.ChildNodes) {
    if ($c.isInRecycleBin -eq 'true' -or $c.isRecycleBin -eq 'true') { continue }
    if ($c.LocalName -eq 'SectionGroup') { Walk $c $nb ($path + @($c.name)) }
    elseif ($c.LocalName -eq 'Section') { foreach ($p in $c.SelectNodes('one:Page', $ns)) { [void]$pages.Add(@{ nb = $nb; path = @($path + @($c.name)); p = $p }) } }
  }
}
$books = $x.SelectNodes('/one:Notebooks/one:Notebook', $ns)
foreach ($nb in $books) { Walk $nb $nb.name @() }
Emit @{ type = 'start'; total = $pages.Count; notebooks = $books.Count }

foreach ($e in $pages) {
  $p = $e.p
  try {
    $xml = ''; $on.GetPageContent($p.ID, [ref]$xml, 1)   # 1 = include pictures
    $pdf = $null
    if ($xml -match '<one:Ink(Drawing|Word|Paragraph)') {
      $tmp = Join-Path $env:TEMP ("hs-" + [guid]::NewGuid().ToString('N') + '.pdf')
      try { $on.Publish($p.ID, $tmp, 3, ''); $pdf = [Convert]::ToBase64String([IO.File]::ReadAllBytes($tmp)) } catch {} finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
    }
    Emit @{ type = 'page'; notebook = $e.nb; path = $e.path; oneId = $p.ID; title = $p.name; created = $p.dateTime; modified = $p.lastModifiedTime; level = $p.pageLevel; xml = $xml; pdf = $pdf }
  } catch { Emit @{ type = 'page-error'; notebook = $e.nb; path = $e.path; title = $p.name; error = $_.Exception.Message } }
}
Emit @{ type = 'end' }
