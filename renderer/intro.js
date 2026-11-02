// HYPERSPACE boot sequence (~6 s, click or any key skips):
//   signal -> matrix rain -> vortex -> ignition -> sacred geometry bloom -> title decode -> warp into the UI.
// Sound is synthesized with Web Audio (no files). Mode: full | silent | off (localStorage 'intro').
(() => {
  const TAU = Math.PI * 2;
  const root = document.getElementById('intro');
  const cv = root.querySelector('canvas');
  const ctx = cv.getContext('2d');
  const titleEl = root.querySelector('.intro-title');
  const mainEl = root.querySelector('.it-main');
  const subEl = root.querySelector('.it-sub');
  const GLYPHS = 'ï½±ï½²ï½³ï½´ï½µï½¶ï½·ï½¸ï½¹ï½ºï½»ï½¼ï½½ï½¾ï½¿ï¾€ï¾ï¾‚ï¾ƒï¾„ï¾…ï¾†ï¾‡ï¾ˆï¾‰ï¾Šï¾‹ï¾Œï¾ï¾Žï¾ï¾ï¾‘ï¾’ï¾“ï¾”ï¾•ï¾–ï¾—ï¾˜ï¾™ï¾šï¾›ï¾œï¾0123456789â˜‰â˜½âœ¡âš›â–³â–½â—¬âŸâŒ¬â£â˜âœºâŠ›à¥';
  const TITLE = 'HYPERSPACE';
  const T = { rain: 0.4, vortex: 1.6, ignite: 2.8, title: 3.3, warp: 4.6, end: 5.9 };

  const rand = (a, b) => a + Math.random() * (b - a);
  const glyph = () => GLYPHS[(Math.random() * GLYPHS.length) | 0];
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const seg = (t, a, b) => clamp01((t - a) / (b - a));
  const easeOut = (x) => 1 - Math.pow(1 - x, 3);
  const easeIn = (x) => x * x * x;

  let mode = 'full';
  try { mode = localStorage.getItem('intro') || 'full'; } catch {}
  if (window.hs && window.hs.remote && mode === 'full') mode = 'silent'; // phones: silent by default
  if (/[?&]intro=silent/.test(location.search) && mode === 'full') mode = 'silent'; // test captures

  let raf = 0, running = false, audio = null, W = 0, H = 0, S = 0, k = 1;
  let cols = [], vortex = null, sparks = null, start = 0;

  // ---------------- sound ----------------
  function sound() {
    let ac;
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    const t0 = ac.currentTime + 0.05;
    const master = ac.createGain();
    master.gain.value = 0.55;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    master.connect(comp).connect(ac.destination);

    const noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const noise = (at, dur) => { const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.start(at); s.stop(at + dur); return s; };
    const env = (g, pts) => { g.gain.setValueAtTime(0.0001, pts[0][0]); for (const [time, v] of pts) g.gain.exponentialRampToValueAtTime(Math.max(0.0001, v), time); };

    // 1. hum: two detuned low sines swelling until ignition
    for (const f of [55, 55.6, 110.3]) {
      const o = ac.createOscillator(); o.frequency.value = f;
      const g = ac.createGain(); env(g, [[t0, 0.0001], [t0 + T.ignite - 0.05, f > 100 ? 0.05 : 0.14], [t0 + T.ignite + 0.15, 0.0001]]);
      o.connect(g).connect(master); o.start(t0); o.stop(t0 + T.ignite + 0.3);
    }
    // 2. whoosh into the vortex: noise through a rising band-pass
    {
      const s = noise(t0 + T.vortex - 0.3, T.ignite - T.vortex + 0.4);
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2.5;
      bp.frequency.setValueAtTime(250, t0 + T.vortex - 0.3);
      bp.frequency.exponentialRampToValueAtTime(5000, t0 + T.ignite);
      const g = ac.createGain(); env(g, [[t0 + T.vortex - 0.3, 0.0001], [t0 + T.ignite - 0.05, 0.35], [t0 + T.ignite + 0.08, 0.0001]]);
      s.connect(bp).connect(g).connect(master);
    }
    // 3. ignition: "ta" pickup then the big "DUM"
    const ti = t0 + T.ignite;
    {
      const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = 98;
      const g = ac.createGain(); env(g, [[ti - 0.32, 0.0001], [ti - 0.3, 0.35], [ti - 0.12, 0.0001]]);
      o.connect(g).connect(master); o.start(ti - 0.32); o.stop(ti - 0.1);
    }
    {
      // sub drop with saturation
      const o = ac.createOscillator(); o.frequency.setValueAtTime(150, ti); o.frequency.exponentialRampToValueAtTime(36, ti + 1.3);
      const shaper = ac.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 2.5); }
      shaper.curve = curve;
      const g = ac.createGain(); env(g, [[ti, 0.0001], [ti + 0.01, 1], [ti + 2.6, 0.0001]]);
      o.connect(shaper).connect(g).connect(master); o.start(ti); o.stop(ti + 2.7);
      // transient crack
      const s = noise(ti, 0.12);
      const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
      const g2 = ac.createGain(); env(g2, [[ti, 0.0001], [ti + 0.004, 0.6], [ti + 0.11, 0.0001]]);
      s.connect(hp).connect(g2).connect(master);
    }
    {
      // the chord: detuned saws through an opening low-pass (Am add9 spread)
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 6;
      lp.frequency.setValueAtTime(180, ti); lp.frequency.exponentialRampToValueAtTime(3200, ti + 1.6); lp.frequency.exponentialRampToValueAtTime(600, ti + 3.2);
      const g = ac.createGain(); env(g, [[ti, 0.0001], [ti + 0.5, 0.1], [ti + 1.8, 0.08], [ti + 3.4, 0.0001]]);
      lp.connect(g).connect(master);
      for (const f of [55, 110, 164.8, 220, 246.9, 329.6, 440]) {
        for (const d of [-6, 6]) {
          const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = d;
          o.connect(lp); o.start(ti); o.stop(ti + 3.5);
        }
      }
    }
    // 4. shimmer arpeggio over the bloom, through a feedback delay
    {
      const dl = ac.createDelay(1); dl.delayTime.value = 0.18;
      const fb = ac.createGain(); fb.gain.value = 0.45;
      const out = ac.createGain(); out.gain.value = 0.5;
      dl.connect(fb).connect(dl); dl.connect(out).connect(master);
      [880, 1318.5, 1760, 2093, 2637, 3520].forEach((f, i) => {
        const at = t0 + T.ignite + 0.45 + i * 0.12;
        const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        const g = ac.createGain(); env(g, [[at, 0.0001], [at + 0.005, 0.12], [at + 0.5, 0.0001]]);
        o.connect(g); g.connect(dl); g.connect(master); o.start(at); o.stop(at + 0.55);
      });
    }
    // 5. warp: riser + noise sweep, then a soft landing thump
    {
      const tw = t0 + T.warp;
      const o = ac.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(80, tw); o.frequency.exponentialRampToValueAtTime(1600, tw + 0.85);
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
      const g = ac.createGain(); env(g, [[tw, 0.0001], [tw + 0.8, 0.12], [tw + 0.95, 0.0001]]);
      o.connect(lp).connect(g).connect(master); o.start(tw); o.stop(tw + 1);
      const s = noise(tw, 1);
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
      bp.frequency.setValueAtTime(400, tw); bp.frequency.exponentialRampToValueAtTime(9000, tw + 0.9);
      const g2 = ac.createGain(); env(g2, [[tw, 0.0001], [tw + 0.85, 0.3], [tw + 0.98, 0.0001]]);
      s.connect(bp).connect(g2).connect(master);
      const th = ac.createOscillator(); th.frequency.setValueAtTime(90, tw + 0.95); th.frequency.exponentialRampToValueAtTime(40, tw + 1.4);
      const g3 = ac.createGain(); env(g3, [[tw + 0.95, 0.0001], [tw + 0.97, 0.5], [tw + 1.6, 0.0001]]);
      th.connect(g3).connect(master); th.start(tw + 0.95); th.stop(tw + 1.7);
    }
    return {
      stop() {
        try { master.gain.cancelScheduledValues(ac.currentTime); master.gain.setTargetAtTime(0, ac.currentTime, 0.08); } catch {}
        setTimeout(() => ac.close().catch(() => {}), 600);
      },
      done() { setTimeout(() => ac.close().catch(() => {}), 2500); },
    };
  }

  // ---------------- visuals ----------------
  function resize() {
    k = Math.min(window.devicePixelRatio || 1, 1.25) * Math.min(1, 1700 / Math.max(1, window.innerWidth));
    W = cv.width = Math.round(window.innerWidth * k);
    H = cv.height = Math.round(window.innerHeight * k);
    S = Math.min(W, H);
  }

  function buildRain() {
    const fs = 18 * k;
    const n = Math.ceil(W / fs);
    cols = Array.from({ length: n }, (_, i) => ({
      x: i * fs + fs / 2, delay: rand(0, 0.9), speed: rand(0.55, 1.25), trail: Array.from({ length: 12 }, glyph),
    }));
  }

  function rainY(c, t) { return (t - T.rain - c.delay) * c.speed * H * 0.9; }

  // Speed note: canvas text is slow when the font or colour changes between glyphs, so everything below is drawn
  // in batches: all glyphs that share a size and colour together, all sparks of one brightness in one path.
  function drawRain(t, fade) {
    const fs = 18 * k;
    ctx.font = `${fs}px "Share Tech Mono", monospace`;
    ctx.textAlign = 'center';
    for (const c of cols) if (Math.random() < 0.3) c.trail[(Math.random() * c.trail.length) | 0] = glyph();
    for (let j = 0; j < 12; j++) {
      const a = (1 - j / 12) * fade;
      ctx.fillStyle = j === 0 ? `rgba(234,255,239,${a})` : `hsla(${140 + j * 2},100%,${55 - j * 2}%,${a * 0.85})`;
      for (const c of cols) {
        const gy = rainY(c, t) - j * fs;
        if (gy < -fs || gy > H + fs || gy + j * fs < 0) continue;
        ctx.fillText(c.trail[j], c.x, gy);
      }
    }
  }

  function buildVortex(t) {
    const fs = 18 * k;
    vortex = [];
    for (const c of cols) {
      const y = rainY(c, t);
      for (let j = 0; j < 6; j++) {
        const gy = y - j * fs * 2;
        if (gy < -fs || gy > H + fs) continue;
        const dx = c.x - W / 2, dy = gy - H / 2;
        vortex.push({ a: Math.atan2(dy, dx), r: Math.hypot(dx, dy), ch: c.trail[j], d: rand(0, 0.25), px: null, py: null });
      }
    }
  }

  function drawVortex(t) {
    const fs = 18 * k, LV = 10;
    ctx.textAlign = 'center';
    // each particle's progress, rounded to one of 10 steps: one font, one colour, one trail path per step
    const groups = Array.from({ length: LV }, () => []);
    for (const p of vortex) {
      const u = easeIn(clamp01((t - T.vortex - p.d) / (T.ignite - T.vortex - p.d)));
      const r = p.r * Math.pow(1 - u, 1.4);
      const a = p.a + u * u * 7;
      const x = W / 2 + Math.cos(a) * r, y = H / 2 + Math.sin(a) * r;
      groups[Math.min(LV - 1, (u * LV) | 0)].push([p, x, y]);
    }
    ctx.lineWidth = 1.2 * k;
    groups.forEach((g, i) => {
      if (!g.length) return;
      const u = (i + 0.5) / LV;
      ctx.strokeStyle = `hsla(${140 + u * 30},100%,65%,${0.25 + u * 0.5})`;
      ctx.beginPath();
      for (const [p, x, y] of g) if (p.px != null) { ctx.moveTo(p.px, p.py); ctx.lineTo(x, y); }
      ctx.stroke();
      ctx.font = `${(fs * (1 - u * 0.7)).toFixed(1)}px "Share Tech Mono", monospace`;
      ctx.fillStyle = `hsla(${140 + u * 40},100%,${60 + u * 35}%,0.9)`;
      for (const [p, x, y] of g) { ctx.fillText(p.ch, x, y); p.px = x; p.py = y; }
    });
    // core glow building up
    const u = seg(t, T.vortex, T.ignite);
    const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, S * (0.05 + u * 0.12));
    g.addColorStop(0, `rgba(234,255,239,${u})`); g.addColorStop(0.4, `rgba(0,255,110,${u * 0.6})`); g.addColorStop(1, 'rgba(0,255,110,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function buildSparks() {
    sparks = Array.from({ length: 520 }, () => {
      const a = rand(0, TAU), v = rand(0.15, 1.1) * S;
      return { x: 0, y: 0, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.6, 1.6), hue: rand(120, 175) };
    });
  }

  function drawSparks(t, dt) {
    const age = t - T.ignite, LV = 8, damp = Math.pow(0.18, dt);
    // 3 hues Ã— 8 brightness steps, one path each (instead of 520 separate strokes)
    const paths = Array.from({ length: 3 * LV }, () => null);
    ctx.lineWidth = 1.6 * k;
    for (const s of sparks) {
      if (age > s.life) continue;
      s.vx *= damp; s.vy *= damp;
      const nx = s.x + s.vx * dt, ny = s.y + s.vy * dt;
      const key = Math.min(2, ((s.hue - 120) / 19) | 0) * LV + Math.min(LV - 1, ((1 - age / s.life) * LV) | 0);
      const pth = paths[key] || (paths[key] = new Path2D());
      pth.moveTo(W / 2 + s.x, H / 2 + s.y); pth.lineTo(W / 2 + nx, H / 2 + ny);
      s.x = nx; s.y = ny;
    }
    paths.forEach((pth, key) => {
      if (!pth) return;
      const hue = 129 + ((key / LV) | 0) * 19, a = ((key % LV) + 0.5) / LV;
      ctx.strokeStyle = `hsla(${hue},100%,70%,${a})`;
      ctx.stroke(pth);
    });
  }

  // draw a circle "being drawn" from 0..p
  function arcOn(x, y, r, p, start = -Math.PI / 2) {
    if (p <= 0) return;
    ctx.beginPath(); ctx.arc(x, y, r, start, start + TAU * Math.min(1, p)); ctx.stroke();
  }

  function geometry(t, color, dx, alpha) {
    const R1 = S * 0.085;
    const rot = (t - T.ignite) * 0.35 + easeIn(seg(t, T.warp, T.end)) * 6;
    ctx.save();
    ctx.translate(W / 2 + dx, H / 2);
    ctx.rotate(rot);
    const stroke = (w, a) => { ctx.lineWidth = w * k; ctx.strokeStyle = color(a * alpha); };

    // seed of life: center + 6 petals, drawn on in sequence
    const pts = [[0, 0]];
    for (let i = 0; i < 6; i++) pts.push([Math.cos((i * TAU) / 6) * R1, Math.sin((i * TAU) / 6) * R1]);
    pts.forEach(([x, y], i) => {
      const p = easeOut(seg(t, T.ignite + 0.05 + i * 0.06, T.ignite + 0.45 + i * 0.06));
      stroke(5, 0.25); arcOn(x, y, R1, p, (i * TAU) / 6);
      stroke(1.6, 0.95); arcOn(x, y, R1, p, (i * TAU) / 6);
    });
    // flower of life: second ring of 12
    const ring2 = [];
    for (let s = 0; s < 6; s++) {
      const a0 = (s * TAU) / 6, a1 = ((s + 1) * TAU) / 6;
      ring2.push([Math.cos(a0) * 2 * R1, Math.sin(a0) * 2 * R1]);
      ring2.push([(Math.cos(a0) + Math.cos(a1)) * R1, (Math.sin(a0) + Math.sin(a1)) * R1]);
    }
    ring2.forEach(([x, y], i) => {
      const p = easeOut(seg(t, T.ignite + 0.35 + i * 0.03, T.ignite + 0.8 + i * 0.03));
      stroke(1.2, 0.6); arcOn(x, y, R1, p);
    });
    // enclosing rings
    stroke(2.2, 0.9); arcOn(0, 0, R1 * 3, easeOut(seg(t, T.ignite + 0.5, T.ignite + 1.0)));
    stroke(1.2, 0.6); arcOn(0, 0, R1 * 3.25, easeOut(seg(t, T.ignite + 0.6, T.ignite + 1.1)), Math.PI / 2);
    // metatron's cube: 13 points, lines grow out
    const mp = [[0, 0]];
    for (let i = 0; i < 6; i++) { const a = (i * TAU) / 6 - Math.PI / 2; mp.push([Math.cos(a) * R1 * 1.73, Math.sin(a) * R1 * 1.73]); }
    for (let i = 0; i < 6; i++) { const a = (i * TAU) / 6 - Math.PI / 2; mp.push([Math.cos(a) * R1 * 3, Math.sin(a) * R1 * 3]); }
    const lp = seg(t, T.ignite + 0.7, T.ignite + 1.3);
    if (lp > 0) {
      stroke(0.9, 0.55);
      ctx.beginPath();
      let n = 0;
      for (let i = 0; i < mp.length; i++) for (let j = i + 1; j < mp.length; j++, n++) {
        const q = clamp01(lp * 1.6 - (n / 78) * 0.6);
        if (q <= 0) continue;
        ctx.moveTo(mp[i][0], mp[i][1]);
        ctx.lineTo(mp[i][0] + (mp[j][0] - mp[i][0]) * q, mp[i][1] + (mp[j][1] - mp[i][1]) * q);
      }
      ctx.stroke();
    }
    // hexagram spinning in
    const hp = easeOut(seg(t, T.ignite + 0.6, T.ignite + 1.2));
    if (hp > 0) {
      ctx.save();
      ctx.rotate((1 - hp) * -2.5);
      const hr = R1 * 4.3 * hp;
      for (const r0 of [-Math.PI / 2, Math.PI / 2]) {
        ctx.beginPath();
        for (let i = 0; i <= 3; i++) { const a = r0 + (i * TAU) / 3; i ? ctx.lineTo(Math.cos(a) * hr, Math.sin(a) * hr) : ctx.moveTo(Math.cos(a) * hr, Math.sin(a) * hr); }
        stroke(4, 0.12); ctx.stroke();
        stroke(1.4, 0.7); ctx.stroke();
      }
      ctx.restore();
    }
    // outer tick ring, counter-rotating
    const tp = easeOut(seg(t, T.ignite + 0.8, T.ignite + 1.4));
    if (tp > 0) {
      ctx.save();
      ctx.rotate(-rot * 2.2);
      stroke(1.2, 0.7);
      ctx.beginPath();
      const rr = R1 * 5.1;
      for (let i = 0; i < 96 * tp; i++) {
        const a = (i / 96) * TAU, l = i % 8 === 0 ? R1 * 0.35 : R1 * 0.12;
        ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); ctx.lineTo(Math.cos(a) * (rr + l), Math.sin(a) * (rr + l));
      }
      ctx.stroke();
      stroke(1.8, 0.8); arcOn(0, 0, rr, tp);
      ctx.restore();
    }
    // bindu
    const bp = seg(t, T.ignite, T.ignite + 0.3);
    if (bp > 0) {
      ctx.fillStyle = color(alpha);
      ctx.beginPath(); ctx.arc(0, 0, (3 + Math.sin(t * 8) * 1) * k * (1 + easeIn(seg(t, T.warp, T.end)) * 30), 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  // the 36 soft light rays are painted once, at half size, and then only turned and faded each frame
  let rayImg = null;
  function buildRays() {
    const R = Math.hypot(W, H) * 0.56, half = Math.ceil(R / 2);
    rayImg = document.createElement('canvas');
    rayImg.width = rayImg.height = half * 2;
    const c = rayImg.getContext('2d');
    c.translate(half, half);
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * TAU + Math.sin(i * 7.3) * 0.05, w = 0.008 + (i % 3) * 0.006;
      const g = c.createLinearGradient(0, 0, Math.cos(a) * half, Math.sin(a) * half);
      g.addColorStop(0, 'rgba(0,255,110,0.05)'); g.addColorStop(1, 'rgba(0,255,110,0)');
      c.fillStyle = g;
      c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, half, a - w, a + w); c.closePath(); c.fill();
    }
  }
  function drawRays(t) {
    const u = seg(t, T.ignite, T.ignite + 0.6) * (1 - seg(t, T.warp + 0.4, T.end));
    if (u <= 0) return;
    if (!rayImg) buildRays();
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(t * 0.15);
    ctx.globalAlpha = u;
    const d = rayImg.width * 2;
    ctx.drawImage(rayImg, -d / 2, -d / 2, d, d);
    ctx.restore();
  }

  let streaks = null;
  function drawWarp(t) {
    const u = seg(t, T.warp, T.end);
    if (u <= 0) return;
    if (!streaks) streaks = Array.from({ length: 220 }, () => ({ a: rand(0, TAU), r: rand(0.02, 0.5), sp: rand(0.6, 1.4) }));
    const R = Math.hypot(W, H) * 0.6;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    // 4 colour groups, one path each
    ctx.lineWidth = (1 + u * 3) * k;
    for (let gi = 0; gi < 4; gi++) {
      ctx.strokeStyle = `hsla(${130 + (0.6 + (gi + 0.5) * 0.2) * 30},100%,${70 + u * 25}%,${Math.min(1, u * 2)})`;
      ctx.beginPath();
      for (const s of streaks) {
        if (Math.min(3, ((s.sp - 0.6) / 0.2) | 0) !== gi) continue;
        const r0 = (s.r + easeIn(u) * s.sp * 2.2) * R, len = (0.04 + easeIn(u) * 0.6) * R;
        ctx.moveTo(Math.cos(s.a) * r0, Math.sin(s.a) * r0); ctx.lineTo(Math.cos(s.a) * (r0 + len), Math.sin(s.a) * (r0 + len));
      }
      ctx.stroke();
    }
    ctx.restore();
    // final white-green flash
    const f = seg(t, T.end - 0.55, T.end - 0.2) * (1 - seg(t, T.end - 0.2, T.end));
    if (f > 0) { ctx.fillStyle = `rgba(200,255,220,${f * 0.85})`; ctx.fillRect(0, 0, W, H); }
  }

  function drawShock(t) {
    const age = t - T.ignite;
    if (age < 0 || age > 1.6) return;
    for (const [speed, width, delay] of [[1.5, 6, 0], [0.9, 3, 0.08], [2.4, 2, 0.02]]) {
      const a = age - delay;
      if (a < 0) continue;
      const r = a * S * speed;
      const al = Math.max(0, 1 - a / 1.2);
      ctx.strokeStyle = `rgba(157,255,184,${al})`;
      ctx.lineWidth = width * k * (1 - a / 1.6);
      ctx.beginPath(); ctx.arc(W / 2, H / 2, r, 0, TAU); ctx.stroke();
    }
    // flash (drawn normally, not additively, so it can't accumulate into a grey haze)
    const f = Math.exp(-age * 10);
    if (f > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgba(234,255,239,${f * 0.9})`;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  // title decode (DOM so the type stays crisp)
  let titleShown = false, subShown = false, warping = false;
  function updateTitle(t) {
    if (t < T.title) return;
    if (!titleShown) { titleShown = true; titleEl.classList.add('show'); }
    let s = '';
    for (let i = 0; i < TITLE.length; i++) s += t > T.title + 0.12 + i * 0.07 ? TITLE[i] : glyph();
    if (mainEl.textContent !== s) { mainEl.textContent = s; mainEl.dataset.text = s; }
    if (!subShown && t > T.title + 0.8) { subShown = true; subEl.classList.add('show'); }
    if (!warping && t > T.warp + 0.15) { warping = true; titleEl.classList.add('warp'); }
  }

  let last = 0;
  // The animation runs on its own clock: each frame advances it by the real time since the last frame, but
  // never more than 1/24 s. When the rest of HYPERSPACE is busy loading and a frame comes late, the intro
  // slows for an instant instead of jumping ahead (the jump was the "glitch" at startup).
  let clock = 0, prevNow = 0;
  function frame(now) {
    if (!running) return;
    const step = prevNow ? Math.min(1 / 24, Math.max(0, (now - prevNow) / 1000)) : 1 / 60;
    prevNow = now;
    clock += step;
    const t = clock;
    const dt = step;
    last = t;
    if (t >= T.end) { finish(false); return; }

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = t < T.ignite ? 'rgba(0,4,1,0.55)' : 'rgba(0,4,1,0.62)'; // short trails; additive layers must not pile up
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';

    // shake while the vortex tightens and on impact
    const shake = seg(t, T.vortex + 0.6, T.ignite) * 5 * k + Math.max(0, 1 - (t - T.ignite) * 3) * 12 * k * (t > T.ignite ? 1 : 0);
    ctx.save();
    if (shake > 0.2) ctx.translate(rand(-shake, shake), rand(-shake, shake));

    if (t < T.rain) {
      // signal: one pulsing glyph
      ctx.font = `${26 * k}px "Share Tech Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(157,255,184,${0.4 + 0.6 * Math.abs(Math.sin(t * 14))})`;
      ctx.fillText('à¥', W / 2, H / 2);
    } else if (t < T.vortex) {
      drawRain(t, 1);
    } else if (t < T.ignite) {
      if (!vortex) buildVortex(T.vortex);
      drawRain(t, 1 - seg(t, T.vortex, T.vortex + 0.4));
      drawVortex(t);
    } else {
      if (!sparks) buildSparks();
      drawRays(t);
      const dim = t > T.title ? 0.6 + 0.4 * seg(t, T.warp, T.warp + 0.3) : 1; // let the title read
      geometry(t, (a) => `rgba(29,233,182,${a * 0.55})`, -3 * k, dim);
      geometry(t, (a) => `rgba(198,255,0,${a * 0.45})`, 3 * k, dim);
      geometry(t, (a) => `rgba(0,255,110,${a})`, 0, dim);
      drawSparks(t, dt);
      drawShock(t);
      drawWarp(t);
      updateTitle(t);
    }
    ctx.restore();
    raf = requestAnimationFrame(frame);
  }

  function skip(e) {
    if (!running) return;
    if (e && e.type === 'keydown' && e.repeat) return;
    finish(false);
  }

  function finish(instant) {
    if (!running && !instant) return;
    running = false;
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', skip, true);
    root.removeEventListener('pointerdown', skip);
    if (audio) { if (instant) audio.stop(); else audio.done(); audio = null; }
    document.body.classList.remove('booting');
    if (instant) { root.classList.add('gone'); return; }
    root.classList.add('fade');
    setTimeout(() => root.classList.add('gone'), 750);
  }

  function play() {
    // the title appears ~3 s in; make sure its typeface is there by then
    try { document.fonts.load('800 64px Orbitron', 'HYPERSPACE').catch(() => {}); document.fonts.load('18px "Share Tech Mono"', 'A').catch(() => {}); } catch {}
    root.classList.remove('gone', 'fade');
    titleEl.classList.remove('show', 'warp');
    subEl.classList.remove('show');
    titleShown = subShown = warping = false;
    vortex = sparks = streaks = rayImg = null;
    document.body.classList.add('booting');
    resize();
    buildRain();
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    audio = mode === 'full' ? sound() : null;
    // build the heavy pieces now, not at the moment they first appear (that caused a hitch mid-intro)
    buildVortex(T.vortex);
    buildSparks();
    buildRays();
    running = true;
    last = 0; clock = 0; prevNow = 0;
    start = performance.now();
    window.addEventListener('keydown', skip, true);
    root.addEventListener('pointerdown', skip);
    raf = requestAnimationFrame(frame);
  }

  window.INTRO = {
    get mode() { return mode; },
    setMode(m) { mode = m; try { localStorage.setItem('intro', m); } catch {} },
    replay() { if (running) finish(true); setTimeout(play, 50); },
  };

  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (mode === 'off' || reduced || /[?&]intro=off/.test(location.search)) finish(true);
  else play();
})();
