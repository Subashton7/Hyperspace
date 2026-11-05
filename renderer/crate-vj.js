// MUSIC (CRATE) sections: LIBRARY | PLAYER / DJ | VJ | DECK (volume, now playing, speakers and screens; it used to be its own tab). The VJ lives inside CRATE as a second section (LIBRARY | VJ). "VJ FULL" gives the VJ most of the
// screen and floats a small music controller in a corner. The VJ canvas and control panel are the same DOM as before
// (vj.js still draws it), and it hears CRATE through the same laptop-output audio capture it always used.
(() => {
  const $ = (s) => document.querySelector(s);
  const view = $('#view-crate'), crate = view.querySelector('.crate'), wrap = $('#cr-vjwrap'), stage = $('#vj-stage');
  const mini = $('#cr-mini');
  const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch {} return null; };
  const deckWrap = $('#cr-deckwrap'), oldDeck = document.querySelector('#view-deck .deck-grid');
  if (oldDeck) deckWrap.appendChild(oldDeck); // the DECK panels live here now; deck.js keeps finding them by id
  stage.appendChild(mini); // the player floats over the visuals, so its corners are the stage's corners

  if (!HS.crateSection) HS.crateSection = ['vj', 'deck'].includes(ls('crateSection')) ? ls('crateSection') : 'lib';
  let full = false, lastSec = null, lastFull = false;
  const secNow = () => (HS.crateSection === 'vj' ? 'vj' : HS.crateSection === 'deck' ? 'deck' : window.CRATE && window.CRATE.C.mode === 'dj' ? 'dj' : 'lib');

  // a button on the stage to hide / show the VJ CONTROL panel
  const ctrlBtn = document.createElement('button');
  ctrlBtn.className = 'chip vj-ctrlbtn'; ctrlBtn.id = 'vj-ctrlbtn'; ctrlBtn.title = 'Show / hide the VJ CONTROL panel';
  stage.appendChild(ctrlBtn);
  let ctrlClosed = ls('hs-vj-ctrl-closed') === '1';
  const syncCtrl = () => { wrap.classList.toggle('ctrl-closed', ctrlClosed); ctrlBtn.textContent = ctrlClosed ? '◧ CONTROLS' : '◨ HIDE'; };
  ctrlBtn.addEventListener('click', () => { ctrlClosed = !ctrlClosed; ls('hs-vj-ctrl-closed', ctrlClosed ? '1' : '0'); syncCtrl(); });
  syncCtrl();

  function apply() {
    const onCrate = HS.view === 'crate', vj = HS.crateSection === 'vj';
    if (!onCrate || !vj) full = false;
    const dk = HS.crateSection === 'deck';
    crate.classList.toggle('vj-sec', vj);
    crate.classList.toggle('deck-sec', dk);
    crate.classList.toggle('vj-full', vj && full);
    view.classList.toggle('vj-full', vj && full);
    const sec = secNow();
    view.dataset.section = sec;
    $('#cr-secseg').querySelectorAll('button').forEach((b) => { b.classList.toggle('on', b.dataset.sec === sec); b.setAttribute('aria-selected', b.dataset.sec === sec); });
    if (onCrate && !ls('hs-crate-coach') && !full) $('#cr-coach').classList.remove('hidden');
    if (lastSec !== sec || lastFull !== (vj && full)) { // a quick fade so the sections feel like different rooms
      view.classList.remove('sec-fade'); void view.offsetWidth; view.classList.add('sec-fade');
      lastSec = sec; lastFull = vj && full;
    }
    $('#cr-fill').classList.toggle('hidden', !vj);
    $('#vj-fill').textContent = full ? '✕ EXIT VJ FULL' : '▣ VJ FULL';
    mini.classList.toggle('hidden', !(vj && full));
    document.body.classList.toggle('vj-mode', onCrate && vj);
    ls('crateSection', vj ? 'vj' : dk ? 'deck' : 'lib');
    window.dispatchEvent(new Event('hs-crate-section'));
    if (full && onCrate) paintMini(true);
  }
  function setSection(s) {
    const was = secNow();
    if (s === 'dj' || s === 'lib') {
      HS.crateSection = 'lib';
      const m = s === 'dj' ? 'dj' : 'player';
      if (window.CRATE && window.CRATE.C.mode !== m) window.CRATE.setMode(m); // fires hs-crate-mode, which repaints the tiles
    } else if (s === 'deck') {
      HS.crateSection = 'deck';
      if (window.CRATE && window.CRATE.C.mode !== 'player') window.CRATE.setMode('player'); // the music bar stays under the DECK
    } else HS.crateSection = 'vj';
    if (was === secNow() && s !== 'lib') return;
    apply();
    if (s !== 'vj') setTimeout(() => window.CRATE?.renderRows(true), 0);
  }
  window.addEventListener('hs-crate-mode', () => apply());
  function setFull(on) {
    if (on) HS.crateSection = 'vj';
    full = !!on;
    apply();
  }
  HS.setCrateSection = setSection;
  // DECK has no tab of its own any more: showView('deck') (tabs, FIND, the rabbit, saved last-view) lands on MUSIC > DECK
  const realShowView = window.showView;
  if (typeof realShowView === 'function') window.showView = function (name) { if (name === 'deck') { HS.crateSection = 'deck'; name = 'crate'; } return realShowView.call(this, name); };
  HS.onView(apply);
  $('#cr-secseg').addEventListener('click', (e) => { const b = e.target.closest('button[data-sec]'); if (b) setSection(b.dataset.sec); });
  $('#cr-fill').addEventListener('click', () => setFull(true));
  $('#vj-fill').addEventListener('click', () => setFull(!full));
  $('#cm-exit').addEventListener('click', () => setFull(false));
  $('#cm-lib').addEventListener('click', () => { full = false; setSection('lib'); });
  $('#cr-coach-x').addEventListener('click', () => { ls('hs-crate-coach', '1'); $('#cr-coach').classList.add('hidden'); });
  window.addEventListener('keydown', (e) => {
    if (HS.view === 'crate' && e.altKey && !e.ctrlKey && !e.metaKey && ['1', '2', '3', '4'].includes(e.key)) { e.preventDefault(); setSection(['lib', 'dj', 'vj', 'deck'][+e.key - 1]); return; }
    if (e.key === 'Escape' && full && HS.inVJ() && !document.fullscreenElement && !['TEXTAREA'].includes(e.target.tagName) && !(e.target.tagName === 'INPUT' && e.target.type !== 'range')) { setFull(false); return; }
    if (!HS.inVJ() || ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if (e.key === 'Escape' && full && !document.fullscreenElement) setFull(false);
    else if (e.ctrlKey || e.altKey || e.metaKey) return;
    else if (e.key === 'm' || e.key === 'M') window.CRATE?.toggle();
    else if (e.key === '.') window.CRATE?.next();
    else if (e.key === ',') window.CRATE?.prev();
  });

  // ---------------- the mini player ----------------
  const fmt = (s) => (window.CRATE ? window.CRATE.fmtLen(s) : '0:00');
  let shownId = null, seeking = false;
  function paintMini(force) {
    if (mini.classList.contains('hidden') || !window.CRATE) return;
    const { C, E, names, keyLabel, art } = window.CRATE, el = C.deck.el, t = C.cur;
    const id = t ? t.id : null;
    if (force || id !== shownId) {
      shownId = id;
      if (t) { const n = names(t); $('#cm-title').textContent = n.title; $('#cm-artist').textContent = n.artist || t.album || ''; $('#cm-art').innerHTML = art(t, 'cm-artimg'); }
      else { $('#cm-title').textContent = 'nothing playing'; $('#cm-artist').innerHTML = '&nbsp;'; $('#cm-art').innerHTML = ''; }
    }
    $('#cm-pp').textContent = el.paused ? '▶' : '❚❚'; $('#cm-pp').title = el.paused ? 'Play' : 'Pause';
    const dur = el.duration || (t && t.len) || 0;
    if (!seeking) $('#cm-pos').value = dur ? Math.round((el.currentTime / dur) * 1000) : 0;
    $('#cm-cur').textContent = fmt(el.currentTime || 0);
    $('#cm-len').textContent = fmt(dur);
    const bpm = t && t.bpm ? `${Math.round(E.bpmNow(C.deck))} BPM` : '';
    $('#cm-bpm').textContent = [bpm, t && t.key ? keyLabel(t) : '', C.mix?.synced && C.mix.phase === 'running' ? 'SYNCED' : ''].filter(Boolean).join(' · ');
    const v = document.getElementById('cr-vol');
    if (v && document.activeElement !== $('#cm-vol')) $('#cm-vol').value = v.value;
  }
  setInterval(() => { if (!document.hidden) paintMini(false); }, 400);
  if (window.CRATE) for (const d of window.CRATE.E.decks) for (const ev of ['play', 'pause', 'ended']) d.el.addEventListener(ev, () => paintMini(false));
  $('#cm-pp').addEventListener('click', () => { window.CRATE?.toggle(); setTimeout(() => paintMini(true), 60); });
  $('#cm-prev').addEventListener('click', () => window.CRATE?.prev());
  $('#cm-next').addEventListener('click', () => window.CRATE?.next());
  $('#cm-pos').addEventListener('input', (e) => {
    seeking = true;
    const el = window.CRATE.C.deck.el, dur = el.duration || 0;
    if (dur) el.currentTime = (e.target.value / 1000) * dur;
  });
  $('#cm-pos').addEventListener('change', () => { seeking = false; });
  $('#cm-vol').addEventListener('input', (e) => { const v = document.getElementById('cr-vol'); if (v) { v.value = e.target.value; v.dispatchEvent(new Event('input', { bubbles: true })); } });

  // hold the header and drag the player to any corner; it snaps to the nearest one and remembers it
  const CORNERS = ['tl', 'tr', 'bl', 'br'];
  const saved = ls('hs-cratemini-corner');
  mini.dataset.corner = CORNERS.includes(saved) ? saved : 'tl';
  $('#cm-grip').addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') || e.button !== 0) return;
    const grip = e.currentTarget, sr = stage.getBoundingClientRect(), mr = mini.getBoundingClientRect();
    const dx = e.clientX - mr.left, dy = e.clientY - mr.top;
    let moved = false;
    grip.setPointerCapture(e.pointerId);
    const move = (ev) => {
      if (!moved && Math.abs(ev.clientX - e.clientX) + Math.abs(ev.clientY - e.clientY) < 4) return;
      moved = true; mini.classList.add('drag');
      mini.style.left = `${Math.max(0, Math.min(sr.width - mr.width, ev.clientX - sr.left - dx))}px`;
      mini.style.top = `${Math.max(0, Math.min(sr.height - mr.height, ev.clientY - sr.top - dy))}px`;
      mini.style.right = mini.style.bottom = 'auto';
    };
    const up = () => {
      grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
      if (!moved) return;
      const r = mini.getBoundingClientRect();
      const right = r.left + r.width / 2 > sr.left + sr.width / 2, bottom = r.top + r.height / 2 > sr.top + sr.height / 2;
      mini.dataset.corner = (bottom ? 'b' : 't') + (right ? 'r' : 'l');
      ls('hs-cratemini-corner', mini.dataset.corner);
      mini.classList.remove('drag'); mini.style.left = mini.style.top = mini.style.right = mini.style.bottom = '';
    };
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
  });

  apply();
})();
