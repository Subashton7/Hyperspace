// CRATE ← SoundCloud. Your tracks came from SoundCloud, so each one is looked up there (through the same
// public web API the soundcloud.com player uses) by its cleaned-up name and matched on title words + exact
// length. A match brings the artwork (500×500, saved locally), release date, genre, tags, label, uploader,
// play/like/repost counts, description and buy/free-download link. Wrong match? Paste the right link.
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const API = 'https://api-v2.soundcloud.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const JUNK = /\b(klickaud|free\s*(dl|download)|preview|out\s*now|hq|320|mp3)\b/gi;
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(JUNK, ' ').replace(/[_\-–—()[\]{}.,!?'"&+:;/\\|*#~^]/g, ' ').replace(/\s+/g, ' ').trim();
const words = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 1 || /\d/.test(w)));

class SoundCloud extends EventEmitter {
  constructor(dataDir) {
    super();
    this.file = path.join(dataDir, 'soundcloud.json');
    this.artDir = path.join(dataDir, 'artwork');
    this.db = { tracks: {}, client: null };
    try { this.db = { tracks: {}, client: null, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) }; } catch {}
    this.job = null;
    this.saveTimer = null;
  }

  save(now = false) {
    clearTimeout(this.saveTimer);
    const write = () => { try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.db)); } catch {} };
    if (now) write(); else this.saveTimer = setTimeout(write, 1500);
  }

  get(id) { return this.db.tracks[id] || null; }
  artPath(id) { const p = path.join(this.artDir, `${id}.jpg`); return fs.existsSync(p) ? p : null; }

  // the web player's client id, read from its own scripts (it changes now and then)
  async clientId(force = false) {
    const c = this.db.client;
    if (!force && c?.id && Date.now() - c.at < 12 * 3600e3) return c.id;
    const home = await (await fetch('https://soundcloud.com/', { headers: { 'User-Agent': UA } })).text();
    const scripts = [...home.matchAll(/<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map((m) => m[1]).reverse();
    for (const s of scripts) {
      const m = (await (await fetch(s, { headers: { 'User-Agent': UA } })).text()).match(/client_id\s*[:=]\s*"([a-zA-Z0-9]{32})"/);
      if (m) { this.db.client = { id: m[1], at: Date.now() }; this.save(); return m[1]; }
    }
    throw new Error("couldn't reach SoundCloud");
  }

  async api(p, retry = 0) {
    const id = await this.clientId(retry > 0);
    const r = await fetch(`${API}${p}${p.includes('?') ? '&' : '?'}client_id=${id}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if ((r.status === 401 || r.status === 403) && retry < 1) return this.api(p, retry + 1);
    if (r.status === 429 && retry < 3) { this.emit('progress', { ...this.status(), note: 'SoundCloud asked us to slow down…' }); await sleep(30000 * (retry + 1)); return this.api(p, retry + 1); }
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`SoundCloud ${r.status}`);
    return r.json();
  }

  // what we search for: the cleaned title, plus the artist when rekordbox knows one
  static query(t) {
    let title = String(t.title || path.basename(t.path || '', path.extname(t.path || ''))).replace(/_/g, ' ');
    title = title.replace(JUNK, ' ').replace(/\s+/g, ' ').trim();
    const artist = t.artist && !norm(title).includes(norm(t.artist)) ? t.artist : '';
    return `${artist} ${title}`.trim().slice(0, 120);
  }

  // 0..1: how many of our name's words the candidate has, and how close its length is
  static score(t, r) {
    const ours = words(SoundCloud.query(t));
    const theirs = words(`${r.title} ${r.user?.username || ''} ${r.publisher_metadata?.artist || ''}`);
    let hit = 0;
    for (const w of ours) if (theirs.has(w)) hit++;
    const recall = ours.size ? hit / ours.size : 0;
    const dur = (r.full_duration || r.duration || 0) / 1000;
    let d = 0.5;
    if (t.len && dur) { const diff = Math.abs(dur - t.len); d = diff <= 2 ? 1 : diff <= 6 ? 0.7 : diff <= 15 ? 0.3 : 0; }
    return Math.min(1, recall * 0.62 + d * 0.38 + Math.log10((r.playback_count || 0) + 1) / 200);
  }

  static entry(r, confidence, how) {
    const tags = [...String(r.tag_list || '').matchAll(/"([^"]+)"|(\S+)/g)].map((m) => m[1] || m[2]).filter(Boolean).slice(0, 14);
    const pm = r.publisher_metadata || {};
    return {
      s: how, c: Math.round(confidence * 100) / 100, id: r.id, url: r.permalink_url, title: r.title,
      user: r.user?.username, userUrl: r.user?.permalink_url, verified: !!r.user?.verified, followers: r.user?.followers_count,
      released: r.release_date || r.display_date || r.created_at, uploaded: r.created_at,
      genre: r.genre || null, tags, label: r.label_name || pm.p_line || null, artist: pm.artist || null, album: pm.album_title || pm.release_title || null,
      isrc: pm.isrc || null, desc: String(r.description || '').slice(0, 800),
      plays: r.playback_count, likes: r.likes_count, reposts: r.reposts_count, comments: r.comment_count,
      buy: r.purchase_url ? { url: r.purchase_url, title: r.purchase_title || 'BUY / FREE DL' } : null,
      dl: !!r.downloadable, len: Math.round((r.full_duration || r.duration || 0) / 1000), fetched: Date.now(),
    };
  }

  async saveArt(id, r) {
    const url = (r.artwork_url || r.user?.avatar_url || '').replace(/-large(\.\w+)?$/, '-t500x500$1');
    if (!url) return false;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) return false;
      fs.mkdirSync(this.artDir, { recursive: true });
      fs.writeFileSync(path.join(this.artDir, `${id}.jpg`), Buffer.from(await res.arrayBuffer()));
      return true;
    } catch { return false; }
  }

  async lookup(t) {
    const q = SoundCloud.query(t);
    if (!q) return null;
    const j = await this.api(`/search/tracks?q=${encodeURIComponent(q)}&limit=10`);
    const best = (j?.collection || []).map((r) => ({ r, s: SoundCloud.score(t, r) })).sort((a, b) => b.s - a.s)[0];
    return best && best.s >= 0.6 ? best : null;
  }

  status() {
    const all = Object.values(this.db.tracks);
    return {
      running: !!this.job, done: this.job?.done || 0, total: this.job?.total || 0, current: this.job?.current || null,
      matched: all.filter((x) => x.s === 'ok' || x.s === 'manual').length, none: all.filter((x) => x.s === 'none').length, known: all.length,
    };
  }

  // walk the library (skipping what we already know unless redo), politely: about one search a second
  async fetchAll(tracks, { redo = false } = {}) {
    if (this.job) return this.status();
    const todo = tracks.filter((t) => t.exists !== false && (redo ? this.db.tracks[t.id]?.s !== 'manual' : !this.db.tracks[t.id]));
    const job = this.job = { done: 0, total: todo.length, current: null, stop: false };
    this.emit('progress', this.status());
    (async () => {
      for (const t of todo) {
        if (job.stop) break;
        job.current = SoundCloud.query(t);
        try {
          const m = await this.lookup(t);
          if (m) {
            this.db.tracks[t.id] = SoundCloud.entry(m.r, m.s, 'ok');
            this.db.tracks[t.id].art = await this.saveArt(t.id, m.r);
          } else this.db.tracks[t.id] = { s: 'none', fetched: Date.now() };
        } catch (e) {
          if (/reach SoundCloud/.test(e.message)) { job.error = e.message; break; }
        }
        job.done++;
        this.save();
        this.emit('progress', this.status());
        this.emit('track', t.id);
        await sleep(900);
      }
      this.job = null;
      this.save(true);
      this.emit('progress', { ...this.status(), finished: true, error: job.error || null });
    })();
    return this.status();
  }

  stop() { if (this.job) this.job.stop = true; return this.status(); }

  // you know better: use this exact SoundCloud page
  async setUrl(t, url) {
    if (!/^https?:\/\/(www\.|m\.)?soundcloud\.com\//i.test(url)) throw new Error('paste a soundcloud.com track link');
    const r = await this.api(`/resolve?url=${encodeURIComponent(url.split('?')[0])}`);
    if (!r || r.kind !== 'track') throw new Error("that link isn't a track");
    this.db.tracks[t.id] = SoundCloud.entry(r, 1, 'manual');
    this.db.tracks[t.id].art = await this.saveArt(t.id, r);
    this.save(true);
    return this.db.tracks[t.id];
  }

  clear(id) { delete this.db.tracks[id]; try { fs.unlinkSync(path.join(this.artDir, `${id}.jpg`)); } catch {} this.save(); return null; }
}

module.exports = { SoundCloud };
