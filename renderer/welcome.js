// FIRST-RUN WELCOME QUIZ: a full-screen card stepper shown once on a fresh install (after the intro), re-runnable from
// SETTINGS > ABOUT > RETAKE SETUP QUIZ. Answers: localStorage 'hs-welcome' (JSON); flag 'hs-welcome-done'.
// Sets preferences ONLY through other modules' public storage/API (every call guarded; a missing module is skipped):
//   intro (localStorage 'intro' / INTRO.setMode), hs-clickfx (hsClickFx.set), hsActionFx.set, fx (HS.actions.setFx),
//   twr.setCfg, HS.saveConfig({thermalAlerts}), hs.call('dockSet'), setAccent, 'view' (start tab), 'hs-eggs',
//   'hs-nav-hidden' / 'hs-nav-shown' / 'hs-gaming-tab' (sidebar tiles, applied here).
// API: window.hsWelcome = { open(opts), apply(answers, opts) }.
(() => {
  'use strict';
  if (window.hs && hs.remote) return;
  const qs = new URLSearchParams(location.search);
  if (qs.has('solo')) return;
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const $1 = (s, r) => (r || document).querySelector(s);

  // ---- existing-user evidence, read NOW (this script loads before app.js, which writes 'view' on its own) ----
  const EVIDENCE = ['view', 'hs-last-version', 'intro', 'hs-eggs', 'hs-twr-cfg', 'hs-clickfx', 'welcomed', 'navOrder', 'thermal', 'settingsTab', 'hs-twr'];
  const isDone = ls.get('hs-welcome-done') === '1';
  const existing = EVIDENCE.some((k) => ls.get(k) != null);
  const testRun = qs.has('intro'); // dev snapshot runs pass ?intro: never pop the quiz over them
  const auto = !isDone && !existing && !testRun;
  if (!isDone && existing && !testRun) ls.set('hs-welcome-done', '1');
  // first-run stamp for the tips (rabbit.js): a brand-new install gets "now"; an existing install gets 0, which means "never auto-show tips"
  if (ls.get('hs-first-run') == null) ls.set('hs-first-run', (existing || testRun) ? '0' : String(Date.now()));
  if (auto) ls.set('welcomed', '1'); // the older one-card welcome stays quiet; this replaces it

  // ---- sidebar tiles ----
  const TILE_USE = { afterburner: ['system'], hardware: ['system'], senses: ['privacy', 'system'], deck: ['music', 'system'], crate: ['music', 'visuals'], router: ['music', 'system'], notes: ['notes'], todo: ['todo'] };
  const jget = (k, d) => { try { const v = JSON.parse(ls.get(k)); return v == null ? d : v; } catch { return d; } };
  function applyTiles() {
    try {
      const hide = jget('hs-nav-hidden', []), show = jget('hs-nav-shown', []);
      document.querySelectorAll('.side > .nav').forEach((b) => {
        const v = b.dataset.view;
        if (v === 'settings' || v === 'nexus' || v === 'software') return;
        if (hide.includes(v)) b.classList.add('hidden');
        else if (show.includes(v)) b.classList.remove('hidden');
      });
    } catch {}
  }
  document.addEventListener('DOMContentLoaded', applyTiles);
  if (document.readyState !== 'loading') applyTiles();

  // ---- answers ----
  const DEFAULTS = { vibe: 'balanced', uses: [], anim: 'nice', sound: 'sound', help: 'few', dock: { on: false, mods: [] }, accent: 'green', surprises: 'find' };
  const VIBE_PRESET = { serious: { anim: 'nice', help: 'few', surprises: 'hide' }, balanced: { anim: 'nice', help: 'few', surprises: 'find' }, playful: { anim: 'full', help: 'yes', surprises: 'find' } };
  const pick = (v, list, d) => (list.includes(v) ? v : d);
  function norm(a) {
    a = Object.assign({}, DEFAULTS, a || {});
    const d = a.dock && typeof a.dock === 'object' ? a.dock : {};
    return {
      vibe: pick(a.vibe, ['serious', 'balanced', 'playful'], 'balanced'),
      uses: (Array.isArray(a.uses) ? a.uses : []).filter((u) => ['system', 'music', 'visuals', 'notes', 'todo', 'gaming', 'privacy'].includes(u)),
      anim: pick(a.anim, ['minimal', 'nice', 'full'], 'nice'), sound: pick(a.sound, ['silent', 'sound'], 'sound'),
      help: pick(a.help, ['no', 'few', 'yes'], 'few'),
      dock: { on: !!d.on, mods: (Array.isArray(d.mods) ? d.mods : []).filter((m) => ['notes', 'todo', 'stats'].includes(m)) },
      accent: typeof a.accent === 'string' ? a.accent : 'green',
      surprises: pick(a.surprises, ['hide', 'find', 'tell', 'meet'], 'find'),
    };
  }
  const START = { system: 'nexus', music: 'crate', visuals: 'crate', notes: 'notes', todo: 'todo', privacy: 'senses' };

  function apply(answers, opts) {
    const a = norm(answers), o = opts || {}, log = [];
    const T = (name, fn) => { try { const r = fn(); log.push([name, r === false ? 'skipped' : 'ok']); } catch (e) { log.push([name, 'skipped']); } };
    const lvl = { minimal: ['off', 'off', 'off'], nice: ['high', 'normal', 'normal'], full: ['high', 'max', 'max'] }[a.anim];
    T('fx', () => { if (window.HS && HS.actions && HS.actions.setFx) HS.actions.setFx(lvl[0]); else ls.set('fx', lvl[0]); });
    T('clickfx', () => { if (window.hsClickFx) hsClickFx.set({ level: lvl[1] }); else { const c = jget('hs-clickfx', {}); c.level = lvl[1]; ls.set('hs-clickfx', JSON.stringify(c)); } });
    T('actionfx', () => { if (window.hsActionFx && typeof hsActionFx.set === 'function') hsActionFx.set({ level: lvl[2] }); else return false; });
    T('intro', () => { const m = a.anim === 'minimal' ? 'off' : a.sound === 'sound' ? 'full' : 'silent'; if (window.INTRO && INTRO.setMode) INTRO.setMode(m); else ls.set('intro', m); });
    T('helper', () => { if (window.twr && twr.setCfg) twr.setCfg({ help: a.help === 'yes' }); else return false; });
    T('thermal', () => { if (window.HS && HS.saveConfig) HS.saveConfig({ thermalAlerts: Object.assign({}, HS.config && HS.config.thermalAlerts, { on: a.help !== 'no' }) }); else return false; });
    if (!o.skipDock) T('dock', () => {
      const m = ['clock']; if (a.dock.mods.includes('notes')) m.push('notes'); if (a.dock.mods.includes('todo')) m.push('todo');
      if (a.dock.mods.includes('stats') || m.length === 1) m.push('temps', 'cpu', 'gpu', 'ram');
      hs.call('dockSet', a.dock.on ? { enabled: true, modules: m } : { enabled: false }).catch(() => {});
    });
    T('accent', () => { if (window.setAccent && window.accentName && accentName(HS.config && HS.config.look) !== a.accent && a.accent !== 'custom') setAccent(a.accent); else return false; });
    T('tiles', () => {
      let hide = [], show = [];
      if (a.uses.length) hide = Object.keys(TILE_USE).filter((v) => !TILE_USE[v].some((u) => a.uses.includes(u)));
      if (a.uses.includes('gaming')) show = ['games'];
      ls.set('hs-nav-hidden', JSON.stringify(hide)); ls.set('hs-nav-shown', JSON.stringify(show)); ls.set('hs-gaming-tab', a.uses.includes('gaming') ? '1' : '0');
      document.querySelectorAll('.side > .nav').forEach((b) => { if (hide.includes(b.dataset.view)) b.classList.add('hidden'); else if (TILE_USE[b.dataset.view]) b.classList.remove('hidden'); if (b.dataset.view === 'games') b.classList.toggle('hidden', !show.length); });
      applyTiles();
    });
    T('start', () => { const f = a.uses.find((u) => START[u]); if (f) ls.set('view', START[f]); });
    T('eggs', () => {
      ls.set('hs-eggs', a.surprises === 'hide' ? 'off' : 'on');
      if (window.hsEggs && typeof hsEggs.setEnabled === 'function') hsEggs.setEnabled(a.surprises !== 'hide');
      if (!(window.twr && twr.setCfg)) return false;
      if (a.surprises === 'hide') twr.setCfg({ on: false, found: false });
      else if (a.surprises === 'tell') twr.setCfg({ found: true });
      else if (a.surprises === 'meet') twr.setCfg({ on: true, found: true });
    });
    ls.set('hs-welcome', JSON.stringify(a)); ls.set('hs-welcome-done', '1'); ls.set('welcomed', '1');
    return log;
  }

  // ---- phrase table: wording changes with the vibe chosen in question 1 ----
  const P = {
    serious: {
      uses: ['Which areas will you use?', 'Select all that apply. Unused pages are tucked away; the first one chosen becomes your start page.'],
      anim: ['Animation level', 'Choose how much motion the interface uses.'],
      sound: ['Startup sound', 'Whether the startup animation plays audio.'],
      help: ['Tips and alerts', 'How much HYPERSPACE should tell you unprompted.'],
      dock: ['Side dock', 'A slim panel of live modules over your other windows.'],
      accent: ['Accent colour', 'Used for borders and highlights.'],
      surprises: ['Hidden extras', 'Optional hidden features and shortcuts.'],
    },
    balanced: {
      uses: ['What do you use HYPERSPACE for?', 'Pick any. Pages you will not need are tucked away, and your first pick becomes the start page.'],
      anim: ['How much animation?', 'Pick the amount of movement you like.'],
      sound: ['Startup sound?', 'The startup animation can play a short synthesized sound.'],
      help: ['Tips and nudges?', 'How chatty should HYPERSPACE be?'],
      dock: ['Show the side dock at startup?', 'A slim panel over your screen with live stats and quick tools.'],
      accent: ['Pick an accent colour', 'It tints borders and glows. Green is the classic.'],
      surprises: ['Hidden extras and easter eggs', 'Small surprises are tucked into the app. How do you want to handle them?'],
    },
    playful: {
      uses: ['What brings you into the Matrix, operator?', 'Pick your powers. Rooms you will never visit get sealed, and your first pick is where you wake up.'],
      anim: ['How much sparkle?', 'Calm the glitter or turn the whole cathedral of light on.'],
      sound: ['Boot with a soundtrack?', 'The startup ritual can hum a tiny synth chord. Or keep it to a whisper.'],
      help: ['Want a friendly voice in your ear?', 'Tips, nudges and a heads-up before your laptop turns into a toaster.'],
      dock: ['Summon the side dock at startup?', 'A glowing strip of live stats and quick tools that floats over everything.'],
      accent: ['Choose your aura', 'Every glow in the app will bend to it.'],
      surprises: ['Little surprises', 'There are secrets hidden in here. Who gets to know about them?'],
    },
  };
  const OPT = {
    vibe: [['serious', '▣', 'SERIOUS', 'Clean and to the point. No jokes.'], ['balanced', '◈', 'BALANCED', 'A little personality, mostly business.'], ['playful', '✦', 'PLAYFUL', 'Matrix flavour, jokes and sparkle.']],
    uses: [['system', '⎔', 'SYSTEM & TEMPS', 'Stats, fans, power and cleanup'], ['music', '♫', 'MUSIC & DJING', 'Library, player and DJ tools'], ['visuals', '◬', 'VISUALS / VJ', 'Visuals that dance to music'], ['notes', '✎', 'NOTES & JOURNAL', 'Encrypted notebook and diary'], ['todo', '☑', 'TO-DO', 'Lists with categories and dates'], ['gaming', '◉', 'GAMING', 'Shows the games hub in the menu'], ['privacy', '⛨', 'PRIVACY TOOLS', 'Mic and camera shields']],
    anim: [['minimal', '○', 'MINIMAL', 'Calm and quick. Almost no movement, no intro.'], ['nice', '◐', 'NICE', 'Smooth touches, nothing loud.'], ['full', '●', 'FULL SHOW', 'Click bursts, big effects and the full intro.']],
    sound: [['silent', '∅', 'SILENT', 'Startup animation without sound'], ['sound', '♪', 'WITH SOUND', 'A short synthesized chord at startup']],
    help: [['no', '✕', 'NO', 'Stay quiet. No tips, no heat alerts.'], ['few', '◔', 'A FEW', 'Only important things like overheating.'], ['yes', '✓', 'YES', 'Tips, nudges and heat warnings.']],
    dock: [['off', '▭', 'NO THANKS', 'Keep the screen clear'], ['on', '▮', 'YES, SHOW IT', 'Opens at the edge of your screen']],
    dockmods: [['notes', '✎', 'QUICK NOTE', 'Jot things without opening the app'], ['todo', '☑', 'TO-DO', 'Your list at a glance'], ['stats', '▤', 'STATS', 'Temperatures, CPU, GPU and RAM']],
    surprises: [['hide', '∅', 'HIDE THEM', 'Switch hidden extras off'], ['find', '?', 'LET ME FIND THEM', 'Say nothing. Surprise me.'], ['tell', 'i', 'TELL ME ABOUT THEM', 'Show the secrets list in Settings'], ['meet', '☺', 'MEET THE WHITE RABBIT', 'Wake the helper now. Optional.']],
  };
  const T2 = { serious: { find: 'DEFAULT', tell: 'SHOW THE LIST' }, playful: {} }; // reserved for wording tweaks
  const STEPS = ['vibe', 'uses', 'anim', 'sound', 'help', 'dock', 'accent', 'surprises'];

  let root = null, st = null;
  function fillFrom(cur) {
    const a = norm(cur);
    try { const l = HS.config && HS.config.look; if (window.accentName) a.accent = accentName(l); } catch {}
    const i = ls.get('intro'); if (cur && i) { a.sound = i === 'silent' ? 'silent' : a.sound; if (i === 'off') a.anim = 'minimal'; }
    return a;
  }
  function open(opts) {
    if (root) return;
    const o = opts || {};
    const saved = jget('hs-welcome', null);
    const a = fillFrom(saved);
    st = { a, i: 0, touched: new Set(saved ? STEPS : ['vibe']), retake: !!saved || !!o.retake, order: [] };
    root = document.createElement('div');
    root.id = 'hsw'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Welcome setup');
    document.body.appendChild(root);
    requestAnimationFrame(() => root && root.classList.add('in'));
    startRain();
    document.addEventListener('keydown', onKey, true);
    render();
  }
  const steps = () => STEPS.filter((s) => !(s === 'sound' && st.a.anim === 'minimal'));
  function close(applyDefaults) {
    if (!root) return;
    document.removeEventListener('keydown', onKey, true);
    stopRain();
    const r = root; root = null; r.classList.add('out'); setTimeout(() => r.remove(), 400);
    if (applyDefaults) { if (!st.retake) apply(st.a); }
    else if (!st.retake) ls.set('hs-welcome-done', '1');
  }
  function onKey(e) {
    if (!root) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'Enter' && !e.target.closest('button')) { e.preventDefault(); next(); }
  }
  const phrase = (s, n) => (P[st.a.vibe][s] || P.balanced[s] || ['', ''])[n];
  const COLORS = () => (window.ACCENT_SWATCHES || [['green', 'GREEN', ''], ['cyan', 'CYAN', '#19e3ff'], ['blue', 'BLUE', '#4d8dff'], ['purple', 'PURPLE', '#b14cff'], ['pink', 'PINK', '#ff4fd8'], ['red', 'RED', '#ff4d6a'], ['amber', 'AMBER', '#ffb800'], ['white', 'WHITE', '#e6f2ff']]);
  const card = (id, ico, lab, sub, on, extra) => `<button class="hsw-card${on ? ' on' : ''}${extra || ''}" data-id="${esc(id)}" aria-pressed="${on ? 'true' : 'false'}">${extra && extra.includes('sw') ? '' : ''}<span class="hsw-ico">${ico}</span><span class="hsw-lab">${esc(lab)}</span><span class="hsw-cs">${esc(sub)}</span></button>`;

  function render() {
    if (!root) return;
    const list = steps(), n = list.length, a = st.a;
    st.i = Math.max(0, Math.min(st.i, n));
    const sum = st.i >= n;
    const dots = list.map((_, k) => `<i class="${k === st.i ? 'on' : k < st.i ? 'done' : ''}"></i>`).join('');
    let h = '', title = '', sub = '', body = '';
    if (!sum) {
      const s = list[st.i];
      if (s === 'vibe') { title = 'How should HYPERSPACE feel?'; sub = 'Pick a vibe. Everything after this will talk to you in that style.'; body = OPT.vibe.map(([id, ic, l, c]) => card(id, ic, l, c, a.vibe === id)).join(''); }
      else {
        title = phrase(s, 0); sub = phrase(s, 1);
        if (s === 'uses') body = OPT.uses.map(([id, ic, l, c]) => card(id, ic, l, c, a.uses.includes(id))).join('');
        else if (s === 'accent') body = COLORS().map(([id, l, hex]) => card(id, '', l, '', a.accent === id, ' sw" style="--c:' + (hex || '#00ff6e'))).join('');
        else if (s === 'dock') body = OPT.dock.map(([id, ic, l, c]) => card(id, ic, l, c, (id === 'on') === a.dock.on)).join('');
        else if (s === 'surprises') body = OPT.surprises.filter(([id]) => id !== 'meet' || a.vibe === 'playful').map(([id, ic, l, c]) => card(id, ic, l, c, a.surprises === id)).join('');
        else { const cur = a[s]; body = OPT[s].map(([id, ic, l, c]) => card(id, ic, l, c, cur === id)).join(''); }
      }
      h = `<div class="hsw-grid" data-step="${s}">${body}</div>`;
      if (s === 'dock' && a.dock.on) h += `<div class="hsw-more"><div class="hsw-sub">Which modules? (pick any)</div><div class="hsw-grid" data-step="dockmods">${OPT.dockmods.map(([id, ic, l, c]) => card(id, ic, l, c, a.dock.mods.includes(id))).join('')}</div></div>`;
    } else {
      title = a.vibe === 'serious' ? 'Setup summary' : a.vibe === 'playful' ? 'Your reality is configured' : 'All set';
      sub = '';
      h = `<ul class="hsw-sum">${summary(a).map(([k, v]) => `<li><b>${esc(k)}</b><span>${esc(v)}</span></li>`).join('')}</ul><div class="hsw-note">You can change any of this later in Settings.</div>`;
    }
    const last = sum;
    root.innerHTML = `<canvas class="hsw-rain"></canvas><div class="hsw-box"><div class="hsw-top"><span class="hsw-brand">◬ HYPERSPACE // SETUP</span><span class="hsw-dots">${dots}<i class="${sum ? 'on' : ''}"></i></span></div>
      <h2>${esc(title)}</h2><div class="hsw-sub">${esc(sub)}</div>${h}
      <div class="hsw-foot"><button class="hsw-btn ghost" id="hsw-skip">${st.retake ? 'CANCEL' : 'SKIP (USE DEFAULTS)'}</button><span class="sp"></span>
      ${last ? `<button class="hsw-btn" id="hsw-back">BACK</button><button class="hsw-btn" id="hsw-set">OPEN SETTINGS</button><button class="hsw-btn pri" id="hsw-go">START</button>` : `<button class="hsw-btn" id="hsw-back"${st.i === 0 ? ' disabled' : ''}>BACK</button><button class="hsw-btn pri" id="hsw-next">NEXT</button>`}</div></div>`;
    restartRain();
    bind();
    const f = root.querySelector('.hsw-card.on') || root.querySelector('.hsw-card') || root.querySelector('#hsw-go');
    if (f) f.focus({ preventScroll: true });
  }
  function bind() {
    const q = (s) => root.querySelector(s);
    root.querySelectorAll('.hsw-card').forEach((b) => b.addEventListener('click', () => choose(b.closest('.hsw-grid').dataset.step, b.dataset.id)));
    const on = (s, fn) => { const e = q(s); if (e) e.addEventListener('click', fn); };
    on('#hsw-skip', () => close(true)); on('#hsw-back', () => { st.i = Math.max(0, st.i - 1); render(); });
    on('#hsw-next', next);
    on('#hsw-go', () => finish(false)); on('#hsw-set', () => finish(true));
  }
  function next() { if (!root) return; st.i += 1; render(); }
  function choose(step, id) {
    const a = st.a;
    if (step === 'vibe') { a.vibe = id; const p = VIBE_PRESET[id]; for (const k of Object.keys(p)) if (!st.touched.has(k === 'surprises' ? 'surprises' : k)) a[k] = p[k]; if (id !== 'playful' && a.surprises === 'meet') a.surprises = 'find'; }
    else if (step === 'uses') { a.uses = a.uses.includes(id) ? a.uses.filter((x) => x !== id) : [...a.uses, id]; }
    else if (step === 'dock') { a.dock.on = id === 'on'; }
    else if (step === 'dockmods') { a.dock.mods = a.dock.mods.includes(id) ? a.dock.mods.filter((x) => x !== id) : [...a.dock.mods, id]; }
    else if (step === 'accent') { a.accent = id; }
    else { a[step] = id; }
    st.touched.add(step === 'dockmods' ? 'dock' : step);
    const keep = root.querySelector('.hsw-box').scrollTop; render(); const b = root.querySelector('.hsw-box'); if (b) b.scrollTop = keep;
  }
  function summary(a) {
    const lab = (k, id) => (OPT[k].find((x) => x[0] === id) || [])[2] || id;
    const rows = [['VIBE', lab('vibe', a.vibe)]];
    rows.push(['USES', a.uses.length ? a.uses.map((u) => lab('uses', u)).join(', ') : 'EVERYTHING (nothing hidden)']);
    rows.push(['ANIMATION', lab('anim', a.anim) + (a.anim === 'minimal' ? ' (FX off, click effects off, no intro)' : a.anim === 'full' ? ' (FX high, big click bursts)' : ' (FX high, click effects normal)')]);
    if (a.anim !== 'minimal') rows.push(['STARTUP SOUND', lab('sound', a.sound)]);
    rows.push(['TIPS AND ALERTS', lab('help', a.help)]);
    rows.push(['SIDE DOCK', a.dock.on ? 'ON: ' + (a.dock.mods.length ? a.dock.mods.map((m) => lab('dockmods', m)).join(', ') : 'STATS') : 'OFF']);
    rows.push(['ACCENT', a.accent.toUpperCase()]);
    rows.push(['HIDDEN EXTRAS', lab('surprises', a.surprises)]);
    if (a.surprises === 'tell') {
      let l = []; try { l = (window.hsEggs && hsEggs.list) || []; } catch {}
      rows.push(['SECRETS', (l.length ? 'Try: ' + l.join(', ') + '. ' : '') + 'Full list: Settings, SECRETS.']);
    }
    return rows;
  }
  function finish(openSettings) {
    const a = st.a, res = apply(a);
    close(false);
    try {
      const f = a.uses.find((u) => START[u]);
      if (openSettings) { if (typeof showView === 'function') showView('settings'); }
      else if (f && typeof showView === 'function') showView(START[f]);
    } catch {}
    try { document.dispatchEvent(new CustomEvent('hs-welcome-applied', { detail: res })); } catch {}
  }

  // ---- light matrix rain behind the card (stops when closed; skipped in lite / reduced motion) ----
  let rainT = 0, rainDrops = [];
  function startRain() {}
  function restartRain() {
    stopRain();
    const cv = root && root.querySelector('.hsw-rain');
    if (!cv) return;
    try {
      if ((document.body.classList.contains('lite')) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const w = (cv.width = Math.min(innerWidth, 1400)), h = (cv.height = Math.min(innerHeight, 900)), x = cv.getContext('2d');
      const cols = Math.floor(w / 18); rainDrops = Array.from({ length: cols }, () => Math.random() * -40);
      const G = 'ｱｲｳｴｵｶｷｸｹｺ01<>+◈✦';
      rainT = setInterval(() => {
        x.fillStyle = 'rgba(0,4,0,.12)'; x.fillRect(0, 0, w, h); x.fillStyle = '#00ff6e'; x.font = '14px monospace';
        rainDrops.forEach((y, i) => { x.fillText(G[(Math.random() * G.length) | 0], i * 18, y * 18); rainDrops[i] = y * 18 > h && Math.random() > 0.97 ? 0 : y + 1; });
      }, 70);
    } catch {}
  }
  function stopRain() { if (rainT) clearInterval(rainT); rainT = 0; }

  window.hsWelcome = { open, apply: (a, o) => apply(a, o) };

  // ---- first run: wait for the intro to finish, then show the card ----
  if (auto) {
    const t0 = Date.now();
    const tick = () => {
      if (root) return;
      const booting = document.body && document.body.classList.contains('booting');
      if ((!booting && Date.now() - t0 > 2500) || Date.now() - t0 > 30000) {
        if (window.HS && HS.solo) return;
        open();
      } else setTimeout(tick, 600);
    };
    setTimeout(tick, 1500);
  }
})();
