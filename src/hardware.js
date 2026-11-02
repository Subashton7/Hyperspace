// Mic / camera control.
// Two layers:
//   1. Windows privacy switch (HKCU ConsentStore) - per-user, no admin. Blocks every app from opening the device.
//   2. Extra layer: mic endpoint mute (Core Audio), camera hard kill (disable PnP device, needs UAC).
const { execFile, spawn } = require('child_process');
const path = require('path');

const CONSENT = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore';
const KIND_KEY = { mic: 'microphone', cam: 'webcam' };

function reg(args) {
  return new Promise((resolve) => {
    execFile('reg.exe', args, { windowsHide: true }, (err, stdout) => resolve(err ? '' : stdout));
  });
}

// ---------- persistent PowerShell helper ----------
let ps = null;
let seq = 0;
const pending = new Map();
let buf = '';

function startHelper() {
  // packaged builds keep hw.ps1 outside the asar archive so PowerShell can read it
  const script = path.join(__dirname, 'hw.ps1').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], {
    windowsHide: true,
  });
  ps.stdout.setEncoding('utf8');
  ps.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      const bar = line.indexOf('|');
      if (bar < 0) continue;
      const id = line.slice(0, bar);
      const p = pending.get(id);
      if (!p) continue;
      pending.delete(id);
      try { p(JSON.parse(line.slice(bar + 1))); } catch { p({ ok: false, error: 'bad json' }); }
    }
  });
  const started = Date.now();
  ps.on('exit', () => {
    for (const p of pending.values()) p({ ok: false, error: 'helper exited' });
    pending.clear();
    ps = null;
    // dying within seconds means PowerShell is locked down on this PC (school/work policy, or a security tool):
    // wait before trying again, longer each time, instead of starting a new PowerShell on every call
    if (Date.now() - started < 10000) { crashes++; retryAt = Date.now() + Math.min(10 * 60e3, 5000 * 2 ** crashes); } else crashes = 0;
  });
}
let crashes = 0, retryAt = 0;

function helper(cmd, arg = '') {
  if (!ps && Date.now() < retryAt) return Promise.resolve({ ok: false, error: 'PowerShell helper unavailable on this PC' });
  if (!ps) startHelper();
  return new Promise((resolve) => {
    const id = String(++seq);
    const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: 'timeout' }); }, 15000);
    pending.set(id, (r) => { clearTimeout(timer); resolve(r); });
    ps.stdin.write(`${id} ${cmd} ${arg}\n`);
  });
}

function stopHelper() {
  if (ps) { try { ps.kill(); } catch {} }
}

// ---------- privacy switch ----------
async function getPrivacy(kind) {
  const out = await reg(['query', `${CONSENT}\\${KIND_KEY[kind]}`, '/v', 'Value']);
  const m = out.match(/Value\s+REG_SZ\s+(\w+)/);
  return m ? m[1] === 'Allow' : true;
}

async function setPrivacy(kind, allow) {
  await reg(['add', `${CONSENT}\\${KIND_KEY[kind]}`, '/v', 'Value', '/t', 'REG_SZ', '/d', allow ? 'Allow' : 'Deny', '/f']);
  return getPrivacy(kind);
}

// Apps that touched the device. LastUsedTimeStop == 0 means it is in use right now.
// Fallback for when HyperCore isn't running: one reg.exe per call (the core reads the same keys in-process).
async function getUsage(kind) {
  const out = await reg(['query', `${CONSENT}\\${KIND_KEY[kind]}`, '/s']);
  const apps = [];
  let cur = null;
  for (const raw of out.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('HKEY_')) {
      const name = line.split('\\').pop();
      cur = { key: name, start: 0, stop: null };
      apps.push(cur);
      continue;
    }
    const m = line.match(/^(LastUsedTimeStart|LastUsedTimeStop)\s+REG_QWORD\s+0x([0-9a-f]+)/i);
    if (m && cur) cur[m[1] === 'LastUsedTimeStart' ? 'start' : 'stop'] = BigInt('0x' + m[2]);
  }
  // FILETIME (100ns since 1601) -> unix ms
  const toMs = (ft) => (ft ? Number(ft / 10000n - 11644473600000n) : 0);
  return niceApps(kind, apps.map((a) => ({ key: a.key, start: toMs(a.start), stop: a.stop == null ? null : toMs(a.stop) })));
}
// [{ key, start, stop }] (unix ms; start 0 = never used; stop 0 = in use right now, null = not recorded)
// -> the 12 most recent, in use first
function niceApps(kind, apps) {
  return apps
    .filter((a) => a.start && a.key !== 'NonPackaged' && a.key !== KIND_KEY[kind])
    .map((a) => {
      const desktop = a.key.includes('#');
      const nice = desktop ? a.key.split('#').pop().replace(/\.exe$/i, '') : a.key.split('_')[0].split('.').pop();
      return { name: nice, path: a.key.replace(/#/g, '\\'), active: a.stop === 0, lastUsed: a.stop || a.start };
    })
    .sort((x, y) => (y.active - x.active) || (y.lastUsed - x.lastUsed))
    .slice(0, 12);
}

// ---------- device-level layer ----------
async function getMicMute() {
  const r = await helper('mute-get');
  return r.ok ? { muted: r.muted, level: r.level } : { muted: null, level: null };
}

async function setMicMute(muted) {
  return helper('mute-set', muted ? '1' : '0');
}

// Get-PnpDevice is slow, so the device list is cached and only re-read every 30s or after a change.
let camCache = null, camCacheAt = 0;
async function getCams(fresh = false) {
  if (!fresh && camCache && Date.now() - camCacheAt < 30000) return camCache;
  const r = await helper('cams');
  if (!r.ok) return camCache || [];
  camCache = !r.cams ? [] : Array.isArray(r.cams) ? r.cams : [r.cams];
  camCacheAt = Date.now();
  return camCache;
}

// Optional: an already-elevated helper that can do it without a prompt (returns null if unavailable).
let elevatedCamHook = null;
function setElevatedCamHook(fn) { elevatedCamHook = fn; }

// Enable/disable the PnP camera devices: through the elevated core if it's running, else via a UAC prompt.
async function setCamHardware(enable, ids) {
  if (!ids.length) return false;
  if (elevatedCamHook) {
    try { const r = await elevatedCamHook(enable, ids); if (r != null) return r; } catch {}
  }
  const verb = enable ? 'Enable-PnpDevice' : 'Disable-PnpDevice';
  const inner = ids.map((id) => `${verb} -InstanceId '${id.replace(/'/g, "''")}' -Confirm:$false`).join('; ');
  const outer = `Start-Process powershell -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList '-NoProfile','-Command',"${inner.replace(/"/g, '`"')}"`;
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-Command', outer], { windowsHide: true }, (err) => resolve(!err));
  });
}

// ---------- through HyperCore (in-process registry + audio + WMI reads: no reg.exe, no PowerShell) ----------
// The old reg.exe / PowerShell path stays as the fallback for when the core isn't running.
let core = null;
function setCore(c) { core = c; }
// Only when the core runs as you: on a standard account the admin prompt starts it as the admin account, and its
// HKCU (where the mic / camera switch lives) would be the admin's, not yours.
const viaCore = () => !!core?.online && (!core.status.user || core.status.user.toLowerCase() === require('os').userInfo().username.toLowerCase());

// the core's privacy.get answer (also pushed as a `privacy` event when Windows' consent keys change) -> state
function fromCore(p) {
  const micAllow = p.mic.allow, camAllow = p.cam.allow, mute = p.mic.mute || {}, cams = p.cam.devices || [];
  return {
    mic: { on: micAllow && mute.muted !== true, privacyAllow: micAllow, muted: mute.muted ?? null, level: mute.level ?? null, apps: niceApps('mic', p.mic.apps || []) },
    cam: { on: camAllow && !cams.some((c) => c.status !== 'OK'), privacyAllow: camAllow, devices: cams, apps: niceApps('cam', p.cam.apps || []) },
  };
}

async function getState(freshCams = false) {
  if (viaCore()) {
    try { return fromCore(await core.call('privacy.get', { freshCams })); } catch {}
  }
  const [micAllow, camAllow, micUse, camUse, mute, cams] = await Promise.all([
    getPrivacy('mic'), getPrivacy('cam'), getUsage('mic'), getUsage('cam'), getMicMute(), getCams(freshCams),
  ]);
  return {
    mic: { on: micAllow && mute.muted !== true, privacyAllow: micAllow, muted: mute.muted, level: mute.level, apps: micUse },
    cam: { on: camAllow && !cams.some((c) => c.status !== 'OK'), privacyAllow: camAllow, devices: cams, apps: camUse },
  };
}

async function setMic(on) {
  if (viaCore()) {
    try {
      await core.call('privacy.set', { kind: 'mic', allow: on });
      await core.call('mic.mute', { muted: !on });
      return getState();
    } catch {}
  }
  await setPrivacy('mic', on);
  await setMicMute(!on);
  return getState();
}

async function setCam(on, hard) {
  if (viaCore()) { try { await core.call('privacy.set', { kind: 'cam', allow: on }); } catch { await setPrivacy('cam', on); } }
  else await setPrivacy('cam', on);
  if (hard || on) {
    const cams = viaCore() ? (await getState(true)).cam.devices : await getCams(true);
    // Only touch hardware when needed: hard-kill on request, re-enable anything that was hard-killed.
    const targets = on ? cams.filter((c) => c.status !== 'OK') : cams;
    if (targets.length) {
      await setCamHardware(on, targets.map((c) => c.id));
      return getState(true); // re-read the devices after the change
    }
  }
  return getState();
}

module.exports = { getState, setMic, setCam, helper, stopHelper, setElevatedCamHook, setCore, fromCore, viaCore };
