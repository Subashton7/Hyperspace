// GAMING HUB (main process): finds the games installed on this PC, launches them, notices when one is running,
// keeps playtime + session stats in gaming.json, and owns the two click-through overlay windows (stats + crosshair).
// Everything that watches or draws over the screen is OFF until the user switches it on in the GAMING page.
// Offline only: the only "network" thing is an OS ping to a host the user typed. No admin needed for anything here.
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const DEFAULTS = {
  track: false,            // watch for running games (playtime + sessions)
  auto: false,             // switch GAME MODE on by itself when a game starts
  pingOn: false, pingHost: '1.1.1.1',
  overlay: { on: false, corner: 'tl', scale: 1, opacity: 0.85, onlyInGame: false },
  crosshair: { on: false, style: 0, color: '#00ff6e', size: 24, opacity: 0.9, hotkey: false },
  mode: { ram: true, visuals: true, wallpaper: true, fan: 'b-boost', power: false, endTasks: false },
  timer: { min: 60, on: false },
};
const merge = (a, b) => {
  const o = { ...a };
  for (const k of Object.keys(b || {})) o[k] = a[k] && typeof a[k] === 'object' && !Array.isArray(a[k]) && b[k] && typeof b[k] === 'object' ? merge(a[k], b[k]) : b[k];
  return o;
};
const tick = () => new Promise((r) => setImmediate(r)); // let the app breathe between chunks of scanning
const norm = (n) => String(n || '').toLowerCase().replace(/\.exe$/, '');
// exe names that are never "the game" (installers, crash reporters, anti-cheat, runtimes, helpers)
const NOT_GAME = /^(unins|uninst|setup|install|vc_?redist|vcredist|dxsetup|dotnet|ndp|crash|unitycrash|ue4prereq|easyanticheat|eac|beservice|battleye|cef|helper|updater|update|redist|oalinst|directx|physx|notification_helper|launcher|config|settings|python|node|java|7z|ffmpeg|steamerrorreporter|webhelper|vulkan|dxwebsetup|cleanup|bootstrap|installer|prereq|sentry|report)/i;

module.exports = function createGaming(ctx) {
  const { app, shell, dialog, screen, BrowserWindow, globalShortcut, dataDir, getWin, broadcast, getPerf, getProcs, getTele } = ctx;
  const FILE = path.join(dataDir, 'gaming.json');
  const quiet = !!process.env.HS_SNAPSHOT; // test runs: overlays are created but never shown
  const say = (text) => { try { broadcast('gm-say', text); } catch {} };

  // ---------------- storage ----------------
  let store = { v: 1, custom: [], meta: {}, sessions: [], backlog: [], endList: [], endConfirmed: false, restore: null, exeCache: {}, settings: DEFAULTS, active: null };
  try { store = { ...store, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch {}
  store.settings = merge(DEFAULTS, store.settings || {});
  let saveT = null;
  const flush = () => { clearTimeout(saveT); saveT = null; try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(store)); } catch {} };
  const save = () => { if (!saveT) saveT = setTimeout(flush, 800); };

  // ---------------- scanning ----------------
  let games = [], scanning = false, scannedAt = 0, steamRoot = null;
  const reg = (args) => new Promise((res) => execFile('reg', ['query', ...args], { windowsHide: true, timeout: 6000 }, (e, out) => res(e ? '' : String(out))));
  const rd = (p) => fs.promises.readFile(p, 'utf8').catch(() => '');
  const ls = (p) => fs.promises.readdir(p, { withFileTypes: true }).catch(() => []);
  const st = (p) => fs.promises.stat(p).catch(() => null);
  const kv = (txt, key) => { const m = new RegExp(`"${key}"\\s+"([^"]*)"`, 'i').exec(txt); return m ? m[1] : ''; };

  // find the likely game exes in an install folder (top level + a couple of levels down, big files only)
  async function findExes(dir) {
    const out = [];
    const walk = async (d, depth) => {
      for (const e of (await ls(d)).slice(0, 80)) {
        const p = path.join(d, e.name);
        if (e.isFile() && /\.exe$/i.test(e.name) && !NOT_GAME.test(e.name)) { const s = await st(p); if (s && s.size >= 1.5e6) out.push({ name: e.name, size: s.size }); }
        else if (e.isDirectory() && depth < 3 && /^(bin|binaries|win64|win32|x64|x86|game|release|shipping|retail|[\w ]{1,30})$/i.test(e.name) && !/^(_?redist|__installer|directx|vcredist|engine|content|data|movies|logs|saves|mods|plugins|_commonredist|easyanticheat|crashreport)/i.test(e.name)) await walk(p, depth + 1);
      }
    };
    await walk(dir, 0);
    return out.sort((a, b) => b.size - a.size).slice(0, 5).map((x) => x.name);
  }

  async function scanSteam(list) {
    let root = null;
    const a = (await reg(['HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'])).match(/SteamPath\s+REG_SZ\s+(.+)/);
    const b = (await reg(['HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', '/v', 'InstallPath'])).match(/InstallPath\s+REG_SZ\s+(.+)/);
    for (const c of [a && a[1].trim(), b && b[1].trim(), 'C:\\Program Files (x86)\\Steam']) if (c && fs.existsSync(c)) { root = path.normalize(c); break; }
    steamRoot = root;
    if (!root) return;
    const libs = new Set([root]);
    const vdf = await rd(path.join(root, 'steamapps', 'libraryfolders.vdf'));
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/gi)) libs.add(path.normalize(m[1].replace(/\\\\/g, '\\')));
    // Steam's own playtime numbers (minutes) and last-played times, when its local config is readable
    const plays = {};
    for (const u of await ls(path.join(root, 'userdata'))) {
      if (!u.isDirectory()) continue;
      const cfg = await rd(path.join(root, 'userdata', u.name, 'config', 'localconfig.vdf'));
      const i = cfg.indexOf('"apps"');
      if (i < 0) continue;
      for (const m of cfg.slice(i).matchAll(/"(\d{2,9})"\s*\{([^{}]*)\}/g)) {
        const pt = +kv(m[2], 'Playtime') || 0, lp = +kv(m[2], 'LastPlayed') || 0;
        if (pt || lp) plays[m[1]] = { pt: Math.max(pt, plays[m[1]]?.pt || 0), lp: Math.max(lp, plays[m[1]]?.lp || 0) };
      }
    }
    for (const lib of libs) {
      const apps = path.join(lib, 'steamapps');
      for (const f of await ls(apps)) {
        const m = /^appmanifest_(\d+)\.acf$/i.exec(f.name);
        if (!m) continue;
        const t = await rd(path.join(apps, f.name));
        const name = kv(t, 'name'), dir = path.join(apps, 'common', kv(t, 'installdir'));
        if (!name || /^(steamworks common|steam linux runtime|proton|steamvr|steam controller|spacewar$)/i.test(name)) continue;
        if (+kv(t, 'StateFlags') && !(+kv(t, 'StateFlags') & 4)) continue; // 4 = fully installed
        list.push({ id: `steam:${m[1]}`, launcher: 'steam', appid: m[1], name, dir, size: +kv(t, 'SizeOnDisk') || 0,
          last: Math.max((+kv(t, 'LastPlayed') || 0) * 1000, (plays[m[1]]?.lp || 0) * 1000), steamMin: plays[m[1]]?.pt || 0,
          launch: { url: `steam://rungameid/${m[1]}` } });
      }
      await tick();
    }
  }
  async function scanEpic(list) {
    const dir = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
    for (const f of await ls(dir)) {
      if (!/\.item$/i.test(f.name)) continue;
      let j; try { j = JSON.parse(await rd(path.join(dir, f.name))); } catch { continue; }
      if (!j.DisplayName || !j.InstallLocation || j.bIsIncompleteInstall) continue;
      if (j.MainGameAppName && j.AppName && j.MainGameAppName !== j.AppName) continue; // DLC
      if (/^Unreal Engine/i.test(j.DisplayName)) continue;
      const ok = j.CatalogNamespace && j.CatalogItemId && j.AppName;
      list.push({ id: `epic:${j.AppName}`, launcher: 'epic', name: j.DisplayName, dir: j.InstallLocation, size: +j.InstallSize || 0, last: 0,
        exe: j.LaunchExecutable ? path.join(j.InstallLocation, j.LaunchExecutable) : '',
        launch: ok ? { url: `com.epicgames.launcher://apps/${encodeURIComponent(j.CatalogNamespace)}%3A${encodeURIComponent(j.CatalogItemId)}%3A${encodeURIComponent(j.AppName)}?action=launch&silent=true` } : { exe: path.join(j.InstallLocation, j.LaunchExecutable || '') } });
    }
  }
  async function scanGog(list) {
    const out = await reg(['HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games', '/s']);
    for (const blk of out.split(/\r?\n(?=HKEY_)/)) {
      const g = (k) => (new RegExp(`^\\s+${k}\\s+REG_\\w+\\s+(.*)$`, 'mi').exec(blk) || [])[1]?.trim() || '';
      const name = g('gameName'), dir = g('path'), exe = g('exe'), id = g('gameID');
      if (!name || !dir || !id) continue;
      list.push({ id: `gog:${id}`, launcher: 'gog', name, dir, size: 0, last: 0, exe, launch: { exe: exe || '', cwd: dir } });
    }
  }
  async function scanFolders(list, launcher, label, roots, skip = /^(launcher|installer|common|redist|tools?)$/i) {
    for (const root of roots) {
      for (const e of await ls(root)) {
        if (!e.isDirectory() || skip.test(e.name)) continue;
        const dir = path.join(root, e.name);
        list.push({ id: `${launcher}:${e.name.toLowerCase()}`, launcher, name: e.name, dir, size: 0, last: 0, launch: { dir } });
      }
      await tick();
    }
  }
  async function scanOthers(list) {
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files', pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const drives = 'CDEFGH'.split('').map((d) => `${d}:\\`).filter((d) => fs.existsSync(d));
    // Ubisoft Connect: registry lists every install folder
    const ub = await reg(['HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs', '/s']);
    for (const m of ub.matchAll(/InstallDir\s+REG_SZ\s+(.+)/g)) {
      const dir = path.normalize(m[1].trim());
      if (fs.existsSync(dir)) list.push({ id: `ubisoft:${path.basename(dir).toLowerCase()}`, launcher: 'ubisoft', name: path.basename(dir), dir, size: 0, last: 0, launch: { dir } });
    }
    await scanFolders(list, 'ea', 'EA', [path.join(pf, 'EA Games'), path.join(pf86, 'Origin Games'), path.join(pf, 'Electronic Arts'), path.join(pf86, 'EA Games')]);
    // Battle.net games are ordinary folders: look for the well-known ones
    const bn = ['World of Warcraft', 'Overwatch', 'Diablo III', 'Diablo IV', 'Hearthstone', 'StarCraft II', 'Call of Duty', 'Heroes of the Storm', 'Warcraft III'];
    for (const b of bn) for (const root of [pf86, pf]) if (fs.existsSync(path.join(root, b))) list.push({ id: `battlenet:${b.toLowerCase()}`, launcher: 'battlenet', name: b, dir: path.join(root, b), size: 0, last: 0, launch: { dir: path.join(root, b) } });
    // Xbox / Game Pass installs go in \XboxGames\<Game>\Content (when the folder can be read)
    for (const d of drives) {
      const xb = path.join(d, 'XboxGames');
      for (const e of await ls(xb)) {
        if (!e.isDirectory() || /^(GameSave|Gaming ?Services)/i.test(e.name)) continue;
        const dir = path.join(xb, e.name, 'Content');
        list.push({ id: `xbox:${e.name.toLowerCase()}`, launcher: 'xbox', name: e.name, dir: fs.existsSync(dir) ? dir : path.join(xb, e.name), size: 0, last: 0, launch: { dir } });
      }
    }
  }

  // an entry that only knows its folder gets its exe from the folder; everyone gets a list of process names
  async function finishGame(g) {
    const cache = store.exeCache[g.id];
    let exes = cache && cache.dir === g.dir ? cache.exes : null;
    if (!exes) {
      exes = g.exe ? [path.basename(g.exe)] : [];
      if (g.dir) { const f = await findExes(g.dir); exes = [...new Set([...exes, ...f])]; }
      store.exeCache[g.id] = { dir: g.dir, exes }; save();
    }
    g.exes = exes;
    if (g.launch && g.launch.dir && !g.launch.exe) g.launch = exes[0] ? { exe: path.join(g.dir, exes[0]), cwd: g.dir } : { dir: g.dir };
    if (g.launch && g.launch.exe && !path.isAbsolute(g.launch.exe) && g.dir) g.launch.exe = path.join(g.dir, g.launch.exe);
    if (!g.size && g.dir && g.launcher !== 'steam') g.size = 0;
  }

  async function scan() {
    if (scanning) return { started: false };
    scanning = true; broadcast('gm-scan', { done: false });
    (async () => {
      const list = [];
      try {
        for (const fn of [scanSteam, scanEpic, scanGog, scanOthers]) { try { await fn(list); } catch {} await tick(); }
        const seen = new Set();
        const uniq = list.filter((g) => !seen.has(g.id) && seen.add(g.id));
        for (const c of store.custom) uniq.push({ ...c, launcher: 'custom', size: c.size || 0, last: 0, launch: { exe: c.exe, cwd: path.dirname(c.exe) }, dir: path.dirname(c.exe), exes: [path.basename(c.exe)] });
        for (let i = 0; i < uniq.length; i++) { if (uniq[i].launcher !== 'custom') await finishGame(uniq[i]); if (i % 4 === 3) await tick(); }
        games = uniq; scannedAt = Date.now(); buildIndex();
      } catch {}
      scanning = false; broadcast('gm-scan', { done: true, count: games.length });
    })();
    return { started: true };
  }

  // ---------------- covers (Steam keeps them in appcache; everything else gets generated art in the page) ----------------
  const coverCache = new Map();
  async function cover(id) {
    if (coverCache.has(id)) return coverCache.get(id);
    let url = null;
    const g = games.find((x) => x.id === id);
    if (g && g.launcher === 'steam' && steamRoot) {
      const base = path.join(steamRoot, 'appcache', 'librarycache');
      const names = ['library_600x900.jpg', `${g.appid}_library_600x900.jpg`, 'header.jpg', `${g.appid}_header.jpg`, 'library_header.jpg'];
      const cands = names.map((n) => path.join(base, n.startsWith(g.appid) ? n : path.join(g.appid, n)));
      for (const d of await ls(path.join(base, g.appid))) if (d.isDirectory()) for (const n of names) cands.push(path.join(base, g.appid, d.name, n));
      for (const c of cands) {
        const s = await st(c);
        if (s && s.isFile() && s.size < 900000) { try { url = `data:image/jpeg;base64,${(await fs.promises.readFile(c)).toString('base64')}`; } catch {} if (url) break; }
      }
    }
    coverCache.set(id, url);
    return url;
  }

  // ---------------- launching ----------------
  const find = (id) => games.find((g) => g.id === String(id));
  function launch(id) {
    const g = find(id);
    if (!g) return { ok: false, error: 'game not found: scan again' };
    const l = g.launch || {};
    try {
      if (l.url) {
        if (!/^(steam:\/\/rungameid\/\d+|com\.epicgames\.launcher:\/\/apps\/[\w%.\-]+\?action=launch&silent=true)$/.test(l.url)) return { ok: false, error: 'blocked link' };
        shell.openExternal(l.url);
      } else if (l.exe && /\.exe$/i.test(l.exe) && fs.existsSync(l.exe)) {
        const c = spawn(l.exe, [], { cwd: l.cwd || path.dirname(l.exe), detached: true, stdio: 'ignore' });
        c.on('error', () => {}); c.unref();
      } else if (l.dir || g.dir) shell.openPath(l.dir || g.dir);
      else return { ok: false, error: 'nothing to launch' };
    } catch (e) { return { ok: false, error: e.message }; }
    store.meta[g.id] = { ...(store.meta[g.id] || {}), launched: Date.now() }; save();
    return { ok: true };
  }

  // ---------------- session tracking ----------------
  let timer = null, exeIndex = new Map(), misses = 0;
  const buildIndex = () => { exeIndex = new Map(); for (const g of games) for (const e of g.exes || []) { const k = norm(e); if (!exeIndex.has(k)) exeIndex.set(k, g.id); } };
  const avg = (s) => ({ ...s, series: undefined });
  function endSession(at) {
    const a = store.active;
    if (!a) return;
    store.active = null;
    const s = { id: a.id, game: a.game, name: a.name, start: a.start, end: Math.max(at || Date.now(), a.start), n: a.n, cpu: a.cpu, gpu: a.gpu, ct: a.ct, gt: a.gt, ctMax: a.ctMax, gtMax: a.gtMax, ctN: a.ctN, gtN: a.gtN, vramMax: a.vramMax, series: a.series, step: a.step };
    if (s.end - s.start < 60000) { save(); broadcast('gm-session', { state: 'end', short: true, game: a.game, name: a.name }); return; } // under a minute: not a session
    store.sessions.push(s);
    if (store.sessions.length > 3000) store.sessions.splice(0, store.sessions.length - 3000);
    for (const x of store.sessions.slice(0, -100)) if (x.series) delete x.series;
    save();
    broadcast('gm-session', { state: 'end', game: a.game, name: a.name, session: avg(s) });
    say(`${a.name} session over: ${Math.round((s.end - s.start) / 60000)} min`);
  }
  async function poll() {
    let procs;
    try { procs = (await getProcs()).list || []; } catch { return; }
    let hit = null;
    for (const p of procs) { const id = exeIndex.get(norm(p.name)); if (id) { hit = id; break; } }
    const now = Date.now();
    const a = store.active;
    if (hit) {
      misses = 0;
      if (a && a.game !== hit) endSession(a.last);
      if (!store.active) {
        const g = find(hit);
        store.active = { id: `s${now}`, game: hit, name: g ? g.name : hit, start: now, last: now, n: 0, cpu: 0, gpu: 0, ct: 0, gt: 0, ctMax: 0, gtMax: 0, ctN: 0, gtN: 0, vramMax: 0, series: [], step: 1, k: 0 };
        broadcast('gm-session', { state: 'start', game: hit, name: store.active.name, start: now, auto: !!store.settings.auto });
        say(`${store.active.name} is running. Have fun.`);
      }
      const s = store.active;
      const p = getPerf(), t = getTele() || {};
      s.last = now; s.n++; s.cpu += p.cpu || 0; s.gpu += p.gpu || 0;
      const ct = t.cpu?.temp ?? p.temps?.cpu, gt = t.gpuTemp ?? p.temps?.gpu;
      if (ct != null) { s.ct += ct; s.ctN++; s.ctMax = Math.max(s.ctMax, ct); }
      if (gt != null) { s.gt += gt; s.gtN++; s.gtMax = Math.max(s.gtMax, gt); }
      if (t.gpu?.memUsed) s.vramMax = Math.max(s.vramMax, t.gpu.memUsed);
      if (s.k++ % s.step === 0) { s.series.push([Math.round(ct ?? 0), Math.round(gt ?? 0), Math.round(p.cpu || 0), Math.round(p.gpu || 0)]); if (s.series.length > 240) { s.series = s.series.filter((_, i) => i % 2 === 0); s.step *= 2; } }
      save();
    } else if (a && ++misses >= 2) { misses = 0; endSession(a.last); }
  }
  function applyTracking() {
    clearInterval(timer); timer = null;
    if (!store.settings.track) { if (store.active) endSession(store.active.last); return; }
    buildIndex();
    timer = setInterval(poll, 15000);
    poll();
  }

  // ---------------- ping (only a host the user typed, only while they have it switched on) ----------------
  const ping = (host) => new Promise((res) => {
    host = String(host || '').trim();
    if (!/^[A-Za-z0-9.\-]{1,100}$/.test(host) || host.startsWith('-')) return res({ ok: false, error: 'not a valid host' });
    execFile('ping', ['-n', '1', '-w', '1500', host], { windowsHide: true, timeout: 4000 }, (e, out = '') => {
      const m = /[=<]\s*(\d+)\s*ms/i.exec(String(out));
      res(m ? { ok: true, ms: +m[1] } : { ok: false, error: 'no reply' });
    });
  });

  // ---------------- overlay windows (click-through, never take focus) ----------------
  let ovWin = null, ovT = null, chWin = null, chShown = false;
  const html = (body, js) => `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><meta charset=utf-8><style>html,body{margin:0;background:transparent;overflow:hidden;font:600 13px Consolas,monospace;color:#c8ffd8}</style>${body}<script>${js}</script>`)}`;
  function mkWin(w, h) {
    const d = screen.getPrimaryDisplay().bounds;
    const win = new BrowserWindow({ width: w, height: h, x: d.x, y: d.y, show: false, frame: false, transparent: true, resizable: false, movable: false, focusable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true, webPreferences: { sandbox: true, contextIsolation: true } });
    win.setAlwaysOnTop(true, 'screen-saver'); win.setIgnoreMouseEvents(true); win.setMenuBarVisibility(false);
    return win;
  }
  function placeOv() {
    if (!ovWin || ovWin.isDestroyed()) return;
    const o = store.settings.overlay, d = screen.getPrimaryDisplay().bounds, w = Math.round(230 * o.scale), h = Math.round(118 * o.scale), m = 14;
    ovWin.setBounds({ x: o.corner.includes('r') ? d.x + d.width - w - m : d.x + m, y: o.corner.includes('b') ? d.y + d.height - h - m : d.y + m, width: w, height: h });
    ovWin.webContents.executeJavaScript(`document.body.style.zoom=${o.scale};document.body.style.opacity=${o.opacity}`).catch(() => {});
  }
  function overlayData() {
    const p = getPerf(), t = getTele() || {};
    return { cpu: Math.round(p.cpu || 0), gpu: Math.round(p.gpu || 0), ct: t.cpu?.temp ?? p.temps?.cpu ?? null, gt: t.gpuTemp ?? p.temps?.gpu ?? null, cc: t.cpu?.clock ?? null, gc: t.gpu?.clock ?? null, ram: Math.round((p.mem.used / p.mem.total) * 100) };
  }
  function overlayWanted() { const o = store.settings.overlay; return o.on && (!o.onlyInGame || !!store.active); }
  function syncOverlay() {
    const want = overlayWanted();
    if (want && (!ovWin || ovWin.isDestroyed())) {
      ovWin = mkWin(230, 118);
      ovWin.loadURL(html('<div id=b style="padding:8px 10px;background:rgba(0,12,5,.72);border:1px solid rgba(0,255,110,.5);box-shadow:0 0 10px rgba(0,255,110,.3);line-height:1.5"></div>',
        `window.upd=(d)=>{const t=(v,u)=>v==null?'--':Math.round(v)+u;const c=(v)=>v>=85?'#ff5470':v>=75?'#ffc400':'#7dffa8';document.getElementById('b').innerHTML='<div style="color:#00ff6e;letter-spacing:2px;font-size:10px">HYPERSPACE</div>'+'<div>CPU <b style="color:'+c(d.ct)+'">'+t(d.ct,'C')+'</b> &nbsp;'+d.cpu+'% &nbsp;'+(d.cc?Math.round(d.cc)+'MHz':'')+'</div>'+'<div>GPU <b style="color:'+c(d.gt)+'">'+t(d.gt,'C')+'</b> &nbsp;'+d.gpu+'% &nbsp;'+(d.gc?Math.round(d.gc)+'MHz':'')+'</div>'+'<div>RAM '+d.ram+'%</div>'};upd({cpu:0,gpu:0,ram:0})`));
      ovWin.on('closed', () => { ovWin = null; });
      placeOv();
      if (!quiet) ovWin.showInactive();
      clearInterval(ovT);
      ovT = setInterval(() => { if (ovWin && !ovWin.isDestroyed()) ovWin.webContents.executeJavaScript(`upd(${JSON.stringify(overlayData())})`).catch(() => {}); }, 1000);
    } else if (!want && ovWin) {
      clearInterval(ovT); ovT = null;
      if (!ovWin.isDestroyed()) ovWin.destroy();
      ovWin = null;
    } else if (want) placeOv();
  }
  const CH_JS = `window.draw=(c)=>{const s=c.size,col=c.color,w=Math.max(2,Math.round(s/10)),m=s*2,h=m/2;let g='';const L=(a,b,x,y)=>'<rect x="'+a+'" y="'+b+'" width="'+x+'" height="'+y+'" fill="'+col+'"/>';
const k=[()=>'<circle cx="'+h+'" cy="'+h+'" r="'+w+'" fill="'+col+'"/>',
()=>L(h-s/2,h-w/2,s,w)+L(h-w/2,h-s/2,w,s),
()=>L(h-s,h-w/2,s*.7,w)+L(h+s*.3,h-w/2,s*.7,w)+L(h-w/2,h-s,w,s*.7)+L(h-w/2,h+s*.3,w,s*.7),
()=>L(h-s,h-1,s*2,2)+L(h-1,h-s,2,s*2),
()=>'<circle cx="'+h+'" cy="'+h+'" r="'+s*.7+'" fill="none" stroke="'+col+'" stroke-width="'+Math.max(2,w-1)+'"/>',
()=>'<circle cx="'+h+'" cy="'+h+'" r="'+s*.7+'" fill="none" stroke="'+col+'" stroke-width="'+Math.max(2,w-1)+'"/><circle cx="'+h+'" cy="'+h+'" r="'+w+'" fill="'+col+'"/>',
()=>L(h-s,h-w/2,s*2,w)+L(h-w/2,h,w,s),
()=>'<path d="M'+(h-s*.7)+','+(h-s*.7)+'L'+(h+s*.7)+','+(h+s*.7)+'M'+(h+s*.7)+','+(h-s*.7)+'L'+(h-s*.7)+','+(h+s*.7)+'" stroke="'+col+'" stroke-width="'+w+'"/>'];
document.getElementById('o').innerHTML='<svg width="'+m+'" height="'+m+'" style="opacity:'+c.opacity+';filter:drop-shadow(0 0 1px #000) drop-shadow(0 0 1px #000)">'+k[c.style%8]()+'</svg>'};`;
  function drawCh() {
    if (!chWin || chWin.isDestroyed()) return;
    const c = store.settings.crosshair, d = screen.getPrimaryDisplay().bounds, m = Math.round(c.size * 2) + 4;
    chWin.setBounds({ x: d.x + Math.round((d.width - m) / 2), y: d.y + Math.round((d.height - m) / 2), width: m, height: m });
    chWin.webContents.executeJavaScript(`draw(${JSON.stringify({ size: c.size, color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#00ff6e', opacity: c.opacity, style: c.style | 0 })})`).catch(() => {});
  }
  function syncCrosshair() {
    const c = store.settings.crosshair;
    if (c.hotkey) {
      if (!globalShortcut.isRegistered('CommandOrControl+Alt+X') && !quiet) { try { globalShortcut.register('CommandOrControl+Alt+X', () => { store.settings.crosshair.on = !store.settings.crosshair.on; save(); syncCrosshair(); broadcast('gm-settings', store.settings); }); } catch {} }
    } else { try { globalShortcut.unregister('CommandOrControl+Alt+X'); } catch {} }
    if (c.on && (!chWin || chWin.isDestroyed())) {
      const m = Math.round(c.size * 2) + 4;
      chWin = mkWin(m, m);
      chWin.loadURL(html('<div id=o></div>', CH_JS));
      chWin.webContents.once('did-finish-load', () => { drawCh(); if (!quiet && chWin && !chWin.isDestroyed()) chWin.showInactive(); });
      chWin.on('closed', () => { chWin = null; });
    } else if (!c.on && chWin) { if (!chWin.isDestroyed()) chWin.destroy(); chWin = null; } else if (c.on) drawCh();
  }

  // ---------------- folders + settings links ----------------
  const folders = () => {
    const home = app.getPath('home'), vids = app.getPath('videos'), pics = app.getPath('pictures');
    const out = [
      { key: 'xbox', label: 'XBOX / GAME BAR CAPTURES', path: path.join(vids, 'Captures') },
      { key: 'shot', label: 'WINDOWS SCREENSHOTS', path: path.join(pics, 'Screenshots') },
      { key: 'nvidia', label: 'NVIDIA SHADOWPLAY CLIPS', path: path.join(vids, 'NVIDIA') },
      { key: 'obs', label: 'VIDEOS', path: vids },
    ];
    if (steamRoot) out.splice(1, 0, { key: 'steam', label: 'STEAM SCREENSHOTS', path: path.join(steamRoot, 'userdata') });
    void home;
    return out.map((f) => ({ ...f, exists: fs.existsSync(f.path) }));
  };
  const URIS = new Set(['ms-settings:gaming-gamemode', 'ms-settings:gaming-gamebar', 'ms-settings:gaming-captures', 'ms-settings:display-advancedgraphics', 'ms-settings:display', 'ms-settings:powersleep', 'ms-settings:sound', 'ms-settings:easeofaccess-controller']);

  // ---------------- api (names are prefixed gm; merged into main.js's api map) ----------------
  const SET_KEYS = ['settings', 'endList', 'endConfirmed', 'backlog', 'restore'];
  const api = {
    gmGet: () => ({ ...store, sessions: store.sessions.map(avg), exeCache: undefined, games, scanning, scannedAt, active: store.active && { ...store.active, series: undefined } }),
    gmScan: () => scan(),
    gmCover: (id) => cover(String(id)),
    gmLaunch: (id) => launch(id),
    gmOpenDir: (id) => { const g = find(id); if (g?.dir && fs.existsSync(g.dir)) { shell.openPath(g.dir); return true; } return false; },
    gmSession: (id) => store.sessions.find((s) => s.id === String(id))?.series || null,
    gmAdd: async () => {
      const w = getWin();
      const r = await dialog.showOpenDialog(w, { title: 'Choose a game (.exe or shortcut)', properties: ['openFile'], filters: [{ name: 'Games and shortcuts', extensions: ['exe', 'lnk'] }] });
      if (r.canceled || !r.filePaths[0]) return null;
      let exe = r.filePaths[0], name = path.basename(exe).replace(/\.(exe|lnk)$/i, '');
      if (/\.lnk$/i.test(exe)) { try { exe = shell.readShortcutLink(exe).target || exe; } catch {} }
      if (!/\.exe$/i.test(exe)) return { error: 'That shortcut does not point to a program (.exe).' };
      const id = `custom:${Buffer.from(exe.toLowerCase()).toString('hex').slice(-24)}`;
      if (!store.custom.some((c) => c.id === id)) store.custom.push({ id, name, exe });
      save(); await scan();
      return { id, name };
    },
    gmRemove: (id) => { store.custom = store.custom.filter((c) => c.id !== String(id)); games = games.filter((g) => g.id !== String(id)); save(); return true; },
    gmMeta: (id, patch = {}) => {
      id = String(id);
      const m = { ...(store.meta[id] || {}) };
      if ('fav' in patch) m.fav = !!patch.fav;
      if ('hidden' in patch) m.hidden = !!patch.hidden;
      if ('tags' in patch) m.tags = (Array.isArray(patch.tags) ? patch.tags : []).map((t) => String(t).slice(0, 24)).slice(0, 10);
      if ('note' in patch) m.note = String(patch.note || '').slice(0, 500);
      if ('mode' in patch) m.mode = ['global', 'off', 'light', 'max'].includes(patch.mode) ? patch.mode : 'global';
      if ('rename' in patch) m.rename = String(patch.rename || '').slice(0, 80);
      store.meta[id] = m; save(); return m;
    },
    gmSet: (patch = {}) => {
      for (const k of SET_KEYS) {
        if (!(k in patch)) continue;
        if (k === 'settings') { store.settings = merge(store.settings, patch.settings); applyTracking(); syncOverlay(); syncCrosshair(); }
        else if (k === 'backlog') store.backlog = (Array.isArray(patch.backlog) ? patch.backlog : []).slice(0, 500);
        else if (k === 'endList') store.endList = (Array.isArray(patch.endList) ? patch.endList : []).map((x) => String(x).slice(0, 80)).slice(0, 40);
        else if (k === 'endConfirmed') store.endConfirmed = !!patch.endConfirmed;
        else if (k === 'restore') store.restore = patch.restore && typeof patch.restore === 'object' ? patch.restore : null;
      }
      save(); return { settings: store.settings, endList: store.endList, endConfirmed: store.endConfirmed };
    },
    gmPing: (host) => ping(host),
    gmFolders: () => folders(),
    gmOpenFolder: (key) => { const f = folders().find((x) => x.key === key); if (f && f.exists) { shell.openPath(f.path); return true; } return false; },
    gmOpenUri: (uri) => { if (!URIS.has(String(uri))) return false; shell.openExternal(String(uri)); return true; },
    gmStatus: () => ({ overlay: !!(ovWin && !ovWin.isDestroyed()), crosshair: !!(chWin && !chWin.isDestroyed()), tracking: !!timer }),
    gmTest: () => ({ games: games.length, index: exeIndex.size, steamRoot }), // dev check
  };

  // ---------------- start / stop ----------------
  function start() {
    // a session left open by a crash or a power cut is closed at the last moment it was seen
    if (store.active) endSession(store.active.last);
    scan().then(() => {
      const wait = setInterval(() => { if (!scanning) { clearInterval(wait); buildIndex(); applyTracking(); } }, 500);
    });
    syncOverlay(); syncCrosshair();
  }
  function stop() {
    clearInterval(timer); clearInterval(ovT);
    if (store.active) endSession(Date.now());
    try { if (ovWin && !ovWin.isDestroyed()) ovWin.destroy(); if (chWin && !chWin.isDestroyed()) chWin.destroy(); } catch {}
    try { globalShortcut.unregister('CommandOrControl+Alt+X'); } catch {}
    flush();
  }
  // the exe index must follow scans that finish later (ADD GAME, RESCAN)
  const oldScan = scan;
  void oldScan;
  app.on('will-quit', stop);
  setInterval(() => { if (!scanning && timer) buildIndex(); }, 60000);
  // overlays that appear only while a game runs follow the session
  setInterval(() => { if (store.settings.overlay.on && store.settings.overlay.onlyInGame) syncOverlay(); }, 5000);
  return { api, start, stop };
};
