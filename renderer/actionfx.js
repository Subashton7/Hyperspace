// ACTION ANIMATIONS: small, cheap animations for everyday actions (view switch, modals, toasts, switches, rows, drags,
// copy/save, long-press, hover, progress, window focus, typing). Everything is event delegation + one pooled overlay;
// transform/opacity only (SVG dashoffset for the check). Level in localStorage 'hs-actionfx' {level:'off|low|normal'}, default OFF.
// API: window.hsActionFx = { get, set, play(name, el), names }; document event 'actionfx' {detail:{name, el}} plays one too.
// Also injects the CLICK EFFECTS / ACTION ANIMATIONS card into SETTINGS > DISPLAY (so it never needs the rabbit tab).
(() => {
  'use strict';
  if (window.hs && hs.remote) return;
  const KEY = 'hs-actionfx', LEVELS = ['off', 'low', 'normal'];
  let prefs = { level: 'off' };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch {}
  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)');
  const lite = () => document.body.classList.contains('lite') || !!(window.hs && hs.lite && hs.lite.on);
  const lvl = () => { const l = LEVELS.indexOf(prefs.level); if (l < 1 || (reduced && reduced.matches) || document.hidden) return 0; return lite() ? 1 : l; };
  const R = (a, b) => a + Math.random() * (b - a), pick = (a) => a[(Math.random() * a.length) | 0];
  const COLORS = ['#00ff6e', '#9dffb8', '#00c853', '#1de9b6', '#00e5ff'];
  const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽﾊﾋﾌﾍﾎ01<>+*:=';
  const gl = () => GLYPHS[(Math.random() * GLYPHS.length) | 0];
  const MIN = { view: 1, modalOpen: 1, modalClose: 1, toast: 1, stamp: 1, dissolve: 1, assemble: 1, check: 1, copy: 1, lift: 2, land: 2, bounce: 2, press: 2, edge: 2, burst: 2, focus: 2, spark: 2 };
  const GAP = { view: 250, modalOpen: 200, modalClose: 200, toast: 150, stamp: 80, dissolve: 150, assemble: 150, check: 400, copy: 300, lift: 200, land: 200, bounce: 700, press: 400, edge: 1200, burst: 800, focus: 5000, spark: 110 };
  const lastAt = {};
  const rectOf = (el) => { try { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 ? r : null; } catch { return null; } };

  let ov;
  function layer() {
    if (ov && ov.isConnected) return ov;
    if (!document.body) return null;
    ov = document.createElement('div'); ov.id = 'hs-actionfx'; ov.setAttribute('aria-hidden', 'true'); document.body.appendChild(ov);
    return ov;
  }
  function node(tag, css, text, ns) {
    const L = layer(); if (!L || L.childElementCount > 70) return null;
    const n = ns ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
    if (css) n.style.cssText = css; if (text != null) n.textContent = text;
    L.appendChild(n); return n;
  }
  function anim(n, kf, o) { if (!n) return; const a = n.animate(kf, Object.assign({ fill: 'forwards' }, o)); a.onfinish = a.oncancel = () => n.remove(); return a; }
  const px = (r) => `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;`;

  // glyph confetti inside a rect: 'fall' (dissolve), 'build' (assemble), 'shatter' (bigger shards)
  function glyphs(r, n, mode) {
    n = Math.min(n, 26);
    for (let i = 0; i < n; i++) {
      const x = r.left + R(0, r.width), y = r.top + R(0, r.height), big = mode === 'shatter';
      const s = node('span', `left:${x}px;top:${y}px;font-size:${big ? R(12, 20) : R(10, 14)}px;color:${pick(COLORS)};`, gl());
      if (mode === 'build') anim(s, [{ translate: `${R(-40, 40)}px ${R(-30, 30)}px`, opacity: 0 }, { translate: '0 0', opacity: 1, offset: 0.7 }, { translate: '0 0', opacity: 0 }], { duration: R(380, 640), easing: 'cubic-bezier(.2,.8,.3,1)' });
      else anim(s, [{ translate: '0 0', rotate: '0deg', opacity: 1 }, { translate: `${R(-30, 30)}px ${big ? R(30, 120) : R(30, 90)}px`, rotate: `${R(-200, 200)}deg`, opacity: 0 }], { duration: R(450, 800), easing: 'cubic-bezier(.4,0,.9,.6)' });
    }
  }
  function ringAt(x, y, c = '#00ff6e', r = 30, ms = 520) {
    const n = node('span', `left:${x - r}px;top:${y - r}px;width:${r * 2}px;height:${r * 2}px;border:1.5px solid ${c};border-radius:50%;`);
    anim(n, [{ scale: 0.2, opacity: 0.9 }, { scale: 1, opacity: 0 }], { duration: ms, easing: 'ease-out' });
  }
  function bar(r, vertical, ms, c = '#00ff6e') { // a glowing line sweeping across a rect
    const n = node('span', `${px(r)}overflow:hidden;`);
    if (!n) return;
    const l = document.createElement('i'); l.style.cssText = vertical
      ? `position:absolute;left:0;right:0;top:0;height:3px;background:linear-gradient(90deg,transparent,${c},transparent);box-shadow:0 0 10px ${c};`
      : `position:absolute;top:0;bottom:0;left:0;width:3px;background:linear-gradient(180deg,transparent,${c},transparent);box-shadow:0 0 10px ${c};`;
    n.appendChild(l);
    const a = l.animate(vertical ? [{ translate: '0 0', opacity: 0 }, { opacity: 1, offset: 0.12 }, { translate: `0 ${r.height}px`, opacity: 0 }] : [{ translate: '0 0', opacity: 0 }, { opacity: 1, offset: 0.12 }, { translate: `${r.width}px 0`, opacity: 0 }], { duration: ms, easing: 'ease-in-out', fill: 'forwards' });
    a.onfinish = a.oncancel = () => n.remove();
  }
  function checkAt(x, y) {
    const n = node('svg', `left:${x - 14}px;top:${y - 14}px;width:28px;height:28px;`, null, true);
    if (!n) return; n.setAttribute('viewBox', '0 0 28 28');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', 'M5 15 L12 22 L24 7'); p.setAttribute('fill', 'none'); p.setAttribute('stroke', '#00ff6e'); p.setAttribute('stroke-width', '3'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
    p.style.strokeDasharray = '34'; n.appendChild(p);
    p.animate([{ strokeDashoffset: 34 }, { strokeDashoffset: 0 }], { duration: 360, easing: 'ease-out', fill: 'forwards' });
    anim(n, [{ opacity: 1 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }], { duration: 1000 });
    ringAt(x, y, '#9dffb8', 22, 520);
  }
  const mid = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

  // ---- named animations ----
  const PLAY = {
    view(el) { const r = el && rectOf(el); if (!r) return; bar(r, true, 520); if (lvl() > 1) { glyphs({ left: r.left, top: r.top, width: r.width, height: Math.min(60, r.height) }, 10, 'fall'); } el.animate([{ opacity: 0.6, translate: '0 6px' }, { opacity: 1, translate: '0 0' }], { duration: 260, easing: 'ease-out' }); },
    modalOpen(el) {
      const r = el && rectOf(el); if (!r) return;
      el.animate([{ scale: 0.82, opacity: 0 }, { scale: 1.02, opacity: 1, offset: 0.7 }, { scale: 1, opacity: 1 }], { duration: 300, easing: 'steps(7, end)' });
      const c = mid(r); ringAt(c.x, c.y, '#00e5ff', Math.min(r.width, r.height) / 2, 450); glyphs({ left: r.left, top: r.top, width: r.width, height: 10 }, 8, 'build');
    },
    modalClose(el, r) { r = r || (el && rectOf(el)); if (!r) return; glyphs(r, 22, 'shatter'); const c = mid(r); ringAt(c.x, c.y, '#ff4fd8', Math.min(r.width, r.height) / 3, 380); },
    toast(el) { if (!el) return; el.animate([{ translate: '40px 0', opacity: 0 }, { translate: '-6px 0', opacity: 1, offset: 0.4 }, { translate: '5px 0', opacity: 0.6, offset: 0.55 }, { translate: '-2px 0', opacity: 1, offset: 0.7 }, { translate: '0 0', opacity: 1 }], { duration: 380, easing: 'steps(12, end)' }); },
    stamp(el) { if (!el) return; el.animate([{ scale: 1.35, rotate: '-6deg' }, { scale: 0.9, rotate: '2deg', offset: 0.55 }, { scale: 1, rotate: '0deg' }], { duration: 300, easing: 'cubic-bezier(.3,1.4,.5,1)' }); const r = rectOf(el); if (r && lvl() > 1) { const c = mid(r); ringAt(c.x, c.y, '#00ff6e', 18, 360); } },
    dissolve(el, r) { r = r || (el && rectOf(el)); if (r) { glyphs(r, Math.min(24, Math.max(8, r.width / 30)), 'fall'); bar(r, true, 380, '#ff3b5c'); } },
    assemble(el) { const r = el && rectOf(el); if (!r) return; glyphs(r, Math.min(22, Math.max(8, r.width / 34)), 'build'); el.animate([{ opacity: 0, translate: '0 8px' }, { opacity: 1, translate: '0 0' }], { duration: 420, easing: 'ease-out' }); },
    lift(el) { const r = el && rectOf(el); if (!r) return; el.animate([{ scale: 1 }, { scale: 1.03 }], { duration: 160, fill: 'forwards', easing: 'ease-out' }); const n = node('span', `${px(r)}box-shadow:0 14px 28px rgba(0,255,110,.28);border-radius:6px;`); anim(n, [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }], { duration: 900 }); },
    land(el, pt) { if (el && el.animate) el.animate([{ scale: 1.03 }, { scale: 0.98, offset: 0.4 }, { scale: 1 }], { duration: 260, easing: 'ease-out' }); const r = el && rectOf(el), c = pt || (r && mid(r)); if (c) ringAt(c.x, c.y, '#00ff6e', 34, 480); },
    bounce(el) { if (el && el.animate) el.animate([{ translate: '0 0' }, { translate: '0 7px', offset: 0.35 }, { translate: '0 -2px', offset: 0.65 }, { translate: '0 0' }], { duration: 340, easing: 'ease-out' }); },
    copy(el) { const r = el && rectOf(el); if (!r) return; const n = node('span', `${px(r)}background:rgba(0,255,110,.35);border-radius:4px;`); anim(n, [{ opacity: 0.9 }, { opacity: 0 }], { duration: 380 }); const c = mid(r); const g = node('span', `left:${c.x}px;top:${r.top}px;font-size:16px;color:#9dffb8;`, '⎘'); anim(g, [{ translate: '0 0', opacity: 1 }, { translate: '0 -24px', opacity: 0 }], { duration: 650, easing: 'ease-out' }); },
    check(el, pt) { const r = el && rectOf(el), c = pt || (r && { x: r.right + 18 > innerWidth ? r.left - 16 : r.right + 16, y: r.top + r.height / 2 }); if (c) checkAt(c.x, c.y); },
    press(el, pt) { const c = pt || (el && rectOf(el) && mid(rectOf(el))); if (!c) return; const n = node('svg', `left:${c.x - 22}px;top:${c.y - 22}px;width:44px;height:44px;`, null, true); if (!n) return; n.setAttribute('viewBox', '0 0 44 44'); const k = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); k.setAttribute('cx', 22); k.setAttribute('cy', 22); k.setAttribute('r', 18); k.setAttribute('fill', 'none'); k.setAttribute('stroke', '#00e5ff'); k.setAttribute('stroke-width', 2.5); k.setAttribute('transform', 'rotate(-90 22 22)'); k.style.strokeDasharray = '113'; n.appendChild(k); const a = k.animate([{ strokeDashoffset: 113 }, { strokeDashoffset: 0 }], { duration: 600, fill: 'forwards' }); n._k = a; PRESS = { n, a }; },
    edge(el) { const r = el && rectOf(el); if (!r || r.width > innerWidth * 0.9) return; const n = node('span', `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:2px;overflow:hidden;`); if (!n) return; const l = document.createElement('i'); l.style.cssText = 'position:absolute;top:0;left:0;height:2px;width:60px;background:linear-gradient(90deg,transparent,#00ff6e,transparent);'; n.appendChild(l); const a = l.animate([{ translate: '-60px 0' }, { translate: `${r.width}px 0` }], { duration: 650, easing: 'ease-in-out' }); a.onfinish = a.oncancel = () => n.remove(); },
    burst(el) { const r = el && rectOf(el); if (!r) return; const c = mid(r); ringAt(c.x, c.y, '#c6ff00', Math.min(60, r.width / 2 + 10), 600); for (let i = 0; i < 10; i++) { const a = R(0, 6.28), d = R(24, 60), s = node('span', `left:${c.x}px;top:${c.y}px;font-size:12px;color:${pick(COLORS)};`, gl()); anim(s, [{ translate: '0 0', opacity: 1 }, { translate: `${Math.cos(a) * d}px ${Math.sin(a) * d}px`, opacity: 0 }], { duration: R(400, 700), easing: 'ease-out' }); } },
    focus() { bar({ left: 0, top: 0, width: innerWidth, height: innerHeight }, true, 700, '#00e5ff'); },
    spark(el, pt) { if (!pt) return; for (let i = 0; i < 2; i++) { const s = node('span', `left:${pt.x}px;top:${pt.y}px;width:2px;height:2px;background:${pick(COLORS)};`); anim(s, [{ translate: '0 0', opacity: 1 }, { translate: `${R(-10, 10)}px ${R(-16, -5)}px`, opacity: 0 }], { duration: 320, easing: 'ease-out' }); } },
  };
  let PRESS = null;
  const names = Object.keys(PLAY);

  function play(name, el, extra) {
    const fn = PLAY[name]; if (!fn) return false;
    if (lvl() < (MIN[name] || 1) || !layer()) return false;
    const now = performance.now(); if (now - (lastAt[name] || 0) < (GAP[name] || 100)) return false; lastAt[name] = now;
    try { fn(el, extra); } catch {}
    return true;
  }

  // ---- delegated triggers ----
  const ROW = 'tr, li, .row, .item, .proc, .todo, [data-row]';
  const SKIP = '#hs-actionfx, #hs-clickfx, .rabbit, .twr, [id^="twr"], [data-afx="none"]';
  let intentAt = 0, pend = null;
  const cap = { capture: true, passive: true };

  document.addEventListener('pointerdown', (e) => {
    const t = e.target; if (e.button || !t.closest || t.closest(SKIP) || lvl() === 0) return;
    const nav = t.closest('.nav[data-view], .tab, [role="tab"]');
    if (nav) setTimeout(() => { const v = nav.dataset && nav.dataset.view ? document.getElementById('view-' + nav.dataset.view) : nav.closest('.view'); if (v) play('view', v); }, 40);
    const btn = t.closest('button, .btn, .act, [role="button"]');
    if (btn) {
      const s = ((btn.className || '') + ' ' + (btn.id || '') + ' ' + (btn.title || '') + ' ' + (btn.textContent || '').trim().slice(0, 24)).toLowerCase();
      const row = btn.closest(ROW);
      if (/del|remove|trash|✕|✖|×|clear/.test(s) && row) { const r = rectOf(row); if (r) { pend = { row, r, at: performance.now() }; setTimeout(checkGone, 160); setTimeout(checkGone, 520); } }
      if (/add|new|create|\+|save/.test(s)) intentAt = performance.now();
      if (/copy|clipboard/.test(s)) play('copy', btn);
      else if (/save|apply|done|✓|confirm/.test(s) && !/del|remove/.test(s)) setTimeout(() => { if (btn.isConnected) play('check', btn); }, 140);
    }
    if (lvl() > 1 && !t.closest('input, textarea, select, [contenteditable="true"], input[type="range"], a')) {
      const tgt = t.closest('button, .card, .nav, .tile, [role="button"]'); if (tgt) { const x = e.clientX, y = e.clientY; clearTimeout(lp.t); lp.x = x; lp.y = y; lp.t = setTimeout(() => { play('press', tgt, { x, y }); }, 380); }
    }
  }, cap);
  const lp = { t: 0, x: 0, y: 0 };
  const endPress = () => { clearTimeout(lp.t); if (PRESS) { const p = PRESS; PRESS = null; try { p.a.reverse(); setTimeout(() => p.n.remove(), 160); } catch { p.n.remove(); } } };
  addEventListener('pointerup', endPress, cap);
  addEventListener('pointercancel', endPress, cap);
  addEventListener('pointermove', (e) => { if (lp.t && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 8) endPress(); }, cap);
  function checkGone() { if (!pend) return; if (!pend.row.isConnected) { const r = pend.r; pend = null; play('dissolve', null, r); } else if (performance.now() - pend.at > 500) pend = null; }

  document.addEventListener('keydown', (e) => { if (e.key === 'Enter') intentAt = performance.now(); }, cap);
  document.addEventListener('change', (e) => { const t = e.target; if (lvl() && t && t.matches && t.matches('.switch input, input[type="checkbox"][role="switch"]')) play('stamp', t.closest('.switch') || t); }, cap);

  // rows added right after a user "add/save" (never during a page's bulk render)
  let addQ = [], addRaf = 0;
  function flushAdd() {
    addRaf = 0; const q = addQ; addQ = [];
    if (q.length > 4 || performance.now() - intentAt > 900 || !lvl()) return;
    for (const n of q.slice(0, 2)) if (n.isConnected && !n.closest(SKIP)) play('assemble', n);
  }
  function setupObservers() {
    new MutationObserver((ms) => {
      if (!lvl()) return;
      for (const m of ms) for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches && n.matches('.modal')) watchModal(n);
        if (performance.now() - intentAt < 900 && n.matches && n.matches(ROW) && addQ.length < 8) { addQ.push(n); if (!addRaf) addRaf = requestAnimationFrame(flushAdd); }
      }
    }).observe(document.body, { childList: true, subtree: true });
    document.querySelectorAll('.modal').forEach(watchModal);
    const t = document.getElementById('toast');
    if (t) {
      let was = t.classList.contains('show');
      new MutationObserver(() => { const on = t.classList.contains('show'); if (on && !was) { play('toast', t); if (!t.classList.contains('bad') && /saved|applied|done|added|created|✓/i.test(t.textContent)) setTimeout(() => { const r = rectOf(t); if (r) play('check', null, { x: Math.max(14, r.left - 20), y: r.top + r.height / 2 }); }, 220); } was = on; }).observe(t, { attributes: true, attributeFilter: ['class'] });
    }
  }
  const watched = new WeakSet();
  function watchModal(m) {
    if (watched.has(m)) return; watched.add(m);
    let was = !m.classList.contains('hidden'), box = m.querySelector('.modal-box') || m, lastR = null;
    if (was) requestAnimationFrame(() => { lastR = rectOf(box); });
    new MutationObserver(() => {
      const open = !m.classList.contains('hidden');
      if (open && !was) { box = m.querySelector('.modal-box') || m; play('modalOpen', box); requestAnimationFrame(() => { lastR = rectOf(box); }); }
      else if (!open && was && lastR) play('modalClose', null, lastR);
      was = open;
    }).observe(m, { attributes: true, attributeFilter: ['class'] });
  }

  // drag and drop (HTML5 drag only; delegated)
  document.addEventListener('dragstart', (e) => { const t = e.target; if (lvl() < 2 || !t || !t.closest) return; const el = t.closest(ROW + ', .card, .tile, [draggable="true"]'); if (el) play('lift', el); }, cap);
  document.addEventListener('drop', (e) => { if (lvl() < 2) return; play('land', e.target.closest ? e.target.closest(ROW + ', .card, .tile, [draggable="true"]') : null, { x: e.clientX, y: e.clientY }); }, cap);

  // scroll back to top: bounce
  const tops = new WeakMap();
  document.addEventListener('scroll', (e) => {
    if (lvl() < 2) return; const t = e.target; if (!t || t === document || !('scrollTop' in t)) return;
    const prev = tops.get(t) || 0, now = t.scrollTop; tops.set(t, now);
    if (now === 0 && prev > 80 && t.scrollHeight > t.clientHeight + 120) play('bounce', t);
  }, cap);

  // hover on cards: a soft edge scan (per-element cooldown)
  const hov = new WeakMap();
  document.addEventListener('pointerover', (e) => {
    if (lvl() < 2 || e.pointerType === 'touch') return; const c = e.target.closest && e.target.closest('.panel, .card'); if (!c || c.closest(SKIP) || (e.relatedTarget && c.contains(e.relatedTarget))) return;
    const n = performance.now(); if (n - (hov.get(c) || 0) < 4000) return; hov.set(c, n); play('edge', c);
  }, cap);

  // progress completion (cheap poll of a handful of elements, only while visible)
  const prog = new WeakMap();
  setInterval(() => {
    if (lvl() < 2) return;
    document.querySelectorAll('progress, [role="progressbar"]').forEach((p) => {
      const mx = parseFloat(p.max || p.getAttribute('aria-valuemax') || 100), v = parseFloat(p.value != null && p.value !== '' ? p.value : p.getAttribute('aria-valuenow'));
      if (!isFinite(v) || !isFinite(mx) || mx <= 0) return;
      const done = v >= mx, was = prog.get(p); prog.set(p, done);
      if (done && was === false && rectOf(p)) play('burst', p);
    });
  }, 1500);

  // window focus return
  let blurAt = 0;
  addEventListener('blur', () => { blurAt = performance.now(); });
  addEventListener('focus', () => { if (blurAt && performance.now() - blurAt > 3000) play('focus'); blurAt = 0; });

  // typing: tiny sparks at the caret (NORMAL only; never reads or stores what is typed)
  let mctx;
  document.addEventListener('input', (e) => {
    const t = e.target; if (lvl() < 2 || !t || t.tagName !== 'INPUT' || /password|range|checkbox|radio|file|color/.test(t.type)) return;
    const r = rectOf(t); if (!r) return; const cs = getComputedStyle(t);
    mctx = mctx || document.createElement('canvas').getContext('2d'); mctx.font = cs.font;
    const caret = t.selectionStart == null ? t.value.length : t.selectionStart, w = mctx.measureText(t.value.slice(0, caret)).width;
    play('spark', null, { x: Math.min(r.right - 6, r.left + (parseFloat(cs.paddingLeft) || 6) + w - (t.scrollLeft || 0)), y: r.top + r.height / 2 });
  }, cap);

  // ---- SETTINGS > DISPLAY card (works without the rabbit tab) ----
  const seg = (id, items, cur) => `<div class="seg small" id="${id}">${items.map(([v, l]) => `<button data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  function cardHtml() {
    const c = window.hsClickFx ? hsClickFx.get() : { level: 'off', geo: false };
    return `<div class="panel-head"><span class="glyph">✺</span> CLICK EFFECTS &amp; ANIMATIONS <span class="hint">all off on a fresh install</span></div><div class="set-body">
      <label class="set-l">CLICK EFFECTS <em>little animations when you click</em></label>${seg('afx-click', [['off', 'OFF'], ['low', 'LOW'], ['normal', 'NORMAL'], ['max', 'MAX']], c.level)}
      <label class="set-l">SACRED GEOMETRY ONLY <em>every click draws flower of life, Metatron's cube, merkaba and friends</em></label>${seg('afx-geo', [[false, 'OFF'], [true, 'ON']], !!c.geo)}
      <label class="set-l">ACTION ANIMATIONS <em>view switches, pop-ups, toasts, switches, deleting and adding rows, drags, copy and save</em></label>${seg('afx-act', [['off', 'OFF'], ['low', 'LOW'], ['normal', 'NORMAL']], prefs.level)}
      <div><button class="chip mini" id="afx-test">PREVIEW</button></div></div>`;
  }
  function injectCard(tries = 0) {
    const d = document.getElementById('set-display'), top = d && d.querySelector('.set-top');
    if (!top) { if (tries < 40) setTimeout(() => injectCard(tries + 1), 400); return; }
    if (d.querySelector('#afx-card')) return;
    const card = document.createElement('div'); card.className = 'panel set-card'; card.id = 'afx-card'; card.innerHTML = cardHtml();
    top.insertAdjacentElement('afterend', card);
    card.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const seg = b.parentElement.id, v = b.dataset.v;
      if (seg === 'afx-click' && window.hsClickFx) hsClickFx.set({ level: v });
      else if (seg === 'afx-geo' && window.hsClickFx) hsClickFx.set({ geo: v === 'true' });
      else if (seg === 'afx-act') api.set({ level: v });
      else if (b.id === 'afx-test') {
        const r = card.getBoundingClientRect(); if (window.hsClickFx) hsClickFx.burst(r.left + r.width * 0.75, r.top + r.height * 0.5, 'button');
        play('stamp', b); play('check', b);
        return;
      }
      card.innerHTML = cardHtml();
    });
  }

  const api = window.hsActionFx = {
    get: () => ({ level: prefs.level }),
    set(p) { if (p && LEVELS.includes(p.level)) { prefs.level = p.level; try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch {} } return api.get(); },
    play: (name, el, extra) => play(name, el, extra),
    names: () => names.slice(),
  };
  document.addEventListener('actionfx', (e) => { const d = e && e.detail; if (d && d.name) play(d.name, d.el, d.extra); });

  const init = () => { setupObservers(); injectCard(); };
  if (document.body) init(); else document.addEventListener('DOMContentLoaded', init);
})();
