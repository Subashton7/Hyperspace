// VJ on the phone: the geometry pack from vj-themes.js (Seed of Life, OM, SUBASHTON, yantras, 4D shapes, …)
// drawn with trails and glow on a 2D canvas. It pulses on the beat of whatever the phone is playing (the
// track's BPM from rekordbox, so it works offline and never touches the audio) or listens to the mic.
// Tap: next theme · hold: next colour · the buttons do the same plus MIC.
window.PhoneVJ = (() => {
  const TAU = Math.PI * 2;
  const PAL = [['MATRIX', 140, 14], ['DMT SPECTRUM', null, 0], ['ULTRAVIOLET', 278, 22], ['SUBASHTON', [180, 325], 0], ['INFERNO', 14, 20], ['AQUA', 172, 18], ['GOLD', 44, 9]];
  const S = { pal: 0, theme: 0, lineW: 1 };
  try { Object.assign(S, JSON.parse(localStorage.getItem('phone-vj') || '{}')); } catch {}
  const save = () => { try { localStorage.setItem('phone-vj', JSON.stringify(S)); } catch {} };
  const H = (t, off = 0) => {
    const [, base, spread] = PAL[S.pal] || PAL[0];
    if (base == null) return (t * 24 + off * 47 + 3600) % 360;
    if (Array.isArray(base)) return base[Math.abs(Math.round(off)) % 2] + Math.sin(t * 0.2 + off) * 8;
    return base + Math.sin(t * 0.2 + off) * spread;
  };
  const stroke = (ctx, hue, light, alpha, width) => { ctx.strokeStyle = `hsla(${hue},100%,${light}%,${alpha})`; ctx.lineWidth = width * S.lineW; };
  const circle = (ctx, x, y, r) => { ctx.beginPath(); ctx.arc(x, y, Math.max(0.5, r), 0, TAU); ctx.stroke(); };
  const poly = (ctx, n, r, rot, cx = 0, cy = 0) => { ctx.beginPath(); for (let i = 0; i <= n; i++) { const a = rot + (i / n) * TAU; const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); };
  const T = window.VJ_EXTRA ? window.VJ_EXTRA({ TAU, H, stroke, circle, poly }) : {};
  const keys = Object.keys(T);
  // signature first
  keys.sort((a, b) => (T[b].cat === 'SIGNATURE') - (T[a].cat === 'SIGNATURE'));

  let cv, ctx, raf = 0, running = false, t0 = performance.now(), rot = 0, last = performance.now();
  const A = { bass: 0, mid: 0, treble: 0, level: 0, beat: 0, spec: new Array(48).fill(0) };
  let bpmSource = () => null; // () => { bpm, pos, playing }
  let mic = null;

  function size() { const d = Math.min(devicePixelRatio || 1, 2); cv.width = cv.clientWidth * d; cv.height = cv.clientHeight * d; }

  function listen() {
    if (mic) return;
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }).then((stream) => {
      const an = ac.createAnalyser(); an.fftSize = 512; an.smoothingTimeConstant = 0.6;
      ac.createMediaStreamSource(stream).connect(an);
      mic = { ac, an, stream, buf: new Uint8Array(an.frequencyBinCount), avg: 0 };
    });
  }
  function unlisten() { if (!mic) return; mic.stream.getTracks().forEach((t) => t.stop()); mic.ac.close(); mic = null; }

  function audio(now, dt) {
    if (mic) {
      mic.an.getByteFrequencyData(mic.buf);
      const b = mic.buf, band = (a, z) => { let s = 0; for (let i = a; i < z; i++) s += b[i]; return s / (z - a) / 255; };
      const bass = band(1, 6), mid = band(6, 40), tre = band(40, 160);
      A.bass = A.bass * 0.6 + bass * 1.6 * 0.4; A.mid = A.mid * 0.6 + mid * 1.8 * 0.4; A.treble = A.treble * 0.6 + tre * 2.2 * 0.4;
      for (let i = 0; i < 48; i++) A.spec[i] = b[2 + i * 3];
      if (bass > mic.avg * 1.35 && bass > 0.25 && A.beat < 0.3) A.beat = 1;
      mic.avg = mic.avg * 0.95 + bass * 0.05;
    } else {
      // the playing track's tempo: a kick on every beat, swelling on the bar
      const s = bpmSource();
      if (s?.playing && s.bpm) {
        const beatLen = 60 / s.bpm, ph = (s.pos % beatLen) / beatLen, bar = Math.floor(s.pos / beatLen) % 4;
        const kick = Math.exp(-ph * 6);
        A.bass = 0.35 + kick * (bar === 0 ? 1 : 0.7); A.mid = 0.3 + Math.sin(now / 900) * 0.15 + kick * 0.3; A.treble = 0.25 + (ph > 0.5 ? 0.3 : 0);
        if (ph < 0.08) A.beat = Math.max(A.beat, 0.9);
        for (let i = 0; i < 48; i++) A.spec[i] = 255 * Math.max(0, Math.min(1, (1 - i / 48) * A.bass * 0.8 + Math.random() * 0.15 * A.treble));
      } else { A.bass *= 0.95; A.mid = 0.25 + Math.sin(now / 1400) * 0.1; A.treble *= 0.95; for (let i = 0; i < 48; i++) A.spec[i] *= 0.95; }
    }
    A.beat = Math.max(0, A.beat - dt * 3);
    A.level = (A.bass + A.mid + A.treble) / 3;
  }

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    audio(now, dt);
    const t = (now - t0) / 1000;
    rot += dt * (0.12 + A.mid * 0.35);
    const w = cv.width, h = cv.height;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(0,4,0,${0.2 + (1 - A.level) * 0.1})`; // trails
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.lineJoin = 'round';
    ctx.shadowBlur = 12 * (1 + A.bass); ctx.shadowColor = `hsl(${H(t)},100%,60%)`;
    const R = Math.min(w, h) * 0.44 * (1 + A.beat * 0.05);
    const th = T[keys[S.theme % keys.length]];
    try { th?.draw.call(th, ctx, R, { t, dt, rot, bass: A.bass, mid: A.mid, treble: A.treble, beat: A.beat, level: Math.min(1.5, A.level), complexity: 3, spec: A.spec, fold: 8, tilt: 0.3 }); } catch {}
    ctx.restore();
  }

  return {
    mount(canvas, source) {
      cv = canvas; ctx = cv.getContext('2d'); bpmSource = source;
      addEventListener('resize', () => cv && size());
      let hold = null, held = false;
      cv.addEventListener('pointerdown', () => { held = false; hold = setTimeout(() => { held = true; this.palette(); }, 550); });
      cv.addEventListener('pointerup', () => { clearTimeout(hold); if (!held) this.next(); });
    },
    start() { if (running) return; running = true; size(); last = performance.now(); raf = requestAnimationFrame(frame); },
    stop() { running = false; cancelAnimationFrame(raf); },
    next(d = 1) { S.theme = (S.theme + d + keys.length) % keys.length; save(); return this.name(); },
    palette() { S.pal = (S.pal + 1) % PAL.length; save(); return PAL[S.pal][0]; },
    name() { return `${T[keys[S.theme % keys.length]]?.name || ''} · ${PAL[S.pal][0]}`; },
    async mic(on) { if (on) await listen(); else unlisten(); return !!mic; },
    count: () => keys.length,
  };
})();
