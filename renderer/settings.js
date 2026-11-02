// SETTINGS: DISPLAY (every background "artifact": rain, waterfall, lattice, tunnel, spirals, stars,
// scanlines, vignette, colour), GENERAL (startup, GPU, NitroSense key, shortcut ticker), CRATE (filled in by
// crate.js), SIDE DOCK (the screen-edge panel: modules, edge, slide-out or always) and ABOUT. The background as first designed is the ORIGINAL preset, one click away.
(() => {
  if (!document.getElementById('view-settings')) return;

  // subtabs
  $('#set-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-st]');
    if (!b) return;
    $$('#set-tabs button').forEach((x) => x.classList.toggle('on', x === b));
    $$('.set-page').forEach((p) => p.classList.toggle('hidden', p.dataset.page !== b.dataset.st));
    try { localStorage.setItem('settingsTab', b.dataset.st); } catch {}
  });
  try { const t = localStorage.getItem('settingsTab'); if (t) $(`#set-tabs [data-st="${t}"]`)?.click(); } catch {}
  // other pages jump straight to their part of SETTINGS (e.g. ⚙ on the CRATE page)
  HS.actions.openSettings = (tab) => { showView('settings'); $(`#set-tabs [data-st="${tab}"]`)?.click(); };

  // ---------------- DISPLAY: background artifacts ----------------
  const art = () => FX.art();
  const save = (next) => { FX.setArt(next); HS.saveConfig({ art: next }); };
  const get = (path) => path.split('.').reduce((o, k) => o?.[k], art());
  function set(path, v) {
    const next = JSON.parse(JSON.stringify(art()));
    const ks = path.split('.');
    ks.slice(0, -1).reduce((o, k) => o[k], next)[ks[ks.length - 1]] = v;
    save(next);
    sync();
  }
  const SECTIONS = [
    ['MATRIX RAIN', [
      { p: 'rain.on', t: 'switch' },
      { p: 'rain.style', t: 'seg', l: 'STYLE', o: [['rain', 'ORIGINAL RAIN'], ['waterfall', 'CODE WATERFALL'], ['binary', 'BINARY'], ['runes', 'RUNES']] },
      { p: 'rain.opacity', t: 'range', l: 'BRIGHTNESS', min: 0.05, max: 1, step: 0.05 },
      { p: 'rain.speed', t: 'range', l: 'SPEED', min: 0.2, max: 3, step: 0.05 },
      { p: 'rain.size', t: 'range', l: 'GLYPH SIZE', min: 9, max: 32, step: 1 },
      { p: 'rain.density', t: 'range', l: 'DENSITY', min: 0.2, max: 6, step: 0.1 },
      { p: 'rain.trail', t: 'range', l: 'TRAIL LENGTH', min: 0.4, max: 3, step: 0.05 },
      { p: 'rain.cpu', t: 'check', l: 'falls faster when the CPU is busy' },
    ]],
    ['HYPERSPACE TUNNEL', [
      { p: 'tunnel.on', t: 'switch' },
      { p: 'tunnel.shape', t: 'seg', l: 'SHAPES', o: [['original', 'ORIGINAL MIX'], ['hexagram', 'HEXAGRAMS'], ['circles', 'RINGS'], ['squares', 'SQUARES'], ['flower', 'FLOWERS']] },
      { p: 'tunnel.opacity', t: 'range', l: 'BRIGHTNESS', min: 0.1, max: 4, step: 0.05 },
      { p: 'tunnel.speed', t: 'range', l: 'SPEED', min: 0, max: 4, step: 0.05 },
      { p: 'tunnel.cpu', t: 'check', l: 'rushes faster when the CPU is busy' },
    ]],
    ['FLOWER OF LIFE LATTICE', [
      { p: 'lattice.on', t: 'switch' },
      { p: 'lattice.opacity', t: 'range', l: 'BRIGHTNESS', min: 0.2, max: 6, step: 0.1 },
      { p: 'lattice.size', t: 'range', l: 'SIZE', min: 0.4, max: 3, step: 0.05 },
      { p: 'lattice.spin', t: 'range', l: 'SPIN', min: -4, max: 4, step: 0.1 },
    ]],
    ['SPIRAL ARMS', [
      { p: 'spiral.on', t: 'switch', note: 'new' },
      { p: 'spiral.arms', t: 'range', l: 'ARMS', min: 1, max: 12, step: 1 },
      { p: 'spiral.opacity', t: 'range', l: 'BRIGHTNESS', min: 0.2, max: 5, step: 0.1 },
      { p: 'spiral.speed', t: 'range', l: 'SPEED', min: -4, max: 4, step: 0.1 },
    ]],
    ['STAR DRIFT', [
      { p: 'stars.on', t: 'switch', note: 'new' },
      { p: 'stars.density', t: 'range', l: 'STARS', min: 0.2, max: 4, step: 0.1 },
      { p: 'stars.speed', t: 'range', l: 'SPEED', min: 0.1, max: 5, step: 0.1 },
    ]],
    ['SCREEN', [
      { p: 'scan.on', t: 'check', l: 'scanlines' },
      { p: 'scan.strength', t: 'range', l: 'SCANLINE STRENGTH', min: 0.2, max: 2.5, step: 0.05 },
      { p: 'vignette.on', t: 'check', l: 'dark vignette round the edges' },
      { p: 'vignette.strength', t: 'range', l: 'VIGNETTE STRENGTH', min: 0.2, max: 1.3, step: 0.05 },
    ]],
    ['COLOUR', [
      { p: 'hue', t: 'range', l: 'HUE SHIFT (0 = MATRIX GREEN)', min: -140, max: 220, step: 1 },
      { p: 'drift', t: 'range', l: 'COLOUR DRIFT', min: 0, max: 4, step: 0.05 },
    ]],
  ];
  const num = (c, v) => (c.step >= 1 ? String(Math.round(v)) : Number(v).toFixed(2));
  function ctl(c) {
    if (c.t === 'switch') return `<label class="switch" title="On / off"><input type="checkbox" data-p="${c.p}" /><span></span></label>${c.note ? `<em class="set-new">${c.note}</em>` : ''}`;
    if (c.t === 'check') return `<label class="check"><input type="checkbox" data-p="${c.p}" /> ${c.l}</label>`;
    if (c.t === 'range') return `<label class="set-l">${c.l} <b data-v="${c.p}"></b></label><input type="range" class="slider" data-p="${c.p}" min="${c.min}" max="${c.max}" step="${c.step}" />`;
    if (c.t === 'seg') return `<label class="set-l">${c.l}</label><div class="seg small" data-sp="${c.p}">${c.o.map(([v, l]) => `<button data-v="${v}">${l}</button>`).join('')}</div>`;
    return '';
  }
  $('#set-display').innerHTML = `
    <div class="panel set-card set-top">
      <div class="panel-head"><span class="glyph">◈</span> BACKGROUND ARTIFACTS <span class="hint">changes show live behind every page</span></div>
      <div class="set-body set-row">
        <div><label class="set-l">EFFECTS LEVEL</label><div class="seg small" id="set-fx"><button data-v="high">HIGH · EVERYTHING</button><button data-v="low">LOW · RAIN ONLY</button><button data-v="off">OFF</button></div></div>
        <button class="act" id="set-original" title="Put every artifact back the way HYPERSPACE was first designed">↺ RESET TO ORIGINAL</button>
      </div>
    </div>
    <div class="set-grid">${SECTIONS.map(([h, cs]) => {
      const sw = cs.find((c) => c.t === 'switch');
      return `<div class="panel set-card"><div class="panel-head"><span class="glyph">✧</span> ${h}<span class="right">${sw ? ctl(sw) : ''}</span></div><div class="set-body">${cs.filter((c) => c !== sw).map(ctl).join('')}</div></div>`;
    }).join('')}</div>`;
  const ALL = SECTIONS.flatMap(([, cs]) => cs);
  function sync() {
    for (const el of $$('#set-display [data-p]')) {
      const v = get(el.dataset.p);
      if (el.type === 'checkbox') el.checked = !!v;
      else { if (document.activeElement !== el) el.value = v; const c = ALL.find((x) => x.p === el.dataset.p); const lbl = $(`#set-display [data-v="${el.dataset.p}"]`); if (lbl) lbl.textContent = num(c, v); }
    }
    for (const seg of $$('#set-display [data-sp]')) seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === String(get(seg.dataset.sp))));
    // dim the controls of a layer that's switched off
    for (const card of $$('#set-display .set-card')) { const sw = card.querySelector('.switch input'); if (sw) card.classList.toggle('off', !sw.checked); }
    $$('#set-fx button').forEach((b) => b.classList.toggle('on', b.dataset.v === HS.fxLevel()));
  }
  $('#set-display').addEventListener('input', (e) => {
    const p = e.target.dataset.p;
    if (!p) return;
    set(p, e.target.type === 'checkbox' ? e.target.checked : Number(e.target.value));
  });
  $('#set-display').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sp] button');
    if (b) return set(b.parentElement.dataset.sp, b.dataset.v);
    const fx = e.target.closest('#set-fx button');
    if (fx) { HS.actions.setFx(fx.dataset.v); sync(); return; }
    if (e.target.id === 'set-original') { save(JSON.parse(JSON.stringify(FX.ART_ORIGINAL))); sync(); toast('BACKGROUND BACK TO ORIGINAL'); }
  });
  $('#fx-btn').addEventListener('click', () => setTimeout(sync, 0));
  // every window follows the saved look
  hs.on('config', (c) => { FX.setArt(c.art); if (HS.view === 'settings') sync(); });
  hs.call('config').then((c) => { FX.setArt(c.art); sync(); }).catch(() => {});

  // ---------------- GENERAL ----------------
  $('#set-general').innerHTML = `
    <div class="set-grid">
      <div class="panel set-card"><div class="panel-head"><span class="glyph">✦</span> STARTUP</div><div class="set-body">
        <label class="set-l">STARTUP ANIMATION</label><div class="seg small" id="sg-intro"><button data-v="full">FULL</button><button data-v="silent">SILENT</button><button data-v="off">OFF</button><button data-v="replay">▶ REPLAY</button></div>
        <label class="set-l">UI RENDERS ON <em>restarts HYPERSPACE</em></label><div class="seg small" id="sg-gpu"><button data-v="integrated">INTEGRATED · BATTERY</button><button data-v="nvidia">GRAPHICS CARD · SMOOTH</button><button data-v="safe">NO GPU · SAFE</button></div>
        <p class="dim tiny" id="sg-gpu-why"></p>
      </div></div>
      <div class="panel set-card"><div class="panel-head"><span class="glyph">⇧</span> UPDATES</div><div class="set-body">
        <p class="dim tiny" id="up-line">checking…</p>
        <button class="act" id="up-go">CHECK FOR UPDATES</button>
        <p class="dim tiny">HYPERSPACE looks for new versions on its own every few hours and tells you here. It only installs when you click UPDATE, and your notes and settings stay as they are.</p>
      </div></div>
      <div class="panel set-card"><div class="panel-head"><span class="glyph">◐</span> LOOK</div><div class="set-body">
        <label class="set-l">ACCENT COLOUR <em>mixed into the green and black: borders, glows, highlights</em></label><div class="acc-row" id="sg-accent"></div>
      </div></div>
      <div class="panel set-card"><div class="panel-head"><span class="glyph">⌨</span> KEYS</div><div class="set-body">
        <label class="set-l acer-only">NITROSENSE KEY <em>above the numpad</em></label><div class="seg small acer-only" id="sg-ns"><button data-v="off">OPENS NITROSENSE</button><button data-v="key">OPENS HYPERSPACE</button></div>
        <label class="set-l">SHORTCUT TICKER SPEED <b id="sg-tickv"></b></label><input type="range" class="slider" id="sg-tick" min="0" max="120" step="5" />
        <p class="dim tiny">0 stops the ticker so you can scroll it by hand. Hover over it to pause.</p>
      </div></div>
      <div class="panel set-card"><div class="panel-head"><span class="glyph">⚡</span> LITE MODE</div><div class="set-body" id="sg-lite"></div></div>
      <div class="panel set-card"><div class="panel-head"><span class="glyph">⌬</span> CONNECTIONS</div><div class="set-body">
        <button class="act" id="sg-link">PHONE LINK…</button>
        <button class="act" id="sg-widgets">EDIT WIDGETS</button>
      </div></div>
    </div>`;
  const markGen = async () => {
    $$('#sg-intro button').forEach((b) => b.classList.toggle('on', b.dataset.v === window.INTRO?.mode));
    drawAccent();
    try {
      const s = await call('coreStatus');
      $$('#sg-gpu button').forEach((b) => b.classList.toggle('on', b.dataset.v === s.renderGpu));
      $('#sg-gpu-why').textContent = s.safeReason ? `Drawing without the graphics card for now: ${s.safeReason}. It tries the card again by itself in a few hours, or pick NVIDIA / INTEGRATED to try now.` : 'NO GPU · SAFE draws without the graphics card: steadier when memory is tight, a bit heavier on the processor.';
    } catch {}
    try { const k = await call('keyGet'); $$('#sg-ns button').forEach((b) => b.classList.toggle('on', (b.dataset.v === 'key') === !!k.enabled)); } catch {}
    const sp = HS.config.shortcuts?.speed ?? 30;
    $('#sg-tick').value = sp; $('#sg-tickv').textContent = sp ? `${sp}` : 'STILL';
  };
  $('#sg-intro').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b || !window.INTRO) return; if (b.dataset.v === 'replay') return INTRO.replay(); INTRO.setMode(b.dataset.v); markGen(); toast(`STARTUP ANIMATION: ${b.dataset.v.toUpperCase()}`); });
  $('#sg-gpu').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && !b.classList.contains('on')) $(`#render-gpu button[data-v="${b.dataset.v}"]`)?.click(); });
  // the accent swatches (the same row is at the top of NOTES): a click saves the colour and recolours every window
  function drawAccent() { window.drawAccentRow?.($("#sg-accent")); }
  HS.actions.purpleToggle = () => { window.setAccent(window.accentName(HS.config?.look) === 'green' ? 'purple' : 'green'); drawAccent(); };
  $('#sg-ns').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) $(`#ns-key button[data-v="${b.dataset.v}"]`)?.click(); setTimeout(markGen, 1600); });
  $('#sg-tick').addEventListener('input', (e) => { $('#sg-tickv').textContent = +e.target.value ? e.target.value : 'STILL'; });
  $('#sg-tick').addEventListener('change', (e) => HS.saveConfig({ shortcuts: { ...(HS.config.shortcuts || {}), speed: +e.target.value } }));
  // LITE MODE: the looks off while something heavy runs. AUTO's triggers are adjustable here
  const LITE_SLIDERS = [
    ['GO LITE WHEN ANY OF THESE HOLDS', [['cpu', 'CPU LOAD AT OR ABOVE', 30, 100, 5, '%'], ['temp', 'CPU TEMP AT OR ABOVE', 65, 98, 1, '°C'], ['gpu', 'GPU LOAD AT OR ABOVE', 30, 100, 5, '%'], ['mem', 'MEMORY USED AT OR ABOVE', 60, 99, 1, '%'], ['enterSec', 'FOR', 5, 120, 5, ' s']]],
    ['FULL LOOKS BACK WHEN ALL OF THESE HOLD', [['cpuCalm', 'CPU LOAD BELOW', 10, 90, 5, '%'], ['tempCalm', 'CPU TEMP BELOW', 55, 95, 1, '°C'], ['gpuCalm', 'GPU LOAD BELOW', 10, 90, 5, '%'], ['memCalm', 'MEMORY USED BELOW', 50, 98, 1, '%'], ['leaveSec', 'FOR', 10, 600, 10, ' s']]],
  ];
  function renderLite(s) {
    if (!s) return;
    const box = $('#sg-lite');
    if (box.contains(document.activeElement) && document.activeElement.type === 'range') return; // don't fight a slider being dragged
    box.innerHTML = `
      <div class="seg small" id="sg-lite-mode">${['auto', 'on', 'off'].map((m) => `<button data-v="${m}" class="${s.mode === m ? 'on' : ''}">${m.toUpperCase()}</button>`).join('')}</div>
      <p class="dim tiny">${s.on ? `<b>LITE IS ON</b>${s.why && s.why !== 'switched on' ? `: ${esc(s.why)}` : ''}. ` : 'Full looks right now. '}Lite turns off the background, motion, glow and blur in every HYPERSPACE window. Every feature keeps working, including CRATE, the decks, the VJ, the phone link and fan control.</p>
      ${s.mode === 'auto' ? LITE_SLIDERS.map(([title, rows]) => `<label class="set-l">${title}</label>${rows.map(([k, l, min, max, step, unit]) =>
        `<label class="set-l sub">${l} <b data-lv="${k}">${s[k]}${unit}</b></label><input type="range" class="slider" data-lk="${k}" data-unit="${unit}" min="${min}" max="${max}" step="${step}" value="${s[k]}" />`).join('')}`).join('')
        + '<button class="act" id="sg-lite-reset">BACK TO DEFAULTS</button><p class="dim tiny">The defaults suit most gaming laptops: lite starts a little before they get hot and full looks wait for a cool, quiet minute.</p>' : ''}`;
  }
  $('#sg-lite').addEventListener('click', async (e) => {
    const m = e.target.closest('#sg-lite-mode button');
    if (m) return renderLite(await call('liteSet', { mode: m.dataset.v }));
    if (e.target.id === 'sg-lite-reset') { renderLite(await call('liteSet', { reset: true })); toast('LITE MODE BACK TO ITS DEFAULTS'); }
  });
  $('#sg-lite').addEventListener('input', (e) => { const k = e.target.dataset.lk; if (k) $(`#sg-lite [data-lv="${k}"]`).textContent = `${e.target.value}${e.target.dataset.unit}`; });
  $('#sg-lite').addEventListener('change', async (e) => { const k = e.target.dataset.lk; if (k) { e.target.blur(); renderLite(await call('liteSet', { [k]: +e.target.value })); } });
  window.addEventListener('hs-lite', (e) => renderLite(e.detail));
  call('liteGet').then(renderLite).catch(() => {});
  $('#sg-link').addEventListener('click', () => $('#link-btn').click());
  $('#sg-widgets').addEventListener('click', () => { showView('nexus'); $('#widgets-btn').click(); });

  // ---------------- SIDE DOCK ----------------
  const DOCK_NAMES = { clock: '◷ CLOCK', vpn: '⛨ VPN STATUS', temps: '☢ TEMPS', thermals: '♨ TEMP HISTORY (30 MIN GRAPH)', cpu: '✺ CPU', gpu: '◈ GPU', ram: '▤ MEMORY', fans: '❋ FANS', net: '⇅ NETWORK', disk: '⛁ DISK ACTIVITY', drives: '⛃ DRIVE SPACE', apps: '⚙ TOP APPS', media: '▶ NOW PLAYING (WINDOWS)', crate: '◎ CRATE PLAYER', volume: '♫ VOLUME', shield: '⟁ MIC / CAM', battery: '⌁ BATTERY', uptime: '⏱ UPTIME' };
  let dk = null;
  async function renderDock() {
    try { dk = await call('dockGet'); } catch { return; }
    const off = dk.all.filter((m) => !dk.modules.includes(m));
    const row = (m, on, i) => `<div class="dk-row${on ? ' on' : ''}" data-m="${m}"><label><input type="checkbox" ${on ? 'checked' : ''} data-dk="toggle" /> ${DOCK_NAMES[m] || m}</label>${on ? `<span><button data-dk="up" ${i === 0 ? 'disabled' : ''}>▲</button><button data-dk="down" ${i === dk.modules.length - 1 ? 'disabled' : ''}>▼</button></span>` : ''}</div>`;
    $('#set-dock').innerHTML = `<div class="set-grid">
      <div class="panel set-card"><div class="panel-head"><span class="glyph">▥</span> SIDE DOCK</div><div class="set-body">
        <p class="dim tiny">A slim panel of the modules you pick, over every app. <b>Drag it by its title bar</b> and drop it anywhere: it stays right there. (Turn on snapping below if you'd like it to lock to screen edges and window corners.) ⇅ on the dock swaps layers: over everything, or behind other windows.</p>
        <label class="set-l">NOW <b>${esc(dk.where)}${dk.pinned ? ' · ON TOP' : ''}</b></label>
        <label class="set-l">DOCK</label><div class="seg small" data-dk-seg="enabled"><button data-v="false">OFF</button><button data-v="true">ON</button></div>
        <label class="set-l">SHOWS</label><div class="seg small" data-dk-seg="mode"><button data-v="auto">SLIDES AWAY WHEN THE MOUSE LEAVES</button><button data-v="always">ALWAYS OUT</button></div>
        <label class="set-l">WHEN YOU DROP IT</label><div class="seg small" data-dk-seg="snap"><button data-v="false">STAYS EXACTLY WHERE YOU DROP IT</button><button data-v="true">SNAPS TO EDGES & WINDOW CORNERS</button></div>
        <p class="dim tiny">Slid away it's a glowing line on a screen edge, or a small ◬ tab on a window / floating: touch it to bring the dock back.</p>
        <label class="set-l">SEND IT TO AN EDGE</label><div class="seg small" data-dk-seg="edge"><button data-v="left">LEFT</button><button data-v="right">RIGHT</button></div>
        <div class="seg small" data-dk-seg="display">${dk.displays.map((d) => `<button data-v="${d.i}">${esc(d.label)}</button>`).join('')}</div>
        <label class="set-l">WIDTH <b>${dk.width}px</b></label><input type="range" class="slider" data-dk-range="width" min="160" max="420" step="10" value="${dk.width}" />
        <label class="set-l">HEIGHT WHEN FLOATING / ON A WINDOW <b>${dk.floatH}px</b></label><input type="range" class="slider" data-dk-range="floatH" min="240" max="1400" step="20" value="${dk.floatH}" />
        <label class="set-l">OPACITY <b>${Math.round(dk.opacity * 100)}%</b></label><input type="range" class="slider" data-dk-range="opacity" min="0.4" max="1" step="0.02" value="${dk.opacity}" />
        <label class="set-chk"><input type="checkbox" data-dk-check="hideFullscreen" ${dk.hideFullscreen ? 'checked' : ''} /> hide while a game or video fills that screen</label>
      </div></div>
      <div class="panel set-card"><div class="panel-head"><span class="glyph">☰</span> MODULES <span class="hint">tick to show · ▲▼ to order</span></div><div class="set-body dk-list">
        ${dk.modules.map((m, i) => row(m, true, i)).join('')}${off.map((m) => row(m, false)).join('')}
      </div></div>
    </div>`;
    const cur = { ...dk, edge: dk.place?.type === 'edge' ? dk.place.edge : '', display: dk.place?.type === 'edge' ? dk.place.display : '' };
    $$('#set-dock [data-dk-seg]').forEach((s) => s.querySelectorAll('button').forEach((b) => b.classList.toggle('on', String(cur[s.dataset.dkSeg]) === b.dataset.v)));
  }
  const dockSet = async (patch) => { dk = await call('dockSet', patch); renderDock(); };
  $('#set-dock').addEventListener('click', (e) => {
    const b = e.target.closest('[data-dk-seg] button');
    if (b) { const k = b.parentElement.dataset.dkSeg, v = b.dataset.v; return dockSet({ [k]: v === 'true' ? true : v === 'false' ? false : isNaN(+v) ? v : +v }); }
    const a = e.target.closest('[data-dk]');
    if (!a || !dk) return;
    const m = a.closest('[data-m]').dataset.m, list = [...dk.modules], i = list.indexOf(m);
    if (a.dataset.dk === 'toggle') return dockSet({ modules: i >= 0 ? list.filter((x) => x !== m) : [...list, m] });
    if (a.dataset.dk === 'up' && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
    if (a.dataset.dk === 'down' && i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]];
    dockSet({ modules: list });
  });
  $('#set-dock').addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.dkRange) dockSet({ [t.dataset.dkRange]: +t.value });
    if (t.dataset.dkCheck) dockSet({ [t.dataset.dkCheck]: t.checked });
  });

  // updates: one button that changes meaning with the state (check › update › restarting)
  const upShow = (u) => {
    const line = $('#up-line'), btn = $('#up-go');
    if (!line || !btn) return;
    const m = { checking: ['Looking for a new version…', 'CHECKING…', true], downloading: [`Downloading version ${u.latest || ''}… ${u.percent || 0}%`, 'DOWNLOADING…', true], ready: ['Ready. HYPERSPACE will restart to finish.', 'RESTARTING…', true],
      available: [`Version ${u.latest} is ready (you have ${u.current}).`, `UPDATE TO ${u.latest}`, false], current: [`You're up to date (version ${u.current}).`, 'CHECK AGAIN', false], error: [`Couldn't check: ${u.error || 'no connection'}.`, 'TRY AGAIN', false] };
    const [t, b, off] = !u.available ? ['Updates work in the installed HYPERSPACE (not in the dev copy).', 'CHECK FOR UPDATES', true] : m[u.status] || [`You have version ${u.current}.`, 'CHECK FOR UPDATES', false];
    line.textContent = t; btn.textContent = b; btn.disabled = off; btn.dataset.mode = u.status;
  };
  call('updateState').then(upShow).catch(() => {});
  hs.on('update-state', (u) => call('updateState').then(upShow).catch(() => {}));
  $('#up-go').addEventListener('click', async () => {
    try { upShow(await call(($('#up-go').dataset.mode === 'available') ? 'updateInstall' : 'updateCheck')); } catch (e) { toast(e.message, true); }
  });

  // ---------------- ABOUT ----------------
  async function renderAbout() {
    let i = {};
    try { i = await call('appInfo'); } catch {}
    $('#set-about').innerHTML = `<div class="panel set-card about"><div class="panel-head"><span class="glyph">◬</span> HYPERSPACE // SYSTEM SHAMAN</div><div class="set-body">
      <div class="core-rows">
        <div><span>version</span><b>${esc(i.version || '?')}</b></div>
        <div><span>made for</span><b>SUBASHTON</b></div>
        <div><span>settings + history</span><b class="sel-text">${esc(i.dataDir || '')}</b></div>
        <div><span>logs</span><b class="sel-text">${esc(i.logDir || '')}</b></div>
        <div><span>Electron · Chromium · Node</span><b>${esc([i.electron, i.chrome, i.node].join(' · '))}</b></div>
      </div>
      <div class="core-actions" style="padding:10px 0 0"><button class="act" id="ab-open">OPEN SETTINGS FOLDER</button><button class="act" id="ab-logs">OPEN LOGS</button></div>
    </div></div>`;
    $('#ab-open').addEventListener('click', () => call('openDir', 'data'));
    $('#ab-logs').addEventListener('click', () => call('openDir', 'logs'));
  }

  HS.onView((v) => { if (v === 'settings') { sync(); markGen(); renderAbout(); renderDock(); } });
})();
