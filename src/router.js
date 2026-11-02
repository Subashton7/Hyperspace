// Asset router: watches folders (Downloads by default) and moves new samples, videos, vectors, 3D models...
// into working folders, optionally cleaning/renaming them. Off until enabled; never touches files that were
// already there when watching started; waits for downloads to finish; never overwrites.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const EventEmitter = require('events');

const TEMP = /\.(crdownload|part|partial|tmp|download|opdownload|!ut|filepart|aria2)$/i;

function defaultRules(base) {
  const d = (...p) => path.join(base, ...p);
  return [
    { id: 'video', name: 'VIDEO → ALLEY', glyph: '▶', exts: ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v', 'wmv'], dest: d('Video', 'To Convert'), rename: '{name}', enabled: true },
    { id: 'audio', name: 'SAMPLES', glyph: '♫', exts: ['wav', 'aif', 'aiff', 'flac', 'mp3', 'ogg', 'm4a'], dest: d('Samples'), rename: '{name}', enabled: true },
    { id: 'vector', name: 'VECTORS', glyph: '◇', exts: ['svg', 'ai', 'eps', 'dxf', 'cdr'], dest: d('Vectors'), rename: '{name}', enabled: true },
    { id: 'model', name: '3D MODELS', glyph: '⬡', exts: ['obj', 'fbx', 'glb', 'gltf', 'stl', 'blend', '3ds', 'dae', 'ply', 'usd', 'usdz', 'abc', 'c4d'], dest: d('3D Models'), rename: '{name}', enabled: true },
    { id: 'image', name: 'IMAGES', glyph: '▣', exts: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'tif', 'tiff', 'psd', 'exr', 'hdr'], dest: d('Images'), rename: '{name}', enabled: false },
    { id: 'preset', name: 'PRESETS & PACKS', glyph: '◬', exts: ['adg', 'adv', 'alp', 'als', 'fxp', 'fxb', 'vital', 'avc'], dest: d('Presets'), rename: '{name}', enabled: false },
  ];
}

class Router extends EventEmitter {
  constructor({ downloads, base }) {
    super();
    this.downloads = downloads;
    this.base = base;
    this.cfg = this.defaults();
    this.watchers = [];
    this.pending = new Set();
    this.existing = new Set();
    this.log = [];
  }

  defaults() {
    return { enabled: false, watch: [this.downloads], clean: true, popup: true, rules: defaultRules(this.base) };
  }

  configure(cfg) {
    this.cfg = { ...this.defaults(), ...(cfg || {}) };
    if (!Array.isArray(this.cfg.rules) || !this.cfg.rules.length) this.cfg.rules = defaultRules(this.base);
    this.start();
  }

  start() {
    this.stop();
    if (!this.cfg.enabled) return this.emit('status', this.status());
    for (const dir of this.cfg.watch) {
      try {
        for (const f of fs.readdirSync(dir)) this.existing.add(path.join(dir, f).toLowerCase());
        const w = fs.watch(dir, (ev, name) => { if (name) this.onEvent(dir, String(name)); });
        w.on('error', () => {});
        this.watchers.push(w);
      } catch (e) { this.emit('error', `can't watch ${dir}: ${e.message}`); }
    }
    this.emit('status', this.status());
  }

  stop() {
    for (const w of this.watchers) { try { w.close(); } catch {} }
    this.watchers = [];
    this.existing.clear();
  }

  status() { return { enabled: this.cfg.enabled, watching: this.watchers.length, log: this.log.slice(0, 50) }; }

  rule(file) {
    const ext = path.extname(file).slice(1).toLowerCase();
    return this.cfg.rules.find((r) => r.enabled && r.exts.map((x) => x.toLowerCase().replace(/^\./, '')).includes(ext));
  }

  newName(file, rule) {
    const p = path.parse(file);
    let base = p.name;
    if (this.cfg.clean) base = base.replace(/\s*\(\d+\)$/, '').replace(/[^\w\-.]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'file';
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const out = (rule.rename || '{name}')
      .replace(/\{name\}/g, base)
      .replace(/\{date\}/g, `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`)
      .replace(/\{time\}/g, `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`)
      .replace(/\{rule\}/g, rule.name.replace(/[^\w]+/g, '_'))
      .replace(/[<>:"/\\|?*]/g, '_');
    return out + p.ext.toLowerCase();
  }

  onEvent(dir, name) {
    const full = path.join(dir, name);
    if (TEMP.test(name) || name.startsWith('~$') || name.startsWith('.') || this.pending.has(full)) return;
    if (this.existing.has(full.toLowerCase())) return;
    if (this.claim?.(full)) return; // the track auto-tagger takes songs
    if (!this.rule(full)) return;
    this.pending.add(full);
    this.waitStable(full).then((ok) => {
      this.pending.delete(full);
      if (ok) return this.route(full);
    }).catch((e) => { this.pending.delete(full); this.emit('error', e.message); });
  }

  // a download is done when its size stops changing and nothing holds it open
  async waitStable(full, maxMs = 15 * 60 * 1000) {
    let last = -1, stable = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      await new Promise((r) => setTimeout(r, 800));
      let st;
      try { st = await fsp.stat(full); } catch { return false; }
      if (!st.isFile()) return false;
      if (st.size === last && st.size > 0) {
        if (++stable >= 2) {
          try { const h = await fsp.open(full, 'r+'); await h.close(); return true; } catch { stable = 0; }
        }
      } else stable = 0;
      last = st.size;
    }
    return false;
  }

  async unique(target) {
    const p = path.parse(target);
    let candidate = target, n = 2;
    while (true) {
      try { await fsp.access(candidate); candidate = path.join(p.dir, `${p.name} (${n++})${p.ext}`); } catch { return candidate; }
    }
  }

  async move(from, to) {
    await fsp.mkdir(path.dirname(to), { recursive: true });
    try { await fsp.rename(from, to); }
    catch (e) {
      if (e.code !== 'EXDEV') throw e;
      await fsp.copyFile(from, to);
      await fsp.unlink(from);
    }
  }

  async route(full) {
    const rule = this.rule(full);
    if (!rule) return null;
    const target = await this.unique(path.join(rule.dest, this.newName(full, rule)));
    await this.move(full, target);
    const st = await fsp.stat(target).catch(() => ({ size: 0 }));
    const entry = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, time: Date.now(),
      from: full, to: target, oldName: path.basename(full), newName: path.basename(target), rule: rule.name, glyph: rule.glyph, size: st.size,
    };
    this.log.unshift(entry);
    this.log = this.log.slice(0, 200);
    this.emit('routed', entry);
    return entry;
  }

  async undo(id) {
    const e = this.log.find((x) => x.id === id);
    if (!e || e.undone) throw new Error('nothing to undo');
    const back = await this.unique(e.from);
    this.existing.add(back.toLowerCase()); // don't route it straight back
    await this.move(e.to, back);
    e.undone = true;
    this.emit('status', this.status());
    return e;
  }

  // sort what is already sitting in the watched folders (explicit user action)
  async runNow() {
    const done = [];
    for (const dir of this.cfg.watch) {
      let files = [];
      try { files = await fsp.readdir(dir); } catch { continue; }
      for (const f of files) {
        const full = path.join(dir, f);
        if (TEMP.test(f) || !this.rule(full)) continue;
        try {
          const st = await fsp.stat(full);
          if (!st.isFile()) continue;
          const r = await this.route(full);
          if (r) done.push(r);
        } catch (e) { this.emit('error', `${f}: ${e.message}`); }
      }
    }
    return done;
  }

  test(name) {
    const r = this.rule(name);
    return r ? { rule: r.name, dest: r.dest, newName: this.newName(name, r) } : { rule: null };
  }
}

module.exports = { Router, defaultRules };
