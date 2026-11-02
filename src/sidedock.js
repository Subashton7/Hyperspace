// SIDE DOCK: a slim panel of modules you pick and order (VPN, temps, CPU, GPU, RAM, fans, network, now
// playing, mic / cam, battery, drives…), over every app. Grab its title bar and drop it where you want it:
//   on a screen edge   it locks to that edge of that screen (full height)
//   on any app window  it locks into the corner you dropped it in (HYPERSPACE included) and rides along when
//                        that window moves, hides when it's minimised, and comes up in front with it
//   anywhere else      it floats right there
// Modes, wherever it is: always (stays out) or auto (slides away when the mouse leaves: a glowing line on an
// edge, a small ◬ tab on a window or floating; touch it and it slides back out).
// ⇅ swaps layers: pinned, it sits over everything; unpinned, other windows can cover it (an attached dock is
// unpinned until you pin it). It can hide itself while a game or video fills the screen it's on.
const { BrowserWindow, screen } = require('electron');
const path = require('path');

const MODULES = ['clock', 'vpn', 'temps', 'thermals', 'cpu', 'gpu', 'ram', 'fans', 'net', 'disk', 'drives', 'apps', 'media', 'crate', 'volume', 'shield', 'battery', 'uptime'];
const DEFAULTS = {
  enabled: false, mode: 'auto', width: 230, opacity: 0.94, hideFullscreen: true, floatH: 560,
  snap: false, // dropped = stays exactly there; true = snaps to screen edges and window corners
  place: { type: 'edge', display: 0, edge: 'right' }, pin: null, // pin null = the default for the place
  modules: ['clock', 'temps', 'cpu', 'gpu', 'ram', 'net', 'media', 'shield'], // VPN card: add it in Settings → SIDE DOCK
};
const dbg = (...a) => { if (process.env.HS_DOCKLOG) try { require('fs').appendFileSync(process.env.HS_DOCKLOG, `${new Date().toISOString().slice(11, 23)} ${a.join(' ')}\n`); } catch {} };
const SNAP = 70; // px from a screen edge that counts as "on the edge"
const TOP_BAR = 40; // stay under the title bar of a window we sit on

class SideDock {
  constructor({ root, getConfig, setConfig, core, mainWin }) {
    Object.assign(this, { root, getConfig, setConfig, core, mainWin });
    this.win = null;
    this.open = false;
    this.covered = false;
    this.watching = false;
    this.drag = null;
    this.host = null; // the window we're attached to: { rect (DIP), fg, minimized }
  }

  // ---------------- config ----------------
  cfg() {
    const c = { ...DEFAULTS, ...(this.getConfig() || {}) };
    if (!c.place) c.place = DEFAULTS.place;
    // settings saved before the dock could be dragged
    if (c.edge && c.place.type === 'edge' && !this.getConfig()?.place) c.place = { type: 'edge', display: c.display || 0, edge: c.edge };
    return c;
  }
  pinned() { const c = this.cfg(); return c.pin != null ? c.pin : c.place.type !== 'window'; }
  status() {
    const c = this.cfg();
    return { ...c, pinned: this.pinned(), all: MODULES, running: !!this.win, where: this.describe(c.place),
      displays: screen.getAllDisplays().map((d, i) => ({ i, label: `${i + 1}: ${d.size.width}×${d.size.height}${d.internal ? ' (laptop)' : ''}` })) };
  }
  describe(p) {
    if (!p) return '';
    if (p.type === 'edge') return `${p.edge.toUpperCase()} EDGE · SCREEN ${p.display + 1}`;
    if (p.type === 'window') return `${p.hs ? 'HYPERSPACE' : (p.exe || 'window').toUpperCase()} · ${{ tl: 'TOP LEFT', tr: 'TOP RIGHT', bl: 'BOTTOM LEFT', br: 'BOTTOM RIGHT' }[p.corner]}`;
    return 'FLOATING';
  }
  set(patch) {
    const c = { ...this.cfg(), ...(patch || {}) };
    c.modules = (c.modules || []).filter((m) => MODULES.includes(m));
    c.width = Math.max(160, Math.min(420, Math.round(c.width)));
    c.floatH = Math.max(240, Math.min(1400, Math.round(c.floatH)));
    // the old edge / display settings still work from Settings
    if (patch && ('edge' in patch || 'display' in patch)) c.place = { type: 'edge', display: patch.display ?? (c.place.type === 'edge' ? c.place.display : 0), edge: patch.edge ?? (c.place.type === 'edge' ? c.place.edge : 'right') };
    delete c.edge; delete c.display;
    this.setConfig(c);
    this.apply();
    return this.status();
  }
  push() { if (this.win && !this.win.isDestroyed()) this.win.webContents.send('ev', 'dock-config', this.status()); }

  // ---------------- window ----------------
  apply() {
    const c = this.cfg();
    if (!c.enabled) { this.stop(); return; }
    if (!this.win || this.win.isDestroyed()) this.start();
    else { this.place(); this.push(); }
  }

  watchScreens() {
    if (this.watching) return;
    this.watching = true;
    for (const ev of ['display-metrics-changed', 'display-added', 'display-removed']) screen.on(ev, () => this.place());
  }

  start() {
    this.watchScreens();
    this.win = new BrowserWindow({
      frame: false, transparent: true, resizable: false, minimizable: false, maximizable: false,
      skipTaskbar: true, focusable: false, hasShadow: false, show: false, backgroundColor: '#00000000', title: 'HYPERSPACE DOCK',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    });
    this.win.hsDock = true;
    this.win.loadFile(path.join(this.root, 'renderer', 'sidedock.html'));
    // attached to a window: follow() shows it once it has found that window
    this.win.once('ready-to-show', () => { if (this.cfg().place.type !== 'window') { this.place(); this.win.showInactive(); } });
    this.win.on('closed', () => { this.win = null; });
    this.open = false;
    clearInterval(this.fsTimer); clearInterval(this.followTimer);
    this.fsTimer = setInterval(() => this.checkFullscreen(), 2500);
    this.followTimer = setInterval(() => { this.follow(); this.hover(); }, 120);
  }

  stop() {
    clearInterval(this.fsTimer); clearInterval(this.followTimer);
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }

  hwnd(w) { try { return Number(w.getNativeWindowHandle().readBigUInt64LE(0)); } catch { return 0; } }
  displayAt(p) { return screen.getDisplayNearestPoint(p); }

  // where the dock goes for its place
  bounds() {
    const c = this.cfg(), p = c.place;
    if (p.type === 'edge') {
      const d = screen.getAllDisplays()[p.display] || screen.getPrimaryDisplay(), wa = d.workArea;
      return { x: p.edge === 'left' ? wa.x : wa.x + wa.width - c.width, y: wa.y, width: c.width, height: wa.height };
    }
    if (p.type === 'window' && this.host?.rect) {
      const r = this.host.rect, m = 6;
      const h = Math.max(200, Math.min(c.floatH, r.height - TOP_BAR - m));
      const x = p.corner.endsWith('r') ? r.x + r.width - c.width - m : r.x + m;
      const y = p.corner.startsWith('t') ? r.y + TOP_BAR : r.y + r.height - h - m;
      return { x: Math.round(x), y: Math.round(y), width: c.width, height: Math.round(h) };
    }
    // a float spot without coordinates (an old or hand-edited setting) would crash getDisplayNearestPoint: use where it is now
    const fx = p.type === 'float' && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : this.win?.getBounds() || { x: 100, y: 100 };
    const wa = this.displayAt({ x: fx.x, y: fx.y }).workArea;
    const h = Math.min(c.floatH, wa.height);
    return { x: Math.max(wa.x, Math.min(Math.round(fx.x), wa.x + wa.width - c.width)), y: Math.max(wa.y, Math.min(Math.round(fx.y), wa.y + wa.height - h)), width: c.width, height: h };
  }

  place() {
    if (!this.win || this.win.isDestroyed() || this.drag) return;
    const c = this.cfg();
    if (c.place.type === 'window' && !this.host) return; // follow() places it once it has found the window
    this.win.setBounds(this.bounds());
    this.layer();
    this.mouse(this.open);
    this.push();
  }

  // slide away when the mouse leaves: on an edge it shrinks to a glowing line, on a window or floating to a
  // small ◬ tab. Watched from here (the cursor, every 120 ms) because a click-through window can't count on
  // its own page seeing the mouse leave.
  autoHide() { return this.cfg().mode === 'auto'; }
  setOpen(v) {
    if (this.open === v) return;
    dbg('setOpen', v);
    this.mouse(v);
    this.leftAt = 0;
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('ev', 'dock-open', v);
  }
  hover() {
    if (!this.win || this.win.isDestroyed() || this.drag || !this.win.isVisible() || !this.autoHide()) return;
    const cur = screen.getCursorScreenPoint(), b = this.win.getBounds(), p = this.cfg().place;
    // a couple of pixels of slack: the cursor parked on the very edge still counts as on the dock
    const inside = cur.x >= b.x - 2 && cur.x <= b.x + b.width + 2 && cur.y >= b.y - 2 && cur.y <= b.y + b.height + 2;
    if (this.open) {
      if (inside) { this.leftAt = 0; return; }
      if (!this.leftAt) { this.leftAt = Date.now(); dbg('left', JSON.stringify(cur), JSON.stringify(b)); }
      else if (Date.now() - this.leftAt > 500) this.setOpen(false);
      return;
    }
    const right = p.type === 'edge' ? p.edge === 'right' : !(p.type === 'window' && p.corner?.endsWith('l'));
    const w = p.type === 'edge' ? 6 : 26, h = p.type === 'edge' ? b.height : 64;
    const hx = right ? b.x + b.width - w : b.x;
    if (cur.x >= hx - 2 && cur.x <= hx + w + 2 && cur.y >= b.y - 2 && cur.y <= b.y + h + 2) this.setOpen(true);
  }

  // pinned = above everything; unpinned = an ordinary window (an attached dock comes up with its window)
  // On a window (HYPERSPACE or any app): on top while that window is the one in use, so clicking it can't
  // bury the dock; when you switch to something else it steps back with its window.
  layer() {
    if (!this.win || this.win.isDestroyed()) return;
    const c = this.cfg(), p = c.place;
    const top = this.pinned() || !!this.drag || (p.type === 'edge' && c.mode === 'auto') || (p.type === 'window' && !!this.host?.fg);
    if (top !== this.isTop) { this.win.setAlwaysOnTop(top, 'screen-saver'); this.isTop = top; dbg('top', top); }
    if (top) this.win.moveTop();
  }
  toggleLayer() {
    this.setConfig({ ...this.cfg(), pin: !this.pinned() });
    this.layer();
    if (this.pinned()) this.win?.moveTop();
    this.push();
    return this.status();
  }

  // while slid away, clicks fall through to whatever is under the dock
  mouse(open) {
    this.open = !!open;
    if (!this.win || this.win.isDestroyed()) return;
    const solid = !this.autoHide() || this.open || !!this.drag;
    dbg('mouse solid=', solid);
    this.win.setIgnoreMouseEvents(!solid, { forward: true });
  }

  // ---------------- drag + snap ----------------
  dragStart() {
    dbg('dragStart', JSON.stringify(screen.getCursorScreenPoint()), JSON.stringify(this.win?.getBounds()));
    if (!this.win || this.win.isDestroyed()) return;
    const cur = screen.getCursorScreenPoint(), b = this.win.getBounds(), c = this.cfg();
    // a compact card while moving
    const h = Math.min(c.floatH, 420);
    const off = { x: Math.min(cur.x - b.x, c.width - 20), y: Math.min(cur.y - b.y, 30) };
    this.drag = { off, target: null, busy: false };
    this.win.setIgnoreMouseEvents(false);
    this.layer(); // free of HYPERSPACE and on top of everything while it moves
    this.win.setBounds({ x: cur.x - off.x, y: cur.y - off.y, width: c.width, height: h });
    this.dragTimer = setInterval(() => this.dragMove(), 16);
    this.win.webContents.send('ev', 'dock-drag', { on: true });
  }
  dragMove() {
    if (!this.drag || !this.win || this.win.isDestroyed()) return this.dragEnd();
    const cur = screen.getCursorScreenPoint();
    const b = this.win.getBounds();
    const x = cur.x - this.drag.off.x, y = cur.y - this.drag.off.y;
    if (x !== b.x || y !== b.y) this.win.setPosition(x, y);
    if (this.drag.busy || Date.now() - (this.drag.at || 0) < 110) return;
    this.drag.at = Date.now();
    this.drag.busy = true;
    this.targetAt(cur).then((t) => {
      if (!this.drag) return;
      this.drag.target = t;
      this.win.webContents.send('ev', 'dock-drag', { on: true, label: t.label });
    }).finally(() => { if (this.drag) this.drag.busy = false; });
  }
  async dragEnd() {
    dbg('dragEnd', !!this.drag, JSON.stringify(this.win?.getBounds()));
    clearInterval(this.dragTimer);
    if (!this.drag) return this.status();
    const cur = screen.getCursorScreenPoint();
    const t = await this.targetAt(cur);
    this.drag = null;
    this.win?.webContents.send('ev', 'dock-drag', { on: false });
    const c = this.cfg();
    if (t.place.type === 'float') { const b = this.win.getBounds(); t.place.x = b.x; t.place.y = b.y; }
    this.host = t.host || null;
    this.setConfig({ ...c, place: t.place, pin: null });
    this.open = true; // stays out until the mouse leaves it
    this.place();
    this.win?.webContents.send('ev', 'dock-open', true);
    return this.status();
  }

  // what dropping at this cursor point means
  async targetAt(cur) {
    // by default the dock simply stays wherever it's dropped
    if (!this.cfg().snap) return { place: { type: 'float' }, label: 'DROP IT ANYWHERE' };
    // 1. a screen edge
    const all = screen.getAllDisplays();
    const d = this.displayAt(cur), i = all.findIndex((x) => x.id === d.id), wa = d.workArea;
    if (cur.x - wa.x < SNAP) return { place: { type: 'edge', display: i, edge: 'left' }, label: `⇤ LEFT EDGE · SCREEN ${i + 1}` };
    if (wa.x + wa.width - cur.x < SNAP) return { place: { type: 'edge', display: i, edge: 'right' }, label: `RIGHT EDGE · SCREEN ${i + 1} ⇥` };
    const corner = (r) => `${cur.y < r.y + r.height / 2 ? 't' : 'b'}${cur.x < r.x + r.width / 2 ? 'l' : 'r'}`;
    const CN = { tl: 'TOP LEFT', tr: 'TOP RIGHT', bl: 'BOTTOM LEFT', br: 'BOTTOM RIGHT' };
    // 2. HYPERSPACE itself
    const mw = this.mainWin();
    if (mw && !mw.isDestroyed() && mw.isVisible() && !mw.isMinimized()) {
      const r = mw.getBounds();
      if (cur.x >= r.x && cur.x < r.x + r.width && cur.y >= r.y && cur.y < r.y + r.height) {
        const k = corner(r);
        return { place: { type: 'window', hs: true, corner: k }, host: { rect: r, fg: mw.isFocused() }, label: `◬ HYPERSPACE · ${CN[k]}` };
      }
    }
    // 3. any other app's window under the cursor
    if (this.core.online) {
      try {
        const pp = screen.dipToScreenPoint(cur);
        const at = await this.core.call('win.at', { x: pp.x, y: pp.y, skip: [this.hwnd(this.win)] });
        if (at.ok && at.win) {
          const w = at.win, r = screen.screenToDipRect(null, { x: w.rect[0], y: w.rect[1], width: w.rect[2] - w.rect[0], height: w.rect[3] - w.rect[1] });
          const k = corner(r);
          return { place: { type: 'window', hwnd: w.hwnd, exe: w.exe, title: w.title, corner: k }, host: { rect: r, fg: w.fg }, label: `${(w.exe || 'WINDOW').toUpperCase()} · ${CN[k]}` };
        }
      } catch {}
    }
    return { place: { type: 'float' }, label: 'FLOAT HERE' };
  }

  // ---------------- riding along with a window ----------------
  async follow() {
    const c = this.cfg(), p = c.place;
    if (!this.win || this.win.isDestroyed() || this.drag || p.type !== 'window' || this.following) return;
    this.following = true;
    try {
      let host = null;
      if (p.hs) {
        const mw = this.mainWin();
        if (mw && !mw.isDestroyed()) host = { exists: true, rect: mw.getBounds(), minimized: mw.isMinimized(), visible: mw.isVisible(), fg: mw.isFocused() };
      } else if (this.core.online) {
        let r = p.hwnd ? await this.core.call('win.rect', { hwnd: p.hwnd }) : { exists: false };
        // the app restarted (new window): find it again by its program name
        if (!r.exists && p.exe) {
          const f = await this.core.call('win.find', { exe: p.exe, title: p.title });
          if (f.ok) { this.setConfig({ ...c, place: { ...p, hwnd: f.win.hwnd } }); r = await this.core.call('win.rect', { hwnd: f.win.hwnd }); }
        }
        if (r.exists) host = { exists: true, minimized: r.minimized, visible: r.visible, fg: r.fg, rect: screen.screenToDipRect(null, { x: r.rect[0], y: r.rect[1], width: r.rect[2] - r.rect[0], height: r.rect[3] - r.rect[1] }) };
      }
      if (!host) { if (this.win.isVisible()) this.win.hide(); this.host = null; return; }
      const wasFg = this.host?.fg;
      this.host = host;
      if (host.minimized || !host.visible) { if (this.win.isVisible()) this.win.hide(); return; }
      const nb = this.bounds(), b = this.win.getBounds();
      if (nb.x !== b.x || nb.y !== b.y || nb.height !== b.height || nb.width !== b.width) this.win.setBounds(nb);
      if (!this.win.isVisible() && !this.covered) { this.win.showInactive(); this.layer(); this.mouse(this.open); this.push(); }
      // its window came to the front (or went to the back): on top with it, or step back with it
      if (!!host.fg !== !!wasFg) this.layer();
    } catch {} finally { this.following = false; }
  }

  async checkFullscreen() {
    const c = this.cfg();
    if (!this.win || this.win.isDestroyed() || this.drag || c.place.type === 'window') return;
    let cov = false;
    if (c.hideFullscreen && this.core.online) {
      try {
        const r = (await this.core.call('desk.covered')).covered;
        const b = screen.dipToScreenRect(null, this.displayAt(this.win.getBounds()).bounds);
        cov = !!r && Math.abs(r[0] - b.x) < 3 && Math.abs(r[1] - b.y) < 3 && Math.abs(r[2] - b.width) < 3 && Math.abs(r[3] - b.height) < 3;
      } catch {}
    }
    if (cov === this.covered) return;
    this.covered = cov;
    if (cov) this.win.hide(); else { this.place(); this.win.showInactive(); }
  }
}

module.exports = { SideDock, MODULES };
