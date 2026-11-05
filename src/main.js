const { app, BrowserWindow, ipcMain, shell, globalShortcut, screen, dialog, protocol, Menu, safeStorage, webContents } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { Readable } = require('stream');
const hw = require('./hardware');
const { Core } = require('./core');
const { Remote } = require('./remote');
const { Router } = require('./router');
const { usbTree, UsbHistory } = require('./usb');
const { Tagger, analyze, fromName, clean: cleanName, AUDIO: AUDIO_FILE } = require('./tagger');
const { SoundCloud } = require('./soundcloud');
const { Grab } = require('./grab');
const { Vpn } = require('./vpn');
const { SideDock } = require('./sidedock');
const { NotesVault, isPrivate } = require('./notes');
const { Updater } = require('./updater');
const { loadAddons } = require('./addons');

const ROOT = path.join(__dirname, '..');
// HYPERSPACE's own pages: the only place the bridge to the laptop (preload → api) answers
const RENDERER_URL = require('url').pathToFileURL(path.join(ROOT, 'renderer') + path.sep).href.toLowerCase();
// (a broken %-code in an address makes decodeURIComponent throw: that counts as "not ours", never as "let it through")
// and a "..", which can only be there hidden as %2E%2E / %2F (real ones are tidied away before we see the address), too
const ownPage = (u) => {
  try { const d = typeof u === 'string' && decodeURIComponent(u).toLowerCase(); return !!d && d.startsWith(decodeURIComponent(RENDERER_URL)) && !/[\\/]\.\.([\\/?#]|$)/.test(d); } catch { return false; }
};
let win, vjWin;
// test runs get their own profile so they never touch the real settings
if (!app.isPackaged && process.env.HS_USERDATA) app.setPath('userData', process.env.HS_USERDATA);

// ---------- config ----------
const dataDir = app.getPath('userData');
const usbHist = new UsbHistory(dataDir);
const configFile = path.join(dataDir, 'config.json');
const DEFAULTS = {
  fx: 'high',
  vitalsMode: 'graphs',
  core: { elevate: false, useTask: false }, // admin only when asked for (FANS → HARDWARE CORE, or the status bar chip)
  fans: { mode: 'auto', cpu: null, gpu: null },
  overheat: { enabled: true, cpu: 95, gpu: 87, maxFans: true, throttle: false },
  vacuum: { trim: true },
  remote: { enabled: false, port: 7777, key: null },
  vj: {},
};
let config = DEFAULTS;
try { config = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(configFile, 'utf8')) }; } catch {}

// Which GPU draws the UI. 'nvidia' renders on the RTX (far more headroom, and no cross-GPU copy when the
// window is on a monitor wired to it) at the cost of keeping the dGPU awake. Applies at launch.
const renderGpu = process.env.HS_GPU || config.renderGpu || 'nvidia';
if (renderGpu === 'nvidia') app.commandLine.appendSwitch('force_high_performance_gpu');

// ---------- safe drawing: when the graphics card can't keep up, draw without it ----------
// When Windows runs short of memory the graphics process can't build its shaders and dies, and the app froze
// behind it (2026-10-25: memory 96% committed, 4 GB page file). Now HYPERSPACE restarts at once without the
// graphics card ("safe drawing") and keeps it that way for 6 hours, then tries the card again. 'safe' in
// settings makes it permanent. A new launch that finds an older HYPERSPACE frozen takes over the same way.
const safeFile = path.join(dataDir, 'gpu-safe.json');
const heartFile = path.join(dataDir, 'heartbeat.json');
const SAFE_FOR = 6 * 3600e3;
let safeInfo = null;
try { safeInfo = JSON.parse(fs.readFileSync(safeFile, 'utf8')); } catch {}
if (safeInfo && Date.now() - safeInfo.at > SAFE_FOR) { safeInfo = null; try { fs.unlinkSync(safeFile); } catch {} }
let safeDrawing = renderGpu === 'safe' || !!safeInfo || process.argv.includes('--hs-safe-gpu');
if (safeDrawing) app.disableHardwareAcceleration();
function rememberSafe(reason) {
  safeInfo = { at: Date.now(), reason };
  try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(safeFile, JSON.stringify(safeInfo)); } catch {}
}
app.on('child-process-gone', (e, d) => {
  if (d.type !== 'GPU' || safeDrawing || (process.env.HS_SNAPSHOT && !process.env.HS_GPUTEST)) return;
  rememberSafe(`the graphics process ${d.reason.replace(/-/g, ' ')}`);
  app.relaunch({ args: [...process.argv.slice(1).filter((a) => a !== '--relaunched' && a !== '--hs-safe-gpu'), '--relaunched', '--hs-safe-gpu'] });
  app.exit(0);
});
// the live wallpaper sits under the desktop icons: occlusion tracking would think it's hidden and freeze it
if (config.wallpaper?.enabled) app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
// CRATE streams your music files to the player through this scheme (with seeking)
// (CORS on, so pictures can feed the VJ's WebGL and tracks can feed the DJ decks' Web Audio graph)
protocol.registerSchemesAsPrivileged([{ scheme: 'hsmedia', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true, corsEnabled: true } }]);
let saveTimer;
function saveConfig() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(configFile, JSON.stringify(config, null, 2)); } catch {} }, 400);
}

// ---------- event fan-out: every HYPERSPACE window (tabs popped out, VJ output, Spout, wallpaper) + phones ----------
function broadcast(ev, data) {
  for (const w of BrowserWindow.getAllWindows()) if (w !== popWin && !w.hsGrab && !w.isDestroyed()) w.webContents.send('ev', ev, data);
  if (PHONE_EVENTS.has(ev)) remote.broadcast(ev, ev === 'config' ? phoneConfig() : data);
}

// ---------- what a paired phone may do ----------
// An allowlist: exactly what the phone page uses. Nothing that runs programs, touches files, reads notes or reaches
// the admin helper beyond media, volume, fan presets, the mic/camera soft switches and status (a stolen pairing key
// gets no further than that).
const PHONE_EVENTS = new Set(['config', 'crate-now', 'telemetry', 'vpn', 'audio']);
const PHONE_CORE = new Set(['media.get', 'media.cmd', 'audio.getVolume', 'audio.volume', 'fans.set', 'preset.apply', 'status', 'power.get']);
const PHONE_CONFIG = ['preset', 'fans', 'vj', 'look', 'vitalsMode'];
function phoneConfig() { return Object.fromEntries(PHONE_CONFIG.filter((k) => k in config).map((k) => [k, config[k]])); }

// ---------- HyperCore ----------
const coreExe = app.isPackaged
  ? path.join(process.resourcesPath, 'HyperCore.exe')
  : path.join(ROOT, 'core', 'dist', 'HyperCore.exe');
app.setAppUserModelId('com.hyperspace.systemshaman');
const core = new Core({ exe: coreExe, dataDir });
hw.setCore(core); // mic / camera state is read in the core when it runs (no reg.exe / PowerShell every few seconds)
// camera hard kill goes through the elevated core when it can, instead of its own admin prompt
hw.setElevatedCamHook(async (enable, ids) => {
  if (!core.online || !core.status.elevated) return null;
  const r = await core.call('cam.hard', { enable, ids });
  return r.every((x) => x.ok);
});
let lastTelemetry = null;
core.on('event', (ev, data) => {
  if (ev === 'telemetry') { lastTelemetry = data; recordThermal(data); liteTick(data); }
  // Windows' mic / camera consent keys changed (an app opened the mic, the switch was flipped in Settings)
  if (ev === 'privacy') { if (!hw.viaCore()) return; hwCache = { t: Date.now(), v: hw.fromCore(data) }; broadcast('hw-state', hwCache.v); return; }
  if (ev === 'audio') return sendAudio(data);
  broadcast(ev, data);
});

// ---------- LITE MODE: the looks off (background, motion, glow), every feature still working ----------
// AUTO goes lite while something heavy runs and comes back once the laptop has been calm for a while.
// The defaults suit gaming laptops: they run near 92°C when an AI model or a game
// keeps it busy, so lite starts a little before that and full looks wait for a properly cool, quiet minute.
// Memory is Windows' committed memory (RAM + page file): near full, the graphics process starts failing.
const LITE_DEFAULTS = { mode: 'auto', cpu: 70, temp: 88, gpu: 80, mem: 90, enterSec: 15, cpuCalm: 45, tempCalm: 80, gpuCalm: 50, memCalm: 85, leaveSec: 60 };
function memCommitted() {
  try { const m = process.getSystemMemoryInfo(); return m.swapTotal ? Math.round(100 * (1 - m.swapFree / m.swapTotal)) : null; } catch { return null; }
}
const liteCfg = () => ({ ...LITE_DEFAULTS, ...(config.lite || {}) });
let lite = { on: false, why: null }, liteHot = 0, liteCalm = 0, liteLast = 0;
function setLite(on, why) {
  if (on === lite.on && why === lite.why) return;
  lite = { on, why };
  broadcast('lite', liteState());
}
const liteState = () => ({ ...liteCfg(), on: lite.on, why: lite.why, defaults: LITE_DEFAULTS });
function liteTick(t) {
  const c = liteCfg(), now = Date.now(), dt = liteLast ? Math.min(10, (now - liteLast) / 1000) : 2;
  liteLast = now;
  if (c.mode !== 'auto') { liteHot = liteCalm = 0; return setLite(c.mode === 'on', c.mode === 'on' ? 'switched on' : null); }
  const cpu = t?.cpu?.util, temp = t?.cpu?.temp, gpu = t?.gpu?.util, mem = t?.mem ?? memCommitted();
  const hot = cpu >= c.cpu ? `CPU at ${Math.round(cpu)}%` : temp >= c.temp ? `CPU at ${Math.round(temp)}°C` : gpu >= c.gpu ? `GPU at ${Math.round(gpu)}%` : mem >= c.mem ? `memory ${mem}% full` : null;
  const calm = !(cpu >= c.cpuCalm) && !(temp >= c.tempCalm) && !(gpu >= c.gpuCalm) && !(mem >= c.memCalm);
  liteHot = hot ? liteHot + dt : 0;
  liteCalm = calm ? liteCalm + dt : 0;
  if (!lite.on && liteHot >= c.enterSec) setLite(true, hot);
  else if (lite.on && liteCalm >= c.leaveSec) setLite(false, null);
  else if (lite.on && hot && lite.why !== hot && lite.why !== 'switched on') { lite.why = hot; }
}

// ---------- thermal history: a sample every 2 s, kept 12 h and across restarts (NitroSense-style monitor) ----------
const thermalFile = path.join(dataDir, 'thermal-history.json');
const THERMAL_KEEP = 12 * 3600e3;
let thermal = [];
try { thermal = JSON.parse(fs.readFileSync(thermalFile, 'utf8')).filter((r) => Date.now() - r[0] < THERMAL_KEEP); } catch {}
let thermalLast = 0;
function recordThermal(t) {
  const now = Date.now();
  if (now - thermalLast < 1900) return;
  thermalLast = now;
  const n = (v) => (v == null || isNaN(v) ? null : Math.round(v));
  // [time, cpu °C, gpu °C, cpu fan rpm, gpu fan rpm, cpu load %, gpu load %]
  thermal.push([now, n(t.cpu?.temp), n(t.gpuTemp), n(t.cpu?.fanRpm), n(t.gpuFanRpm), n(t.cpu?.util), n(t.gpu?.util)]);
  // old samples go 10 minutes' worth at a time (21,600 kept: shifting one off the front every 2 s moved them all)
  if (thermal.length && now - thermal[0][0] > THERMAL_KEEP + 10 * 60e3) {
    let i = 0;
    while (i < thermal.length && now - thermal[i][0] > THERMAL_KEEP) i++;
    thermal.splice(0, i);
  }
}
// every 5 minutes in the background; on quit it's written at once (the app is about to end)
function saveThermal(quitting = false) {
  try { fs.mkdirSync(dataDir, { recursive: true }); } catch {}
  if (quitting) { try { fs.writeFileSync(thermalFile, JSON.stringify(thermal)); } catch {} return; }
  fs.promises.writeFile(thermalFile + '.tmp', JSON.stringify(thermal)).then(() => fs.promises.rename(thermalFile + '.tmp', thermalFile)).catch(() => {});
}
setInterval(() => saveThermal(), 5 * 60e3);
// Silent admin (opt-in: FANS → SKIP ADMIN PROMPT): a scheduled task starts the core with admin rights without a
// prompt. The elevated core (re)registers it on a copy of itself in Program Files\HYPERSPACE Core, so nothing
// running as you can swap the program the task starts. Done again whenever that copy is from an older version.
let silentAdminTried = false;
async function setupSilentAdmin(quiet = false) {
  if (silentAdminTried || !app.isPackaged || !config.core.useTask) return; // dev runs never touch the real task
  silentAdminTried = true;
  try {
    await core.call('task.install', { conn: core.connFile, app: process.execPath });
    if (!quiet) broadcast('toast', 'SILENT ADMIN READY · HYPERSPACE STARTS WITH FULL CONTROL, NO PROMPT');
  } catch (e) { broadcast('toast', `COULDN'T SET UP SILENT ADMIN: ${e.message}`); }
}
let staleFixTried = false;

let restarts = 0, quitting = false;
core.on('status', (s) => {
  broadcast('core', s);
  if (s.state === 'online' && s.elevated && s.mode === 'uac') setupSilentAdmin();
  // a silent-admin task from before the Program Files copy existed: move it there (no prompt: the core is admin now)
  if (s.state === 'online' && s.elevated && s.mode === 'task' && !/[\\/]HYPERSPACE Core[\\/]/i.test(s.path || '')) setupSilentAdmin(true);
  // the Program Files copy is from an older HYPERSPACE: one admin prompt refreshes it
  if (s.state === 'online' && s.mode === 'task' && s.stale && !staleFixTried && !process.env.HS_SNAPSHOT) {
    staleFixTried = true;
    broadcast('toast', 'HYPERSPACE WAS UPDATED · WINDOWS WILL ASK ONCE TO REFRESH SILENT ADMIN');
    setTimeout(() => core.restart({ elevate: true, useTask: false }), 1500);
  }
  // crashed (not stopped by us): bring it back, but never with a surprise admin prompt
  if (s.state === 'offline' && s.error === 'core exited' && !quitting && restarts < 3) {
    restarts++;
    setTimeout(() => core.start({ elevate: false, useTask: config.core.useTask }), 2000);
  }
});
// Curves saved from the v0.5 templates assumed 0% meant a stopped fan; Acer's 0% is really the idle speed,
// so they ran ~2,000 rpm too fast. Swap any untouched old template for its re-tuned version.
const OLD_CPU_CURVES = {
  '[[40,10],[55,20],[65,32],[75,50],[85,75],[95,100]]': 'quiet',
  '[[40,20],[55,30],[65,45],[75,65],[85,90],[92,100]]': 'balanced',
  '[[40,30],[50,45],[60,60],[70,80],[78,95],[85,100]]': 'aggressive',
};
core.on('online', async () => {
  try {
    const tpl = OLD_CPU_CURVES[JSON.stringify(config.fans.cpu)];
    if (tpl) {
      const c = (await core.call('status')).curves[tpl];
      config.fans = { ...config.fans, cpu: c.cpu, gpu: c.gpu };
      saveConfig();
      broadcast('config', config);
    }
  } catch {}
  // push saved fan curve + overheat settings to the fresh core
  try {
    const f = config.fans;
    await core.call('fans.set', { mode: f.mode, cpu: f.cpu, gpu: f.gpu });
    await core.call('overheat.set', config.overheat);
    if (config.vacuum.exclude) await core.call('mem.exclude', { list: config.vacuum.exclude });
  } catch {}
});

// ---------- audio capture leases: the FFT only runs while a VJ view (window, output, phone) is showing ----------
const leases = new Map(); // id -> expiry ms
let capture = { on: false, source: 'default' };
let audioSource = 'default';
let captureChain = Promise.resolve();
function updateCapture(force = false) {
  // serialized: overlapping start/stop requests would race inside the core
  captureChain = captureChain.then(async () => {
    const now = Date.now();
    for (const [k, exp] of leases) if (exp < now) leases.delete(k);
    const want = leases.size > 0;
    if (!core.online || (!force && want === capture.on && audioSource === capture.source)) return capture;
    try { await core.call('audio.capture', { on: want, source: audioSource }); capture = { on: want, source: audioSource }; } catch {}
    return capture;
  });
  return captureChain;
}
setInterval(updateCapture, 5000);
core.on('online', () => { capture.on = false; updateCapture(true); });
// The FFT arrives ~60 times a second: only the windows (and phones) holding a lease get it, not every window.
// Window leases are "<webContents id>:<name>"; phone leases start with "phone".
function sendAudio(data) {
  const ids = new Set();
  let phones = false;
  for (const k of leases.keys()) { if (k.startsWith('phone')) phones = true; else ids.add(Number(k.split(':')[0])); }
  for (const id of ids) {
    const wc = webContents.fromId(id);
    if (wc && !wc.isDestroyed()) wc.send('ev', 'audio', data);
  }
  if (phones) remote.broadcast('audio', data);
}

// ---------- asset router + its on-screen popup ----------
const router = new Router({ downloads: app.getPath('downloads'), base: path.join(app.getPath('documents'), 'HYPERSPACE Assets') });
let popWin = null, popTimer = null;
function showPopup(entry) {
  const wa = screen.getPrimaryDisplay().workArea;
  const w = 410, h = 300;
  if (!popWin || popWin.isDestroyed()) {
    popWin = new BrowserWindow({
      width: w, height: h, x: wa.x + wa.width - w - 10, y: wa.y + wa.height - h - 10,
      frame: false, transparent: true, resizable: false, alwaysOnTop: true, skipTaskbar: true, focusable: false, show: false, hasShadow: false,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    });
    popWin.setAlwaysOnTop(true, 'screen-saver');
    popWin.loadFile(path.join(ROOT, 'renderer', 'popup.html'));
  }
  const send = () => { popWin.webContents.send('ev', 'popup', entry); popWin.showInactive(); };
  if (popWin.webContents.isLoading()) popWin.webContents.once('did-finish-load', send); else send();
  clearTimeout(popTimer);
  popTimer = setTimeout(() => { if (popWin && !popWin.isDestroyed()) popWin.hide(); }, 5600);
}
router.on('routed', (e) => {
  broadcast('routed', e);
  broadcast('router', router.status());
  if (router.cfg.popup) showPopup(e);
});
router.on('status', (s) => broadcast('router', s));
router.on('error', (m) => broadcast('router-error', m));

// ---------- CRATE track auto-tagger + Music folder watcher (see tagger.js) ----------
const musicDir = app.getPath('music');
const tagger = new Tagger({ downloads: app.getPath('downloads'), music: musicDir, coreExe, dataDir });
router.claim = (f) => tagger.claims(f);
// what HYPERSPACE worked out about files rekordbox hasn't seen: { path(lowercase): { bpm, key, len } }
const anaFile = path.join(dataDir, 'analysis.json');
let ana = {};
try { ana = JSON.parse(fs.readFileSync(anaFile, 'utf8')); } catch {}
let anaSaveT = null;
const saveAna = () => { clearTimeout(anaSaveT); anaSaveT = setTimeout(() => fs.promises.writeFile(anaFile, JSON.stringify(ana)).catch(() => {}), 2000); };
tagger.on('short', (f) => { if (router.cfg.enabled) router.route(f).catch(() => {}); }); // a sample, not a song
tagger.on('tagged', (e) => {
  ana[e.to.toLowerCase()] = { bpm: e.bpm, key: e.key, len: e.len };
  saveAna();
  broadcast('tagged', e);
  showPopup({ ...e, glyph: '♫', rule: `TAGGED → ${path.basename(path.dirname(e.to))}` });
  musicChanged();
});
tagger.on('status', (s) => broadcast('tagger', s));
tagger.on('error', (m) => broadcast('router-error', m));
// new files in Music (dragged in, bought, from the tagger): analysed once, then CRATE reloads
const anaQueue = [];
let anaBusy = false;
// two tracks at a time: the analyser (see tagger.js) works on two at once
async function anaPump() {
  if (anaBusy) return;
  anaBusy = true;
  let did = 0;
  const worker = async () => {
    while (anaQueue.length) {
      const p = anaQueue.shift();
      if (ana[p.toLowerCase()] || !(await fs.promises.access(p).then(() => true, () => false))) continue;
      const r = await analyze(coreExe, p);
      ana[p.toLowerCase()] = r.ok ? { bpm: Math.round(r.bpm * 10) / 10, key: r.key, len: r.len } : { failed: true };
      did++;
      if (did % 40 === 0) { saveAna(); musicChanged(); }
    }
  };
  await Promise.all([worker(), worker()]);
  anaBusy = false;
  if (did) { saveAna(); musicChanged(); }
}
function queueAnalysis(paths) {
  for (const p of paths) if (!ana[p.toLowerCase()] && !fromName(p) && !anaQueue.includes(p)) anaQueue.push(p);
  anaPump();
}
let musicT = null;
function musicChanged() {
  clearTimeout(musicT);
  musicT = setTimeout(async () => { await loadLibrary(false).catch(() => {}); broadcast('crate-changed', {}); }, 2500);
}
let musicWatch = null;
function watchMusic() {
  try { musicWatch?.close(); } catch {}
  musicWatch = null;
  if (crateCfg().watchMusic === false) return;
  try {
    musicWatch = fs.watch(musicDir, { recursive: true }, (ev, name) => {
      if (!name || !AUDIO_FILE.test(name) || /(^|[\\/])[._]/.test(name)) return;
      const p = path.join(musicDir, String(name));
      setTimeout(() => { if (fs.existsSync(p)) { queueAnalysis([p]); musicChanged(); } }, 3000);
    });
    musicWatch.on('error', () => {});
  } catch {}
}

// ---------- NOTES: the encrypted notebook + journal (replaces OneNote) ----------
// The main copy lives in Documents\HYPERSPACE Notes; mirrors (the SSD, later the home server) get every change.
config.notes = { dir: path.join(app.getPath('documents'), 'HYPERSPACE Notes'), mirrors: [], autoLockMin: 15, ...(config.notes || {}) };
// Everyday notes open by themselves on this laptop (their key is kept in a file only this Windows account can
// read, and it stays out of the mirrored folder); the JOURNAL still needs the password.
const notes = new NotesVault({
  dir: (!app.isPackaged && process.env.HS_NOTES_DIR) || config.notes.dir, mirrors: config.notes.mirrors, autoLockMin: config.notes.autoLockMin,
  localKeyFile: path.join(dataDir, 'notes-key.bin'),
  protect: (b) => safeStorage.encryptString(b.toString('base64')),
  unprotect: (buf) => Buffer.from(safeStorage.decryptString(buf), 'base64'),
  // a second copy sealed by Windows itself (DPAPI): survives app / Electron updates that change safeStorage's key
  dpapi: (() => {
    const file = path.join(dataDir, 'notes-key.dpapi');
    const { execFileSync } = require('child_process');
    return {
      has: () => fs.existsSync(file) && fs.existsSync(coreExe),
      load: () => Buffer.from(execFileSync(coreExe, ['--dpapi', 'unprotect', file], { windowsHide: true, timeout: 15000 }).toString().trim(), 'base64'),
      // started in the background: waiting for HyperCore to start made every journal unlock hang for a second or more
      save: (k) => { if (fs.existsSync(coreExe)) { const c = require('child_process').execFile(coreExe, ['--dpapi', 'protect', file], { windowsHide: true, timeout: 15000 }, () => {}); c.stdin.on('error', () => {}); c.stdin.end(k.toString('base64')); } },
    };
  })(),
});
const notesState = () => ({ exists: notes.exists() || (() => { try { notes.readMeta(); return true; } catch { return false; } })(), open: notes.isOpen, unlocked: notes.unlocked, lockedJournal: notes.unlocked ? 0 : notes.lockedJournal || 0, dir: notes.dir, count: notes.notes.size, unreadable: notes.unreadable || 0, autoLockMin: notes.autoLockMin, mirrors: notes.syncState(), importing: !!notesImport });
notes.on('change', (c) => { if (!notes.unlocked) clearOpenedNoteFiles(); broadcast('notes-state', { ...notesState(), why: c.why }); });
// files attached to pages
const NOTE_FILE_MAX = 250 * 1048576;
const NOTE_RUNNABLE = /\.(exe|com|scr|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|msi|msp|msc|lnk|url|reg|jar|dll|cpl|gadget|appref-ms|application|inf|pif|sct|ws)\s*$/i;
const NOTE_OPEN_DIR =path.join(app.getPath('temp'), 'HYPERSPACE opened notes');
const NOTE_MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', zip: 'application/zip', mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', m4a: 'audio/mp4', mp4: 'video/mp4', mov: 'video/quicktime', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
const mimeOfName = (n) => NOTE_MIME[(n.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase()] || 'application/octet-stream';
// a safe file name that keeps its extension (the OneNote import's links say "Open the section PDF", with none)
function blobFileName(bid, name, mime) {
  let n = String(name || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 120) || `note-${bid}`;
  const ext = Object.keys(NOTE_MIME).find((k) => NOTE_MIME[k] === mime);
  if (ext && !/\.[a-z0-9]{1,5}$/i.test(n)) n += `.${ext}`;
  return n;
}
function clearOpenedNoteFiles() { try { fs.rmSync(NOTE_OPEN_DIR, { recursive: true, force: true }); } catch {} }
clearOpenedNoteFiles();
app.on('will-quit', clearOpenedNoteFiles);
notes.on('sync', () => broadcast('notes-state', notesState()));
let notesImport = null;
// OneNote → NOTES: PowerShell reads OneNote, HyperCore turns pages into Markdown, and each page is encrypted
// here the moment it arrives (pipes only, nothing unencrypted on disk). Running it again only picks up pages
// that changed in OneNote, and never overwrites a page you've edited here since.
function importOneNote() {
  if (!notes.unlocked) throw new Error('unlock the journal first (the import may hold journal pages)');
  if (notesImport) return notesImport;
  const script = path.join(__dirname, 'onenote.ps1').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  const line = `powershell -NoProfile -ExecutionPolicy Bypass -File "${script}" | "${coreExe}" --onenote-convert`;
  const p = spawn('cmd.exe', ['/d', '/s', '/c', `"${line}"`], { windowsHide: true, windowsVerbatimArguments: true });
  const byOne = new Map([...notes.notes.values()].filter((n) => n.oneId).map((n) => [n.oneId, n]));
  const st = { total: 0, done: 0, added: 0, updated: 0, skipped: 0, kept: 0, pictures: 0, errors: 0 };
  const tell = () => broadcast('notes-import', { ...st });
  let chain = Promise.resolve();
  const page = async (o) => {
    const prev = byOne.get(o.oneId);
    if (prev && prev.importedFrom === o.modified) { st.skipped++; return; } // unchanged in OneNote
    if (prev && prev.updated !== prev.importedAt) { st.kept++; return; } // you've edited it here: yours wins
    let body = o.md || '';
    const blobs = [], jr = isPrivate(o.notebook, (o.path || []).join(' / '));
    for (const im of o.images || []) {
      const bid = await notes.putBlob(Buffer.from(im.b64, 'base64'), im.mime, jr);
      blobs.push(bid); st.pictures++;
      body = body.split(`hs-image:${im.name}`).join(`hs-blob:${bid}`);
    }
    if (o.pdf) { const bid = await notes.putBlob(Buffer.from(o.pdf, 'base64'), 'application/pdf', jr); blobs.push(bid); body += `\n\n[Handwritten page (PDF)](hs-blob:${bid})\n`; }
    const when = (s) => (s && !isNaN(Date.parse(s)) ? new Date(s).toISOString() : new Date().toISOString());
    const updated = when(o.modified);
    const saved = await notes.save({
      id: prev?.id, oneId: o.oneId, source: 'onenote', title: (o.title || '').trim() || 'Untitled', notebook: o.notebook || 'OneNote',
      section: (o.path || []).join(' / '), body, blobs, journal: jr, created: when(o.created), updated, keepDates: true, importedFrom: o.modified, importedAt: updated,
    });
    byOne.set(o.oneId, saved);
    if (prev) st.updated++; else st.added++;
  };
  notesImport = new Promise((resolve, reject) => {
    let buf = '', err = null;
    p.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const s = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!s) continue;
        let o; try { o = JSON.parse(s); } catch { continue; }
        if (o.type === 'start') { st.total = o.total; tell(); }
        else if (o.type === 'page') chain = chain.then(() => page(o)).catch(() => { st.errors++; }).then(() => { st.done++; if (st.done % 5 === 0 || st.done === st.total) tell(); });
        else if (o.type === 'page-error') { st.errors++; st.done++; }
        else if (o.type === 'error') err = o.error;
      }
    });
    p.on('error', (e) => { err = e.message; });
    p.on('exit', () => chain.then(async () => {
      notesImport = null;
      await notes.syncAll().catch(() => {});
      const r = { ...st, error: err && !st.done ? err : null, finished: true };
      broadcast('notes-import', r);
      broadcast('notes-state', notesState());
      if (r.error) reject(new Error(r.error)); else resolve(r);
    }));
  });
  notesImport.catch(() => {});
  return notesImport;
}
// A folder of exported OneNote pages → NOTES. Layout: <root>\<Notebook>\<Section>[\<Section>…]\<Page>.txt, where a
// page starts with its title, then "Date: <ISO time>", then the text; pictures sit beside it as
// "<Page> - picture N.png", and "<Section> (full section).pdf" is a snapshot of the whole section (kept as its own
// page, since it shows handwriting and layout the text can't). Running it again skips pages already imported.
let folderImport = null;
function importFolder(root) {
  if (!notes.unlocked) throw new Error('unlock the journal first (the import may hold journal pages)');
  if (folderImport) return folderImport;
  const IMG = /\.(png|jpe?g|gif|webp)$/i;
  const mimeOf = (f) => ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf' }[path.extname(f).toLowerCase()] || 'application/octet-stream');
  const done = new Set([...notes.notes.values()].filter((n) => n.importPath).map((n) => n.importPath.toLowerCase()));
  const st = { total: 0, done: 0, added: 0, skipped: 0, pictures: 0, pdfs: 0, errors: 0 };
  const jobs = [];
  const walk = (dir, notebook, sec) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!/recyclebin/i.test(e.name)) walk(p, notebook, [...sec, e.name]); continue; }
      if (/\.txt$/i.test(e.name) || /\(full section\)\.pdf$/i.test(e.name)) jobs.push({ p, notebook, sec, dir });
    }
  };
  for (const nb of fs.readdirSync(root, { withFileTypes: true })) if (nb.isDirectory() && !/recyclebin/i.test(nb.name)) walk(path.join(root, nb.name), nb.name, []);
  st.total = jobs.length;
  folderImport = (async () => {
    broadcast('notes-import', { ...st });
    for (const j of jobs) {
      const rel = path.relative(root, j.p);
      try {
        if (done.has(rel.toLowerCase())) { st.skipped++; continue; }
        const section = j.sec.join(' / '), jr = isPrivate(j.notebook, section);
        const mtime = fs.statSync(j.p).mtime.toISOString();
        if (/\.pdf$/i.test(j.p)) {
          const bid = await notes.putBlob(fs.readFileSync(j.p), 'application/pdf', jr);
          await notes.save({ title: `${j.sec[j.sec.length - 1] || j.notebook}: whole section (PDF)`, notebook: j.notebook, section, body: `A snapshot of the whole section as it looked in OneNote, handwriting and drawings included.\n\n[Open the section PDF](hs-blob:${bid})\n`, blobs: [bid], journal: jr, created: mtime, updated: mtime, keepDates: true, importPath: rel, source: 'onenote-export' });
          st.pdfs++; st.added++;
        } else {
          const lines = fs.readFileSync(j.p, 'utf8').replace(/^﻿/, '').replace(/\r/g, '').split('\n');
          const title = (lines[0] || path.basename(j.p, '.txt')).trim();
          let i = 1, date = null;
          const m = /^Date:\s*(\S+)/.exec(lines[1] || '');
          if (m && !isNaN(Date.parse(m[1]))) { date = new Date(m[1]).toISOString(); i = 2; }
          let body = lines.slice(i).join('\n').replace(/^\n+/, '');
          const base = path.basename(j.p, '.txt');
          const pics = fs.readdirSync(j.dir).filter((f) => IMG.test(f) && f.toLowerCase().startsWith(`${base.toLowerCase()} - picture`)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
          const blobs = [];
          for (const f of pics) { const bid = await notes.putBlob(fs.readFileSync(path.join(j.dir, f)), mimeOf(f), jr); blobs.push(bid); body += `\n\n![${f.replace(/\.[^.]+$/, '')}](hs-blob:${bid})`; st.pictures++; }
          await notes.save({ title: title || 'Untitled', notebook: j.notebook, section, body: body.trimEnd() + '\n', blobs, journal: jr, created: date || mtime, updated: date || mtime, keepDates: true, importPath: rel, source: 'onenote-export' });
          st.added++;
        }
      } catch { st.errors++; }
      st.done++;
      if (st.done % 5 === 0) broadcast('notes-import', { ...st });
    }
    folderImport = null;
    // say "done" as soon as the pages are in; the copy to the SSD carries on in the background
    const r = { ...st, finished: true };
    broadcast('notes-import', r);
    broadcast('notes-state', notesState());
    notes.syncAll().then(() => broadcast('notes-state', notesState())).catch(() => {});
    return r;
  })();
  return folderImport;
}
// which drives could hold a copy (the SSD, a USB stick, a mapped server drive)
function driveList() {
  const out = [];
  for (const L of 'DEFGHIJKLMNOPQRSTUVWXYZ') {
    const root = `${L}:\\`;
    if (!fs.existsSync(root)) continue;
    let label = '';
    try { label = require('child_process').execFileSync('cmd.exe', ['/d', '/c', `vol ${L}:`], { windowsHide: true, timeout: 3000 }).toString().split(/\r?\n/)[0].replace(/^.*is\s+/, '').trim(); } catch {}
    out.push({ root, label, suggest: path.join(root, 'HYPERSPACE Notes') });
  }
  return out;
}
const TODO_FILE = path.join(dataDir, 'todo.json');

// ---------- phone link ----------
const remote = new Remote({ root: ROOT, api: null,
  // the phone streams CRATE tracks and covers (paths are known once a library load has run)
  media: (kind, id) => (kind === 'track' ? lib.paths.get(id) : lib.art.get(id) || sc.artPath(id)),
  // every paired device is remembered; one HYPERSPACE hasn't seen before gets announced on the laptop
  onDevice: (ip, ua) => {
    const kind = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone' : /Windows/.test(ua) ? 'Windows PC' : /Mac/.test(ua) ? 'Mac' : 'device';
    const list = config.remote.devices || [];
    const d = list.find((x) => x.ip === ip && x.kind === kind);
    if (d) d.last = Date.now();
    else {
      list.push({ ip, kind, first: Date.now(), last: Date.now() });
      if (!isLoopbackIp(ip)) broadcast('toast', `NEW DEVICE PAIRED · ${kind.toUpperCase()} · ${ip} · NOT YOU? LINK → NEW PAIRING KEY`);
    }
    config.remote.devices = list.slice(-20);
    saveConfig();
  } });
const isLoopbackIp = (ip) => ip === '::1' || ip.startsWith('127.');

// ---------- trusted networks: the phone link only runs on Wi-Fi you've approved ----------
// On any other network (a café, a hotel, a friend's) it stays off until you trust that network in LINK.
let network = null; // the current network's name (a Wi-Fi name, or "wired network")
function readNetwork() {
  return new Promise((res) => require('child_process').execFile('netsh', ['wlan', 'show', 'interfaces'], { windowsHide: true, timeout: 8000 }, (e, out = '') => {
    const ssid = /^\s*SSID\s*:\s*(.+)$/m.exec(out), state = /^\s*State\s*:\s*(.+)$/m.exec(out);
    res(ssid && state && /^connected/i.test(state[1].trim()) ? ssid[1].trim() : 'wired network');
  }));
}
const linkPaused = () => !!network && !(config.remote.trusted || []).includes(network);
// netsh only runs when it can matter: the phone link is on, and the adapters or their addresses changed since the
// last look (joining another Wi-Fi always changes the address). Was: netsh every 10 s, link on or off.
let netSig = null, netAt = 0;
const netSignature = () => Object.entries(os.networkInterfaces()).map(([n, a]) => `${n}=${a.map((x) => x.address).join(',')}`).sort().join('|');
async function watchNetwork(force = false) {
  if (!force && !config.remote.enabled) return;
  const sig = netSignature();
  // (and once every 5 minutes anyway, in case two networks happened to hand out the same address)
  if (!force && sig === netSig && network !== null && Date.now() - netAt < 300e3) return;
  netSig = sig;
  netAt = Date.now();
  const n = await readNetwork();
  if (n === network) return;
  const was = linkPaused();
  network = n;
  // the network this update first runs on is the one you've been using: trust it so nothing changes
  if (!Array.isArray(config.remote.trusted)) { config.remote.trusted = [n]; saveConfig(); }
  if (config.remote.enabled) {
    await applyRemote();
    if (linkPaused() && !was) broadcast('toast', `PHONE LINK PAUSED · "${n}" ISN'T A TRUSTED NETWORK · TRUST IT IN LINK`);
  }
  broadcast('link-network', { network, paused: linkPaused() });
}
setInterval(() => watchNetwork().catch(() => {}), 10000);

async function applyRemote() {
  const r = config.remote;
  if (!r.enabled) { remote.stop(); return { ok: true }; }
  await watchNetwork(network === null).catch(() => {}); // (a no-op when nothing changed since the last look)
  if (linkPaused()) { remote.stop(); return { ok: false, paused: true, error: `paused: "${network}" isn't a trusted network` }; }
  if (!r.key) { r.key = crypto.randomBytes(18).toString('base64url'); saveConfig(); }
  const tls = await phoneCerts().catch(() => null);
  return remote.start(r.port, r.key, '0.0.0.0', tls);
}
// The secure door's certificate (see core/PhoneCerts.cs): made once, renewed when it's within a month of
// expiring or the laptop's Wi-Fi address changes. The authority the phone trusts is kept across renewals.
const tlsDir = path.join(dataDir, 'phone-tls');
async function phoneCerts() {
  const { lanAddresses } = require('./remote');
  const ips = [...new Set([...lanAddresses().map((a) => a.address), '127.0.0.1'])].sort();
  const names = ['hyperspace.local', `${os.hostname().toLowerCase()}.local`, 'localhost'];
  const metaFile = path.join(tlsDir, 'meta.json');
  let meta = null;
  try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch {}
  const fresh = meta && fs.existsSync(path.join(tlsDir, 'server.pfx')) && meta.until - Date.now() > 30 * 864e5 && ips.every((ip) => meta.ips.includes(ip));
  if (!fresh) {
    await new Promise((res, rej) => {
      const p = spawn(coreExe, ['--make-certs', tlsDir, names.join(','), ips.join(',')], { windowsHide: true });
      let out = '';
      p.stdout.on('data', (d) => { out += d; });
      p.on('error', rej);
      p.on('exit', (code) => (code === 0 && /^OK/m.test(out) ? res() : rej(new Error(out || `exit ${code}`))));
    });
    meta = { ips, until: Date.now() + 397 * 864e5 };
    fs.writeFileSync(metaFile, JSON.stringify(meta));
  }
  return { pfx: fs.readFileSync(path.join(tlsDir, 'server.pfx')), passphrase: 'hyperspace', port: (config.remote.port || 7777) + 1, dir: tlsDir };
}

// ---------- system info ----------
async function getStaticInfo() {
  const si = require('systeminformation'); // loaded on first use: it's big, and nothing else needs it at launch
  const [cpu, osInfo, gfx, system] = await Promise.all([
    si.cpu(), si.osInfo(), si.graphics().catch(() => ({ controllers: [] })), si.system(),
  ]);
  return {
    cpu: cpu.brand.replace(/®|™|\(R\)|\(TM\)/g, '').replace(/^Gen\s+/, '').trim(),
    cores: cpu.cores,
    os: `${osInfo.distro} ${osInfo.build || ''}`.trim(),
    host: osInfo.hostname,
    gpu: (gfx.controllers || []).map((g) => g.model).filter(Boolean),
    memTotal: os.totalmem(),
    machine: `${system.manufacturer} ${system.model}`.trim(),
    acer: /acer/i.test(system.manufacturer || ''), // fan curves, Acer profiles and the NitroSense key only exist there
  };
}

// CPU load straight from os.cpus() tick deltas: instant, no child process.
let prevTicks = null;
function sampleCpu() {
  const now = os.cpus().map((c) => {
    const t = c.times;
    return { idle: t.idle, total: t.user + t.nice + t.sys + t.idle + t.irq };
  });
  const prev = prevTicks || now.map(() => ({ idle: 0, total: 0 }));
  prevTicks = now;
  const cores = now.map((c, i) => {
    const dt = c.total - prev[i].total;
    return dt > 0 ? (1 - (c.idle - prev[i].idle) / dt) * 100 : 0;
  });
  return { cores, load: cores.reduce((a, c) => a + c, 0) / cores.length };
}
sampleCpu();

// Slow sources. Drives + battery come from the core every ~20 s; the PowerShell helper (disk / net / GPU load) and
// systeminformation are only the fallback when the core isn't running. At launch the core gets a few seconds to
// come online before any of that fallback starts (it used to start a PowerShell at once, during the launch burst).
const slow = { extra: { ok: false }, drives: [], battery: null, n: 0 };
const coreLate = () => !core.online && process.uptime() < 8; // (the core is usually online ~1-2 s after launch)
async function slowLoop() {
  try {
    if (!core.online && !coreLate() && anyoneLooking()) slow.extra = await hw.helper('perf');
    if (slow.n % 10 === 0 || (slow.n % 2 === 0 && !slow.got)) {
      if (core.online) {
        const r = await core.call('sys.slow');
        slow.drives = r.drives || [];
        slow.battery = r.battery;
        slow.got = true;
      } else if (!coreLate()) {
        const si = require('systeminformation'); // (only loaded when it's needed)
        const [fsz, b] = await Promise.all([si.fsSize().catch(() => []), si.battery().catch(() => ({}))]);
        slow.drives = fsz.map((d) => ({ mount: d.mount, size: d.size, used: d.used }));
        slow.battery = b.hasBattery ? { pct: b.percent, charging: b.isCharging } : null;
        slow.got = true;
      }
    }
  } catch {}
  slow.n++;
  setTimeout(slowLoop, 2000);
}

// several windows poll this: share one sample per ~second so CPU deltas stay meaningful
let perfCache = null;
function getPerf() {
  if (perfCache && Date.now() - perfCache.t < 700) return perfCache;
  return (perfCache = samplePerf());
}
function samplePerf() {
  const { load, cores } = sampleCpu();
  const t = core.online ? lastTelemetry : null;
  const e = slow.extra;
  const io = t?.io;
  return {
    t: Date.now(),
    cpu: load,
    cores,
    mem: { used: os.totalmem() - os.freemem(), total: os.totalmem() },
    net: io ? io.net : { rx: e.ok ? e.netRx : 0, tx: e.ok ? e.netTx : 0 },
    disk: io ? io.disk : e.ok ? { pct: e.diskPct, read: e.diskRead, write: e.diskWrite } : { pct: 0, read: 0, write: 0 },
    gpu: t?.gpu ? t.gpu.util : e.ok ? e.gpuPct : 0,
    temps: t ? { cpu: t.cpu.temp, gpu: t.gpuTemp } : null,
    selfGpu: core.online ? selfGpu : null,
    drives: slow.drives,
    battery: slow.battery,
    uptime: os.uptime(),
  };
}

// ---------- one sample per source, shared by every window, skipped while nobody can see it ----------
// The main window and the side dock both poll the process list and the mic / camera state. Each source is
// sampled at most once per ~2 s (both get the same sample), and a window that can't be seen (minimised, hidden,
// the dock slid away) just gets the last sample back instead of starting a new one.
function seenWin(w) {
  if (!w || w.isDestroyed() || !w.isVisible() || w.isMinimized()) return false;
  if (w.hsDock && dock.autoHide() && !dock.open) return false; // slid away: only its glowing edge shows
  return true;
}
const seen = (e) => seenWin(BrowserWindow.fromWebContents(e.sender));
const anyoneLooking = () => BrowserWindow.getAllWindows().some((w) => (w === win || w.hsDock || popouts.has(w.id)) && seenWin(w)) || remote.clients.size > 0;
// shares one in-flight request and keeps its answer for `ttl` ms
function shared(ttl, fn) {
  const c = { t: 0, v: undefined, p: null };
  const get = (...args) => {
    if (c.v !== undefined && Date.now() - c.t < ttl && c.ok?.(...args) !== false) return Promise.resolve(c.v);
    if (!c.p) c.p = Promise.resolve(fn(...args)).then((v) => { c.v = v; c.t = Date.now(); return v; }).finally(() => { c.p = null; });
    return c.p;
  };
  get.cache = c;
  return get;
}

// GPU used by HYPERSPACE itself (all its Electron processes + the core), from the core's per-process counters.
// The GPU columns cost the core more than everything else, so they're only asked for while the task list is on
// screen (the renderer passes { gpu: true }); a sample with GPU numbers also serves a request without.
let selfGpu = null;
const getProcesses = shared(1800, async ({ gpu = false } = {}) => {
  if (core.online) {
    try {
      const list = await core.call('procs', { gpu });
      if (gpu) {
        const mine = new Set(app.getAppMetrics().map((m) => m.pid));
        if (core.status.pid) mine.add(core.status.pid);
        selfGpu = list.filter((p) => mine.has(p.pid)).reduce((a, p) => a + (p.gpu || 0), 0);
      }
      return { total: list.length, gpu, list: list.map((p) => ({ pid: p.pid, name: p.name, cpu: p.cpu, mem: p.mem, vram: p.vram, gpu: p.gpu })) };
    } catch {}
  }
  if (coreLate()) return { total: 0, list: [] }; // the core is still starting: don't start PowerShell for one look
  const r = await hw.helper('procs');
  const list = r.ok ? (r.list || []).map(([pid, name, cpu, mem]) => ({ pid, name, cpu: Math.min(100, cpu), mem })) : [];
  return { total: list.length, list };
});
getProcesses.cache.ok = (o) => !o?.gpu || getProcesses.cache.v.gpu; // a sample without GPU numbers can't answer { gpu: true }

// mic / camera state (also pushed by the core the moment Windows' consent keys change: see core.on('event'))
let hwCache = null;
const hwShared = shared(1800, async () => {
  if (coreLate()) await core.waitOnline(3000); // at launch: the core reads it in-process, PowerShell would be a burst
  const v = await hw.getState();
  hwCache = { t: Date.now(), v };
  return v;
});
const getHwState = () => (hwCache && Date.now() - hwCache.t < 1800 ? Promise.resolve(hwCache.v) : hwShared());
const keepHw = (v) => { hwCache = { t: Date.now(), v }; broadcast('hw-state', v); return v; };

// ---------- VJ output window (fullscreen on another display) ----------
function openVjOut(displayId) {
  if (vjWin && !vjWin.isDestroyed()) vjWin.close();
  if (displayId == null) return { ok: true, open: false };
  const d = screen.getAllDisplays().find((x) => x.id === displayId) || screen.getPrimaryDisplay();
  vjWin = new BrowserWindow({
    x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
    frame: false, fullscreen: true, backgroundColor: '#000000', title: 'HYPERSPACE // VJ OUT',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  vjWin.loadFile(path.join(ROOT, 'renderer', 'vj-out.html'));
  vjWin.on('closed', () => { vjWin = null; broadcast('vj-out', { open: false }); });
  broadcast('vj-out', { open: true, display: d.id });
  return { ok: true, open: true };
}

// ---------- Spout output ----------
// A hidden VJ renderer streams frames to `HyperCore --spout` (a separate NON-elevated process), which publishes
// them as a Spout source for Resolume, MilkDrop, OBS, TouchDesigner. Every frame is copied off the graphics chip,
// which is heavy (a 4K frame is 33 MB), so by default it only runs while a VJ app is open (when: 'vjapp').
const SPOUT_DEFAULTS = { enabled: false, name: 'HYPERSPACE', width: 1920, height: 1080, fps: 60, gpu: 'nvidia', when: 'vjapp' };
// process names (lower case, without .exe) of apps that can receive Spout
const VJ_APPS = /^(arena|avenue|wire|alley|obs64|obs32|obs|touchdesigner\w*|touchplayer\w*|milkdrop\w*|md3\w*|nestdrop\w*|notch\w*|madmapper|magic|vmix\w*|synesthesia|millumin\w*|smode\w*|vdmx\w*|spoutreceiver|spout ?demo\w*)$/i;
let vjApp = null, vjAppGone = 0;
let spoutWin = null;
let spout = { proc: null, port: null, token: null, adapter: null, fps: 0, size: null, error: null, lastFrames: 0, lastT: 0 };
const spoutCfg = () => ({ ...SPOUT_DEFAULTS, ...(config.spout || {}) });
function spoutStatus() {
  const c = spoutCfg();
  return { ...c, running: !!(spout.proc && spout.port), adapter: spout.adapter, fps: spout.fps, size: spout.size, error: spout.error, waiting: c.enabled && c.when === 'vjapp' && !spout.proc, vjApp };
}
// every 5 s: start the sender when a VJ app opens, stop it 15 s after the last one closes
function spoutTick() {
  const c = spoutCfg();
  const decide = () => {
    const want = c.enabled && (c.when === 'always' || !!vjApp);
    // a sender that just failed (wrong graphics chip, Spout missing) gets a minute before the next try, not 5 s
    if (want && !spout.proc && !(spout.error && Date.now() - (spout.errorAt || 0) < 60000)) startSpout();
    else if (!want && spout.proc && (!c.enabled || c.when === 'always' || Date.now() - vjAppGone > 15000)) { stopSpout(); broadcast('spout', spoutStatus()); }
  };
  if (!c.enabled || c.when === 'always') { vjApp = null; return decide(); }
  runningNames().then((list) => {
    if (!list) return;
    const found = list.map((n) => n.replace(/\.exe$/i, '')).find((n) => VJ_APPS.test(n)) || null;
    if (vjApp && !found) vjAppGone = Date.now();
    const changed = found !== vjApp;
    vjApp = found;
    decide();
    if (changed) broadcast('spout', spoutStatus());
  });
}
// The running programs' file names, lower case ("obs64.exe"): from the core (one system call), else tasklist.
// Shared for ~2 s between the Spout and VPN checks. null = couldn't tell.
const runningNames = shared(2000, async () => {
  if (core.online) { try { return await core.call('procs.names'); } catch {} }
  return new Promise((res) => execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 8000, maxBuffer: 4 << 20 }, (err, out) => {
    res(err ? null : String(out).split(/\r?\n/).map((l) => ((l.match(/^"([^"]+)"/) || [])[1] || '').toLowerCase()).filter(Boolean));
  }));
});
function stopSpout() {
  if (spoutWin && !spoutWin.isDestroyed()) spoutWin.destroy();
  spoutWin = null;
  const p = spout.proc;
  if (p) {
    try { p.stdin.end(); } catch {} // the sender unregisters itself from Spout when its stdin closes
    setTimeout(() => { try { p.kill(); } catch {} }, 1500);
  }
  spout = { proc: null, port: null, token: null, adapter: null, fps: 0, size: null, error: null, lastFrames: 0, lastT: 0 };
}
function startSpout() {
  const c = spoutCfg();
  if (!c.enabled) return broadcast('spout', spoutStatus());
  if (!fs.existsSync(coreExe)) { spout.error = 'HyperCore.exe is missing'; return broadcast('spout', spoutStatus()); }
  spout.token = crypto.randomBytes(18).toString('hex');
  spout.error = null; // (a retry after a failure starts clean)
  const proc = spawn(coreExe, ['--spout', '--token', spout.token, '--name', c.name, '--gpu', c.gpu], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  spout.proc = proc;
  let buf = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { onSpoutLine(buf.slice(0, i).trim()); buf = buf.slice(i + 1); }
  });
  proc.on('exit', (code) => {
    if (spout.proc !== proc) return;
    const err = spout.error || (code ? `Spout sender stopped (${code})` : null);
    stopSpout();
    spout.error = err;
    spout.errorAt = Date.now();
    broadcast('spout', spoutStatus());
  });
}
function onSpoutLine(line) {
  let m;
  if ((m = line.match(/^PORT (\d+) ADAPTER (.*)$/))) {
    spout.port = +m[1];
    spout.adapter = m[2];
    const c = spoutCfg();
    spoutWin = new BrowserWindow({
      show: false, width: 640, height: 360, title: 'HYPERSPACE // SPOUT',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    });
    spoutWin.loadFile(path.join(ROOT, 'renderer', 'vj-out.html'), { query: { mode: 'spout', w: String(c.width), h: String(c.height), fps: String(c.fps) } });
    spoutWin.on('closed', () => { spoutWin = null; });
  } else if ((m = line.match(/^STATS (\d+) (\d+)x(\d+)$/))) {
    const now = Date.now(), frames = +m[1];
    if (spout.lastT) spout.fps = Math.round(((frames - spout.lastFrames) * 1000) / (now - spout.lastT));
    spout.lastFrames = frames;
    spout.lastT = now;
    spout.size = +m[2] ? `${m[2]}×${m[3]}` : null;
  } else if (line.startsWith('ERROR')) spout.error = line.slice(6);
  broadcast('spout', spoutStatus());
}

// ---------- live wallpaper ----------
// One borderless VJ renderer per chosen screen, re-parented by `HyperCore --wallpaper attach` into the
// desktop's wallpaper layer: under the icons and every app. Pauses while a game/video covers that screen.
const WALL_DEFAULTS = { enabled: false, screens: null, fps: 30, quality: 'eco', pauseCovered: true };
const wall = { wins: new Map(), error: null, timer: null };
function wallCfg() {
  const c = { ...WALL_DEFAULTS, ...(config.wallpaper || {}) };
  const ids = screen.getAllDisplays().map((d) => String(d.id));
  c.screens = (c.screens || []).filter((s) => ids.includes(s));
  if (!c.screens.length) c.screens = [String(screen.getPrimaryDisplay().id)];
  return c;
}
function wallStatus() {
  const all = [...wall.wins.values()];
  return { ...wallCfg(), displays: api.vjDisplays(), live: all.filter((w) => w.attached).length, paused: all.some((w) => w.paused), error: wall.error };
}
function stopWall() {
  clearInterval(wall.timer);
  wall.timer = null;
  const had = wall.wins.size;
  for (const w of wall.wins.values()) { w.stopping = true; if (!w.win.isDestroyed()) w.win.destroy(); }
  wall.wins.clear();
  if (had) spawn(coreExe, ['--wallpaper', 'refresh'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
}
function startWall() {
  const c = wallCfg();
  if (!c.enabled || (process.env.HS_SNAPSHOT && !process.env.HS_WALLTEST)) return broadcast('wallpaper', wallStatus());
  wall.error = null;
  for (const d of screen.getAllDisplays()) {
    const id = String(d.id);
    if (!c.screens.includes(id)) continue;
    // created off-screen so nothing flashes on top before it moves under the icons
    const w = new BrowserWindow({
      x: -32000, y: -32000, width: d.bounds.width, height: d.bounds.height, frame: false, show: false, skipTaskbar: true,
      focusable: false, resizable: false, backgroundColor: '#000000', title: 'HYPERSPACE // WALLPAPER',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    });
    const entry = { win: w, display: d, attached: false, paused: false };
    wall.wins.set(id, entry);
    w.loadFile(path.join(ROOT, 'renderer', 'vj-out.html'), { query: { mode: 'wallpaper', d: id, fps: String(c.fps), q: c.quality } });
    w.once('ready-to-show', () => attachWall(entry));
    w.on('closed', () => {
      if (entry.stopping || wall.wins.get(id) !== entry) return;
      wall.wins.delete(id);
      // Explorer restarting takes the wallpaper layer (and our window with it): rebuild
      if (wallCfg().enabled && !quitting) setTimeout(() => { if (!wall.wins.size) startWall(); }, 3000);
    });
  }
  wall.timer = setInterval(checkCovered, 2000);
  broadcast('wallpaper', wallStatus());
}
function attachWall(entry) {
  const buf = entry.win.getNativeWindowHandle();
  const hwnd = buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0));
  const r = screen.dipToScreenRect(null, entry.display.bounds);
  entry.win.showInactive();
  const p = spawn(coreExe, ['--wallpaper', 'attach', hwnd.toString(), r.x, r.y, r.width, r.height].map(String), { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.on('error', (e) => { out = 'ERROR ' + e.message; });
  p.on('close', () => {
    if (out.startsWith('OK')) entry.attached = true;
    else {
      wall.error = out.replace(/^ERROR\s*/, '').trim() || 'could not reach the desktop';
      entry.stopping = true;
      if (!entry.win.isDestroyed()) entry.win.destroy();
    }
    broadcast('wallpaper', wallStatus());
  });
}
async function checkCovered() {
  const c = wallCfg();
  let cov = null;
  if (c.pauseCovered && core.online) { try { cov = (await core.call('desk.covered')).covered; } catch {} }
  let changed = false;
  for (const [id, e] of wall.wins) {
    const r = screen.dipToScreenRect(null, e.display.bounds);
    const paused = !!cov && Math.abs(cov[0] - r.x) < 3 && Math.abs(cov[1] - r.y) < 3 && Math.abs(cov[2] - r.width) < 3 && Math.abs(cov[3] - r.height) < 3;
    if (paused !== e.paused) { e.paused = paused; changed = true; broadcast('wallpaper-pause', { id, paused }); }
  }
  if (changed) broadcast('wallpaper', wallStatus());
}

// ---------- NitroSense key → HYPERSPACE ----------
// A small non-elevated `HyperCore --keyagent` starts at logon (HKCU Run) and swaps NitroSense for HYPERSPACE.
const agentFile = path.join(process.env.LOCALAPPDATA || os.homedir(), 'HYPERSPACE', 'keyagent.json');
const nsCfg = () => ({ enabled: false, mode: 'key', ...(config.nsKey || {}) });
function agentArgs(mode) {
  const a = ['--keyagent', '--mode', mode, '--app', process.execPath];
  if (!app.isPackaged) a.push('--app-args', `"${ROOT}"`);
  return a;
}
function keyStatus() {
  let st = null;
  try { st = JSON.parse(fs.readFileSync(agentFile, 'utf8')); process.kill(st.pid, 0); } catch { st = null; }
  return { ...nsCfg(), running: !!st, acerEvents: st?.acerEvents ?? 0, triggers: st?.triggers ?? 0 };
}
async function applyKeyAgent(restart = true) {
  const c = nsCfg();
  if (process.env.HS_SNAPSHOT) return keyStatus();
  if (restart) await new Promise((res) => { const p = spawn(coreExe, ['--keyagent-stop'], { windowsHide: true, stdio: 'ignore' }); p.on('exit', res); p.on('error', res); });
  try { app.setLoginItemSettings({ openAtLogin: c.enabled, path: coreExe, args: agentArgs(c.mode), name: 'HYPERSPACE Key' }); } catch {}
  if (c.enabled && (restart || !keyStatus().running)) {
    await new Promise((r) => setTimeout(r, 300));
    spawn(coreExe, agentArgs(c.mode), { detached: true, windowsHide: true, stdio: 'ignore' }).on('error', () => {}).unref();
    await new Promise((r) => setTimeout(r, 900));
  }
  return keyStatus();
}

// ---------- CRATE: music library (rekordbox via the core + plain folders) ----------
const AUDIO_EXT = new Set(['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.aif', '.aiff', '.wma']);
const MIME = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.aif': 'audio/aiff', '.aiff': 'audio/aiff', '.wma': 'audio/x-ms-wma', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const lib = { paths: new Map(), art: new Map(), tracks: [] };
let lastPlaylists = [];
// SoundCloud metadata + artwork for the library (fetched on request, then kept)
const sc = new SoundCloud(dataDir);
const scArt = (id) => sc.artPath(id);
sc.on('progress', (p) => broadcast('sc-progress', p));
sc.on('track', (id) => { const p = sc.artPath(id); if (p) lib.art.set(id, p); });
const crateCfg = () => ({ folders: [], plays: {}, recent: [], ...(config.crate || {}) });
// ⇩ GET: free SoundCloud tracks → your folder → rekordbox (see grab.js)
const grab = new Grab({ dataDir, coreExe, sc, parent: () => win, getConfig: () => config.grab, setConfig: (g) => { config.grab = g; saveConfig(); } });
grab.on('progress', (p) => broadcast('grab-progress', p));

// ---------- SIDE DOCK + VPN status (see sidedock.js / vpn.js) ----------
const vpn = new Vpn({
  adapters: async () => { if (coreLate()) await core.waitOnline(3000); return core.online ? core.call('net.adapters') : null; },
  names: async () => (core.online ? runningNames() : null),
});
vpn.on('change', (s) => broadcast('vpn', s));
const dock = new SideDock({ root: ROOT, core, mainWin: () => win, getConfig: () => config.sidedock, setConfig: (c) => { config.sidedock = c; saveConfig(); } });
// what the main window knows (CRATE's player) for the dock, and the dock's buttons back to it
let crateNow = null;
const dockSend = (ev, data) => { if (dock.win && !dock.win.isDestroyed()) dock.win.webContents.send('ev', ev, data); };
// ---------- one-click VPN: a WireGuard config (e.g. from your Proton account) switched on and off by the core ----------
// The config is copied to <app data>\vpn\<tunnel>.conf (WireGuard names the tunnel after the file). It holds the
// VPN's private key, so it stays in your own app-data folder and never goes over the phone link.
const vpnDir = path.join(dataDir, 'vpn');
function wgInfo() {
  const p = config.vpnwg;
  const conf = p?.name ? path.join(vpnDir, `${p.name}.conf`) : null;
  return { installed: fs.existsSync(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'WireGuard', 'wireguard.exe')), profile: conf && fs.existsSync(conf) ? { name: p.name, label: p.label } : null, conf };
}
async function wgImport(file) {
  if (!file) {
    // the picker belongs to the main window: when that's minimised or in the tray (the usual case when you click the
    // side dock) Windows hides the picker with it, so bring HYPERSPACE up first
    if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
    const r = await dialog.showOpenDialog(win, { title: 'Choose your WireGuard config (.conf) from Proton', defaultPath: app.getPath('downloads'), properties: ['openFile'], filters: [{ name: 'WireGuard config', extensions: ['conf'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    file = r.filePaths[0];
  }
  const text = fs.readFileSync(file, 'utf8');
  if (!/\[Interface\]/i.test(text) || !/PrivateKey\s*=/i.test(text) || !/\[Peer\]/i.test(text)) throw new Error("that file isn't a WireGuard config");
  const proton = /10\.2\.0\.1|proton/i.test(text) || /proton|wg-/i.test(path.basename(file));
  const name = proton ? 'ProtonVPN-WG' : 'HYPERSPACE-VPN';
  if (config.vpnwg?.name) await core.call('vpn.wg', { action: 'down', name: config.vpnwg.name }).catch(() => {}); // swap cleanly
  fs.mkdirSync(vpnDir, { recursive: true });
  fs.writeFileSync(path.join(vpnDir, `${name}.conf`), text, { mode: 0o600 });
  config.vpnwg = { name, label: `${proton ? 'Proton VPN' : 'WireGuard'} · ${path.basename(file, '.conf')}` };
  saveConfig();
  return wgInfo();
}
async function wgSwitch(on) {
  const i = wgInfo();
  if (!i.installed) throw new Error('WireGuard isn\'t installed');
  if (!i.profile) throw new Error('add your WireGuard config first');
  if (!core.status?.elevated) throw new Error('the VPN switch needs HYPERSPACE\'s core running as admin');
  const r = await core.call('vpn.wg', { action: on ? 'up' : 'down', conf: i.conf, name: i.profile.name });
  if (!r.ok) throw new Error(r.error || 'the tunnel didn\'t start');
  setTimeout(() => vpn.poll?.(), 800);
  return { ...wgInfo(), state: r.state };
}
function vpnOpen(provider) {
  // the VPN's own app (where you press Connect). Known installs first, then the Start menu by name: names are
  // compared without spaces or dots, since the app calls itself "ProtonVPN.Client" but the Start menu says "Proton VPN"
  const PF = process.env.ProgramFiles || 'C:/Program Files', PF86 = process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)';
  const known = [
    ['proton', path.join(PF, 'Proton', 'VPN', 'ProtonVPN.Launcher.exe')],
    ['express', path.join(PF86, 'ExpressVPN', 'expressvpn-ui', 'ExpressVPN.exe')],
    ['express', path.join(PF, 'ExpressVPN', 'expressvpn-ui', 'ExpressVPN.exe')],
  ];
  const want = String(provider || '').toLowerCase().replace(/[^a-z]/g, '');
  const hit = known.find(([k, exe]) => (!want || want.includes(k)) && fs.existsSync(exe));
  if (hit) { spawn(hit[1], [], { detached: true, stdio: 'ignore' }).unref(); return true; }
  const key = (want.replace(/vpn|client|app/g, '') || 'vpn').replace(/[^a-z]/g, '');
  // the Start menu search answers whether it found one, so "no VPN app" can say so instead of doing nothing
  return new Promise((resolve) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-Command', `$a = Get-StartApps | Where-Object { ($_.Name -replace '[^a-zA-Z]','') -like '*${key}*' -and $_.Name -match 'vpn' } | Select-Object -First 1; if ($a) { Start-Process ('shell:AppsFolder\\' + $a.AppID); 'OK' } else { 'NONE' }`], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    ps.stdout.on('data', (d) => { out += d; });
    ps.on('error', () => resolve(false));
    ps.on('close', () => { if (/OK/.test(out)) resolve(true); else reject(); });
    const reject = () => resolve(Promise.reject(new Error('no VPN app found on this computer')));
  });
}
// ---------- VPN on/off through the Proton VPN app you're already signed into ----------
// Proton has no command line, so this presses its own Connect / Disconnect button through Windows UI Automation
// (the same thing screen readers use), then puts its window back how it was: in the tray, minimised or open.
const PROTON_PS = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]; $S = [System.Windows.Automation.TreeScope]
$WP = [System.Windows.Automation.WindowPattern]::Pattern; $IP = [System.Windows.Automation.InvokePattern]::Pattern
function Win { $p = Get-Process ProtonVPN.Client -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($p) { $A::RootElement.FindFirst($S::Children, (New-Object System.Windows.Automation.PropertyCondition($A::ProcessIdProperty, [int]$p.Id))) } }
function Id($id) { $w.FindFirst($S::Descendants, (New-Object System.Windows.Automation.PropertyCondition($A::AutomationIdProperty, $id))) }
function Until($ms, $test) { $t = [Diagnostics.Stopwatch]::StartNew(); while ($t.ElapsedMilliseconds -lt $ms) { $r = & $test; if ($r) { return $r }; Start-Sleep -Milliseconds 250 } }
$launcher = Join-Path $env:ProgramFiles 'Proton\VPN\ProtonVPN.Launcher.exe'
if (-not (Test-Path $launcher)) { 'NOAPP'; exit }
$w = Win; $had = 'tray'
if ($w) { if ($w.GetCurrentPattern($WP).Current.WindowVisualState -eq 'Minimized') { $had = 'min' } else { $had = 'shown' } }
else { Start-Process $launcher -WindowStyle Minimized; $w = Until 25000 { Win } }
if (-not $w) { 'NOWINDOW'; exit }
$card = Until 15000 { Id 'ProtectionTitle' }
if (-not $card) { $w.GetCurrentPattern($WP).SetWindowVisualState('Normal'); 'SIGNIN'; exit }
if ($want -eq 'on') { $btn = Id 'ConnectionCardConnectButton'; $goal = 'Protected' }
else { $btn = Id 'ConnectionCardDisconnectButton'; if (-not $btn) { $btn = Id 'ConnectionCardCancelButton' }; $goal = 'Unprotected' }
if ($btn) { $btn.GetCurrentPattern($IP).Invoke() }
$null = Until 30000 { (Id 'ProtectionTitle').Current.Name -eq $goal }
$state = (Id 'ProtectionTitle').Current.Name
if ($had -eq 'tray') { $w.GetCurrentPattern($WP).Close() } elseif ($had -eq 'min') { $w.GetCurrentPattern($WP).SetWindowVisualState('Minimized') }
'STATE:' + $state
`;
function protonSwitch(on) {
  const script = `$want = '${on ? 'on' : 'off'}'\n${PROTON_PS}`;
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    const timer = setTimeout(() => ps.kill(), 75000);
    ps.stdout.on('data', (d) => { out += d; });
    ps.on('error', (e) => { clearTimeout(timer); reject(e); });
    ps.on('close', () => {
      clearTimeout(timer);
      setTimeout(() => vpn.poll?.(), 500);
      if (/NOAPP/.test(out)) return reject(new Error('the Proton VPN app isn\'t installed'));
      if (/NOWINDOW/.test(out)) return reject(new Error('Proton VPN didn\'t open'));
      if (/SIGNIN/.test(out)) return reject(new Error('sign in to Proton VPN once (it\'s open now)'));
      const state = (out.match(/STATE:(.*)/) || [])[1]?.trim();
      if (!state) return reject(new Error('Proton VPN didn\'t answer'));
      if ((state === 'Protected') !== on) return reject(new Error(`Proton VPN says: ${state}`));
      resolve({ state });
    });
  });
}
function vpnToggle(on) {
  on = !!on;
  // a WireGuard profile set up earlier still works; otherwise the Proton app does it
  return wgInfo().profile ? wgSwitch(on) : protonSwitch(on);
}
if (!app.isPackaged && process.env.HS_SNAPSHOT && process.env.HS_OFFLINETEST) { // dev check: MOBILE MODE, offline, end to end
  setTimeout(async () => {
    const dir = process.env.HS_OFFLINETEST, out = {};
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      const { session } = require('electron');
      const ses = session.fromPartition('phonetest');
      // trust exactly what an iPhone with the HYPERSPACE certificate installed would
      ses.setCertificateVerifyProc((req, cb) => cb(req.certificate.issuerName === 'HYPERSPACE Local CA' ? 0 : -2));
      const port = config.remote.port + 1;
      const url = `https://127.0.0.1:${port}/renderer/phone.html?mode=phone#k=${config.remote.key}`;
      const p = new BrowserWindow({ width: 390, height: 844, show: false, webPreferences: { session: ses, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' } });
      p.hsGrab = true;
      const js = (s) => p.webContents.executeJavaScript(s);
      const shot = async (n) => fs.writeFileSync(path.join(dir, `off-${n}.png`), (await p.webContents.capturePage()).toPNG());
      await p.loadURL(url); await wait(6000);
      out.secure = await js(`({ secure: isSecureContext, sw: !!navigator.serviceWorker && !!navigator.serviceWorker.controller, caches: 'caches' in window })`);
      await shot('phone');
      // sync a handful of tracks, then pause
      await js(`document.querySelector('#sync-go') && document.querySelector('#sync-go').click()`); await wait(12000);
      await js(`document.querySelector('#sync-go') && document.querySelector('#sync-go').click()`); await wait(3000);
      out.saved = await js(`caches.open('hs-music').then(c => c.keys()).then(k => ({ tracks: k.filter(r => r.url.includes('/media/track/')).length, covers: k.filter(r => r.url.includes('/media/art/')).length }))`);
      out.meta = await js(`caches.open('hs-meta').then(c => c.match('/meta/library')).then(r => r ? r.json() : null).then(j => j && j.tracks.length)`);
      await shot('synced');
      // the laptop goes away
      remote.stop(); await wait(4000);
      await p.webContents.reload(); await wait(7000);
      out.offlineReload = await js(`({ title: document.title, tabs: [...document.querySelectorAll('#tabs > *')].map(x => x.textContent.trim()), link: document.querySelector('#top-link').classList.contains('on') })`);
      await js(`document.querySelector('[data-tab="music"]').click()`); await wait(3000);
      await js(`document.querySelector('#q').value = 'saved'; document.querySelector('#q').dispatchEvent(new Event('input'))`); await wait(800);
      out.offlineList = await js(`document.querySelector('#count').textContent`);
      await js(`document.querySelector('#list .row') && document.querySelector('#list .row').click()`); await wait(3000);
      out.offlinePlay = await js(`({ src: document.querySelector('#audio').src.slice(0, 5), playing: !document.querySelector('#audio').paused, t: document.querySelector('#audio').currentTime, err: document.querySelector('#audio').error && document.querySelector('#audio').error.message, title: document.querySelector('#p-title').textContent })`);
      await js(`document.querySelector('#audio').pause()`);
      await shot('offline-music');
      await js(`document.querySelector('[data-tab="vj"]').click()`); await wait(2500); await shot('vj');
      await js(`document.querySelector('[data-tab="laptop"]').click()`); await wait(1500); await shot('laptop-away');
      out.laptopTab = await js(`({ pages: [...document.querySelectorAll('.page.on')].map(p => p.dataset.page), tab: [...document.querySelectorAll('#tabs .on')].map(b => b.textContent.trim()), away: !document.querySelector('#away').classList.contains('hidden') })`);
      p.destroy();
    } catch (e) { out.error = e.stack; }
    fs.writeFileSync(path.join(dir, 'offline.json'), JSON.stringify(out, null, 1));
  }, 7000);
}
if (!app.isPackaged && process.env.HS_SNAPSHOT && process.env.HS_PHONETEST) { // dev check: the phone app in a phone-sized window
  setTimeout(async () => {
    const dir = process.env.HS_PHONETEST, out = {};
    try {
      const url = `http://127.0.0.1:${config.remote.port}/renderer/phone.html#k=${config.remote.key}`;
      const p = new BrowserWindow({ width: 390, height: 844, show: false, webPreferences: { backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' } });
      p.hsGrab = true; // keep app events away from it (it gets them over the phone link like a real phone)
      await p.loadURL(url);
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const shot = async (n) => fs.writeFileSync(path.join(dir, `phone-${n}.png`), (await p.webContents.capturePage()).toPNG());
      const js = (s) => p.webContents.executeJavaScript(s);
      await wait(5000); await shot('home');
      await js(`document.querySelector('[data-tab="music"]').click()`); await wait(6000);
      out.musicCount = await js(`document.querySelector('#count').textContent`);
      await js(`document.querySelector('#q').value='bpm:140'; document.querySelector('#q').dispatchEvent(new Event('input'))`); await wait(800);
      out.filtered = await js(`document.querySelector('#count').textContent`);
      await js(`document.querySelector('#list .row').click()`); await wait(4000);
      out.phonePlayback = await js(`({ src: !!document.querySelector('#audio').src, paused: document.querySelector('#audio').paused, t: document.querySelector('#audio').currentTime, err: document.querySelector('#audio').error && document.querySelector('#audio').error.message, title: document.querySelector('#p-title').textContent })`);
      await js(`document.querySelector('#audio').pause()`);
      await shot('music');
      await js(`document.querySelector('[data-tab="control"]').click()`); await wait(2500); await shot('control');
      p.destroy();
    } catch (e) { out.error = e.stack; }
    fs.writeFileSync(path.join(dir, 'phone.json'), JSON.stringify(out, null, 1));
  }, 6000);
}
if (!app.isPackaged && process.env.HS_SNAPSHOT && process.env.HS_SETUPTEST) { // dev check: the MOBILE MODE card's Safari and Brave routes
  setTimeout(async () => {
    const dir = process.env.HS_SETUPTEST, out = {};
    const { session, clipboard } = require('electron');
    const before = clipboard.readText(); // the copy buttons write to the real clipboard: put it back after
    try {
      const ses = session.fromPartition('setuptest');
      ses.setCertificateVerifyProc((req, cb) => cb(req.certificate.issuerName === 'HYPERSPACE Local CA' ? 0 : -2));
      const p = new BrowserWindow({ width: 390, height: 844, show: false, webPreferences: { session: ses, backgroundThrottling: false } });
      p.hsGrab = true;
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const js = (s) => p.webContents.executeJavaScript(s, true);
      const shot = async (n) => fs.writeFileSync(path.join(dir, `setup-${n}.png`), (await p.webContents.capturePage()).toPNG());
      const card = () => js(`(() => { const s = document.querySelector('#setup'); return { shown: !s.classList.contains('hidden') && !s.classList.contains('off-tab'), text: s.innerText.slice(0, 160) }; })()`);
      const step = () => js(`(() => { const w = document.querySelector('#wiz'); return w.classList.contains('hidden') ? null : (w.querySelector('.wiz-n')?.textContent + ' · ' + w.querySelector('h2')?.textContent); })()`);
      const click = (sel) => js(`document.querySelector('${sel}').click()`);
      const copied = async (id) => { clipboard.writeText(''); await click(`[data-copy="${id}"]`); await wait(500); return clipboard.readText(); };
      const k = config.remote.key, http = `http://127.0.0.1:${config.remote.port}`, https = `https://127.0.0.1:${config.remote.port + 1}`;
      out.steps = [];
      // the QR code's plain address: the card, the browser question, then Brave steps 1-5
      await p.loadURL(`${http}/renderer/phone.html#k=${k}`); await wait(4000); await shot('0-card');
      out.card = await card();
      await click('#setup-go'); await wait(600); await shot('0-choose');
      await click('[data-v="brave"]'); await wait(600);
      for (let n = 1; n <= 5; n++) {
        out.steps.push(await step()); await shot(`b${n}`);
        if (n === 2) out.certCopy = await js(`document.querySelector('#cp-cert').value`);
        if (n === 5) { await wait(6000); await shot('b5-checked'); out.reach = await js(`document.querySelector('#reach').innerText`); out.secureLink = await js(`document.querySelector('#reach a.go')?.getAttribute('href')`); }
        else { await click('[data-w="next"]'); await wait(400); }
      }
      // the secure link carries on at step 6, by itself
      await p.loadURL(out.secureLink.replace(/^https:\/\/[^/]+/, https)); await wait(4000);
      for (let n = 6; n <= 10; n++) {
        out.steps.push(await step()); await shot(`b${n}`);
        if (n === 6) out.appCopy = await copied('cp-app');
        if (n === 7) out.iconOk = await js(`document.querySelector('.wiz-icon').naturalWidth`);
        if (n < 10) { await click('[data-w="next"]'); await wait(400); }
      }
      // a phone that doesn't trust the certificate: step 5 says so instead of a dead button
      const q = new BrowserWindow({ width: 390, height: 844, show: false, webPreferences: { partition: 'setuptest-untrusted', backgroundThrottling: false } });
      q.hsGrab = true;
      await q.loadURL(`${http}/renderer/phone.html#k=${k}`); await wait(3000);
      await q.webContents.executeJavaScript(`localStorage.setItem('setup-browser', '"brave"'); localStorage.setItem('setup-step', '4'); document.querySelector('#setup-go').click()`, true); await wait(8000);
      out.reachUntrusted = await q.webContents.executeJavaScript(`document.querySelector('#reach').innerText`);
      fs.writeFileSync(path.join(dir, 'setup-b5-untrusted.png'), (await q.webContents.capturePage()).toPNG());
      q.destroy();
      await click('[data-w="back"]'); await wait(300); out.back = await step();
      await click('[data-w="close"]'); await wait(800); await shot('card-later'); out.cardLater = await card();
      // the Brave home-screen tile opens the copied link: no card, PHONE mode
      await p.loadURL(out.appCopy); await wait(4000); await shot('brave-app');
      out.braveApp = { card: await card(), mode: await js(`document.querySelector('#mode .on')?.dataset.m`), phone: await js(`document.querySelector('#vitals')?.innerText.includes('running in Brave from the home screen')`) };
      p.destroy();
    } catch (e) { out.error = e.stack; }
    clipboard.writeText(before);
    fs.writeFileSync(path.join(dir, 'setup.json'), JSON.stringify(out, null, 1));
  }, 6000);
}
if (!app.isPackaged && process.env.HS_SNAPSHOT && process.env.HS_NOTESTEST) { // dev check: NOTES vault (sample notes only) + the TO-DO page
  setTimeout(async () => {
    const dir = process.env.HS_NOTESTEST, out = {};
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      let w; for (let k = 0; k < 60 && !w; k++) { w = BrowserWindow.getAllWindows().find((x) => /index.html/.test(x.webContents.getURL())); if (!w) await wait(500); }
      await wait(2000);
      const js = (s) => w.webContents.executeJavaScript(s, true);
      const shot = async (n) => fs.writeFileSync(path.join(dir, `notes-${n}.png`), (await w.webContents.capturePage()).toPNG());
      const mirror = path.join(dir, 'mirror', 'HYPERSPACE Notes');
      await js(`document.querySelector('.nav[data-view="notes"]').click()`); await wait(1200); await shot('1-setup');
      const t0 = Date.now();
      const { recovery } = await api.notesCreate('purple monkey dishwasher 42', [mirror]);
      out.createMs = Date.now() - t0; out.recoveryShape = recovery.replace(/[A-Z0-9]/g, 'X');
      const secret = 'SECRET-JOURNAL-LINE-7731';
      const png = fs.readFileSync(path.join(ROOT, 'assets', 'icon.png'));
      const bid = await notes.putBlob(png, 'image/png');
      await api.notesSave({ title: 'Saturday, October 25, 2026', notebook: 'Journal', section: '2026', journal: true, body: `Played a set tonight.\n\n${secret}\n\n- [x] pack the controller\n- [ ] send the mix\n\n![picture](hs-blob:${bid})`, blobs: [bid] });
      await api.notesSave({ title: 'Set ideas', notebook: 'DJ Notes', section: 'Halloween', body: '## Openers\n\n**Dubstep** into *riddim*.\n\n| BPM | Key |\n| --- | --- |\n| 140 | 8A |\n\n> keep it dark' });
      await api.notesSave({ title: 'Shopping', notebook: 'Notes', body: '- headphones pads\n- SD cards' });
      const pdfId = await api.notesAttach('Setlist.pdf', Buffer.from('%PDF-1.4 test'), false);
      await api.notesSave({ title: 'Rider', notebook: 'DJ Notes', section: 'Halloween', body: `Contract below.\n\n[Setlist.pdf](hs-blob:${pdfId})\n`, blobs: [pdfId] });
      out.attachMime = (await notes.getBlob(pdfId)).mime;
      // nothing readable on disk
      const files = []; const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else files.push(p); } };
      walk(notes.dir);
      out.files = files.length;
      out.secretVisibleOnDisk = files.some((f) => fs.readFileSync(f).includes(Buffer.from(secret))) || files.some((f) => fs.readFileSync(f).includes(Buffer.from('Set ideas')));
      out.pngVisibleOnDisk = files.some((f) => fs.readFileSync(f).includes(png.subarray(0, 64)));
      // copies
      await notes.syncAll();
      const mfiles = []; const walk2 = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk2(p); else mfiles.push(p); } };
      walk2(mirror); out.mirrorFiles = mfiles.length;
      // lock / wrong password / right password / recovery key
      api.notesLock(); out.listWhileLocked = await Promise.resolve().then(() => api.notesList().length);
      try { await api.notesUnlock('wrong password here'); out.wrongPw = 'UNLOCKED?!'; } catch (e) { out.wrongPw = e.message; }
      await api.notesUnlock('purple monkey dishwasher 42'); out.afterUnlock = api.notesList().length;
      api.notesLock(); await api.notesUnlock(recovery.toLowerCase(), true); out.afterRecovery = api.notesList().length;
      out.search = api.notesSearch('riddim').length;
      // restore onto an empty laptop folder, from the SSD copy alone
      const fresh = new NotesVault({ dir: path.join(dir, 'fresh'), mirrors: [mirror], autoLockMin: 0 });
      await fresh.syncAll(); await fresh.unlock('purple monkey dishwasher 42');
      out.restoredFromCopy = fresh.list().length; out.restoredBody = fresh.list().some((n) => fresh.get(n.id).body.includes(secret));
      fresh.stop();
      // the page
      await js(`document.querySelector('.nav[data-view="todo"]').click(); document.querySelector('.nav[data-view="notes"]').click()`); await wait(1500);
      await js(`[...document.querySelectorAll('.nt-b')].find((b) => /JOURNAL/.test(b.textContent))?.click()`); await wait(500);
      await js(`document.querySelector('.nt-p')?.click()`); await wait(1500);
      out.imgShown = await js(`!!document.querySelector('.nt-read img[data-blob]')?.src?.startsWith('data:image/png')`);
      await shot('2-journal');
      await js(`[...document.querySelectorAll('.nt-b')].find((b) => /DJ Notes/.test(b.textContent))?.click()`); await wait(400);
      await js(`document.querySelector('.nt-p')?.click()`); await wait(800); await shot('3-read'); out.fileCard = await js(`!!document.querySelector('.nt-file [data-fact="open"]')`);
      await js(`document.querySelector('.nt-b.book[data-book="DJ Notes"]')?.click()`); await wait(300); await js(`document.querySelector('.nt-b.sec[data-sec="Halloween"]')?.click()`); await wait(400); await shot('3b-tree');
      out.treeSections = await js(`[...document.querySelectorAll('.nt-b.sec')].map((x) => x.textContent)`);
      await js(`document.querySelector('[data-mode="edit"]')?.click()`); await wait(500); await shot('4-edit');
      api.notesLock(); await wait(800);
      out.journalLockedList = api.notesList().map((n) => n.title); out.journalRow = await js(`[...document.querySelectorAll('.nt-b')].find((b) => /JOURNAL/.test(b.textContent))?.textContent`);
      await js(`[...document.querySelectorAll('.nt-b')].find((b) => /JOURNAL/.test(b.textContent))?.click()`); await wait(600);
      out.journalPrompt = await js(`!!document.querySelector('#nt-junl .nt-pw')`); await shot('5-journal-locked');
      // a second start of the app: the notes open from this laptop's own key file, no password
      const again = new NotesVault({ dir: notes.dir, mirrors: [], autoLockMin: 0, localKeyFile: path.join(dataDir, 'notes-key.bin'), protect: (b) => safeStorage.encryptString(b.toString('base64')), unprotect: (buf) => Buffer.from(safeStorage.decryptString(buf), 'base64') });
      out.reopenedWithoutPassword = await again.openNotes(); out.reopenedList = again.list().map((n) => n.title); again.stop();
      await js(`document.querySelector('#nt-junl .nt-pw').value = 'purple monkey dishwasher 42'; document.querySelector('#nt-junl .nt-open').click()`); await wait(2500);
      out.afterPromptUnlock = api.notesList().length; await shot('5b-journal-unlocked');
      // TO-DO page: tick a few quests
      await js(`document.querySelector('.nav[data-view="todo"]').click()`); await wait(1000); await shot('6-todo');
      for (const q of ['browser', 'search', 'vpn']) { await js(`document.querySelector('[data-q="${q}"]').click()`); await wait(400); }
      await wait(3600);
      out.todoPct = await js(`document.querySelector('.td-pct b')?.textContent`);
      out.todoRank = await js(`document.querySelector('.td-rank')?.textContent`);
      out.badges = await js(`[...document.querySelectorAll('.td-badge.got span')].map((x) => x.textContent)`);
      await js(`document.querySelector('[data-toggle="passwords"]').click()`); await wait(400); await shot('7-todo-ticked');
    } catch (e) { out.error = e.stack; }
    fs.writeFileSync(path.join(dir, 'notes.json'), JSON.stringify(out, null, 1));
  }, 12000);
}
if (!app.isPackaged && process.env.HS_SNAPSHOT && process.env.HS_NOTESLOOK) { // dev check: NOTES screen with sample pages, off-screen: console errors, what the sidebar and list show, a screenshot
  setTimeout(async () => {
    const dir = process.env.HS_NOTESLOOK, out = { errors: [] };
    fs.writeFileSync(path.join(dir, 'trace.txt'), 'started ' + BrowserWindow.getAllWindows().map((x) => x.webContents.getURL()).join(' | '));
    const tr = (m) => fs.appendFileSync(path.join(dir, 'trace.txt'), ' / ' + m);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    app.on('before-quit', () => tr('before-quit')); process.on('exit', (c) => tr('exit ' + c));
    app.on('render-process-gone', (e, wc, d) => tr('gone ' + JSON.stringify(d)));
    try {
      let w; for (let k = 0; k < 60 && !w; k++) { w = BrowserWindow.getAllWindows().find((x) => /index\.html/.test(x.webContents.getURL())); if (!w) await wait(500); }
      w.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) out.errors.push(String(e.message).slice(0, 300)); });
      w.webContents.on('preload-error', (e, f, er) => out.errors.push(String(er)));
      tr('window found'); await wait(2000);
      const js = (x) => w.webContents.executeJavaScript(x, true);
      await js(`document.body.click()`); tr('clicked'); await wait(1500);
      const shot = async (n) => fs.writeFileSync(path.join(dir, `look-${n}.png`), (await w.webContents.capturePage()).toPNG());
      tr('create'); await api.notesCreate('purple monkey dishwasher 42', []);
      await api.notesSave({ title: 'Shopping', notebook: 'Notes', body: '- pads, - cards' });
      await api.notesSave({ title: 'Set ideas', notebook: 'DJ Notes', section: 'Halloween', body: '## Openers **bold** {c:#ff0|yellow} ++under++' });
      await api.notesSave({ title: 'Old imported', notebook: 'Journal', section: '2024', body: 'x', journal: true, source: 'onenote-export' });
      await api.notesSave({ title: 'Mon', notebook: 'Ashton', section: 'Journal', body: 'secret day' });
      tr('saved'); broadcast('notes-state', notesState());
      await js(`document.querySelector('.nav[data-view="notes"]').click()`); tr('navd'); await wait(2500);
      fs.writeFileSync(path.join(dir, 'look.json'), JSON.stringify(out));
      out.books = await js(`document.querySelector('#nt-books')?.innerText`);
      out.list = await js(`[...document.querySelectorAll('#nt-list .nt-p b')].map((x) => x.textContent)`);
      out.view = await js(`document.querySelector('#view-notes')?.innerText.slice(0, 300)`);
      await shot('1-open');
      tr('opened'); await js(`document.querySelector('#nt-list .nt-p')?.click()`); await wait(800); await shot('2-page');
      out.edit = await js(`document.querySelector('#nt-edit')?.innerText.slice(0, 400)`);
      notes.lock('locked'); await wait(1500);
      out.lockedBooks = await js(`document.querySelector('#nt-books')?.innerText`);
      await shot('3-locked');
    } catch (e) { out.error = e.stack; }
    fs.writeFileSync(path.join(dir, 'look.json'), JSON.stringify(out, null, 1));
    setTimeout(() => app.exit(0), 500);
  }, 8000);
}
if (!app.isPackaged && process.env.HS_SNAPSHOT && process.env.HS_NOTESTYPE) { // dev check: typing into NOTES keeps every letter (the "everything deletes" bug), with real key input
  setTimeout(async () => {
    const dir = process.env.HS_NOTESTYPE, out = {};
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    var w;
    try {
      for (let k = 0; k < 60 && !w; k++) { w = BrowserWindow.getAllWindows().find((x) => /index\.html/.test(x.webContents.getURL())); if (!w) await wait(500); }
      await wait(2000);
      const js = (s) => w.webContents.executeJavaScript(s, true);
      const shot = async (n) => fs.writeFileSync(path.join(dir, `type-${n}.png`), (await w.webContents.capturePage()).toPNG());
      w.show(); w.focus(); w.webContents.focus();
      await api.notesCreate('purple monkey dishwasher 42', []);
      broadcast('notes-state', notesState());
      await js(`document.querySelector('.nav[data-view="notes"]').click()`); await wait(1500);
      // everything below is done the way a person does it: click, then real keystrokes into the focused box
      const click = async (sel) => { await js(`document.querySelector(${JSON.stringify(sel)}).click()`); await wait(400); };
      const clickPage = async (title) => { out.step = `open ${title}`; await js(`[...document.querySelectorAll('.nt-p')].find((x) => x.querySelector('b').textContent === ${JSON.stringify(title)}).click()`); await wait(500); await js(`document.querySelector('[data-mode="edit"]')?.click()`); await wait(300); };
      const focusEnd = (sel) => js(`(() => { const t = document.querySelector(${JSON.stringify(sel)}); t.focus(); t.setSelectionRange(t.value.length, t.value.length); })()`);
      const typeIn = async (sel, text) => { await focusEnd(sel); w.webContents.insertText(text); await wait(200); };
      const shown = (sel) => js(`document.querySelector(${JSON.stringify(sel)})?.value ?? null`);
      const find = (title) => [...notes.notes.values()].find((n) => n.title === title);
      const stored = async (title) => { await notes.load(); return find(title); };
      out.step = 'new Alpha'; await click('#nt-addpage');
      await typeIn('#nt-title', 'Alpha'); await typeIn('#nt-body', 'first line');
      await wait(1900); // the autosave fires here
      await typeIn('#nt-body', ' second line');
      out.typed = await shown('#nt-body');
      out.step = 'new Bravo'; await click('#nt-addpage');
      await typeIn('#nt-title', 'Bravo'); await typeIn('#nt-body', 'bravo body'); await wait(300);
      await clickPage('Alpha'); out.alphaBack = await shown('#nt-body');
      out.alphaStored = (await stored('Alpha'))?.body;
      // a third edit, then leave the NOTES tab and come back
      await typeIn('#nt-body', ' third');
      await click('.nav[data-view="todo"]'); await wait(600);
      await click('.nav[data-view="notes"]'); await wait(1000);
      out.afterTabSwitch = await shown('#nt-body');
      out.afterTabSwitchStored = (await stored('Alpha'))?.body;
      // retitle it, hop to the other page and back
      await typeIn('#nt-title', ' RENAMED'); await wait(200);
      await clickPage('Bravo'); out.bravoShown = await shown('#nt-body');
      out.step = 'back to renamed'; await clickPage('Alpha RENAMED');
      out.bravoStored = (await stored('Bravo'))?.body;
      out.renamedStored = (await stored('Alpha RENAMED'))?.body;
      out.count = notes.notes.size;
      // ---- notebooks, sections, lists, to-dos, filter + sort, accent colour: all with real clicks and keys ----
      const key = async (k) => { w.webContents.sendInputEvent({ type: 'keyDown', keyCode: k }); w.webContents.sendInputEvent({ type: 'keyUp', keyCode: k }); await wait(250); };
      const q = (expr) => js(expr);
      out.step = 'new notebook'; await click('#nt-addbook');
      out.nameBoxShown = await q(`!!document.querySelector('#nt-name')`);
      await js(`document.querySelector('#nt-name').focus()`); w.webContents.insertText('Gigs'); await wait(200); await key('Return'); await wait(900);
      out.bookRow = await q(`!!document.querySelector('.nt-b.book[data-book="Gigs"]')`);
      out.bookTitle = await shown('#nt-title');
      out.bookFocus = await q(`document.activeElement?.id`);
      out.step = 'new section'; await click('#nt-addsec');
      await js(`document.querySelector('#nt-name').focus()`); w.webContents.insertText('Halloween'); await wait(200); await key('Return'); await wait(900);
      out.secRow = await q(`!!document.querySelector('.nt-b.sec[data-sec="Halloween"].on')`);
      out.step = 'list + to-dos'; await typeIn('#nt-body', '- [ ] pack cables'); await key('Return'); w.webContents.insertText('charge laptop'); await wait(300);
      out.listBody = await shown('#nt-body');
      out.boxes = await q(`document.querySelectorAll('#nt-read input[type=checkbox]').length`);
      await js(`document.querySelector('#nt-read input[type=checkbox]').click()`); await wait(300);
      out.ticked = await shown('#nt-body');
      await wait(1200);
      out.todoMeta = (await stored('First page'))?.body;
      out.step = 'filter + sort';
      await js(`(() => { const s = document.querySelector('#nt-filter'); s.value = 'todos'; s.dispatchEvent(new Event('change')); })()`); await wait(300);
      out.todoRows = await q(`[...document.querySelectorAll('.nt-p b')].map((x) => x.textContent)`);
      await js(`(() => { const s = document.querySelector('#nt-filter'); s.value = 'all'; s.dispatchEvent(new Event('change')); const t = document.querySelector('#nt-sort'); t.value = 'title-az'; t.dispatchEvent(new Event('change')); document.querySelector('.nt-b[data-book="all"]').click(); })()`); await wait(300);
      out.az = await q(`[...document.querySelectorAll('.nt-p b')].map((x) => x.textContent)`);
      await js(`(() => { const t = document.querySelector('#nt-sort'); t.value = 'title-za'; t.dispatchEvent(new Event('change')); })()`); await wait(300);
      out.za = await q(`[...document.querySelectorAll('.nt-p b')].map((x) => x.textContent)`);
      out.sortSaved = await q(`localStorage.getItem('hs-notes-view')`);
      out.step = 'empty page cleanup'; const before = (await stored('Alpha RENAMED')) && notes.notes.size;
      await click('#nt-addpage'); await wait(300); out.emptyShown = await q(`document.activeElement?.id`);
      await clickPage('Alpha RENAMED'); await wait(500); await notes.load();
      out.countAfterEmpty = notes.notes.size; out.countBefore = before;
      out.step = 'accent'; await click('.nav[data-view="notes"]');
      await js(`document.querySelector('#nt-acc [data-acc="cyan"]').click()`); await wait(600);
      out.accVar = await q(`document.body.style.getPropertyValue('--acc')`);
      out.accSaved = JSON.stringify(api.config().look);
      await js(`document.querySelector('#nt-acc [data-acc="green"]').click()`); await wait(300);
      out.accOff = await q(`document.body.classList.contains('purple')`);
      await js(`document.querySelector('#nt-acc [data-acc="pink"]').click()`); await wait(400);
      out.step = 'tab-bar plus'; await click('#tabstrip .tadd'); out.tabMenu = await q(`document.querySelectorAll('#tabstrip .tmenu button').length || (document.querySelector('#toast')?.textContent ?? 'toast')`);
      await click('.nav[data-view="notes"]');
      out.step = 'settings swatches'; await click('.nav[data-view="settings"]'); await wait(600); out.setRow = await q(`document.querySelectorAll('#sg-accent .acc-dot').length`);
      await click('.nav[data-view="notes"]'); await wait(500);
      out.noDeadPlus = await q(`[...document.querySelectorAll('#view-notes button')].filter((b) => b.textContent.trim() === '+').length`);
      await shot('1');
      out.pass = out.alphaBack === 'first line second line' && out.alphaStored === 'first line second line' && out.afterTabSwitchStored === 'first line second line third' && out.afterTabSwitch === out.afterTabSwitchStored && out.bravoStored === 'bravo body' && out.renamedStored === 'first line second line third' && out.count === 2;
    } catch (e) { out.error = String(e.stack || e).slice(0, 300); }
    fs.writeFileSync(path.join(dir, 'notes-type.json'), JSON.stringify(out, null, 1));
  }, 12000);
}
if (!app.isPackaged && process.env.HS_SNAPSHOT && process.env.HS_FINDTEST) { // dev check: FIND with real clicks and keystrokes
  setTimeout(async () => {
    const out = {};
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      const w = BrowserWindow.getAllWindows().find((x) => /index\.html/.test(x.webContents.getURL()));
      const js = (s) => w.webContents.executeJavaScript(s, true);
      const errs = []; w.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) errs.push(String(e.message).slice(0, 200)); });
      w.show(); w.focus(); w.webContents.focus(); await wait(500);
      const rect = await js(`(() => { const r = document.querySelector('#find-btn').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
      w.webContents.sendInputEvent({ type: 'mouseDown', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
      w.webContents.sendInputEvent({ type: 'mouseUp', x: rect.x, y: rect.y, button: 'left', clickCount: 1 }); await wait(500);
      out.openedByClick = await js(`!!document.querySelector('.fd-wrap')`);
      out.atPoint = await js(`(() => { const e = document.elementFromPoint(${rect.x}, ${rect.y}); return e ? e.tagName + '#' + e.id + '.' + e.className : null; })()`);
      out.openedByDomClick = await js(`document.querySelector('.fd-wrap')?.remove(); document.querySelector('#find-btn').click(); !!document.querySelector('.fd-wrap')`);
      out.handlers = await js(`typeof window.FIND`);
      out.focused = await js(`document.activeElement?.tagName + '.' + (document.activeElement?.parentElement?.className || '')`);
      for (const ch of 'fans') w.webContents.sendInputEvent({ type: 'char', keyCode: ch });
      await wait(400);
      out.typed = await js(`document.querySelector('.fd input')?.value`);
      out.firstHit = await js(`document.querySelector('.fd-row b')?.textContent`);
      w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' }); w.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' }); await wait(1200);
      out.viewAfterEnter = await js(`HS.view`);
      w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'K', modifiers: ['control'] }); w.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'K', modifiers: ['control'] }); await wait(500);
      out.openedByCtrlK = await js(`!!document.querySelector('.fd-wrap')`);
      out.errors = errs;
    } catch (e) { out.error = e.stack; }
    fs.writeFileSync(path.join(process.env.HS_FINDTEST, 'find.json'), JSON.stringify(out, null, 1));
  }, 12000);
}
if (!app.isPackaged && process.env.HS_SNAPSHOT && process.env.HS_SWEEP) { // dev check: visit TO-DO, SETTINGS, games, NOTES off-screen with the White Rabbit active; console errors + screenshots
  setTimeout(async () => {
    const dir = process.env.HS_SWEEP, out = { errors: [] };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      let w; for (let k = 0; k < 60 && !w; k++) { w = BrowserWindow.getAllWindows().find((x) => /index\.html/.test(x.webContents.getURL())); if (!w) await wait(500); }
      w.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) out.errors.push(String(e.message).slice(0, 300)); });
      const js = (x) => w.webContents.executeJavaScript(x, true);
      const shot = async (n) => fs.writeFileSync(path.join(dir, `sw-${n}.png`), (await w.webContents.capturePage()).resize({ width: 1000 }).toPNG());
      await wait(2500); await js(`document.body.click()`); await wait(1500);
      await js(`window.twr && window.twr.setCfg({ on: true, found: true })`);
      await api.notesCreate('purple monkey dishwasher 42', []);
      await api.notesSave({ title: 'Shopping', notebook: 'Notes', body: 'pads' });
      await api.notesSave({ title: '2024-03-04', notebook: 'Journal', section: 'Journal', body: 'secret day' });
      broadcast('notes-state', notesState());
      for (const v of ['notes', 'todo', 'settings']) { await js(`document.querySelector('.nav[data-view="${v}"]').click()`); await wait(4000); await shot(v); }
      out.todoText = await js(`document.querySelector('#view-todo').innerText.slice(0, 500)`);
      out.settingsTiles = await js(`[...document.querySelectorAll('#view-settings *')].filter((e) => /GLITCH|casino/i.test(e.textContent) && e.children.length < 3).length`);
      await js(`document.dispatchEvent(new CustomEvent('twr',{detail:{do:'saved'}}))`); await wait(1200); await shot('rabbit-saved');
      await js(`window.twr.popBehind('panel')`); await wait(1500); await shot('rabbit-pop');
      out.hasTwr = await js(`typeof window.twr`);
      out.twrApi = await js(`JSON.stringify({ antics: (window.twr.antics || []).length, cat: Object.keys(window.TWR_CATALOG || {}), lvl: window.twr.level && window.twr.level() })`);
      await js(`document.querySelector('.nav[data-view="settings"]').click()`); await wait(1500);
      out.twrTab = await js(`(() => { const b = [...document.querySelectorAll('#view-settings button')].find((x) => /WHITE RABBIT/i.test(x.textContent)); if (!b) return 'no tab'; b.click(); return 'clicked'; })()`); await wait(2500); await shot('twr-tab');
      await js(`window.twr.stage.demo('dance')`); await wait(1200); await shot('twr-dance');
      await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true, bubbles: true })); window.dispatchEvent(new KeyboardEvent('keydown', { key: '6', code: 'Digit6', ctrlKey: true, bubbles: true })); window.dispatchEvent(new KeyboardEvent('keydown', { key: '7', code: 'Digit7', ctrlKey: true, bubbles: true }))`); await wait(800);
      for (let i = 0; i < 20; i++) await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))`);
      await wait(800); await shot('hacker');
      await js(`window.hsHacker && window.hsHacker.close()`);
      await js(`document.querySelector('.nav[data-view="nexus"]').click()`); await wait(3000);
      out.home = await js(`JSON.stringify({ rect: window.twr.home && window.twr.home(), pt: window.twr.homePoint && window.twr.homePoint(), fx: !!window.hsClickFx })`);
      await shot('home');
      await js(`document.querySelector('.nav[data-view="vj"]').click()`); await wait(300);
      await js(`window.hsClickFx && window.hsClickFx.burst(600, 300, 'button')`); await wait(250); await shot('clickfx');
      await js(`document.querySelector('.nav[data-view="crate"]').click()`); await wait(2500); await shot('crate');
      await js(`window.twr.assistant.open()`); await wait(600);
      out.cmd = await js(`(async () => { try { return String(await window.twr.assistant.run('joke')).slice(0, 120); } catch (e) { return 'ERR ' + e.message; } })()`); await wait(700); out.ast = await js(`(() => { const a = document.querySelector('#twr-ast'), h = document.querySelector('#twr-home'); const r = (e) => e && { disp: getComputedStyle(e).display, rect: JSON.stringify(e.getBoundingClientRect()), top: (() => { const b = e.getBoundingClientRect(); const t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return t && (t.id || t.className || t.tagName); })() }; return JSON.stringify({ ast: r(a), home: r(h), win: [innerWidth, innerHeight] }); })()`); await shot('assistant');
      await js(`document.querySelector('#view-games') && (document.querySelector('.nav[data-view="games"]').click())`); await wait(1500); await shot('games');
    } catch (e) { out.error = e.stack; }
    fs.writeFileSync(path.join(dir, 'sweep.json'), JSON.stringify(out, null, 1));
    setTimeout(() => app.exit(0), 500);
  }, 8000);
}
if (!app.isPackaged && process.env.HS_SNAPSHOT && process.env.HS_WELCOME) { // dev check: first-run welcome quiz, every step (off-screen); screenshots + console errors in HS_WELCOME folder
  setTimeout(async () => {
    const dir = process.env.HS_WELCOME, out = { errors: [] };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      let w; for (let k = 0; k < 60 && !w; k++) { w = BrowserWindow.getAllWindows().find((x) => /index\.html/.test(x.webContents.getURL())); if (!w) await wait(500); }
      w.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) out.errors.push(String(e.message).slice(0, 300)); });
      const js = (x) => w.webContents.executeJavaScript(x, true);
      const shot = async (n) => fs.writeFileSync(path.join(dir, `wq-${n}.png`), (await w.webContents.capturePage()).resize({ width: 1000 }).toPNG());
      await wait(2500);
      await js(`window.hsWelcome.open()`); await wait(900);
      await shot('1-vibe');
      await js(`document.querySelector('#hsw [data-id="playful"]').click()`); await wait(200);
      for (const [n, pickId] of [['2-uses', 'music'], ['3-anim', 'full'], ['4-sound', 'silent'], ['5-help', 'yes'], ['6-dock', 'off'], ['7-accent', 'pink'], ['8-surprises', 'meet']]) {
        await js(`document.querySelector('#hsw-next').click()`); await wait(300);
        await js(`(() => { const c = document.querySelector('#hsw [data-id="${pickId}"]'); if (c) c.click(); })()`); await wait(250);
        await shot(n);
      }
      await js(`document.querySelector('#hsw-next').click()`); await wait(400); await shot('9-summary');
      await js(`document.querySelector('#hsw-go').click()`); await wait(800); await shot('10-after');
      out.stored = await js(`JSON.stringify({ w: localStorage.getItem('hs-welcome'), done: localStorage.getItem('hs-welcome-done'), intro: localStorage.getItem('intro'), hid: localStorage.getItem('hs-nav-hidden'), eggs: localStorage.getItem('hs-eggs'), view: localStorage.getItem('view'), click: localStorage.getItem('hs-clickfx') })`);
    } catch (e) { out.error = e.stack; }
    fs.writeFileSync(path.join(dir, 'welcome.json'), JSON.stringify(out, null, 1));
    setTimeout(() => app.exit(0), 500);
  }, Number(process.env.HS_WELCOME_WAIT || 8000));
}
if (!app.isPackaged && process.env.HS_SNAPSHOT && process.env.HS_GAMEHUB) { // dev check: GAMING hub tabs off-screen; console errors + screenshots (never launches a game)
  setTimeout(async () => {
    const dir = process.env.HS_GAMEHUB, out = { errors: [] };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      let w; for (let k = 0; k < 60 && !w; k++) { w = BrowserWindow.getAllWindows().find((x) => /index\.html/.test(x.webContents.getURL())); if (!w) await wait(500); }
      w.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) out.errors.push(String(e.message).slice(0, 300)); });
      const js = (x) => w.webContents.executeJavaScript(x, true);
      const shot = async (n) => fs.writeFileSync(path.join(dir, `gh-${n}.png`), (await w.webContents.capturePage()).resize({ width: 1000 }).toPNG());
      await wait(3000); await js(`document.body.click()`); await wait(1500);
      await js(`document.querySelector('.nav[data-view="gamehub"]').click()`); await wait(6000);
      out.gm = await api.gmTest();
      for (const t of ['library', 'mode', 'play', 'perf', 'tools']) { await js(`document.querySelector('.gh-tabs [data-t="${t}"]').click()`); await wait(2500); await shot(t); }
      await api.gmSet({ settings: { overlay: { on: true }, crosshair: { on: true, hotkey: true }, track: true } }); await wait(800);
      out.status = await api.gmStatus();
      await api.gmSet({ settings: { overlay: { on: false }, crosshair: { on: false, hotkey: false }, track: false } }); await wait(500);
      out.status2 = await api.gmStatus();
      out.sample = await js(`JSON.stringify(window.hsGameHub.state.d.games.slice(0, 6).map((g) => [g.id, g.name, (g.exes || []).join('|'), g.size]))`);
      out.tabsText = await js(`document.querySelector('#view-gamehub').innerText.slice(0, 300)`);
    } catch (e) { out.error = e.stack; }
    fs.writeFileSync(path.join(dir, 'gamehub.json'), JSON.stringify(out, null, 1));
    setTimeout(() => app.exit(0), 500);
  }, 8000);
}
if (!app.isPackaged && process.env.HS_SNAPSHOT && process.env.HS_CRATEVJ) { // dev check: CRATE > VJ section, VJ FULL + mini player, show presets (off-screen); console errors + screenshots
  setTimeout(async () => {
    const dir = process.env.HS_CRATEVJ, out = { errors: [] };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      let w; for (let k = 0; k < 60 && !w; k++) { w = BrowserWindow.getAllWindows().find((x) => /index\.html/.test(x.webContents.getURL())); if (!w) await wait(500); }
      w.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) out.errors.push(String(e.message).slice(0, 300)); });
      const js = (x) => w.webContents.executeJavaScript(x, true);
      const shot = async (n) => fs.writeFileSync(path.join(dir, `cv-${n}.png`), (await w.webContents.capturePage()).resize({ width: 1000 }).toPNG());
      await wait(2500); await js(`document.body.click()`); await wait(1500);
      await js(`document.querySelector('.nav[data-view="crate"]').click()`); await wait(1500); await shot('1-library');
      out.navVjHidden = await js(`document.querySelector('.nav[data-view="vj"]').classList.contains('hidden')`);
      await js(`document.querySelector('#cr-secseg [data-sec="vj"]').click()`); await wait(2500); await shot('2-vj-section');
      out.afterSection = await js(`JSON.stringify({ view: HS.view, sec: HS.crateSection, inVJ: HS.inVJ(), cls: document.body.classList.contains('vj-mode'), canvases: document.querySelectorAll('#vj-canvas').length })`);
      await js(`document.querySelector('#cr-fill').click()`); await wait(2000); await shot('3-vj-full');
      out.mini = await js(`JSON.stringify({ hidden: document.querySelector('#cr-mini').classList.contains('hidden'), corner: document.querySelector('#cr-mini').dataset.corner })`);
      await js(`document.querySelector('#vj-controls').scrollTop = 0; (() => { const h = [...document.querySelectorAll('#vj-controls h5')].find((x) => /SHOW PRESETS/.test(x.textContent)); h && h.scrollIntoView(); })()`);
      await js(`document.querySelector('#vj-spname').value = 'drop one'; document.querySelector('#vj-spsave').click()`); await wait(300);
      await js(`document.querySelector('[data-theme]') && document.querySelectorAll('[data-theme]')[3].click()`); await wait(300);
      await js(`document.querySelector('#vj-spname').value = 'second'; document.querySelector('#vj-spsave').click()`); await wait(300);
      await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }))`); await wait(300);
      out.presets = await js(`localStorage.getItem('hs-vj-presets').length + ' ' + document.querySelectorAll('#vj-splist [data-sp]').length + ' theme=' + document.querySelector('#vj-theme-name').textContent`);
      await shot('4-presets');
      await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await wait(500);
      out.afterEsc = await js(`document.querySelector('#cr-mini').classList.contains('hidden') + ' ' + document.querySelector('.crate').classList.contains('vj-full')`);
      await js(`window.showView ? 0 : 0; document.querySelector('.nav[data-view="vj"]').click()`); await wait(600);
      out.redirect = await js(`HS.view + ' ' + HS.crateSection`);
      await js(`document.querySelector('#cr-secseg [data-sec="lib"]').click()`); await wait(800); await shot('5-back-to-library');
    } catch (e) { out.error = e.stack; }
    fs.writeFileSync(path.join(dir, 'cratevj.json'), JSON.stringify(out, null, 1));
    setTimeout(() => app.exit(0), 500);
  }, 8000);
}
if (!app.isPackaged && process.env.HS_SNAPSHOT && process.env.HS_SMART) { // dev check: CRATE smart playlists (off-screen)
  setTimeout(async () => {
    const dir = process.env.HS_SMART, out = { errors: [] };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      let w; for (let k = 0; k < 60 && !w; k++) { w = BrowserWindow.getAllWindows().find((x) => /index\.html/.test(x.webContents.getURL())); if (!w) await wait(500); }
      w.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) out.errors.push(String(e.message).slice(0, 300)); });
      const js = (x) => w.webContents.executeJavaScript(x, true);
      await wait(2500); await js(`document.body.click()`); await wait(1500);
      await js(`document.querySelector('.nav[data-view="crate"]').click()`); await wait(2500);
      out.nav = await js(`[...document.querySelectorAll('#cr-nav .cr-item[data-kind="smart"]')].map((b) => b.textContent).join(' | ')`);
      await js(`document.querySelector('#cr-sm-new').click()`); await wait(400);
      await js(`document.querySelector('#cr-smart [data-act="addg"]').click()`); await wait(200);
      out.count = await js(`document.querySelector('#sm-count').textContent`);
      fs.writeFileSync(path.join(dir, 'smart-1.png'), (await w.webContents.capturePage()).resize({ width: 800 }).toPNG());
      await js(`document.querySelector('#sm-save').click()`); await wait(600);
      out.view = await js(`document.querySelector('#cr-title').textContent + ' / ' + document.querySelector('#cr-meta').textContent + ' / ' + localStorage.getItem('hs-crate-smart').length`);
    } catch (e) { out.error = e.stack; }
    fs.writeFileSync(path.join(dir, 'smart.json'), JSON.stringify(out, null, 1));
    setTimeout(() => app.exit(0), 500);
  }, 8000);
}
if (!app.isPackaged && process.env.HS_SNAPSHOT && process.env.HS_UITEST) { // dev check: COOLING, FIND and the games
  setTimeout(async () => {
    const dir = process.env.HS_UITEST, out = {};
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      const w = BrowserWindow.getAllWindows().find((x) => /index\.html/.test(x.webContents.getURL()));
      const js = (s) => w.webContents.executeJavaScript(s, true);
      const shot = async (n) => fs.writeFileSync(path.join(dir, `ui-${n}.png`), (await w.webContents.capturePage()).toPNG());
      const err = []; w.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) err.push(e.message); });
      await js(`document.querySelector('.nav[data-view="afterburner"]').click()`); await wait(2500);
      await js(`document.querySelector('.ab-cool').scrollIntoView()`); await wait(400); await shot('1-cooling');
      await js(`window.FIND.open(); const i = document.querySelector('.fd input'); i.value = 'fan'; i.dispatchEvent(new Event('input'))`); await wait(400); await shot('2-find');
      out.findHits = await js(`[...document.querySelectorAll('.fd-row b')].map((b) => b.textContent)`);
      await js(`document.querySelector('.fd-wrap').click()`);
      await js(`document.querySelector('.nav[data-view="games"]').click()`); await wait(600); await shot('3-lobby');
      await js(`GAMES.open('blackjack'); document.querySelector('[data-add="25"]').click()`); await wait(200);
      await js(`document.querySelector('#bj-deal').click()`); await wait(500); await shot('4-blackjack');
      out.bj = await js(`document.querySelector('.gm-msg').textContent + ' | ' + [...document.querySelectorAll('.gm-actions button')].map((b) => b.textContent).join(',')`);
      await js(`GAMES.open('poker')`); await wait(300); await js(`document.querySelector('#pk-deal').click()`); await wait(4500); await shot('5-holdem');
      out.pk = await js(`[...document.querySelectorAll('.gm-actions button')].map((b) => b.textContent).join(',') + ' | ' + document.querySelector('.pk-log').innerText.replace(/\\n/g, ' / ')`);
      // play a few hold'em decisions automatically (always call), to make sure a hand finishes
      for (let k = 0; k < 20; k++) { const b = await js(`(document.querySelector('[data-pa="call"]') || document.querySelector('#pk-deal')) ? 1 : 0`); if (!b) { await wait(800); continue; } const done = await js(`!!document.querySelector('#pk-deal')`); if (done) break; await js(`document.querySelector('[data-pa="call"]').click()`); await wait(2500); }
      out.pkResult = await js(`document.querySelector('.gm-msg').textContent`); await shot('6-holdem-end');
      await js(`document.querySelector('[data-mode="video"]').click()`); await wait(200); await js(`document.querySelector('#vp-go').click()`); await wait(300); await shot('7-video');
      await js(`GAMES.open('spades')`); await wait(200); await js(`document.querySelector('#sp-deal').click()`); await wait(2500); await shot('8-spades-bid');
      await js(`document.querySelector('[data-bid="3"]')?.click()`); await wait(4000);
      for (let k = 0; k < 13; k++) { await js(`document.querySelector('[data-pc]')?.click()`); await wait(4200); }
      out.spades = await js(`document.querySelector('.gm-actions').innerText.replace(/\\n/g, ' / ')`); await shot('9-spades-end');
      out.consoleErrors = err.slice(0, 5);
    } catch (e) { out.error = e.stack; }
    fs.writeFileSync(path.join(dir, 'ui.json'), JSON.stringify(out, null, 1));
  }, 12000);
}
if (!app.isPackaged && process.env.HS_SNAPSHOT && process.env.HS_NOTESIMPORT) { // dev check: import the real OneNote into a throwaway vault (counts only)
  setTimeout(async () => {
    const dir = process.env.HS_NOTESIMPORT, out = {};
    try {
      await api.notesCreate('throwaway test vault 123', []);
      const t0 = Date.now();
      if (process.env.HS_IMPORT_FOLDER) { // the exported-folder path, then lock/unlock and what the NOTES page shows
        out.folder = await api.notesImportFolder(process.env.HS_IMPORT_FOLDER);
        out.listAfterImport = api.notesList().length;
        api.notesLock(); await api.notesUnlock('throwaway test vault 123');
        out.listAfterUnlock = api.notesList().length; out.unreadable = notes.unreadable;
        const w = BrowserWindow.getAllWindows().find((x) => /index\.html/.test(x.webContents.getURL()));
        const js = (q) => w.webContents.executeJavaScript(q, true);
        await js(`document.querySelector('.nav[data-view="notes"]').click()`); await new Promise((r) => setTimeout(r, 3000));
        out.page = await js(`({ app: !!document.querySelector('.nt-app'), lock: !!document.querySelector('.nt-card'), rows: document.querySelectorAll('.nt-p').length, books: document.querySelectorAll('.nt-b').length })`);
        const errs = []; w.webContents.on('console-message', (e) => errs.push(String(e.message).slice(0, 300)));
        await js(`document.querySelector('.nt-b.book')?.click()`); await new Promise((r) => setTimeout(r, 1500));
        out.pageAfterBook = await js(`({ rows: document.querySelectorAll('.nt-p').length, tabs: document.querySelectorAll('.nt-tab').length })`);
        out.consoleErrors = errs;
        fs.writeFileSync(path.join(dir, 'import.json'), JSON.stringify(out, null, 1));
        return;
      }
      const r = await api.notesImport();
      out.import = r; out.seconds = Math.round((Date.now() - t0) / 1000);
      const l = api.notesList();
      out.notes = l.length; out.notebooks = [...new Set(l.map((n) => n.notebook))].length; out.withPictures = l.filter((n) => n.pics).length;
      out.datesKept = l.filter((n) => !String(n.created).startsWith(new Date().toISOString().slice(0, 10))).length;
      const t1 = Date.now(); const r2 = await api.notesImport(); out.reimport = { added: r2.added, updated: r2.updated, skipped: r2.skipped, seconds: Math.round((Date.now() - t1) / 1000) };
      let plain = 0; const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (fs.readFileSync(p).subarray(0, 4).toString() !== 'HSN1' && f.name !== 'vault.json') plain++; } };
      walk(notes.dir); out.unencryptedFiles = plain;
    } catch (e) { out.error = e.stack; }
    fs.writeFileSync(path.join(dir, 'import.json'), JSON.stringify(out, null, 1));
  }, 8000);
}
if (!app.isPackaged && process.env.HS_SNAPSHOT && process.env.HS_LITETEST) { // dev check: LITE MODE switches on and off, and what it saves
  setTimeout(async () => {
    const dir = process.env.HS_LITETEST, out = {};
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      const w = BrowserWindow.getAllWindows().find((x) => /index\.html/.test(x.webContents.getURL()));
      const js = (s) => w.webContents.executeJavaScript(s, true);
      const cpuOf = async () => { // the main window's renderer CPU over 8 s
        const pid = w.webContents.getOSProcessId();
        app.getAppMetrics(); await wait(8000);
        return Math.round((app.getAppMetrics().find((m) => m.pid === pid)?.cpu.percentCPUUsage || 0) * 10) / 10;
      };
      out.defaults = api.liteGet();
      api.liteSet({ mode: 'off' }); await wait(1500);
      out.cpuFullLooks = await cpuOf();
      api.liteSet({ mode: 'on' }); await wait(1500);
      out.bodyLiteOn = await js(`document.body.classList.contains('lite')`);
      out.button = await js(`document.querySelector('#lite-btn').textContent`);
      out.cpuLite = await cpuOf();
      // AUTO: 20 s of a busy CPU goes lite; a calm minute brings the looks back
      api.liteSet({ mode: 'auto' });
      const feed = (t, secs) => { for (let s = 0; s < secs; s += 2) { liteLast = Date.now() - 2000; liteTick(t); } };
      feed({ cpu: { util: 85, temp: 80 }, gpu: { util: 20 }, mem: 50 }, 10); out.after10sBusy = lite.on;
      feed({ cpu: { util: 85, temp: 80 }, gpu: { util: 20 }, mem: 50 }, 10); out.after20sBusy = lite.on; out.why = lite.why;
      feed({ cpu: { util: 30, temp: 70 }, gpu: { util: 10 }, mem: 50 }, 40); out.after40sCalm = lite.on;
      feed({ cpu: { util: 30, temp: 70 }, gpu: { util: 10 }, mem: 50 }, 30); out.after70sCalm = lite.on;
      feed({ cpu: { util: 40, temp: 90 }, gpu: { util: 10 }, mem: 50 }, 16); out.hotCpu16s = lite.on; out.why2 = lite.why;
      feed({ cpu: { util: 30, temp: 70 }, gpu: { util: 10 }, mem: 50 }, 70); out.calmAgain = lite.on;
      feed({ cpu: { util: 30, temp: 70 }, gpu: { util: 10 }, mem: 95 }, 16); out.memFull16s = lite.on; out.why3 = lite.why; out.realMem = memCommitted();
      await wait(800);
      out.bodyLiteAuto = await js(`document.body.classList.contains('lite')`);
      await js(`document.querySelector('[data-view="settings"]')?.click(); document.querySelector('[data-set="general"], [data-tab="general"]')?.click()`); await wait(1200);
      await js(`document.querySelector('#sg-lite')?.scrollIntoView()`); await wait(400);
      fs.writeFileSync(path.join(dir, 'lite-settings.png'), (await w.webContents.capturePage()).toPNG());
      out.settingsText = await js(`document.querySelector('#sg-lite')?.innerText.slice(0, 300)`);
      api.liteSet({ reset: true });
    } catch (e) { out.error = e.stack; }
    fs.writeFileSync(path.join(dir, 'lite.json'), JSON.stringify(out, null, 1));
  }, 15000);
}
if (!app.isPackaged && process.env.HS_SNAPSHOT && process.env.HS_SECTEST) { // dev check: the phone link pauses on an untrusted network
  setTimeout(async () => {
    const out = {};
    try {
      // what a phone sees on the plain address: the lock screen, and no key sent
      const { lanAddresses } = require('./remote');
      const g = new BrowserWindow({ width: 390, height: 844, show: false, webPreferences: { partition: 'sectest', backgroundThrottling: false } });
      g.hsGrab = true;
      const sent = [];
      g.webContents.session.webRequest.onBeforeSendHeaders((d, cb) => { if (d.requestHeaders['X-HS-Key'] || /[?&]k=/.test(d.url)) sent.push(d.url); cb({ requestHeaders: d.requestHeaders }); });
      await g.loadURL(`http://${lanAddresses()[0].address}:${config.remote.port}/renderer/phone.html#k=${config.remote.key}`);
      await new Promise((r) => setTimeout(r, 9000));
      fs.writeFileSync(path.join(process.env.HS_SECTEST, 'lock.png'), (await g.webContents.capturePage()).toPNG());
      out.lock = await g.webContents.executeJavaScript(`document.querySelector('.wiz.lock')?.innerText.slice(0, 400)`);
      out.keySentOverPlain = sent.filter((u) => u.startsWith('http:'));
      g.destroy();
      out.network = network; out.trusted = config.remote.trusted; out.runningAtStart = remote.running;
      const keep = config.remote.trusted;
      config.remote.trusted = ['Some Café Wi-Fi'];
      out.untrusted = await applyRemote(); out.runningUntrusted = remote.running;
      out.info = await api.remoteInfo();
      delete out.info.qr; delete out.info.urls;
      await api.remoteSet({ trust: true }); out.runningAfterTrust = remote.running; out.trustedAfter = config.remote.trusted;
      config.remote.trusted = keep; saveConfig();
    } catch (e) { out.error = e.stack; }
    fs.writeFileSync(path.join(process.env.HS_SECTEST, 'sec.json'), JSON.stringify(out, null, 1));
  }, 40000);
}
if (!app.isPackaged && process.env.HS_SNAPSHOT && process.env.HS_SAVETEST) { // dev check: SAVE TO FILES (a playlist .zip, and hold-to-save one track)
  setTimeout(async () => {
    const dir = process.env.HS_SAVETEST, out = {};
    try {
      const http = require('http');
      const base = `http://127.0.0.1:${config.remote.port}`;
      const p = new BrowserWindow({ width: 390, height: 844, show: false, webPreferences: { backgroundThrottling: false } });
      p.hsGrab = true;
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const js = (s) => p.webContents.executeJavaScript(s, true);
      const shot = async (n) => fs.writeFileSync(path.join(dir, `save-${n}.png`), (await p.webContents.capturePage()).toPNG());
      const get = (u, file) => new Promise((ok, bad) => http.get(base + u, (r) => { const w = fs.createWriteStream(file); r.pipe(w); w.on('finish', () => ok({ status: r.statusCode, headers: r.headers })); }).on('error', bad));
      await p.loadURL(`${base}/renderer/phone.html?mode=laptop#k=${config.remote.key}`); await wait(4000);
      await js(`document.querySelector('[data-tab="music"]').click()`); await wait(5000);
      // a playlist of a few tracks
      out.playlist = await js(`(() => { const s = document.querySelector('#pl'); const o = [...s.options].find((o) => o.value && +((o.textContent.match(/\\((\\d+)\\)$/) || [])[1]) >= 3 && +((o.textContent.match(/\\((\\d+)\\)$/) || [])[1]) <= 8); if (!o) return null; s.value = o.value; s.dispatchEvent(new Event('change')); return o.textContent.trim(); })()`);
      await wait(800);
      out.button = await js(`document.querySelector('#save-files').textContent`);
      await js(`document.querySelector('#save-files').click()`); await wait(2500);
      out.sheet = await js(`[...document.querySelectorAll('#save-body a.act')].map((a) => ({ href: a.getAttribute('href'), text: a.textContent }))`);
      await shot('sheet');
      const token = out.sheet[0].href.split('/')[3];
      out.expected = remote.zips.get(token).files.map((f) => ({ file: f.file, name: f.name, size: f.size }));
      const z = await get(out.sheet[0].href, path.join(dir, 'test.zip'));
      out.zip = { status: z.status, type: z.headers['content-type'], length: +z.headers['content-length'], disposition: z.headers['content-disposition'], onDisk: fs.statSync(path.join(dir, 'test.zip')).size };
      // hold a track: one file, not a .zip, and no playback
      await js(`document.querySelector('#save-x').click()`);
      await js(`(() => { const r = document.querySelector('#list .row'); const o = { bubbles: true, clientX: 50, clientY: 50, pointerId: 1 }; r.dispatchEvent(new PointerEvent('pointerdown', o)); })()`); await wait(900);
      await js(`(() => { const r = document.querySelector('#list .row'); const o = { bubbles: true, clientX: 50, clientY: 50, pointerId: 1 }; r.dispatchEvent(new PointerEvent('pointerup', o)); r.click(); })()`); await wait(800);
      out.hold = await js(`({ links: [...document.querySelectorAll('#save-body a.act')].map((a) => ({ href: a.getAttribute('href'), text: a.textContent })), playing: !!document.querySelector('#audio').src })`);
      await shot('hold');
      const one = await get(out.hold.links[0].href.replace('/renderer/', '/'), path.join(dir, 'one.bin'));
      out.one = { status: one.status, disposition: one.headers['content-disposition'], size: fs.statSync(path.join(dir, 'one.bin')).size };
      p.destroy();
    } catch (e) { out.error = e.stack; }
    fs.writeFileSync(path.join(dir, 'save.json'), JSON.stringify(out, null, 1));
  }, 6000);
}
if (!app.isPackaged && process.env.HS_SNAPSHOT && process.env.HS_DOCKTEST) { // dev check: capture the side dock
  setTimeout(async () => {
    const out = {};
    try {
      const all = screen.getAllDisplays(), last = all[all.length - 1], first = all[0];
      // where would a drop land?
      const mb = win.getBounds();
      out.targets = {
        rightEdgeLastScreen: (await dock.targetAt({ x: last.workArea.x + last.workArea.width - 10, y: last.workArea.y + 300 })).label,
        leftEdgeFirstScreen: (await dock.targetAt({ x: first.workArea.x + 5, y: first.workArea.y + 300 })).label,
        hyperspaceTopRight: (await dock.targetAt({ x: mb.x + mb.width - 60, y: mb.y + 120 })).label,
        hyperspaceBottomLeft: (await dock.targetAt({ x: mb.x + 60, y: mb.y + mb.height - 60 })).label,
        otherAppCentreScreen2: all[1] ? (await dock.targetAt({ x: all[1].workArea.x + all[1].workArea.width / 2, y: all[1].workArea.y + all[1].workArea.height / 2 })).label : null,
      };
      // drop it on HYPERSPACE's top-right corner and follow the window when it moves
      const t = await dock.targetAt({ x: mb.x + mb.width - 60, y: mb.y + 120 });
      dock.host = t.host; dock.setConfig({ ...dock.cfg(), place: t.place, pin: null }); dock.place();
      out.attached = { main: win.getBounds(), dock: dock.win.getBounds(), pinned: dock.pinned() };
      win.setPosition(mb.x + 80, mb.y + 40);
      await new Promise((r) => setTimeout(r, 600));
      out.afterMove = { main: win.getBounds(), dock: dock.win.getBounds() };
      fs.writeFileSync(path.join(dataDir, 'dock.png'), (await dock.win.webContents.capturePage()).toPNG());
    } catch (e) { out.error = e.stack; }
    fs.writeFileSync(path.join(dataDir, 'dock.json'), JSON.stringify(out, null, 1));
  }, 9000);
}
if (!app.isPackaged && process.env.HS_SNAPSHOT && process.env.HS_GRABWIN) { // dev check: the klickaud window opens with the link filled in
  setTimeout(async () => {
    const out = path.join(dataDir, 'grabwin');
    try {
      await grab.start({ url: process.env.HS_GRABWIN.split('|')[0], folder: process.env.HS_GRABWIN.split('|')[1] });
      await new Promise((r) => setTimeout(r, 9000));
      const w = BrowserWindow.getAllWindows().find((x) => x.hsGrab);
      const val = await w.webContents.executeJavaScript(`JSON.stringify({value:document.querySelector('input[name="value"]')?.value, url:location.href, title:document.title})`);
      fs.writeFileSync(out + '.json', val);
      fs.writeFileSync(out + '.png', (await w.webContents.capturePage()).toPNG());
    } catch (e) { fs.writeFileSync(out + '.json', JSON.stringify({ error: e.stack })); }
  }, 4000);
}
if (!app.isPackaged && process.env.HS_SNAPSHOT && process.env.HS_GRABTEST) {
  setTimeout(() => grab.selfTest(process.env.HS_GRABTEST).then((j) => fs.writeFileSync(path.join(dataDir, 'grabtest.json'), JSON.stringify({ job: grab.list(), queue: grab.queue() }, null, 1)))
    .catch((e) => fs.writeFileSync(path.join(dataDir, 'grabtest.json'), JSON.stringify({ error: e.stack }))), 4000);
}
// folders inside Music that belong to other apps (stems, lighting, sampler packs), not songs
const MUSIC_SKIP = /^(_|\.)|^(dj\.studio|soundswitch|rekordbox|pioneerdj|itunes|sidify|trash|tracktion loops)$/i;
// async on purpose: thousands of files read in one go would freeze the app (the NitroSense key, clicks) for seconds
async function scanFolders(folders, known) {
  const out = [];
  const files = []; // [path, folder it's in], in the order they're found
  const walk = async (dir, depth) => {
    if (depth > 8 || files.length > 20000) return;
    let ents;
    try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!e.name.startsWith('.') && !(dir === musicDir && MUSIC_SKIP.test(e.name))) await walk(p, depth + 1); continue; }
      if (!AUDIO_EXT.has(path.extname(e.name).toLowerCase()) || known.has(p.toLowerCase())) continue;
      known.add(p.toLowerCase());
      files.push([p, dir]);
    }
  };
  for (const f of folders) await walk(f, 0);
  // size + date added: 16 files at a time (one by one, a big Music folder took seconds of waiting on the disk)
  const stats = new Array(files.length);
  let next = 0;
  const statWorker = async () => {
    while (next < files.length) {
      const i = next++;
      try { stats[i] = await fs.promises.stat(files[i][0]); } catch { stats[i] = null; }
    }
  };
  await Promise.all(Array.from({ length: 16 }, statWorker));
  files.forEach(([p, dir], i) => {
    const base = cleanName(path.basename(p, path.extname(p)));
    const m = base.match(/^(.+?)\s+-\s+(.+)$/);
    const st = stats[i];
    // BPM / key: from the tagger's file name, else from HYPERSPACE's own analysis
    const a = fromName(p) || ana[p.toLowerCase()] || {};
    out.push({ id: 'f' + crypto.createHash('md5').update(p.toLowerCase()).digest('hex').slice(0, 14), path: p, exists: true, title: m ? m[2] : base, artist: m ? m[1] : null,
      album: path.basename(dir), genre: null, bpm: a.bpm || 0, key: a.key || null, len: a.len || 0, rating: 0, color: 0, plays: 0, art: null, wave: false,
      size: st ? st.size : 0, added: st ? st.birthtime.toISOString().slice(0, 10) : null, folder: true });
  });
  return out;
}
async function loadLibrary(refresh) {
  let rb = { ok: false, source: 'none', tracks: [], playlists: [], history: [], colors: {} };
  if (core.online) { try { rb = await core.call('lib.load', { refresh: !!refresh }); } catch (e) { rb.error = e.message; } }
  else rb.error = 'HyperCore is starting…';
  const known = new Set(rb.tracks.map((t) => (t.path || '').toLowerCase()));
  const watchM = crateCfg().watchMusic !== false;
  const extra = await scanFolders([...crateCfg().folders, ...(watchM ? [musicDir] : [])], known);
  // songs that arrived in the last 30 days and haven't been analysed yet get their BPM / key in the background
  const cutoff = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  queueAnalysis(extra.filter((t) => !t.bpm && t.added >= cutoff).slice(0, 300).map((t) => t.path));
  const tracks = [...rb.tracks, ...extra];
  lib.paths.clear(); lib.art.clear();
  for (const t of tracks) {
    // SoundCloud artwork stands in wherever rekordbox has none
    const m = sc.get(t.id);
    if (m && m.s !== 'none') { t.sc = m; if (!t.art) t.art = sc.artPath(t.id); }
    if (t.path) lib.paths.set(t.id, t.path);
    if (t.art) lib.art.set(t.id, t.art);
  }
  lib.tracks = tracks;
  lastPlaylists = rb.playlists || [];
  // new tracks get looked up on their own once you've fetched the library the first time
  if (crateCfg().scAuto && tracks.some((t) => t.exists && !sc.get(t.id))) setTimeout(() => sc.fetchAll(lib.tracks), 4000);
  return { ...rb, tracks, folders: crateCfg().folders, music: watchM ? musicDir : null, tagger: tagger.status(), sc: sc.status() };
}
async function serveFile(file, range) {
  const st = await fs.promises.stat(file);
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  let start = 0, end = st.size - 1, status = 200;
  const m = range && /bytes=(\d*)-(\d*)/.exec(range);
  if (m) {
    if (m[1]) { start = +m[1]; if (m[2]) end = Math.min(+m[2], end); }
    else if (m[2]) start = Math.max(0, st.size - +m[2]);
    status = 206;
  }
  const headers = { 'Content-Type': type, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' };
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
  return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), { status, headers });
}

// ---------- VJ pictures: copies of your images, mixed into the visuals ----------
const vjImgDir = path.join(dataDir, 'vj-images');
const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);
function vjImages() {
  try { return fs.readdirSync(vjImgDir).filter((f) => IMG_EXT.has(path.extname(f).toLowerCase())).map((name) => ({ name })); } catch { return []; }
}

// ---------- API (shared by the window over IPC and phones over HTTP) ----------
const updater = new Updater();
updater.on('state', (st) => broadcast('update-state', st));
const api = {
  updateState: () => ({ ...updater.state, available: updater.available }),
  updateCheck: () => updater.check().then((st) => ({ ...st, available: updater.available })),
  updateInstall: () => updater.install().then((st) => ({ ...st, available: updater.available })),
  info: () => getStaticInfo(),
  perf: () => getPerf(),
  thermalHistory: (since = 0) => {
    if (!since) return thermal;
    let i = thermal.length;
    while (i > 0 && thermal[i - 1][0] > since) i--;
    return thermal.slice(i);
  },
  procs: (opts) => getProcesses({ gpu: !!opts?.gpu }),
  hwState: () => getHwState(),
  setMic: async (on) => keepHw(await hw.setMic(on)),
  setCam: async (on, hard) => keepHw(await hw.setCam(on, hard)),
  kill: async (pid) => {
    // the core goes first: it refuses the processes Windows can't live without
    if (core.online) { try { await core.call('proc.kill', { pid }); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } }
    try { process.kill(pid); return { ok: true }; } catch (err) { return { ok: false, error: err.code || err.message }; }
  },
  reveal: async (pid) => {
    let p = null;
    if (core.online) { try { p = await core.call('proc.path', { pid }); } catch {} }
    if (!p) { const r = await hw.helper('path', String(Number(pid))); p = r.ok ? r.path : null; }
    if (p) { shell.showItemInFolder(p); return true; }
    return false;
  },
  core: (cmd, args) => core.call(cmd, args || {}),
  coreStatus: async () => ({ ...core.status, task: await core.taskExists(), exe: fs.existsSync(coreExe), renderGpu: safeDrawing ? 'safe' : renderGpu, safeReason: safeInfo?.reason || null }),
  setRenderGpu: (v) => {
    config.renderGpu = ['integrated', 'nvidia', 'safe'].includes(v) ? v : 'nvidia';
    if (v !== 'safe') try { fs.unlinkSync(safeFile); } catch {} // picking a card means: try the graphics card again now
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
    // GPU choice only applies at launch
    setTimeout(() => { app.relaunch({ args: [...process.argv.slice(1).filter((a) => a !== '--relaunched'), '--relaunched'] }); app.quit(); }, 300);
    return { restarting: true };
  },
  coreRestart: async (opts) => {
    config.core = { ...config.core, ...(opts || {}) };
    saveConfig();
    restarts = 0;
    await core.restart(config.core);
    // asked for admin and Windows said no (or the prompt was closed): don't ask again at every launch
    if (opts?.elevate && !core.status.elevated) { config.core = { ...config.core, elevate: false }; saveConfig(); }
    return api.coreStatus();
  },
  coreTask: async (action) => {
    let ok;
    if (core.online && core.status.elevated) {
      // the core already has admin: no prompt needed
      try { await core.call(action === 'install' ? 'task.install' : 'task.remove', { conn: core.connFile, app: process.execPath }); ok = true; } catch { ok = false; }
    } else ok = action === 'install' ? await core.installTask(process.execPath) : await core.removeTask();
    config.core.useTask = action === 'install' && ok;
    saveConfig();
    return { ok, ...(await api.coreStatus()) };
  },
  config: () => config,
  setConfig: async (patch) => {
    for (const [k, v] of Object.entries(patch || {})) {
      config[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...(config[k] || {}), ...v } : v;
    }
    saveConfig();
    broadcast('config', config);
    if ('remote' in patch) await applyRemote();
    return config;
  },
  // ---- NOTES ----
  notesState: () => notesState(),
  notesCreate: async (password, mirrors) => {
    if (Array.isArray(mirrors)) { config.notes.mirrors = notes.mirrors = mirrors.filter(Boolean); saveConfig(); }
    const r = await notes.create(password);
    broadcast('notes-state', notesState());
    return r;
  },
  notesUnlock: async (secret, recovery) => {
    // a laptop with no vault yet but a copy on the SSD: bring the copy over first
    if (!notes.exists()) await notes.syncAll().catch(() => {});
    const r = await notes.unlock(secret, { recovery: !!recovery });
    broadcast('notes-state', notesState());
    // tidy-up and copying happen after the unlock answers, so the password box never waits for them
    notes.relaxImported().then((n) => { if (n) broadcast('notes-state', { ...notesState(), count: -1 }); }).catch(() => {});
    notes.syncAll().catch(() => {});
    return r;
  },
  notesLock: () => { notes.lock('locked'); return notesState(); }, // the journal only
  notesPassword: async (oldPw, newPw) => {
    try { await notes.unwrap(notes.readMeta().pw, String(oldPw)); } catch { throw new Error('the current password is wrong'); }
    await notes.setPassword(newPw);
    return true;
  },
  notesList: () => notes.list(),
  notesSearch: (q) => { const w = String(q || '').toLowerCase().split(/\s+/).filter(Boolean); return [...notes.notes.values()].filter((n) => !n.deleted && w.every((x) => `${n.title} ${n.body} ${n.notebook} ${n.section}`.toLowerCase().includes(x))).map((n) => n.id); },
  notesGet: (i) => notes.get(i),
  notesSave: (n) => notes.save(n),
  notesDelete: (i, forever) => notes.remove(i, !!forever),
  notesRestore: async (i) => { const n = notes.get(i); if (n) await notes.save({ ...n, deleted: false }); return true; },
  notesBlob: async (bid) => { const b = await notes.getBlob(bid); return `data:${b.mime};base64,${b.data.toString('base64')}`; },
  notesPicture: async (dataUrl, journal) => {
    const m = /^data:([\w/+.-]+);base64,(.+)$/.exec(String(dataUrl || ''));
    if (!m || !m[1].startsWith('image/')) throw new Error('not a picture');
    return notes.putBlob(Buffer.from(m[2], 'base64'), m[1], !!journal);
  },
  // any file dropped or picked on a page (PDF, Word, audio, zip…): encrypted like the pictures
  notesAttach: async (name, bytes, journal) => {
    const buf = Buffer.from(bytes || []);
    if (!buf.length) throw new Error('that file is empty');
    if (buf.length > NOTE_FILE_MAX) throw new Error(`files up to ${NOTE_FILE_MAX / 1048576} MB`);
    return notes.putBlob(buf, mimeOfName(String(name || '')), !!journal);
  },
  notesSaveBlob: async (bid, name) => {
    const b = await notes.getBlob(bid);
    const r = await dialog.showSaveDialog(win, { defaultPath: blobFileName(bid, name, b.mime) });
    if (r.canceled || !r.filePath) return false;
    fs.writeFileSync(r.filePath, b.data);
    return true;
  },
  // opens a file in its own app (Word, a PDF reader…) from a temporary unencrypted copy, deleted when the journal
  // locks and when HYPERSPACE closes
  notesOpenBlob: async (bid, name) => {
    // OPEN hands the file to Windows, so a program or script would just run: those can only be saved, never opened
    if (NOTE_RUNNABLE.test(String(name || ''))) throw new Error('programs and scripts can only be saved, not opened from a note');
    const b = await notes.getBlob(bid);
    const dir = path.join(NOTE_OPEN_DIR, crypto.randomBytes(6).toString('hex'));
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, blobFileName(bid, name, b.mime));
    fs.writeFileSync(file, b.data);
    const err = await shell.openPath(file);
    if (err) throw new Error(err);
    return true;
  },
  notesHistory: (i) => notes.history(i),
  notesVersion: (i, at) => notes.version(i, at),
  notesImport: () => importOneNote(),
  notesImportFolder: async (dir) => {
    let root = dir;
    if (!root) {
      const guess = path.join(app.getPath('documents'), 'OneNote Notes');
      const r = await dialog.showOpenDialog(win, { title: 'Choose the folder of exported OneNote notebooks', defaultPath: fs.existsSync(guess) ? guess : app.getPath('documents'), properties: ['openDirectory'] });
      if (r.canceled || !r.filePaths[0]) return null;
      root = r.filePaths[0];
    }
    return importFolder(root);
  },
  notesExportFolderGuess: () => { const g = path.join(app.getPath('documents'), 'OneNote Notes'); return fs.existsSync(g) ? g : null; },
  notesSyncNow: () => notes.syncAll(),
  notesDrives: () => driveList(),
  notesMirrors: (list) => {
    config.notes.mirrors = notes.mirrors = (list || []).map(String).filter(Boolean);
    saveConfig();
    notes.syncAll().catch(() => {});
    return notesState();
  },
  notesAutoLock: (min) => { config.notes.autoLockMin = notes.autoLockMin = Math.max(0, Math.min(240, +min || 0)); saveConfig(); return notesState(); },
  // ---- TO-DO + quests ----
  todoGet: () => { try { return JSON.parse(fs.readFileSync(TODO_FILE, 'utf8')); } catch { return null; } },
  // for the TO-DO quests' "SPOTTED" hints: is it on this computer? (only yes/no ever leaves here)
  todoDetect: () => {
    const L = process.env.LOCALAPPDATA || '', P = process.env.ProgramFiles || 'C:\\Program Files', P86 = process.env['ProgramFiles(x86)'] || '';
    const any = (...ps) => ps.some((p) => { try { return !!p && fs.existsSync(p); } catch { return false; } });
    const brave = (base) => path.join(base, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe');
    return {
      brave: any(brave(L), brave(P), brave(P86)),
      protonvpn: any(path.join(P, 'Proton', 'VPN'), path.join(P86, 'Proton', 'VPN')),
      signal: any(path.join(L, 'Programs', 'signal-desktop', 'Signal.exe')),
      fromonedrive: any(path.join(app.getPath('documents'), 'From OneDrive')),
      searxng: any(path.join(app.getPath('desktop'), 'searxng-master')),
    };
  },
  todoSave: (s) => { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(TODO_FILE, JSON.stringify(s, null, 1)); return true; },
  liteGet: () => liteState(),
  liteSet: (patch = {}) => {
    const keys = Object.keys(LITE_DEFAULTS);
    const clean = Object.fromEntries(Object.entries(patch).filter(([k, v]) => keys.includes(k) && (k === 'mode' ? ['auto', 'on', 'off'].includes(v) : Number.isFinite(+v))).map(([k, v]) => [k, k === 'mode' ? v : +v]));
    config.lite = patch.reset ? {} : { ...(config.lite || {}), ...clean };
    saveConfig();
    const c = liteCfg();
    if (c.mode !== 'auto') setLite(c.mode === 'on', c.mode === 'on' ? 'switched on' : null);
    else if (lite.why === 'switched on') setLite(false, null); // back to AUTO: start from full looks and let it decide
    broadcast('lite', liteState());
    return liteState();
  },
  remoteInfo: async () => {
    if (network === null) await watchNetwork(true).catch(() => {}); // (with the link off, the network is only looked up here)
    const urls = remote.running ? remote.urls() : [];
    let qr = null;
    if (urls[0]) qr = await require('qrcode').toDataURL(urls[0].url, { margin: 1, width: 280, color: { dark: '#00ff6e', light: '#000400' } });
    return {
      enabled: config.remote.enabled, running: remote.running, port: config.remote.port, urls, qr, clients: remote.clients.size, secureUrl: remote.secureUrl(),
      encrypted: !!remote.secure, network, paused: linkPaused(), trusted: config.remote.trusted || [],
      devices: (config.remote.devices || []).filter((d) => !isLoopbackIp(d.ip)).sort((a, b) => b.last - a.last).slice(0, 6),
    };
  },
  remoteSet: async ({ enabled, regenerate, trust, untrust } = {}) => {
    // a new key unpairs every phone, so the list of paired devices starts over too
    if (regenerate) { config.remote.key = crypto.randomBytes(18).toString('base64url'); config.remote.devices = []; remote.seen.clear(); }
    if (enabled != null) config.remote.enabled = !!enabled;
    if (trust && network) config.remote.trusted = [...new Set([...(config.remote.trusted || []), network])];
    if (untrust) config.remote.trusted = (config.remote.trusted || []).filter((n) => n !== untrust);
    saveConfig();
    const r = await applyRemote();
    return { ...(await api.remoteInfo()), error: r.ok ? null : r.error };
  },
  vjDisplays: () => screen.getAllDisplays().map((d, i) => ({
    id: d.id, label: `${i + 1}: ${d.size.width}×${d.size.height}${d.internal ? ' (laptop)' : ''}`, primary: d.id === screen.getPrimaryDisplay().id,
  })),
  vjOut: (displayId) => openVjOut(displayId),
  spoutGet: () => spoutStatus(),
  spoutSet: (patch) => {
    config.spout = { ...spoutCfg(), ...(patch || {}) };
    if (config.spout.name) config.spout.name = String(config.spout.name).replace(/[^\w .\-]/g, '').slice(0, 60) || 'HYPERSPACE';
    saveConfig();
    stopSpout();
    setTimeout(spoutTick, 400);
    return { ...spoutStatus(), running: false };
  },
  spoutInfo: () => ({ port: spout.port, token: spout.token }),
  // custom shortcuts can open an app, file, folder or URL, but only ones saved as a shortcut
  openTarget: async (target) => {
    const saved = (config.shortcuts?.custom || []).some((s) => s.open === target);
    if (!saved) throw new Error('only saved shortcuts can be opened');
    if (/^https?:\/\//i.test(target)) { await shell.openExternal(target); return true; }
    const err = await shell.openPath(target);
    if (err) throw new Error(err);
    return true;
  },
  routerGet: () => ({ ...router.status(), cfg: router.cfg, downloads: app.getPath('downloads'), base: router.base }),
  routerSet: (patch) => {
    config.router = { ...router.cfg, ...(patch || {}) };
    saveConfig();
    router.configure(config.router);
    return api.routerGet();
  },
  routerPickFolder: async (title) => {
    const r = await dialog.showOpenDialog(win, { title: title || 'Choose a folder', properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  },
  routerUndo: (id) => router.undo(id),
  usbTree: async () => { const t = await usbTree(coreExe); try { t.newDevices = usbHist.record(t); } catch {} return t; },
  usbHistory: () => usbHist.list(),
  // your own names for the sockets ("LEFT FRONT"): portNames() reads, portNames({ id, name }) sets
  portNames: (set) => {
    if (set && typeof set.id === 'string') {
      const names = { ...(config.ports?.names || {}) };
      const name = String(set.name || '').slice(0, 24).trim();
      if (name) names[set.id.slice(0, 40)] = name; else delete names[set.id];
      config.ports = { ...(config.ports || {}), names };
      saveConfig();
    }
    return config.ports?.names || {};
  },
  taggerGet: () => tagger.status(),
  taggerSet: (patch) => {
    config.tagger = { ...tagger.cfg, ...(patch || {}) };
    delete config.tagger.rules;
    saveConfig();
    tagger.configure(config.tagger);
    return tagger.status();
  },
  taggerUndo: async (id) => { const e = await tagger.undo(id); musicChanged(); return e; },
  routerRunNow: () => router.runNow(),
  routerTest: (name) => router.test(name),
  routerReveal: (id) => {
    const e = router.log.find((x) => x.id === id);
    if (e) shell.showItemInFolder(e.undone ? e.from : e.to);
    return !!e;
  },
  audioLease: (id, on, source) => {
    if (on) leases.set(String(id), Date.now() + (String(id).startsWith('phone') ? 15000 : 1e12));
    else leases.delete(String(id));
    if (source) audioSource = source;
    return updateCapture();
  },
  wallGet: () => wallStatus(),
  wallSet: (patch) => {
    const wasOn = !!config.wallpaper?.enabled;
    config.wallpaper = { ...wallCfg(), ...(patch || {}) };
    saveConfig();
    stopWall();
    setTimeout(startWall, 300);
    // first switch-on needs a restart for the occlusion switch; the window still works, it may just stutter when covered
    return { ...wallStatus(), live: 0, restartHint: !wasOn && config.wallpaper.enabled };
  },
  keyGet: () => keyStatus(),
  keySet: async (patch) => {
    config.nsKey = { ...nsCfg(), ...(patch || {}) };
    saveConfig();
    return applyKeyAgent(true);
  },
  libLoad: (refresh) => loadLibrary(refresh),
  // the phone's MUSIC tab: the library without the per-track cue lists (much less to send over Wi-Fi)
  libLite: async () => {
    const L = lib.tracks.length ? { tracks: lib.tracks, playlists: lastPlaylists } : await loadLibrary(false);
    return { tracks: L.tracks.filter((t) => t.exists).map((t) => ({ id: t.id, title: t.title, artist: t.artist, bpm: t.bpm, key: t.key, len: t.len, genre: t.genre, art: !!t.art, rating: t.rating, added: t.added })),
      playlists: (L.playlists || []).map((p) => ({ id: p.id, name: p.name, parent: p.parent, kind: p.kind, tracks: p.tracks })) };
  },
  libWave: (id, cols) => (String(id).startsWith('f') ? { ok: false, error: 'not analysed in rekordbox' } : core.call('lib.wave', { id: String(id), cols: Math.min(80000, cols || 1600) })),
  libAddFolder: async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Add a music folder to CRATE', properties: ['openDirectory'] });
    if (r.canceled) return crateCfg().folders;
    config.crate = { ...crateCfg(), folders: [...new Set([...crateCfg().folders, r.filePaths[0]])] };
    saveConfig();
    return config.crate.folders;
  },
  libRemoveFolder: (dir) => {
    config.crate = { ...crateCfg(), folders: crateCfg().folders.filter((f) => f !== dir) };
    saveConfig();
    return config.crate.folders;
  },
  libReveal: (id) => { const p = lib.paths.get(String(id)); if (p) shell.showItemInFolder(p); return !!p; },
  libPlayed: (id) => {
    const c = crateCfg();
    const plays = { ...c.plays, [id]: (c.plays[id] || 0) + 1 };
    config.crate = { ...c, plays, recent: [String(id), ...c.recent.filter((x) => x !== String(id))].slice(0, 100) };
    saveConfig();
    return { plays: plays[id] };
  },
  crateState: () => crateCfg(),
  libFeatures: () => (core.online ? core.call('lib.features', {}) : {}),
  // ⚑ SET DROP: which = 1 | 2, ms = where (0 forgets it); the drop finder retrains on every mark
  libDropFix: (id, which, ms) => core.call('lib.dropFix', { id: String(id), which: which === 2 ? 2 : 1, ms: Math.max(0, Math.round(ms || 0)) }),
  scStatus: () => sc.status(),
  scFetch: (opts) => {
    if (!lib.tracks.length) throw new Error('open CRATE first so the library is loaded');
    config.crate = { ...crateCfg(), scAuto: true };
    saveConfig();
    return sc.fetchAll(lib.tracks, opts || {});
  },
  // stopping also stops the automatic lookups until you press fetch again
  scStop: () => { config.crate = { ...crateCfg(), scAuto: false }; saveConfig(); return sc.stop(); },
  scSetUrl: async (id, url) => {
    const t = lib.tracks.find((x) => x.id === id);
    if (!t) throw new Error('track not found');
    const m = await sc.setUrl(t, String(url).trim());
    if (sc.artPath(id)) lib.art.set(id, sc.artPath(id));
    return m;
  },
  scClear: (id) => { sc.clear(id); return null; },
  dockGet: () => dock.status(),
  dockSet: (patch) => { const s = dock.set(patch); if (s.enabled) vpn.start(); return s; },
  dockMouse: (open) => { dock.mouse(open); return true; },
  dockDrag: (phase) => (phase === 'start' ? (dock.dragStart(), true) : dock.dragEnd()),
  dockLayer: () => dock.toggleLayer(),
  dockTyping: (on) => dock.typing(on),
  dockData: (key, value) => {
    dockSend('dock-data', { key, value });
    if (key === 'crate') { crateNow = value; remote.broadcast('crate-now', value); } // phones see the laptop's player too
    return true;
  },
  dockCmd: (key, action, arg) => { if (win && !win.isDestroyed()) win.webContents.send('ev', 'dock-cmd', { key, action, arg }); return true; },
  // the phone driving CRATE on the laptop: toggle / next / prev / seek (s) / play ({ id, ids })
  crateRemote: (action, arg) => { if (win && !win.isDestroyed()) win.webContents.send('ev', 'dock-cmd', { key: 'crate', action, arg }); return true; },
  crateNow: () => crateNow,
  dockSummon: () => { summon(false); return true; },
  // note-usage log shared by the notes page and the dock window (their localStorage is separate): { noteId: [timestamps, last 36 h] }
  notesUse: (id) => {
    if (typeof id !== 'string' || !id || id.length > 80) return false;
    const u = (config.notesUse && typeof config.notesUse === 'object') ? config.notesUse : (config.notesUse = {}), now = Date.now(), cut = now - 36 * 36e5;
    for (const k of Object.keys(u)) { u[k] = (Array.isArray(u[k]) ? u[k] : []).filter((t) => t > cut); if (!u[k].length) delete u[k]; }
    (u[id] ||= []).push(now); saveConfig(); return true;
  },
  notesUseList: () => { const u = (config.notesUse && typeof config.notesUse === 'object') ? config.notesUse : {}, cut = Date.now() - 36 * 36e5, o = {}; for (const k of Object.keys(u)) { const a = (Array.isArray(u[k]) ? u[k] : []).filter((t) => t > cut); if (a.length) o[k] = a; } return o; },
  dockOpenView: (v) => { if (win && !win.isDestroyed()) win.webContents.send('ev', 'open-view', String(v)); return true; },
  vpnStatus: () => { vpn.start(); return vpn.state; },
  vpnOpen: (provider) => vpnOpen(provider),
  vpnWgInfo: async () => { const i = wgInfo(); let state = null; if (i.installed && i.profile && core.online) state = (await core.call('vpn.wg', { action: 'status', name: i.profile.name }).catch(() => null))?.state || null; return { installed: i.installed, profile: i.profile, state }; },
  vpnWgImport: (file) => wgImport(file),
  vpnToggle: (on) => vpnToggle(on),
  vpnWgUp: () => wgSwitch(true),
  vpnWgDown: () => wgSwitch(false),
  grabFolders: () => grab.folders(),
  grabInfo: async (url) => { const { raw, ...i } = await grab.info(url); return i; },
  grabStart: (opts) => grab.start(opts || {}),
  grabJobs: () => ({ jobs: grab.list(), queue: grab.queue().length }),
  grabBrowse: async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Where should downloads go?', defaultPath: grab.cfg().root, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  },
  grabBuy: (url) => grab.openBuy(String(url || '')),
  grabFlush: () => grab.flush().then(() => ({ queue: grab.queue().length })),
  scOpen: (url) => (/^https:\/\/([\w-]+\.)?soundcloud\.com\//i.test(url) || /^https?:\/\//i.test(url) ? shell.openExternal(url) : null),
  // task manager extras: restart = end it, then start the same program again (as you, never as admin)
  procRestart: async (pid, pids) => {
    let file = null;
    if (core.online) { try { file = (await core.call('proc.info', { pid })).path; } catch {} }
    if (!file) throw new Error("can't see where that program lives");
    for (const p of pids || [pid]) {
      if (core.online) await core.call('proc.kill', { pid: p }); // throws for processes Windows needs
      else try { process.kill(p); } catch {}
    }
    await new Promise((r) => setTimeout(r, 900));
    const err = await shell.openPath(file);
    if (err) throw new Error(err);
    return true;
  },
  procSearch: (name) => shell.openExternal(`https://duckduckgo.com/?q=${encodeURIComponent(`${String(name).replace(/\.exe$/i, '')}.exe process`)}`),
  runTask: (cmd) => {
    const c = String(cmd || '').trim();
    if (!c) throw new Error('nothing to run');
    if (/^https?:\/\//i.test(c)) return shell.openExternal(c);
    // the same as Win+R: Windows finds the program, runs it as you
    spawn('cmd.exe', ['/d', '/s', '/c', `start "" ${c}`], { detached: true, windowsHide: true, windowsVerbatimArguments: true, stdio: 'ignore' }).on('error', () => {}).unref();
    return true;
  },
  appInfo: () => ({ version: app.getVersion(), dataDir, logDir: path.join(process.env.LOCALAPPDATA || dataDir, 'HYPERSPACE'), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node }),
  openDir: (which) => shell.openPath(which === 'logs' ? path.join(process.env.LOCALAPPDATA || dataDir, 'HYPERSPACE') : dataDir),
  vjImages: () => vjImages(),
  vjImageAdd: async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Add pictures to the VJ', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Images', extensions: [...IMG_EXT].map((e) => e.slice(1)) }] });
    if (r.canceled) return vjImages();
    fs.mkdirSync(vjImgDir, { recursive: true });
    for (const f of r.filePaths) {
      let name = path.basename(f).replace(/[^\w.\- ()]/g, '_');
      for (let i = 2; fs.existsSync(path.join(vjImgDir, name)); i++) name = `${path.parse(f).name.replace(/[^\w\-]/g, '_')} (${i})${path.extname(f)}`;
      fs.copyFileSync(f, path.join(vjImgDir, name));
    }
    broadcast('vjimages', true);
    return vjImages();
  },
  vjImageRemove: (name) => {
    try { fs.unlinkSync(path.join(vjImgDir, path.basename(String(name)))); } catch {}
    broadcast('vjimages', true);
    return vjImages();
  },
};
// optional extras from the `personal/` folder (absent in the public copy)
const addons = loadAddons(ROOT, { app, config, saveConfig, broadcast, dialog, shell, win: () => win });
for (const [k, fn] of Object.entries(addons.api)) if (!Object.hasOwn(api, k)) api[k] = fn;
// GAMING hub: library scan, launch, playtime sessions, overlay windows (all gm* calls)
const gaming = require('./gaming')({ app, shell, dialog, screen, BrowserWindow, globalShortcut, dataDir, getWin: () => win, broadcast, getPerf, getProcs: () => getProcesses({ gpu: false }), getTele: () => lastTelemetry });
for (const [k, fn] of Object.entries(gaming.api)) if (!Object.hasOwn(api, k)) api[k] = fn;
app.whenReady().then(() => gaming.start());
// Sidebar order + open tab strip, kept in a plain JSON file as a backup to localStorage (which Chromium writes lazily
// and can lose on a hard quit). Sync read at page start (preload), sync write on every change.
const UI_STATE_FILE = path.join(dataDir, 'ui-state.json');
const readUiState = () => { try { const o = JSON.parse(fs.readFileSync(UI_STATE_FILE, 'utf8')); return o && typeof o === 'object' ? o : {}; } catch { return {}; } };
ipcMain.on('uistate-get', (e) => { e.returnValue = ownPage(e.senderFrame?.url) ? readUiState() : {}; });
ipcMain.on('uistate-set', (e, key, val) => {
  if (!ownPage(e.senderFrame?.url) || !['navOrder', 'tabs'].includes(key)) return;
  const o = readUiState(); if (val == null) delete o[key]; else o[key] = val;
  try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(UI_STATE_FILE + '.tmp', JSON.stringify(o)); fs.renameSync(UI_STATE_FILE + '.tmp', UI_STATE_FILE); } catch {}
});
ipcMain.on('addons', (e) => { e.returnValue = ownPage(e.senderFrame?.url) ? addons.list : []; });
remote.api = {
  config: () => phoneConfig(),
  setConfig: async (patch) => { const p = {}; for (const k of ['preset', 'fans']) if (patch && k in patch) p[k] = patch[k]; await api.setConfig(p); return phoneConfig(); },
  core: (cmd, args) => { if (!PHONE_CORE.has(cmd)) throw new Error('not available from the phone'); return core.call(cmd, args || {}); },
  perf: () => api.perf(),
  hwState: () => api.hwState(),
  // the phone's MIC / CAM buttons (the soft switch only: the hard camera switch needs the laptop)
  setMic: (on) => api.setMic(!!on),
  setCam: (on) => api.setCam(!!on),
  libLite: () => api.libLite(),
  crateNow: () => api.crateNow(),
  crateRemote: (action, arg) => { if (!['play', 'pause', 'toggle', 'next', 'prev', 'seek', 'volume'].includes(action)) throw new Error('not available from the phone'); return api.crateRemote(action, arg); },
  vpnStatus: () => api.vpnStatus(),
};

// calls that act on the window that made them
const winOf = (e) => BrowserWindow.fromWebContents(e.sender);
const popouts = new Map(); // window id -> { win, view } for tabs living in their own window
const local = {
  win: (e, action) => {
    const w = winOf(e);
    if (!w) return;
    if (action === 'min') w.minimize();
    else if (action === 'max') w.isMaximized() ? w.unmaximize() : w.maximize();
    else if (action === 'close') w.close();
  },
  // a tab dragged out (or ⧉) becomes its own HYPERSPACE window showing that page
  popOut: (e, view, at) => {
    const parent = winOf(e);
    const b = parent ? parent.getBounds() : { x: 100, y: 100, width: 1200, height: 800 };
    const w = new BrowserWindow({
      x: at?.x != null ? Math.round(at.x - 200) : b.x + 40, y: at?.y != null ? Math.round(at.y - 20) : b.y + 40,
      width: Math.max(900, Math.round(b.width * 0.8)), height: Math.max(640, Math.round(b.height * 0.85)), minWidth: 720, minHeight: 520,
      frame: false, backgroundColor: '#000400', title: `HYPERSPACE · ${String(view).toUpperCase()}`, icon: path.join(ROOT, 'assets', 'icon.png'),
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required' },
    });
    w.loadFile(path.join(ROOT, 'renderer', 'index.html'), { query: { view: String(view), intro: 'off', solo: '1' } });
    const wcId = w.webContents.id;
    popouts.set(w.id, { win: w, view: String(view) });
    w.on('closed', () => { popouts.delete(w.id); for (const k of [...leases.keys()]) if (k.startsWith(`${wcId}:`)) leases.delete(k); updateCapture(); });
    return { ok: true, id: w.id };
  },
  // a torn-off tab's window follows the cursor while the tab is still being dragged
  moveWin: (e, id, x, y) => {
    const w = popouts.get(id)?.win;
    if (w && !w.isDestroyed()) w.setPosition(Math.round(x - 200), Math.round(y - 20));
  },
  // released: over another HYPERSPACE window the tab joins it, anywhere else it keeps its new window
  tabWinDone: (e, id, at) => {
    const p = popouts.get(id);
    if (!p || p.win.isDestroyed()) return { merged: false };
    if (at) {
      const target = [win, ...[...popouts.values()].map((x) => x.win)].find((w) => {
        // any HYPERSPACE window but the torn-off one, including where the tab came from (dropping it back undoes the tear)
        if (!w || w.isDestroyed() || w === p.win || w.isMinimized()) return false;
        const b = w.getBounds();
        return at.x >= b.x && at.x <= b.x + b.width && at.y >= b.y && at.y <= b.y + 120; // its title bar + tab strip
      });
      if (target) {
        p.win.destroy();
        target.webContents.send('ev', 'tab-adopt', p.view);
        target.focus();
        return { merged: true, view: p.view };
      }
    }
    p.win.focus();
    return { merged: false, view: p.view };
  },
  // audio leases are per window, so one window leaving the VJ page doesn't stop another's visuals
  audioLease: (e, id, on, source) => api.audioLease(`${e.sender.id}:${id}`, on, source),
  isMain: (e) => winOf(e) === win,
  // a window nobody can see gets the last sample back instead of a new one (see seenWin)
  perf: (e) => (seen(e) || !perfCache ? getPerf() : perfCache),
  procs: (e, opts) => (seen(e) || !getProcesses.cache.v ? api.procs(opts) : getProcesses.cache.v),
  hwState: (e) => (seen(e) || !hwCache ? getHwState() : hwCache.v),
  seen: (e) => seen(e),
};
// No window may wander off to another page (a dropped file, a link, a script): it would keep the bridge.
// Links to websites open in the normal browser instead. The SoundCloud helper windows have their own rules.
app.on('web-contents-created', (_e, wc) => {
  const grab = () => BrowserWindow.fromWebContents(wc)?.hsGrab;
  wc.on('will-navigate', (e, u) => {
    if (grab() || ownPage(u)) return;
    e.preventDefault();
    if (/^https:\/\//i.test(u)) shell.openExternal(u);
  });
  wc.on('will-attach-webview', (e) => e.preventDefault());
  wc.setWindowOpenHandler(({ url }) => { if (/^https:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
});

ipcMain.handle('api', (e, name, args) => {
  if (!ownPage(e.senderFrame?.url)) throw new Error('not allowed from this page');
  if (local[name]) return local[name](e, ...(args || []));
  if (typeof name !== 'string' || !Object.hasOwn(api, name) || typeof api[name] !== 'function') throw new Error('no such call ' + name);
  return api[name](...(args || []));
});
ipcMain.on('win', (e, action) => { if (ownPage(e.senderFrame?.url)) local.win(e, action); });

// ---------- window ----------
function createWindow() {
  // fits small or zoomed screens (1366×768, or 1080p at 150%): never bigger than the space Windows leaves
  const wa = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(1500, wa.width), height: Math.min(940, wa.height), minWidth: Math.min(960, wa.width), minHeight: Math.min(560, wa.height),
    frame: false, backgroundColor: '#000400', title: 'HYPERSPACE',
    show: !(!app.isPackaged && process.env.HS_SNAPSHOT),
    icon: path.join(ROOT, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false,
      backgroundThrottling: !process.env.HS_SNAPSHOT, // test captures may run behind other windows
      autoplayPolicy: 'no-user-gesture-required', // the startup animation's synthesized sound
    },
  });
  try { require('./spell').attach(win, local); } catch (e) { console.error('spell check', e.message); }
  win.loadFile(path.join(ROOT, 'renderer', 'index.html'), process.env.HS_SNAPSHOT ? { query: { intro: process.env.HS_INTRO || 'silent' } } : {});
  // a fresh launch comes up on top too (the intro plays on its own)
  if (!process.env.HS_SNAPSHOT) win.once('ready-to-show', () => summon(false));
  win.on('closed', () => {
    win = null;
    if (vjWin && !vjWin.isDestroyed()) vjWin.close();
    if (popWin && !popWin.isDestroyed()) popWin.destroy(); // hidden windows would keep the app alive
    stopSpout();
    stopWall();
    // closing the main window quits: popped-out tabs go with it
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.destroy();
  });

  // Dev aid: HS_SNAPSHOT=<file.png> saves a screenshot after boot, then quits.
  if (process.env.HS_SNAPSHOT) {
    // dev test runs must never pop up over what you're doing: show the window far off-screen, without taking focus
    // (a hidden window paints too slowly for screenshots). Tests that need real key input call win.show() themselves.
    win.setPosition(-32000, -32000); win.showInactive();
    const log = [];
    if (process.env.HS_SIZE) { const [w, h] = process.env.HS_SIZE.split(',').map(Number); win.setMinimumSize(320, 480); win.setSize(w, h); }
    win.webContents.on('console-message', (e, level, message) => log.push(e.message || message));
    if (process.env.HS_EVAL || process.env.HS_FX) {
      win.webContents.on('did-finish-load', () => win.webContents.executeJavaScript(
        `${process.env.HS_FX ? `fxLevel='${process.env.HS_FX}';applyFx();` : ''}${process.env.HS_EVAL || ''}`).catch((e) => log.push('eval: ' + e.message)));
    }
    setTimeout(async () => {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(process.env.HS_SNAPSHOT, img.toPNG());
      log.push('core: ' + JSON.stringify(core.status));
      fs.writeFileSync(process.env.HS_SNAPSHOT + '.log', log.join('\n'));
      app.quit();
    }, Number(process.env.HS_SNAPSHOT_DELAY || 9000));
  }
}

// One HYPERSPACE at a time: a second launch just brings the existing window forward.
// A self-relaunch (GPU switch) may start before the old instance has let go, so it retries briefly.
let gotLock = !!process.env.HS_SNAPSHOT || app.requestSingleInstanceLock();
// The HYPERSPACE holding the lock writes a heartbeat every 3 s. If it has gone quiet for 30 s it's frozen:
// end it and take over, drawing safely (a frozen HYPERSPACE has so far always been the graphics process).
function frozenHolder() {
  try {
    const h = JSON.parse(fs.readFileSync(heartFile, 'utf8'));
    if (!h.pid || h.pid === process.pid || Date.now() - h.t < 30000) return null;
    const out = require('child_process').execFileSync('tasklist', ['/FI', `PID eq ${h.pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000 }).toString();
    return /HYPERSPACE\.exe|electron\.exe/i.test(out) ? h.pid : null;
  } catch { return null; }
}
if (!gotLock) {
  const pid = frozenHolder();
  if (pid) {
    try { process.kill(pid); } catch {}
    rememberSafe('the last HYPERSPACE froze');
    if (!safeDrawing) { safeDrawing = true; app.disableHardwareAcceleration(); }
    if (!process.argv.includes('--relaunched')) process.argv.push('--relaunched'); // wait for it to let go of the lock
  }
}
const beat = () => fs.writeFile(heartFile, JSON.stringify({ pid: process.pid, t: Date.now() }), () => {});
if (gotLock && !process.env.HS_SNAPSHOT) { beat.started = true; beat(); setInterval(beat, 3000); }
async function ensureLock() {
  if (gotLock || !process.argv.includes('--relaunched')) return gotLock;
  for (let i = 0; i < 24 && !gotLock; i++) {
    await new Promise((r) => setTimeout(r, 250));
    gotLock = app.requestSingleInstanceLock();
  }
  return gotLock;
}
// Launching again (desktop icon, NitroSense key) summons the window: over whatever you're looking at, focused,
// with the startup animation played again. Windows won't let a background app jump in front on its own, so it
// goes "always on top" for a moment while it takes focus, then back to a normal window.
function summon(replay) {
  // the main window was closed while the side dock kept the app running: open a fresh one (it summons itself)
  if (!win || win.isDestroyed()) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.setAlwaysOnTop(true, 'screen-saver');
  win.show();
  win.moveTop();
  app.focus({ steal: true });
  win.focus();
  setTimeout(() => { if (win && !win.isDestroyed()) win.setAlwaysOnTop(false); }, 1200);
  if (replay) win.webContents.send('ev', 'summon', {});
}
// nsKey.action: 'summon' (default) | 'dock' | 'both'. The key agent starts a second HYPERSPACE; its trigger count tells us it was the Nitro key.
let lastKeyTriggers = 0;
app.on('second-instance', () => {
  const t = keyStatus().triggers || 0, fromKey = t > lastKeyTriggers; lastKeyTriggers = t;
  const act = nsCfg().action || 'summon';
  if (fromKey && act !== 'summon') { dock.toggle(); if (act === 'dock') return; }
  summon(true);
  setTimeout(() => dock.raise(), 1400);
});

if (app.isPackaged && ['remote-debugging-port', 'remote-debugging-pipe', 'inspect', 'inspect-brk', 'js-flags'].some((x) => app.commandLine.hasSwitch(x))) app.exit(1);
app.whenReady().then(async () => {
  if (!process.env.HS_SNAPSHOT) updater.start();
  if (!(await ensureLock())) { app.quit(); return; }
  if (!process.env.HS_SNAPSHOT && !beat.started) { beat.started = true; beat(); setInterval(beat, 3000); } // (took over a frozen one)
  if (safeDrawing && safeInfo) setTimeout(() => broadcast('toast', `SAFE DRAWING · ${safeInfo.reason.toUpperCase()} · THE GRAPHICS CARD COMES BACK BY ITSELF IN A FEW HOURS`), 6000);
  // no hidden default menu: its accelerators (Ctrl+W closes, Ctrl+R reloads) would steal the tab shortcuts
  Menu.setApplicationMenu(null);
  // NOTES locks itself when Windows locks or the laptop sleeps
  const { powerMonitor } = require('electron');
  powerMonitor.on('lock-screen', () => notes.lock('Windows locked'));
  powerMonitor.on('suspend', () => notes.lock('the laptop went to sleep'));
  notes.openNotes().then((ok) => ok && broadcast('notes-state', notesState())).catch(() => {});
  slowLoop();
  createWindow();
  core.start(process.env.HS_SNAPSHOT ? { elevate: false } : config.core);
  applyRemote();
  router.configure(config.router);
  tagger.configure(config.tagger);
  watchMusic();
  // background renderers wait until the launch burst (intro, core start) is over: less heat at startup
  if (config.spout?.enabled) { spout.error = null; broadcast('spout', { ...spoutStatus(), enabled: true }); }
  setTimeout(() => { spoutTick(); setInterval(spoutTick, 5000); }, process.env.HS_SNAPSHOT ? 0 : 8000);
  setTimeout(startWall, process.env.HS_SNAPSHOT ? 0 : 8000);
  if (nsCfg().enabled) applyKeyAgent(false);
  if (dock.cfg().enabled && (!process.env.HS_SNAPSHOT || process.env.HS_DOCKTEST)) {
    vpn.start();
    if (process.env.HS_SNAPSHOT) setTimeout(() => dock.apply(), 0);
    else {
      // wait for the intro to finish (body.booting gone), at most 12 s; no wait when the intro is off or lite
      const introOff = false; // intro 'off' / lite: body.booting never appears, so the poll below passes at once
      const t0 = Date.now(); let started = false;
      const go = () => { if (started) return; started = true; dock.apply(); };
      const poll = setInterval(async () => {
        if (started) return clearInterval(poll);
        let done = Date.now() - t0 > 12000 || introOff;
        try { if (!done && win && !win.isDestroyed()) done = await win.webContents.executeJavaScript("document.readyState==='complete' && !!document.body && !document.body.classList.contains('booting')"); } catch {}
        if (done) { clearInterval(poll); setTimeout(go, 600); }
      }, 500);
    }
  }
  try { if (!process.env.HS_SNAPSHOT) globalShortcut.register(config.dockHotkey || 'CommandOrControl+Alt+D', () => dock.toggle()); } catch {}
  // the key watcher can be ended from outside (an installer run from a script, Task Manager): bring it back
  if (!process.env.HS_SNAPSHOT) setInterval(() => { if (nsCfg().enabled && !keyStatus().running) applyKeyAgent(false); }, 60000);
  protocol.handle('hsmedia', async (req) => {
    // hsmedia://track/<id> · art/<id> · vjimg/<file> · asset/<file>
    const u = new URL(req.url);
    const id = decodeURIComponent(u.pathname.slice(1));
    const inDir = (dir) => { const p = path.join(dir, path.basename(id)); return fs.existsSync(p) ? p : null; };
    const file = u.host === 'track' ? lib.paths.get(id)
      : u.host === 'art' ? lib.art.get(id) || scArt(id)
        : u.host === 'vjimg' ? inDir(vjImgDir)
          : u.host === 'asset' ? inDir(path.join(ROOT, 'assets')) : null;
    if (!file) return new Response('not in the library', { status: 404 });
    try { return await serveFile(file, req.headers.get('range')); } catch (e) { return new Response(e.message, { status: 404 }); }
  });
  // Global hotkeys: Ctrl+Alt+Shift so they never steal common app shortcuts. Off in snapshot runs.
  if (!process.env.HS_SNAPSHOT) {
    globalShortcut.register('CommandOrControl+Alt+Shift+M', () => broadcast('hotkey', 'mic'));
    globalShortcut.register('CommandOrControl+Alt+Shift+C', () => broadcast('hotkey', 'cam'));
  }
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {
  quitting = true;
  saveThermal(true);
  router.stop();
  if (popWin && !popWin.isDestroyed()) popWin.destroy();
  core.stop(); // core restores fans to auto + clears GPU clock locks when the socket closes
  remote.stop();
  hw.stopHelper();
  app.quit();
});
if (!app.isPackaged && process.env.HS_SNAPSHOT && process.env.HS_CRATE2) { // dev check: MUSIC section tiles, Alt+1/2/3, coach strip, big play button (off-screen)
  setTimeout(async () => {
    const dir = process.env.HS_CRATE2, out = { errors: [] };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      let w; for (let k = 0; k < 60 && !w; k++) { w = BrowserWindow.getAllWindows().find((x) => /index\.html/.test(x.webContents.getURL())); if (!w) await wait(500); }
      w.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) out.errors.push(String(e.message).slice(0, 300)); });
      const js = (x) => w.webContents.executeJavaScript(x, true);
      const shot = async (n) => fs.writeFileSync(path.join(dir, `c2-${n}.png`), (await w.webContents.capturePage()).resize({ width: 900 }).toPNG());
      const alt = (k) => js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', altKey: true, bubbles: true }))`);
      await wait(2500); await js(`document.body.click()`); await wait(1500);
      out.nav = await js(`document.querySelector('.nav[data-view="crate"] span').textContent`);
      await js(`document.querySelector('.nav[data-view="crate"]').click()`); await wait(1500); await shot('1-lib');
      out.coach = await js(`!document.querySelector('#cr-coach').classList.contains('hidden')`);
      await alt('2'); await wait(800); out.dj = await js(`document.querySelector('#view-crate').dataset.section + ' ' + CRATE.C.mode`); await shot('2-dj');
      await alt('3'); await wait(800); out.vj = await js(`document.querySelector('#view-crate').dataset.section + ' ' + HS.inVJ()`); await shot('3-vj');
      await alt('1'); await wait(800); out.lib = await js(`document.querySelector('#view-crate').dataset.section + ' ' + CRATE.C.mode`);
      out.big = await js(`document.querySelector('#cr-playall').textContent`);
      await js(`document.querySelector('#cr-coach-x').click()`); out.coachGone = await js(`document.querySelector('#cr-coach').classList.contains('hidden') + ' ' + localStorage.getItem('hs-crate-coach')`);
    } catch (e) { out.error = e.stack; }
    fs.writeFileSync(path.join(dir, 'crate2.json'), JSON.stringify(out, null, 1));
    setTimeout(() => app.exit(0), 500);
  }, 8000);
}
