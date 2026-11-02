// HYPERSPACE visual layer: matrix rain, hyperspace tunnel, core mandala, orb rings, sealed sigils.
(() => {
  const TAU = Math.PI * 2;
  const state = {
    level: 'high',       // high | low | off
    cpu: 0, cpuS: 0,     // raw + smoothed (0..1)
    cores: [], coresS: [],
    mem: 0, memS: 0, gpu: 0, gpuS: 0, disk: 0, diskS: 0,
    entities: [],        // [{name, cpu}]
    io: { rx: 0, tx: 0, read: 0, write: 0 },
    audio: 0,            // bass level when "pulse the UI to the music" is on
    radar: null,         // { disk, net } canvases when radar mode is on
    orbs: { mic: null, cam: null }, // true=on false=off null=unknown
    sealedActive: null,  // canvas element of the visible sealed view
  };

  // Background "artifacts", all adjustable in SETTINGS → DISPLAY. ORIGINAL is the look as first designed.
  const ART_ORIGINAL = {
    rain: { on: true, style: 'rain', opacity: 0.55, speed: 1, size: 16, density: 1, trail: 1, cpu: true },
    lattice: { on: true, opacity: 1, size: 1, spin: 1 },
    tunnel: { on: true, shape: 'original', opacity: 1, speed: 1, cpu: true },
    spiral: { on: false, arms: 6, opacity: 1, speed: 1 },
    stars: { on: false, density: 1, speed: 1 },
    scan: { on: true, strength: 1 },
    vignette: { on: true, strength: 1 },
    hue: 0, drift: 1,
  };
  let art = JSON.parse(JSON.stringify(ART_ORIGINAL));
  const RAIN_GLYPHS = {
    rain: 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789☉☽✡⚛△▽◬⟁⌬⏣☍✺⊛ॐ',
    waterfall: 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ012345789Z:.=*+-<>¦|',
    binary: '0101010110',
    runes: 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ☉☽✡△▽◬ॐ',
  };

  // drifts green <-> teal; during an overheat alarm everything bleeds red
  const ACCH = () => +document.body.dataset.accHue || 282; // the accent's hue (accent.js)
  const PURPLE = () => document.body.classList.contains('purple'); // Settings → LOOK → purple accents
  const hue = (t, off = 0) => (state.alarm ? 352 + Math.sin(t * 2 + off) * 8 : 140 + art.hue + Math.sin(t * 0.15 + off) * 18 * art.drift);

  function fit(canvas, dprCap = 1.5) {
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return { w, h, dpr };
  }

  // Frames drop to half rate while the window isn't focused (it usually sits on a side screen).
  let focused = document.hasFocus();
  window.addEventListener('focus', () => { focused = true; });
  window.addEventListener('blur', () => { focused = false; });

  // ---------------- background: matrix rain + hyperspace tunnel in ONE canvas ----------------
  // Everything behind the panels renders into a single reduced-resolution canvas that CSS upscales,
  // with the vignette and scanlines baked in. Separate full-window layers each cost a full-screen
  // blend per frame on the integrated GPU; one soft, glowy layer at 60% scale looks the same.
  const BG_SCALE = 0.6;
  const bg = document.getElementById('bg');
  const bctx = bg.getContext('2d');
  const rainC = document.createElement('canvas'); // persistent rain trails
  const rctx = rainC.getContext('2d');
  const overlay = document.createElement('canvas'); // vignette + scanlines, rebuilt on resize
  let drops = [], fontPx = 10, lastBg = 0, tunnelPhase = 0, spiralPhase = 0;
  const bgStars = [];

  function sizeBg(force = false) {
    const w = Math.max(2, Math.round(window.innerWidth * BG_SCALE)), h = Math.max(2, Math.round(window.innerHeight * BG_SCALE));
    if (!force && bg.width === w && bg.height === h) return false;
    for (const c of [bg, rainC, overlay]) { c.width = w; c.height = h; }
    const o = overlay.getContext('2d');
    o.clearRect(0, 0, w, h);
    if (art.vignette.on) {
      const v = o.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) * 0.55);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, `rgba(0,0,0,${Math.min(0.95, 0.75 * art.vignette.strength)})`);
      o.fillStyle = v; o.fillRect(0, 0, w, h);
    }
    if (art.scan.on) {
      o.fillStyle = `rgba(0,0,0,${Math.min(0.6, 0.22 * art.scan.strength)})`;
      for (let y = 1; y < h; y += 2) o.fillRect(0, y, w, 1);
    }
    return true;
  }

  const newDrop = (y) => ({ y, speed: art.rain.style === 'waterfall' ? 0.55 + Math.random() * 0.5 : 0.35 + Math.random() * 0.9, ch: '', py: -99 });
  function resetRain(force = false) {
    sizeBg(force);
    fontPx = Math.max(5, Math.round(art.rain.size * BG_SCALE));
    const cols = Math.ceil(rainC.width / fontPx);
    drops = Array.from({ length: cols }, () => newDrop(Math.random() * -60));
    rctx.fillStyle = '#000400';
    rctx.fillRect(0, 0, rainC.width, rainC.height);
  }

  function stepRain(t) {
    const { width: w, height: h } = rainC;
    const R = art.rain, waterfall = R.style === 'waterfall';
    const glyphs = RAIN_GLYPHS[R.style] || RAIN_GLYPHS.rain;
    rctx.fillStyle = `rgba(0, 4, 0, ${(waterfall ? 0.05 : 0.09) / Math.max(0.3, R.trail)})`; // trail length
    rctx.fillRect(0, 0, w, h);
    rctx.font = `${fontPx}px "Share Tech Mono", monospace`;
    // rain speeds up with CPU load (and music, if enabled)
    const boost = R.speed * (1 + (R.cpu ? state.cpuS * 1.6 : 0) + state.audio * 2.5);
    const respawn = 1 - 0.025 * R.density;
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      const ch = glyphs[(Math.random() * glyphs.length) | 0];
      const x = i * fontPx, y = d.y * fontPx;
      if (waterfall) {
        // classic code waterfall: only the newest glyph burns white, the stream behind it stays green and
        // keeps flickering into new symbols
        const hh = PURPLE() && i % 4 === 1 ? ACCH() : hue(t / 1000, i * 0.05);
        if (d.py > -99) { rctx.fillStyle = '#000400'; rctx.fillRect(x, d.py - fontPx, fontPx, fontPx + 2); rctx.fillStyle = `hsl(${hh}, 100%, 52%)`; rctx.fillText(d.ch, x, d.py); }
        rctx.fillStyle = '#eafff2';
        rctx.fillText(ch, x, y);
        d.ch = ch; d.py = y;
        if (Math.random() < 0.3 && y > 0) {
          const my = y - (1 + ((Math.random() * 18) | 0)) * fontPx;
          rctx.fillStyle = '#000400'; rctx.fillRect(x, my - fontPx, fontPx, fontPx + 2);
          rctx.fillStyle = `hsl(${hh}, 100%, ${32 + Math.random() * 22}%)`;
          rctx.fillText(glyphs[(Math.random() * glyphs.length) | 0], x, my);
        }
      } else {
        rctx.fillStyle = Math.random() < 0.08 ? '#eaffef' : `hsl(${PURPLE() && i % 4 === 1 ? ACCH() : hue(t / 1000, i * 0.05)}, 100%, ${45 + Math.random() * 20}%)`;
        rctx.fillText(ch, x, y);
      }
      d.y += d.speed * boost;
      if (y > h && Math.random() > respawn) { Object.assign(d, newDrop(Math.random() * -20)); }
    }
  }

  // new artifacts: golden spiral arms and a slow star drift
  function drawSpiral(sctx, w, h, s, dt) {
    const A = art.spiral;
    spiralPhase += dt * 0.08 * A.speed * (1 + state.cpuS);
    sctx.save();
    sctx.translate(w / 2, h / 2);
    sctx.globalCompositeOperation = 'lighter';
    const maxR = Math.hypot(w, h) * 0.6;
    for (let k = 0; k < A.arms; k++) {
      sctx.beginPath();
      for (let th = 0; th < 14; th += 0.08) {
        const r = 2 * Math.exp(0.306 * th); // golden spiral growth
        if (r > maxR) break;
        const a = th + spiralPhase + (k / A.arms) * TAU;
        th ? sctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) : sctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      sctx.strokeStyle = `hsla(${hue(s, k)}, 100%, 55%, ${0.06 * A.opacity})`;
      sctx.lineWidth = 1.2;
      sctx.stroke();
    }
    sctx.restore();
  }
  function drawStars(sctx, w, h, dt) {
    const S = art.stars, n = Math.round(160 * S.density);
    while (bgStars.length < n) bgStars.push({ a: Math.random() * TAU, r: Math.random(), v: 0.2 + Math.random() });
    bgStars.length = n;
    const R = Math.hypot(w, h) / 2;
    sctx.save();
    sctx.globalCompositeOperation = 'lighter';
    for (const st of bgStars) {
      st.r += st.v * dt * 0.05 * S.speed * (0.3 + st.r) * (1 + state.audio * 4);
      if (st.r > 1) { st.r = 0.02; st.a = Math.random() * TAU; }
      sctx.fillStyle = `hsla(${hue(0, st.a)}, 80%, 80%, ${Math.min(0.8, st.r)})`;
      const z = 0.5 + st.r * 1.6;
      sctx.fillRect(w / 2 + Math.cos(st.a) * st.r * R, h / 2 + Math.sin(st.a) * st.r * R, z, z);
    }
    sctx.restore();
  }

  // ---------------- hyperspace tunnel + flower lattice ----------------
  function polygon(ctx, n, r, rot) {
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = rot + (i / n) * TAU;
      i ? ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.stroke();
  }

  function flowerOfLife(ctx, r, rings) {
    // hex lattice of circles
    const pts = [[0, 0]];
    for (let ring = 1; ring <= rings; ring++) {
      for (let s = 0; s < 6; s++) {
        const a0 = s * TAU / 6, a1 = (s + 1) * TAU / 6;
        for (let k = 0; k < ring; k++) {
          const f = k / ring;
          const x = (Math.cos(a0) * (1 - f) + Math.cos(a1) * f) * ring * r;
          const y = (Math.sin(a0) * (1 - f) + Math.sin(a1) * f) * ring * r;
          pts.push([x, y]);
        }
      }
    }
    for (const [x, y] of pts) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke(); }
  }

  function drawTunnel(sctx, w, h, s, dt) {
    sctx.save();
    sctx.translate(w / 2, h / 2);
    sctx.globalCompositeOperation = 'lighter';

    // faint flower-of-life lattice, slowly turning
    if (art.lattice.on) {
      sctx.save();
      sctx.rotate(s * 0.02 * art.lattice.spin);
      sctx.strokeStyle = `hsla(${hue(s)}, 100%, 50%, ${0.035 * art.lattice.opacity})`;
      sctx.lineWidth = 1;
      flowerOfLife(sctx, (Math.max(w, h) / 14) * art.lattice.size, 6);
      sctx.restore();
    }

    // tunnel of nested hexagrams rushing toward you
    const T = art.tunnel;
    if (T.on) {
      tunnelPhase += dt * T.speed * (0.12 + (T.cpu ? state.cpuS * 0.5 : 0) + state.audio * 1.4);
      const N = 22, maxR = Math.hypot(w, h) * 0.62;
      for (let k = 0; k < N; k++) {
        const z = ((k + tunnelPhase * N) % N) / N; // 0 far .. 1 near
        const r = Math.pow(z, 2.4) * maxR;
        const a = Math.min(1, Math.sin(Math.PI * z) * 0.16 * T.opacity);
        if (r < 2) continue;
        const rot = k * 0.26 + s * 0.08;
        sctx.lineWidth = 0.6 + z * 1.6;
        sctx.strokeStyle = `hsla(${hue(s, k * 0.3)}, 100%, 55%, ${a})`;
        if (T.shape === 'original' || T.shape === 'hexagram') { polygon(sctx, 3, r, rot); polygon(sctx, 3, r, rot + Math.PI); }
        if (T.shape === 'original') {
          if (k % 2 === 0) { sctx.beginPath(); sctx.arc(0, 0, r * 0.98, 0, TAU); sctx.stroke(); }
          if (k % 3 === 0) polygon(sctx, 6, r * 1.15, -rot);
        } else if (T.shape === 'circles') { sctx.beginPath(); sctx.arc(0, 0, r, 0, TAU); sctx.stroke(); }
        else if (T.shape === 'squares') polygon(sctx, 4, r, rot);
        else if (T.shape === 'flower') { for (let p = 0; p < 6; p++) { const pa = rot + (p / 6) * TAU; sctx.beginPath(); sctx.arc(Math.cos(pa) * r * 0.5, Math.sin(pa) * r * 0.5, r * 0.5, 0, TAU); sctx.stroke(); } }
      }
    }
    sctx.restore();
  }

  function drawBackground(t) {
    if (state.level === 'off' || document.body.classList.contains('vj-mode')) return;
    const interval = (state.level === 'high' ? 40 : 80) * (focused ? 1 : 2);
    if (t - lastBg < interval) return;
    const dt = lastBg ? Math.min(0.25, (t - lastBg) / 1000) : 0.04;
    lastBg = t;
    if (sizeBg()) resetRain();
    const w = bg.width, h = bg.height;
    bctx.globalCompositeOperation = 'source-over';
    bctx.fillStyle = '#000400';
    bctx.fillRect(0, 0, w, h);
    if (art.rain.on) {
      stepRain(t);
      bctx.globalAlpha = Math.min(1, art.rain.opacity);
      bctx.drawImage(rainC, 0, 0);
      bctx.globalAlpha = 1;
    }
    if (state.level === 'high') {
      if (art.stars.on) drawStars(bctx, w, h, dt);
      if (art.spiral.on) drawSpiral(bctx, w, h, t / 1000, dt);
      drawTunnel(bctx, w, h, t / 1000, dt);
    }
    bctx.globalCompositeOperation = 'source-over';
    bctx.drawImage(overlay, 0, 0);
  }

  // ---------------- core mandala ----------------
  const mandala = document.getElementById('mandala');
  const mctx = mandala.getContext('2d');
  const metaPts = (d) => {
    const p = [[0, 0]];
    for (let i = 0; i < 6; i++) { const a = i * TAU / 6 - Math.PI / 2; p.push([Math.cos(a) * d, Math.sin(a) * d]); }
    for (let i = 0; i < 6; i++) { const a = i * TAU / 6 - Math.PI / 2; p.push([Math.cos(a) * d * 2, Math.sin(a) * d * 2]); }
    return p;
  };

  function arcRing(ctx, r, frac, label, s, color) {
    const start = -Math.PI / 2;
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,255,110,0.10)';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
    // ticks, batched into one path
    ctx.strokeStyle = 'rgba(0,255,110,0.18)';
    ctx.beginPath();
    for (let i = 0; i < 72; i++) {
      const a = i * TAU / 72 + s * 0.05;
      const l = i % 6 === 0 ? 5 : 2;
      ctx.moveTo(Math.cos(a) * (r - l), Math.sin(a) * (r - l)); ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.stroke();
    // glow = wide translucent stroke under a thin bright one (shadowBlur is far too costly per frame)
    ctx.beginPath(); ctx.arc(0, 0, r, start, start + frac * TAU);
    ctx.globalAlpha = 0.25; ctx.lineWidth = 9; ctx.strokeStyle = color; ctx.stroke();
    ctx.globalAlpha = 1; ctx.lineWidth = 3; ctx.stroke();
    // comet head
    const ha = start + frac * TAU;
    const hx = Math.cos(ha) * r, hy = Math.sin(ha) * r;
    ctx.fillStyle = '#eaffef';
    ctx.beginPath(); ctx.arc(hx, hy, 3.5, 0, TAU); ctx.fill();
    if (frac < 0.03) return; // near-zero tags would pile up at 12 o'clock; the legend still shows them
    // big value tag riding the comet head (the legend in the corner repeats it)
    ctx.font = `bold ${Math.round(13 * (state.dpr || 1))}px "Orbitron", "Share Tech Mono", monospace`;
    ctx.textAlign = hx >= 0 ? 'left' : 'right';
    const tx = hx + (hx >= 0 ? 9 : -9), ty = hy + (hy >= 0 ? 14 : -6);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillText(`${label} ${Math.round(frac * 100)}%`, tx + 1, ty + 1);
    ctx.fillStyle = color;
    ctx.fillText(`${label} ${Math.round(frac * 100)}%`, tx, ty);
  }

  function drawMandala(t) {
    const { w, h, dpr } = fit(mandala, 1); // 1:1 CSS pixels: the mandala is soft glow, extra density only costs GPU
    state.dpr = dpr;
    const s = t / 1000;
    const ctx = mctx;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    const R = Math.min(w * 0.36, h * 0.47);
    const cpu = state.cpuS;
    const breathe = 1 + Math.sin(s * 1.4) * 0.025 + cpu * 0.06;

    // seed-of-life halo behind everything
    ctx.save();
    ctx.rotate(-s * 0.05);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = `hsla(${hue(s)}, 100%, 55%, 0.08)`;
    ctx.lineWidth = 1 * dpr;
    flowerOfLife(ctx, R * 0.2 * breathe, 2);
    ctx.restore();

    // core petals
    const cores = state.coresS.length ? state.coresS : [0];
    const n = cores.length;
    const inner = R * 0.36 * breathe;
    ctx.save();
    ctx.rotate(s * 0.07);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const load = cores[i];
      const a = (i / n) * TAU;
      const len = R * (0.06 + 0.4 * load);
      const width = (TAU / n) * inner * 0.42;
      ctx.save();
      ctx.rotate(a);
      const g = ctx.createLinearGradient(inner, 0, inner + len, 0);
      const hh = hue(s, i * 0.4) + load * 30; // heavier cores lean lime
      g.addColorStop(0, `hsla(${hh}, 100%, 50%, ${0.15 + load * 0.35})`);
      g.addColorStop(1, `hsla(${hh}, 100%, 70%, ${0.05 + load * 0.6})`);
      ctx.fillStyle = g;
      ctx.strokeStyle = `hsla(${hh}, 100%, 65%, ${0.35 + load * 0.6})`;
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      ctx.moveTo(inner, 0);
      ctx.quadraticCurveTo(inner + len * 0.5, -width, inner + len, 0);
      ctx.quadraticCurveTo(inner + len * 0.5, width, inner, 0);
      ctx.fill(); ctx.stroke();
      // core index
      ctx.fillStyle = 'rgba(0,255,110,0.45)';
      ctx.font = `${8 * dpr}px "Share Tech Mono", monospace`;
      ctx.fillText(String(i), inner + R * 0.5, 3 * dpr);
      ctx.restore();
    }
    ctx.restore();

    // metatron's cube, scaled with load
    ctx.save();
    ctx.rotate(-s * 0.12);
    const d = R * 0.14 * breathe;
    const pts = metaPts(d);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 0.8 * dpr;
    ctx.strokeStyle = `hsla(${hue(s, 2)}, 100%, 60%, ${0.12 + cpu * 0.25})`;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) { ctx.moveTo(...pts[i]); ctx.lineTo(...pts[j]); }
    ctx.stroke();
    ctx.strokeStyle = `hsla(${hue(s, 2)}, 100%, 60%, 0.25)`;
    for (const p of pts) { ctx.beginPath(); ctx.arc(p[0], p[1], d / 2, 0, TAU); ctx.stroke(); }
    ctx.restore();

    // interlocking yantra triangles
    ctx.save();
    ctx.rotate(s * 0.2);
    ctx.lineWidth = 1.2 * dpr;
    ctx.strokeStyle = `rgba(198,255,0,${0.18 + cpu * 0.3})`;
    polygon(ctx, 3, R * 0.3, -Math.PI / 2);
    polygon(ctx, 3, R * 0.3, Math.PI / 2);
    ctx.restore();

    // outer rings: memory, gpu, disk
    ctx.save();
    ctx.scale(dpr > 1 ? 1 : 1, 1);
    arcRing(ctx, R * 0.86, state.memS, 'MEM', s, '#00ff6e');
    arcRing(ctx, R * 0.93, state.gpuS, 'GPU', s, '#1de9b6');
    arcRing(ctx, R * 1.0, state.diskS, 'DISK', s, '#c6ff00');
    ctx.restore();

    // orbiting entities: top processes on an elliptical orbit
    const ents = state.entities;
    const rx = Math.min(w * 0.46, R * 1.45), ry = R * 1.04;
    ctx.strokeStyle = 'rgba(0,255,110,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, TAU); ctx.stroke();
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      const a = s * 0.09 + (i / ents.length) * TAU;
      const x = Math.cos(a) * rx, y = Math.sin(a) * ry;
      const size = (3 + Math.min(1, e.cpu / 25) * 7) * dpr;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(s * 0.8 + i);
      ctx.strokeStyle = 'rgba(0,255,110,0.35)'; // cheap glow: wide faint stroke under a thin bright one
      ctx.lineWidth = 4 * dpr;
      polygon(ctx, 3, size, 0); polygon(ctx, 3, size, Math.PI);
      ctx.strokeStyle = '#9dffb8';
      ctx.lineWidth = 1.2 * dpr;
      polygon(ctx, 3, size, 0); polygon(ctx, 3, size, Math.PI);
      ctx.restore();
      ctx.fillStyle = 'rgba(200,255,215,0.85)';
      ctx.font = `${10 * dpr}px "Share Tech Mono", monospace`;
      ctx.textAlign = x >= 0 ? 'left' : 'right';
      const label = `${e.name.slice(0, 18)} ${e.cpu.toFixed(1)}%`;
      ctx.fillText(label, x + (x >= 0 ? size + 6 : -size - 6), y + 3 * dpr);
      // tether to center
      ctx.strokeStyle = 'rgba(0,255,110,0.05)';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(x, y); ctx.stroke();
    }
    ctx.restore();
  }

  // ---------------- orb rings ----------------
  const orbCanvases = {
    mic: document.querySelector('#orb-mic .orb-canvas'),
    cam: document.querySelector('#orb-cam .orb-canvas'),
  };
  function drawOrb(kind, t) {
    const c = orbCanvases[kind];
    if (!c) return;
    const { w, h, dpr } = fit(c, 1.25);
    const ctx = c.getContext('2d');
    const s = t / 1000;
    const on = state.orbs[kind];
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    const R = Math.min(w, h) * 0.36;
    const col = on === false ? [350, 100, 58] : on === true ? [hue(s), 100, 55] : [140, 30, 40];
    const pulse = on === true ? 1 + Math.sin(s * 3) * 0.04 : 1;
    ctx.globalCompositeOperation = 'lighter';
    // core glow
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 1.2);
    g.addColorStop(0, `hsla(${col[0]},${col[1]}%,${col[2]}%,${on === true ? 0.28 : 0.14})`);
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, R * 1.25, 0, TAU); ctx.fill();
    // seed of life petals
    ctx.save();
    ctx.rotate((on === true ? s * 0.6 : s * 0.1) * (kind === 'cam' ? -1 : 1));
    ctx.strokeStyle = `hsla(${col[0]},${col[1]}%,${col[2]}%,0.55)`;
    ctx.lineWidth = 1 * dpr;
    const rr = R * 0.5 * pulse;
    for (let i = 0; i < 6; i++) {
      const a = i * TAU / 6;
      ctx.beginPath(); ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, rr, 0, TAU); ctx.stroke();
    }
    ctx.restore();
    // outer dashed ring
    ctx.save();
    ctx.rotate(-s * (on === true ? 0.9 : 0.15));
    ctx.setLineDash([4 * dpr, 6 * dpr]);
    ctx.strokeStyle = `hsla(${col[0]},${col[1]}%,${col[2] + 10}%,0.8)`;
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath(); ctx.arc(0, 0, R * 1.08 * pulse, 0, TAU); ctx.stroke();
    ctx.restore();
    // solid ring with layered-stroke glow
    ctx.beginPath(); ctx.arc(0, 0, R * 0.98, 0, TAU);
    ctx.strokeStyle = `hsla(${col[0]},${col[1]}%,${col[2]}%,0.15)`;
    ctx.lineWidth = 12 * dpr; ctx.stroke();
    ctx.lineWidth = 6 * dpr; ctx.stroke();
    ctx.strokeStyle = `hsla(${col[0]},${col[1]}%,${col[2]}%,0.9)`;
    ctx.lineWidth = 2 * dpr; ctx.stroke();
    ctx.restore();
  }

  // ---------------- sealed views: rotating sri-yantra-ish sigil ----------------
  function drawSealed(t) {
    const c = state.sealedActive;
    if (!c) return;
    const { w, h, dpr } = fit(c, 1.5);
    const ctx = c.getContext('2d');
    const s = t / 1000;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.globalCompositeOperation = 'lighter';
    const R = Math.min(w, h) * 0.42;
    for (let i = 0; i < 9; i++) {
      const f = 1 - i / 9;
      ctx.strokeStyle = `hsla(${hue(s, i)}, 100%, 55%, ${0.08 + 0.05 * Math.sin(s + i)})`;
      ctx.lineWidth = 1.2 * dpr;
      polygon(ctx, 3, R * f, (i % 2 ? Math.PI / 2 : -Math.PI / 2) + Math.sin(s * 0.3 + i) * 0.15);
    }
    ctx.rotate(s * 0.05);
    for (let k = 0; k < 16; k++) {
      ctx.save(); ctx.rotate(k * TAU / 16);
      ctx.strokeStyle = 'rgba(0,255,110,0.1)';
      ctx.beginPath(); ctx.ellipse(R * 0.62, 0, R * 0.38, R * 0.1, 0, 0, TAU); ctx.stroke();
      ctx.restore();
    }
    ctx.strokeStyle = 'rgba(0,255,110,0.18)';
    ctx.beginPath(); ctx.arc(0, 0, R * 1.03, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, R * 1.08, 0, TAU); ctx.stroke();
    ctx.restore();
  }

  // ---------------- radar mode: network packet rings + disk gears ----------------
  const packets = [];
  let gearA = 0, gearB = 0;
  // bytes/s -> 0..1 on a log scale (1 KB/s .. 100 MB/s)
  const logRate = (b) => Math.max(0, Math.min(1, (Math.log10(Math.max(1, b)) - 3) / 5));

  function drawNetRadar(c, s, dt) {
    const { w, h, dpr } = fit(c, 1.5);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, R = Math.min(h * 0.48, w * 0.3);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = 'rgba(0,255,110,0.18)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) { ctx.beginPath(); ctx.arc(0, 0, (R * i) / 3, 0, TAU); ctx.stroke(); }
    // sweep
    const sa = s * 1.6;
    const sweep = ctx.createLinearGradient(0, 0, Math.cos(sa) * R, Math.sin(sa) * R);
    sweep.addColorStop(0, 'rgba(0,255,110,0.0)'); sweep.addColorStop(1, 'rgba(0,255,110,0.5)');
    ctx.strokeStyle = sweep; ctx.lineWidth = 2 * dpr;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(sa) * R, Math.sin(sa) * R); ctx.stroke();
    // spawn packets proportional to throughput
    const inRate = logRate(state.io.rx), outRate = logRate(state.io.tx);
    if (Math.random() < inRate * 1.4) packets.push({ a: Math.random() * TAU, r: R * 1.05, v: -R * (0.6 + inRate), out: false });
    if (Math.random() < outRate * 1.4) packets.push({ a: Math.random() * TAU, r: 2, v: R * (0.6 + outRate), out: true });
    for (let i = packets.length - 1; i >= 0; i--) {
      const p = packets[i];
      p.r += p.v * dt;
      if (p.r < 1 || p.r > R * 1.1) { packets.splice(i, 1); continue; }
      const x = Math.cos(p.a) * p.r, y = Math.sin(p.a) * p.r;
      ctx.fillStyle = p.out ? 'rgba(29,233,182,0.9)' : 'rgba(157,255,184,0.95)';
      ctx.beginPath(); ctx.arc(x, y, 1.8 * dpr, 0, TAU); ctx.fill();
      ctx.strokeStyle = p.out ? 'rgba(29,233,182,0.25)' : 'rgba(0,255,110,0.25)';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - Math.cos(p.a) * p.v * 0.06, y - Math.sin(p.a) * p.v * 0.06); ctx.stroke();
    }
    ctx.restore();
    ctx.font = `${9 * dpr}px "Share Tech Mono", monospace`;
    ctx.fillStyle = 'rgba(157,255,184,0.8)'; ctx.textAlign = 'left'; ctx.fillText('▼ IN', 4 * dpr, h - 4 * dpr);
    ctx.fillStyle = 'rgba(29,233,182,0.8)'; ctx.textAlign = 'right'; ctx.fillText('OUT ▲', w - 4 * dpr, h - 4 * dpr);
  }

  function gear(ctx, r, teeth, rot, color) {
    ctx.save();
    ctx.rotate(rot);
    ctx.beginPath();
    for (let i = 0; i < teeth; i++) {
      const a0 = (i / teeth) * TAU, a1 = ((i + 0.25) / teeth) * TAU, a2 = ((i + 0.5) / teeth) * TAU, a3 = ((i + 0.75) / teeth) * TAU;
      ctx.lineTo(Math.cos(a0) * r * 0.8, Math.sin(a0) * r * 0.8);
      ctx.lineTo(Math.cos(a1) * r, Math.sin(a1) * r);
      ctx.lineTo(Math.cos(a2) * r, Math.sin(a2) * r);
      ctx.lineTo(Math.cos(a3) * r * 0.8, Math.sin(a3) * r * 0.8);
    }
    ctx.closePath();
    ctx.strokeStyle = color; ctx.globalAlpha = 0.25; ctx.lineWidth = 5; ctx.stroke();
    ctx.globalAlpha = 1; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, r * 0.35, 0, TAU); ctx.stroke();
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 0.35, Math.sin(a) * r * 0.35); ctx.lineTo(Math.cos(a) * r * 0.75, Math.sin(a) * r * 0.75); ctx.stroke(); }
    ctx.restore();
  }

  function drawDiskGears(c, dt) {
    const { w, h, dpr } = fit(c, 1.5);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    const r = Math.min(h * 0.44, w * 0.2);
    gearA += dt * (0.15 + logRate(state.io.read) * 9);
    gearB -= dt * (0.15 + logRate(state.io.write) * 9);
    ctx.save(); ctx.translate(w * 0.5 - r * 0.95, h / 2); gear(ctx, r, 12, gearA, '#00ff6e'); ctx.restore();
    ctx.save(); ctx.translate(w * 0.5 + r * 0.95, h / 2); gear(ctx, r * 0.82, 10, gearB + 0.3, '#c6ff00'); ctx.restore();
    ctx.font = `${9 * dpr}px "Share Tech Mono", monospace`;
    ctx.fillStyle = 'rgba(157,255,184,0.8)'; ctx.textAlign = 'left'; ctx.fillText('READ', 4 * dpr, h - 4 * dpr);
    ctx.fillStyle = 'rgba(198,255,0,0.8)'; ctx.textAlign = 'right'; ctx.fillText('WRITE', w - 4 * dpr, h - 4 * dpr);
  }

  // ---------------- RAM vacuum implosion ----------------
  let vacParts = [];
  function drawVacuum(ctx, w, h, dt) {
    if (!vacParts.length) return;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = vacParts.length - 1; i >= 0; i--) {
      const p = vacParts[i];
      p.r *= Math.pow(0.12, dt); // spiral inward fast
      p.a += dt * (3 + 40 / Math.max(8, p.r));
      if (p.r < 4) { vacParts.splice(i, 1); continue; }
      const x = Math.cos(p.a) * p.r, y = Math.sin(p.a) * p.r;
      ctx.fillStyle = `rgba(157,255,184,${Math.min(1, p.r / 80)})`;
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.restore();
  }

  // ---------------- main loop ----------------
  const lerp = (a, b, k) => a + (b - a) * k;
  let lastFrameT = 0;
  let lastFg = 0;
  function frame(t) {
    requestAnimationFrame(frame);
    if (state.lite) return; // lite mode: the mandala, orbs, sigils and background all hold still
    if (document.body.classList.contains('booting')) return; // the intro covers the screen: give it the whole frame
    if (t - lastFg < (focused ? 41 : 83)) return; // ~24fps (12 unfocused); plenty for slow sacred motion
    lastFg = t;
    const k = 0.11;
    state.cpuS = lerp(state.cpuS, state.cpu, k);
    state.memS = lerp(state.memS, state.mem, k);
    state.gpuS = lerp(state.gpuS, state.gpu, k);
    state.diskS = lerp(state.diskS, state.disk, k);
    state.coresS = state.cores.map((v, i) => lerp(state.coresS[i] || 0, v, k));
    const dt = lastFrameT ? Math.min(0.2, (t - lastFrameT) / 1000) : 0.04;
    lastFrameT = t;
    drawBackground(t);
    if (document.getElementById('view-nexus').classList.contains('active')) {
      drawMandala(t);
      drawVacuum(mctx, mandala.width, mandala.height, dt);
      drawOrb('mic', t);
      drawOrb('cam', t);
      if (state.radar) { drawNetRadar(state.radar.net, t / 1000, dt); drawDiskGears(state.radar.disk, dt); }
    }
    drawSealed(t);
    spinChrome(t / 1000);
  }

  // Chrome motion (sigils) rides the same 30fps tick instead of 60fps CSS animations.
  const brandSigil = document.querySelector('.brand-sigil');
  const miniSigil = document.querySelector('.mini-sigil');
  function spinChrome(s) {
    brandSigil.style.transform = `rotate(${(s * 15) % 360}deg)`;
    const navSvg = document.querySelector('.nav.active svg');
    if (navSvg) navSvg.style.transform = `rotate(${(s * 25) % 360}deg)`;
    const b = (Math.sin(s * 1.25) + 1) / 2; // 0..1 breathing
    miniSigil.style.transform = `rotate(${45 + b * 180}deg) scale(${1 - b * 0.18})`;
  }
  document.querySelectorAll('.nav').forEach((n) => n.addEventListener('click', () => {
    document.querySelectorAll('.nav svg').forEach((svg) => { svg.style.transform = ''; });
  }));

  // Occasional glitch / flicker bursts.
  function burst(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth; // restart the animation
    el.classList.add(cls);
  }
  setInterval(() => {
    if (state.lite) return;
    document.querySelectorAll('.view.active .glitch, .titlebar .glitch').forEach((g) => burst(g, 'glitching'));
  }, 3700);

  window.addEventListener('resize', resetRain);
  document.fonts.ready.then(resetRain);
  resetRain();
  requestAnimationFrame(frame);

  // deep merge of the saved settings over ORIGINAL, so new options appear with their original values
  function mergeArt(saved) {
    const out = JSON.parse(JSON.stringify(ART_ORIGINAL));
    for (const [k, v] of Object.entries(saved || {})) {
      if (v && typeof v === 'object' && out[k] && typeof out[k] === 'object') Object.assign(out[k], v);
      else if (k in out) out[k] = v;
    }
    return out;
  }
  window.FX = {
    ART_ORIGINAL,
    art: () => art,
    setArt(saved) {
      const next = mergeArt(saved);
      const reRain = next.rain.size !== art.rain.size || next.rain.style !== art.rain.style;
      const reOverlay = JSON.stringify([next.scan, next.vignette]) !== JSON.stringify([art.scan, art.vignette]);
      art = next;
      if (reRain || reOverlay) resetRain(true);
    },
    setLevel(l) { state.level = l; if (l !== 'off') resetRain(); },
    setLite(on) { state.lite = on; },
    setPerf({ cpu, cores, mem, gpu, disk }) {
      state.cpu = cpu; state.cores = cores; state.mem = mem; state.gpu = gpu; state.disk = disk;
    },
    setEntities(list) { state.entities = list; },
    setOrb(kind, on) { state.orbs[kind] = on; },
    setSealed(canvas) { state.sealedActive = canvas; },
    setRadar(canvases) { state.radar = canvases; },
    setIo(io) { state.io = io; },
    setAudio(bass) { state.audio = bass; },
    setAlarm(on) { state.alarm = on; },
    vacuum() {
      const R = Math.max(mandala.width, mandala.height) * 0.6;
      for (let i = 0; i < 420; i++) vacParts.push({ a: Math.random() * TAU, r: R * (0.5 + Math.random() * 0.6) });
    },
  };
})();
