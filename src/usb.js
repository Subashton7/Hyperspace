// HARDWARE → PORTS: turns HyperCore's raw USB tree (controllers → root hubs → numbered ports) into the sockets you
// can actually see on the laptop. A USB 3 socket is two ports to Windows (USB 2 lanes + 5 Gbps lanes, linked as
// "companions"; on this laptop the USB-C socket's two halves even sit on different controllers), and a USB 3 hub
// likewise shows up twice. Both get merged back into one socket / one hub here.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const VOLTS = 5; // USB devices ask for current at 5 V
const SUPPLY = { 'USB-C': 3000, 'USB-A 3': 900, 'USB-A 2': 500 }; // what a socket is meant to supply, mA

function run(exe) {
  return new Promise((resolve, reject) => execFile(exe, ['--usb-tree'], { windowsHide: true, timeout: 20000 }, (e, out) => {
    try { resolve(JSON.parse(String(out).trim().split(/\r?\n/).pop())); } catch { reject(new Error(e?.message || 'no answer from HyperCore')); }
  }));
}

const fast = (p) => p && p.connected && /Gbps/.test(p.speed || '');
// one device out of a socket's / hub port's two halves, a hub's two halves merged into one hub
function mergeDev(a, b) {
  const pa = a?.connected ? a : null, pb = b?.connected ? b : null;
  if (!pa && !pb) return null;
  const main = fast(pb) ? pb : fast(pa) ? pa : pa || pb;
  const other = main === pa ? pb : pa;
  const d = { ...main.device, speed: main.speed, gen: main.gen };
  if (main.device.isHub && other?.device?.isHub) {
    d.name = /superspeed/i.test(d.name) || /superspeed/i.test(other.device.name) ? 'USB 3 hub' : d.name;
    d.hub = mergeHub(main.device.hub, other.device.hub);
    d.maxMa = Math.max(main.device.maxMa, other.device.maxMa);
  } else if (main.device.isHub) d.hub = mergeHub(main.device.hub, null);
  return d;
}
function mergeHub(a, b) {
  const n = Math.max(a?.ports?.length || 0, b?.ports?.length || 0);
  const ports = [];
  for (let i = 1; i <= n; i++) {
    const pa = a?.ports?.find((p) => p.port === i), pb = b?.ports?.find((p) => p.port === i);
    ports.push({ port: i, device: mergeDev(pa, pb) });
  }
  const used = ports.reduce((s, p) => s + total(p.device), 0);
  return { ports, busPowered: a?.busPowered ?? b?.busPowered ?? null, usedMa: used };
}
// everything a device and whatever hangs off it asks for (a hub on its own power only costs its own draw)
function total(d) {
  if (!d) return 0;
  const own = Math.max(0, d.maxMa || 0);
  if (!d.hub) return own;
  const kids = d.hub.ports.reduce((s, p) => s + total(p.device), 0);
  return d.selfPowered && d.hub.busPowered === false ? own : own + kids;
}

function build(raw) {
  const roots = [];
  raw.controllers.forEach((c, ci) => c.hubs.forEach((h) => { if (h?.ports) roots.push({ ci, ports: h.ports }); }));
  const seen = new Set(), sockets = [], builtin = [];
  const key = (ci, p) => `${ci}:${p}`;
  let nA = 0;
  for (const r of roots) {
    for (const p of r.ports) {
      if (seen.has(key(r.ci, p.port))) continue;
      seen.add(key(r.ci, p.port));
      if (!p.user) { if (p.connected) builtin.push(mergeDev(p, null)); continue; }
      // its other half: same controller's companion, or (USB-C) the matching USB-C port on the other controller
      let mate = null;
      if (p.companion) {
        for (const r2 of roots) {
          const q = r2.ports.find((x) => x.port === p.companion && (r2 !== r || x.port !== p.port) && x.user && (r2 === r ? true : x.typeC && p.typeC) && (!x.companion || x.companion === p.port));
          if (q && !seen.has(key(r2.ci, q.port))) { mate = q; seen.add(key(r2.ci, q.port)); break; }
        }
      }
      const typeC = p.typeC || mate?.typeC;
      const usb3 = typeC || !!mate;
      const kind = typeC ? 'USB-C' : usb3 ? 'USB-A 3' : 'USB-A 2';
      const dev = mergeDev(p, mate);
      sockets.push({ id: `${kind}-${typeC ? 'c' : ++nA}`, kind, label: typeC ? 'USB-C' : `USB-A ${nA}`, supplyMa: SUPPLY[kind], device: dev, usedMa: total(dev) });
    }
  }
  sockets.sort((a, b) => (a.kind === 'USB-C' ? -1 : b.kind === 'USB-C' ? 1 : a.label.localeCompare(b.label)));
  return { ok: true, at: raw.at, volts: VOLTS, sockets, builtin: builtin.filter(Boolean), power: raw.power };
}

// drives and network links report running byte totals: the difference between two reads is the live speed
let prev = { t: 0, bytes: {} };
function rates(tree) {
  const now = Date.now(), dt = (now - prev.t) / 1000, bytes = {};
  const walk = (d) => {
    if (!d) return;
    for (const x of d.drives || []) {
      const k = `d:${x.letter}`; bytes[k] = [x.read, x.written];
      const p = prev.bytes[k];
      if (p && dt > 0 && dt < 30) { x.readBps = Math.max(0, (x.read - p[0]) / dt); x.writeBps = Math.max(0, (x.written - p[1]) / dt); }
    }
    for (const x of d.nets || []) {
      const k = `n:${x.name}`; bytes[k] = [x.rx, x.tx];
      const p = prev.bytes[k];
      if (p && dt > 0 && dt < 30) { x.rxBps = Math.max(0, (x.rx - p[0]) / dt); x.txBps = Math.max(0, (x.tx - p[1]) / dt); }
    }
    for (const p of d.hub?.ports || []) walk(p.device);
  };
  for (const s of tree.sockets) walk(s.device);
  for (const d of tree.builtin) walk(d);
  prev = { t: now, bytes };
}

async function usbTree(exe) {
  const raw = await run(exe);
  if (!raw.ok) throw new Error(raw.error || 'could not read the USB ports');
  const t = build(raw);
  rates(t);
  t.totalMa = t.sockets.reduce((s, x) => s + x.usedMa, 0);
  return t;
}

// ---------- USB HISTORY: every device ever seen on the ports (local file only, never sent anywhere) ----------
// key = vendor:product (+ serial number when the device has a real one), so a stick moved between sockets is the same device.
class UsbHistory {
  constructor(dir) {
    this.file = path.join(dir, 'usb-history.json');
    this.map = {};
    this.seeded = false;
    try { this.map = JSON.parse(fs.readFileSync(this.file, 'utf8')) || {}; this.seeded = Object.keys(this.map).length > 0; } catch {}
  }
  static key(d) {
    const serial = String(d.id || '').split('\\').pop();
    return `${d.vid}:${d.pid}${serial && !serial.includes('&') && serial !== d.id ? `:${serial}` : ''}`;
  }
  // tree = a usbTree() result. Returns the devices never seen before (empty on the very first read: that one only sets the baseline).
  record(tree) {
    const now = Date.now(), here = new Map(), fresh = [];
    const walk = (d, sock, trail) => {
      if (!d || !d.vid) return;
      const k = UsbHistory.key(d);
      here.set(k, { d, sockId: sock.id, sockLabel: sock.label, trail: trail.join(' → ') });
      (d.hub?.ports || []).forEach((p) => walk(p.device, sock, [...trail, `hub port ${p.port}`]));
    };
    for (const s of tree.sockets || []) walk(s.device, s, []);
    for (const [k, h] of here) {
      const title = h.d.product && !/^usbd|hub$/i.test(h.d.product) && /composite|^generic|^usb (input|device)/i.test(h.d.name) ? h.d.product : h.d.name;
      let e = this.map[k];
      if (!e) { e = this.map[k] = { name: title, vid: h.d.vid, pid: h.d.pid, maker: h.d.maker || '', first: now, count: 1, on: true }; if (this.seeded) fresh.push({ key: k, ...e }); }
      else if (!e.on) e.count++;
      e.name = title; e.last = now; e.on = true; e.sockId = h.sockId; e.sockLabel = h.sockLabel; e.trail = h.trail; e.hub = !!h.d.isHub;
    }
    for (const [k, e] of Object.entries(this.map)) if (!here.has(k)) e.on = false;
    this.seeded = true;
    this.save();
    return fresh;
  }
  list() { return Object.entries(this.map).map(([key, e]) => ({ key, ...e })).sort((a, b) => (b.last || 0) - (a.last || 0)); }
  save() { try { fs.writeFileSync(this.file, JSON.stringify(this.map)); } catch {} }
}

module.exports = { usbTree, build, UsbHistory };
