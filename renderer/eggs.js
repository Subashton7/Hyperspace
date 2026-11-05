// EGGS: tiny hidden toys. None of them needs the White Rabbit, none shows anything until you do the secret thing.
//   type  matrix   (outside text boxes)      5 seconds of falling code
//   type  xyzzy                              a pixel cave pops up
//   double-click the clock in the title bar  binary + hex clock for 10 seconds
//   Shift+click the HYPERSPACE logo          next accent colour with a rainbow sweep
//   type  zen                                60 seconds of box breathing (4-4-4-4), Esc leaves
//   type  focus                              25-minute pomodoro with a corner ring; type it again to see/stop it
// MORE (v2): a typed-words engine + ~37 more toys, tools and reminders; the SECRETS settings tab (eggs-settings.js) lists them.
// Each one listens only to the typed word (never inside inputs, never with Ctrl/Alt/Meta, never in the CRATE VJ section),
// has a cooldown, and is wrapped in try/catch so it can never break the app. window.hsEggs.<name>() runs one by hand.
(() => {
  'use strict';
  if (window.hsEggs) return;
  const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  const lite = () => !!(document.body && document.body.classList.contains('lite')) || !!(window.hs && hs.lite && hs.lite.on);
  const inVJ = () => { try { return !!(window.HS && HS.inVJ && HS.inVJ()); } catch { return false; } };
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
  const CD = {};
  const cool = (k, ms) => { const t = Date.now(); if (CD[k] && t - CD[k] < ms) return false; CD[k] = t; return true; };
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const note = (msg) => { try { if (typeof window.toast === 'function') return window.toast(msg); } catch {} const t = el('div', 'egg-note', msg); document.body.appendChild(t); setTimeout(() => t.remove(), 3200); };
  // say it through the rabbit when he is awake, otherwise a toast
  const announce = (msg) => { let ok = false; try { ok = !!(window.twr && twr.enabled && twr.enabled() && twr.say(msg, 5200)); } catch {} if (!ok) note(msg); };

  // ---------- (a) matrix: 5 s rain burst ----------
  let rainOn = false;
  function matrix() {
    if (rainOn || !cool('matrix', 8000)) return; rainOn = true;
    const wrap = el('div', 'egg-rain'), msg = el('div', 'egg-rain-msg', 'The Matrix has you.');
    wrap.appendChild(msg);
    const finish = () => { wrap.classList.add('out'); setTimeout(() => { wrap.remove(); rainOn = false; }, 800); };
    if (reduced()) { document.body.appendChild(wrap); requestAnimationFrame(() => wrap.classList.add('in')); setTimeout(finish, 2200); return; }
    const cv = el('canvas'); wrap.prepend(cv); document.body.appendChild(wrap);
    const ctx = cv.getContext('2d'); if (!ctx) { wrap.remove(); rainOn = false; return; }
    const dpr = Math.min(1.5, window.devicePixelRatio || 1); cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    const size = 16 * dpr, cols = Math.ceil(cv.width / size / (lite() ? 2 : 1)), step = lite() ? 2 : 1;
    const drops = Array.from({ length: cols }, () => -Math.random() * 40), G = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾅﾆﾇﾈﾉ0123456789ﾊﾋﾌﾍﾎ';
    ctx.font = `${size}px monospace`; requestAnimationFrame(() => wrap.classList.add('in'));
    const t0 = performance.now(); let last = 0;
    const frame = (t) => {
      if (!wrap.isConnected) return;
      if (t - t0 > 5000) return finish();
      if (t - last > 45) {
        last = t; ctx.fillStyle = 'rgba(0,8,3,.14)'; ctx.fillRect(0, 0, cv.width, cv.height);
        for (let i = 0; i < drops.length; i++) {
          const x = i * size * step, y = drops[i] * size;
          ctx.fillStyle = '#d6ffe9'; ctx.fillText(G[(Math.random() * G.length) | 0], x, y);
          ctx.fillStyle = '#00ff9c'; ctx.fillText(G[(Math.random() * G.length) | 0], x, y - size);
          if (y > cv.height && Math.random() > 0.96) drops[i] = 0; else drops[i] += 1;
        }
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // ---------- (b) xyzzy: a pixel cave says nothing happens ----------
  let caveN = 0;
  function xyzzy() {
    if (!cool('xyzzy', 3000)) return; caveN++;
    const line = caveN % 5 === 0 ? 'A hollow voice says "Fool."' : caveN === 1 ? 'Nothing happens.' : 'Still nothing happens.';
    const b = el('div', 'egg-cave', `<i></i><i></i><i></i><span>&gt; xyzzy</span><b>${line}</b><u></u>`);
    document.body.appendChild(b); setTimeout(() => b.classList.add('out'), 3000); setTimeout(() => b.remove(), 3500);
  }

  // ---------- (c) binary / hex clock ----------
  let binT = 0, binEl = null;
  function binclock() {
    const clock = document.getElementById('clock'); if (!clock) return;
    if (binEl) { clearInterval(binT); binEl.remove(); binEl = null; return; }
    if (!cool('bin', 1200)) return;
    binEl = el('div', 'egg-bin');
    const r = clock.getBoundingClientRect(); binEl.style.left = `${Math.max(8, Math.min(innerWidth - 300, r.left + r.width / 2 - 150))}px`; binEl.style.top = `${r.bottom + 8}px`;
    document.body.appendChild(binEl);
    const p2 = (n, w) => n.toString(2).padStart(w, '0'), hx = (n) => `0x${n.toString(16).toUpperCase().padStart(2, '0')}`;
    const paint = () => { const d = new Date(), h = d.getHours(), m = d.getMinutes(), s = d.getSeconds(); binEl.innerHTML = `<div><em>BIN</em> ${p2(h, 5)} : ${p2(m, 6)} : ${p2(s, 6)}</div><div><em>HEX</em> ${hx(h)} : ${hx(m)} : ${hx(s)}</div>`; };
    paint(); binT = setInterval(paint, 1000);
    const end = () => { clearInterval(binT); if (binEl) { binEl.remove(); binEl = null; } };
    setTimeout(end, 10000); binEl.addEventListener('click', end);
  }

  // ---------- (d) Shift+click the logo: next accent colour ----------
  function accentCycle() {
    if (!cool('accent', 1500)) return;
    const sw = window.ACCENT_SWATCHES || []; if (!sw.length || typeof window.setAccent !== 'function') return;
    let cur = -1; try { const n = window.accentName(window.HS && HS.config && HS.config.look); cur = sw.findIndex((s) => s[0] === n); } catch {}
    const next = sw[(cur + 1) % sw.length];
    if (!reduced()) { const w = el('div', 'egg-sweep'); document.body.appendChild(w); setTimeout(() => w.remove(), 1100); }
    setTimeout(() => { try { window.setAccent(next[0]); note(`ACCENT: ${String(next[1] || next[0]).toUpperCase()}`); } catch {} }, reduced() ? 0 : 350);
  }

  // ---------- (e) zen: 60 s of box breathing ----------
  let zenEl = null, zenT = 0;
  function zen() {
    if (zenEl || !cool('zen', 3000)) return;
    zenEl = el('div', 'egg-zen', '<div class="zn-ring"><div class="zn-dot"></div></div><div class="zn-txt"></div><div class="zn-sub">box breathing · 4 in · 4 hold · 4 out · 4 hold</div><div class="zn-esc">Esc to leave</div>');
    document.body.appendChild(zenEl); requestAnimationFrame(() => zenEl && zenEl.classList.add('in'));
    const dot = zenEl.querySelector('.zn-dot'), txt = zenEl.querySelector('.zn-txt'), t0 = Date.now(), PH = ['BREATHE IN', 'HOLD', 'BREATHE OUT', 'HOLD'];
    let lastPh = -1;
    const tick = () => {
      if (!zenEl) return;
      const s = (Date.now() - t0) / 1000;
      if (s >= 60) return close(true);
      const ph = Math.floor(s / 4) % 4, left = 4 - Math.floor(s % 4);
      txt.textContent = `${PH[ph]}  ${left}`;
      if (ph !== lastPh) { lastPh = ph; const sc = ph === 0 || ph === 1 ? 1 : 0.35; dot.style.transition = reduced() ? 'opacity 3.6s linear' : (ph === 0 || ph === 2 ? 'transform 4s linear' : 'none'); if (reduced()) dot.style.opacity = sc === 1 ? '1' : '0.3'; else dot.style.transform = `scale(${sc})`; }
    };
    dot.style.transform = 'scale(.35)'; zenT = setInterval(tick, 250); setTimeout(tick, 30);
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(false); } };
    window.addEventListener('keydown', key, true);
    function close(done) {
      clearInterval(zenT); window.removeEventListener('keydown', key, true);
      const z = zenEl; zenEl = null; if (!z) return;
      if (done) z.querySelector('.zn-txt').textContent = 'WELL DONE';
      z.classList.remove('in'); setTimeout(() => z.remove(), 900);
      if (done) announce('One minute of calm. Nicely done.');
    }
    zenEl.addEventListener('click', (e) => { if (e.target.classList.contains('zn-esc')) close(false); });
  }

  // ---------- (f) focus: 25-minute pomodoro, corner ring ----------
  const FOCUS_KEY = 'hs-eggs-focus-end', FOCUS_MS = 25 * 60e3, R = 22, CIRC = 2 * Math.PI * R;
  let fEl = null, fT = 0;
  function focusStop(why) { clearInterval(fT); fT = 0; lsSet(FOCUS_KEY, null); if (fEl) { fEl.remove(); fEl = null; } if (why) note(why); }
  function focusDraw(end) {
    if (!fEl) {
      fEl = el('button', 'egg-focus', `<svg viewBox="0 0 52 52"><circle class="bg" cx="26" cy="26" r="${R}"/><circle class="fg" cx="26" cy="26" r="${R}" stroke-dasharray="${CIRC}" stroke-dashoffset="0"/></svg><span></span>`);
      fEl.title = 'FOCUS: click to stop'; fEl.addEventListener('click', () => focusStop('Focus stopped.')); document.body.appendChild(fEl);
    }
    const left = Math.max(0, end - Date.now()), fg = fEl.querySelector('.fg'), sp = fEl.querySelector('span');
    fg.style.strokeDashoffset = String(CIRC * (1 - left / FOCUS_MS)); const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    sp.textContent = `${m}:${String(s).padStart(2, '0')}`;
    return left;
  }
  function focusRun(end) {
    clearInterval(fT);
    const step = () => {
      const left = focusDraw(end);
      if (left <= 0) { focusStop(); announce('Focus session done. 25 minutes! Stand up, stretch, drink some water.'); }
    };
    step(); if (fEl) fT = setInterval(step, 1000);
  }
  function focus() {
    if (fEl) { const left = Math.max(0, (+lsGet(FOCUS_KEY) || 0) - Date.now()); return note(`FOCUS: ${Math.ceil(left / 60000)} min left. Click the ring to stop.`); }
    if (!cool('focus', 2000)) return;
    const end = Date.now() + FOCUS_MS; lsSet(FOCUS_KEY, String(end)); note('FOCUS: 25 minutes. Go.'); focusRun(end);
  }
  // survive a reload
  setTimeout(() => { try { const end = +lsGet(FOCUS_KEY) || 0; if (end > Date.now()) focusRun(end); else if (end) lsSet(FOCUS_KEY, null); } catch {} }, 1500);

  // =====================================================================================
  // v2: STATE, REGISTRY, SHARED HELPERS
  // All state lives in ONE localStorage key: 'hs-eggs' = { on, found:{id:ts}, sessions, tip, st:{...per tool} }
  // =====================================================================================
  const KEY = 'hs-eggs';
  let S = { on: true, found: {}, sessions: 0, tip: 0, st: {} };
  try { const j = JSON.parse(lsGet(KEY) || 'null'); if (j && typeof j === 'object') S = { ...S, ...j, found: j.found || {}, st: j.st || {} }; } catch {}
  const save = () => { try { lsSet(KEY, JSON.stringify(S)); } catch {} };
  const st = (k, d) => (S.st[k] = S.st[k] && typeof S.st[k] === 'object' ? { ...d, ...S.st[k] } : d);
  const rnd = (n) => Math.floor(Math.random() * n), pick = (a) => a[rnd(a.length)];
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmtMS = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return (h ? h + ':' + pad2(m) : m) + ':' + pad2(s % 60); };
  const ping = (t, d) => { try { document.dispatchEvent(new CustomEvent(t, { detail: d })); } catch {} };
  function mark(id) { if (!id || S.found[id]) return; S.found[id] = Date.now(); save(); ping('hs-eggs-changed', { id }); }
  document.addEventListener('hs-egg-found', (e) => { try { mark(e.detail && e.detail.id); } catch {} });

  let selfCopy = false;
  function copy(text) {
    selfCopy = true;
    const done = () => setTimeout(() => { selfCopy = false; }, 50);
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(() => { selfCopy = false; }, () => { legacy(); }); return true; } } catch {}
    return legacy();
    function legacy() { try { const t = el('textarea'); t.value = text; t.style.cssText = 'position:fixed;left:-999px;top:0'; document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); t.remove(); return ok; } catch { return false; } finally { done(); } }
  }
  let actx = null;
  function beepSnd(f = 880, ms = 160, vol = 0.05) {
    try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = f; g.gain.value = vol; o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + ms / 1000); } catch {}
  }
  function alarm(title, msg) {
    note(msg); beepSnd(988, 140); setTimeout(() => beepSnd(1318, 200), 190);
    try { if (window.Notification && Notification.permission === 'granted') new Notification(title, { body: msg }); } catch {}
  }
  function askNotify() { try { if (window.Notification && Notification.permission === 'default') Notification.requestPermission(); } catch {} }
  function bubble(msg, ms = 3600) {
    const b = el('div', 'egg-bubble', `<span>${esc(msg)}</span>`); document.body.appendChild(b);
    setTimeout(() => b.classList.add('out'), ms); setTimeout(() => b.remove(), ms + 400);
  }
  const overlay = (cls, html, ms) => { const o = el('div', cls, html); document.body.appendChild(o); if (ms) setTimeout(() => o.remove(), ms); return o; };

  // ---------- panels (small matrix-styled overlays; Esc closes the newest) ----------
  const pnls = {};
  function panel(id, title, body, o = {}) {
    if (pnls[id]) { const i = pnls[id].querySelector('input,textarea'); if (i) i.focus(); return null; }
    const n = Object.keys(pnls).length;
    const p = el('div', `egg-pnl egg-p-${id}`, `<div class="ep-h"><b>${title}</b><button class="ep-x" aria-label="Close" title="Close (Esc)">&times;</button></div><div class="ep-b">${body}</div>`);
    p.style.right = `${24 + n * 22}px`; p.style.bottom = `${56 + n * 22}px`; if (o.w) p.style.width = `${o.w}px`;
    document.body.appendChild(p); pnls[id] = p; p._id = id;
    p.querySelector('.ep-x').addEventListener('click', () => closeP(id));
    const h = p.querySelector('.ep-h');
    h.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return; const r = p.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      const mv = (m) => { p.style.left = `${Math.max(0, Math.min(innerWidth - 60, m.clientX - dx))}px`; p.style.top = `${Math.max(0, Math.min(innerHeight - 40, m.clientY - dy))}px`; p.style.right = 'auto'; p.style.bottom = 'auto'; };
      const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
      addEventListener('pointermove', mv); addEventListener('pointerup', up);
    });
    if (o.focus !== false) setTimeout(() => { const i = p.querySelector('input:not([type=color]),textarea'); if (i) i.focus(); }, 60);
    return p;
  }
  function closeP(id) { const p = pnls[id]; if (!p) return; delete pnls[id]; clearInterval(p._iv); try { p._off && p._off(); } catch {} p.classList.add('out'); setTimeout(() => p.remove(), 170); }
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || panicEl) return; const ids = Object.keys(pnls); if (!ids.length) return;
    if (zenEl) return; e.stopPropagation(); e.preventDefault(); closeP(ids[ids.length - 1]);
  }, true);

  // ---------- reminder engine: timer / 20-20-20 / water. S.st.run[k] = { end, every?, label }. Chips show what is running. ----------
  const RUNL = { timer: 'TIMER', brk: 'EYES', hyd: 'WATER' };
  let chipBox = null, runT = 0;
  const runs = () => (S.st.run = S.st.run || {});
  function runStart(k, ms, every, label) { runs()[k] = { end: Date.now() + ms, ...(every ? { every } : {}), label: label || RUNL[k] }; save(); runLoop(); }
  function runStop(k) { delete runs()[k]; save(); paintChips(); }
  function runFire(k, r) {
    if (k === 'timer') alarm('HYPERSPACE timer', `TIMER done: ${r.label}`);
    else if (k === 'brk') { alarm('Eye break', '20-20-20: look at something 20 feet away for 20 seconds.'); breakCount(); }
    else if (k === 'hyd') alarm('Hydrate', 'Time for a glass of water.');
  }
  function paintChips() {
    const r = runs(), keys = Object.keys(r);
    if (!keys.length) { if (chipBox) { chipBox.remove(); chipBox = null; } return; }
    if (!chipBox) { chipBox = el('div', 'egg-chips'); document.body.appendChild(chipBox); chipBox.addEventListener('click', (e) => { const c = e.target.closest('[data-k]'); if (c) ({ timer, brk: breakEgg, hyd: hydrate }[c.dataset.k] || (() => {}))(); }); }
    chipBox.innerHTML = keys.map((k) => `<button data-k="${k}" title="${esc(r[k].label)}: click to open"><em>${RUNL[k] || k}</em>${fmtMS(r[k].end - Date.now())}</button>`).join('');
  }
  function runLoop() {
    clearInterval(runT); runT = 0; if (!Object.keys(runs()).length) return paintChips();
    const step = () => {
      const now = Date.now(), r = runs();
      for (const k of Object.keys(r)) if (now >= r[k].end) { const x = r[k]; try { runFire(k, x); } catch {} if (x.every) x.end = now + x.every; else delete r[k]; save(); ping('hs-eggs-run', { k }); }
      paintChips(); if (!Object.keys(r).length) { clearInterval(runT); runT = 0; }
    };
    step(); if (Object.keys(runs()).length) runT = setInterval(step, 1000);
  }
  setTimeout(() => { try { runLoop(); } catch {} }, 1800);

  // =====================================================================================
  // GOOFY EGGS
  // =====================================================================================
  const still = (msg) => { bubble(msg); return true; };
  function disco() {
    if (!cool('disco', 9000)) return; if (reduced()) return still('Disco skipped: reduced motion is on.');
    const ball = overlay('egg-ball', '<u></u><i></i>'), spots = overlay('egg-spots', ''); document.documentElement.classList.add('egg-disco');
    setTimeout(() => { document.documentElement.classList.remove('egg-disco'); ball.classList.add('out'); spots.remove(); setTimeout(() => ball.remove(), 700); }, 8000);
  }
  function konami() {
    if (!cool('konami', 5000)) return;
    const k = overlay('egg-kon', '<b>&uarr; &uarr; &darr; &darr; &larr; &rarr; &larr; &rarr; B A</b><span>+30 LIVES</span>', 3400); k.classList.add('in');
    setTimeout(() => k.classList.add('out'), 2900);
  }
  function nyan() {
    if (!cool('nyan', 6000)) return; if (reduced()) return still('Nyan is flying by (in your imagination).');
    const R = (x, y, w, h, c) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`;
    const cat = `<svg viewBox="0 0 19 12" shape-rendering="crispEdges">${R(0, 1, 12, 9, '#111') + R(1, 2, 10, 7, '#ff9ad5') + R(3, 3, 1, 1, '#ff3d8b') + R(7, 5, 1, 1, '#ff3d8b') + R(5, 7, 1, 1, '#ff3d8b') + R(10, 3, 8, 7, '#111') + R(11, 4, 6, 5, '#9a9a9a') + R(11, 1, 2, 3, '#111') + R(16, 1, 2, 3, '#111') + R(12, 5, 1, 1, '#111') + R(15, 5, 1, 1, '#111') + R(13, 7, 2, 1, '#f66')}<g class="nl">${R(2, 10, 2, 2, '#111') + R(6, 10, 2, 2, '#111') + R(12, 10, 2, 2, '#111') + R(15, 10, 2, 2, '#111')}</g></svg>`;
    const cols = ['#ff3d3d', '#ff9a3d', '#ffee3d', '#3dff6e', '#3d9aff', '#9a3dff'];
    const y = 70 + rnd(Math.max(60, innerHeight - 220)), n = overlay('egg-nyan', `<div class="tr">${cols.map((c) => `<i style="background:${c}"></i>`).join('')}</div>${cat}`, 4300);
    n.style.top = `${y}px`;
  }
  function party() {
    if (!cool('party', 5000)) return; if (reduced()) return still('Party! (confetti skipped: reduced motion)');
    const G = 'ｱｲｳｴｵｶｷ01ﾊﾋﾌ$%#@*+<>{}'.split(''), C = ['#00ff9c', '#ff3d6e', '#ffee55', '#3df0ff', '#a974ff', '#ff4fd8'];
    const box = overlay('egg-confetti', '', 4800);
    for (let i = 0; i < 90; i++) { const s = el('span', '', G[rnd(G.length)]); s.style.cssText = `left:${rnd(100)}%;color:${pick(C)};font-size:${12 + rnd(16)}px;animation-duration:${2 + Math.random() * 2}s;animation-delay:${Math.random() * 0.9}s;--rx:${rnd(720) - 360}deg;--dx:${rnd(160) - 80}px`; box.appendChild(s); }
  }
  function flip() {
    if (!cool('flip', 8000)) return; if (reduced()) return still('(the screen would be upside down now)');
    const h = document.documentElement, a = h.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(180deg)' }], { duration: 900, fill: 'forwards', easing: 'ease-in-out' });
    setTimeout(() => { a.reverse(); a.onfinish = () => a.cancel(); }, 5900);
  }
  function shake() {
    if (!cool('shake', 3000)) return; if (reduced()) return still('*the ground rumbles politely*');
    const f = []; for (let i = 0; i < 28; i++) { const a = 1 - i / 28; f.push({ transform: `translate(${(Math.random() - 0.5) * 22 * a}px,${(Math.random() - 0.5) * 22 * a}px) rotate(${(Math.random() - 0.5) * 1.4 * a}deg)` }); }
    f.push({ transform: 'none' }); document.documentElement.animate(f, { duration: 1500 });
  }
  function glitch() {
    if (!cool('glitch', 3000)) return; if (reduced()) return still('glitch.exe stopped responding');
    const h = document.documentElement; h.animate([{ filter: 'none' }, { filter: 'hue-rotate(90deg) saturate(2) contrast(1.4)', offset: 0.1 }, { filter: 'invert(1)', offset: 0.2 }, { filter: 'none', offset: 0.3 }, { filter: 'drop-shadow(5px 0 #f0f) drop-shadow(-5px 0 #0ff)', offset: 0.5 }, { filter: 'none' }], { duration: 1000, easing: 'steps(12,end)' });
    const box = overlay('egg-tear', '', 1100);
    for (let i = 0; i < 7; i++) { const b = el('i'); const t = rnd(90), hh = 2 + rnd(9); b.style.cssText = `top:${t}%;height:${hh}%;animation-delay:${rnd(400)}ms;--tx:${rnd(120) - 60}px`; box.appendChild(b); }
  }
  function sudo() {
    if (!cool('sudo', 4000)) return;
    const t = overlay('egg-term', '<div>$ sudo make me a sandwich</div><div>[sudo] password for operator: ********</div><div class="r">permission denied: nice try</div><u></u>');
    setTimeout(() => t.classList.add('out'), 3300); setTimeout(() => t.remove(), 3800);
  }
  function hello(w) {
    const r = { hello: ['Hello, human.', 'Hello! Systems nominal.'], hi: ['Hi! Ready when you are.', 'Hi there, operator.'], sup: ['Sup. All fans spinning.', 'Not much. Watching your temps.'] }[w] || ['Hello.'];
    bubble(pick(r));
  }
  function beepEgg() {
    if (!cool('beep', 1500)) return;
    overlay('egg-flash', '', 700); const b = overlay('egg-bell', '<pre>    ,-.\n   /   \\\n  | ^G  |\n  |     |\n ,\'------`.\n    (_)</pre><span>*BEEP*</span>', 1700); b.classList.add('in'); beepSnd(1046, 120, 0.03);
  }
  function warp() {
    if (!cool('warp', 5000)) return; if (reduced()) return still('Jump complete. (animation skipped)');
    const cv = el('canvas', 'egg-warp'); document.body.appendChild(cv); const ctx = cv.getContext('2d'); if (!ctx) return cv.remove();
    const W = (cv.width = innerWidth), H = (cv.height = innerHeight), cx = W / 2, cy = H / 2, N = lite() ? 90 : 220;
    const ss = Array.from({ length: N }, () => ({ a: Math.random() * 6.283, d: Math.random() * 40, v: 3 + Math.random() * 6 }));
    const t0 = performance.now();
    const f = (t) => {
      const p = (t - t0) / 2600; if (p >= 1 || !cv.isConnected) return cv.remove();
      ctx.fillStyle = 'rgba(0,4,8,.28)'; ctx.fillRect(0, 0, W, H);
      const sp = 0.4 + p * 4;
      for (const s of ss) { const x0 = cx + Math.cos(s.a) * s.d, y0 = cy + Math.sin(s.a) * s.d; s.d += s.v * sp * (1 + s.d / 160); const x1 = cx + Math.cos(s.a) * s.d, y1 = cy + Math.sin(s.a) * s.d; ctx.strokeStyle = `hsl(${170 + s.d / 6},100%,${70 + Math.min(25, s.d / 20)}%)`; ctx.lineWidth = 1 + s.d / 260; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); if (s.d > Math.max(W, H)) s.d = Math.random() * 30; }
      if (p > 0.85) { ctx.fillStyle = `rgba(255,255,255,${(p - 0.85) * 6})`; ctx.fillRect(0, 0, W, H); }
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  }
  function pizza() {
    if (!cool('pizza', 5000)) return; if (reduced()) return still('Pizza delivered. \u{1F355}');
    const box = overlay('egg-pizza', '', 7500);
    for (let i = 0; i < 6; i++) { const s = el('span', '', '\u{1F355}'); s.style.animationDelay = `${i * 0.5}s`; s.style.fontSize = `${26 + rnd(20)}px`; box.appendChild(s); }
  }
  function dance() {
    if (!cool('dance', 6500)) return; if (reduced()) return still('\\o/ |o| /o\\');
    const F = [' o \n/|\\\n/ \\', '\\o/\n | \n/ \\', ' o \n\\|/\n< >', '\\o \n |\\\n/ >'];
    const row = overlay('egg-dance', '', 6200), figs = [];
    for (let i = 0; i < 9; i++) { const p = el('pre'); p.style.color = `hsl(${i * 40},100%,65%)`; row.appendChild(p); figs.push(p); }
    let k = 0; const iv = setInterval(() => { k++; figs.forEach((p, i) => { p.textContent = F[(k + (i % 3)) % F.length]; }); if (!row.isConnected) clearInterval(iv); }, 230);
    setTimeout(() => clearInterval(iv), 6200);
  }
  function rickroll() {
    if (!cool('rickroll', 6000)) return;
    const t = 'NEVER GONNA CLOSE THIS TAB \u2022 NEVER GONNA LOSE YOUR NOTES \u2022 NEVER GONNA LET THE FANS DOWN \u2022 NEVER GONNA CRASH ON A FRIDAY \u2022 (no network was harmed in the making of this marquee) \u2022 ';
    overlay('egg-marq', `<span>${esc(t + t)}</span>`, 8200);
  }
  function thanos() {
    if (!cool('thanos', 6000)) return;
    const cand = [...document.querySelectorAll('.panel')].filter((p) => { const r = p.getBoundingClientRect(); return p.offsetParent && r.width > 90 && r.height > 60 && r.bottom > 0 && r.top < innerHeight && r.left < innerWidth && r.right > 0; });
    if (!cand.length) return still('Perfectly balanced. As all things should be.');
    const p = pick(cand), r = p.getBoundingClientRect();
    if (reduced()) { const a = p.animate([{ opacity: 1 }, { opacity: 0 }, { opacity: 0 }, { opacity: 1 }], { duration: 2400 }); return void a; }
    const a = p.animate([{ opacity: 1, filter: 'none', transform: 'none' }, { opacity: 0.6, filter: 'blur(1px) grayscale(1)', offset: 0.3 }, { opacity: 0, filter: 'blur(6px)', transform: 'translateX(40px) scale(.97)', offset: 0.55 }, { opacity: 0, filter: 'blur(6px)', transform: 'translateX(40px)', offset: 0.85 }, { opacity: 1, filter: 'none', transform: 'none' }], { duration: 3600, easing: 'ease-in-out' });
    const box = overlay('egg-dust', '', 3000);
    for (let i = 0; i < 70; i++) { const d = el('i'); d.style.cssText = `left:${r.left + Math.random() * r.width}px;top:${r.top + Math.random() * r.height}px;animation-delay:${Math.random() * 0.8 + 0.4}s;--dx:${60 + rnd(160)}px;--dy:${rnd(120) - 90}px`; box.appendChild(d); }
    setTimeout(() => bubble('I don\u2019t feel so good\u2026 (it comes back, promise)', 2200), 1400);
    void a;
  }
  function gravity() {
    if (!cool('gravity', 8000)) return;
    const cand = [...document.querySelectorAll('.panel')].filter((p) => { const r = p.getBoundingClientRect(); return p.offsetParent && r.width > 60 && r.height > 40 && r.top < innerHeight && r.bottom > 0; }).slice(0, 14);
    if (!cand.length || reduced()) return still('Gravity is a suggestion.');
    cand.forEach((p, i) => {
      const r = p.getBoundingClientRect(), d = Math.max(0, Math.min(560, innerHeight - r.bottom - 6)), rot = (Math.random() - 0.5) * 12, T = `translateY(${d}px) rotate(${rot}deg)`;
      p.animate([{ transform: 'none' }, { transform: T, offset: 0.3, easing: 'cubic-bezier(.5,0,1,.7)' }, { transform: `translateY(${d - 26}px) rotate(${rot}deg)`, offset: 0.4, easing: 'ease-in' }, { transform: T, offset: 0.48 }, { transform: T, offset: 0.78, easing: 'cubic-bezier(.3,1.4,.5,1)' }, { transform: 'none' }], { duration: 3600, delay: i * 40, easing: 'linear' });
    });
  }
  function fortytwo() {
    if (!cool('42', 4000)) return;
    const o = overlay('egg-42', '<small>DEEP THOUGHT is thinking\u2026</small><b>&nbsp;</b><span></span>'); o.classList.add('in');
    setTimeout(() => { o.querySelector('small').textContent = 'THE ANSWER TO LIFE, THE UNIVERSE AND EVERYTHING'; o.querySelector('b').textContent = '42'; o.querySelector('span').textContent = 'now, what was the question?'; }, reduced() ? 100 : 1400);
    setTimeout(() => o.classList.add('out'), 4300); setTimeout(() => o.remove(), 4800);
  }
  function bork() {
    if (!cool('bork', 6000)) return; if (reduced()) return still('BORK! (a dog ran by)');
    const R = (x, y, w, h, c) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`, B = '#c68642', D = '#6b3d12';
    const dog = `<svg viewBox="0 0 18 12" shape-rendering="crispEdges">${R(2, 3, 9, 5, B) + R(10, 1, 5, 5, B) + R(14, 3, 3, 2, D) + R(11, 0, 2, 3, D) + R(13, 2, 1, 1, '#000') + R(0, 2, 2, 2, B) + R(1, 1, 1, 1, B)}<g class="d1">${R(3, 8, 2, 3, D) + R(9, 8, 2, 3, D)}</g><g class="d2">${R(5, 8, 2, 2, D) + R(7, 8, 2, 2, D)}</g></svg>`;
    const d = overlay('egg-dog', `<em>BORK!</em>${dog}`, 5200);
  }
  function abracadabra() { ping('hs-eggs-reveal'); }

  // =====================================================================================
  // USEFUL EGGS (small overlays)
  // =====================================================================================
  // ---- calc ----
  function calcEval(src, ans) {
    const s = String(src).toLowerCase().replace(/[\u00d7]/g, '*').replace(/[\u00f7]/g, '/').replace(/,/g, '').replace(/\s+/g, '');
    const toks = s.match(/\d*\.?\d+(?:e[+-]?\d+)?|[a-z]+|\*\*|[-+*/%^()]/g) || [];
    if (!toks.length || toks.join('') !== s) throw new Error('?');
    let i = 0; const C = { pi: Math.PI, e: Math.E, ans: ans || 0, tau: Math.PI * 2 };
    const F = { sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan, log: Math.log10, ln: Math.log, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil, exp: Math.exp };
    const peek = () => toks[i], nx = () => toks[i++];
    function expr() { let v = term(); while (peek() === '+' || peek() === '-') v = nx() === '+' ? v + term() : v - term(); return v; }
    function term() { let v = un(); while (peek() === '*' || peek() === '/' || peek() === '%') { const o = nx(), r = un(); v = o === '*' ? v * r : o === '/' ? v / r : v % r; } return v; }
    function un() { if (peek() === '-') { nx(); return -un(); } if (peek() === '+') { nx(); return un(); } return pw(); }
    function pw() { const b = atom(); if (peek() === '^' || peek() === '**') { nx(); return Math.pow(b, un()); } return b; }
    function atom() {
      const t = nx(); if (t === undefined) throw new Error('?');
      if (/^[\d.]/.test(t)) return parseFloat(t);
      if (t === '(') { const v = expr(); if (nx() !== ')') throw new Error('?'); return v; }
      if (/^[a-z]+$/.test(t)) { if (peek() === '(' && F[t]) { nx(); const v = expr(); if (nx() !== ')') throw new Error('?'); return F[t](v); } if (t in C) return C[t]; }
      throw new Error('?');
    }
    const v = expr(); if (i < toks.length || !isFinite(v)) throw new Error('?'); return v;
  }
  function calc() {
    const c = st('calc', { hist: [] });
    const p = panel('calc', 'CALCULATOR', '<input class="ep-in" spellcheck="false" autocomplete="off" placeholder="2+2*3, sqrt(2), 15% of is mod: 15%4, pi*r^2" /><div class="ep-big" data-r>&nbsp;</div><div class="ep-row"><button class="ep-btn" data-cp>COPY RESULT</button><button class="ep-btn" data-cl>CLEAR HISTORY</button></div><div class="ep-list" data-h></div>');
    if (!p) return; const inp = p.querySelector('input'), out = p.querySelector('[data-r]'), hl = p.querySelector('[data-h]'); let last = '';
    inp.placeholder = 'type 2+2*3 and press Enter  (sqrt, sin, pi, ^, %)';
    const paint = () => { hl.innerHTML = c.hist.slice(-8).reverse().map((h, i) => `<div data-i="${c.hist.length - 1 - i}"><em>${esc(h[0])}</em> = <b>${esc(h[1])}</b></div>`).join('') || '<div class="ep-dim">no history yet</div>'; };
    const show = (v) => { out.textContent = v; };
    inp.addEventListener('input', () => { try { if (inp.value.trim()) show('= ' + fmtNum(calcEval(inp.value, +last))); else show('\u00a0'); } catch { show('\u00a0'); } });
    inp.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      try { const v = calcEval(inp.value, +last), r = fmtNum(v); c.hist.push([inp.value.trim(), r]); c.hist = c.hist.slice(-30); save(); last = String(v); show('= ' + r); copy(r); note(`Copied ${r}`); inp.value = ''; paint(); } catch { show('hmm, I can\u2019t read that'); }
    });
    p.addEventListener('click', (e) => {
      if (e.target.closest('[data-cp]')) { const r = out.textContent.replace(/^=\s*/, '').trim(); if (r) { copy(r); note('Copied.'); } }
      if (e.target.closest('[data-cl]')) { c.hist = []; save(); paint(); }
      const h = e.target.closest('[data-i]'); if (h) { const x = c.hist[+h.dataset.i]; if (x) { inp.value = x[0]; inp.focus(); inp.dispatchEvent(new Event('input')); } }
    });
    paint();
  }
  const fmtNum = (v) => (Number.isInteger(v) ? String(v) : String(+v.toPrecision(12)));

  // ---- timer ----
  function timer() {
    const t = st('timer', { len: 5 * 60e3, paused: 0 });
    const p = panel('timer', 'TIMER', '<div class="ep-big" data-t>0:00</div><div class="ep-bar"><i data-b></i></div><div class="ep-row" data-pre></div><div class="ep-row"><input class="ep-in sm" data-m type="number" min="1" max="600" placeholder="min" /><input class="ep-in" data-l maxlength="30" placeholder="label (optional)" /></div><div class="ep-row"><button class="ep-btn on" data-go>START</button><button class="ep-btn" data-pa>PAUSE</button><button class="ep-btn" data-rs>RESET</button></div>', { focus: false });
    if (!p) return; const pre = p.querySelector('[data-pre]');
    pre.innerHTML = [1, 5, 10, 15, 25, 45, 60].map((m) => `<button class="ep-btn" data-p="${m}">${m}m</button>`).join('');
    const paint = () => {
      const r = runs().timer, left = r ? r.end - Date.now() : (t.paused || t.len); p.querySelector('[data-t]').textContent = fmtMS(left);
      p.querySelector('[data-b]').style.width = `${r || t.paused ? Math.max(0, Math.min(100, (left / t.len) * 100)) : 100}%`;
      p.querySelector('[data-pa]').textContent = t.paused && !r ? 'RESUME' : 'PAUSE';
    };
    const lbl = () => p.querySelector('[data-l]').value.trim() || 'timer';
    const go = (ms) => { t.len = ms; t.paused = 0; save(); askNotify(); runStart('timer', ms, 0, lbl()); paint(); };
    p.addEventListener('click', (e) => {
      const pr = e.target.closest('[data-p]'); if (pr) return go(+pr.dataset.p * 60e3);
      if (e.target.closest('[data-go]')) { const m = parseFloat(p.querySelector('[data-m]').value); return go(m > 0 ? Math.min(600, m) * 60e3 : t.len); }
      if (e.target.closest('[data-pa]')) { const r = runs().timer; if (r) { t.paused = Math.max(0, r.end - Date.now()); runStop('timer'); } else if (t.paused) { const m = t.paused; t.paused = 0; runStart('timer', m, 0, lbl()); } save(); paint(); }
      if (e.target.closest('[data-rs]')) { runStop('timer'); t.paused = 0; save(); paint(); }
    });
    paint(); p._iv = setInterval(paint, 500);
  }

  // ---- stopwatch ----
  function stopwatch() {
    const w = st('sw', { acc: 0, since: 0, laps: [] });
    const p = panel('sw', 'STOPWATCH', '<div class="ep-big" data-t>0:00.00</div><div class="ep-row"><button class="ep-btn on" data-go>START</button><button class="ep-btn" data-lap>LAP</button><button class="ep-btn" data-rs>RESET</button></div><div class="ep-list" data-l></div>', { focus: false });
    if (!p) return;
    const now = () => w.acc + (w.since ? Date.now() - w.since : 0);
    const fmt = (ms) => `${Math.floor(ms / 60000)}:${pad2(Math.floor(ms / 1000) % 60)}.${pad2(Math.floor((ms % 1000) / 10))}`;
    const paint = () => {
      p.querySelector('[data-t]').textContent = fmt(now()); p.querySelector('[data-go]').textContent = w.since ? 'STOP' : 'START';
      p.querySelector('[data-l]').innerHTML = w.laps.slice().reverse().map((l, i) => `<div><em>LAP ${w.laps.length - i}</em> <b>${fmt(l[0])}</b> <span class="ep-dim">+${fmt(l[1])}</span></div>`).join('');
    };
    p.addEventListener('click', (e) => {
      if (e.target.closest('[data-go]')) { if (w.since) { w.acc += Date.now() - w.since; w.since = 0; } else w.since = Date.now(); }
      else if (e.target.closest('[data-lap]')) { const n = now(), prev = w.laps.length ? w.laps[w.laps.length - 1][0] : 0; if (n > 0) w.laps.push([n, n - prev]); }
      else if (e.target.closest('[data-rs]')) { w.acc = 0; w.since = 0; w.laps = []; }
      save(); paint();
    });
    paint(); p._iv = setInterval(paint, 50);
  }

  // ---- scratch notes ----
  function scratch() {
    const s = st('scratch', { text: '' });
    const p = panel('scratch', 'SCRATCHPAD', '<textarea class="ep-ta" spellcheck="false" placeholder="jot something down, it is saved as you type"></textarea><div class="ep-row"><button class="ep-btn" data-cp>COPY</button><button class="ep-btn" data-cl>CLEAR</button><span class="ep-dim" data-n></span></div>');
    if (!p) return; const ta = p.querySelector('textarea'), n = p.querySelector('[data-n]'); ta.value = s.text;
    const cnt = () => { n.textContent = `${ta.value.length} chars`; }; cnt();
    ta.addEventListener('input', () => { s.text = ta.value.slice(0, 20000); save(); cnt(); });
    p.addEventListener('click', (e) => { if (e.target.closest('[data-cp]')) { copy(ta.value); note('Copied.'); } if (e.target.closest('[data-cl]')) { if (ta.value && !confirm('Clear the scratchpad?')) return; ta.value = ''; s.text = ''; save(); cnt(); } });
  }

  // ---- clipboard history ring (only collects while ON, only from copy events inside HYPERSPACE) ----
  document.addEventListener('copy', () => {
    try {
      const c = st('clip', { on: false, items: [] }); if (!c.on || selfCopy || !S.on) return;
      const a = document.activeElement; if (a && a.type === 'password') return;
      let txt = ''; if (a && /^(INPUT|TEXTAREA)$/.test(a.tagName) && typeof a.selectionStart === 'number') txt = a.value.slice(a.selectionStart, a.selectionEnd); else txt = String(window.getSelection() || '');
      txt = txt.trim().slice(0, 2000); if (!txt) return;
      c.items = [txt, ...c.items.filter((x) => x !== txt)].slice(0, 20); save(); ping('hs-eggs-clip');
    } catch {}
  }, true);
  function clip() {
    const c = st('clip', { on: false, items: [] });
    const p = panel('clip', 'CLIPBOARD HISTORY', '<div class="ep-row"><button class="ep-btn" data-on></button><button class="ep-btn" data-cl>CLEAR</button></div><div class="ep-dim">Remembers text you copy inside HYPERSPACE only (last 20). Stays on this PC. Click one to copy it back.</div><div class="ep-list" data-l></div>', { focus: false });
    if (!p) return;
    const paint = () => {
      p.querySelector('[data-on]').textContent = c.on ? 'COLLECTING: ON' : 'COLLECTING: OFF'; p.querySelector('[data-on]').classList.toggle('on', c.on);
      p.querySelector('[data-l]').innerHTML = c.items.map((t, i) => `<div class="ep-clip" data-i="${i}" title="click to copy">${esc(t.slice(0, 120))}</div>`).join('') || `<div class="ep-dim">${c.on ? 'Nothing copied yet. Copy some text in HYPERSPACE.' : 'Turn collecting on, then copy text.'}</div>`;
    };
    p.addEventListener('click', (e) => {
      if (e.target.closest('[data-on]')) { c.on = !c.on; save(); paint(); }
      else if (e.target.closest('[data-cl]')) { c.items = []; save(); paint(); }
      else { const r = e.target.closest('[data-i]'); if (r && c.items[+r.dataset.i] != null) { copy(c.items[+r.dataset.i]); note('Copied back.'); } }
    });
    const h = () => paint(); document.addEventListener('hs-eggs-clip', h); p._off = () => document.removeEventListener('hs-eggs-clip', h);
    if (!c.on) { c.on = true; save(); } paint();
  }

  // ---- dice + coin ----
  function dice(w) {
    const d = st('dice', { heads: 0, tails: 0, last: '' });
    const p = panel('dice', 'DICE &amp; COIN', '<div class="ep-big" data-r>&nbsp;</div><div class="ep-row" data-d></div><div class="ep-row"><button class="ep-btn" data-coin>FLIP A COIN</button><label class="ep-dim">dice <input class="ep-in sm" data-n type="number" min="1" max="10" value="1" /></label></div><div class="ep-dim" data-s></div>', { focus: false });
    if (!p) return; const r = p.querySelector('[data-r]');
    p.querySelector('[data-d]').innerHTML = [4, 6, 8, 10, 12, 20, 100].map((n) => `<button class="ep-btn" data-sd="${n}">d${n}</button>`).join('');
    const stat = () => { p.querySelector('[data-s]').textContent = `coin: ${d.heads} heads / ${d.tails} tails`; }; stat();
    const rand = (n) => { try { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; } catch { return rnd(n); } };
    const spin = (fin, ms = 450) => { if (reduced()) return fin(); r.classList.add('spin'); let k = 0; const iv = setInterval(() => { r.textContent = String(1 + rand(20)); if (++k > ms / 60) { clearInterval(iv); r.classList.remove('spin'); fin(); } }, 60); };
    p.addEventListener('click', (e) => {
      const sd = e.target.closest('[data-sd]'); if (sd) { const s = +sd.dataset.sd, n = Math.max(1, Math.min(10, +p.querySelector('[data-n]').value || 1)); spin(() => { const rs = Array.from({ length: n }, () => 1 + rand(s)); r.textContent = n > 1 ? `${rs.join(' + ')} = ${rs.reduce((a, b) => a + b, 0)}` : String(rs[0]); }); }
      if (e.target.closest('[data-coin]')) { r.classList.add('flipc'); setTimeout(() => { r.classList.remove('flipc'); const h = rand(2) === 0; h ? d.heads++ : d.tails++; r.textContent = h ? 'HEADS' : 'TAILS'; save(); stat(); }, reduced() ? 10 : 500); }
    });
    if (w === 'coin') p.querySelector('[data-coin]').click(); else r.textContent = 'pick a die';
  }

  // ---- colors ----
  function colors() {
    const c = st('colors', { cur: '#00ff9c', recent: [] });
    const p = panel('colors', 'COLOR PICKER', '<div class="ep-row"><input type="color" data-c /><input class="ep-in" data-hex maxlength="7" spellcheck="false" /><button class="ep-btn" data-eye>PICK FROM SCREEN</button></div><div class="ep-sw" data-sw></div><div class="ep-list" data-o></div><div class="ep-row" data-rec></div>', { focus: false });
    if (!p) return; const cp = p.querySelector('[data-c]'), hx = p.querySelector('[data-hex]');
    if (!window.EyeDropper) p.querySelector('[data-eye]').remove();
    const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const hsl = ([r, g, b]) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0; if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; } return [Math.round(h), Math.round(s * 100), Math.round(l * 100)]; };
    const paint = () => {
      const h = c.cur, v = rgb(h), hh = hsl(v); cp.value = h; hx.value = h; p.querySelector('[data-sw]').style.background = h;
      const rows = [['HEX', h.toUpperCase()], ['RGB', `rgb(${v.join(', ')})`], ['HSL', `hsl(${hh[0]}, ${hh[1]}%, ${hh[2]}%)`]];
      p.querySelector('[data-o]').innerHTML = rows.map((r) => `<div class="ep-copyrow" data-v="${esc(r[1])}"><em>${r[0]}</em> <b>${esc(r[1])}</b> <span>COPY</span></div>`).join('');
      p.querySelector('[data-rec]').innerHTML = c.recent.map((x) => `<i class="ep-dot" data-pick="${x}" style="background:${x}" title="${x}"></i>`).join('');
    };
    const set = (h, remember) => { if (!/^#[0-9a-f]{6}$/i.test(h)) return; c.cur = h.toLowerCase(); if (remember) c.recent = [c.cur, ...c.recent.filter((x) => x !== c.cur)].slice(0, 10); save(); paint(); };
    cp.addEventListener('input', () => set(cp.value, false)); cp.addEventListener('change', () => set(cp.value, true));
    hx.addEventListener('change', () => { let v = hx.value.trim(); if (/^[0-9a-f]{6}$/i.test(v)) v = '#' + v; set(v, true); });
    p.addEventListener('click', (e) => {
      const r = e.target.closest('[data-v]'); if (r) { copy(r.dataset.v); note(`Copied ${r.dataset.v}`); set(c.cur, true); }
      const q = e.target.closest('[data-pick]'); if (q) set(q.dataset.pick, false);
      if (e.target.closest('[data-eye]')) { new EyeDropper().open().then((x) => set(x.sRGBHex, true)).catch(() => {}); }
    });
    paint();
  }

  // ---- uuid + password ----
  function uuid() {
    const p = panel('uuid', 'UUID', '<div class="ep-big sm" data-u></div><div class="ep-row"><button class="ep-btn on" data-n>NEW &amp; COPY</button><button class="ep-btn" data-c>COPY AGAIN</button></div><div class="ep-dim">random v4, made with crypto.randomUUID</div>', { focus: false });
    if (!p) return; const u = p.querySelector('[data-u]');
    const gen = () => { let v; try { v = crypto.randomUUID(); } catch { const a = crypto.getRandomValues(new Uint8Array(16)); a[6] = (a[6] & 15) | 64; a[8] = (a[8] & 63) | 128; const h = [...a].map((x) => pad2(x.toString(16))).join(''); v = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; } u.textContent = v; copy(v); note('UUID copied.'); };
    p.addEventListener('click', (e) => { if (e.target.closest('[data-n]')) gen(); if (e.target.closest('[data-c]')) { copy(u.textContent); note('Copied.'); } });
    gen();
  }
  function pass() {
    const c = st('pass', { len: 20, sym: true });
    const p = panel('pass', 'PASSWORD MAKER', '<div class="ep-big sm" data-p></div><div class="ep-row"><label class="ep-dim">length <input class="ep-in sm" data-l type="number" min="8" max="64" /></label><label class="ep-dim"><input type="checkbox" data-s /> symbols</label></div><div class="ep-row"><button class="ep-btn on" data-n>NEW &amp; COPY</button><button class="ep-btn" data-c>COPY AGAIN</button></div><div class="ep-bar"><i data-b></i></div><div class="ep-dim" data-e></div>', { focus: false });
    if (!p) return; const out = p.querySelector('[data-p]'); p.querySelector('[data-l]').value = c.len; p.querySelector('[data-s]').checked = c.sym;
    const gen = () => {
      c.len = Math.max(8, Math.min(64, +p.querySelector('[data-l]').value || 20)); c.sym = p.querySelector('[data-s]').checked; save();
      const set = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789' + (c.sym ? '!@#$%^&*-_=+?' : ''); const a = new Uint32Array(c.len); crypto.getRandomValues(a);
      const lim = 4294967296 - (4294967296 % set.length); let s = ''; for (let i = 0; i < c.len; i++) { let x = a[i]; while (x >= lim) x = crypto.getRandomValues(new Uint32Array(1))[0]; s += set[x % set.length]; }
      out.textContent = s; copy(s); note('Password copied.');
      const bits = Math.round(c.len * Math.log2(set.length)); p.querySelector('[data-b]').style.width = `${Math.min(100, bits / 1.6)}%`; p.querySelector('[data-e]').textContent = `about ${bits} bits of entropy, ${bits >= 100 ? 'very strong' : bits >= 70 ? 'strong' : 'okay'}. Not saved anywhere.`;
    };
    p.addEventListener('click', (e) => { if (e.target.closest('[data-n]')) gen(); if (e.target.closest('[data-c]')) { copy(out.textContent); note('Copied.'); } });
    gen();
  }

  // ---- base64 ----
  function base64() {
    const p = panel('b64', 'BASE64', '<textarea class="ep-ta" data-i spellcheck="false" placeholder="paste text or base64"></textarea><div class="ep-row"><button class="ep-btn on" data-e>ENCODE</button><button class="ep-btn on" data-d>DECODE</button><button class="ep-btn" data-sw>SWAP</button></div><textarea class="ep-ta" data-o readonly placeholder="result"></textarea><div class="ep-row"><button class="ep-btn" data-cp>COPY RESULT</button><span class="ep-dim" data-m></span></div>');
    if (!p) return; const i = p.querySelector('[data-i]'), o = p.querySelector('[data-o]'), m = p.querySelector('[data-m]');
    const enc = (s) => { const b = new TextEncoder().encode(s); let x = ''; b.forEach((c) => { x += String.fromCharCode(c); }); return btoa(x); };
    const dec = (s) => { const x = atob(s.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')); return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(x, (c) => c.charCodeAt(0))); };
    p.addEventListener('click', (e) => {
      try {
        if (e.target.closest('[data-e]')) { o.value = enc(i.value); m.textContent = 'encoded'; }
        else if (e.target.closest('[data-d]')) { o.value = dec(i.value); m.textContent = 'decoded'; }
        else if (e.target.closest('[data-sw]')) { const t = o.value; o.value = i.value; i.value = t; m.textContent = ''; }
        else if (e.target.closest('[data-cp]')) { copy(o.value); note('Copied.'); }
      } catch { o.value = ''; m.textContent = 'that is not valid base64 text'; }
    });
  }

  // ---- lorem ----
  const LOREM = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. Curabitur pretium tincidunt lacus, nulla gravida orci a odio. Nullam varius, turpis et commodo pharetra, est eros bibendum elit, nec luctus magna felis sollicitudin mauris.'.split(/(?<=\.)\s+/);
  function loremText(kind, n) {
    if (kind === 'words') return LOREM.join(' ').replace(/[.,]/g, '').toLowerCase().split(' ').slice(0, n).join(' ');
    if (kind === 'sentences') return Array.from({ length: n }, (_, i) => LOREM[i % LOREM.length]).join(' ');
    return Array.from({ length: n }, (_, p) => Array.from({ length: 4 }, (_, i) => LOREM[(p * 3 + i) % LOREM.length]).join(' ')).join('\n\n');
  }
  function lorem() {
    const l = st('lorem', { kind: 'paragraphs', n: 2 });
    const p = panel('lorem', 'LOREM IPSUM', '<div class="ep-row"><input class="ep-in sm" data-n type="number" min="1" max="50" /><select class="ep-in" data-k><option value="paragraphs">paragraphs</option><option value="sentences">sentences</option><option value="words">words</option></select><button class="ep-btn on" data-cp>COPY</button></div><textarea class="ep-ta" data-o readonly></textarea>', { focus: false });
    if (!p) return; const o = p.querySelector('[data-o]'), n = p.querySelector('[data-n]'), k = p.querySelector('[data-k]'); n.value = l.n; k.value = l.kind;
    const gen = () => { l.n = Math.max(1, Math.min(50, +n.value || 1)); l.kind = k.value; save(); o.value = loremText(l.kind, l.n); };
    n.addEventListener('input', gen); k.addEventListener('change', gen);
    p.addEventListener('click', (e) => { if (e.target.closest('[data-cp]')) { copy(o.value); note('Lorem ipsum copied.'); } });
    gen(); copy(o.value); note('Lorem ipsum copied.');
  }

  // ---- world clock ----
  function world() {
    const w = st('world', { zones: ['local', 'UTC', 'America/New_York', 'Europe/London', 'Asia/Tokyo', 'Australia/Sydney'] });
    const p = panel('world', 'WORLD CLOCK', '<div class="ep-list" data-l></div><div class="ep-row"><input class="ep-in" data-z list="egg-zones" placeholder="add a zone, e.g. Europe/Paris" /><button class="ep-btn" data-add>ADD</button></div><datalist id="egg-zones"></datalist><div class="ep-dim" data-m>click a row\u2019s x to remove</div>', { focus: false, w: 340 });
    if (!p) return;
    try { p.querySelector('#egg-zones').innerHTML = (Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : []).map((z) => `<option value="${z}">`).join(''); } catch {}
    const fmt = (z) => { try { const o = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, weekday: 'short' }; if (z !== 'local') o.timeZone = z; return new Intl.DateTimeFormat([], o).format(new Date()); } catch { return '--'; } };
    const name = (z) => (z === 'local' ? 'LOCAL' : z === 'UTC' ? 'UTC' : z.split('/').pop().replace(/_/g, ' ').toUpperCase());
    const paint = () => { p.querySelector('[data-l]').innerHTML = w.zones.map((z, i) => `<div class="ep-zone"><em>${esc(name(z))}</em><b>${esc(fmt(z))}</b><button data-rm="${i}" aria-label="Remove">&times;</button></div>`).join(''); };
    p.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-rm]'); if (rm) { w.zones.splice(+rm.dataset.rm, 1); save(); return paint(); }
      if (e.target.closest('[data-add]')) { const v = p.querySelector('[data-z]').value.trim(); try { new Intl.DateTimeFormat([], { timeZone: v }); if (!w.zones.includes(v) && w.zones.length < 12) { w.zones.push(v); save(); p.querySelector('[data-z]').value = ''; paint(); } } catch { p.querySelector('[data-m]').textContent = 'unknown zone: use names like Asia/Dubai'; } }
    });
    p.querySelector('[data-z]').addEventListener('keydown', (e) => { if (e.key === 'Enter') p.querySelector('[data-add]').click(); });
    paint(); p._iv = setInterval(paint, 1000);
  }

  // ---- unit converter ----
  const UNITS = {
    length: { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344 },
    mass: { mg: 1e-6, g: 0.001, kg: 1, oz: 0.028349523125, lb: 0.45359237, st: 6.35029318 },
    data: { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, KiB: 1024, MiB: 1048576, GiB: 1073741824 },
    temp: { C: 1, F: 1, K: 1 },
  };
  function toTemp(v, f, t) { const c = f === 'C' ? v : f === 'F' ? (v - 32) * 5 / 9 : v - 273.15; return t === 'C' ? c : t === 'F' ? c * 9 / 5 + 32 : c + 273.15; }
  function convert() {
    const c = st('conv', { cat: 'length', from: 'm', v: 1 });
    const p = panel('conv', 'UNIT CONVERTER', '<div class="ep-row" data-cats></div><div class="ep-row"><input class="ep-in" data-v type="number" step="any" /><select class="ep-in" data-f></select></div><div class="ep-list" data-o></div>');
    if (!p) return;
    p.querySelector('[data-cats]').innerHTML = Object.keys(UNITS).map((k) => `<button class="ep-btn" data-cat="${k}">${k.toUpperCase()}</button>`).join('');
    const paint = (units) => {
      const U = UNITS[c.cat]; if (!U[c.from]) c.from = Object.keys(U)[0];
      p.querySelectorAll('[data-cat]').forEach((b) => b.classList.toggle('on', b.dataset.cat === c.cat));
      if (units !== false) p.querySelector('[data-f]').innerHTML = Object.keys(U).map((u) => `<option${u === c.from ? ' selected' : ''}>${u}</option>`).join('');
      p.querySelector('[data-v]').value = c.v;
      const v = +c.v; p.querySelector('[data-o]').innerHTML = Object.keys(U).filter((u) => u !== c.from).map((u) => { const r = c.cat === 'temp' ? toTemp(v, c.from, u) : (v * U[c.from]) / U[u]; const t = fmtNum(+r.toPrecision(8)); return `<div class="ep-copyrow" data-v="${t}"><em>${u}</em> <b>${t}</b> <span>COPY</span></div>`; }).join('');
    };
    p.addEventListener('click', (e) => { const k = e.target.closest('[data-cat]'); if (k) { c.cat = k.dataset.cat; c.from = Object.keys(UNITS[c.cat])[0]; save(); paint(); } const r = e.target.closest('.ep-copyrow'); if (r) { copy(r.dataset.v); note(`Copied ${r.dataset.v}`); } });
    p.querySelector('[data-v]').addEventListener('input', (e) => { c.v = e.target.value === '' ? 0 : +e.target.value; save(); paint(false); });
    p.querySelector('[data-f]').addEventListener('change', (e) => { c.from = e.target.value; save(); paint(false); });
    paint();
  }

  // ---- panic (boring spreadsheet) ----
  let panicEl = null, mutedBefore = [];
  function panicOn() {
    if (panicEl) return;
    const rows = 28, cols = 'ABCDEFGH'.split('');
    let tb = '<tr><th></th>' + cols.map((c) => `<th>${c}</th>`).join('') + '</tr>';
    const hd = ['Region', 'Q1', 'Q2', 'Q3', 'Q4', 'Total', 'Target', 'Var %'];
    for (let r = 1; r <= rows; r++) tb += `<tr><th>${r}</th>${cols.map((c, i) => `<td>${r === 1 ? hd[i] : i === 0 ? pick(['North', 'South', 'East', 'West', 'Central', 'Export', 'Online', 'Retail']) : i === 7 ? (Math.random() * 14 - 5).toFixed(1) + '%' : (1000 + rnd(90000)).toLocaleString()}</td>`).join('')}</tr>`;
    panicEl = el('div', 'egg-panic', `<div class="pn-bar">File &nbsp; Home &nbsp; Insert &nbsp; Page Layout &nbsp; Formulas &nbsp; Data &nbsp; Review &nbsp; View<span>Budget_FY26_final_v7.xlsx</span></div><div class="pn-fx">fx &nbsp;=SUM(B2:E2)</div><div class="pn-wrap"><table>${tb}</table></div><div class="pn-tabs"><b>Sheet1</b><i>Sheet2</i><i>Notes</i></div>`);
    document.body.appendChild(panicEl);
    mutedBefore = []; document.querySelectorAll('audio,video').forEach((m) => { mutedBefore.push([m, m.muted]); m.muted = true; });
    try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch {}
  }
  function panicOff() {
    if (!panicEl) return; panicEl.remove(); panicEl = null;
    mutedBefore.forEach(([m, was]) => { try { m.muted = was; } catch {} }); mutedBefore = [];
  }
  function panic() { if (panicEl) return; panicOn(); }
  let escAt = 0, escHold = 0;
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (panicEl) { e.stopPropagation(); e.preventDefault(); const t = Date.now(); if (t - escAt < 700) { escAt = 0; panicOff(); } else escAt = t; return; }
    if (!e.repeat && S.on && !escHold) escHold = setTimeout(() => { escHold = 0; panicOn(); mark('panic'); note('PANIC: press Esc twice to come back.'); }, 2000);
  }, true);
  window.addEventListener('keyup', (e) => { if (e.key === 'Escape' && escHold) { clearTimeout(escHold); escHold = 0; } }, true);
  window.addEventListener('blur', () => { if (escHold) { clearTimeout(escHold); escHold = 0; } });

  // ---- 20-20-20 break ----
  function breakCount() {
    if (pnls.brkc) return;
    const p = panel('brkc', 'LOOK AWAY', '<div class="ep-big" data-t>20</div><div class="ep-dim">Look at something 20 feet (6 m) away.</div>', { focus: false });
    if (!p) return; let n = 20; const iv = setInterval(() => { n--; const t = p.querySelector('[data-t]'); if (t) t.textContent = n > 0 ? n : 'DONE'; if (n <= 0) { clearInterval(iv); setTimeout(() => closeP('brkc'), 1200); } }, 1000); p._off = () => clearInterval(iv);
  }
  function breakEgg() {
    const p = panel('brk', 'EYE BREAK 20-20-20', '<div class="ep-dim">Every 20 minutes, look at something 20 feet away for 20 seconds.</div><div class="ep-big sm" data-s>OFF</div><div class="ep-row"><button class="ep-btn on" data-go></button><button class="ep-btn" data-now>20s BREAK NOW</button></div>', { focus: false });
    if (!p) return;
    const paint = () => { const r = runs().brk; p.querySelector('[data-s]').textContent = r ? `next in ${fmtMS(r.end - Date.now())}` : 'OFF'; p.querySelector('[data-go]').textContent = r ? 'STOP REMINDERS' : 'START (every 20 min)'; };
    p.addEventListener('click', (e) => { if (e.target.closest('[data-go]')) { if (runs().brk) runStop('brk'); else { askNotify(); runStart('brk', 20 * 60e3, 20 * 60e3, '20-20-20'); } paint(); } if (e.target.closest('[data-now]')) breakCount(); });
    paint(); p._iv = setInterval(paint, 1000);
  }
  // ---- stretch ----
  const STRETCHES = [['NECK', 'Slowly tilt your ear to your shoulder. Switch sides.'], ['SHOULDERS', 'Roll your shoulders back, big slow circles.'], ['WRISTS', 'Extend an arm, pull the fingers back gently. Switch.'], ['CHEST', 'Clasp hands behind you, lift and open the chest.'], ['SPINE', 'Sit tall, twist gently to one side, then the other.'], ['LEGS', 'Stand up, reach for your toes (knees soft).'], ['EYES', 'Look far away, blink slowly ten times.']];
  function stretch() {
    const p = panel('stretch', 'STRETCH BREAK', '<div class="ep-dim" data-k>7 stretches, 30 seconds each.</div><div class="ep-big sm" data-n>READY</div><div class="ep-dim" data-d></div><div class="ep-bar"><i data-b></i></div><div class="ep-row"><button class="ep-btn on" data-go>START</button><button class="ep-btn" data-sk>SKIP</button></div>', { focus: false });
    if (!p) return; let i = -1, t0 = 0, iv = 0;
    const next = () => { i++; if (i >= STRETCHES.length) { clearInterval(iv); iv = 0; p.querySelector('[data-n]').textContent = 'ALL DONE'; p.querySelector('[data-d]').textContent = 'Nice. Shoulders down, breathe.'; p.querySelector('[data-b]').style.width = '100%'; p.querySelector('[data-go]').textContent = 'AGAIN'; i = -1; note('Stretch break complete.'); return; } t0 = Date.now(); p.querySelector('[data-n]').textContent = `${i + 1}/${STRETCHES.length} ${STRETCHES[i][0]}`; p.querySelector('[data-d]').textContent = STRETCHES[i][1]; beepSnd(660, 80, 0.03); };
    const tick = () => { if (i < 0) return; const e = (Date.now() - t0) / 1000; p.querySelector('[data-b]').style.width = `${Math.min(100, (e / 30) * 100)}%`; if (e >= 30) next(); };
    p.addEventListener('click', (e) => { if (e.target.closest('[data-go]')) { clearInterval(iv); i = -1; next(); iv = setInterval(tick, 250); } if (e.target.closest('[data-sk]') && i >= 0) next(); });
    p._off = () => clearInterval(iv);
  }
  // ---- hydrate ----
  function hydrate() {
    const h = st('hyd', { every: 45, day: '', n: 0 }), today = new Date().toDateString(); if (h.day !== today) { h.day = today; h.n = 0; save(); }
    const p = panel('hyd', 'HYDRATE', '<div class="ep-big" data-n>0</div><div class="ep-dim">glasses today</div><div class="ep-row"><button class="ep-btn on" data-d>I DRANK \u{1F4A7}</button><select class="ep-in" data-e></select></div><div class="ep-row"><button class="ep-btn" data-go></button></div><div class="ep-dim" data-s></div>', { focus: false });
    if (!p) return; const sel = p.querySelector('[data-e]');
    sel.innerHTML = [30, 45, 60, 90].map((m) => `<option value="${m}"${m === h.every ? ' selected' : ''}>every ${m} min</option>`).join('');
    const paint = () => { const r = runs().hyd; p.querySelector('[data-n]').textContent = h.n; p.querySelector('[data-go]').textContent = r ? 'STOP REMINDERS' : 'START REMINDERS'; p.querySelector('[data-s]').textContent = r ? `next in ${fmtMS(r.end - Date.now())}` : 'reminders off'; };
    sel.addEventListener('change', () => { h.every = +sel.value; save(); if (runs().hyd) runStart('hyd', h.every * 60e3, h.every * 60e3, 'water'); paint(); });
    p.addEventListener('click', (e) => { if (e.target.closest('[data-d]')) { h.n++; save(); paint(); } if (e.target.closest('[data-go]')) { if (runs().hyd) runStop('hyd'); else { askNotify(); runStart('hyd', h.every * 60e3, h.every * 60e3, 'water'); } paint(); } });
    paint(); p._iv = setInterval(paint, 1000);
  }
  // ---- sleep (dim) ----
  let sleepEl = null;
  function sleepEgg() {
    if (sleepEl) { sleepEl.remove(); sleepEl = null; return; }
    const s = st('sleep', { lvl: 1 }), LV = [0.45, 0.65, 0.82];
    sleepEl = el('div', 'egg-sleep', '<button title="darker / lighter. Esc or double-click to wake">\u263E SLEEP MODE \u2022 click to dim more \u2022 Esc wakes</button>');
    sleepEl.style.setProperty('--sl', LV[s.lvl]);
    sleepEl.querySelector('button').addEventListener('click', () => { s.lvl = (s.lvl + 1) % 3; save(); sleepEl.style.setProperty('--sl', LV[s.lvl]); });
    sleepEl.querySelector('button').addEventListener('dblclick', () => { sleepEl && sleepEl.remove(); sleepEl = null; });
    document.body.appendChild(sleepEl);
    const k = (e) => { if (e.key === 'Escape' && sleepEl) { sleepEl.remove(); sleepEl = null; window.removeEventListener('keydown', k, true); } };
    window.addEventListener('keydown', k, true);
  }

  // =====================================================================================
  // REGISTRY. kind: goofy | useful | secret. typed words only fire outside text boxes.
  // =====================================================================================
  const REG = [];
  const def = (id, kind, name, words, hint, desc, run, cd = 1500) => REG.push({ id, kind, name, words, hint, desc, run, cd });
  // goofy
  def('matrix', 'goofy', 'The Matrix', ['matrix'], 'Which pill did you take?', 'Five seconds of falling green code.', matrix, 8000);
  def('xyzzy', 'goofy', 'A Twisty Little Maze', ['xyzzy'], 'An old adventurer\u2019s magic word.', 'A pixel cave says that nothing happens.', xyzzy, 3000);
  def('disco', 'goofy', 'Disco Fever', ['disco'], 'Saturday night, minus the fever.', 'The whole UI cycles colour under a mirror ball for 8 seconds.', disco, 9000);
  def('konami', 'goofy', 'Konami Text', ['konami', 'konamicode'], 'Up up down down\u2026 but with letters.', 'Shows the classic code and +30 lives. (The real arrow-key Konami code is the rabbit\u2019s.)', konami, 5000);
  def('nyan', 'goofy', 'Rainbow Cat', ['nyan'], 'A pop-tart with a cat inside, leaving a trail.', 'A pixel cat with a rainbow trail flies by.', nyan, 6000);
  def('party', 'goofy', 'Glyph Confetti', ['party'], 'Time to celebrate, matrix style.', 'Confetti made of falling code glyphs.', party, 5000);
  def('flip', 'goofy', 'Table Flip', ['flip'], 'Gravity is only a habit.', 'Turns the whole window upside down for 5 seconds.', flip, 8000);
  def('shake', 'goofy', 'Earthquake', ['shake'], 'Not stirred. The other thing.', 'A short earthquake shakes the whole window.', shake, 3000);
  def('glitch', 'goofy', 'Screen Tear', ['glitch'], 'Something is wrong with the feed.', 'A quick colour-split screen glitch.', glitch, 3000);
  def('sudo', 'goofy', 'Sudo Sandwich', ['sudo'], 'Make me a sandwich. What is the magic word?', 'A fake terminal tells you: permission denied, nice try.', sudo, 4000);
  def('hello', 'goofy', 'Say Hi', ['hello', 'hi', 'sup'], 'Be polite and it answers.', 'Greetings get a reply bubble (works without the rabbit).', hello, 800);
  def('beep', 'goofy', 'ASCII Bell', ['beep'], 'The terminal bell, rung visually.', 'A bell drawn in text, a border flash and a tiny beep.', beepEgg, 1500);
  def('warp', 'goofy', 'Hyperspace Jump', ['warp'], 'Punch it, Chewie.', 'Star streaks rush past, then a white flash.', warp, 5000);
  def('pizza', 'goofy', 'Pizza Rolls', ['pizza'], 'Food that rolls on its own.', 'Pizzas roll across the bottom of the screen.', pizza, 5000);
  def('dance', 'goofy', 'Dance Party', ['dance'], 'Nine little people with one move each.', 'A row of ASCII dancers busts a move for 6 seconds.', dance, 6500);
  def('rickroll', 'goofy', 'Never Gonna', ['rickroll'], 'You have been\u2026 politely teased. Offline.', 'A silly marquee scrolls by. No network, no link.', rickroll, 6000);
  def('thanos', 'goofy', 'The Snap', ['thanos', 'snap'], 'Perfectly balanced.', 'Dusts away one random panel, then brings it back.', thanos, 6000);
  def('gravity', 'goofy', 'Gravity', ['gravity'], 'What goes up\u2026', 'Panels fall to the bottom, bounce, and float back.', gravity, 8000);
  def('42', 'goofy', 'The Answer', ['42'], 'Life, the universe and everything.', 'Deep Thought gives its famous answer.', fortytwo, 4000);
  def('bork', 'goofy', 'Good Dog', ['bork', 'woof'], 'Who let it out?', 'A pixel dog trots across and barks.', bork, 6000);
  // useful
  def('zen', 'useful', 'Box Breathing', ['zen'], 'Four in, four hold, four out, four hold.', '60 seconds of guided box breathing. Esc leaves.', zen, 3000);
  def('focus', 'useful', 'Focus Timer', ['focus'], 'Twenty-five minutes, one tomato.', '25-minute pomodoro with a corner ring (type again to check it).', focus, 2000);
  def('calc', 'useful', 'Calculator', ['calc', '='], 'Quick sums without leaving the deck.', 'Mini calculator: type an expression, Enter to compute and copy. Keeps history.', calc, 600);
  def('timer', 'useful', 'Countdown Timer', ['timer'], 'Tick, tick, tick, ding.', 'Countdown with presets; notifies when done and keeps running if you change tabs.', timer, 600);
  def('stopwatch', 'useful', 'Stopwatch', ['stopwatch', 'laps'], 'How long does it really take?', 'Stopwatch with laps. Keeps running when closed.', stopwatch, 600);
  def('scratch', 'useful', 'Scratchpad', ['quicknote', 'scratch', 'notes'], 'A sticky note for your thoughts.', 'Tiny text box that saves as you type, with COPY.', scratch, 600);
  def('clip', 'useful', 'Clipboard History', ['clip', 'clipboard'], 'What did I copy two minutes ago?', 'Remembers the last 20 things you copied inside HYPERSPACE. Local only.', clip, 600);
  def('dice', 'useful', 'Dice and Coin', ['dice', 'coin', 'roll'], 'Leave it to chance.', 'Roll d4 to d100 or flip a coin (crypto-random).', dice, 600);
  def('colors', 'useful', 'Color Picker', ['colors', 'color', 'picker'], 'Hex, RGB, HSL, and an eyedropper.', 'Pick a colour and copy it as hex, rgb or hsl.', colors, 600);
  def('uuid', 'useful', 'UUID Maker', ['uuid', 'guid'], 'A universally unique mouthful.', 'Makes a random UUID and copies it.', uuid, 600);
  def('pass', 'useful', 'Password Maker', ['pass', 'password'], 'Strong ones never come from your head.', 'Generates a strong random password and copies it. Not stored.', pass, 600);
  def('base64', 'useful', 'Base64', ['base64'], 'Sixty-four characters, no secrets.', 'Encode and decode text as base64.', base64, 600);
  def('lorem', 'useful', 'Lorem Ipsum', ['lorem', 'ipsum'], 'Dummy text for a dummy layout.', 'Copies placeholder text (paragraphs, sentences or words).', lorem, 600);
  def('world', 'useful', 'World Clock', ['date', 'time', 'world'], 'What time is it over there?', 'A clock strip for several time zones you can edit.', world, 600);
  def('convert', 'useful', 'Unit Converter', ['convert', 'units'], 'Inches, ounces, gigabytes.', 'Convert length, mass, temperature and data sizes.', convert, 600);
  def('panic', 'useful', 'Panic Button', ['panic'], 'The boss walks in. Also: hold a key for two seconds.', 'Black-out with a boring spreadsheet and muted audio. Hold Esc 2s also works; Esc twice returns.', panic, 600);
  def('break', 'useful', 'Eye Break 20-20-20', ['break', 'eyes'], 'Your eyes work harder than you think.', 'Every 20 minutes: look 20 feet away for 20 seconds.', breakEgg, 600);
  def('stretch', 'useful', 'Stretch Break', ['stretch'], 'Your spine called.', 'A guided 7-step stretch routine.', stretch, 600);
  def('hydrate', 'useful', 'Hydrate', ['hydrate', 'water'], 'The easiest thing you keep forgetting.', 'Recurring drink-water reminders plus a daily glass counter.', hydrate, 600);
  def('sleep', 'useful', 'Sleep Dim', ['sleep', 'dim'], 'Lights down low.', 'Dims the whole UI for late-night use. Esc wakes.', sleepEgg, 600);
  // hands-on and secret
  REG.push({ id: 'clock', kind: 'other', name: 'Binary Clock', words: [], how: 'Double-click the clock in the title bar', hint: 'The clock does more than tell time.', desc: 'Binary and hex clock for 10 seconds.', run: binclock });
  REG.push({ id: 'logo', kind: 'other', name: 'Next Accent', words: [], how: 'Hold Shift and click the HYPERSPACE logo', hint: 'Shift happens.', desc: 'Cycles to the next accent colour with a rainbow sweep.', run: accentCycle });
  REG.push({ id: 'hacker', kind: 'other', name: 'Hacker Terminal', words: [], how: 'Hold Ctrl, then press 6 and 7', hint: 'hold Ctrl and press 6 and 7', desc: 'Fake hacker terminal: mash keys, code streams. Esc leaves.', run: () => { try { window.hsHacker && hsHacker.toggle(); } catch {} } });
  REG.push({ id: 'abracadabra', kind: 'secret', hidden: true, name: 'The Master Word', words: ['abracadabra'], hint: '', desc: 'Reveals the full list of words.', run: abracadabra, cd: 1500 });

  // ---------- typed-words engine ----------
  const WORDMAP = []; // [word, egg]
  REG.forEach((g) => g.words.forEach((w) => WORDMAP.push([w, g])));
  WORDMAP.sort((a, b) => b[0].length - a[0].length);
  let buf = '', lastKey = 0;
  function runEgg(g, word, manual) {
    if (!g || typeof g.run !== 'function') return;
    if (!manual && !cool('egg-' + g.id, g.cd || 1000)) return;
    try { g.run(word); mark(g.id); } catch (err) { try { console.warn('egg', g.id, err); } catch {} }
  }
  document.addEventListener('keydown', (e) => {
    try {
      const t = e.target, tag = t && t.tagName;
      if (!S.on) { buf = ''; return; }
      if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(tag || '') || (t && t.isContentEditable) || inVJ() || zenEl || panicEl) { buf = ''; return; }
      if (!e.key || e.key.length !== 1) return;
      const now = Date.now(); if (now - lastKey > 1600) buf = ''; lastKey = now;
      buf = (buf + e.key.toLowerCase()).slice(-16);
      for (const [w, g] of WORDMAP) if (buf.endsWith(w) && (w.length >= 4 || buf === w || g.id === 'zen' || g.id === 'matrix')) { buf = ''; runEgg(g, w); break; }
    } catch {}
  }, true);
  document.addEventListener('dblclick', (e) => { try { if (e.target.closest && e.target.closest('#clock')) { binclock(); mark('clock'); } } catch {} }, true);
  document.addEventListener('click', (e) => { try { if (e.shiftKey && e.target.closest && e.target.closest('.brand')) { e.preventDefault(); accentCycle(); mark('logo'); } } catch {} }, true);

  // sessions + the one-time hint about the hacker terminal
  try {
    S.sessions = (S.sessions || 0) + 1; save();
    if (S.sessions >= 3 && !S.tip) setTimeout(() => { try { if (S.tip) return; S.tip = 1; save(); note('psst\u2026 try holding Ctrl and pressing 6 and 7'); } catch {} }, 30000);
  } catch {}

  window.hsEggs = {
    matrix, xyzzy, binclock, accent: accentCycle, zen, focus,
    list: REG.filter((g) => !g.hidden).map((g) => g.id),
    registry: () => REG.filter((g) => !g.hidden).map((g) => ({ id: g.id, kind: g.kind, name: g.name, words: g.words.slice(), how: g.how || '', hint: g.hint, desc: g.desc })),
    isFound: (id) => !!S.found[id], foundIds: () => Object.keys(S.found), markFound: mark, markAll: () => { REG.forEach((g) => { if (!S.found[g.id]) S.found[g.id] = Date.now(); }); save(); ping('hs-eggs-changed', {}); },
    run: (id) => { const g = REG.find((x) => x.id === id); if (g) runEgg(g, g.words[0], true); },
    isOn: () => !!S.on, setOn: (v) => { S.on = !!v; save(); ping('hs-eggs-changed', {}); },
    flag: (k, v) => { const f = (S.st.flags = S.st.flags || {}); if (v === undefined) return !!f[k]; f[k] = !!v; save(); return !!v; },
    sessions: () => S.sessions, copy, note, closeAll: () => Object.keys(pnls).forEach(closeP),
  };
})();
