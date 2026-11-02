// CRATE ⇩ GET: paste a SoundCloud link → a free track lands in the folder you pick, tagged (cover, clean
// Artist / Title, genre, year, label), named "Artist - Title", and goes into rekordbox in a playlist named
// after that folder the next time rekordbox is closed.
//
// Any track link works; the panel still says whether the artist gives it away and shows the buy link when
// they sell it. The audio comes through klickaud.org, opened in its own window with your
// link filled in. Its "are you human" check is yours to pass: you press Convert and Download there, HYPERSPACE
// catches the file. That window runs in a throwaway session (no cookies or history kept) and can't open popups.
const { BrowserWindow, nativeImage, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { EventEmitter } = require('events');
const { SoundCloud } = require('./soundcloud');

const KLICKAUD = 'https://www.klickaud.org/en17/';
const GATES = /hypeddit|toneden|laylo|droploud|gaterush|theartistunion|edmdisc|bfan\.link|feature\.fm|ffm\.to|smarturl|dropbox|drive\.google|mega\.nz|soundcloud\.com/i;
const AUDIO = /\.(mp3|wav|m4a|aac|flac|aiff?|ogg|opus)(\?|$)/i;
const BAD_NAME = /[<>:"/\\|?*\x00-\x1f]/g;

// ---- names / genre (same rules as the rekordbox clean-up) ----
const squash = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');
const JUNK = [/\bklickaud\b/gi, /[[(*]\s*free\s*(dl|download)\s*[\])*]?/gi, /\bfree\s*(dl|download)\b/gi, /[[(]\s*out\s*now\s*[\])]/gi, /\bout\s*now\b/gi, /[[(]\s*preview\s*[\])]/gi, /\*+/g];
const PROMO = /\s*[[(]([^\])]*\b(records|recordings|music group|premiere|premier|exclusive|free release)\b[^\])]*)[\])]\s*/i;
function tidy(s) {
  let t = String(s || '').replace(/_/g, ' ');
  for (const re of JUNK) t = t.replace(re, ' ');
  return t.replace(PROMO, ' ').replace(/\(\s*\)|\[\s*\]/g, ' ').replace(/\s{2,}/g, ' ').replace(/^[\s\-–|:]+|[\s\-–|:]+$/g, '').trim();
}
const RULES = [
  [/riddim/, 'Riddim'], [/tear ?out/, 'Tearout'], [/deathstep/, 'Deathstep'], [/colou?r ?bass/, 'Colour Bass'],
  [/melodic/, 'Melodic Bass'], [/\bwave\b|wavestep/, 'Wave'], [/mid-?tempo/, 'Midtempo'],
  [/drum ?(and|&|n|'n') ?bass|\bdnb\b|\bd&b\b|jungle|neurofunk/, 'Drum & Bass'], [/bass ?house|\bg-?house\b/, 'Bass House'],
  [/hardstyle|rawstyle/, 'Hardstyle'], [/psy ?trance/, 'Psytrance'], [/techno/, 'Techno'], [/trance/, 'Trance'],
  [/tech ?house|deep house|\bhouse\b/, 'House'], [/hybrid trap|\btrap\b/, 'Trap'], [/hip ?hop|\brap\b/, 'Hip-Hop'],
  [/experimental|glitch|tipper|psybass|downtempo/, 'Experimental Bass'], [/brostep/, 'Brostep'],
  [/dubstep|dub step|bass music|filthy/, 'Dubstep'],
];
function describe(r) {
  const who = [r.user?.username, r.publisher_metadata?.artist].map(squash).filter(Boolean);
  const t = tidy(r.title);
  const m = t.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  let artist, title;
  if (m && who.includes(squash(m[2])) && !who.includes(squash(m[1]))) [title, artist] = [m[1], m[2]]; // "Lemons - Hairitage" by Hairitage
  else if (m) [artist, title] = [m[1], m[2]];
  else { artist = r.publisher_metadata?.artist || r.user?.username || ''; title = t; }
  const text = [r.genre, r.tag_list, r.title].join(' ').toLowerCase();
  const genre = (RULES.find(([re]) => re.test(text)) || [])[1] || (r.genre ? String(r.genre).slice(0, 40) : 'Electronic');
  const year = parseInt(String(r.release_date || r.display_date || r.created_at || '').slice(0, 4), 10) || null;
  const label = String(r.label_name || '').replace(/^\s*[℗©]\s*(\d{4}\b)?/, '').trim() || null;
  return { artist: artist.trim(), title: title.trim(), genre, year, label };
}
// what the artist allows
function freeness(r) {
  const text = `${r.title} ${r.description || ''} ${r.purchase_title || ''}`;
  if (r.downloadable) return { free: true, why: 'the artist switched on downloads' };
  if (/free\s*(dl|download)|freebie|\bfree\b.*\b(dl|download)/i.test(text)) return { free: true, why: 'marked FREE DOWNLOAD' };
  if (r.purchase_url && GATES.test(r.purchase_url) && /free|download|dl/i.test(r.purchase_title || '')) return { free: true, why: 'free download link' };
  return { free: false, why: r.purchase_url ? 'the artist sells this one' : 'not offered for download' };
}

class Grab extends EventEmitter {
  constructor({ dataDir, coreExe, sc, getConfig, setConfig, parent }) {
    super();
    Object.assign(this, { dataDir, coreExe, sc, getConfig, setConfig, parent });
    this.queueFile = path.join(dataDir, 'rekordbox-queue.json');
    this.jobs = [];
    // test runs never touch the real rekordbox (flush() refuses too, whoever calls it)
    this.live = !process.env.HS_SNAPSHOT;
    if (!this.live) return;
    this.timer = setInterval(() => this.flush().catch(() => {}), 20000);
    setTimeout(() => this.flush().catch(() => {}), 5000);
  }

  cfg() { return { root: path.join(os.homedir(), 'Music'), recent: [], ...(this.getConfig() || {}) }; }

  // your music folders, most recently used first
  folders() {
    const c = this.cfg();
    let subs = [];
    try {
      subs = fs.readdirSync(c.root, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('_'))
        .map((d) => { const p = path.join(c.root, d.name); let t = 0; try { t = fs.statSync(p).mtimeMs; } catch {} return { p, t }; })
        .sort((a, b) => b.t - a.t).map((x) => x.p);
    } catch {}
    const list = [...new Set([...c.recent.filter((p) => fs.existsSync(p)), ...subs])].slice(0, 40);
    return { root: c.root, folders: list.map((p) => ({ path: p, name: path.basename(p) })), queue: this.queue().length };
  }

  async info(url) {
    url = String(url || '').trim().split('?')[0];
    if (!/^https?:\/\/((www|m)\.)?soundcloud\.com\/[^/]+\/[^/]+|^https?:\/\/on\.soundcloud\.com\//i.test(url)) throw new Error('paste a soundcloud.com track link');
    const r = await this.sc.api(`/resolve?url=${encodeURIComponent(url)}`);
    if (!r || r.kind !== 'track') throw new Error("that link isn't a track (playlists and profiles aren't supported yet)");
    const d = describe(r);
    return { url: r.permalink_url, scId: r.id, ...d, scTitle: r.title, user: r.user?.username, len: Math.round((r.full_duration || r.duration || 0) / 1000),
      art: (r.artwork_url || r.user?.avatar_url || '').replace(/-large(\.\w+)?$/, '-t500x500$1'), buy: r.purchase_url || null, ...freeness(r), raw: r };
  }

  list() { return this.jobs.map(({ raw, win, info, ...j }) => j); }
  update(job, patch) { Object.assign(job, patch); this.emit('progress', { jobs: this.list(), queue: this.queue().length }); }

  // start: open klickaud with the link filled in; the file it hands over is caught and finished here
  async start({ url, folder, newFolder }) {
    const i = await this.info(url); // free or not, klickaud opens: whether to support the artist is your call
    let dir = folder;
    if (newFolder) {
      const name = String(newFolder).replace(BAD_NAME, '').trim();
      if (!name) throw new Error('give the new folder a name');
      dir = path.join(this.cfg().root, name);
    }
    if (!dir) throw new Error('pick a folder');
    fs.mkdirSync(dir, { recursive: true });
    const c = this.cfg();
    this.setConfig({ ...c, recent: [dir, ...c.recent.filter((p) => p !== dir)].slice(0, 12) });

    const job = { id: Date.now().toString(36), url: i.url, title: `${i.artist} - ${i.title}`, folder: dir, playlist: path.basename(dir), state: 'klickaud', note: 'press Convert, then Download, in the klickaud window', pct: 0, raw: i.raw, info: i };
    this.jobs.unshift(job);
    this.jobs = this.jobs.slice(0, 30);
    this.update(job, {});
    this.openKlickaud(job);
    return { id: job.id };
  }

  openKlickaud(job) {
    const w = new BrowserWindow({
      parent: this.parent(), width: 1040, height: 780, title: 'klickaud — HYPERSPACE', autoHideMenuBar: true, backgroundColor: '#000',
      // no "persist:" = in-memory only: nothing from this site is kept after the window closes
      webPreferences: { partition: `grab-${job.id}`, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
    });
    w.hsGrab = true;
    job.win = w;
    const ses = w.webContents.session;
    let got = false;
    // Nothing leaves klickaud: a link to anywhere else (new tab or same tab) is only ever fetched as a file,
    // never shown, and will-download below drops it unless it's audio. Ads get nowhere; the real file can't be missed.
    const onSite = (u) => /^https:\/\/(www\.)?klickaud\.org\//i.test(u);
    const fetchFile = (u) => { if (/^https?:\/\//i.test(u)) w.webContents.downloadURL(u); };
    w.webContents.setWindowOpenHandler(({ url }) => { if (!onSite(url) || AUDIO.test(url)) fetchFile(url); return { action: 'deny' }; });
    w.webContents.on('will-navigate', (e, u) => {
      if (onSite(u) && !AUDIO.test(u)) return;
      e.preventDefault();
      fetchFile(u);
    });
    // audio that would play in the page is saved instead
    ses.webRequest.onHeadersReceived({ urls: ['*://*/*'] }, (d, cb) => {
      const h = d.responseHeaders || {};
      const type = String((h['content-type'] || h['Content-Type'] || [''])[0]);
      if ((d.resourceType === 'mainFrame' || d.resourceType === 'subFrame') && /^audio\//i.test(type)) h['Content-Disposition'] = ['attachment'];
      cb({ responseHeaders: h });
    });
    ses.on('will-download', (e, item) => {
      const mime = item.getMimeType() || '', name = item.getFilename() || '';
      const audio = /^audio\//i.test(mime) || AUDIO.test(name) || (/octet-stream/i.test(mime) && AUDIO.test(item.getURL()));
      if (!audio || got) { item.cancel(); return; } // ad pages, a second click: dropped
      got = true;
      let ext = path.extname(name).toLowerCase();
      if (!AUDIO.test(ext)) ext = /wav/i.test(mime) ? '.wav' : /mp4|m4a|aac/i.test(mime) ? '.m4a' : /flac/i.test(mime) ? '.flac' : '.mp3';
      const tmp = path.join(job.folder, `.hs-grab-${job.id}${ext}`);
      item.setSavePath(tmp);
      this.update(job, { state: 'downloading', note: 'downloading…' });
      item.on('updated', () => { const t = item.getTotalBytes(); if (t) this.update(job, { pct: Math.round((item.getReceivedBytes() / t) * 100) }); });
      item.once('done', (ev, st) => {
        if (st !== 'completed') return this.update(job, { state: 'failed', note: `download ${st}` });
        if (!w.isDestroyed()) w.close();
        this.finish(job, tmp).catch((err) => this.update(job, { state: 'failed', note: err.message }));
      });
    });
    w.on('closed', () => { job.win = null; if (!got && job.state === 'klickaud') this.update(job, { state: 'cancelled', note: 'window closed before a download' }); });
    w.webContents.on('did-finish-load', () => {
      w.webContents.executeJavaScript(`(()=>{const i=document.querySelector('input[name="value"]'); if(i&&!i.value){i.value=${JSON.stringify(job.url)}; i.dispatchEvent(new Event('input',{bubbles:true})); i.dispatchEvent(new Event('change',{bubbles:true}));}})()`).catch(() => {});
    });
    w.loadURL(KLICKAUD);
  }

  // tag, name, cover, then queue for rekordbox
  async finish(job, tmp) {
    const i = job.info, r = job.raw;
    this.update(job, { state: 'tagging', note: 'adding cover and clean tags…' });
    const id = String(100000000 + Math.floor(Math.random() * 2000000000));
    // SoundCloud details + cover are kept under the rekordbox id this track will get, so CRATE knows it right away
    this.sc.db.tracks[id] = SoundCloud.entry(r, 1, 'manual');
    this.sc.db.tracks[id].art = await this.sc.saveArt(id, r);
    this.sc.save(true);
    // kept until the track is in rekordbox (which can be days, if rekordbox stays open)
    const work = path.join(this.dataDir, 'grab-work', job.id);
    fs.mkdirSync(work, { recursive: true });
    // SoundCloud covers are sometimes PNG: rekordbox and the file tag get real JPEGs at 500 / 240 / 80
    let art = null, a240 = null, a80 = null;
    if (this.sc.artPath(id)) {
      const img = nativeImage.createFromBuffer(fs.readFileSync(this.sc.artPath(id)));
      if (!img.isEmpty()) {
        const jpg = (size, name) => { const p = path.join(work, name); fs.writeFileSync(p, img.resize({ width: size, height: size, quality: 'best' }).toJPEG(90)); return p; };
        art = jpg(500, 'art500.jpg'); a240 = jpg(240, 'art240.jpg'); a80 = jpg(80, 'art80.jpg');
      }
    }
    const ext = path.extname(tmp);
    const base = `${i.artist} - ${i.title}`.replace(BAD_NAME, '').replace(/\s+/g, ' ').trim().slice(0, 150) || `soundcloud-${i.scId}`;
    let dest = path.join(job.folder, base + ext);
    for (let n = 2; fs.existsSync(dest); n++) dest = path.join(job.folder, `${base} (${n})${ext}`);

    const plan = [{ path: tmp, title: i.title, artist: i.artist, genre: i.genre, year: i.year || undefined, label: i.label || undefined, art: art || undefined }];
    fs.writeFileSync(path.join(work, 'plan.json'), JSON.stringify(plan));
    await this.run(['--retag', path.join(work, 'plan.json'), path.join(work, 'backup')]);
    fs.renameSync(tmp, dest);
    const q = this.queue();
    q.push({ id, path: dest, title: i.title, artist: i.artist, genre: i.genre, label: i.label, year: i.year || 0, art500: art, art240: a240, art80: a80, playlist: job.playlist, job: job.id });
    this.saveQueue(q);
    this.update(job, { state: 'queued', file: dest, note: 'saved — goes into rekordbox when rekordbox is closed', pct: 100 });
    this.flush().catch(() => {});
  }

  queue() { try { return JSON.parse(fs.readFileSync(this.queueFile, 'utf8')); } catch { return []; } }
  saveQueue(q) { fs.writeFileSync(this.queueFile, JSON.stringify(q, null, 1)); }

  rekordboxOpen() {
    return new Promise((res) => execFile('tasklist', ['/FI', 'IMAGENAME eq rekordbox.exe', '/NH'], { windowsHide: true }, (e, out) => res(/rekordbox\.exe/i.test(String(out || '')))));
  }

  // rekordbox closed + something waiting → add it (master.db is copied aside first, kept: last 10)
  async flush() {
    if (this.flushing || !this.live) return;
    const q = this.queue().filter((x) => fs.existsSync(x.path));
    if (!q.length || await this.rekordboxOpen()) return;
    this.flushing = true;
    try {
      const bdir = path.join(os.homedir(), 'Documents', 'HYPERSPACE Backups', 'rekordbox auto');
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
      const qf = path.join(os.tmpdir(), `hs-rbq-${Date.now()}.json`);
      fs.writeFileSync(qf, JSON.stringify(q));
      const out = await this.run(['--rb-add', qf, path.join(bdir, stamp)]);
      const m = out.match(/^OK (.+)$/m);
      if (!m) throw new Error(out.trim().split('\n').pop() || 'rekordbox add failed');
      const done = JSON.parse(m[1]);
      for (const d of done) {
        const want = q.find((x) => path.resolve(x.path).toLowerCase() === path.resolve(d.path).toLowerCase());
        // rekordbox already had it / picked another id: move CRATE's SoundCloud details over
        if (want && want.id !== d.id && this.sc.db.tracks[want.id]) {
          this.sc.db.tracks[d.id] = this.sc.db.tracks[want.id]; delete this.sc.db.tracks[want.id];
          try { fs.renameSync(path.join(this.sc.artDir, `${want.id}.jpg`), path.join(this.sc.artDir, `${d.id}.jpg`)); } catch {}
          this.sc.save(true);
        }
        if (want?.job) try { fs.rmSync(path.join(this.dataDir, 'grab-work', want.job), { recursive: true, force: true }); } catch {}
        const job = want && this.jobs.find((j) => j.id === want.job);
        if (job) Object.assign(job, { state: 'done', note: `in rekordbox → playlist "${want.playlist}"` });
      }
      this.saveQueue(this.queue().filter((x) => !done.some((d) => path.resolve(d.path).toLowerCase() === path.resolve(x.path).toLowerCase())));
      try { const old = fs.readdirSync(bdir).sort(); for (const o of old.slice(0, -10)) fs.rmSync(path.join(bdir, o), { recursive: true, force: true }); } catch {}
      this.emit('progress', { jobs: this.list(), queue: this.queue().length, rekordbox: done.length });
    } finally { this.flushing = false; }
  }

  run(args) {
    return new Promise((res, rej) => {
      const p = spawn(this.coreExe, args, { windowsHide: true });
      let out = '';
      p.stdout.on('data', (d) => { out += d; });
      p.stderr.on('data', (d) => { out += d; });
      p.on('error', rej);
      p.on('exit', (code) => (code === 0 || code === 2 ? res(out) : rej(new Error(out.trim().split('\n').pop() || `HyperCore exited ${code}`))));
    });
  }

  // dev check of everything after the download (HS_GRABTEST="<link>|<audio file>|<folder>" in a test run)
  async selfTest(spec) {
    const [url, file, dir] = spec.split('|');
    const i = await this.info(url);
    fs.mkdirSync(dir, { recursive: true });
    const job = { id: 't' + Date.now().toString(36), url: i.url, title: `${i.artist} - ${i.title}`, folder: dir, playlist: path.basename(dir), state: 'downloading', raw: i.raw, info: i };
    this.jobs.unshift(job);
    const tmp = path.join(dir, `.hs-grab-${job.id}${path.extname(file)}`);
    fs.copyFileSync(file, tmp);
    await this.finish(job, tmp);
    return job;
  }

  openBuy(url) { if (/^https?:\/\//i.test(url)) shell.openExternal(url); }
}

module.exports = { Grab, describe, freeness };
