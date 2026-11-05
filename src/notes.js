// NOTES: an encrypted notebook + journal that replaces OneNote.
//
// Every note is its own file, encrypted with AES-256-GCM. The key that encrypts them (the "vault key") is
// random and is itself stored twice in vault.json: once locked with your master password, once locked with a
// recovery key you print out. Losing both means the notes can't be read by anyone, including you.
//
// Layout of a vault folder (identical on the laptop, the SSD and the home server):
//   vault.json            the vault key, locked twice (password, recovery key) + the settings to re-derive them
//   notes/<id>.hsn        one note per file, encrypted (file names are random: titles never show)
//   blobs/<id>.hsb        pictures and PDFs inside notes, encrypted
//   history/<id>/<t>.hsn  earlier versions of a note (last 20), in case something gets overwritten
//
// Copies: the laptop folder is the main one. Every few minutes, and whenever the SSD is plugged in, changed
// files are copied to each mirror (and newer files on a mirror are pulled back), so all copies match. Copying
// needs no password: the mirrors only ever hold encrypted files.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const MAGIC = Buffer.from('HSN1');
const KDF = { N: 2 ** 17, r: 8, p: 1 }; // ~128 MB, about half a second: slow on purpose, against guessing
const RECOVERY_KDF = { N: 2 ** 14, r: 8, p: 1 }; // the recovery key is already random, so it needs less
const HISTORY_KEEP = 20;
const HISTORY_GAP = 10 * 60e3; // a version is kept at most every 10 minutes of editing

const scrypt = (secret, salt, o) => new Promise((res, rej) =>
  crypto.scrypt(secret, salt, 32, { ...o, maxmem: 256 * 1024 * 1024 }, (e, k) => (e ? rej(e) : res(k))));
const seal = (key, data, aad) => {
  if (!key || key.length !== 32 || key.every((b) => b === 0)) throw new Error('NOTES is locked');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  if (aad) c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(data), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), ct]);
};
const open = (key, buf, aad) => {
  if (!buf.subarray(0, 4).equals(MAGIC)) throw new Error('not a HYPERSPACE note');
  const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(4, 16));
  if (aad) d.setAAD(Buffer.from(aad));
  d.setAuthTag(buf.subarray(16, 32));
  return Buffer.concat([d.update(buf.subarray(32)), d.final()]);
};
const b64 = (b) => Buffer.from(b).toString('base64');
const unb64 = (s) => Buffer.from(s, 'base64');
// the recovery key: 30 letters/digits in groups of 5, no look-alikes (0/O, 1/I/L)
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newRecovery = () => {
  let out = '';
  while (out.length < 30) for (const b of crypto.randomBytes(40)) if (b < 248 && out.length < 30) out += ALPHA[b % ALPHA.length];
  return out.match(/.{5}/g).join('-');
};
const ID_RE = /^[0-9a-f]{24}$/; // note and picture ids: anything else could point outside the vault folder
const cleanRecovery = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const id = () => crypto.randomBytes(12).toString('hex');

// write to a temp file, then swap it in: a crash or a pulled SSD never leaves a half-written note
async function atomicWrite(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, file);
}

class NotesVault extends EventEmitter {
  // Two keys since 0.10.7: the JOURNAL key (locked with your master password) and the NOTES key (everything
  // else). The notes key is kept in vault.json locked by the journal key, and on this laptop also in a file only
  // your Windows account can open (protect/unprotect = Windows' own data protection), so everyday notes open
  // without a password while the journal still needs it. Every file stays encrypted either way.
  constructor({ dir, mirrors = [], autoLockMin = 15, localKeyFile = null, protect = null, unprotect = null, dpapi = null }) {
    super();
    this.dir = dir;
    this.mirrors = mirrors; // folders
    this.autoLockMin = autoLockMin;
    this.localKeyFile = localKeyFile; this.protect = protect; this.unprotect = unprotect;
    this.dpapi = dpapi; // { has(), load(), save(key) }: the second laptop copy (see openNotes)
    this.key = null;  // journal key
    this.nkey = null; // notes key
    this.lockedJournal = 0;
    this.notes = new Map(); // id → note (decrypted, only while unlocked)
    this.sync = {}; // mirror → { ok, at, copied, pulled, error }
    this.lastUse = Date.now();
    this.timer = setInterval(() => {
      if (this.key && this.autoLockMin && Date.now() - this.lastUse > this.autoLockMin * 60e3) this.lock('idle');
    }, 30e3);
    this.syncTimer = setInterval(() => this.syncAll().catch(() => {}), 3 * 60e3);
    // the SSD arriving starts a sync straight away
    this.present = new Set();
    this.watchTimer = setInterval(() => {
      for (const m of this.mirrors) {
        const here = this.reachable(m);
        if (here && !this.present.has(m)) { this.present.add(m); this.syncOne(m).catch(() => {}); }
        if (!here) this.present.delete(m);
      }
    }, 20e3);
  }

  touch() { this.lastUse = Date.now(); }
  get unlocked() { return !!this.key; } // the journal
  get isOpen() { return !!this.nkey; }   // everyday notes
  vaultFile(dir = this.dir) { return path.join(dir, 'vault.json'); }
  // every change to vault.json keeps the version it replaces (last 10) in vault-backups/
  async writeMeta(meta) {
    const f = this.vaultFile();
    try {
      const old = await fsp.readFile(f);
      const bd = path.join(this.dir, 'vault-backups');
      await fsp.mkdir(bd, { recursive: true });
      await fsp.writeFile(path.join(bd, `vault-${Date.now()}.json`), old);
      const all = (await fsp.readdir(bd)).filter((x) => x.endsWith('.json')).sort();
      for (const x of all.slice(0, Math.max(0, all.length - 10))) await fsp.unlink(path.join(bd, x)).catch(() => {});
    } catch {}
    await atomicWrite(f, JSON.stringify(meta, null, 1));
  }
  exists() { return fs.existsSync(this.vaultFile()); }
  // the drive (or server share) is there; the folder itself gets created on the first copy
  reachable(dir) { try { return fs.existsSync(path.parse(path.resolve(dir)).root); } catch { return false; } }

  // ---------------- password + recovery key ----------------
  async create(password) {
    if (this.exists()) throw new Error('a vault already exists here');
    if (String(password || '').length < 10) throw new Error('use at least 10 characters');
    const vaultKey = crypto.randomBytes(32), notesKey = crypto.randomBytes(32), recovery = newRecovery();
    const meta = { v: 2, created: new Date().toISOString() };
    meta.pw = await this.wrap(vaultKey, password, KDF);
    meta.rec = await this.wrap(vaultKey, cleanRecovery(recovery), RECOVERY_KDF);
    meta.nk = b64(seal(vaultKey, notesKey, 'notes-key'));
    await this.writeMeta(meta);
    this.key = vaultKey; this.nkey = notesKey;
    this.saveLocalKey();
    this.notes.clear();
    this.touch();
    this.syncAll().catch(() => {});
    return { recovery };
  }
  async wrap(vaultKey, secret, kdf) {
    const salt = crypto.randomBytes(16);
    const kek = await scrypt(secret, salt, kdf);
    return { kdf, salt: b64(salt), box: b64(seal(kek, vaultKey, 'vault-key')) };
  }
  async unwrap(w, secret) {
    const kek = await scrypt(secret, unb64(w.salt), w.kdf);
    return open(kek, unb64(w.box), 'vault-key');
  }
  readMeta() {
    // the laptop copy, or a mirror's if the laptop copy is missing (e.g. restoring from the SSD)
    for (const d of [this.dir, ...this.mirrors]) { try { return JSON.parse(fs.readFileSync(this.vaultFile(d), 'utf8')); } catch {} }
    throw new Error('no vault found');
  }
  async unlock(secret, { recovery = false } = {}) {
    const meta = this.readMeta();
    let key;
    try { key = await this.unwrap(recovery ? meta.rec : meta.pw, recovery ? cleanRecovery(secret) : String(secret)); }
    catch { throw new Error(recovery ? 'that recovery key doesn\'t match' : 'wrong password'); }
    this.key = key;
    if (meta.nk) this.nkey = open(key, unb64(meta.nk), 'notes-key');
    else {
      // vault.json without a notes key: a vault from before 0.10.7 (or an old copy of vault.json). If this laptop
      // already has its notes key, keep it (a new one would make every everyday note unreadable)
      if (!this.nkey && this.localKeyFile && this.unprotect && fs.existsSync(this.localKeyFile)) { try { this.nkey = this.unprotect(fs.readFileSync(this.localKeyFile)); } catch {} }
      await this.split(meta);
    }
    this.saveLocalKey();
    this.touch();
    // Fast path: the everyday notes are already in memory (only the journal pages were dropped when it locked),
    // so unlocking only reads the files that are not loaded yet instead of re-reading and re-decrypting everything.
    if (this._loadedNk && this.notes.size && meta.nk) await this.loadMissing(); else await this.load();
    this.emit('change', { unlocked: true });
    return { notes: this.notes.size };
  }
  // everyday notes on this laptop, without the password (false if this laptop hasn't been set up yet)
  // Two laptop copies of the notes key: Electron's safeStorage, and Windows DPAPI through HyperCore. safeStorage's
  // own key was replaced in the Electron 44 upgrade and its old copy became unreadable; the DPAPI copy is tied to
  // the Windows account only, so an app update can't break it. Whichever opens refreshes the other.
  async openNotes() {
    if (this.nkey) return true;
    let k = null;
    if (this.localKeyFile && this.unprotect && fs.existsSync(this.localKeyFile)) { try { k = this.unprotect(fs.readFileSync(this.localKeyFile)); } catch {} }
    if (!k && this.dpapi?.has()) { try { k = this.dpapi.load(); } catch {} }
    if (!k || k.length !== 32) return false;
    this.nkey = k;
    try { await this.load(); } catch { this.nkey = null; return false; }
    this.saveLocalKey();
    this.emit('change', { open: true });
    return true;
  }
  saveLocalKey() {
    if (!this.nkey) return;
    // the notes key does not change when the journal unlocks: writing both laptop copies again each time was the slow part
    const tag = this.nkey.toString('hex');
    if (this._savedTag === tag) return;
    this._savedTag = tag;
    if (this.localKeyFile && this.protect) {
      try { fs.mkdirSync(path.dirname(this.localKeyFile), { recursive: true }); fs.writeFileSync(this.localKeyFile, this.protect(this.nkey)); } catch {}
    }
    try { this.dpapi?.save(this.nkey); } catch {}
  }
  // One-time move to two keys: pages in a notebook or section called journal / diary / passwords (or already
  // marked journal) stay under the journal key; every other page and its pictures move to the new notes key.
  async split(meta) {
    this.nkey = this.nkey || crypto.randomBytes(32);
    meta.v = 2; meta.nk = b64(seal(this.key, this.nkey, 'notes-key'));
    const dir = path.join(this.dir, 'notes');
    let files = []; try { files = (await fsp.readdir(dir)).filter((x) => x.endsWith('.hsn')); } catch {}
    for (const f of files) {
      const nid = f.slice(0, -4), file = path.join(dir, f);
      let n; try { n = JSON.parse(open(this.key, await fsp.readFile(file), nid).toString('utf8')); } catch { continue; }
      if (n.journal || isPrivate(n.notebook, n.section)) {
        if (!n.journal) { n.journal = true; await atomicWrite(file, seal(this.key, Buffer.from(JSON.stringify(n), 'utf8'), nid)); }
        continue;
      }
      await atomicWrite(file, seal(this.nkey, Buffer.from(JSON.stringify(n), 'utf8'), nid));
      for (const bid of n.blobs || []) await this.reseal(bid, this.key, this.nkey).catch(() => {});
    }
    await this.writeMeta(meta);
  }
  async reseal(bid, from, to) {
    const f = path.join(this.dir, 'blobs', `${bid}.hsb`);
    const raw = open(from, await fsp.readFile(f), bid);
    await atomicWrite(f, seal(to, raw, bid));
  }
  // tries the notes key, then the journal key
  openAny(buf, aad) {
    if (this.nkey) { try { return { data: open(this.nkey, buf, aad), journal: false }; } catch {} }
    if (this.key) return { data: open(this.key, buf, aad), journal: true };
    throw new Error('locked');
  }
  async setPassword(newPassword) {
    if (!this.key) throw new Error('locked');
    if (String(newPassword || '').length < 10) throw new Error('use at least 10 characters');
    const meta = this.readMeta();
    meta.pw = await this.wrap(this.key, newPassword, KDF);
    await this.writeMeta(meta);
    this.syncAll().catch(() => {});
    return true;
  }
  // Pages imported from OneNote that an older version locked only because their NOTEBOOK was called Journal go back to
  // everyday notes (never one the user locked on purpose with the MOVE box: those carry jm).
  async relaxImported() {
    let n = 0;
    for (const x of [...this.notes.values()]) {
      // only the dated entries (or a journal / diary / password section) stay locked; every other page goes back to everyday notes
      if (!x.journal || x.jm || isPrivate(x.notebook, x.section) || isDateTitle(x.title)) continue;
      try { await this.save({ ...x, journal: false, keepDates: true, updated: x.updated }); n++; } catch {}
    }
    return n;
  }
  // locks the journal only: everyday notes stay open
  lock(why = 'locked') {
    if (!this.key) return;
    const k = this.key;
    this.key = null;
    setTimeout(() => k.fill(0), 5000).unref?.();
    for (const [i, n] of this.notes) if (n.journal) { this.notes.delete(i); this.lockedJournal++; }
    this.emit('change', { unlocked: false, why });
  }
  closeAll() { this._loadedNk = false; if (this.key) this.key.fill(0); if (this.nkey) this.nkey.fill(0); this.key = this.nkey = null; this.notes.clear(); }

  // ---------------- notes ----------------
  async load() {
    this.notes.clear();
    await this.loadMissing(true);
  }
  // reads note files in parallel batches; with full=false only the files whose note is not in memory yet
  async loadMissing(full = false) {
    const dir = path.join(this.dir, 'notes');
    let files = [];
    try { files = await fsp.readdir(dir); } catch {}
    files = files.filter((x) => x.endsWith('.hsn') && (full || !this.notes.has(x.slice(0, -4))));
    let bad = 0, locked = 0;
    const one = async (f) => {
      try {
        const buf = await fsp.readFile(path.join(dir, f)), nid = f.slice(0, -4);
        // the files still missing are mostly journal pages: try the journal key first (a wrong-key try costs a full read)
        const plain = !full && this.key ? (() => { try { return open(this.key, buf, nid); } catch { return this.openAny(buf, nid).data; } })() : this.openAny(buf, nid).data;
        const n = JSON.parse(plain.toString('utf8'));
        if (!n.gone) this.notes.set(n.id, n);
      } catch { if (this.key) bad++; else locked++; }
    };
    for (let i = 0; i < files.length; i += 24) await Promise.all(files.slice(i, i + 24).map(one));
    this.unreadable = bad; this.lockedJournal = locked;
    if (this.nkey) this._loadedNk = true;
  }
  list() {
    this.touch();
    return [...this.notes.values()].map(({ id: i, title, notebook, section, created, updated, deleted, journal, body, blobs }) =>
      ({ id: i, title, notebook, section, created, updated, deleted: !!deleted, journal: !!journal, dated: isDateTitle(title), size: (body || '').length, preview: (body || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\(hs-blob:[^)]*\)/g, '📎 $1').replace(/[#*>`~_\[\]()|-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140), pics: (blobs || []).length, todos: ((body || '').match(/^\s*([-*]|\d+\.)\s\[ \]/gm) || []).length }));
  }
  get(i) { this.touch(); return this.notes.get(i) || null; }
  async save(n) {
    if (!this.nkey) throw new Error('NOTES is locked');
    if (n.id && !ID_RE.test(n.id)) throw new Error('bad note id');
    for (const b of n.blobs || []) if (!ID_RE.test(b)) throw new Error('bad picture id');
    this.touch();
    const now = new Date().toISOString();
    const prev = n.id ? this.notes.get(n.id) : null;
    const note = { ...(prev || {}), ...n, id: n.id || id(), updated: n.keepDates && n.updated ? n.updated : now };
    if (!note.created) note.created = now;
    delete note.keepDates;
    const file = path.join(this.dir, 'notes', `${note.id}.hsn`);
    // keep the version being replaced (at most one per 10 minutes of editing)
    try {
      const st = await fsp.stat(file);
      if (Date.now() - st.mtimeMs > HISTORY_GAP) {
        const hd = path.join(this.dir, 'history', note.id);
        await fsp.mkdir(hd, { recursive: true });
        await fsp.copyFile(file, path.join(hd, `${Math.round(st.mtimeMs)}.hsn`));
        const old = (await fsp.readdir(hd)).sort();
        for (const f of old.slice(0, Math.max(0, old.length - HISTORY_KEEP))) await fsp.unlink(path.join(hd, f)).catch(() => {});
      }
    } catch {}
    // a new page (or one moved) into a Journal / Diary / Passwords notebook or section is a journal page
    if (!note.gone && (!prev || prev.notebook !== note.notebook || prev.section !== note.section) && isPrivate(note.notebook, note.section)) note.journal = true;
    const key = note.journal ? this.key : this.nkey;
    if (!key) throw new Error('unlock the journal first');
    // moved in or out of the journal: its pictures and earlier versions follow it to the other key
    if (prev && !!prev.journal !== !!note.journal) {
      const from = prev.journal ? this.key : this.nkey;
      for (const bid of note.blobs || []) await this.reseal(bid, from, key).catch(() => {});
      const hd = path.join(this.dir, 'history', note.id);
      for (const f of await fsp.readdir(hd).catch(() => [])) {
        const hf = path.join(hd, f);
        const buf = await fsp.readFile(hf).catch(() => null);
        if (!buf) continue;
        let plain = null;
        try { plain = open(from, buf, note.id); } catch {}
        if (plain) { await atomicWrite(hf, seal(key, plain, note.id)).catch(() => fsp.unlink(hf).catch(() => {})); continue; }
        // already under the new key (a page moved before versions followed it): keep it; anything else is unreadable
        try { open(key, buf, note.id); } catch { await fsp.unlink(hf).catch(() => {}); }
      }
    }
    await atomicWrite(file, seal(key, Buffer.from(JSON.stringify(note), 'utf8'), note.id));
    this.notes.set(note.id, note);
    this.dirty = true;
    return note;
  }
  async remove(i, forever = false) {
    const n = this.notes.get(i);
    if (!n) return false;
    if (!forever) { await this.save({ ...n, deleted: true }); return true; }
    // emptied from the trash: gone here; the mirrors keep their copy until they're told (a deleted note
    // leaves a tiny encrypted "gone" marker, so the next sync removes it everywhere)
    await this.save({ id: i, gone: true, title: '', body: '', blobs: [], deleted: true });
    this.notes.delete(i);
    return true;
  }
  async putBlob(buf, mime, journal = false) {
    const key = journal ? this.key : this.nkey;
    if (!key) throw new Error('locked');
    const bid = id();
    await atomicWrite(path.join(this.dir, 'blobs', `${bid}.hsb`), seal(key, Buffer.concat([Buffer.from(`${mime}\n`), buf]), bid));
    this.dirty = true;
    return bid;
  }
  async getBlob(bid) {
    this.touch();
    if (!/^[0-9a-f]{24}$/.test(bid)) throw new Error('bad picture id');
    const raw = this.openAny(await fsp.readFile(path.join(this.dir, 'blobs', `${bid}.hsb`)), bid).data;
    const nl = raw.indexOf(10);
    return { mime: raw.subarray(0, nl).toString(), data: raw.subarray(nl + 1) };
  }
  history(i) {
    if (!ID_RE.test(String(i))) return [];
    try { return fs.readdirSync(path.join(this.dir, 'history', i)).sort().reverse().map((f) => ({ at: +f.replace('.hsn', '') })); } catch { return []; }
  }
  async version(i, at) {
    if (!ID_RE.test(String(i)) || !/^\d+$/.test(String(at))) throw new Error('bad version');
    const n = JSON.parse(this.openAny(await fsp.readFile(path.join(this.dir, 'history', i, `${at}.hsn`)), i).data.toString('utf8'));
    return n;
  }

  // ---------------- copies on the SSD / home server ----------------
  // Newest file wins in both directions; the loser of a clash is kept in history. Copying never needs the key.
  async syncOne(m) {
    const st = this.sync[m] = { ...(this.sync[m] || {}), running: true };
    if (!this.reachable(m)) { Object.assign(st, { running: false, ok: false, error: 'not plugged in / not reachable' }); return st; }
    let copied = 0, pulled = 0;
    try {
      await fsp.mkdir(m, { recursive: true });
      const walk = async (rel) => {
        const a = path.join(this.dir, rel), b = path.join(m, rel);
        const [la, lb] = await Promise.all([fsp.readdir(a, { withFileTypes: true }).catch(() => []), fsp.readdir(b, { withFileTypes: true }).catch(() => [])]);
        const names = new Set([...la, ...lb].map((d) => d.name).filter((n) => !n.endsWith('.tmp')));
        for (const name of names) {
          const pa = path.join(a, name), pb = path.join(b, name);
          const [sa, sb] = await Promise.all([fsp.lstat(pa).catch(() => null), fsp.lstat(pb).catch(() => null)]);
          if (sa?.isSymbolicLink() || sb?.isSymbolicLink()) continue;
          if ((sa || sb).isDirectory()) { await walk(path.join(rel, name)); continue; }
          // the laptop's vault.json is the master: an older or edited one on a drive must never replace it
          if (!rel && name === 'vault.json' && sa) { if (!sb || sa.mtimeMs !== sb.mtimeMs) { await this.copy(pa, pb, sa.mtimeMs); copied++; } continue; }
          if (sa && (!sb || sa.mtimeMs > sb.mtimeMs + 2000)) { await this.copy(pa, pb, sa.mtimeMs); copied++; }
          else if (sb && (!sa || sb.mtimeMs > sa.mtimeMs + 2000)) {
            if (sa && rel.startsWith('notes')) { // keep ours in history before taking the newer one
              const hd = path.join(this.dir, 'history', name.replace('.hsn', ''));
              await fsp.mkdir(hd, { recursive: true });
              await fsp.copyFile(pa, path.join(hd, `${Math.round(sa.mtimeMs)}.hsn`)).catch(() => {});
            }
            await this.copy(pb, pa, sb.mtimeMs); pulled++;
          }
        }
      };
      await walk('');
      Object.assign(st, { running: false, ok: true, at: Date.now(), copied, pulled, error: null });
      if (pulled && this.nkey) await this.load();
    } catch (e) { Object.assign(st, { running: false, ok: false, error: e.message }); }
    this.emit('sync', this.syncState());
    return st;
  }
  async copy(from, to, mtimeMs) {
    await fsp.mkdir(path.dirname(to), { recursive: true });
    const tmp = `${to}.${process.pid}.tmp`;
    await fsp.copyFile(from, tmp);
    const t = new Date(mtimeMs);
    await fsp.utimes(tmp, t, t);
    await fsp.rename(tmp, to);
  }
  async syncAll() { for (const m of this.mirrors) await this.syncOne(m); this.dirty = false; return this.syncState(); }
  syncState() {
    return this.mirrors.map((m) => ({ dir: m, here: this.reachable(m), ...(this.sync[m] || {}) }));
  }
  stop() { clearInterval(this.timer); clearInterval(this.syncTimer); clearInterval(this.watchTimer); this.lock('closing'); }
}

// what stays behind the password: a SECTION called journal / diary / passwords (the notebook around it stays open),
// or a notebook called diary / passwords. A notebook merely called "Journal" no longer locks everything inside it.
// does a page title look like a date (a journal entry)? ISO, "March 4, 2019", "4 March 2019", "3/4/2019", optional weekday and time
function isDateTitle(title) {
  let t = String(title || '').trim().replace(/\s+/g, ' ');
  if (!t) return false;
  const M = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  t = t.replace(/^(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?,?\s+/i, '');
  t = t.replace(/[,\s]+(?:at\s+)?\d{1,2}[:.]\d{2}(?::\d{2})?\s*(?:am|pm)?$/i, '').replace(/[T\s]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?$/i, '');
  return [
    /^\d{4}[-./]\d{1,2}[-./]\d{1,2}$/,
    /^\d{1,2}[-./]\d{1,2}[-./](?:\d{4}|\d{2})$/,
    /^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}$/i,
    /^\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?,?\s+\d{4}$/i,
  ].some((r) => r.test(t));
}
function isPrivate(notebook, section) { return /diary|password/i.test(notebook || '') || /journal|diary|password/i.test(section || ''); }

module.exports = { NotesVault, isPrivate };
