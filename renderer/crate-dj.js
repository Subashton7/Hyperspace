// DJ DECKS (CRATE sub-tab): two decks on the CRATE engine. Scrolling beat-gridded waveforms, overviews,
// CUE / PLAY / SYNC, rekordbox hot cues, pitch with key lock, a 3-band isolator with kills, filter sweep,
// channel faders with meters, equal-power crossfader, and AUTO DROP LINE-UP for doubles: the other deck takes
// the MASTER deck's tempo and starts so both drops land on the same beat. ⚑ SET DROP marks a drop by hand,
// which that track uses from then on and which retrains the drop finder for every other track.
window.CrateDJ = (() => {
  const box = document.getElementById('cr-dj');
  if (!box || !window.CRATE) return null;
  const { C, E, names, keyLabel, camelot, keyHue, art, fmtLen, fetchWave, trackUrl, CUE_COLORS } = window.CRATE;
  const DK = { A: E.A, B: E.B };
  const deckHtml = (x) => `
    <div class="dj-deck" data-deck="${x}">
      <div class="dj-head"><span class="dj-letter">${x}</span><span class="dj-art"></span>
        <div class="dj-names"><b class="dj-title">drop a track here</b><span class="dj-artist">or press ${x} on a row</span></div>
        <div class="dj-stats"><b class="dj-bpm">—</b><span class="dj-key"></span><span class="dj-time">0:00 / −0:00</span></div></div>
      <div class="dj-over"><canvas></canvas></div>
      <div class="dj-trans">
        <button class="dj-btn cue" data-a="cue" title="Cue: jump back and wait · while stopped, sets the cue">CUE</button>
        <button class="dj-btn play" data-a="play">▶</button>
        <button class="dj-btn" data-a="sync" title="Match tempo and line the beats up with the other deck">SYNC</button>
        <button class="dj-btn" data-a="lock" title="Key lock: change tempo without changing pitch">KEY LOCK</button>
        <button class="dj-btn master" data-a="master" title="The master deck sets the tempo and the drop the other deck lines up to">MASTER</button>
        <button class="dj-btn autodrop" data-a="autodrop" title="This deck jumps to the master's tempo and drop (on the master deck: the other deck follows)">⇆ AUTO DROP</button>
        <button class="dj-btn setdrop" data-a="setdrop" title="Mark the drop at the playhead (snaps to the bar). Shift-click: DROP 2 · Alt-click: forget your marks. Every mark teaches the drop finder.">⚑ SET DROP</button>
        <div class="dj-pitch"><span>TEMPO <b class="dj-pv">0.0%</b></span><input type="range" class="slider" data-a="pitch" min="-8" max="8" step="0.05" value="0" /></div>
      </div>
      <div class="dj-pads"></div>
    </div>`;
  const chHtml = (x) => `
    <div class="dj-ch" data-ch="${x}">
      <div class="dj-chl">${x}</div>
      ${['high', 'mid', 'low'].map((b) => `<div class="dj-eq"><span>${b === 'high' ? 'HI' : b === 'mid' ? 'MID' : 'LOW'}</span><input type="range" class="slider" data-eq="${b}" min="-26" max="6" step="0.5" value="0" title="Double-click to reset" /><button class="dj-kill" data-kill="${b}" title="Kill the ${b}s">K</button></div>`).join('')}
      <div class="dj-eq"><span>FILTER</span><input type="range" class="slider" data-filter min="-1" max="1" step="0.01" value="0" title="Left: low-pass · right: high-pass · double-click resets" /></div>
      <div class="dj-fader"><div class="dj-vu"><i></i></div><input type="range" class="vfader" data-fader min="0" max="1" step="0.01" value="1" /></div>
    </div>`;
  box.innerHTML = `
    <div class="dj-waves"><div class="dj-zoom" data-z="A"><canvas></canvas><span>A</span></div><div class="dj-zoom" data-z="B"><canvas></canvas><span>B</span></div></div>
    <div class="dj-row">
      ${deckHtml('A')}
      <div class="dj-mixer">
        <div class="dj-chs">${chHtml('A')}${chHtml('B')}</div>
        <div class="dj-xf"><span>A</span><input type="range" class="slider" id="dj-xf" min="0" max="1" step="0.005" value="0" title="Crossfader · double-click to centre" /><span>B</span></div>
        <div class="dj-tools"><button class="act" id="dj-drops" title="Match the other deck's tempo to the MASTER and start it so both drops hit on the same beat">⇆ AUTO DROP LINE-UP</button><button class="act" id="dj-dbl" title="Show doubles for the playing deck">DOUBLES</button></div>
        <div class="dj-lock" title="Time to each deck's next drop: lights up when they'll hit together"><span data-l="A">A —</span><span data-l="B">B —</span></div>
        <div class="dj-phase"><i class="pa"></i><i class="pb"></i></div>
      </div>
      ${deckHtml('B')}
    </div>`;
  const deckEl = (x) => box.querySelector(`.dj-deck[data-deck="${x}"]`);
  const chEl = (x) => box.querySelector(`.dj-ch[data-ch="${x}"]`);

  // ---------------- loading ----------------
  async function load(x, t) {
    if (!t?.exists) return toast('THAT FILE IS MISSING', true);
    const d = DK[x];
    if (!d.el.paused && !confirmLoad(x)) return;
    d.el.pause();
    if (C.mix) C.mix = null;
    E.resetDeck(d);
    await E.load(d, t, trackUrl(t));
    if (C.deck === d) C.cur = t;
    d.feat = C.feats[t.id] || null;
    const lo = await fetchWave(t).catch(() => null);
    if (d.track !== t) return;
    d.wave = lo;
    const first = lo?.beats?.find((b) => b[1] === 1);
    d.cue = first ? first[0] / 1000 : 0;
    d.el.currentTime = d.cue;
    renderDeck(x);
    toast(`DECK ${x} · ${names(t).title.toUpperCase()}`);
    if (t.wave) fetchWave(t, Math.min(80000, Math.round((t.len || 300) * 75))).then((w) => { if (d.track === t) d.hi = w; }).catch(() => {});
  }
  let armed = null;
  function confirmLoad(x) {
    if (armed === x) { armed = null; return true; }
    armed = x;
    setTimeout(() => { if (armed === x) armed = null; }, 2500);
    toast(`DECK ${x} IS PLAYING · LOAD AGAIN TO REPLACE IT`, true);
    return false;
  }
  // the deck that isn't carrying the music
  function loadFree(t) {
    const x = E.A.el.paused && !(E.A.track && !E.B.track) ? 'A' : E.B.el.paused ? 'B' : 'A';
    return load(!E.A.track ? 'A' : !E.B.track ? 'B' : x, t);
  }
  for (const x of ['A', 'B']) {
    const el = deckEl(x);
    el.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/hs-track')) { e.preventDefault(); el.classList.add('drop'); } });
    el.addEventListener('dragleave', () => el.classList.remove('drop'));
    el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('drop'); const t = C.byId.get(e.dataTransfer.getData('text/hs-track')); if (t) { armed = x; load(x, t); } });
  }

  function renderDeck(x) {
    const d = DK[x], t = d.track, el = deckEl(x);
    if (!t) return;
    const n = names(t);
    el.querySelector('.dj-art').innerHTML = art(t, 'dj-artimg');
    el.querySelector('.dj-title').textContent = n.title;
    el.querySelector('.dj-artist').textContent = n.artist || '';
    const cam = camelot(t.key);
    el.querySelector('.dj-key').innerHTML = t.key ? `<i class="kb" style="--kh:${keyHue(cam)}">${keyLabel(t)}</i>` : '';
    const hot = (t.cues || []).filter((c) => c[1] > 0);
    el.querySelector('.dj-pads').innerHTML = [...Array(8)].map((_, i) => {
      const c = hot.find((h) => h[1] === i + 1);
      return `<button class="dj-pad${c ? ' set' : ''}" data-pad="${i + 1}"${c ? ` data-ms="${c[0]}" style="--cc:${CUE_COLORS[(c[2] || c[1]) % 8]}" title="${fmtLen(c[0] / 1000)}"` : ''}>${String.fromCharCode(65 + i)}</button>`;
    }).join('');
    el.querySelector('[data-a="lock"]').classList.toggle('on', d.el.preservesPitch);
  }

  // ---------------- controls ----------------
  box.addEventListener('click', (e) => {
    const deck = e.target.closest('.dj-deck');
    if (deck) {
      const x = deck.dataset.deck, d = DK[x];
      const a = e.target.closest('[data-a]')?.dataset.a;
      const pad = e.target.closest('[data-pad]');
      if (!d.track && (a || pad)) return toast(`LOAD A TRACK ON DECK ${x} FIRST`, true);
      E.resume();
      if (a === 'play') { d.el.paused ? d.el.play() : d.el.pause(); }
      else if (a === 'cue') {
        if (!d.el.paused) { d.el.pause(); d.el.currentTime = d.cue; }
        else { // set the cue here, snapped to the nearest beat
          const p = E.phase(d);
          d.cue = Math.max(0, p ? d.el.currentTime - (p.frac < 0.5 ? p.frac : p.frac - 1) * p.len : d.el.currentTime);
          d.el.currentTime = d.cue;
          toast(`CUE ${x} · ${fmtLen(d.cue)}`);
        }
      } else if (a === 'sync') { if (!E.other(d).track) return toast('NOTHING ON THE OTHER DECK TO SYNC TO', true); E.sync(d); syncPitch(x); }
      else if (a === 'master') { master = x; markMaster(); }
      else if (a === 'autodrop') lineUpDrops(x);
      else if (a === 'setdrop') setDrop(x, e.shiftKey ? 2 : null, e.altKey);
      else if (a === 'lock') { E.setKeyLock(d, !d.el.preservesPitch); renderDeck(x); }
      else if (pad?.dataset.ms) { d.el.currentTime = +pad.dataset.ms / 1000; if (d.el.paused) d.el.play(); }
      const ov = e.target.closest('.dj-over');
      if (ov && d.track) { const r = ov.getBoundingClientRect(); d.el.currentTime = ((e.clientX - r.left) / r.width) * (d.el.duration || d.track.len || 0); }
      return;
    }
    const kill = e.target.closest('[data-kill]');
    if (kill) { const x = kill.closest('.dj-ch').dataset.ch, d = DK[x], b = kill.dataset.kill; E.setKill(d, b, !d.kill[b]); kill.classList.toggle('on', d.kill[b]); return; }
    if (e.target.id === 'dj-drops') lineUpDrops();
    if (e.target.id === 'dj-dbl') { const playing = !E.A.el.paused ? E.A : !E.B.el.paused ? E.B : E.A; if (playing.track) { C.sel = playing.track.id; $('#cr-stabs [data-side="doubles"]').click(); } }
  });
  box.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.a === 'pitch') { const x = t.closest('.dj-deck').dataset.deck; E.setPitch(DK[x], +t.value); syncPitch(x); }
    else if (t.dataset.eq) E.setEq(DK[t.closest('.dj-ch').dataset.ch], t.dataset.eq, +t.value);
    else if ('filter' in t.dataset) E.setFilter(DK[t.closest('.dj-ch').dataset.ch], +t.value);
    else if ('fader' in t.dataset) E.setFader(DK[t.closest('.dj-ch').dataset.ch], +t.value);
    else if (t.id === 'dj-xf') E.setXf(+t.value);
  });
  box.addEventListener('dblclick', (e) => { // knobs snap home
    const t = e.target;
    if (t.id === 'dj-xf') { t.value = 0.5; E.setXf(0.5); }
    else if (t.dataset.eq) { t.value = 0; E.setEq(DK[t.closest('.dj-ch').dataset.ch], t.dataset.eq, 0); }
    else if ('filter' in t.dataset) { t.value = 0; E.setFilter(DK[t.closest('.dj-ch').dataset.ch], 0); }
    else if (t.dataset.a === 'pitch') { const x = t.closest('.dj-deck').dataset.deck; t.value = 0; E.setPitch(DK[x], 0); syncPitch(x); }
  });
  function syncPitch(x) {
    const d = DK[x], el = deckEl(x);
    el.querySelector('[data-a="pitch"]').value = d.pitch;
    el.querySelector('.dj-pv').textContent = `${d.pitch >= 0 ? '+' : ''}${d.pitch.toFixed(1)}%`;
  }

  // ---------------- MASTER + AUTO DROP LINE-UP ----------------
  let master = 'A';
  try { master = localStorage.getItem('dj-master') === 'B' ? 'B' : 'A'; } catch {}
  function markMaster() {
    try { localStorage.setItem('dj-master', master); } catch {}
    for (const x of ['A', 'B']) deckEl(x).querySelector('[data-a="master"]').classList.toggle('on', x === master);
  }
  const drops = (t) => { const f = t && C.feats[t.id]; return [f?.d1ms, f?.d2ms].filter((v) => v > 0).map((v) => v / 1000); };
  const downbeats = (d) => (d.wave?.beats || []).filter((b) => b[1] === 1).map((b) => b[0] / 1000);

  // One press: the following deck takes the master's tempo and jumps so its drop lands on the master's next
  // drop, or, when the master has no drop ahead, on the master's next 16-bar phrase (then 8, then 4).
  // follow = the deck that moves (its own ⇆ AUTO DROP button); pressed on the master, the other deck moves.
  // Master stopped: it's cued 16 bars before its drop and both start together.
  function lineUpDrops(follow) {
    let s = follow ? DK[follow] : E.other(DK[master]);
    let m = E.other(s);
    if (follow && follow === master) { s = E.other(DK[follow]); m = DK[follow]; }
    if (!m.track || !s.track) return toast('LOAD A TRACK ON BOTH DECKS', true);
    if (m !== DK[master]) { master = m.name; markMaster(); }
    const md = drops(m.track), sd = drops(s.track);
    if (!sd.length) return toast(`NO DROP KNOWN ON DECK ${s.name} · PLAY TO IT AND PRESS ⚑ SET DROP`, true);
    E.resume();
    const db = downbeats(m);
    if (m.el.paused && md.length) {
      const i = db.findIndex((t) => t >= md[0] - 0.05);
      m.el.currentTime = i >= 16 ? db[i - 16] : Math.max(0, md[0] - 16 * 4 * 60 / (m.track.bpm || 140));
    }
    E.sync(s); syncPitch(s.name);
    const now = m.el.currentTime, rateM = m.el.playbackRate || 1, rateS = s.el.playbackRate || 1;
    const lead = 2.5; // seconds of warning at least
    // where the master can take a drop: its own drops first, then phrase lines counted from its first drop
    const anchor = md.length ? Math.max(0, db.findIndex((t) => t >= md[0] - 0.05)) : 0;
    const spots = [...md.filter((t) => t - now >= lead).map((t) => ({ t, kind: 'drop' }))];
    for (const step of [16, 8, 4]) for (let i = 0; i < db.length; i++) if (((i - anchor) % step + step) % step === 0 && db[i] - now >= lead) spots.push({ t: db[i], kind: `${step}-bar phrase` });
    let pick = null;
    for (const sp of spots) {
      const wait = (sp.t - now) / rateM;
      const sDrop = sd.find((x) => x - wait * rateS >= 0); // its build-up has to fit before the drop
      if (sDrop != null) { pick = { ...sp, wait, sDrop }; break; }
    }
    if (!pick) return toast(`NOTHING FITS · DECK ${m.name} HAS LESS THAN ${lead} s TO GO`, true);
    s.el.currentTime = pick.sDrop - pick.wait * rateS;
    if (m.el.paused) m.el.play();
    if (s.el.paused) s.el.play();
    lock = { m: m.name, s: s.name, mAt: pick.t, sAt: pick.sDrop };
    toast(`${s.name} FOLLOWS ${m.name} · ${E.bpmNow(m).toFixed(1)} BPM · DROP ${pick.kind === 'drop' ? 'ON ITS DROP' : `ON ITS NEXT ${pick.kind.toUpperCase()}`} IN ${pick.wait.toFixed(1)} s`);
  }
  let lock = null;
  // the countdown under the button: seconds to each deck's next drop (or locked target)
  function drawLock() {
    for (const x of ['A', 'B']) {
      const d = DK[x], el = box.querySelector(`.dj-lock [data-l="${x}"]`);
      if (!d.track) { el.textContent = `${x} —`; el.className = ''; continue; }
      const now = d.el.currentTime, rate = d.el.playbackRate || 1;
      const mine = lock && (lock.m === x ? lock.mAt : lock.s === x ? lock.sAt : null);
      const next = mine != null && mine > now ? mine : drops(d.track).find((t) => t > now);
      const secs = next != null ? (next - now) / rate : null;
      el.dataset.s = secs ?? '';
      el.textContent = `${x}${x === master ? ' ★' : ''} ${secs != null ? `DROP ${secs.toFixed(1)} s` : 'no drop ahead'}`;
    }
    const a = parseFloat(box.querySelector('.dj-lock [data-l="A"]').dataset.s), b = parseFloat(box.querySelector('.dj-lock [data-l="B"]').dataset.s);
    box.querySelector('.dj-lock').classList.toggle('locked', !E.A.el.paused && !E.B.el.paused && Math.abs(a - b) < 0.08);
    if (lock && (DK[lock.m].el.currentTime > lock.mAt + 1)) lock = null;
  }

  // ---------------- drop corrections (they teach the finder) ----------------
  async function setDrop(x, which, clear) {
    const d = DK[x], t = d.track;
    if (!t || String(t.id).startsWith('f')) return toast('ONLY TRACKS ANALYSED IN REKORDBOX', true);
    const now = d.el.currentTime, f = C.feats[t.id] || {};
    if (!which) { // the nearer of the two drops (or DROP 2 when well past DROP 1 and there's no DROP 2 yet)
      const d1 = f.d1ms > 0 ? f.d1ms / 1000 : null, d2 = f.d2ms > 0 ? f.d2ms / 1000 : null;
      which = d1 == null ? 1 : d2 != null ? (Math.abs(now - d2) < Math.abs(now - d1) ? 2 : 1) : (now - d1 > 40 ? 2 : 1);
    }
    try {
      if (clear) { await hs.call('libDropFix', t.id, 1, 0); await hs.call('libDropFix', t.id, 2, 0); }
      const r = clear ? null : await hs.call('libDropFix', t.id, which, Math.round(now * 1000));
      C.feats = (await hs.call('libFeatures')) || C.feats;
      toast(clear ? 'YOUR DROP MARKS FOR THIS TRACK ARE GONE' : `DROP ${which} SET AT ${fmtLen(r.ms / 1000)} · THE FINDER HAS LEARNED FROM ${r.corrections} TRACK${r.corrections === 1 ? '' : 'S'}`);
    } catch (e) { toast(e.message, true); }
  }

  // ---------------- drawing ----------------
  function fit(cv) {
    const r = cv.parentElement.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return { ctx: cv.getContext('2d'), W: w, H: h, dpr };
  }
  const SPAN = 9; // seconds of track across a zoomed waveform
  function drawZoom(x) {
    const d = DK[x], cv = box.querySelector(`.dj-zoom[data-z="${x}"] canvas`);
    const { ctx, W, H, dpr } = fit(cv);
    ctx.clearRect(0, 0, W, H);
    const w = d.hi?.bytes ? d.hi : d.wave;
    if (!d.track || !w?.bytes) { ctx.fillStyle = 'rgba(0,255,110,0.25)'; ctx.font = `${11 * dpr}px "Share Tech Mono", monospace`; ctx.fillText(d.track ? 'reading waveform…' : `deck ${x} empty`, 12 * dpr, H / 2); return; }
    const dur = d.el.duration || d.track.len || 1, cps = w.cols / dur, pps = W / SPAN, now = d.el.currentTime, t0 = now - SPAN / 2;
    const mid = H / 2;
    for (let px = 0; px < W; px += 2 * dpr) {
      const t = t0 + px / pps;
      if (t < 0 || t > dur) continue;
      const c = Math.floor(t * cps) * 4;
      const h = (w.bytes[c + 3] / 255) * mid * 0.92;
      ctx.fillStyle = `rgba(${w.bytes[c]},${w.bytes[c + 1]},${w.bytes[c + 2]},${t < now ? 0.55 : 1})`;
      ctx.fillRect(px, mid - h, 2 * dpr, h * 2);
    }
    for (const [ms, beat] of w.beats || []) {
      const bx = (ms / 1000 - t0) * pps;
      if (bx < 0 || bx > W) continue;
      ctx.fillStyle = beat === 1 ? 'rgba(234,255,240,0.6)' : 'rgba(234,255,240,0.18)';
      ctx.fillRect(bx, beat === 1 ? 0 : H * 0.75, (beat === 1 ? 1.5 : 1) * dpr, beat === 1 ? H : H * 0.25);
    }
    for (const [ms, kind, col] of d.track.cues || []) {
      const cx = (ms / 1000 - t0) * pps;
      if (cx < 0 || cx > W || kind === 0) continue;
      ctx.fillStyle = CUE_COLORS[(col || kind) % 8];
      ctx.fillRect(cx, 0, 2 * dpr, H); ctx.fillRect(cx, 0, 12 * dpr, 12 * dpr);
      ctx.fillStyle = '#001a08'; ctx.font = `bold ${9 * dpr}px "Share Tech Mono", monospace`; ctx.fillText(String.fromCharCode(64 + kind), cx + 3 * dpr, 9 * dpr);
    }
    // drop markers: gold = found by the finder, magenta ✓ = your mark
    const f = C.feats[d.track.id];
    [[f?.d1ms, f?.fx1, 1], [f?.d2ms, f?.fx2, 2]].forEach(([ms, mine, n]) => {
      if (!(ms > 0)) return;
      const dx = (ms / 1000 - t0) * pps;
      if (dx < 0 || dx > W) return;
      ctx.fillStyle = mine ? '#ff4fd8' : '#ffc400';
      ctx.fillRect(dx, 0, 3 * dpr, H);
      ctx.font = `bold ${10 * dpr}px "Share Tech Mono", monospace`;
      ctx.fillText(`DROP ${n}${mine ? ' ✓' : ''}`, dx + 5 * dpr, H - 5 * dpr);
    });
    const cueX = (d.cue - t0) * pps;
    if (cueX >= 0 && cueX <= W) { ctx.fillStyle = '#ff9a1f'; ctx.beginPath(); ctx.moveTo(cueX, H); ctx.lineTo(cueX - 5 * dpr, H - 8 * dpr); ctx.lineTo(cueX + 5 * dpr, H - 8 * dpr); ctx.fill(); }
    ctx.fillStyle = '#eafff0';
    ctx.fillRect(W / 2 - dpr, 0, 2 * dpr, H);
  }
  function drawOver(x) {
    const d = DK[x], cv = deckEl(x).querySelector('.dj-over canvas');
    const { ctx, W, H, dpr } = fit(cv);
    ctx.clearRect(0, 0, W, H);
    const w = d.wave;
    if (!d.track || !w?.bytes) return;
    const dur = d.el.duration || d.track.len || 1, pos = d.el.currentTime / dur;
    for (let px = 0; px < W; px += 2 * dpr) {
      const c = Math.floor((px / W) * w.cols) * 4, h = (w.bytes[c + 3] / 255) * H * 0.9;
      ctx.fillStyle = `rgba(${w.bytes[c]},${w.bytes[c + 1]},${w.bytes[c + 2]},${px / W < pos ? 0.4 : 0.9})`;
      ctx.fillRect(px, H - h, 1.5 * dpr, h);
    }
    const f = C.feats[d.track.id];
    [[f?.d1ms, f?.fx1], [f?.d2ms, f?.fx2]].forEach(([ms, mine]) => {
      if (!(ms > 0)) return;
      ctx.fillStyle = mine ? '#ff4fd8' : '#ffc400';
      const dx = (ms / 1000 / dur) * W;
      ctx.fillRect(dx - dpr, 0, 2 * dpr, H);
      ctx.beginPath(); ctx.moveTo(dx - 4 * dpr, 0); ctx.lineTo(dx + 4 * dpr, 0); ctx.lineTo(dx, 6 * dpr); ctx.fill();
    });
    ctx.fillStyle = '#eafff0';
    ctx.fillRect(pos * W - dpr, 0, 2 * dpr, H);
  }
  let framing = false;
  function frame() {
    if (HS.view !== 'crate') { framing = false; return; } // another tab: no frames (HS.onView restarts the loop)
    requestAnimationFrame(frame);
    if (C.mode !== 'dj') return;
    for (const x of ['A', 'B']) {
      const d = DK[x], el = deckEl(x);
      drawZoom(x); drawOver(x);
      if (d.track) {
        const dur = d.el.duration || d.track.len || 0;
        el.querySelector('.dj-time').textContent = `${fmtLen(d.el.currentTime)} / −${fmtLen(dur - d.el.currentTime)}`;
        el.querySelector('.dj-bpm').textContent = E.bpmNow(d) ? E.bpmNow(d).toFixed(1) : '—';
      }
      el.querySelector('[data-a="play"]').textContent = d.el.paused ? '▶' : '❚❚';
      el.querySelector('[data-a="play"]').classList.toggle('on', !d.el.paused);
      el.classList.toggle('live', !d.el.paused);
      chEl(x).querySelector('.dj-vu i').style.height = `${Math.round(E.level(d) * 100)}%`;
    }
    // beat phase of both decks: when the two marks line up, the beats are together
    const pa = E.phase(E.A), pb = E.phase(E.B);
    box.querySelector('.dj-phase .pa').style.left = pa ? `${((pa.inBar - 1 + pa.frac) / 4) * 100}%` : '-10%';
    box.querySelector('.dj-phase .pb').style.left = pb ? `${((pb.inBar - 1 + pb.frac) / 4) * 100}%` : '-10%';
    box.querySelector('#dj-xf').value = E.xf;
    drawLock();
  }
  const startFrames = () => { if (!framing && HS.view === 'crate') { framing = true; requestAnimationFrame(frame); } };
  HS.onView(startFrames);
  startFrames();

  return {
    load, loadFree,
    show() { for (const x of ['A', 'B']) { renderDeck(x); syncPitch(x); } markMaster(); box.querySelector('#dj-xf').value = E.xf; },
  };
})();
