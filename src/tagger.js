// Track auto-tagger: a song that lands in Downloads gets its BPM and key worked out (HyperCore --analyze), is
// renamed "Artist - Title [128 BPM 8A]" and moved into this month's folder in your Music library ("Oct 26").
// Short files (samples, under 90 s) are left for the file router. Never overwrites; every move can be undone.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { Router } = require('./router');

const AUDIO = /\.(mp3|wav|flac|m4a|aac|aiff?|ogg|opus)$/i;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TAG_RE = /\s*\[\d+(?:\.\d+)? BPM \d{1,2}[AB]\]/i;
// the bits download sites and rippers bolt on
const JUNK = [
  /[([](?:official\s*)?(?:music\s*)?(?:video|audio|visuali[sz]er|lyrics?(?:\s*video)?)[)\]]/gi,
  /[([](?:free\s*(?:dl|download)|out now|hq|hd|320(?:\s*kbps)?|premiere|clip)[^)\]]*[)\]]/gi,
  /[_\s-]*klickaud\b/gi, /\bfree\s+download\b/gi,
];

// "128 BPM 8A" written into a file name by the tagger reads straight back out
function fromName(file) {
  const m = path.basename(file).match(/\[(\d+(?:\.\d+)?) BPM (\d{1,2}[AB])\]/i);
  return m ? { bpm: +m[1], key: m[2].toUpperCase() } : null;
}

function clean(s) {
  if (!s) return '';
  let t = String(s).replace(TAG_RE, '');
  for (const re of JUNK) t = t.replace(re, ' ');
  return t.replace(/_/g, ' ').replace(/^\s*(?:0\d|\d{1,3}\s*[.)-])\s+/, '') /* "01 " / "3. " track numbers, not "50 Cent" */.replace(/\s{2,}/g, ' ').replace(/\s+([)\]])/g, '$1').trim();
}

function tagName(file, r) {
  const base = clean(path.basename(file, path.extname(file)));
  const m = base.match(/^(.+?)\s+-\s+(.+)$/);
  let artist = clean(r.artist), title = clean(r.title);
  if (!title) { title = m ? m[2] : base; if (!artist && m) artist = m[1]; }
  else if (!artist && m) artist = m[1];
  // a title that already starts with the artist ("Artist - Title" stuffed into the title tag)
  if (artist && title.toLowerCase().startsWith(`${artist.toLowerCase()} - `)) title = title.slice(artist.length + 3);
  const bpm = Math.round(r.bpm);
  const name = `${artist ? `${artist} - ` : ''}${title || 'Untitled'} [${bpm} BPM ${r.key}]`;
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\.+$/, '').slice(0, 180) + path.extname(file).toLowerCase();
}

// this month's folder in Music, matching how you already name them ("Oct 26", "June 26"…), made if it's missing
function monthFolder(music, now = new Date()) {
  const mon = MONTHS[now.getMonth()], yy = String(now.getFullYear()).slice(-2);
  try {
    const re = new RegExp(`^${mon}[a-z]*\\.?\\s+'?${yy}$`, 'i');
    const hit = fs.readdirSync(music, { withFileTypes: true }).find((d) => d.isDirectory() && re.test(d.name));
    if (hit) return path.join(music, hit.name);
  } catch {}
  return path.join(music, `${mon} ${yy}`);
}

// BPM + key of one file. All tracks go to one `HyperCore --analyze-serve` (an ordinary, non-admin process: these
// are downloaded files) that works on two at a time and ends after a minute with nothing to do. Starting HyperCore
// for every track cost ~0.3 s of start-up each; a server that won't start falls back to exactly that.
const anaSrv = { proc: null, seq: 0, waiting: new Map(), idle: null, broken: false };
function analyzeOnce(coreExe, file, write) {
  return new Promise((resolve) => {
    execFile(coreExe, ['--analyze', file, ...(write ? ['--write'] : [])], { windowsHide: true, timeout: 180000 }, (e, out) => {
      try { resolve(JSON.parse(String(out).trim().split(/\r?\n/).pop())); } catch { resolve({ ok: false, error: e?.message || 'no answer' }); }
    });
  });
}
function analyzeServer(coreExe) {
  if (anaSrv.proc) return anaSrv.proc;
  const p = require('child_process').spawn(coreExe, ['--analyze-serve'], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  anaSrv.proc = p;
  let buf = '';
  p.stdout.setEncoding('utf8');
  p.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      let m = null;
      try { m = JSON.parse(buf.slice(0, i)); } catch {}
      buf = buf.slice(i + 1);
      const w = m && anaSrv.waiting.get(String(m.id));
      if (w) { anaSrv.waiting.delete(String(m.id)); clearTimeout(w.t); delete m.id; w.resolve(m); }
    }
  });
  const gone = (err) => {
    if (anaSrv.proc !== p) return;
    anaSrv.proc = null;
    if (err) anaSrv.broken = true; // couldn't even start: use one process per track from now on
    for (const [, w] of anaSrv.waiting) { clearTimeout(w.t); w.retry(); }
    anaSrv.waiting.clear();
  };
  p.on('error', () => gone(true));
  p.on('exit', () => gone(false));
  p.stdin.on('error', () => {});
  return p;
}
function analyze(coreExe, file, write = false) {
  if (anaSrv.broken) return analyzeOnce(coreExe, file, write);
  return new Promise((resolve) => {
    const p = analyzeServer(coreExe);
    const id = String(++anaSrv.seq);
    clearTimeout(anaSrv.idle);
    // (if the server dies or a track takes over 3 minutes, that track is done the old way)
    const retry = () => analyzeOnce(coreExe, file, write).then(resolve);
    const t = setTimeout(() => { anaSrv.waiting.delete(id); if (!anaSrv.waiting.size) anaSrv.idle = setTimeout(() => { try { anaSrv.proc?.stdin.end(); } catch {} }, 60000); retry(); }, 180000);
    anaSrv.waiting.set(id, { resolve: (r) => { if (!anaSrv.waiting.size) anaSrv.idle = setTimeout(() => { try { anaSrv.proc?.stdin.end(); } catch {} }, 60000); resolve(r); }, retry, t });
    p.stdin.write(JSON.stringify({ id, path: file, write }) + '\n');
  });
}

class Tagger extends Router {
  constructor({ downloads, music, coreExe, dataDir }) {
    super({ downloads, base: music });
    this.music = music;
    this.coreExe = coreExe;
    this.logFile = path.join(dataDir, 'tagger.json');
    try { this.log = JSON.parse(fs.readFileSync(this.logFile, 'utf8')); } catch { this.log = []; }
  }

  defaults() { return { enabled: true, watch: [this.downloads], minLen: 90 }; }
  status() { return { enabled: this.cfg.enabled, watching: this.watchers.length, dest: monthFolder(this.music), busy: this.pending.size, log: this.log.slice(0, 50) }; }
  // the file router leaves audio alone while the tagger is on: the tagger hands it short files (samples) back
  claims(file) { return this.cfg.enabled && AUDIO.test(file); }
  rule(file) { return AUDIO.test(file) ? { name: 'TAGGER' } : null; }
  save() { fs.promises.writeFile(this.logFile, JSON.stringify(this.log.slice(0, 200))).catch(() => {}); }

  async route(full) {
    this.emit('status', { ...this.status(), busy: this.pending.size + 1, now: path.basename(full) });
    const r = await analyze(this.coreExe, full, true);
    if (!r.ok || r.len < this.cfg.minLen) { this.emit('short', full, r); this.emit('status', this.status()); return null; }
    const target = await this.unique(path.join(monthFolder(this.music), tagName(full, r)));
    await this.move(full, target);
    const entry = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, time: Date.now(), from: full, to: target,
      oldName: path.basename(full), newName: path.basename(target), bpm: Math.round(r.bpm), key: r.key, len: r.len,
    };
    this.log.unshift(entry);
    this.log = this.log.slice(0, 200);
    this.save();
    this.emit('tagged', entry);
    this.emit('status', this.status());
    return entry;
  }

  async undo(id) {
    const e = this.log.find((x) => x.id === id);
    if (!e || e.undone) throw new Error('nothing to undo');
    const back = await this.unique(e.from);
    await this.move(e.to, back);
    e.undone = true;
    this.save();
    this.emit('status', this.status());
    return e;
  }
}

module.exports = { Tagger, analyze, fromName, clean, tagName, monthFolder, AUDIO };
