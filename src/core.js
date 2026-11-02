// Bridge to HyperCore.exe (C#): launches it (elevated when allowed), then speaks newline-delimited JSON
// over a localhost socket. The core must present the per-launch token before anything else is accepted.
const net = require('net');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const EventEmitter = require('events');

const TASK = 'HYPERSPACE Core';

function run(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true }, (err, stdout, stderr) => resolve({ ok: !err, code: err ? err.code : 0, stdout, stderr }));
  });
}
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

class Core extends EventEmitter {
  constructor({ exe, dataDir }) {
    super();
    this.exe = exe;
    this.dataDir = dataDir;
    this.connFile = path.join(dataDir, 'core-conn.json');
    this.status = { state: 'offline', elevated: false, mode: null, error: null };
    this.pending = new Map();
    this.seq = 0;
    this.sock = null;
    this.server = null;
    this.exeHash(); // start fingerprinting the helper now, so it is ready when the silent-admin copy says hello
  }

  setStatus(patch) {
    Object.assign(this.status, patch);
    this.emit('status', { ...this.status });
  }

  get online() { return this.status.state === 'online'; }

  async listen() {
    if (this.server) return;
    this.server = net.createServer((sock) => this.onSocket(sock));
    await new Promise((r) => this.server.listen(0, '127.0.0.1', r));
    this.port = this.server.address().port;
  }

  async start({ elevate = true, useTask = false } = {}) {
    if (!fs.existsSync(this.exe)) { this.setStatus({ state: 'offline', error: 'HyperCore.exe is missing (an antivirus may have removed it: reinstall HYPERSPACE)' }); return; }
    await this.listen();
    this.token = crypto.randomBytes(24).toString('hex');
    this.setStatus({ state: 'starting', error: null });

    if (useTask && (await this.taskExists())) {
      fs.writeFileSync(this.connFile, JSON.stringify({ port: this.port, token: this.token }));
      const r = await run('schtasks.exe', ['/run', '/tn', TASK]);
      if (r.ok && (await this.waitOnline(10000))) return this.setStatus({ mode: 'task' });
    }
    if (elevate) {
      const cmd = `Start-Process -FilePath ${psQuote(this.exe)} -ArgumentList '--port','${this.port}','--token','${this.token}' -Verb RunAs -WindowStyle Hidden`;
      const r = await run('powershell.exe', ['-NoProfile', '-Command', cmd]);
      if (r.ok && (await this.waitOnline(15000))) return this.setStatus({ mode: 'uac' });
    }
    this.child = spawn(this.exe, ['--port', String(this.port), '--token', this.token], { windowsHide: true, stdio: 'ignore' });
    this.child.on('error', (e) => this.setStatus({ state: 'offline', error: e.message }));
    if (await this.waitOnline(10000)) this.setStatus({ mode: 'limited' });
    else this.setStatus({ state: 'offline', error: 'core did not connect' });
  }

  waitOnline(ms) {
    if (this.online) return Promise.resolve(true);
    return new Promise((resolve) => {
      const t = setTimeout(() => { this.off('online', on); resolve(false); }, ms);
      const on = () => { clearTimeout(t); resolve(true); };
      this.once('online', on);
    });
  }

  onSocket(sock) {
    let buf = '';
    let authed = false;
    sock.setEncoding('utf8');
    sock.on('data', (chunk) => {
      buf += chunk;
      if (!authed && buf.length > 4096) { sock.destroy(); return; } // a stranger sending junk
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (!authed) {
          const ok = this.token && typeof msg.hello === 'string' && msg.hello.length === this.token.length
            && crypto.timingSafeEqual(Buffer.from(msg.hello), Buffer.from(this.token));
          if (!ok) { sock.destroy(); return; }
          this.token = null; // one use: nobody can take over the connection later with the same token
          authed = true;
          if (this.sock) this.sock.destroy();
          this.sock = sock;
          try { fs.unlinkSync(this.connFile); } catch {}
          this.setStatus({ state: 'online', elevated: !!msg.elevated, pid: msg.pid, path: msg.path || null, user: typeof msg.user === 'string' ? msg.user : null, stale: !!msg.hash && !!this.exeHash() && msg.hash !== this.exeHash(), error: null });
          this.emit('online');
          continue;
        }
        if (msg.id) {
          const p = this.pending.get(msg.id);
          if (p) { this.pending.delete(msg.id); p(msg); }
        } else if (msg.ev) this.emit('event', msg.ev, msg.data);
      }
    });
    sock.on('close', () => {
      if (sock !== this.sock) return;
      this.sock = null;
      for (const p of this.pending.values()) p({ ok: false, error: 'core disconnected' });
      this.pending.clear();
      this.setStatus({ state: 'offline', error: 'core exited' });
    });
    sock.on('error', () => {});
  }

  call(cmd, args = {}, timeout = 20000) {
    if (!this.sock) return Promise.reject(new Error('core offline'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error(`${cmd} timed out`)); }, timeout);
      this.pending.set(id, (m) => { clearTimeout(t); m.ok ? resolve(m.data) : reject(new Error(m.error)); });
      this.sock.write(JSON.stringify({ id, cmd, args }) + '\n');
    });
  }

  async restart(opts) {
    this.stop();
    await new Promise((r) => setTimeout(r, 800));
    return this.start(opts);
  }

  stop() {
    if (this.sock) { this.sock.end(); this.sock = null; }
    this.setStatus({ state: 'offline', mode: null });
  }

  // ----- optional: a scheduled task that starts the core elevated without a UAC prompt each launch -----
  async taskExists() { return (await run('schtasks.exe', ['/query', '/tn', TASK])).ok; }

  // Both run the core itself through one UAC prompt (no script file in between that anything could edit first).
  // The core copies itself to Program Files\HYPERSPACE Core and registers the task on that copy.
  async installTask(app) {
    await this.elevatedCore(['--task-install', '--conn', this.connFile, '--app', app]);
    return this.taskExists();
  }

  async removeTask() {
    await this.elevatedCore(['--task-remove']);
    return !(await this.taskExists());
  }

  async elevatedCore(args) {
    const list = args.map((a) => psQuote(`"${a}"`)).join(',');
    const r = await run('powershell.exe', ['-NoProfile', '-Command', `Start-Process -FilePath ${psQuote(this.exe)} -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList ${list}`]);
    return r.ok;
  }

  // the core build this app shipped with, to spot a silent-admin copy left over from an older version
  // (worked out in the background: hashing ~100 MB at once would freeze the window for a moment; until it's ready
  // the check is simply skipped)
  exeHash() {
    try {
      const st = fs.statSync(this.exe), k = `${st.size}:${st.mtimeMs}`;
      if (this._hash?.k === k) return this._hash.h;
      if (this._hashing !== k) {
        this._hashing = k;
        const h = crypto.createHash('sha256');
        fs.createReadStream(this.exe).on('data', (d) => h.update(d)).on('end', () => { this._hash = { k, h: h.digest('hex').toUpperCase() }; this._hashing = null; }).on('error', () => { this._hashing = null; });
      }
    } catch {}
    return null;
  }
}

module.exports = { Core };
