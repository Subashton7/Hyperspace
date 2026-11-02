// Phone link: serves the same UI over the LAN and exposes the app API behind a pairing key.
// The key travels in the URL fragment (never sent to the server by the browser) and then as a header.
// Two doors: http://<ip>:7777 (what the QR code opens, no setup) and https://hyperspace.local:7778, the secure
// one an iPhone needs to keep HYPERSPACE on its home screen and run it offline. The name hyperspace.local is
// announced on the Wi-Fi by this server itself (mDNS), so it stays the same when the laptop's address changes.
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.aif': 'audio/aiff', '.aiff': 'audio/aiff',
};

// ---- SAVE TO FILES: real copies of tracks for the phone's Files app, packed as a plain (stored) .zip ----
// A plain zip tops out at 4 GB and 65535 files, so bigger lists come back in parts.
const ZIP_PART = 3.5 * 1024 ** 3, ZIP_FILES = 60000;
const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
const dosTime = (d) => ({
  time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
});
async function crcOf(file, size) {
  let c = 0;
  for await (const chunk of fs.createReadStream(file, { start: 0, end: size - 1, highWaterMark: 1 << 20 })) c = zlib.crc32(chunk, c);
  return c >>> 0;
}
const zipSize = (entries) => entries.reduce((s, e) => s + 76 + 2 * Buffer.byteLength(e.name) + e.size, 22);
async function sendZip(res, entries, filename) {
  res.writeHead(200, {
    'Content-Type': 'application/zip', 'Content-Length': String(zipSize(entries)), 'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
  });
  const put = (buf) => new Promise((ok) => { if (res.destroyed || res.write(buf)) return ok(); res.once('drain', ok); res.once('close', ok); });
  const central = [];
  let off = 0;
  for (const e of entries) {
    if (res.destroyed) return;
    const name = Buffer.from(e.name), crc = await crcOf(e.file, e.size), { time, date } = dosTime(e.mtime);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); // version 2.0, UTF-8 names
    h.writeUInt16LE(time, 10); h.writeUInt16LE(date, 12); h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(e.size, 18); h.writeUInt32LE(e.size, 22); h.writeUInt16LE(name.length, 26);
    await put(Buffer.concat([h, name]));
    await pipeline(fs.createReadStream(e.file, { start: 0, end: e.size - 1 }), res, { end: false });
    central.push({ name, crc, time, date, size: e.size, off });
    off += 30 + name.length + e.size;
  }
  const dir = Buffer.concat(central.map((c) => {
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6); h.writeUInt16LE(0x0800, 8);
    h.writeUInt16LE(c.time, 12); h.writeUInt16LE(c.date, 14); h.writeUInt32LE(c.crc, 16);
    h.writeUInt32LE(c.size, 20); h.writeUInt32LE(c.size, 24); h.writeUInt16LE(c.name.length, 28); h.writeUInt32LE(c.off, 42);
    return Buffer.concat([h, c.name]);
  }));
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(off, 16);
  await put(Buffer.concat([dir, end]));
  res.end();
}

function lanAddresses() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (/vethernet|virtualbox|vmware|loopback|wsl|hyper-v/i.test(name)) continue;
    // 169.254.x is Windows' "no network here" fallback: a phone can never reach it
    for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push({ name, address: a.address });
  }
  return out.sort((a, b) => (/wi-?fi|wlan/i.test(b.name) ? 1 : 0) - (/wi-?fi|wlan/i.test(a.name) ? 1 : 0));
}

// ---- who may talk to the phone link ----
// Only devices on the same local network: loopback, private IPv4 ranges, IPv6 link-local / unique-local.
const LOCAL = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^::1$/, /^fe[89ab][0-9a-f]:/i, /^f[cd][0-9a-f]{2}:/i];
const peer = (req) => String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
const isLocal = (ip) => LOCAL.some((r) => r.test(ip));
const isLoopback = (ip) => ip === '::1' || ip.startsWith('127.');
// wrong pairing keys: 10 within 10 minutes locks that address out for 15 minutes
const FAIL_MAX = 10, FAIL_WINDOW = 10 * 60e3, LOCKOUT = 15 * 60e3;

class Remote {
  constructor({ root, api, media, onDevice }) {
    this.root = root;
    this.api = api;
    this.media = media || (() => null); // (kind, id) → a file on disk (CRATE tracks and covers)
    this.onDevice = onDevice || (() => {}); // (ip, userAgent): a paired device this server hasn't seen yet
    this.clients = new Set();
    this.fails = new Map(); // ip → { n, first, until }
    this.seen = new Set();
    this.zips = new Map(); // SAVE TO FILES tickets: token → the files of one .zip
    this.server = null;
    this.key = null;
    this.port = 7777;
  }

  get running() { return !!this.server; }

  // tls: { pfx, passphrase, port, dir } for the secure door (optional)
  async start(port, key, host = '0.0.0.0', tls = null) {
    this.stop();
    this.port = port;
    this.key = key;
    this.tls = tls;
    const handler = (secure) => (req, res) => this.handle(req, res, secure).catch((e) => { if (!res.headersSent) this.json(res, 500, { ok: false, error: e.message }); else res.destroy(); });
    const listen = (srv, p) => new Promise((resolve) => {
      srv.once('error', (e) => resolve({ ok: false, error: e.message }));
      srv.listen(p, host, () => resolve({ ok: true }));
    });
    this.server = http.createServer(handler(false));
    const r = await listen(this.server, port);
    if (!r.ok) { this.server = null; return r; }
    if (tls?.pfx) {
      try {
        this.secure = https.createServer({ pfx: tls.pfx, passphrase: tls.passphrase, minVersion: 'TLSv1.2' }, handler(true));
        const s = await listen(this.secure, tls.port);
        if (!s.ok) { this.secure = null; r.secureError = s.error; }
      } catch (e) { this.secure = null; r.secureError = e.message; }
      if (this.secure) this.announce();
    }
    return r;
  }

  stop() {
    for (const c of this.clients) c.res.end();
    this.clients.clear();
    if (this.server) { this.server.close(); this.server = null; }
    if (this.secure) { this.secure.close(); this.secure = null; }
    if (this.mdns) { try { this.mdns.destroy(); } catch {} this.mdns = null; }
  }

  // answer "who is hyperspace.local?" on the Wi-Fi with this laptop's address(es)
  announce() {
    try {
      this.mdns = require('multicast-dns')({ reuseAddr: true });
      this.mdns.on('error', () => {});
      this.mdns.on('query', (q) => {
        const want = (q.questions || []).some((x) => String(x.name).toLowerCase() === Remote.HOST && (x.type === 'A' || x.type === 'ANY'));
        if (!want) return;
        const answers = lanAddresses().map((a) => ({ name: Remote.HOST, type: 'A', ttl: 120, flush: true, data: a.address }));
        if (answers.length) this.mdns.respond({ answers });
      });
    } catch { this.mdns = null; }
  }

  authed(req, fromQuery = false) {
    // <audio> and <img> can't send headers, so music and covers carry the key in the query instead
    const k = String((fromQuery ? new URL(req.url, 'http://x').searchParams.get('k') : req.headers['x-hs-key']) || '');
    const ip = peer(req), now = Date.now();
    const f = this.fails.get(ip);
    if (f?.until > now) return false; // locked out: even the right key waits
    const ok = !!this.key && k.length === this.key.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(this.key));
    if (!ok) {
      const g = f && now - f.first < FAIL_WINDOW ? f : { n: 0, first: now, until: 0 };
      if (++g.n >= FAIL_MAX) g.until = now + LOCKOUT;
      this.fails.set(ip, g);
      return false;
    }
    if (!this.seen.has(ip)) { this.seen.add(ip); this.onDevice(ip, String(req.headers['user-agent'] || '')); }
    return true;
  }
  lockedOut(req) { return this.fails.get(peer(req))?.until > Date.now(); }

  json(res, code, obj) {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  }

  async handle(req, res, secure) {
    const url = new URL(req.url, 'http://x');
    const ip = peer(req);
    // nothing outside this Wi-Fi gets an answer, even if a router forwards the port
    if (!isLocal(ip)) { req.socket.destroy(); return; }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    if (this.lockedOut(req)) return this.json(res, 429, { ok: false, error: 'too many wrong pairing keys: try again in 15 minutes' });
    // Encrypted only: the plain door (what a brand-new phone's QR code opens) hands out the certificate, the
    // setup guide and the app's files, nothing private. The pairing key, music and controls only travel
    // over the encrypted door, so nobody else on the Wi-Fi can read them.
    if (!secure && !isLoopback(ip) && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/') || url.searchParams.has('k'))) {
      return this.json(res, 403, { ok: false, error: 'encrypted connection required' });
    }
    if (url.pathname === '/') { res.writeHead(302, { Location: '/renderer/phone.html' }); return res.end(); }

    // the certificate the phone installs once (public: a certificate is not a secret, its key stays here)
    if (url.pathname === '/setup/hyperspace-ca.cer' && this.tls?.dir) {
      const f = path.join(this.tls.dir, 'hyperspace-ca.cer');
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'application/x-x509-ca-cert', 'Content-Disposition': 'attachment; filename="HYPERSPACE.cer"', 'Cache-Control': 'no-store' });
      return fs.createReadStream(f).pipe(res);
    }
    // the home-screen app's description, carrying the pairing key when asked with it: on an iPhone the
    // installed app gets its own storage, so it has to start already paired
    if (url.pathname === '/renderer/manifest.webmanifest' && url.searchParams.get('k')) {
      if (!this.authed(req, true)) { res.writeHead(401); return res.end(); }
      const m = JSON.parse(fs.readFileSync(path.join(this.root, 'renderer', 'manifest.webmanifest'), 'utf8'));
      m.start_url = `/renderer/phone.html?mode=phone#k=${this.key}`;
      res.writeHead(200, { 'Content-Type': TYPES['.webmanifest'], 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(m));
    }
    // where to find the secure door (the phone asks before offering MOBILE MODE)
    // (open to other addresses: the setup guide on the plain door asks the secure door whether the phone can reach it)
    if (url.pathname === '/setup/info') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      return this.json(res, 200, { secure: !!this.secure, port: this.tls?.port || null, host: Remote.HOST, ips: lanAddresses().map((a) => a.address) });
    }

    // CRATE on the phone: /media/track/<id>?k=… streams the file (with seeking), /media/art/<id>?k=… its cover
    const mm = url.pathname.match(/^\/media\/(track|art)\/([^/]+)$/);
    if (mm) {
      if (!this.authed(req, true)) { res.writeHead(401); return res.end(); }
      const file = this.media(mm[1], decodeURIComponent(mm[2]));
      if (!file || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
      const size = fs.statSync(file).size, type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
      const r = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
      let start = 0, end = size - 1;
      if (r) { if (r[1]) { start = +r[1]; if (r[2]) end = Math.min(+r[2], end); } else if (r[2]) start = Math.max(0, size - +r[2]); }
      const head = { 'Content-Type': type, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes', 'Cache-Control': mm[1] === 'art' ? 'max-age=86400' : 'no-cache' };
      if (r) head['Content-Range'] = `bytes ${start}-${end}/${size}`;
      // ?dl=1: SAVE TO FILES for one track, the file itself under its own name
      if (url.searchParams.get('dl')) head['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`;
      res.writeHead(r ? 206 : 200, head);
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file, { start, end }).pipe(res);
    }

    // SAVE TO FILES for a list: the phone posts the track ids (with the key) and gets download links back, one per
    // .zip part. The link's ticket is the permission, so the key never sits in a download address
    if (url.pathname === '/media/zip' && req.method === 'POST') {
      if (!this.authed(req)) return this.json(res, 401, { ok: false, error: 'bad pairing key' });
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 4e6) throw new Error('too large'); }
      const { ids, name } = JSON.parse(body || '{}');
      return this.json(res, 200, { ok: true, ...this.zipParts(Array.isArray(ids) ? ids : [], name) });
    }
    const zm = url.pathname.match(/^\/media\/zip\/([0-9a-f]{32})\/[^/]+$/);
    if (zm) {
      const z = this.zips.get(zm[1]);
      if (!z || z.until < Date.now()) { res.writeHead(404); return res.end('this download has expired: tap SAVE TO FILES again'); }
      return sendZip(res, z.files, `${z.folder}.zip`).catch(() => res.destroy());
    }

    if (url.pathname === '/api/call' && req.method === 'POST') {
      if (!this.authed(req)) return this.json(res, 401, { ok: false, error: 'bad pairing key' });
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 1e6) throw new Error('too large'); }
      const { name, args } = JSON.parse(body || '{}');
      // this.api is the phone's own allowlist (main.js); own properties only, so 'constructor' and friends don't count
      if (typeof name !== 'string' || !Object.hasOwn(this.api, name) || typeof this.api[name] !== 'function') return this.json(res, 404, { ok: false, error: 'no such call' });
      try { return this.json(res, 200, { ok: true, data: await this.api[name](...(Array.isArray(args) ? args : [])) }); }
      catch (e) { return this.json(res, 200, { ok: false, error: e.message }); }
    }

    if (url.pathname === '/api/events') {
      if (!this.authed(req)) return this.json(res, 401, { ok: false, error: 'bad pairing key' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(': hello\n\n');
      const client = { res, lastAudio: 0 };
      this.clients.add(client);
      req.on('close', () => this.clients.delete(client));
      return;
    }

    // static files: only the renderer folder and the bundled fonts
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.normalize(path.join(this.root, rel));
    const allowed = [path.join(this.root, 'renderer'), path.join(this.root, 'node_modules', '@fontsource'), path.join(this.root, 'assets')];
    if (!allowed.some((dir) => file.startsWith(dir + path.sep)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  }

  // the tracks' files on disk, under their own names, in one folder per .zip (unzipping gives that folder)
  zipParts(ids, name) {
    const folder = safeName(name) || 'HYPERSPACE';
    const files = [], taken = new Set();
    let missing = 0;
    for (const id of ids) {
      const file = this.media('track', String(id));
      const st = file && fs.existsSync(file) ? fs.statSync(file) : null;
      if (!st || !st.size || st.size >= 0xffffffff) { missing++; continue; }
      const ext = path.extname(file), stem = safeName(path.basename(file, ext)) || 'track';
      let base = stem + ext;
      for (let n = 2; taken.has(base.toLowerCase()); n++) base = `${stem} (${n})${ext}`;
      taken.add(base.toLowerCase());
      files.push({ file, base, size: st.size, mtime: st.mtime });
    }
    const groups = [];
    let cur = [], sum = 0;
    for (const f of files) {
      if (cur.length && (sum + f.size > ZIP_PART || cur.length >= ZIP_FILES)) { groups.push(cur); cur = []; sum = 0; }
      cur.push(f); sum += f.size;
    }
    if (cur.length) groups.push(cur);
    const now = Date.now();
    for (const [t, z] of this.zips) if (z.until < now) this.zips.delete(t);
    const parts = groups.map((g, i) => {
      const label = groups.length > 1 ? `${folder} (${i + 1} of ${groups.length})` : folder;
      const entries = g.map((f) => ({ ...f, name: `${label}/${f.base}` }));
      const token = crypto.randomBytes(16).toString('hex');
      this.zips.set(token, { files: entries, folder: label, until: now + 3600e3 });
      return { url: `/media/zip/${token}/${encodeURIComponent(label)}.zip`, name: `${label}.zip`, count: g.length, size: zipSize(entries) };
    });
    return { parts, missing };
  }

  broadcast(ev, data) {
    if (!this.clients.size) return;
    const now = Date.now();
    const line = `event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of this.clients) {
      if (ev === 'audio') { if (now - c.lastAudio < 33) continue; c.lastAudio = now; } // 30 fps is plenty over Wi-Fi
      c.res.write(line);
    }
  }

  urls() {
    return lanAddresses().map((a) => ({ ...a, url: `http://${a.address}:${this.port}/renderer/phone.html#k=${this.key}` }));
  }
  secureUrl() { return this.secure ? `https://${Remote.HOST}:${this.tls.port}/renderer/phone.html#k=${this.key}` : null; }
}
Remote.HOST = 'hyperspace.local';

module.exports = { Remote, lanAddresses };
