// WIDGETS: a dock strip on every page holding compact cards you can add, move between pages, reorder
// and remove (⊞ WIDGETS in the title bar). Includes the SHORTCUTS deck: run hotkeys on click, sort by
// most used / popular / A-Z / category / your own order, add your own (key chords or apps/files/URLs).
(() => {
  const PAGES = { nexus: 'NEXUS', afterburner: 'BURNER', vj: 'VJ', crate: 'CRATE', deck: 'DECK', router: 'ROUTER', senses: 'SENSES' };
  const DEFAULT_LAYOUT = { nexus: ['shortcuts'], afterburner: [], vj: [], crate: [], deck: ['ram'], router: [], senses: [] };
  const D = () => HS.data || {};
  const pct = (v) => (v == null || isNaN(v) ? '--' : `${Math.round(v)}%`);
  const temp = (v) => (v == null ? '--' : `${v}°`);
  const act = (name, ...a) => { const f = HS.actions?.[name]; if (f) return f(...a); toast('NOT READY YET', true); };

  // ---------------- key chords ----------------
  const VK = {
    CTRL: 0x11, SHIFT: 0x10, ALT: 0x12, WIN: 0x5B, ESC: 0x1B, TAB: 0x09, SPACE: 0x20, ENTER: 0x0D, BACKSPACE: 0x08,
    DELETE: 0x2E, INSERT: 0x2D, HOME: 0x24, END: 0x23, PGUP: 0x21, PGDN: 0x22, LEFT: 0x25, UP: 0x26, RIGHT: 0x27, DOWN: 0x28,
    PRTSC: 0x2C, '.': 0xBE, ',': 0xBC, '-': 0xBD, '=': 0xBB, '/': 0xBF, ';': 0xBA, '`': 0xC0, '[': 0xDB, ']': 0xDD, "'": 0xDE,
    PLAY: 0xB3, NEXT: 0xB0, PREV: 0xB1, VOLUP: 0xAF, VOLDOWN: 0xAE, MUTE: 0xAD,
  };
  for (let i = 0; i < 26; i++) VK[String.fromCharCode(65 + i)] = 0x41 + i;
  for (let i = 0; i < 10; i++) VK[String(i)] = 0x30 + i;
  for (let i = 1; i <= 12; i++) VK[`F${i}`] = 0x6F + i;
  const ALIAS = { CONTROL: 'CTRL', META: 'WIN', CMD: 'WIN', ESCAPE: 'ESC', RETURN: 'ENTER', ARROWLEFT: 'LEFT', ARROWRIGHT: 'RIGHT', ARROWUP: 'UP', ARROWDOWN: 'DOWN', PAGEUP: 'PGUP', PAGEDOWN: 'PGDN', PERIOD: '.', ' ': 'SPACE', PRINTSCREEN: 'PRTSC', DEL: 'DELETE' };
  const norm = (k) => { const u = k.trim().toUpperCase(); return ALIAS[u] || u; };
  const parseKeys = (s) => s.split('+').map(norm).filter(Boolean);
  const vks = (s) => { const ks = parseKeys(s); const out = ks.map((k) => VK[k]); return out.some((v) => v == null) ? null : out; };
  const keycaps = (s) => parseKeys(s).map((k) => `<kbd>${esc(k === 'WIN' ? '⊞ Win' : k.length === 1 ? k : k[0] + k.slice(1).toLowerCase())}</kbd>`).join('<i>+</i>');

  // ---------------- built-in shortcuts (pop = how widely used, 1 = most) ----------------
  const BUILTIN = [
    { id: 'snip', keys: 'Win+Shift+S', label: 'Screenshot region', cat: 'SYSTEM', pop: 1 },
    { id: 'taskmgr', keys: 'Ctrl+Shift+Esc', label: 'Task Manager', cat: 'SYSTEM', pop: 2 },
    { id: 'clip', keys: 'Win+V', label: 'Clipboard history', cat: 'SYSTEM', pop: 3 },
    { id: 'desk', keys: 'Win+D', label: 'Show desktop', cat: 'WINDOWS', pop: 4 },
    { id: 'taskview', keys: 'Win+Tab', label: 'Task view', cat: 'WINDOWS', pop: 6 },
    { id: 'explorer', keys: 'Win+E', label: 'File Explorer', cat: 'SYSTEM', pop: 5 },
    { id: 'lock', keys: 'Win+L', label: 'Lock PC', cat: 'SYSTEM', pop: 7, hs: 'lock' },
    { id: 'emoji', keys: 'Win+.', label: 'Emoji panel', cat: 'SYSTEM', pop: 12 },
    { id: 'settings', keys: 'Win+I', label: 'Windows Settings', cat: 'SYSTEM', pop: 11 },
    { id: 'project', keys: 'Win+P', label: 'Projector mode', cat: 'DISPLAY', pop: 14 },
    { id: 'gpureset', keys: 'Win+Ctrl+Shift+B', label: 'Restart graphics driver', cat: 'DISPLAY', pop: 20 },
    { id: 'monleft', keys: 'Win+Shift+Left', label: 'Window → left monitor', cat: 'WINDOWS', pop: 15, target: 'app' },
    { id: 'monright', keys: 'Win+Shift+Right', label: 'Window → right monitor', cat: 'WINDOWS', pop: 16, target: 'app' },
    { id: 'max', keys: 'Win+Up', label: 'Maximize window', cat: 'WINDOWS', pop: 13, target: 'app' },
    { id: 'vdnew', keys: 'Win+Ctrl+D', label: 'New virtual desktop', cat: 'WINDOWS', pop: 22 },
    { id: 'vdleft', keys: 'Win+Ctrl+Left', label: 'Previous desktop', cat: 'WINDOWS', pop: 21 },
    { id: 'vdright', keys: 'Win+Ctrl+Right', label: 'Next desktop', cat: 'WINDOWS', pop: 19 },
    { id: 'gamebar', keys: 'Win+G', label: 'Xbox Game Bar', cat: 'CAPTURE', pop: 17 },
    { id: 'record', keys: 'Win+Alt+R', label: 'Start/stop recording', cat: 'CAPTURE', pop: 18 },
    { id: 'shot', keys: 'Win+Alt+PrtSc', label: 'Game screenshot', cat: 'CAPTURE', pop: 23 },
    { id: 'play', keys: 'Play', label: 'Play / pause media', cat: 'MEDIA', pop: 8 },
    { id: 'next', keys: 'Next', label: 'Next track', cat: 'MEDIA', pop: 9 },
    { id: 'prev', keys: 'Prev', label: 'Previous track', cat: 'MEDIA', pop: 10 },
    { id: 'mute', keys: 'Mute', label: 'Mute speakers', cat: 'MEDIA', pop: 24 },
    { id: 'save', keys: 'Ctrl+S', label: 'Save (in your app)', cat: 'APP', pop: 25, target: 'app' },
    { id: 'undo', keys: 'Ctrl+Z', label: 'Undo (in your app)', cat: 'APP', pop: 26, target: 'app' },
    { id: 'redo', keys: 'Ctrl+Shift+Z', label: 'Redo (in your app)', cat: 'APP', pop: 30, target: 'app' },
    { id: 'space', keys: 'Space', label: 'Transport play/stop (DAW, Resolume)', cat: 'APP', pop: 27, target: 'app' },
    { id: 'fullscreen', keys: 'F11', label: 'Fullscreen (in your app)', cat: 'APP', pop: 28, target: 'app' },
    { id: 'close', keys: 'Alt+F4', label: 'Close your app', cat: 'APP', pop: 40, target: 'app', danger: true },
    { id: 'hs-mic', keys: 'Ctrl+Alt+Shift+M', label: 'Toggle microphone', cat: 'HYPERSPACE', pop: 29, hs: 'toggleMic' },
    { id: 'hs-cam', keys: 'Ctrl+Alt+Shift+C', label: 'Toggle camera', cat: 'HYPERSPACE', pop: 31, hs: 'toggleCam' },
    { id: 'hs-vac', keys: 'HYPERSPACE', label: 'RAM vacuum', cat: 'HYPERSPACE', pop: 32, hs: 'vacuum' },
    { id: 'hs-gamer', keys: 'HYPERSPACE', label: 'GAMER / OC mode', cat: 'HYPERSPACE', pop: 33, hs: 'preset', arg: 'gamer' },
    { id: 'hs-silent', keys: 'HYPERSPACE', label: 'SILENT / RENDER mode', cat: 'HYPERSPACE', pop: 34, hs: 'preset', arg: 'silent' },
    { id: 'hs-eco', keys: 'HYPERSPACE', label: 'ECO mode', cat: 'HYPERSPACE', pop: 35, hs: 'preset', arg: 'eco' },
    { id: 'hs-vj', keys: 'HYPERSPACE', label: 'Next VJ theme', cat: 'HYPERSPACE', pop: 36, hs: 'vjNext' },
    { id: 'hs-spout', keys: 'HYPERSPACE', label: 'Toggle Spout output', cat: 'HYPERSPACE', pop: 26, hs: 'spoutToggle' },
    { id: 'hs-fans', keys: 'HYPERSPACE', label: 'Fans MAX ⇄ back', cat: 'HYPERSPACE', pop: 37, hs: 'fanMode', arg: 'toggleMax' },
    { id: 'hs-fanauto', keys: 'HYPERSPACE', label: 'Fans: Acer auto', cat: 'HYPERSPACE', pop: 41, hs: 'fanMode', arg: 'auto' },
    { id: 'hs-fancurve', keys: 'HYPERSPACE', label: 'Fans: my curve', cat: 'HYPERSPACE', pop: 42, hs: 'fanMode', arg: 'curve' },
    { id: 'hs-wall', keys: 'HYPERSPACE', label: 'Toggle live wallpaper', cat: 'HYPERSPACE', pop: 27, hs: 'wallToggle' },
    { id: 'hs-vjrand', keys: 'HYPERSPACE', label: 'Random VJ look', cat: 'HYPERSPACE', pop: 38, hs: 'vjRandom' },
    { id: 'hs-crate', keys: 'HYPERSPACE', label: 'CRATE play / pause', cat: 'HYPERSPACE', pop: 28, hs: 'crateToggle' },
    { id: 'hs-cratenext', keys: 'HYPERSPACE', label: 'CRATE next track', cat: 'HYPERSPACE', pop: 39, hs: 'crateNext' },
  ];
  const SORTS = { used: 'MOST USED', popular: 'POPULAR', az: 'A–Z', cat: 'CATEGORY', mine: 'MY ORDER' };

  const sc = () => {
    const s = HS.config.shortcuts || {};
    return { usage: s.usage || {}, hidden: s.hidden || [], custom: s.custom || [], order: s.order || [], sort: s.sort || 'popular', speed: s.speed ?? 30 };
  };
  // shortcut ticker: one frame loop moves every visible deck
  const ticker = { speed: 30, off: 0, last: 0 };
  // each row's width, kept up to date by a ResizeObserver (reading offsetWidth every frame forced a layout)
  const setW = new WeakMap();
  const setRO = new ResizeObserver((es) => { for (const e of es) setW.set(e.target, e.target.offsetWidth); });
  function tick(now) {
    requestAnimationFrame(tick);
    const dt = ticker.last ? Math.min(0.1, (now - ticker.last) / 1000) : 0;
    ticker.last = now;
    if (!(ticker.speed > 0)) return;
    for (const row of document.querySelectorAll(`#view-${HS.view} .w-shortcuts .sc-row:not(.still)`)) {
      const set = row.querySelector('.sc-set');
      if (!set) continue;
      if (!row.dataset.hover) ticker.off += ticker.speed * dt;
      let w = setW.get(set);
      if (w === undefined) { setRO.observe(set); w = set.offsetWidth; setW.set(set, w); }
      if (w > 0) ticker.off %= w;
      row.firstElementChild.style.transform = `translateX(${-ticker.off}px)`;
    }
  }
  requestAnimationFrame(tick);
  const saveSc = (patch) => HS.saveConfig({ shortcuts: { ...sc(), ...patch } });
  const allShortcuts = () => [...BUILTIN, ...sc().custom.map((c) => ({ ...c, custom: true, pop: 99 }))];

  function sorted(list, mode) {
    const { usage, order } = sc();
    const l = [...list];
    if (mode === 'used') l.sort((a, b) => (usage[b.id] || 0) - (usage[a.id] || 0) || a.pop - b.pop);
    else if (mode === 'az') l.sort((a, b) => a.label.localeCompare(b.label));
    else if (mode === 'cat') l.sort((a, b) => a.cat.localeCompare(b.cat) || a.pop - b.pop);
    else if (mode === 'mine') l.sort((a, b) => ((order.indexOf(a.id) + 1) || 999) - ((order.indexOf(b.id) + 1) || 999) || a.pop - b.pop);
    else l.sort((a, b) => a.pop - b.pop);
    return l;
  }

  let armed = null;
  async function runShortcut(s, btn) {
    if (s.danger && armed !== s.id) {
      armed = s.id;
      btn?.classList.add('arm');
      setTimeout(() => { if (armed === s.id) { armed = null; btn?.classList.remove('arm'); } }, 2500);
      toast(`CLICK AGAIN: ${s.label.toUpperCase()}`, true);
      return;
    }
    armed = null;
    btn?.classList.remove('arm');
    try {
      if (s.hs === 'lock') await coreCall('lock');
      else if (s.hs) await act(s.hs, s.arg);
      else if (s.open) await call('openTarget', s.open);
      else {
        const codes = vks(s.keys);
        if (!codes) throw new Error(`can't send "${s.keys}"`);
        const r = await coreCall('keys.send', { vks: codes, target: s.target || 'system' });
        if (s.target === 'app' && r.app) toast(`${s.keys.toUpperCase()} → ${r.app.toUpperCase()}`);
      }
      btn?.classList.add('fired');
      setTimeout(() => btn?.classList.remove('fired'), 450);
      const { usage } = sc();
      saveSc({ usage: { ...usage, [s.id]: (usage[s.id] || 0) + 1 } });
    } catch (e) { toast(`SHORTCUT FAILED: ${e.message}`, true); }
  }

  // ---------------- widget catalog ----------------
  const W = {
    shortcuts: {
      title: 'SHORTCUTS', glyph: '⌨', w: 640,
      // a ticker: the deck scrolls by on its own (hover pauses it); the slider sets the speed, 0 = still
      mount(el) {
        el.innerHTML = `<div class="w-head"><span class="glyph">⌨</span> SHORTCUTS <span class="sc-spd" title="Scroll speed (0 = still)">⇢<input type="range" class="sc-speed" min="0" max="120" step="5" /></span><button class="chip mini right sc-sort"></button><button class="chip mini sc-manage" title="Add, hide, reorder">⚙</button></div><div class="sc-row"><div class="sc-track"></div></div>`;
        el.querySelector('.sc-sort').addEventListener('click', () => {
          const keys = Object.keys(SORTS);
          saveSc({ sort: keys[(keys.indexOf(sc().sort) + 1) % keys.length] });
          renderAll();
        });
        el.querySelector('.sc-manage').addEventListener('click', openManager);
        const row = el.querySelector('.sc-row');
        row.addEventListener('click', (e) => {
          const b = e.target.closest('[data-sc]');
          if (b) runShortcut(allShortcuts().find((x) => x.id === b.dataset.sc), b);
        });
        row.addEventListener('mouseenter', () => { row.dataset.hover = '1'; });
        row.addEventListener('mouseleave', () => { delete row.dataset.hover; });
        const spd = el.querySelector('.sc-speed');
        spd.value = sc().speed;
        spd.addEventListener('input', () => { ticker.speed = +spd.value; });
        spd.addEventListener('change', () => saveSc({ speed: +spd.value }));
      },
      update(el) {
        const { sort, hidden, usage, speed } = sc();
        el.querySelector('.sc-sort').textContent = `SORT: ${SORTS[sort]}`;
        const spd = el.querySelector('.sc-speed');
        if (document.activeElement !== spd) { spd.value = speed; ticker.speed = speed; }
        const list = sorted(allShortcuts().filter((s) => !hidden.includes(s.id)), sort);
        const key = list.map((s) => s.id + (usage[s.id] || 0)).join() + (speed > 0);
        const row = el.querySelector('.sc-row'), track = el.querySelector('.sc-track');
        if (row.dataset.key === key) return;
        row.dataset.key = key;
        const html = list.map((s) => `<button class="sc${s.danger ? ' danger' : ''}" data-sc="${esc(s.id)}" title="${esc(s.label)}${usage[s.id] ? ` · used ${usage[s.id]}×` : ''}">
          <span class="caps">${s.keys === 'HYPERSPACE' ? '<kbd class="hs">◬ HS</kbd>' : s.open ? '<kbd class="hs">▶ OPEN</kbd>' : keycaps(s.keys)}</span><span class="sc-label">${esc(s.label)}</span></button>`).join('');
        // two copies back to back so the loop never shows a seam
        track.innerHTML = speed > 0 ? `<div class="sc-set">${html}</div><div class="sc-set" aria-hidden="true">${html}</div>` : `<div class="sc-set">${html}</div>`;
        row.classList.toggle('still', !(speed > 0));
        ticker.off = 0;
      },
    },
    ram: {
      title: 'MEMORY', glyph: '▤', w: 230,
      mount(el) {
        el.innerHTML = `<div class="w-head"><span class="glyph">▤</span> MEMORY <button class="chip mini right w-vac">⟲ VACUUM</button></div><div class="w-big"></div><div class="w-bar"><i></i></div><div class="w-sub"></div>`;
        el.querySelector('.w-vac').addEventListener('click', () => act('vacuum'));
      },
      update(el) {
        const p = D().perf;
        if (!p) return;
        const v = (p.mem.used / p.mem.total) * 100;
        el.querySelector('.w-big').textContent = pct(v);
        el.querySelector('.w-bar i').style.width = `${v}%`;
        el.querySelector('.w-sub').textContent = `${fmtBytes(p.mem.used)} / ${fmtBytes(p.mem.total)}`;
      },
    },
    cpu: {
      title: 'CPU', glyph: '✺', w: 220,
      mount(el) { el.innerHTML = `<div class="w-head"><span class="glyph">✺</span> CPU</div><div class="w-big"></div><div class="w-bar"><i></i></div><div class="w-sub"></div>`; },
      update(el) {
        const p = D().perf, t = D().tele;
        if (!p) return;
        el.querySelector('.w-big').textContent = pct(p.cpu);
        el.querySelector('.w-bar i').style.width = `${p.cpu}%`;
        el.querySelector('.w-sub').textContent = [t?.cpu?.clock ? `${Math.round(t.cpu.clock)} MHz` : null, t?.cpu?.temp != null ? `${t.cpu.temp}°C` : null, t?.cpu?.power ? `${t.cpu.power.toFixed(0)} W` : null].filter(Boolean).join(' · ') || `${p.cores.length} threads`;
      },
    },
    gpu: {
      title: 'GPU', glyph: '◈', w: 230,
      mount(el) { el.innerHTML = `<div class="w-head"><span class="glyph">◈</span> GPU · RTX 3050 Ti</div><div class="w-big"></div><div class="w-bar"><i></i></div><div class="w-sub"></div>`; },
      update(el) {
        const g = D().tele?.gpu, p = D().perf;
        const u = g?.util ?? p?.gpu;
        el.querySelector('.w-big').textContent = pct(u);
        el.querySelector('.w-bar i').style.width = `${u || 0}%`;
        el.querySelector('.w-sub').textContent = g ? `${g.temp ?? '--'}°C · ${g.clock} MHz · VRAM ${fmtBytes(g.memUsed)}` : '—';
      },
    },
    temps: {
      title: 'TEMPS', glyph: '☢', w: 220,
      mount(el) { el.innerHTML = `<div class="w-head"><span class="glyph">☢</span> TEMPS</div><div class="w-pair"><div><span>CPU</span><b class="tc"></b></div><div><span>GPU</span><b class="tg"></b></div></div><div class="w-sub"></div>`; },
      update(el) {
        const t = D().tele;
        const c = t?.cpu?.temp, g = t?.gpuTemp, a = t?.alarm;
        const paint = (sel, v, lim) => { const b = el.querySelector(sel); b.textContent = temp(v); b.className = `${sel.slice(1)}${v != null && lim && v >= lim - 8 ? (v >= lim ? ' hot' : ' warm') : ''}`; };
        paint('.tc', c, a?.cpuLimit); paint('.tg', g, a?.gpuLimit);
        el.querySelector('.w-sub').textContent = a?.active ? '⚠ OVERHEAT PROTOCOL ACTIVE' : `alarms at ${a?.cpuLimit ?? 95}° / ${a?.gpuLimit ?? 87}°`;
      },
    },
    thermals: {
      title: 'TEMP HISTORY', glyph: '♨', w: 300,
      mount(el) { el.innerHTML = `<div class="w-head"><span class="glyph">♨</span> TEMPS · 30 MIN <span class="hint tl"></span></div><div class="w-graph"><canvas></canvas></div>`; },
      update(el) {
        const rows = HS.thermal?.rows() || [];
        const c = el.querySelector('canvas'), r = c.parentElement.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        c.width = Math.max(2, r.width * dpr); c.height = Math.max(2, r.height * dpr);
        const ctx = c.getContext('2d'), w = c.width, h = c.height, t0 = Date.now() - 1800e3;
        const recent = rows.filter((x) => x[0] >= t0);
        const last = recent[recent.length - 1];
        el.querySelector('.tl').textContent = last ? `${last[1] ?? '--'}° · ${last[2] ?? '--'}°` : '';
        for (const [i, col] of [[2, '#1de9b6'], [1, '#00ff6e']]) {
          ctx.beginPath();
          let open = false;
          for (const x of recent) {
            if (x[i] == null) { open = false; continue; }
            const px = ((x[0] - t0) / 1800e3) * w, py = h - ((x[i] - 30) / 70) * (h - 4) - 2;
            open ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
            open = true;
          }
          ctx.strokeStyle = col; ctx.lineWidth = 1.5 * dpr; ctx.shadowColor = col; ctx.shadowBlur = 4 * dpr; ctx.stroke();
        }
      },
    },
    net: {
      title: 'NETWORK', glyph: '⇅', w: 210,
      mount(el) { el.innerHTML = `<div class="w-head"><span class="glyph">⇅</span> NETWORK</div><div class="w-pair"><div><span>↓ IN</span><b class="rx"></b></div><div><span>↑ OUT</span><b class="tx"></b></div></div>`; },
      update(el) { const n = D().perf?.net; if (!n) return; el.querySelector('.rx').textContent = fmtRate(n.rx); el.querySelector('.tx').textContent = fmtRate(n.tx); },
    },
    disk: {
      title: 'DISK', glyph: '⛁', w: 210,
      mount(el) { el.innerHTML = `<div class="w-head"><span class="glyph">⛁</span> DISK <span class="hint dp"></span></div><div class="w-pair"><div><span>READ</span><b class="rd"></b></div><div><span>WRITE</span><b class="wr"></b></div></div>`; },
      update(el) { const d = D().perf?.disk; if (!d) return; el.querySelector('.rd').textContent = fmtRate(d.read); el.querySelector('.wr').textContent = fmtRate(d.write); el.querySelector('.dp').textContent = pct(d.pct); },
    },
    vram: {
      title: 'VRAM HOGS', glyph: '▣', w: 250,
      mount(el) { el.innerHTML = `<div class="w-head"><span class="glyph">▣</span> VRAM HOGS</div><div class="w-list"></div>`; },
      update(el) {
        const procs = (D().procs || []).filter((p) => p.vram > 0);
        const m = new Map();
        for (const p of procs) m.set(p.name, (m.get(p.name) || 0) + p.vram);
        const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
        el.querySelector('.w-list').innerHTML = top.length ? top.map(([n, v]) => `<div><span>${esc(n)}</span><b>${fmtBytes(v)}</b></div>`).join('') : '<div class="dim">needs HyperCore</div>';
      },
    },
    shield: {
      title: 'MIC / CAM', glyph: '⟁', w: 210,
      mount(el) {
        el.innerHTML = `<div class="w-head"><span class="glyph">⟁</span> SHIELD</div><div class="w-btns"><button class="w-tog" data-k="mic">MIC</button><button class="w-tog" data-k="cam">CAM</button></div>`;
        el.querySelectorAll('.w-tog').forEach((b) => b.addEventListener('click', () => act(b.dataset.k === 'mic' ? 'toggleMic' : 'toggleCam')));
      },
      update(el) {
        const h = D().hw;
        if (!h) return;
        el.querySelectorAll('.w-tog').forEach((b) => { const on = h[b.dataset.k].on; b.classList.toggle('on', on); b.classList.toggle('off', !on); b.textContent = `${b.dataset.k.toUpperCase()} ${on ? 'OPEN' : 'SEALED'}`; });
      },
    },
    media: {
      title: 'NOW PLAYING', glyph: '▶', w: 300,
      mount(el) {
        el.innerHTML = `<div class="w-head"><span class="glyph">▶</span> NOW PLAYING</div><div class="w-track"></div><div class="w-btns"><button data-m="prev">⏮</button><button data-m="toggle">⏯</button><button data-m="next">⏭</button></div>`;
        el.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => act('media', b.dataset.m)));
      },
      update(el) { const m = D().media; el.querySelector('.w-track').innerHTML = m?.available ? `<b>${esc(m.title || '—')}</b><span>${esc(m.artist || '')}</span>` : '<span class="dim">nothing playing</span>'; },
    },
    volume: {
      title: 'VOLUME', glyph: '♫', w: 250,
      mount(el) {
        el.innerHTML = `<div class="w-head"><span class="glyph">♫</span> MASTER <button class="chip mini right w-mute">MUTE</button></div><div class="w-big"></div><input type="range" class="slider" min="0" max="100" />`;
        el.querySelector('.w-mute').addEventListener('click', () => act('mute'));
        el.querySelector('input').addEventListener('change', (e) => act('volume', e.target.value / 100));
      },
      update(el) {
        const v = D().vol;
        if (!v) return;
        el.querySelector('.w-big').textContent = v.muted ? 'MUTED' : pct(v.level * 100);
        if (document.activeElement !== el.querySelector('input')) el.querySelector('input').value = Math.round(v.level * 100);
        el.querySelector('.w-mute').classList.toggle('on', v.muted);
      },
    },
    modes: {
      title: 'MODES', glyph: '✦', w: 280,
      mount(el) {
        el.innerHTML = `<div class="w-head"><span class="glyph">✦</span> MODES</div><div class="w-btns">${['gamer', 'silent', 'eco'].map((m) => `<button data-p="${m}">${m.toUpperCase()}</button>`).join('')}</div><div class="w-sub"></div>`;
        el.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => act('preset', b.dataset.p)));
      },
      update(el) {
        el.querySelectorAll('[data-p]').forEach((b) => b.classList.toggle('on', HS.config.preset === b.dataset.p));
        const t = D().tele;
        el.querySelector('.w-sub').textContent = t?.acerProfile ? `Acer profile: ${t.acerProfile}` : 'Acer profile needs admin';
      },
    },
    fans: {
      title: 'FANS', glyph: '❋', w: 250,
      mount(el) {
        el.innerHTML = `<div class="w-head"><span class="glyph">❋</span> FANS</div><div class="w-pair"><div><span>CPU</span><b class="fc"></b></div><div><span>GPU</span><b class="fg"></b></div></div><div class="w-btns">${['auto', 'curve', 'max'].map((m) => `<button data-f="${m}">${m.toUpperCase()}</button>`).join('')}</div>`;
        el.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => act('fanMode', b.dataset.f)));
      },
      update(el) {
        const t = D().tele;
        el.querySelector('.fc').textContent = t?.cpu?.fanRpm != null ? `${t.cpu.fanRpm}` : '--';
        el.querySelector('.fg').textContent = t?.gpuFanRpm != null ? `${t.gpuFanRpm}` : '--';
        el.querySelectorAll('[data-f]').forEach((b) => b.classList.toggle('on', t?.fans?.mode === b.dataset.f));
      },
    },
    router: {
      title: 'ASSET ROUTER', glyph: '⇶', w: 320,
      mount(el) { el.innerHTML = `<div class="w-head"><span class="glyph">⇶</span> ASSET ROUTER <span class="hint rs"></span></div><div class="w-list"></div>`; },
      update(el) {
        const r = D().router;
        el.querySelector('.rs').textContent = r ? (r.enabled ? 'WATCHING' : 'OFF') : '';
        const log = (r?.log || []).slice(0, 4);
        el.querySelector('.w-list').innerHTML = log.length ? log.map((x) => `<div><span>${esc(x.newName)}</span><b>${esc(x.rule)}</b></div>`).join('') : '<div class="dim">no files routed yet</div>';
      },
    },
    clock: {
      title: 'CLOCK', glyph: '◷', w: 220,
      mount(el) { el.innerHTML = `<div class="w-head"><span class="glyph">◷</span> TIME</div><div class="w-big"></div><div class="w-sub"></div>`; },
      update(el) {
        const d = new Date();
        el.querySelector('.w-big').textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
        el.querySelector('.w-sub').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase();
      },
    },
  };

  // ---------------- docks ----------------
  const docks = {};
  for (const page of Object.keys(PAGES)) {
    const view = $(`#view-${page}`);
    if (!view) continue;
    const dock = document.createElement('div');
    dock.className = 'dock';
    dock.dataset.page = page;
    view.prepend(dock);
    docks[page] = dock;
  }
  const layout = () => ({ ...DEFAULT_LAYOUT, ...(HS.config.layout || {}) });
  const saveLayout = (l) => HS.saveConfig({ layout: l });

  function renderAll() {
    const l = layout();
    const edit = document.body.classList.contains('edit-layout');
    for (const [page, dock] of Object.entries(docks)) {
      const ids = (l[page] || []).filter((w) => W[w]);
      const key = ids.join() + edit;
      if (dock.dataset.key !== key) {
        dock.dataset.key = key;
        dock.innerHTML = '';
        ids.forEach((w, i) => {
          const card = document.createElement('div');
          card.className = `panel wcard w-${w}`;
          card.style.setProperty('--w', `${W[w].w}px`);
          const body = document.createElement('div');
          body.className = 'w-body';
          card.append(body);
          W[w].mount(body);
          if (edit) {
            const bar = document.createElement('div');
            bar.className = 'w-edit';
            bar.innerHTML = `<button data-e="left" title="Move left">◀</button><button data-e="right" title="Move right">▶</button>
              <select data-e="page" title="Send to page">${Object.entries(PAGES).map(([p, n]) => `<option value="${p}"${p === page ? ' selected' : ''}>${n}</option>`).join('')}</select>
              <button data-e="remove" title="Remove">✕</button>`;
            bar.addEventListener('click', (e) => {
              const b = e.target.closest('button');
              if (!b) return;
              const L = layout(), arr = [...(L[page] || [])];
              if (b.dataset.e === 'remove') arr.splice(i, 1);
              if (b.dataset.e === 'left' && i > 0) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
              if (b.dataset.e === 'right' && i < arr.length - 1) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
              saveLayout({ ...L, [page]: arr }).then(renderAll);
            });
            bar.querySelector('select').addEventListener('change', (e) => {
              const L = layout(), from = [...(L[page] || [])], to = [...(L[e.target.value] || [])];
              from.splice(i, 1);
              to.push(w);
              saveLayout({ ...L, [page]: from, [e.target.value]: to }).then(() => { renderAll(); toast(`${W[w].title} → ${PAGES[e.target.value]}`); });
            });
            card.append(bar);
          }
          dock.append(card);
        });
        if (edit) {
          const add = document.createElement('div');
          add.className = 'wcard w-add';
          add.innerHTML = `<div class="w-head">+ ADD TO ${PAGES[page]}</div><div class="w-addlist">${Object.entries(W).map(([k, d]) => `<button data-add="${k}">${d.glyph} ${d.title}</button>`).join('')}</div>`;
          add.addEventListener('click', (e) => {
            const b = e.target.closest('[data-add]');
            if (!b) return;
            const L = layout();
            saveLayout({ ...L, [page]: [...(L[page] || []), b.dataset.add] }).then(renderAll);
          });
          dock.append(add);
        }
      }
      dock.classList.toggle('empty', !ids.length && !edit);
    }
    updateVisible(true);
  }

  function updateVisible(all = false) {
    for (const [page, dock] of Object.entries(docks)) {
      if (!all && page !== HS.view) continue;
      for (const card of dock.querySelectorAll('.wcard:not(.w-add)')) {
        const w = [...card.classList].find((c) => c.startsWith('w-') && W[c.slice(2)])?.slice(2);
        try { W[w]?.update(card.querySelector('.w-body')); } catch {}
      }
    }
  }
  setInterval(() => updateVisible(), 1000);

  $('#widgets-btn').addEventListener('click', () => {
    const on = document.body.classList.toggle('edit-layout');
    $('#widgets-btn').classList.toggle('on', on);
    renderAll();
    if (on) toast('EDIT WIDGETS · ADD, MOVE OR SEND CARDS TO OTHER PAGES');
  });

  // ---------------- shortcut manager ----------------
  function openManager() {
    const m = $('#sc-modal');
    m.classList.remove('hidden');
    renderManager();
  }
  function renderManager() {
    const { hidden, usage, order, sort } = sc();
    const list = sorted(allShortcuts(), sort === 'mine' ? 'mine' : 'cat');
    $('#sc-list').innerHTML = list.map((s, i) => `<div class="sc-item${hidden.includes(s.id) ? ' hidden-sc' : ''}" draggable="true" data-id="${esc(s.id)}">
      <span class="drag" title="Drag to reorder (MY ORDER)">⋮⋮</span>
      <span class="caps">${s.keys === 'HYPERSPACE' ? '<kbd class="hs">◬ HS</kbd>' : s.open ? '<kbd class="hs">▶ OPEN</kbd>' : keycaps(s.keys)}</span>
      <span class="sc-l">${esc(s.label)}<em>${esc(s.cat)}${s.target === 'app' ? ' · sent to your last app' : ''}${s.open ? ' · ' + esc(s.open) : ''}</em></span>
      <span class="dim">${usage[s.id] || 0}×</span>
      <button data-a="vis" title="${hidden.includes(s.id) ? 'Show on the deck' : 'Hide from the deck'}">${hidden.includes(s.id) ? '◌' : '◉'}</button>
      ${s.custom ? '<button data-a="del" title="Delete">✕</button>' : '<span></span>'}
    </div>`).join('');
    $('#sc-sortnote').textContent = sort === 'mine' ? 'Drag rows to set MY ORDER.' : `Deck is sorted by ${SORTS[sort]}. Drag rows, then switch the deck to MY ORDER to use your arrangement.`;
  }
  $('#sc-list').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const id = b.closest('.sc-item').dataset.id;
    const s = sc();
    if (b.dataset.a === 'vis') saveSc({ hidden: s.hidden.includes(id) ? s.hidden.filter((x) => x !== id) : [...s.hidden, id] });
    if (b.dataset.a === 'del') saveSc({ custom: s.custom.filter((x) => x.id !== id) });
    setTimeout(() => { renderManager(); renderAll(); }, 50);
  });
  let dragId = null;
  $('#sc-list').addEventListener('dragstart', (e) => { dragId = e.target.closest('.sc-item')?.dataset.id; });
  $('#sc-list').addEventListener('dragover', (e) => e.preventDefault());
  $('#sc-list').addEventListener('drop', (e) => {
    e.preventDefault();
    const target = e.target.closest('.sc-item')?.dataset.id;
    if (!dragId || !target || dragId === target) return;
    const ids = [...$$('#sc-list .sc-item')].map((x) => x.dataset.id).filter((x) => x !== dragId);
    ids.splice(ids.indexOf(target), 0, dragId);
    saveSc({ order: ids, sort: 'mine' }).then(() => { renderManager(); renderAll(); });
  });
  // recording a chord from the keyboard (Windows grabs most Win+ combos, so typing them works too)
  $('#sc-rec').addEventListener('keydown', (e) => {
    e.preventDefault();
    const k = norm(e.key);
    if (['CTRL', 'SHIFT', 'ALT', 'WIN'].includes(k)) return;
    const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Win'].filter(Boolean);
    e.target.value = [...mods, k.length === 1 ? k : k[0] + k.slice(1).toLowerCase()].join('+');
  });
  $('#sc-kind').addEventListener('change', (e) => {
    const open = e.target.value === 'open';
    $('#sc-rec').classList.toggle('hidden', open);
    $('#sc-target').classList.toggle('hidden', open);
    $('#sc-open').classList.toggle('hidden', !open);
  });
  $('#sc-add').addEventListener('click', () => {
    const label = $('#sc-label').value.trim();
    const open = $('#sc-kind').value === 'open';
    const keys = $('#sc-rec').value.trim();
    const target = $('#sc-target').value;
    const path = $('#sc-open').value.trim();
    if (!label) return toast('GIVE IT A NAME', true);
    if (!open && !vks(keys)) return toast('THAT KEY COMBO ISN\'T RECOGNISED (e.g. Ctrl+Alt+K)', true);
    if (open && !path) return toast('PASTE A FILE, APP OR URL TO OPEN', true);
    const item = { id: `c-${Date.now().toString(36)}`, label, cat: 'MINE', ...(open ? { keys: 'OPEN', open: path } : { keys, target }) };
    saveSc({ custom: [...sc().custom, item] }).then(() => { renderManager(); renderAll(); toast('SHORTCUT ADDED'); });
    $('#sc-label').value = ''; $('#sc-rec').value = ''; $('#sc-open').value = '';
  });
  $('#sc-reset').addEventListener('click', () => saveSc({ usage: {} }).then(() => { renderManager(); renderAll(); toast('USAGE COUNTS RESET'); }));
  $('#sc-close').addEventListener('click', () => $('#sc-modal').classList.add('hidden'));
  $('#sc-modal').addEventListener('click', (e) => { if (e.target.id === 'sc-modal') $('#sc-modal').classList.add('hidden'); });

  hs.on('config', () => setTimeout(renderAll, 0));
  HS.onView(() => updateVisible());
  call('config').then((c) => { HS.config = c; renderAll(); }).catch(() => renderAll());
})();
