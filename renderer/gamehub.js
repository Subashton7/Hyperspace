// GAMING HUB: LIBRARY (every installed game in one grid), GAME MODE (one switch that frees the PC up for a game and puts it
// back afterwards), PLAYTIME (sessions + stats), PERFORMANCE (live panel, overlay, crosshair), TOOLS (controller test, specs,
// backlog, random picker, break timer). The scanning, launching, session tracking and overlay windows live in src/gaming.js.
// Anything that watches or draws over the screen is off until switched on here.
(() => {
  const root = $('#view-gamehub');
  if (!root) return;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const LS = (k, d) => { try { return JSON.parse(localStorage.getItem('gh-' + k)) ?? d; } catch { return d; } };
  const LSset = (k, v) => { try { localStorage.setItem('gh-' + k, JSON.stringify(v)); } catch {} };
  const say = (text) => { try { document.dispatchEvent(new CustomEvent('twr', { detail: { say: text } })); } catch {} };
  const hrs = (min) => (min >= 600 ? `${Math.round(min / 60)}h` : min >= 60 ? `${(min / 60).toFixed(1)}h` : `${Math.round(min)}m`);
  const hue = (s) => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const initials = (n) => String(n).replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 3).map((w) => w[0]).join('').toUpperCase() || '?';
  const ago = (t) => { if (!t) return 'never'; const d = (Date.now() - t) / 864e5; return d < 1 / 24 ? 'just now' : d < 1 ? `${Math.round(d * 24)}h ago` : d < 60 ? `${Math.round(d)}d ago` : `${Math.round(d / 30)}mo ago`; };
  const LAUNCHERS = { steam: 'STEAM', epic: 'EPIC', gog: 'GOG', ubisoft: 'UBISOFT', ea: 'EA', battlenet: 'BATTLE.NET', xbox: 'XBOX', custom: 'ADDED' };

  const S = { d: { games: [], meta: {}, sessions: [], backlog: [], endList: [], settings: { mode: {}, overlay: {}, crosshair: {}, timer: {} } }, tab: LS('tab', 'library'), q: '', launcher: 'all', sort: LS('sort', 'recent'), onlyFav: false, showHidden: false, scanning: false };
  const TABS = [
    ['library', 'LIBRARY', 'every game on this PC', '<rect x="-9" y="-6" width="8" height="12"/><rect x="1" y="-8" width="8" height="14"/>'],
    ['mode', 'GAME MODE', 'free up the PC for a game', '<path d="M2,-10 L-6,2 H0 L-2,10 L6,-2 H0Z"/>'],
    ['play', 'PLAYTIME', 'sessions and stats', '<circle r="9"/><path d="M0,-5 V0 L4,3"/>'],
    ['perf', 'PERFORMANCE', 'live panel, overlay, crosshair', '<path d="M-10,6 L-5,-2 L0,3 L5,-8 L10,-3"/>'],
    ['tools', 'TOOLS', 'controller, specs, backlog, picker', '<circle cx="-4" cy="2" r="5"/><circle cx="5" cy="-3" r="3"/>'],
  ];
  root.innerHTML = `<div class="gh-wrap">
    <div class="gh-head"><h2>GAMING</h2><span class="gh-sub">your games, your PC, your numbers · everything watches nothing until you say so</span><span class="grow"></span>
      <div class="gh-gmtog" id="gh-gmtog" title="One switch: frees RAM, quiets the background, raises cooling. Everything is put back when you switch it off."><span>GAME MODE</span><i></i></div></div>
    <div class="gh-banner hidden" id="gh-banner"></div>
    <div class="gh-tabs">${TABS.map((t) => `<button data-t="${t[0]}"><svg viewBox="-12 -12 24 24" fill="none" stroke="currentColor" stroke-width="1.4">${t[3]}</svg><b>${t[1]}</b><em>${t[2]}</em></button>`).join('')}</div>
    <div id="gh-body"></div></div>`;
  const body = $('#gh-body', root);

  // ---------------- small helpers ----------------
  function modal(html, bind) {
    const m = document.createElement('div');
    m.className = 'gh-modal';
    m.innerHTML = `<div class="gh-dlg">${html}</div>`;
    root.appendChild(m);
    const close = () => m.remove();
    m.addEventListener('click', (e) => { if (e.target === m) close(); });
    bind && bind(m, close);
    return close;
  }
  function ask(title, def, done, multi) {
    modal(`<b>${esc(title)}</b>${multi ? `<textarea rows="4">${esc(def)}</textarea>` : `<input type="text" value="${esc(def)}">`}<div class="gh-row"><button class="chip" data-ok>SAVE</button><button class="chip" data-no>CANCEL</button></div>`, (m, close) => {
      const inp = $(multi ? 'textarea' : 'input', m); inp.focus();
      $('[data-ok]', m).onclick = () => { done(inp.value.trim()); close(); };
      $('[data-no]', m).onclick = close;
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !multi) { done(inp.value.trim()); close(); } if (e.key === 'Escape') close(); });
    });
  }
  const spark = (cv, lines, max) => {
    if (!cv) return;
    const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (!w) return;
    cv.width = w * dpr; cv.height = h * dpr;
    const c = cv.getContext('2d'); c.scale(dpr, dpr);
    c.strokeStyle = 'rgba(0,255,110,.12)'; c.beginPath(); for (let i = 1; i < 4; i++) { c.moveTo(0, (h / 4) * i); c.lineTo(w, (h / 4) * i); } c.stroke();
    for (const l of lines) {
      if (!l.data.length) continue;
      c.strokeStyle = l.color; c.lineWidth = 1.5; c.beginPath();
      l.data.forEach((v, i) => { const x = (i / Math.max(1, l.data.length - 1)) * w, y = h - Math.min(1, (v || 0) / max) * (h - 2) - 1; i ? c.lineTo(x, y) : c.moveTo(x, y); });
      c.stroke();
    }
  };

  // ---------------- data ----------------
  async function load() {
    try { S.d = await call('gmGet'); S.scanning = !!S.d.scanning; } catch {}
    return S.d;
  }
  const settings = () => S.d.settings;
  const setSettings = (patch) => { S.d.settings = deepMerge(S.d.settings, patch); return call('gmSet', { settings: patch }); };
  const deepMerge = (a, b) => { const o = { ...a }; for (const k of Object.keys(b)) o[k] = a[k] && typeof a[k] === 'object' && !Array.isArray(a[k]) && b[k] && typeof b[k] === 'object' ? deepMerge(a[k], b[k]) : b[k]; return o; };
  function enriched() {
    const by = {};
    for (const s of S.d.sessions || []) { const b = (by[s.game] = by[s.game] || { min: 0, last: 0 }); b.min += (s.end - s.start) / 60000; b.last = Math.max(b.last, s.end); }
    return (S.d.games || []).map((g) => {
      const m = (S.d.meta || {})[g.id] || {}, t = by[g.id] || { min: 0, last: 0 };
      return { ...g, m, title: m.rename || g.name, play: Math.max(g.steamMin || 0, t.min), tracked: t.min, lastPlayed: Math.max(g.last || 0, t.last, m.launched || 0) };
    });
  }
  const gameBy = (id) => enriched().find((g) => g.id === id);

  // ---------------- tabs ----------------
  let timers = [];
  function stopTimers() { timers.forEach(clearInterval); timers = []; cancelAnimationFrame(padRaf); }
  async function show(tab) {
    S.tab = tab; LSset('tab', tab);
    stopTimers();
    $$('.gh-tabs button', root).forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
    await load();
    ({ library: renderLibrary, mode: renderMode, play: renderPlay, perf: renderPerf, tools: renderTools })[tab]();
    renderBanner(); renderTog();
  }
  $('.gh-tabs', root).addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) show(b.dataset.t); });

  // ---------------- active session banner ----------------
  function renderBanner() {
    const a = S.d.active, el = $('#gh-banner', root);
    el.classList.toggle('hidden', !a);
    if (!a) return;
    const upd = () => { const s = Math.floor((Date.now() - a.start) / 1000); el.innerHTML = `<i class="dot"></i> NOW PLAYING <b>${esc(a.name)}</b> <span class="t">${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}</span>${GM.on ? '<em>GAME MODE ON</em>' : ''}`; };
    upd(); clearInterval(renderBanner.t); renderBanner.t = setInterval(() => { if (!S.d.active) return clearInterval(renderBanner.t); upd(); }, 1000);
  }

  // =========================================================================================================
  // LIBRARY
  // =========================================================================================================
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    io.unobserve(e.target);
    const id = e.target.dataset.id;
    call('gmCover', id).then((u) => { if (u) { e.target.style.backgroundImage = `url(${u})`; e.target.classList.add('img'); } }).catch(() => {});
  }), { root: null, rootMargin: '200px' }) : null;

  function renderLibrary() {
    const all = enriched();
    const have = [...new Set(all.map((g) => g.launcher))];
    body.innerHTML = `<div class="gh-bar">
      <input id="gh-q" type="search" placeholder="search ${all.length} games…" value="${esc(S.q)}">
      <div class="gh-chips" id="gh-lch"><button data-l="all" class="${S.launcher === 'all' ? 'on' : ''}">ALL</button>${have.map((l) => `<button data-l="${l}" class="${S.launcher === l ? 'on' : ''}">${LAUNCHERS[l] || l}</button>`).join('')}</div>
      <select id="gh-sort">${[['recent', 'RECENT'], ['az', 'A-Z'], ['most', 'MOST PLAYED'], ['size', 'SIZE']].map((o) => `<option value="${o[0]}" ${S.sort === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select>
      <button class="chip ${S.onlyFav ? 'on' : ''}" id="gh-fav">★ FAVOURITES</button>
      <button class="chip ${S.showHidden ? 'on' : ''}" id="gh-hid">SHOW HIDDEN</button>
      <span class="grow"></span><button class="chip" id="gh-add" title="Add a game the scan can't find: pick its .exe or a shortcut">+ ADD GAME</button><button class="chip" id="gh-scan">${S.scanning ? 'SCANNING…' : 'RESCAN'}</button></div>
      <div id="gh-grid" class="gh-grid"></div>`;
    $('#gh-q', root).oninput = (e) => { S.q = e.target.value; renderGrid(); };
    $('#gh-lch', root).onclick = (e) => { const b = e.target.closest('button'); if (!b) return; S.launcher = b.dataset.l; renderLibrary(); };
    $('#gh-sort', root).onchange = (e) => { S.sort = e.target.value; LSset('sort', S.sort); renderGrid(); };
    $('#gh-fav', root).onclick = () => { S.onlyFav = !S.onlyFav; renderLibrary(); };
    $('#gh-hid', root).onclick = () => { S.showHidden = !S.showHidden; renderLibrary(); };
    $('#gh-scan', root).onclick = async () => { S.scanning = true; renderLibrary(); await call('gmScan'); };
    $('#gh-add', root).onclick = async () => { const r = await call('gmAdd'); if (r?.error) toast(r.error, true); else if (r) { toast(`ADDED ${r.name.toUpperCase()}`); show('library'); } };
    renderGrid();
  }
  function renderGrid() {
    const grid = $('#gh-grid', root);
    if (!grid) return;
    let list = enriched().filter((g) => (S.showHidden || !g.m.hidden) && (S.launcher === 'all' || g.launcher === S.launcher) && (!S.onlyFav || g.m.fav)
      && (!S.q || `${g.title} ${(g.m.tags || []).join(' ')} ${g.launcher}`.toLowerCase().includes(S.q.toLowerCase())));
    const key = { recent: (a, b) => b.lastPlayed - a.lastPlayed || a.title.localeCompare(b.title), az: (a, b) => a.title.localeCompare(b.title), most: (a, b) => b.play - a.play, size: (a, b) => b.size - a.size }[S.sort];
    list.sort((a, b) => (b.m.fav ? 1 : 0) - (a.m.fav ? 1 : 0) || key(a, b));
    if (!list.length) {
      grid.innerHTML = `<div class="gh-empty"><b>${S.scanning ? 'LOOKING FOR GAMES…' : S.d.games.length ? 'NOTHING MATCHES' : 'NO GAMES FOUND YET'}</b><p>${S.d.games.length ? 'Clear the search or the launcher filter.' : 'HYPERSPACE looks for Steam, Epic, GOG, Ubisoft, EA, Battle.net and Xbox installs. A game it can\'t see (a standalone one, an emulator) goes in with <b>+ ADD GAME</b>. Use <b>RESCAN</b> after installing something.'}</p></div>`;
      return;
    }
    grid.innerHTML = list.map((g) => `<div class="gh-card ${g.m.hidden ? 'dim' : ''}" data-id="${esc(g.id)}">
      <div class="gh-art" data-id="${esc(g.id)}" style="--h:${hue(g.title)}"><span>${esc(initials(g.title))}</span><i class="gh-l">${LAUNCHERS[g.launcher] || g.launcher}</i><button class="gh-star ${g.m.fav ? 'on' : ''}" data-star title="favourite">${g.m.fav ? '★' : '☆'}</button><div class="gh-play">▶ PLAY</div></div>
      <div class="gh-name" title="${esc(g.title)}">${esc(g.title)}</div>
      <div class="gh-meta">${g.play ? hrs(g.play) + ' played' : 'not played'} · ${ago(g.lastPlayed)}${g.size ? ' · ' + fmtBytes(g.size) : ''}</div>
      ${(g.m.tags || []).length ? `<div class="gh-tags">${g.m.tags.map((t) => `<i>${esc(t)}</i>`).join('')}</div>` : ''}</div>`).join('');
    $$('.gh-art', grid).forEach((a) => io ? io.observe(a) : null);
  }
  async function launchGame(id) {
    const g = gameBy(id);
    const r = await call('gmLaunch', id);
    if (r.ok) { toast(`LAUNCHING ${(g?.title || '').toUpperCase()}`); say(`launching ${g?.title || 'a game'}`); }
    else toast(`COULD NOT LAUNCH: ${r.error}`, true);
  }
  async function meta(id, patch) { S.d.meta[id] = await call('gmMeta', id, patch); }
  root.addEventListener('click', async (e) => {
    const card = e.target.closest('.gh-card');
    if (!card) return;
    const id = card.dataset.id;
    if (e.target.closest('[data-star]')) { const g = gameBy(id); await meta(id, { fav: !g.m.fav }); return renderGrid(); }
    launchGame(id);
  });
  root.addEventListener('contextmenu', (e) => {
    const card = e.target.closest('.gh-card');
    if (!card || !window.hsMenu) return;
    const g = gameBy(card.dataset.id);
    if (!g) return;
    const mode = g.m.mode || 'global';
    window.hsMenu(e, [
      { label: 'Launch', run: () => launchGame(g.id) },
      { label: 'Open install folder', run: () => call('gmOpenDir', g.id).then((ok) => !ok && toast('FOLDER NOT FOUND', true)), off: !g.dir },
      { label: 'Copy install path', run: () => { navigator.clipboard.writeText(g.dir || ''); toast('PATH COPIED'); }, off: !g.dir },
      '-',
      { label: g.m.fav ? 'Remove favourite' : 'Make favourite', run: async () => { await meta(g.id, { fav: !g.m.fav }); renderGrid(); } },
      { label: g.m.hidden ? 'Unhide' : 'Hide from library', run: async () => { await meta(g.id, { hidden: !g.m.hidden }); renderGrid(); } },
      { label: 'Rename…', run: () => ask('Name', g.title, async (v) => { await meta(g.id, { rename: v === g.name ? '' : v }); renderGrid(); }) },
      { label: 'Tags…', run: () => ask('Tags (comma separated)', (g.m.tags || []).join(', '), async (v) => { await meta(g.id, { tags: v.split(',').map((x) => x.trim()).filter(Boolean) }); renderGrid(); }) },
      { label: g.m.note ? 'Edit note…' : 'Add note…', run: () => ask(`Note for ${g.title}`, g.m.note || '', async (v) => { await meta(g.id, { note: v }); toast('NOTE SAVED'); }, true) },
      '-',
      ...[['global', 'USE THE GLOBAL SETTINGS'], ['off', 'NEVER TOUCH MY PC'], ['light', 'LIGHT: RAM + visuals'], ['max', 'FULL: cooling boost, tasks']].map(([k, l]) => ({ label: `Game mode · ${mode === k ? '● ' : ''}${l}`, run: async () => { await meta(g.id, { mode: k }); toast(`GAME MODE FOR ${g.title.toUpperCase()}: ${k.toUpperCase()}`); } })),
      ...(g.launcher === 'custom' ? ['-', { label: 'Remove from list', danger: true, run: async () => { await call('gmRemove', g.id); show('library'); } }] : []),
    ], g.title);
  });
  hs.on('gm-scan', (r) => { S.scanning = !r.done; if (r.done && HS.view === 'gamehub') { if (S.tab === 'library') show('library'); } });

  // =========================================================================================================
  // GAME MODE
  // =========================================================================================================
  const PROTECTED = /^(system|registry|smss|csrss|wininit|winlogon|services|lsass|svchost|dwm|explorer|fontdrvhost|sihost|ctfmon|taskhostw|runtimebroker|searchhost|startmenuexperiencehost|shellexperiencehost|textinputhost|audiodg|spoolsv|msmpeng|securityhealth\w*|nissrv|wudfhost|conhost|hyperspace|hypercore|electron|steam\w*|epicgameslauncher|galaxyclient|ubisoftconnect|origin|eadesktop|battle\.net)$/i;
  const GM = { on: false, why: '' };
  const profileFor = (gid) => {
    const mode = (gid && (S.d.meta[gid] || {}).mode) || 'global', g = settings().mode;
    if (mode === 'off') return null;
    if (mode === 'light') return { ram: true, visuals: true, wallpaper: true, fan: '', power: false, endTasks: false };
    if (mode === 'max') return { ram: true, visuals: true, wallpaper: true, fan: 'b-boost', power: true, endTasks: true };
    return g;
  };
  async function confirmEnd(list) {
    if (S.d.endConfirmed) return true;
    return new Promise((res) => modal(`<b>CLOSE THESE APPS WHEN GAME MODE STARTS?</b><p>${list.map((x) => `<code>${esc(x)}</code>`).join(' ')}</p><p class="dim">They are closed like END TASK in the task manager, so unsaved work in them is lost. System processes are never touched. This question is asked once.</p><div class="gh-row"><button class="chip" data-ok>YES, CLOSE THEM</button><button class="chip" data-no>NOT NOW</button></div>`, (m, close) => {
      let done = false;
      $('[data-ok]', m).onclick = () => { done = true; call('gmSet', { endConfirmed: true }); S.d.endConfirmed = true; close(); res(true); };
      $('[data-no]', m).onclick = () => { close(); res(false); };
      m.addEventListener('click', (e) => { if (e.target === m && !done) res(false); });
    }));
  }
  async function modeOn(gid, auto) {
    if (GM.on) return;
    const p = profileFor(gid);
    if (!p) return;
    const prev = { at: Date.now(), game: gid || null, touched: [] };
    const did = [], skipped = [];
    GM.on = true; renderTog();
    try {
      if (p.wallpaper && HS.config.wallpaper?.enabled) { await call('wallSet', { enabled: false }); prev.touched.push('wall'); did.push('wallpaper paused'); }
      if (p.wallpaper && HS.config.spout?.enabled) { await call('spoutSet', { enabled: false }); prev.touched.push('spout'); did.push('spout paused'); }
      if (p.visuals) { prev.lite = HS.config.lite?.mode || 'auto'; await call('liteSet', { mode: 'on' }); prev.touched.push('lite'); did.push('HYPERSPACE visuals lowered'); }
      if (p.fan) {
        const btn = document.querySelector(`#fp-list button[data-id="${p.fan}"]`);
        if (btn && !btn.disabled && HS.core.elevated) { prev.fanId = p.fan; btn.click(); prev.touched.push('fan'); did.push('cooling preset'); } else skipped.push('cooling preset (needs admin hardware core)');
      }
      if (p.power) {
        if (HS.core.elevated) { try { prev.profile = (await coreCall('power.get')).acerProfile; await coreCall('power.set', { key: 'acerProfile', value: 'turbo' }); prev.touched.push('power'); did.push('performance profile'); } catch { skipped.push('performance profile (refused)'); } } else skipped.push('performance profile (needs admin)');
      }
      if (p.ram) { try { const r = await coreCall('mem.run', { trim: HS.config.vacuum?.trim !== false }); did.push(`RAM cleaned (+${fmtBytes(Math.max(0, r.availableAfter - r.availableBefore))})`); } catch { skipped.push('RAM cleanup (needs admin)'); } }
      if (p.endTasks && S.d.endList.length) {
        if (await confirmEnd(S.d.endList)) {
          const procs = (await call('procs')).list || [];
          let n = 0;
          for (const pr of procs) if (S.d.endList.some((x) => x.toLowerCase().replace(/\.exe$/, '') === String(pr.name).toLowerCase().replace(/\.exe$/, '')) && !PROTECTED.test(String(pr.name).replace(/\.exe$/i, ''))) { const r = await call('kill', pr.pid); if (r.ok) n++; }
          did.push(`${n} app(s) closed`);
        } else skipped.push('closing apps (declined)');
      }
    } catch (e) { skipped.push(e.message); }
    await call('gmSet', { restore: prev });
    toast(`GAME MODE ON · ${did.join(' · ') || 'nothing to change'}${skipped.length ? ` · skipped: ${skipped.join(', ')}` : ''}`);
    say(auto ? 'game mode on' : 'game mode enabled');
    renderBanner(); renderTog();
  }
  async function modeOff(quietly) {
    const prev = (await call('gmGet')).restore;
    GM.on = false; renderTog();
    if (!prev) return;
    const t = prev.touched || [];
    try {
      if (t.includes('wall')) await call('wallSet', { enabled: true });
      if (t.includes('spout')) await call('spoutSet', { enabled: true });
      if (t.includes('lite')) await call('liteSet', { mode: prev.lite || 'auto' });
      if (t.includes('fan') && HS.config.fanActive?.id === prev.fanId) { const rv = document.querySelector('#fp-revert'); if (rv && !rv.disabled) rv.click(); }
      if (t.includes('power') && prev.profile && HS.core.elevated) await coreCall('power.set', { key: 'acerProfile', value: prev.profile });
    } catch {}
    await call('gmSet', { restore: null });
    if (!quietly) toast('GAME MODE OFF · EVERYTHING PUT BACK');
    renderBanner(); renderTog();
  }
  function renderTog() {
    const t = $('#gh-gmtog', root);
    t.classList.toggle('on', GM.on);
    t.lastElementChild.textContent = GM.on ? 'ON' : 'OFF';
  }
  $('#gh-gmtog', root).onclick = () => (GM.on ? modeOff() : modeOn(S.d.active?.game || null));
  hs.on('gm-session', async (e) => {
    await load();
    if (e.state === 'start') { say(`${e.name}: have fun`); if (settings().auto) await modeOn(e.game, true); }
    else if (GM.on && GM.auto !== false && S.d.restore) { await modeOff(); }
    if (HS.view === 'gamehub') { renderBanner(); if (S.tab === 'play') renderPlay(); }
  });
  hs.on('gm-say', (t) => say(t));
  hs.on('gm-settings', (s) => { S.d.settings = s; });

  function renderMode() {
    const m = settings().mode, ps = Array.isArray(HS.config.fanPresets) ? HS.config.fanPresets : [];
    const fans = [['', 'DON\'T TOUCH THE FANS'], ['b-quiet', 'QUIET'], ['b-balanced', 'BALANCED'], ['b-loud', 'LOUD'], ['b-boost', 'GAMING BOOST'], ...ps.map((p) => [p.id, p.name])];
    const row = (k, t, d, extra = '') => `<label class="gh-opt"><input type="checkbox" data-m="${k}" ${m[k] ? 'checked' : ''}><span><b>${t}</b><em>${d}</em>${extra}</span></label>`;
    body.innerHTML = `<div class="gh-cols"><div class="gh-card2"><h3>WHAT GAME MODE DOES</h3>
      <p class="dim">Press <b>GAME MODE</b> at the top right, or let it start by itself when a game opens. Everything it changes is remembered and put back when it ends, even after a crash or restart.</p>
      ${row('ram', 'CLEAN RAM', 'runs the same RAM cleanup as OPERATIONS (admin hardware core needed)')}
      ${row('visuals', 'LOWER HYPERSPACE VISUALS', 'switches the app to its light look so it uses less GPU')}
      ${row('wallpaper', 'PAUSE LIVE WALLPAPER AND VJ OUTPUT', 'frees the GPU from background visuals')}
      ${row('power', 'RAISE THE PERFORMANCE PROFILE', 'sets the thermal profile to turbo (admin hardware core needed)')}
      ${row('endTasks', 'CLOSE MY CHOSEN APPS', 'the list on the right; asks once before the first use')}
      <label class="gh-opt"><span><b>COOLING PRESET</b><em>uses the presets from FANS (admin hardware core needed)</em><select data-fan>${fans.map((f) => `<option value="${esc(f[0])}" ${m.fan === f[0] ? 'selected' : ''}>${esc(f[1])}</option>`).join('')}</select></span></label>
      <label class="gh-opt hl"><input type="checkbox" id="gh-auto" ${settings().auto ? 'checked' : ''}><span><b>AUTO: START WHEN A GAME OPENS</b><em>needs "watch for running games" in PLAYTIME. Per-game choices are in the right-click menu in LIBRARY.</em></span></label>
      <div class="gh-note">No Windows API is used for do-not-disturb or per-app audio ducking, so those are not part of it.</div></div>
    <div class="gh-card2"><h3>APPS TO CLOSE</h3><p class="dim">Pick apps that eat memory while you play (browsers, chat, cloud sync). Nothing is closed unless "close my chosen apps" is on.</p>
      <div class="gh-chips" id="gh-endlist">${S.d.endList.map((x) => `<span class="gh-tag">${esc(x)} <button data-del="${esc(x)}">✕</button></span>`).join('') || '<span class="dim">nothing chosen yet</span>'}</div>
      <div class="gh-row"><select id="gh-pick"><option value="">pick a running app…</option></select><button class="chip" id="gh-pickadd">ADD</button></div>
      <h3 style="margin-top:16px">STATE NOW</h3><div class="dim" id="gh-gmstate">${GM.on ? 'GAME MODE IS ON.' : 'GAME MODE IS OFF.'}</div></div></div>`;
    $$('[data-m]', body).forEach((c) => (c.onchange = () => setSettings({ mode: { [c.dataset.m]: c.checked } })));
    $('[data-fan]', body).onchange = (e) => setSettings({ mode: { fan: e.target.value } });
    $('#gh-auto', body).onchange = (e) => { setSettings({ auto: e.target.checked }); if (e.target.checked && !settings().track) { setSettings({ track: true }); toast('WATCHING FOR GAMES SWITCHED ON (NEEDED FOR AUTO)'); } };
    $('#gh-endlist', body).onclick = async (e) => { const b = e.target.closest('[data-del]'); if (!b) return; S.d.endList = S.d.endList.filter((x) => x !== b.dataset.del); await call('gmSet', { endList: S.d.endList }); renderMode(); };
    $('#gh-pickadd', body).onclick = async () => { const v = $('#gh-pick', body).value; if (!v) return; if (PROTECTED.test(v.replace(/\.exe$/i, ''))) return toast('THAT ONE IS PROTECTED', true); if (!S.d.endList.includes(v)) S.d.endList.push(v); S.d.endConfirmed = false; await call('gmSet', { endList: S.d.endList, endConfirmed: false }); renderMode(); };
    call('procs').then((r) => {
      const names = [...new Set((r.list || []).filter((p) => (p.mem || 0) > 80e6 && !PROTECTED.test(String(p.name).replace(/\.exe$/i, ''))).sort((a, b) => b.mem - a.mem).map((p) => p.name))].slice(0, 40);
      const sel = $('#gh-pick', body); if (sel) sel.innerHTML += names.map((n) => `<option>${esc(n)}</option>`).join('');
    }).catch(() => {});
  }

  // =========================================================================================================
  // PLAYTIME
  // =========================================================================================================
  function renderPlay() {
    const ss = S.d.sessions || [], now = Date.now(), wk = now - 7 * 864e5;
    const weekMin = ss.filter((s) => s.end > wk).reduce((a, s) => a + (s.end - Math.max(s.start, wk)) / 60000, 0);
    const per = {}; ss.forEach((s) => { per[s.game] = per[s.game] || { name: s.name, min: 0, n: 0 }; per[s.game].min += (s.end - s.start) / 60000; per[s.game].n++; });
    const top = Object.values(per).sort((a, b) => b.min - a.min).slice(0, 8);
    const longest = ss.reduce((m, s) => ((s.end - s.start) > (m ? m.end - m.start : 0) ? s : m), null);
    const days = Array.from({ length: 14 }, (_, i) => { const d = new Date(now - (13 - i) * 864e5); d.setHours(0, 0, 0, 0); return { t: d.getTime(), min: 0 }; });
    ss.forEach((s) => days.forEach((d) => { const a = Math.max(s.start, d.t), b = Math.min(s.end, d.t + 864e5); if (b > a) d.min += (b - a) / 60000; }));
    const dmax = Math.max(60, ...days.map((d) => d.min));
    const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
    ss.forEach((s) => { for (let t = s.start; t < s.end; t += 6e4 * 5) { const d = new Date(t); heat[(d.getDay() + 6) % 7][d.getHours()] += 5; } });
    const hmax = Math.max(1, ...heat.flat());
    body.innerHTML = `<div class="gh-card2 hl"><label class="gh-opt"><input type="checkbox" id="gh-track" ${settings().track ? 'checked' : ''}><span><b>WATCH FOR RUNNING GAMES</b><em>every 15 seconds HYPERSPACE looks at the process list for the games in your library and logs when you play, with average CPU/GPU load and temperatures. Stays on this PC (gaming.json). Off by default.</em></span></label></div>
      ${ss.length ? '' : '<div class="gh-empty"><b>NO SESSIONS YET</b><p>Switch the watcher on, then just play. A session shorter than a minute is ignored.</p></div>'}
      <div class="gh-stats"><div><b>${hrs(weekMin)}</b><span>THIS WEEK</span></div><div><b>${hrs(ss.reduce((a, s) => a + (s.end - s.start) / 60000, 0))}</b><span>TRACKED TOTAL</span></div><div><b>${top[0] ? esc(top[0].name) : '—'}</b><span>MOST PLAYED</span></div><div><b>${longest ? hrs((longest.end - longest.start) / 60000) : '—'}</b><span>LONGEST SESSION${longest ? ' · ' + esc(longest.name) : ''}</span></div><div><b>${ss.length}</b><span>SESSIONS</span></div></div>
      <div class="gh-cols"><div class="gh-card2"><h3>MOST PLAYED</h3>${top.map((t) => `<div class="gh-bar2"><span>${esc(t.name)}</span><i style="width:${(t.min / top[0].min) * 100}%"></i><em>${hrs(t.min)}</em></div>`).join('') || '<span class="dim">—</span>'}</div>
      <div class="gh-card2"><h3>LAST 14 DAYS</h3><div class="gh-days">${days.map((d) => `<div title="${new Date(d.t).toLocaleDateString()} · ${hrs(d.min)}"><i style="height:${(d.min / dmax) * 100}%"></i><span>${new Date(d.t).getDate()}</span></div>`).join('')}</div></div></div>
      <div class="gh-card2"><h3>WHEN YOU PLAY</h3><div class="gh-heat">${heat.map((r, i) => `<span class="rl">${'MTWTFSS'[i]}</span>${r.map((v, h) => `<i title="${'MTWTFSS'[i]} ${h}:00 · ${hrs(v)}" style="opacity:${v ? 0.15 + (v / hmax) * 0.85 : 0.05}"></i>`).join('')}`).join('')}<span></span>${Array.from({ length: 24 }, (_, h) => `<span class="cl">${h % 6 ? '' : h}</span>`).join('')}</div></div>
      <div class="gh-card2"><h3>SESSION HISTORY</h3><div id="gh-hist">${ss.slice(-30).reverse().map((s) => `<div class="gh-sess" data-sid="${s.id}"><b>${esc(s.name)}</b><span>${new Date(s.start).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span><span>${hrs((s.end - s.start) / 60000)}</span><span>CPU ${s.n ? Math.round(s.cpu / s.n) : 0}% · GPU ${s.n ? Math.round(s.gpu / s.n) : 0}%</span><span>${s.ctN ? `CPU ${Math.round(s.ct / s.ctN)}°` : ''}${s.gtN ? ` · GPU ${Math.round(s.gt / s.gtN)}°` : ''} <em>peak ${Math.max(s.ctMax || 0, s.gtMax || 0)}°</em></span></div><canvas class="gh-ss hidden" id="ss-${s.id}"></canvas>`).join('') || '<span class="dim">—</span>'}</div></div>`;
    $('#gh-track', body).onchange = async (e) => { await setSettings({ track: e.target.checked }); toast(e.target.checked ? 'WATCHING FOR GAMES' : 'NO LONGER WATCHING'); };
    $('#gh-hist', body)?.addEventListener('click', async (e) => {
      const r = e.target.closest('[data-sid]'); if (!r) return;
      const cv = $(`#ss-${r.dataset.sid}`, body); cv.classList.toggle('hidden');
      if (!cv.classList.contains('hidden')) { const ser = await call('gmSession', r.dataset.sid); if (!ser) { cv.outerHTML = '<div class="dim">no detail kept for old sessions</div>'; return; } spark(cv, [{ data: ser.map((x) => x[0]), color: '#ffc400' }, { data: ser.map((x) => x[1]), color: '#ff2d55' }, { data: ser.map((x) => x[2]), color: '#00ff6e' }, { data: ser.map((x) => x[3]), color: '#1de9b6' }], 100); }
    });
  }

  // =========================================================================================================
  // PERFORMANCE
  // =========================================================================================================
  const H = { cpu: [], gpu: [], ct: [], gt: [], ping: [] };
  let pingMs = null, powerMode = '—';
  function renderPerf() {
    const ov = settings().overlay, ch = settings().crosshair;
    const STY = ['DOT', 'CROSS', 'CROSS GAP', 'THIN +', 'RING', 'RING + DOT', 'T-SHAPE', 'X'];
    body.innerHTML = `<div class="gh-cards" id="gh-live"></div><div class="gh-card2"><canvas id="gh-pf" class="gh-big"></canvas><div class="gh-leg"><i style="--c:#00ff6e">CPU %</i><i style="--c:#1de9b6">GPU %</i><i style="--c:#ffc400">CPU °C</i><i style="--c:#ff2d55">GPU °C</i></div><div id="gh-warn"></div></div>
      <div class="gh-cols"><div class="gh-card2"><h3>NETWORK LATENCY</h3><label class="gh-opt"><input type="checkbox" id="gh-ping" ${settings().pingOn ? 'checked' : ''}><span><b>PING A HOST</b><em>off by default. Sends one small ping every 5 seconds to the host you type, only while this is on.</em></span></label><div class="gh-row"><input id="gh-host" type="text" value="${esc(settings().pingHost)}" placeholder="1.1.1.1"><b id="gh-pingms" class="big">—</b></div></div>
      <div class="gh-card2"><h3>IN-GAME STATS OVERLAY</h3><p class="dim">A small see-through box that never takes clicks or focus. Works over borderless/windowed games (not exclusive fullscreen).</p>
        <label class="gh-opt"><input type="checkbox" id="gh-ov" ${ov.on ? 'checked' : ''}><span><b>SHOW OVERLAY</b><em>CPU/GPU temp, load, clock, RAM</em></span></label>
        <label class="gh-opt"><input type="checkbox" id="gh-ovg" ${ov.onlyInGame ? 'checked' : ''}><span><b>ONLY WHILE A GAME IS RUNNING</b></span></label>
        <div class="gh-row">${['tl', 'tr', 'bl', 'br'].map((c) => `<button class="chip ${ov.corner === c ? 'on' : ''}" data-c="${c}">${{ tl: '↖', tr: '↗', bl: '↙', br: '↘' }[c]}</button>`).join('')}<label>SIZE <input type="range" id="gh-ovs" min="0.7" max="1.8" step="0.1" value="${ov.scale}"></label><label>OPACITY <input type="range" id="gh-ovo" min="0.3" max="1" step="0.05" value="${ov.opacity}"></label></div></div></div>
      <div class="gh-card2"><h3>CROSSHAIR OVERLAY</h3><p class="dim">A dot or crosshair painted in the middle of the screen, click-through. Only for borderless/windowed games; some online games' anti-cheat dislikes overlays, so check yours first.</p>
        <div class="gh-row"><label class="gh-opt" style="flex:1"><input type="checkbox" id="gh-ch" ${ch.on ? 'checked' : ''}><span><b>SHOW CROSSHAIR</b></span></label><label class="gh-opt" style="flex:1"><input type="checkbox" id="gh-chk" ${ch.hotkey ? 'checked' : ''}><span><b>HOTKEY CTRL+ALT+X</b><em>only registered while ticked</em></span></label></div>
        <div class="gh-chips" id="gh-sty">${STY.map((s, i) => `<button data-s="${i}" class="${ch.style === i ? 'on' : ''}">${s}</button>`).join('')}</div>
        <div class="gh-row"><label>COLOUR <input type="color" id="gh-chc" value="${esc(ch.color)}"></label><label>SIZE <input type="range" id="gh-chs" min="8" max="80" value="${ch.size}"></label><label>OPACITY <input type="range" id="gh-cho" min="0.2" max="1" step="0.05" value="${ch.opacity}"></label></div></div>`;
    const set = (p) => setSettings(p);
    $('#gh-ping', body).onchange = (e) => set({ pingOn: e.target.checked });
    $('#gh-host', body).onchange = (e) => set({ pingHost: e.target.value.trim() });
    $('#gh-ov', body).onchange = (e) => set({ overlay: { on: e.target.checked } });
    $('#gh-ovg', body).onchange = (e) => set({ overlay: { onlyInGame: e.target.checked } });
    $$('[data-c]', body).forEach((b) => (b.onclick = () => { set({ overlay: { corner: b.dataset.c } }); $$('[data-c]', body).forEach((x) => x.classList.toggle('on', x === b)); }));
    $('#gh-ovs', body).oninput = (e) => set({ overlay: { scale: +e.target.value } });
    $('#gh-ovo', body).oninput = (e) => set({ overlay: { opacity: +e.target.value } });
    $('#gh-ch', body).onchange = (e) => set({ crosshair: { on: e.target.checked } });
    $('#gh-chk', body).onchange = (e) => set({ crosshair: { hotkey: e.target.checked } });
    $('#gh-sty', body).onclick = (e) => { const b = e.target.closest('[data-s]'); if (!b) return; set({ crosshair: { style: +b.dataset.s } }); $$('#gh-sty button', body).forEach((x) => x.classList.toggle('on', x === b)); };
    $('#gh-chc', body).oninput = (e) => set({ crosshair: { color: e.target.value } });
    $('#gh-chs', body).oninput = (e) => set({ crosshair: { size: +e.target.value } });
    $('#gh-cho', body).oninput = (e) => set({ crosshair: { opacity: +e.target.value } });
    liveTick();
    timers.push(setInterval(liveTick, 1000));
    timers.push(setInterval(async () => { if (!settings().pingOn) { pingMs = null; return; } const r = await call('gmPing', settings().pingHost); pingMs = r.ok ? r.ms : null; H.ping.push(pingMs); if (H.ping.length > 60) H.ping.shift(); const el = $('#gh-pingms', body); if (el) el.textContent = r.ok ? `${r.ms} ms` : 'no reply'; }, 5000));
    timers.push(setInterval(async () => { try { powerMode = (await coreCall('power.get')).acerProfile || '—'; } catch {} }, 10000));
  }
  function liveTick() {
    const p = HS.data.perf, t = HS.telemetry || {}, el = $('#gh-live', body);
    if (!p || !el || S.tab !== 'perf') return;
    const g = t.gpu || {}, ct = t.cpu?.temp ?? p.temps?.cpu, gt = t.gpuTemp ?? p.temps?.gpu;
    H.cpu.push(p.cpu); H.gpu.push(p.gpu); H.ct.push(ct ?? 0); H.gt.push(gt ?? 0);
    for (const k of ['cpu', 'gpu', 'ct', 'gt']) if (H[k].length > 90) H[k].shift();
    const al = HS.config.thermalAlerts || {}, wc = al.cpuWarn || 85, wg = al.gpuWarn || 85;
    const hot = (v, w) => (v != null && v >= w ? 'bad' : '');
    const tile = (l, v, s, c = '') => `<div class="gh-tile ${c}"><span>${l}</span><b>${v}</b><em>${s || ''}</em></div>`;
    const memP = Math.round((p.mem.used / p.mem.total) * 100);
    el.innerHTML = tile('CPU', `${Math.round(p.cpu)}%`, `${ct != null ? ct + '°C' : '—'}${t.cpu?.clock ? ' · ' + Math.round(t.cpu.clock) + ' MHz' : ''}`, hot(ct, wc))
      + tile('GPU', `${Math.round(p.gpu)}%`, `${gt != null ? gt + '°C' : '—'}${g.clock ? ' · ' + Math.round(g.clock) + ' MHz' : ''}`, hot(gt, wg))
      + tile('VRAM', g.memTotal ? `${Math.round((g.memUsed / g.memTotal) * 100)}%` : '—', g.memTotal ? `${fmtBytes(g.memUsed)} / ${fmtBytes(g.memTotal)}` : 'needs the hardware core')
      + tile('RAM', `${memP}%`, `${fmtBytes(p.mem.used)} / ${fmtBytes(p.mem.total)}`)
      + tile('PING', pingMs != null ? `${pingMs} ms` : '—', settings().pingOn ? settings().pingHost : 'off')
      + tile('POWER', p.battery ? `${p.battery.pct}%` : 'AC', `${p.battery ? (p.battery.charging ? 'charging' : 'on battery') : 'no battery'} · profile ${String(powerMode).toUpperCase()}`);
    const warn = [];
    if (hot(ct, wc)) warn.push(`CPU at ${ct}°C: close to throttling`); if (hot(gt, wg)) warn.push(`GPU at ${gt}°C: close to throttling`);
    if (p.battery && !p.battery.charging) warn.push('on battery: plug in for full performance');
    $('#gh-warn', body).innerHTML = warn.map((w) => `<div class="gh-w">⚠ ${esc(w)}</div>`).join('');
    spark($('#gh-pf', body), [{ data: H.cpu, color: '#00ff6e' }, { data: H.gpu, color: '#1de9b6' }, { data: H.ct, color: '#ffc400' }, { data: H.gt, color: '#ff2d55' }], 100);
  }

  // =========================================================================================================
  // TOOLS
  // =========================================================================================================
  let padRaf = 0, dead = LS('dead', 0.1);
  const BK = ['WISHLIST', 'BACKLOG', 'PLAYING', 'DONE'];
  const tm = { run: false, start: 0, min: 0, lastBreak: 0 };
  async function renderTools() {
    const [info, folders] = await Promise.all([call('info').catch(() => ({})), call('gmFolders').catch(() => [])]);
    const p = HS.data.perf, ram = p ? Math.round(p.mem.total / 2 ** 30) : 0;
    const gpus = (info.gpu || []).map((x) => (typeof x === 'string' ? x : x?.name || '')).filter(Boolean);
    const tier = (info.cores >= 12 && ram >= 16 && gpus.some((x) => /rtx|rx [67]|arc a7/i.test(x))) ? ['HIGH', 'Modern games at high settings, 1080p-1440p.'] : (info.cores >= 6 && ram >= 12 && gpus.some((x) => /gtx|rtx|rx|arc/i.test(x))) ? ['MID', 'Most games at medium-high 1080p.'] : ['LIGHT', 'Older and indie games; lower settings for new ones.'];
    body.innerHTML = `<div class="gh-cols"><div class="gh-card2"><h3>CONTROLLER TESTER</h3><div id="gh-pad"><div class="gh-empty"><b>NO CONTROLLER</b><p>Plug in or wake a controller and press a button on it.</p></div></div>
        <div class="gh-row"><label>DEADZONE <input type="range" id="gh-dead" min="0" max="0.5" step="0.01" value="${dead}"> <b id="gh-deadv">${dead}</b></label><button class="chip" id="gh-rumble">VIBRATION TEST</button></div></div>
      <div class="gh-card2"><h3>WHAT CAN MY PC RUN</h3><div class="gh-spec"><div><span>CPU</span><b>${esc(info.cpu || '—')} · ${info.cores || '?'} threads</b></div><div><span>GPU</span><b>${esc(gpus.join(' + ') || '—')}</b></div><div><span>RAM</span><b>${ram} GB</b></div><div><span>SYSTEM</span><b>${esc(info.machine || '')} · ${esc(info.os || '')}</b></div></div><div class="gh-verdict"><b>${tier[0]}</b> ${tier[1]} <span class="dim">A rough guide from core count, RAM and GPU name, not a benchmark.</span></div>
        <h3 style="margin-top:12px">WINDOWS SETTINGS</h3><div class="gh-chips" id="gh-uris">${[['ms-settings:gaming-gamemode', 'WINDOWS GAME MODE'], ['ms-settings:gaming-gamebar', 'XBOX GAME BAR'], ['ms-settings:gaming-captures', 'CAPTURES'], ['ms-settings:display-advancedgraphics', 'GPU PER-APP GRAPHICS'], ['ms-settings:powersleep', 'POWER'], ['ms-settings:sound', 'SOUND'], ['ms-settings:display', 'DISPLAY / REFRESH RATE']].map((u) => `<button data-u="${u[0]}">${u[1]}</button>`).join('')}</div>
        <p class="dim">Tip: turn Windows Game Mode on, set your game to "High performance" in per-app graphics, and keep GPU drivers current from your GPU maker's app.</p>
        <h3 style="margin-top:12px">CLIP + SCREENSHOT FOLDERS</h3><div class="gh-chips" id="gh-fold">${folders.map((f) => `<button data-f="${f.key}" ${f.exists ? '' : 'disabled title="folder not found"'}>${esc(f.label)}</button>`).join('')}</div></div></div>
      <div class="gh-cols"><div class="gh-card2"><h3>RANDOM GAME PICKER</h3><div class="gh-row"><select id="gh-pool"><option value="fav">FAVOURITES</option><option value="new">NEVER PLAYED</option><option value="all">ALL GAMES</option></select><button class="chip" id="gh-spin">SPIN</button></div><div class="gh-pick" id="gh-pickout">?</div><button class="chip hidden" id="gh-pickgo">LAUNCH IT</button></div>
      <div class="gh-card2"><h3>SESSION TIMER + BREAK REMINDERS</h3><p class="dim">Off until you start it. Nudges you to stand up and drink water.</p><div class="gh-row"><label>REMIND EVERY <input type="number" id="gh-tmin" min="10" max="240" value="${settings().timer.min}" style="width:60px"> MIN</label><button class="chip" id="gh-tgo">${tm.run ? 'STOP' : 'START'}</button><b class="big" id="gh-tclock">00:00:00</b></div></div></div>
      <div class="gh-card2"><h3>BACKLOG AND WISHLIST</h3><div class="gh-row"><input id="gh-bt" type="text" placeholder="title"><input id="gh-bp" type="text" placeholder="platform" style="max-width:130px"><select id="gh-bs">${BK.map((b) => `<option>${b}</option>`).join('')}</select><button class="chip" id="gh-badd">ADD</button></div><div id="gh-blist"></div></div>`;
    // controller
    $('#gh-dead', body).oninput = (e) => { dead = +e.target.value; LSset('dead', dead); $('#gh-deadv', body).textContent = dead; };
    $('#gh-rumble', body).onclick = () => { const pad = [...(navigator.getGamepads?.() || [])].find(Boolean); const a = pad?.vibrationActuator; if (!a) return toast(pad ? 'THIS CONTROLLER HAS NO VIBRATION' : 'NO CONTROLLER FOUND', true); a.playEffect('dual-rumble', { duration: 600, strongMagnitude: 1, weakMagnitude: 0.6 }).catch(() => toast('VIBRATION REFUSED', true)); };
    const padLoop = () => {
      const pad = [...(navigator.getGamepads?.() || [])].find(Boolean), box = $('#gh-pad', body);
      if (!box || S.tab !== 'tools' || HS.view !== 'gamehub') return;
      if (pad) {
        if (box.dataset.id !== pad.id) { box.dataset.id = pad.id; box.innerHTML = `<div class="dim">${esc(pad.id)}</div><div class="gh-sticks"><canvas width="130" height="130"></canvas><canvas width="130" height="130"></canvas></div><div class="gh-trig"></div><div class="gh-btns">${pad.buttons.map((_, i) => `<i>${i}</i>`).join('')}</div>`; }
        const cs = $$('canvas', box);
        [[0, 1], [2, 3]].forEach(([ax, ay], k) => {
          const c = cs[k].getContext('2d'), x = pad.axes[ax] || 0, y = pad.axes[ay] || 0;
          c.clearRect(0, 0, 130, 130); c.strokeStyle = 'rgba(0,255,110,.5)'; c.beginPath(); c.arc(65, 65, 60, 0, 7); c.stroke();
          c.strokeStyle = '#ffc400'; c.beginPath(); c.arc(65, 65, dead * 60, 0, 7); c.stroke();
          const inDead = Math.hypot(x, y) < dead; c.fillStyle = inDead ? '#0b6b33' : '#00ff6e'; c.beginPath(); c.arc(65 + x * 60, 65 + y * 60, 6, 0, 7); c.fill();
        });
        $$('.gh-btns i', box).forEach((b, i) => b.classList.toggle('on', !!pad.buttons[i]?.pressed));
        $('.gh-trig', box).innerHTML = [6, 7].filter((i) => pad.buttons[i]).map((i) => `<div class="gh-bar2"><span>TRIGGER ${i === 6 ? 'L' : 'R'}</span><i style="width:${pad.buttons[i].value * 100}%"></i><em>${Math.round(pad.buttons[i].value * 100)}%</em></div>`).join('');
      } else if (box.dataset.id) { box.dataset.id = ''; box.innerHTML = '<div class="gh-empty"><b>NO CONTROLLER</b><p>Plug in or wake a controller and press a button on it.</p></div>'; }
      padRaf = requestAnimationFrame(padLoop);
    };
    padRaf = requestAnimationFrame(padLoop);
    // links + folders
    $('#gh-uris', body).onclick = (e) => { const b = e.target.closest('[data-u]'); if (b) call('gmOpenUri', b.dataset.u); };
    $('#gh-fold', body).onclick = (e) => { const b = e.target.closest('[data-f]'); if (b) call('gmOpenFolder', b.dataset.f); };
    // picker
    let picked = null;
    $('#gh-spin', body).onclick = () => {
      const all = enriched().filter((g) => !g.m.hidden), pool = $('#gh-pool', body).value;
      const list = all.filter((g) => (pool === 'fav' ? g.m.fav : pool === 'new' ? !g.play : true));
      const out = $('#gh-pickout', body), go = $('#gh-pickgo', body);
      if (!list.length) { out.textContent = pool === 'fav' ? 'no favourites yet: star some in LIBRARY' : 'nothing to pick from'; return; }
      go.classList.add('hidden'); let n = 0, wait = 40;
      const step = () => { picked = list[(Math.random() * list.length) | 0]; out.textContent = picked.title; out.classList.add('spin'); if (++n < 24) { wait *= 1.12; setTimeout(step, wait); } else { out.classList.remove('spin'); go.classList.remove('hidden'); say(`tonight: ${picked.title}`); } };
      step();
    };
    $('#gh-pickgo', body).onclick = () => picked && launchGame(picked.id);
    // timer
    const clock = () => { const el = $('#gh-tclock', body); if (!el) return; const s = tm.run ? Math.floor((Date.now() - tm.start) / 1000) : 0; el.textContent = [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((x) => String(x).padStart(2, '0')).join(':'); };
    $('#gh-tgo', body).onclick = () => { tm.min = Math.max(10, +$('#gh-tmin', body).value || 60); setSettings({ timer: { min: tm.min } }); tm.run = !tm.run; tm.start = Date.now(); tm.lastBreak = Date.now(); $('#gh-tgo', body).textContent = tm.run ? 'STOP' : 'START'; clock(); };
    timers.push(setInterval(clock, 1000)); clock();
    // backlog
    const bl = () => $('#gh-blist', body);
    const saveBl = () => call('gmSet', { backlog: S.d.backlog });
    const drawBl = () => {
      bl().innerHTML = S.d.backlog.length ? BK.map((st) => { const rows = S.d.backlog.filter((b) => b.status === st); return rows.length ? `<h4>${st} <em>${rows.length}</em></h4>${rows.map((b) => `<div class="gh-bl" data-id="${b.id}"><b>${esc(b.title)}</b><span>${esc(b.platform || '')}</span><span class="stars" data-stars>${[1, 2, 3, 4, 5].map((i) => `<u data-r="${i}" class="${i <= (b.rating || 0) ? 'on' : ''}">★</u>`).join('')}</span><select data-st>${BK.map((x) => `<option ${x === b.status ? 'selected' : ''}>${x}</option>`).join('')}</select><button data-note title="${esc(b.note || 'add a note')}">✎</button><button data-del>✕</button></div>`).join('')}` : ''; }).join('') : '<div class="gh-empty"><b>NOTHING HERE YET</b><p>Games you want, are waiting on, or finished. Type a title above and press ADD.</p></div>';
    };
    drawBl();
    $('#gh-badd', body).onclick = () => { const t = $('#gh-bt', body).value.trim(); if (!t) return; S.d.backlog.push({ id: 'b' + Date.now(), title: t, platform: $('#gh-bp', body).value.trim(), status: $('#gh-bs', body).value, rating: 0, note: '' }); $('#gh-bt', body).value = ''; saveBl(); drawBl(); };
    bl().addEventListener('click', (e) => {
      const row = e.target.closest('.gh-bl'); if (!row) return;
      const b = S.d.backlog.find((x) => x.id === row.dataset.id); if (!b) return;
      if (e.target.closest('[data-del]')) { S.d.backlog = S.d.backlog.filter((x) => x !== b); saveBl(); drawBl(); }
      else if (e.target.closest('[data-r]')) { const r = +e.target.closest('[data-r]').dataset.r; b.rating = b.rating === r ? 0 : r; saveBl(); drawBl(); }
      else if (e.target.closest('[data-note]')) ask(`Note for ${b.title}`, b.note || '', (v) => { b.note = v; saveBl(); drawBl(); }, true);
    });
    bl().addEventListener('change', (e) => { const row = e.target.closest('.gh-bl'); const b = S.d.backlog.find((x) => x.id === row?.dataset.id); if (b && e.target.matches('[data-st]')) { b.status = e.target.value; saveBl(); drawBl(); } });
  }
  // the break timer keeps running when you leave TOOLS
  setInterval(() => {
    if (!tm.run) return;
    if (Date.now() - tm.lastBreak >= tm.min * 60000) { tm.lastBreak = Date.now(); toast('BREAK TIME: STAND UP, STRETCH, DRINK WATER', false); say('time for a break'); try { const c = new AudioContext(), o = c.createOscillator(), g = c.createGain(); o.connect(g); g.connect(c.destination); g.gain.value = 0.05; o.frequency.value = 660; o.start(); o.stop(c.currentTime + 0.25); } catch {} }
  }, 5000);

  // ---------------- start-up ----------------
  // if the app died while GAME MODE was on, put everything back unless a game is still running
  call('gmGet').then((d) => { S.d = d; if (d.restore) { if (d.active) { GM.on = true; } else modeOff(true); } }).catch(() => {});
  HS.onView((v) => { if (v === 'gamehub') show(S.tab); else stopTimers(); });
  window.hsGameHub = { open: () => { document.querySelector('.nav[data-view="gamehub"]')?.click(); }, state: S, mode: GM };
})();
