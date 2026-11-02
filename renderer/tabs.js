// TABS: File Explorer-style tabs over the pages. The sidebar navigates the current tab (or jumps to the
// tab already showing that page); Ctrl+click / middle-click opens a page in a new tab; drag a tab out of
// the window (or press ⧉) and it becomes its own HYPERSPACE window, so two pages can be open side by side.
(() => {
  const strip = $('#tabstrip');
  if (!strip) return;
  if (hs.remote) { strip.style.display = 'none'; return; }
  const QS = new URLSearchParams(location.search);
  const SOLO = HS.solo;
  const NAMES = Object.fromEntries($$('.nav').map((b) => [b.dataset.view, b.querySelector('span').textContent]));
  const valid = (v) => NAMES[v] && !$(`.nav[data-view="${v}"]`).classList.contains('sealed');
  const icon = (v) => $(`.nav[data-view="${v}"] svg`)?.outerHTML || '';
  let tabs = [], active = 0;
  try {
    const s = !SOLO && JSON.parse(localStorage.getItem('tabs') || 'null');
    if (s?.tabs?.length) { tabs = s.tabs.filter((t) => valid(t.view)); active = Math.min(s.active || 0, tabs.length - 1); }
  } catch {}
  if (SOLO && valid(QS.get('view'))) tabs = [{ view: QS.get('view') }];
  if (!tabs.length) tabs = [{ view: valid(HS.view) ? HS.view : 'nexus' }];
  active = Math.max(0, active);
  const save = () => { if (!SOLO) try { localStorage.setItem('tabs', JSON.stringify({ tabs, active })); } catch {} };

  function render() {
    strip.innerHTML = tabs.map((t, i) => `<div class="tab${i === active ? ' on' : ''}" data-i="${i}" title="${NAMES[t.view]} · drag it away from the window to make it its own HYPERSPACE">
        <span class="ti">${icon(t.view)}</span><span class="tl">${NAMES[t.view]}</span>
        <button class="tpop" title="Open in its own window">⧉</button><button class="tx" title="Close tab (Ctrl+W)">✕</button></div>`).join('') +
      '<button class="tadd" title="New tab (Ctrl+T)">+</button><div class="tmenu hidden"></div>';
    if (SOLO) document.title = `HYPERSPACE · ${NAMES[tabs[active].view]}`;
    save();
  }
  function go(i) { active = Math.max(0, Math.min(tabs.length - 1, i)); showView(tabs[active].view); render(); }
  function open(view) {
    const j = tabs.findIndex((t) => t.view === view);
    if (j >= 0) return go(j); // each page lives in one tab per window
    tabs.splice(active + 1, 0, { view });
    go(active + 1);
  }
  function close(i) {
    if (tabs.length === 1) { if (tabs[0].view !== 'nexus') { tabs[0].view = 'nexus'; go(0); } return; }
    tabs.splice(i, 1);
    if (i < active) active--;
    go(Math.min(active, tabs.length - 1));
  }
  async function popOut(i, at) {
    const view = tabs[i].view;
    try { await hs.call('popOut', view, at); } catch (e) { return toast(`COULDN'T OPEN A WINDOW: ${e.message}`, true); }
    if (tabs.length > 1) close(i);
    toast(`${NAMES[view]} → NEW WINDOW`);
  }

  // every page change (sidebar, widgets, shortcuts, status bar) lands in the current tab
  HS.onView((v) => {
    if (!valid(v)) return;
    if (tabs[active]?.view !== v) {
      const j = tabs.findIndex((t) => t.view === v);
      if (j >= 0) active = j; else tabs[active].view = v;
    }
    render();
  });

  // Ctrl+click / middle-click in the sidebar: new tab
  const side = $('.side');
  side.addEventListener('click', (e) => {
    const b = e.target.closest('.nav');
    if (!b || !e.ctrlKey || b.classList.contains('sealed')) return;
    e.stopPropagation(); e.preventDefault();
    open(b.dataset.view);
  }, true);
  side.addEventListener('auxclick', (e) => {
    const b = e.target.closest('.nav');
    if (b && e.button === 1 && !b.classList.contains('sealed')) { e.preventDefault(); open(b.dataset.view); }
  });
  side.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); }); // no autoscroll blob

  strip.addEventListener('click', (e) => {
    const menu = strip.querySelector('.tmenu');
    if (e.target.closest('.tadd')) {
      const free = Object.keys(NAMES).filter((v) => valid(v) && !tabs.some((t) => t.view === v));
      if (!free.length) return toast('EVERY PAGE IS ALREADY OPEN');
      menu.innerHTML = free.map((v) => `<button data-open="${v}">${icon(v)}<span>${NAMES[v]}</span></button>`).join('');
      menu.style.left = `${e.target.closest('.tadd').offsetLeft}px`;
      menu.classList.toggle('hidden');
      return;
    }
    const o = e.target.closest('[data-open]');
    if (o) { menu.classList.add('hidden'); return open(o.dataset.open); }
    menu.classList.add('hidden');
    const t = e.target.closest('.tab');
    if (!t) return;
    const i = +t.dataset.i;
    if (e.target.closest('.tx')) return close(i);
    if (e.target.closest('.tpop')) return popOut(i);
    go(i);
  });
  strip.addEventListener('auxclick', (e) => { const t = e.target.closest('.tab'); if (t && e.button === 1) close(+t.dataset.i); });
  strip.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('#tabstrip')) strip.querySelector('.tmenu')?.classList.add('hidden'); });

  // Dragging, like a browser: slide a tab along the strip to reorder it; pull it away from the strip and it
  // tears off into its own HYPERSPACE window that follows the cursor; let go over another HYPERSPACE
  // window and the tab joins that window instead.
  let drag = null;
  strip.addEventListener('pointerdown', (e) => {
    const t = e.target.closest('.tab');
    if (!t || e.button !== 0 || e.target.closest('button')) return;
    drag = { i: +t.dataset.i, el: t, x0: e.clientX, y0: e.clientY, moved: false, torn: null, to: +t.dataset.i, id: e.pointerId };
  });
  let follow = null;
  strip.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (drag.torn) { // the new window rides on the cursor
      follow = { x: e.screenX, y: e.screenY };
      startFollower();
      return;
    }
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < 6) return;
      drag.moved = true;
      // captured only once it's really a drag (a capture on press would swallow plain clicks); the strip
      // outlives re-renders, so the capture survives them and follows the pointer outside the window
      strip.setPointerCapture(drag.id);
    }
    const sb = strip.getBoundingClientRect();
    const away = e.clientY > sb.bottom + 50 || e.clientY < sb.top - 30 || e.clientX < 0 || e.clientX > innerWidth;
    if (away && tabs.length > 1) return tearOff(e);
    // reorder: the tab rides the pointer; it lands after every tab whose middle it has passed
    drag.el.classList.add('dragging');
    drag.el.style.transform = `translateX(${dx}px)`;
    const els = [...strip.querySelectorAll('.tab')];
    drag.to = els.filter((x, k) => k !== drag.i && e.clientX > x.getBoundingClientRect().left + x.offsetWidth / 2).length;
  });
  async function tearOff(e) {
    const i = drag.i, view = tabs[i].view;
    drag.torn = 'pending';
    try {
      const r = await hs.call('popOut', view, { x: e.screenX, y: e.screenY });
      if (!drag) { hs.call('tabWinDone', r.id, null); return; } // released while the window was being made
      drag.torn = r.id;
      close(i);
    } catch (er) { drag = null; toast(`COULDN'T OPEN A WINDOW: ${er.message}`, true); }
  }
  // move the torn-off window once per frame, not once per mouse event (frames only run while a tab is dragged)
  let following = false;
  function follower() {
    if (!drag) { following = false; return; }
    requestAnimationFrame(follower);
    if (follow && drag.torn > 0) { hs.call('moveWin', drag.torn, follow.x, follow.y); follow = null; }
  }
  const startFollower = () => { if (!following && drag) { following = true; requestAnimationFrame(follower); } };
  async function endDrag(e) {
    const d = drag;
    drag = null;
    if (!d) return;
    if (d.torn > 0) { // let go: merge into a window under the cursor, or keep the new one
      const r = await hs.call('tabWinDone', d.torn, { x: e.screenX, y: e.screenY }).catch(() => null);
      toast(r?.merged ? `${NAMES[r.view]} → JOINED THAT WINDOW` : `${NAMES[r?.view] || 'TAB'} → ITS OWN WINDOW`);
      return;
    }
    if (!d.moved) return; // a click; handled by the click listener
    if (d.to !== d.i) {
      const cur = tabs[active];
      const [m] = tabs.splice(d.i, 1);
      tabs.splice(d.to, 0, m);
      active = tabs.indexOf(cur);
    }
    render();
  }
  strip.addEventListener('pointerup', endDrag);
  strip.addEventListener('pointercancel', endDrag);
  // a tab dragged here from another HYPERSPACE window
  hs.on('tab-adopt', (view) => { if (valid(view)) open(view); });
  strip.addEventListener('dblclick', (e) => { if (e.target === strip) hs.win('max'); });

  window.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 't') { e.preventDefault(); strip.querySelector('.tadd').click(); }
    else if (k === 'w') { if (e.target.closest?.('input, textarea, [contenteditable]')) return; e.preventDefault(); close(active); }
    else if (k === 'tab') { e.preventDefault(); go((active + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length); }
    else if (/^[1-9]$/.test(k)) { e.preventDefault(); go(Math.min(tabs.length, +k) - 1); }
  });

  render();
  setTimeout(() => showView(tabs[active].view), 0);
})();
