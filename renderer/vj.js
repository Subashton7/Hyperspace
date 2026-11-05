// VJ: audio-reactive sacred geometry. 2D canvas draws the geometry, WebGL adds feedback trails,
// kaleidoscope, chromatic aberration, glow and glitch. Audio bands come from HyperCore's WASAPI FFT.
(() => {
  const OUT = document.body.classList.contains('vj-out'); // fullscreen output window: no controls
  // hidden Spout renderer: fixed resolution, timer-driven (hidden windows get no rAF), frames streamed to the sender
  const QS = new URLSearchParams(location.search);
  const SPOUT = OUT && QS.get('mode') === 'spout';
  const SPOUT_W = +QS.get('w') || 1920, SPOUT_H = +QS.get('h') || 1080, SPOUT_FPS = +QS.get('fps') || 60;
  // live wallpaper: a desktop-sized output window parked under the desktop icons, paused when covered
  const WALL = OUT && QS.get('mode') === 'wallpaper';
  const WALL_FPS = +QS.get('fps') || 30, WALL_Q = QS.get('q');
  let wallPaused = false;
  const TAU = Math.PI * 2;
  const DEFAULTS = {
    theme: 'flower', auto: false, autoBeats: 32, autoMode: 'seq',
    source: 'default', sensitivity: 1, bass: 1, mid: 1, treble: 1,
    speed: 1, complexity: 3, zoom: 0.35, trails: 0.86, dir: 'cw', punch: 1,
    glow: 0.8, chroma: 0.25, kaleido: 0, mirror: 0, hue: 0, flash: true, strobe: false,
    palette: 'matrix', fold: 8, tilt: 0.3, lineW: 1, scale: 1,
    layer2: 'none', layer2Mix: 0.5, layer2Scale: 0.6, backdrop: 'none',
    stack: [], stackMix: 0.8, // shift-clicked themes drawn in the centre with the main one

    img: 'none', imgMode: 'center', imgSize: 0.6, imgMix: 0.85, imgPulse: 1, imgSpin: 0, imgTint: false,
    cpuSpin: true, cpuSpinAmt: 0.6, cpuComplex: false, gpuGlow: true, gpuGlitch: true, gpuAmt: 0.6,
    reactUi: false,
    // loop production: structure (build/drop), camera + glitch + bloom punch, loop clock for recording
    structure: 'audio', clockBpm: 128, loopBars: 8, shake: 0.45, zoomPunch: 0.55, datamosh: 0.4, bloom: 0.5, kaleidoFx: false,
    quality: 'balanced', fps: 60,
  };
  // Render resolution vs the screen. Bloom, trails and feedback blur hide the upscale, and the
  // integrated GPU pays per pixel: BALANCED costs ~40% of ULTRA.
  const QUALITY = { eco: 0.45, balanced: 0.65, ultra: 1 };
  const CATS = { LOOP: 'LOOP PRODUCTION', SIGNATURE: 'SIGNATURE', SACRED: 'SACRED GEOMETRY', YANTRA: 'YANTRAS', HYPER: 'HYPERDIMENSIONAL', COSMIC: 'COSMIC', AUDIO: 'AUDIO-REACTIVE' };
  // colour worlds: base hue + drift, or a full cycle; sat 0 = white light
  const PALETTES = {
    matrix: { label: 'MATRIX', base: 140, spread: 14 }, acid: { label: 'ACID', base: 82, spread: 22 },
    aqua: { label: 'AQUA', base: 172, spread: 18 }, ultraviolet: { label: 'ULTRAVIOLET', base: 278, spread: 22 },
    inferno: { label: 'INFERNO', base: 14, spread: 20 }, gold: { label: 'GOLD', base: 44, spread: 9 },
    neon: { label: 'CYAN · PINK · PURPLE', tri: [186, 322, 272] }, duo: { label: 'GREEN × MAGENTA', duo: [140, 305] }, subashton: { label: 'SUBASHTON', duo: [180, 325] },
    spectrum: { label: 'DMT SPECTRUM', cycle: true },
    mono: { label: 'WHITE LIGHT', base: 140, spread: 0, sat: 0 },
  };
  let S = { ...DEFAULTS };

  const stage = OUT ? document.body : document.getElementById('vj-stage');
  const glCanvas = document.getElementById('vj-canvas');
  const geo = document.createElement('canvas');
  const g2 = geo.getContext('2d');

  // ---------------- audio + hardware inputs ----------------
  const A = { bass: 0, mid: 0, treble: 0, level: 0, beat: 0, spec: new Array(48).fill(0), beats: 0, last: 0, silent: true };
  hs.on('audio', (d) => {
    if (S.structure === 'clock') return; // the loop clock plays its own drums
    const k = S.sensitivity;
    A.bass = Math.min(1.5, d.b[0] * k * S.bass);
    A.mid = Math.min(1.5, d.b[1] * k * S.mid);
    A.treble = Math.min(1.5, d.b[2] * k * S.treble);
    A.level = d.b[3] * k;
    A.spec = d.s;
    A.silent = d.silent;
    A.last = performance.now();
    if (d.beat) {
      A.beat = 1; A.beats++;
      // only the main window advances themes; outputs and popped-out windows follow its config
      if (S.auto && !OUT && !(window.HS && HS.solo) && A.beats % Math.max(4, S.autoBeats) === 0) nextTheme();
      const dot = document.getElementById('vj-beat');
      if (dot) { dot.classList.add('on'); setTimeout(() => dot.classList.remove('on'), 90); }
    }
    if (window.FX?.setAudio) window.FX.setAudio(S.reactUi ? A.bass : 0);
  });
  const HW = { cpu: 0, heat: 0 };
  hs.on('telemetry', (t) => {
    if (t.cpu?.util != null) HW.cpu = t.cpu.util / 100;
    if (t.gpuTemp != null) HW.heat = Math.max(0, Math.min(1, (t.gpuTemp - 45) / 45));
  });

  // ---------------- geometry themes ----------------
  const H = (t, off = 0) => {
    const p = PALETTES[S.palette] || PALETTES.matrix;
    if (p.cycle) return (t * 24 + off * 47 + S.hue + 3600) % 360;
    if (p.tri) return p.tri[Math.abs(Math.round(off)) % 3] + S.hue + Math.sin(t * 0.3 + off) * 6;
    if (p.duo) return p.duo[Math.abs(Math.round(off)) % 2] + S.hue + Math.sin(t * 0.2 + off) * 8;
    return p.base + S.hue + Math.sin(t * 0.2 + off) * p.spread;
  };
  const sat = () => (PALETTES[S.palette]?.sat ?? 100);
  const stroke = (ctx, hue, light, alpha, width) => { ctx.strokeStyle = `hsla(${hue},${sat()}%,${light}%,${alpha})`; ctx.lineWidth = width * S.lineW; };
  function circle(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, Math.max(0.5, r), 0, TAU); ctx.stroke(); }
  function poly(ctx, n, r, rot, cx = 0, cy = 0) {
    ctx.beginPath();
    for (let i = 0; i <= n; i++) { const a = rot + (i / n) * TAU; const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
  }

  const themes = {
    flower(ctx, R, f) {
      const rings = Math.max(1, Math.min(5, Math.round(f.complexity)));
      const r = (R / (rings + 1)) * (1 + f.bass * 0.18);
      ctx.rotate(f.rot);
      const pts = [[0, 0, 0]];
      for (let ring = 1; ring <= rings; ring++)
        for (let s = 0; s < 6; s++)
          for (let k = 0; k < ring; k++) {
            const a0 = (s * TAU) / 6, a1 = ((s + 1) * TAU) / 6, q = k / ring;
            pts.push([(Math.cos(a0) * (1 - q) + Math.cos(a1) * q) * ring * r, (Math.sin(a0) * (1 - q) + Math.sin(a1) * q) * ring * r, ring]);
          }
      for (const [x, y, ring] of pts) {
        const wob = 1 + Math.sin(f.t * 2 + ring * 1.3) * f.mid * 0.08;
        stroke(ctx, H(f.t, ring), 55 + f.treble * 20, 0.55 - ring * 0.05 + f.beat * 0.3, 1.4 + f.bass * 2);
        circle(ctx, x, y, r * wob);
      }
      stroke(ctx, H(f.t), 70, 0.8, 2 + f.bass * 3);
      circle(ctx, 0, 0, r * (rings + 1) * (1 + f.beat * 0.04));
      circle(ctx, 0, 0, r * (rings + 1.15));
      // sparkle on intersections with treble
      ctx.fillStyle = `hsla(${H(f.t, 2)},100%,85%,${Math.min(1, f.treble)})`;
      for (const [x, y] of pts) if (Math.random() < f.treble * 0.5) { ctx.beginPath(); ctx.arc(x + r, y, 2.2, 0, TAU); ctx.fill(); }
    },

    sriyantra(ctx, R, f) {
      const s = R * 0.92;
      ctx.rotate(f.rot * 0.25);
      // bhupura: square with gates
      stroke(ctx, H(f.t, 1), 55, 0.5, 2);
      const b = s * 1.05, gw = s * 0.18;
      ctx.beginPath();
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const px = -dy, py = dx; // perpendicular
        ctx.moveTo(b * dx + b * px, b * dy + b * py);
        ctx.lineTo(b * dx + gw * px, b * dy + gw * py);
        ctx.lineTo((b + gw * 0.6) * dx + gw * px, (b + gw * 0.6) * dy + gw * py);
        ctx.moveTo(b * dx - b * px, b * dy - b * py);
        ctx.lineTo(b * dx - gw * px, b * dy - gw * py);
        ctx.lineTo((b + gw * 0.6) * dx - gw * px, (b + gw * 0.6) * dy - gw * py);
      }
      ctx.stroke();
      // lotus rings
      for (const [n, rr, dir] of [[16, s * 0.86, 1], [8, s * 0.7, -1]]) {
        stroke(ctx, H(f.t, n), 60, 0.55 + f.mid * 0.3, 1.5);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + f.rot * dir * 0.6;
          ctx.save(); ctx.rotate(a);
          ctx.beginPath();
          ctx.moveTo(rr * 0.8, 0);
          ctx.quadraticCurveTo(rr * 0.95, rr * 0.16 * (1 + f.mid * 0.3), rr * 1.08, 0);
          ctx.quadraticCurveTo(rr * 0.95, -rr * 0.16 * (1 + f.mid * 0.3), rr * 0.8, 0);
          ctx.stroke(); ctx.restore();
        }
        circle(ctx, 0, 0, rr * 0.8);
      }
      // nine interlocking triangles (4 up = Shiva, 5 down = Shakti)
      const tri = (scale, yOff, up, i) => {
        const r = s * 0.62 * scale * (1 + Math.sin(f.t * 1.5 + i) * f.bass * 0.06);
        const rot = up ? -Math.PI / 2 : Math.PI / 2;
        stroke(ctx, H(f.t, i * 0.7), 60 + f.treble * 25, 0.75, 1.6 + f.bass * 2);
        poly(ctx, 3, r, rot, 0, yOff * s * 0.62);
      };
      [[1, 0.1], [0.78, 0.05], [0.56, -0.02], [0.36, -0.08]].forEach(([sc, y], i) => tri(sc, y, true, i));
      [[0.95, -0.12], [0.74, -0.06], [0.54, 0.02], [0.36, 0.08], [0.2, 0.06]].forEach(([sc, y], i) => tri(sc, y, false, i + 4));
      // bindu
      ctx.fillStyle = `hsla(${H(f.t)},100%,${70 + f.beat * 30}%,1)`;
      ctx.beginPath(); ctx.arc(0, 0, 3 + f.beat * 10 + f.bass * 4, 0, TAU); ctx.fill();
    },

    tesseract(ctx, R, f) {
      const verts = [];
      for (let i = 0; i < 16; i++) verts.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1, i & 8 ? 1 : -1]);
      const edges = [];
      for (let i = 0; i < 16; i++) for (let b = 0; b < 4; b++) { const j = i ^ (1 << b); if (j > i) edges.push([i, j]); }
      const a1 = f.rot * 1.0, a2 = f.rot * 0.7, a3 = f.rot * 0.45, a4 = f.t * 0.15;
      const rot = (p, i, j, a) => { const c = Math.cos(a), s = Math.sin(a), x = p[i], y = p[j]; p[i] = x * c - y * s; p[j] = x * s + y * c; };
      const copies = Math.max(1, Math.min(3, Math.round(f.complexity / 2)));
      for (let k = 0; k < copies; k++) {
        const scale = R * 0.42 * (1 + f.bass * 0.25) * (1 - k * 0.28);
        const proj = verts.map((v) => {
          const p = [...v];
          rot(p, 0, 3, a1 + k * 0.4); rot(p, 1, 3, a2); rot(p, 2, 3, a3); rot(p, 0, 1, a4);
          const w = 1 / (2.6 - p[3]); // 4D -> 3D
          const x = p[0] * w, y = p[1] * w, z = p[2] * w;
          const q = 1 / (2.2 - z); // 3D -> 2D
          return [x * q * scale * 2.2, y * q * scale * 2.2, p[3]];
        });
        for (const [i, j] of edges) {
          const inner = proj[i][2] > 0 && proj[j][2] > 0;
          stroke(ctx, H(f.t, k + (inner ? 1 : 0)), inner ? 72 : 55, inner ? 0.9 : 0.6, (inner ? 2 : 1.3) + f.bass * 2);
          ctx.beginPath(); ctx.moveTo(proj[i][0], proj[i][1]); ctx.lineTo(proj[j][0], proj[j][1]); ctx.stroke();
        }
        ctx.fillStyle = `hsla(${H(f.t, 3)},100%,85%,${0.5 + f.treble * 0.5})`;
        for (const p of proj) { ctx.beginPath(); ctx.arc(p[0], p[1], 2 + f.treble * 4, 0, TAU); ctx.fill(); }
      }
    },

    metatron(ctx, R, f) {
      const layers = Math.max(1, Math.min(3, Math.round(f.complexity / 2)));
      for (let L = 0; L < layers; L++) {
        ctx.save();
        ctx.rotate(f.rot * (L % 2 ? -1 : 1) * (1 + L * 0.3));
        const d = R * 0.3 * (1 - L * 0.3) * (1 + f.bass * 0.15);
        const pts = [[0, 0]];
        for (let i = 0; i < 6; i++) { const a = (i * TAU) / 6 - Math.PI / 2; pts.push([Math.cos(a) * d, Math.sin(a) * d]); }
        for (let i = 0; i < 6; i++) { const a = (i * TAU) / 6 - Math.PI / 2; pts.push([Math.cos(a) * d * 2, Math.sin(a) * d * 2]); }
        stroke(ctx, H(f.t, L), 60, 0.25 + f.treble * 0.5, 1 + f.treble);
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) { ctx.moveTo(...pts[i]); ctx.lineTo(...pts[j]); }
        ctx.stroke();
        stroke(ctx, H(f.t, L + 2), 65, 0.7 + f.beat * 0.3, 1.6 + f.bass * 2);
        for (const [x, y] of pts) circle(ctx, x, y, (d / 2) * (1 + f.mid * 0.1));
        ctx.restore();
      }
    },

    merkaba(ctx, R, f) {
      const s = R * 0.5 * (1 + f.bass * 0.3);
      const cube = [[1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1], [-1, -1, -1], [1, 1, -1], [1, -1, 1], [-1, 1, 1]];
      const project = (p, spin) => {
        let [x, y, z] = p;
        const cy = Math.cos(spin), sy = Math.sin(spin);
        [x, z] = [x * cy - z * sy, x * sy + z * cy];
        const tilt = 0.5 + Math.sin(f.t * 0.3) * 0.2, cx = Math.cos(tilt), sx = Math.sin(tilt);
        [y, z] = [y * cx - z * sx, y * sx + z * cx];
        const q = 3 / (4 - z);
        return [x * q * s, y * q * s];
      };
      const tet = (idx, spin, off) => {
        const P = idx.map((i) => project(cube[i], spin));
        stroke(ctx, H(f.t, off), 65 + f.treble * 20, 0.85, 1.8 + f.bass * 2.5);
        ctx.beginPath();
        for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) { ctx.moveTo(...P[i]); ctx.lineTo(...P[j]); }
        ctx.stroke();
      };
      tet([0, 1, 2, 3], f.rot, 0);
      tet([4, 5, 6, 7], -f.rot, 2);
      // energy field
      stroke(ctx, H(f.t, 4), 55, 0.35 + f.mid * 0.3, 1.2);
      for (let i = 1; i <= Math.round(f.complexity); i++) {
        ctx.beginPath(); ctx.ellipse(0, 0, s * 2 * (1 + f.beat * 0.05), s * 2 * Math.abs(Math.cos(f.t * 0.4 + i)) + 2, (i * Math.PI) / f.complexity, 0, TAU); ctx.stroke();
      }
      circle(ctx, 0, 0, s * 2.05);
    },

    mandala(ctx, R, f) {
      const n = 4 + Math.round(f.complexity) * 2;
      const spec = f.spec;
      ctx.rotate(f.rot * 0.5);
      for (let k = 0; k < n; k++) {
        ctx.save();
        ctx.rotate((k / n) * TAU);
        if (k % 2) ctx.scale(1, -1);
        ctx.beginPath();
        for (let i = 0; i < spec.length; i++) {
          const a = (i / spec.length) * (TAU / n) * 0.5;
          const r = R * 0.18 + (spec[i] / 255) * R * 0.75;
          const x = Math.cos(a) * r, y = Math.sin(a) * r;
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        stroke(ctx, H(f.t, k * 0.2), 60 + f.treble * 25, 0.8, 1.6 + f.bass * 2);
        ctx.stroke();
        ctx.restore();
      }
      stroke(ctx, H(f.t), 70, 0.8, 2);
      circle(ctx, 0, 0, R * 0.16 * (1 + f.bass * 0.6));
      poly(ctx, 6, R * 0.1 * (1 + f.beat * 0.5), f.rot * 2);
    },
  };
  // every theme: name, category, draw (the pack in vj-themes.js adds the rest)
  const THEMES = {
    flower: { name: 'FLOWER OF LIFE', cat: 'SACRED', draw: themes.flower },
    metatron: { name: "METATRON'S CUBE", cat: 'SACRED', draw: themes.metatron },
    sriyantra: { name: 'SRI YANTRA', cat: 'YANTRA', draw: themes.sriyantra },
    tesseract: { name: 'TESSERACT', cat: 'HYPER', draw: themes.tesseract },
    merkaba: { name: 'MERKABA', cat: 'HYPER', draw: themes.merkaba },
    mandala: { name: 'SPECTRUM MANDALA', cat: 'AUDIO', draw: themes.mandala },
    ...(window.VJ_EXTRA ? window.VJ_EXTRA({ TAU, H, stroke, circle, poly }) : {}),
  };
  const themeName = (k) => THEMES[k]?.name || String(k).toUpperCase();

  // ---------------- pictures: your own images mixed into the visuals ----------------
  // '@logo' is the SUBASHTON artwork shipped with the app; everything else lives in the vj-images folder
  const IMGS = new Map();
  let imgList = [], imgRot = 0, imgBeat = 0, imgTintCanvas = null;
  const imgUrl = (n) => (n === '@logo' ? 'hsmedia://asset/subashton-logo.jpg' : `hsmedia://vjimg/${encodeURIComponent(n)}`);
  function imgGet(name) {
    let im = IMGS.get(name);
    if (!im) { im = new Image(); im.crossOrigin = 'anonymous'; im.src = imgUrl(name); IMGS.set(name, im); } // CORS-clean for WebGL
    return im.complete && im.naturalWidth ? im : null;
  }
  function loadImgList() { hs.call('vjImages').then((l) => { imgList = ['@logo', ...l.map((x) => x.name)]; if (!OUT) renderImgs(); }).catch(() => {}); }
  hs.on('vjimages', loadImgList);
  loadImgList();
  function drawPicture(ctx, w, h, R, dt) {
    let name = S.img;
    if (name === 'none') return;
    if (S.imgMode === 'beat') { // slideshow: a new picture every 8 beats
      const pool = imgList.length ? imgList : ['@logo'];
      name = pool[Math.floor(A.beats / 8) % pool.length];
    }
    let im = imgGet(name);
    if (!im) return;
    imgRot += S.imgSpin * dt;
    const pulse = 1 + (A.bass * 0.12 + A.beat * 0.06) * S.imgPulse;
    if (S.imgTint) { // recolour to the palette: keep the picture's light, swap its colours
      const c = imgTintCanvas || (imgTintCanvas = document.createElement('canvas'));
      c.width = Math.min(1024, im.naturalWidth); c.height = Math.round(c.width * (im.naturalHeight / im.naturalWidth));
      const x = c.getContext('2d');
      x.globalCompositeOperation = 'source-over'; x.drawImage(im, 0, 0, c.width, c.height);
      x.globalCompositeOperation = 'color'; x.fillStyle = `hsl(${H(performance.now() / 1000)},100%,50%)`; x.fillRect(0, 0, c.width, c.height);
      x.globalCompositeOperation = 'destination-in'; x.drawImage(im, 0, 0, c.width, c.height);
      im = c;
    }
    const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height, ar = iw / ih;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.globalCompositeOperation = 'lighter'; // black backgrounds vanish
    ctx.globalAlpha = Math.min(1, S.imgMix * (0.8 + A.beat * 0.2 * S.imgPulse));
    if (S.imgMode === 'fill') {
      const s = Math.max(w / iw, h / ih) * (1 + (pulse - 1) * 0.4);
      ctx.rotate(imgRot * 0.2);
      ctx.drawImage(im, (-iw * s) / 2, (-ih * s) / 2, iw * s, ih * s);
    } else if (S.imgMode === 'ring') {
      const n = Math.max(3, Math.round(S.fold)), size = R * 0.42 * S.imgSize * pulse;
      for (let i = 0; i < n; i++) {
        ctx.save(); ctx.rotate(imgRot + (i / n) * TAU); ctx.translate(0, -R * 0.66);
        ctx.drawImage(im, (-size * ar) / 2, -size / 2, size * ar, size);
        ctx.restore();
      }
    } else {
      const size = R * 2 * S.imgSize * pulse;
      ctx.rotate(imgRot);
      const sw = ar >= 1 ? size : size * ar, sh = ar >= 1 ? size / ar : size;
      ctx.drawImage(im, -sw / 2, -sh / 2, sw, sh);
    }
    ctx.restore();
  }

  // ---------------- backdrops (drawn under the geometry) ----------------
  const GLYPHS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ΦΨΩ∆◬⟁'.split('');
  const BG = { drops: [], stars: [], parts: [] };
  function backdrop(ctx, w, h, f, dt) {
    const kind = S.backdrop;
    if (kind === 'rain') { // only the falling heads are drawn: the feedback trails paint the tails
      const cols = Math.floor(w / 18);
      while (BG.drops.length < cols) BG.drops.push({ y: Math.random() * h, v: 0.4 + Math.random() });
      ctx.font = '15px "Share Tech Mono", monospace';
      for (let i = 0; i < cols; i++) {
        const d = BG.drops[i];
        d.y += d.v * dt * 260 * (0.6 + f.bass * 1.4);
        if (d.y > h + 20) { d.y = -20; d.v = 0.4 + Math.random(); }
        ctx.fillStyle = `hsla(${H(f.t, i * 0.05)},${sat()}%,${55 + f.treble * 30}%,${0.35 + f.level * 0.4})`;
        ctx.fillText(GLYPHS[(Math.random() * GLYPHS.length) | 0], i * 18, d.y);
      }
    } else if (kind === 'stars') {
      while (BG.stars.length < 220) BG.stars.push({ a: Math.random() * TAU, r: Math.random(), v: 0.3 + Math.random() });
      const R = Math.hypot(w, h) / 2;
      for (const s of BG.stars) {
        s.r += s.v * dt * (0.15 + f.bass * 0.9) * (0.2 + s.r);
        if (s.r > 1) { s.r = 0.02; s.a = Math.random() * TAU; }
        ctx.fillStyle = `hsla(${H(f.t, s.a)},${sat()}%,80%,${Math.min(1, s.r * 1.6)})`;
        const sz = 0.6 + s.r * 2.6;
        ctx.fillRect(w / 2 + Math.cos(s.a) * s.r * R, h / 2 + Math.sin(s.a) * s.r * R, sz, sz);
      }
    } else if (kind === 'grid') { // synthwave floor and ceiling rushing toward you
      const hz = h / 2, off = (f.t * (0.4 + f.bass * 1.5)) % 1;
      ctx.strokeStyle = `hsla(${H(f.t, 2)},${sat()}%,55%,${0.25 + f.bass * 0.3})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < 14; i++) {
        const z = (i + 1 - off) / 14, y = hz * (0.08 / z);
        if (y > hz) continue;
        ctx.moveTo(0, hz + y); ctx.lineTo(w, hz + y); ctx.moveTo(0, hz - y); ctx.lineTo(w, hz - y);
      }
      for (let i = -12; i <= 12; i++) { ctx.moveTo(w / 2, hz); ctx.lineTo(w / 2 + i * w * 0.12, h); ctx.moveTo(w / 2, hz); ctx.lineTo(w / 2 + i * w * 0.12, 0); }
      ctx.stroke();
    } else if (kind === 'particles') { // bursts on every beat
      if (f.beat > 0.95 && BG.parts.length < 600) for (let i = 0; i < 40; i++) { const a = Math.random() * TAU, v = 80 + Math.random() * 380; BG.parts.push({ x: w / 2, y: h / 2, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1 }); }
      BG.parts = BG.parts.filter((p) => (p.life -= dt * 0.7) > 0);
      for (const p of BG.parts) {
        p.x += p.vx * dt; p.y += p.vy * dt;
        ctx.fillStyle = `hsla(${H(f.t, p.vx)},${sat()}%,75%,${p.life})`;
        ctx.fillRect(p.x, p.y, 2.5, 2.5);
      }
    }
  }

  // ---------------- WebGL post pipeline ----------------
  const gl = glCanvas.getContext('webgl', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
  const VS = 'attribute vec2 p; varying vec2 v; void main(){ v = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }';
  const FS_FEED = `precision mediump float; varying vec2 v;
    uniform sampler2D uGeo, uPrev; uniform float uAspect, uZoom, uRot, uDecay;
    void main(){
      vec2 c = v - 0.5; c.x *= uAspect;
      float cs = cos(uRot), sn = sin(uRot);
      c = mat2(cs, -sn, sn, cs) * c * (1.0 - uZoom);
      c.x /= uAspect;
      vec3 prev = texture2D(uPrev, c + 0.5).rgb;
      prev = max(prev * uDecay - 2.0/255.0, 0.0);
      vec3 g = texture2D(uGeo, v).rgb;
      gl_FragColor = vec4(max(prev, g), 1.0);
    }`;
  const FS_OUT = `precision mediump float; varying vec2 v;
    uniform sampler2D uTex; uniform vec2 uRes, uShake; uniform float uAspect, uTime, uK, uChroma, uGlow, uGlitch, uFlash, uHue, uSpout, uMirror, uStrobe, uPunch, uMosh, uBloom, uBuild, uInv;
    float hash(float n){ return fract(sin(n)*43758.5453); }
    vec3 hueShift(vec3 col, float a){
      const vec3 k = vec3(0.57735);
      float c = cos(a);
      return col*c + cross(k, col)*sin(a) + k*dot(k, col)*(1.0-c);
    }
    void main(){
      // Spout: flip so readPixels returns rows top-first
      vec2 vv = vec2(v.x, mix(v.y, 1.0 - v.y, uSpout));
      vec2 uv = (vv - 0.5) / (1.0 + uPunch) + 0.5 + uShake; // zoom punch + camera shake
      // mirror: 1 left|right, 2 top|bottom, 3 all four quarters
      if (uMirror > 0.5 && uMirror < 1.5) uv.x = 0.5 - abs(uv.x - 0.5);
      else if (uMirror > 1.5 && uMirror < 2.5) uv.y = 0.5 - abs(uv.y - 0.5);
      else if (uMirror > 2.5) uv = 0.5 - abs(uv - 0.5);
      if (uK > 0.5) {
        vec2 c = uv - 0.5; c.x *= uAspect;
        float r = length(c), a = atan(c.y, c.x), seg = 6.2831853 / uK;
        a = mod(a, seg); a = abs(a - seg * 0.5);
        c = vec2(cos(a), sin(a)) * r; c.x /= uAspect; uv = c + 0.5;
      }
      if (uGlitch > 0.0) {
        float band = floor(uv.y * 28.0);
        float n = hash(band + floor(uTime * 12.0));
        if (n < uGlitch * 0.3) uv.x += (hash(band * 1.7 + uTime) - 0.5) * 0.12 * uGlitch;
      }
      float chromaK = uChroma;
      if (uMosh > 0.01) { // datamosh: blocks that slip and freeze into chunky pixels, plus torn scanline slices
        float stp = floor(uTime * 14.0);
        vec2 cell = floor(uv * vec2(18.0, 10.0));
        float h = hash(cell.x * 13.1 + cell.y * 7.7 + stp);
        if (h < uMosh * 0.22) {
          uv += (vec2(hash(h * 91.0 + 1.0), hash(h * 37.0 + 2.0)) - 0.5) * 0.14 * uMosh;
          if (h < uMosh * 0.06) uv = floor(uv * 36.0) / 36.0;
        }
        float band2 = floor(uv.y * 40.0);
        if (hash(band2 * 3.1 + stp) < uMosh * 0.12) uv.x += (hash(band2 + stp * 2.0) - 0.5) * 0.2 * uMosh;
        chromaK += uMosh * 0.9;
      }
      vec2 dir = (uv - 0.5) * chromaK * 0.03;
      vec3 col = vec3(texture2D(uTex, uv + dir).r, texture2D(uTex, uv).g, texture2D(uTex, uv - dir).b);
      vec3 bl = vec3(0.0), far = vec3(0.0);
      for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.785398;
        vec2 o = vec2(cos(a), sin(a)) / uRes;
        bl += texture2D(uTex, uv + o * 5.0).rgb + texture2D(uTex, uv + o * 13.0).rgb;
        if (uBloom > 0.01) far += texture2D(uTex, uv + o * 30.0).rgb;
      }
      col += (bl / 16.0) * uGlow * 1.8;
      col += max(far / 8.0 - 0.05, 0.0) * uBloom * 3.2; // wide bloom: only what is already bright spills
      col = hueShift(col, uHue);
      col += uFlash * vec3(0.12, 0.3, 0.16) + uStrobe * vec3(0.85);
      col += uBuild * vec3(0.0, 0.05, 0.07) * (1.0 - length(vv - 0.5) * 1.3);
      col = mix(col, vec3(1.0) - col, uInv);
      float vig = smoothstep(1.25, 0.35, length((vv - 0.5) * vec2(uAspect, 1.0)));
      col *= vig * (0.93 + 0.07 * sin(vv.y * uRes.y * 1.5708));
      // Spout wants BGRA: swap channels so the bytes read back are already in sender order
      gl_FragColor = uSpout > 0.5 ? vec4(col.b, col.g, col.r, 1.0) : vec4(col, 1.0);
    }`;

  let progFeed, progOut, texGeo, fb = [], quad, ok = !!gl;
  function shader(type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function program(fs) {
    const p = gl.createProgram();
    gl.attachShader(p, shader(gl.VERTEX_SHADER, VS)); gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    p.u = new Proxy({}, { get: (c, k) => (k in c ? c[k] : (c[k] = gl.getUniformLocation(p, k))) });
    return p;
  }
  function tex() {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  if (ok) {
    try {
      progFeed = program(FS_FEED); progOut = program(FS_OUT);
      quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      texGeo = tex();
    } catch (e) { console.error('vj gl', e); ok = false; }
  }
  let W = 0, Hh = 0;
  function resize() {
    const r = (OUT ? document.body : stage).getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * (QUALITY[(WALL && WALL_Q) || S.quality] || QUALITY.balanced);
    const w = SPOUT ? SPOUT_W : Math.max(2, Math.round(r.width * dpr));
    const h = SPOUT ? SPOUT_H : Math.max(2, Math.round(r.height * dpr));
    if (w === W && h === Hh) return;
    W = w; Hh = h;
    glCanvas.width = w; glCanvas.height = h;
    geo.width = Math.round(w * 0.85); geo.height = Math.round(h * 0.85);
    if (!ok) return;
    fb.forEach((f) => { gl.deleteFramebuffer(f.fb); gl.deleteTexture(f.tex); });
    fb = [0, 1].map(() => {
      const t = tex();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      return { fb: f, tex: t };
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ---------------- structure: build-ups and drops ----------------
  // 'audio': listens for a swell (level + treble climbing over a few seconds) and for the kick that lands after it or
  // after a quiet gap. 'clock': plays a synthetic drum loop at clockBpm: groove, then a build over the second half
  // of the phrase (loopBars long), a dropped kick before the drop, then the drop on bar 1. That makes loops that
  // start on a drop, build, and are exactly loopBars * 240 / bpm seconds long.
  const ST = { build: 0, drop: 0, ct: 0, lvlF: 0, lvlS: 0, trF: 0, trS: 0, quietAt: -99, lastDrop: -99, phrase: -1, seen: 0, lastBeat: 0, ival: 0.5, beatPh: 0, vbeat: -1 };
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  function structure(dt) {
    ST.ct += dt;
    if (S.structure === 'clock') {
      const beat = (ST.ct * S.clockBpm) / 60, bars = Math.max(4, S.loopBars), bar = beat / 4, bp = (bar % bars) / bars, ph = Math.floor(bar / bars);
      if (ph !== ST.phrase) { ST.phrase = ph; ST.drop = 1; ST.build = 0; }
      ST.build = bp > 0.5 ? clamp01((bp - 0.5) / 0.46) : 0;
      const bf = beat % 1, fb = Math.floor(beat);
      const gap = bp > 0.97; // the last beat of the phrase: the kick drops out, just the riser
      if (fb !== ST.vbeat) { ST.vbeat = fb; if (!gap) { A.beat = 1; A.beats++; } }
      const kick = gap ? 0 : Math.exp(-bf * 6), hat = Math.exp(-((bf + 0.5) % 1) * 14);
      A.bass = (0.25 + 0.75 * kick) * (1 - ST.build * 0.25) + ST.drop * 0.4;
      A.mid = 0.3 + 0.25 * Math.sin(ST.ct * 2.1) + ST.build * 0.35;
      A.treble = 0.2 + hat * 0.45 + ST.build * 0.7;
      A.level = 0.45 + 0.3 * kick + ST.build * 0.4;
      A.silent = false; A.last = performance.now();
      for (let i = 0; i < 48; i++) A.spec[i] = 255 * clamp01((A.bass * Math.exp(-i / 6) + A.mid * 0.6 * Math.exp(-(((i - 16) / 8) ** 2)) + A.treble * 0.55 * Math.exp(-(((i - 36) / 10) ** 2))) * (0.82 + 0.18 * Math.sin(ST.ct * 9 + i * 1.7)));
      ST.beatPh = bf; ST.ival = 60 / S.clockBpm;
    } else if (S.structure === 'audio') {
      const kF = 1 - Math.exp(-dt / 0.35), kS = 1 - Math.exp(-dt / 6);
      ST.lvlF += (A.level - ST.lvlF) * kF; ST.lvlS += (A.level - ST.lvlS) * kS;
      ST.trF += (A.treble - ST.trF) * kF; ST.trS += (A.treble - ST.trS) * kS;
      const up = (ST.trF > ST.trS * 1.15 && ST.lvlF > ST.lvlS * 0.95) || ST.lvlF > ST.lvlS * 1.3;
      ST.build = clamp01(ST.build + (up && !A.silent ? dt / 5 : -dt / 2.5));
      if (ST.lvlF < ST.lvlS * 0.45 && ST.lvlS > 0.08) ST.quietAt = ST.ct;
      if (A.beats !== ST.seen) {
        ST.seen = A.beats;
        const iv = ST.ct - ST.lastBeat; ST.lastBeat = ST.ct;
        if (iv > 0.25 && iv < 1.2) ST.ival = ST.ival * 0.8 + iv * 0.2;
        if (A.bass > 0.85 && (ST.build > 0.5 || ST.ct - ST.quietAt < 2.5) && ST.ct - ST.lastDrop > 8) { ST.drop = 1; ST.build = 0; ST.lastDrop = ST.ct; }
      }
      ST.beatPh = clamp01((ST.ct - ST.lastBeat) / ST.ival);
    } else { ST.build = 0; ST.beatPh = 0; }
    ST.drop = Math.max(0, ST.drop - dt / 1.2);
  }
  // loop recording: the clock restarts at bar 1, quality goes to ULTRA, and exactly loopBars of it are saved as a WebM
  let rec = null;
  function recordLoop() {
    if (rec) { if (rec.mr.state === 'recording') rec.mr.stop(); return; }
    if (!window.MediaRecorder || !glCanvas.captureStream) return toast('THIS WINDOW CANNOT RECORD', true);
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
    const len = (Math.max(4, S.loopBars) * 240) / S.clockBpm, before = { structure: S.structure, quality: S.quality, fps: S.fps };
    const chunks = [], mr = new MediaRecorder(glCanvas.captureStream(60), { mimeType: mime, videoBitsPerSecond: 30e6 });
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    mr.onstop = () => {
      rec = null; setS(before, false); setRecUi();
      const url = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' })), a = document.createElement('a');
      a.href = url; a.download = `HYPERSPACE-loop-${S.clockBpm}bpm-${S.loopBars}bars-${S.theme}.webm`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      toast(`LOOP SAVED · ${S.loopBars} BARS · ${len.toFixed(2)} s`);
    };
    setS({ structure: 'clock', quality: 'ultra', fps: 60 }, false);
    ST.ct = 0; ST.phrase = -1; ST.vbeat = -1; rec = { mr, len };
    setTimeout(() => { if (rec && mr.state === 'inactive') { ST.ct = 0; ST.phrase = -1; ST.vbeat = -1; mr.start(); } }, 300); // let the new resolution settle, then start on bar 1
    setRecUi();
  }
  function setRecUi() {
    const b = document.getElementById('vj-rec'), st = document.getElementById('vj-recstat');
    if (!b) return;
    b.textContent = rec ? '■ STOP' : '● RECORD LOOP';
    if (st) st.textContent = rec ? 'starting…' : `${Math.max(4, S.loopBars)} bars at ${S.clockBpm} BPM = ${((Math.max(4, S.loopBars) * 240) / S.clockBpm).toFixed(2)} s, saved as WebM at ULTRA quality`;
  }

  // ---------------- frame loop ----------------
  let rot = 0, lastT = 0, cur = 0, flash = 0, liteOn = false;
  if (WALL) { hs.on('lite', (s) => { liteOn = !!s?.on; }); hs.call('liteGet').then((s) => { liteOn = !!s?.on; }).catch(() => {}); }
  let looping = true;
  function frame(tms) {
    const visible = (OUT && !wallPaused) || (window.HS && HS.inVJ());
    // the VJ tab in a HYPERSPACE window asks for no frames at all while another tab shows (HS.onView restarts it)
    if (!SPOUT) { if (visible || OUT) requestAnimationFrame(frame); else looping = false; }
    if (!visible) { lastT = 0; return; }
    const fpsCap = WALL ? (liteOn ? Math.min(20, WALL_FPS) : WALL_FPS) : S.fps;
    if (!SPOUT && fpsCap < 60 && lastT && tms / 1000 - lastT < 1 / fpsCap - 0.004) return;
    resize();
    const t = tms / 1000;
    const dt = lastT ? Math.min(0.1, t - lastT) : 0.016;
    lastT = t;
    // silence: let bands fall away
    if (performance.now() - A.last > 300) { A.bass *= 0.9; A.mid *= 0.9; A.treble *= 0.9; }
    A.beat *= Math.pow(0.02, dt);
    structure(dt);
    if (rec && rec.mr.state === 'recording') {
      if (ST.ct >= rec.len) rec.mr.stop();
      else { const st = document.getElementById('vj-recstat'); if (st) st.textContent = `recording ${ST.ct.toFixed(1)} / ${rec.len.toFixed(1)} s`; }
    }
    if (S.flash && A.beat > 0.9) flash = 1;
    flash *= Math.pow(0.005, dt);

    // hardware ties
    let spin = S.speed * (0.25 + A.mid * 0.9) * (1 + ST.build * 1.2);
    if (S.cpuSpin) spin *= 1 + HW.cpu * S.cpuSpinAmt * 2.5;
    const dir = S.dir === 'ccw' ? -1 : S.dir === 'pingpong' ? (Math.floor(A.beats / 16) % 2 ? -1 : 1) : 1;
    rot += spin * dt * dir;
    let complexity = S.complexity + (S.cpuComplex ? Math.round(HW.cpu * 2) : 0);
    let glow = S.glow * (S.gpuGlow ? 0.6 + HW.heat * S.gpuAmt * 1.2 : 1);
    let chroma = S.chroma + (S.gpuGlitch ? HW.heat * S.gpuAmt * 0.8 : 0) + A.beat * 0.15;
    const glitch = S.gpuGlitch && HW.heat > 0.55 ? (HW.heat - 0.55) * 2.2 * S.gpuAmt : 0;

    // draw geometry
    const gw = geo.width, gh = geo.height;
    g2.globalCompositeOperation = 'source-over';
    g2.fillStyle = '#000'; g2.fillRect(0, 0, gw, gh);
    g2.globalCompositeOperation = 'lighter';
    if (S.backdrop !== 'none') { try { backdrop(g2, gw, gh, { t, bass: A.bass, mid: A.mid, treble: A.treble, beat: A.beat, level: A.level }, dt); } catch (e) { console.error(e); } }
    g2.save();
    g2.translate(gw / 2, gh / 2);
    g2.lineJoin = 'round';
    const R = Math.min(gw, gh) * 0.46 * S.scale * (1 + A.beat * 0.04 * S.punch + ST.drop * 0.1 * S.zoomPunch);
    const fdata = { t, dt, rot, bass: A.bass, mid: A.mid, treble: A.treble, beat: A.beat, level: Math.min(1.5, A.level), complexity, spec: A.spec, fold: S.fold, tilt: S.tilt, build: ST.build, drop: ST.drop, beatPh: ST.beatPh };
    const main = THEMES[S.theme] || THEMES.flower;
    try { main.draw.call(main, g2, R, fdata); } catch (e) { console.error(e); }
    // stacked centre themes (shift-click): each turns its own way at its own size so they interlock
    const stack = (S.stack || []).filter((k) => k !== S.theme && THEMES[k]);
    stack.forEach((k, i) => {
      const th = THEMES[k], dir = i % 2 ? 1 : -1;
      g2.save();
      g2.globalAlpha = S.stackMix;
      try { th.draw.call(th, g2, R * [0.82, 1.12, 0.66, 1.25][i % 4], { ...fdata, rot: rot * dir * (0.6 + 0.25 * i) }); } catch (e) { console.error(e); }
      g2.restore();
    });
    g2.restore();
    // second layer: another theme blended over the first, counter-rotating
    const L2 = S.layer2 !== 'none' && S.layer2 !== S.theme ? THEMES[S.layer2] : null;
    if (L2) {
      g2.save();
      g2.translate(gw / 2, gh / 2);
      g2.globalAlpha = S.layer2Mix;
      try { L2.draw.call(L2, g2, R * S.layer2Scale, { ...fdata, rot: -rot * 0.7 }); } catch (e) { console.error(e); }
      g2.restore();
    }
    try { drawPicture(g2, gw, gh, R, dt); } catch (e) { console.error(e); }

    if (!ok) { // 2D fallback: just show the geometry
      const c2 = glCanvas.getContext('2d');
      if (c2) c2.drawImage(geo, 0, 0, glCanvas.width, glCanvas.height);
      return;
    }
    gl.bindTexture(gl.TEXTURE_2D, texGeo);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); // canvas rows run top-down, GL textures bottom-up
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, geo);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.viewport(0, 0, W, Hh);
    const aspect = W / Hh;

    // pass 1: feedback (trails + tunnel zoom)
    const src = fb[cur], dst = fb[1 - cur];
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
    gl.useProgram(progFeed);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texGeo); gl.uniform1i(progFeed.u.uGeo, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, src.tex); gl.uniform1i(progFeed.u.uPrev, 1);
    gl.uniform1f(progFeed.u.uAspect, aspect);
    gl.uniform1f(progFeed.u.uZoom, S.zoom * (0.012 + A.bass * 0.03) * (1 + ST.build * 1.2 + ST.drop * 2.2));
    gl.uniform1f(progFeed.u.uRot, (spin * 0.004 + A.beat * 0.01 + ST.drop * 0.02) * (S.zoom > 0 ? 1 : 0));
    gl.uniform1f(progFeed.u.uDecay, S.trails);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    cur = 1 - cur;

    // pass 2: output
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(progOut);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, dst.tex); gl.uniform1i(progOut.u.uTex, 0);
    gl.uniform2f(progOut.u.uRes, W, Hh);
    gl.uniform1f(progOut.u.uAspect, aspect);
    gl.uniform1f(progOut.u.uTime, t);
    // camera shake, zoom punch, mosh, bloom and the riser strobe all hang off the build/drop state
    const bk = Math.min(1, A.bass), mag = S.shake * (0.009 * A.beat * bk + 0.026 * ST.drop + 0.003 * ST.build);
    gl.uniform2f(progOut.u.uShake, (Math.sin(t * 71.3) + Math.sin(t * 43.1 + 2)) * 0.5 * mag, (Math.sin(t * 57.7 + 1) + Math.sin(t * 33.3 + 4)) * 0.5 * mag);
    gl.uniform1f(progOut.u.uPunch, S.zoomPunch * (0.045 * A.beat * bk + 0.15 * ST.drop));
    gl.uniform1f(progOut.u.uMosh, S.datamosh * (ST.drop + 0.22 * A.beat * bk + 0.3 * ST.build));
    gl.uniform1f(progOut.u.uBloom, S.bloom * (1 + ST.drop * 1.6 + ST.build * 0.6));
    gl.uniform1f(progOut.u.uBuild, ST.build);
    gl.uniform1f(progOut.u.uInv, S.flash && ST.drop > 0.94 ? 0.55 : 0);
    let kal = S.kaleido;
    if (S.kaleidoFx) kal = ST.build > 0.55 ? (A.beats % 2 ? 12 : 8) : ST.drop > 0.25 ? 6 : S.kaleido; // strobing kaleidoscope on builds and drops
    gl.uniform1f(progOut.u.uK, kal);
    gl.uniform1f(progOut.u.uChroma, chroma);
    gl.uniform1f(progOut.u.uGlow, glow);
    gl.uniform1f(progOut.u.uGlitch, glitch);
    gl.uniform1f(progOut.u.uFlash, flash * 0.6);
    gl.uniform1f(progOut.u.uHue, 0);
    gl.uniform1f(progOut.u.uSpout, SPOUT ? 1 : 0);
    gl.uniform1f(progOut.u.uMirror, S.mirror);
    const riser = S.strobe && ST.build > 0.8 ? (((ST.beatPh * (2 + ST.build * 6)) % 1) < 0.5 ? 0.3 * (ST.build - 0.8) * 5 : 0) : 0;
    gl.uniform1f(progOut.u.uStrobe, (S.strobe ? Math.max(0, A.beat - 0.55) * 2.2 : 0) + riser);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (SPOUT) spoutSend();

    // HUD
    if (!OUT) {
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.style.height = `${2 + Math.min(1, v) * 32}px`; };
      set('vb-bass', A.bass); set('vb-mid', A.mid); set('vb-treble', A.treble);
    }
  }
  // ---------------- Spout streaming ----------------
  let ws = null, wsReady = false, pix = null;
  function spoutConnect() {
    hs.call('spoutInfo').then(({ port, token }) => {
      if (!port) return setTimeout(spoutConnect, 1000);
      ws = new WebSocket(`ws://127.0.0.1:${port}/?k=${token}`);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => { wsReady = true; };
      ws.onclose = () => { wsReady = false; setTimeout(spoutConnect, 1000); };
      ws.onerror = () => {};
    }).catch(() => setTimeout(spoutConnect, 1000));
  }
  function spoutSend() {
    // drop a frame rather than queue up if the sender is behind
    if (!wsReady || ws.bufferedAmount > W * Hh * 8) return;
    if (!pix || pix.byteLength !== 8 + W * Hh * 4) { pix = new ArrayBuffer(8 + W * Hh * 4); new Uint32Array(pix, 0, 2).set([W, Hh]); }
    gl.readPixels(0, 0, W, Hh, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(pix, 8));
    ws.send(pix);
  }
  if (SPOUT) {
    spoutConnect();
    const loop = () => {
      const t0 = performance.now();
      frame(t0);
      setTimeout(loop, Math.max(0, 1000 / SPOUT_FPS - (performance.now() - t0)));
    };
    loop();
  } else requestAnimationFrame(frame);
  const wakeVJ = () => { if (HS.inVJ() && !looping) { looping = true; requestAnimationFrame(frame); } }; if (window.HS && !OUT) { HS.onView(wakeVJ); window.addEventListener('hs-crate-section', wakeVJ); }

  function nextTheme() {
    const all = Object.keys(THEMES);
    const favs = (S.favs || []).filter((k) => THEMES[k]);
    const pool = S.autoMode === 'favs' && favs.length ? favs : all;
    if (S.autoMode === 'random' || (S.autoMode === 'favs' && favs.length > 2 && Math.random() < 0.3)) {
      const pick = pool.filter((k) => k !== S.theme);
      return setS({ theme: pick[(Math.random() * pick.length) | 0] || pool[0] });
    }
    const i = pool.indexOf(S.theme);
    setS({ theme: pool[(i + 1) % pool.length] });
  }

  // ---------------- settings ----------------
  function setS(patch, save = true) {
    S = { ...S, ...patch };
    const name = document.getElementById('vj-theme-name');
    if (name) name.textContent = [S.theme, ...(S.stack || []).filter((k) => k !== S.theme)].map(themeName).join(' + ') + (S.layer2 !== 'none' && S.layer2 !== S.theme ? ` × ${themeName(S.layer2)}` : '');
    if (!OUT) syncControls();
    if (save && window.HS) HS.saveConfig({ vj: S });
    if ('source' in patch) lease();
  }
  hs.on('config', (c) => { if (c.vj && OUT) setS(c.vj, false); });
  hs.call('config').then((c) => setS({ ...DEFAULTS, ...(c.vj || {}) }, false)).catch(() => {});

  // audio capture lease: the laptop only runs the FFT while something is showing it
  const leaseId = SPOUT ? 'spout' : WALL ? `wall-${QS.get('d') || 0}` : OUT ? 'vjout' : hs.remote ? `phone-${Math.random().toString(36).slice(2, 8)}` : 'main';
  function lease() {
    const want = (OUT && !wallPaused) || (window.HS && (HS.inVJ() || S.reactUi));
    hs.call('audioLease', leaseId, !!want, S.source).catch(() => {});
  }
  if (WALL) hs.on('wallpaper-pause', (p) => { if (p.id === QS.get('d') && p.paused !== wallPaused) { wallPaused = p.paused; lease(); } });
  setInterval(lease, 5000);
  if (window.HS) { HS.onView(lease); window.addEventListener('hs-crate-section', lease); }
  lease();

  if (window.HS) HS.actions.vjNext = () => nextTheme();
  if (OUT) {
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });
    window.addEventListener('beforeunload', () => hs.call('audioLease', leaseId, false));
    return;
  }

  // built-in loop looks (cyan / pink / purple and matrix green). Each one is a whole setting patch.
  const LOOK_PACK = [
    { name: 'NEON TUNNEL DROP', tip: 'Sacred-geometry tunnel, cyan/pink/purple, big camera punch on the drop', s: { theme: 'sactunnel', stack: [], layer2: 'none', backdrop: 'stars', palette: 'neon', structure: 'clock', clockBpm: 140, loopBars: 8, zoom: 0.55, trails: 0.9, glow: 0.9, chroma: 0.5, shake: 1, zoomPunch: 1, datamosh: 0.5, bloom: 0.9, kaleido: 0, kaleidoFx: false, mirror: 0, speed: 1.1 } },
    { name: 'MATRIX VORTEX', tip: 'Green glyph rain spiralling into a vortex', s: { theme: 'matrixvortex', stack: [], layer2: 'none', backdrop: 'rain', palette: 'matrix', structure: 'clock', clockBpm: 128, loopBars: 8, zoom: 0.45, trails: 0.92, glow: 1, chroma: 0.35, shake: 0.7, zoomPunch: 0.8, datamosh: 0.35, bloom: 0.8, kaleido: 0, kaleidoFx: false, mirror: 0, speed: 0.9 } },
    { name: 'STROBE MANDALA', tip: 'Kaleidoscope that flips segment counts on builds and drops', s: { theme: 'kaleidoburst', stack: [], layer2: 'none', backdrop: 'none', palette: 'neon', structure: 'clock', clockBpm: 150, loopBars: 8, zoom: 0.35, trails: 0.84, glow: 0.9, chroma: 0.45, shake: 0.8, zoomPunch: 0.9, datamosh: 0.3, bloom: 0.9, kaleido: 0, kaleidoFx: true, mirror: 0, speed: 1.2 } },
    { name: 'GLITCH MERKABA', tip: 'Star tetrahedron split into RGB ghosts, torn slices and datamosh', s: { theme: 'glitchmerk', stack: [], layer2: 'none', backdrop: 'none', palette: 'subashton', structure: 'clock', clockBpm: 174, loopBars: 8, zoom: 0.4, trails: 0.86, glow: 0.8, chroma: 0.7, shake: 1.2, zoomPunch: 1, datamosh: 1, bloom: 0.6, kaleido: 0, kaleidoFx: false, mirror: 0, speed: 0.8 } },
    { name: 'TUNNEL × VORTEX', tip: 'Both tunnels layered: the full hyperspace jump', s: { theme: 'sactunnel', stack: [], layer2: 'matrixvortex', layer2Mix: 0.7, layer2Scale: 0.9, backdrop: 'none', palette: 'neon', structure: 'clock', clockBpm: 140, loopBars: 16, zoom: 0.6, trails: 0.91, glow: 1, chroma: 0.55, shake: 1, zoomPunch: 1.1, datamosh: 0.6, bloom: 1, kaleido: 0, kaleidoFx: false, mirror: 0, speed: 1 } },
    { name: 'MATRIX MERKABA', tip: 'Green sacred geometry with a kaleidoscope drop', s: { theme: 'merkaba', stack: ['sactunnel'], layer2: 'none', backdrop: 'rain', palette: 'matrix', structure: 'audio', zoom: 0.5, trails: 0.9, glow: 1.1, chroma: 0.4, shake: 0.7, zoomPunch: 0.8, datamosh: 0.4, bloom: 0.8, kaleido: 0, kaleidoFx: true, mirror: 0, speed: 1 } },
  ];

  // ---------------- control panel ----------------
  const CONTROLS = [
    { h: 'SPOUT OUT' }, { type: 'spout' },
    { h: 'LIVE WALLPAPER' }, { type: 'wallpaper' },
    { h: 'THEME' }, { type: 'themes' },
    { k: 'stackMix', type: 'range', label: 'STACKED THEMES MIX', min: 0.2, max: 1, step: 0.05 },
    { k: 'auto', type: 'check', label: 'auto-cycle themes on the beat' },
    { k: 'autoMode', type: 'seg', label: 'CYCLE THROUGH', options: [['seq', 'IN ORDER'], ['random', 'RANDOM'], ['favs', '★ FAVOURITES']] },
    { k: 'autoBeats', type: 'range', label: 'BEATS PER THEME', min: 8, max: 128, step: 8 },
    { h: 'LOOP LOOKS' }, { type: 'lookpack' },
    { h: 'LOOP PRODUCTION' },
    { k: 'structure', type: 'seg', label: 'BUILD / DROP', options: [['off', 'OFF'], ['audio', 'FROM THE MUSIC'], ['clock', 'BPM CLOCK (own drums)']] },
    { k: 'clockBpm', type: 'range', label: 'LOOP BPM', min: 70, max: 180, step: 1 },
    { k: 'loopBars', type: 'seg', label: 'LOOP LENGTH (BARS)', options: [[4, '4'], [8, '8'], [16, '16'], [32, '32']] },
    { type: 'looprec' },
    { k: 'shake', type: 'range', label: 'CAMERA SHAKE', min: 0, max: 2, step: 0.05 },
    { k: 'zoomPunch', type: 'range', label: 'ZOOM PUNCH', min: 0, max: 2, step: 0.05 },
    { k: 'datamosh', type: 'range', label: 'GLITCH / DATAMOSH', min: 0, max: 1.5, step: 0.05 },
    { k: 'bloom', type: 'range', label: 'BLOOM', min: 0, max: 2, step: 0.05 },
    { k: 'kaleidoFx', type: 'check', label: 'strobing kaleidoscope on builds and drops' },
    { h: 'SHOW PRESETS' }, { type: 'showpresets' },
    { h: 'PRESETS' }, { type: 'presets' },
    { h: 'AUDIO' }, { k: 'source', type: 'source' },
    { k: 'sensitivity', type: 'range', label: 'SENSITIVITY', min: 0.2, max: 3, step: 0.05 },
    { k: 'bass', type: 'range', label: 'BASS', min: 0, max: 2, step: 0.05 },
    { k: 'mid', type: 'range', label: 'MID', min: 0, max: 2, step: 0.05 },
    { k: 'treble', type: 'range', label: 'TREBLE', min: 0, max: 2, step: 0.05 },
    { h: 'SHAPE' },
    { k: 'complexity', type: 'range', label: 'COMPLEXITY', min: 1, max: 5, step: 1 },
    { k: 'fold', type: 'range', label: 'SYMMETRY / PETALS', min: 3, max: 16, step: 1 },
    { k: 'scale', type: 'range', label: 'SIZE', min: 0.4, max: 1.6, step: 0.02 },
    { k: 'lineW', type: 'range', label: 'LINE WEIGHT', min: 0.4, max: 3, step: 0.05 },
    { k: 'tilt', type: 'range', label: '3D TILT', min: 0, max: 1, step: 0.01 },
    { h: 'MOTION' },
    { k: 'speed', type: 'range', label: 'ROTATION SPEED', min: 0, max: 3, step: 0.05 },
    { k: 'dir', type: 'seg', label: 'SPIN', options: [['cw', '↻ CLOCKWISE'], ['ccw', '↺ COUNTER'], ['pingpong', '⇄ FLIP / 16 BEATS']] },
    { k: 'punch', type: 'range', label: 'BEAT PUNCH', min: 0, max: 5, step: 0.1 },
    { k: 'zoom', type: 'range', label: 'TUNNEL PULL', min: 0, max: 1, step: 0.01 },
    { k: 'trails', type: 'range', label: 'TRAILS', min: 0, max: 0.97, step: 0.01 },
    { h: 'COLOUR' }, { type: 'palette' },
    { k: 'hue', type: 'range', label: 'HUE SHIFT', min: -60, max: 60, step: 1 },
    { h: 'LOOK' },
    { k: 'glow', type: 'range', label: 'GLOW', min: 0, max: 2, step: 0.05 },
    { k: 'chroma', type: 'range', label: 'CHROMATIC SPLIT', min: 0, max: 1.5, step: 0.05 },
    { k: 'kaleido', type: 'seg', label: 'KALEIDOSCOPE', options: [[0, 'OFF'], [4, '4'], [6, '6'], [8, '8'], [12, '12']] },
    { k: 'mirror', type: 'seg', label: 'MIRROR', options: [[0, 'OFF'], [1, 'L | R'], [2, 'TOP | BOTTOM'], [3, 'QUAD']] },
    { k: 'flash', type: 'check', label: 'flash on drops' },
    { k: 'strobe', type: 'check', label: 'white strobe on every beat (photosensitivity warning)' },
    { h: 'LAYERS' }, { type: 'layer2' },
    { k: 'layer2Mix', type: 'range', label: 'LAYER 2 MIX', min: 0.1, max: 1, step: 0.05 },
    { k: 'layer2Scale', type: 'range', label: 'LAYER 2 SIZE', min: 0.2, max: 1.6, step: 0.02 },
    { k: 'backdrop', type: 'seg', label: 'BACKDROP', options: [['none', 'NONE'], ['rain', 'MATRIX RAIN'], ['stars', 'STAR WARP'], ['grid', 'GRID'], ['particles', 'BEAT BURSTS']] },
    { h: 'PICTURES' }, { type: 'images' },
    { k: 'imgMode', type: 'seg', label: 'SHOW IT AS', options: [['center', 'CENTRE'], ['fill', 'FULL SCREEN'], ['ring', 'RING'], ['beat', 'SLIDESHOW']] },
    { k: 'imgSize', type: 'range', label: 'PICTURE SIZE', min: 0.1, max: 1.6, step: 0.02 },
    { k: 'imgMix', type: 'range', label: 'PICTURE MIX', min: 0.05, max: 1, step: 0.05 },
    { k: 'imgPulse', type: 'range', label: 'PULSE TO THE BEAT', min: 0, max: 3, step: 0.1 },
    { k: 'imgSpin', type: 'range', label: 'SPIN', min: -2, max: 2, step: 0.05 },
    { k: 'imgTint', type: 'check', label: 'recolour it to the palette' },
    { h: 'PERFORMANCE' },
    { k: 'quality', type: 'seg', label: 'RENDER QUALITY', options: [['eco', 'ECO'], ['balanced', 'BALANCED'], ['ultra', 'ULTRA']] },
    { k: 'fps', type: 'seg', label: 'FRAME RATE', options: [[30, '30 FPS'], [60, '60 FPS']] },
    { h: 'HARDWARE TIES' },
    { k: 'cpuSpin', type: 'check', label: 'CPU load → rotation speed' },
    { k: 'cpuSpinAmt', type: 'range', label: 'CPU SPIN AMOUNT', min: 0, max: 1.5, step: 0.05 },
    { k: 'cpuComplex', type: 'check', label: 'CPU load → complexity' },
    { k: 'gpuGlow', type: 'check', label: 'GPU temp → glow intensity' },
    { k: 'gpuGlitch', type: 'check', label: 'GPU temp → chromatic glitch' },
    { k: 'gpuAmt', type: 'range', label: 'GPU HEAT AMOUNT', min: 0, max: 1.5, step: 0.05 },
    { h: 'OUTPUT' }, { type: 'output' },
    { k: 'reactUi', type: 'check', label: 'pulse the whole HYPERSPACE UI to the music' },
    { type: 'reset' },
  ];
  const fmt = (c, v) => (c.step >= 1 ? String(Math.round(v)) : Number(v).toFixed(2));
  const box = document.getElementById('vj-controls');
  box.innerHTML = CONTROLS.map((c) => {
    if (c.h) return `<h5>${c.h}</h5>`;
    if (c.type === 'themes') return `<div class="dim tiny">shift-click to stack up to 4 more themes in the centre · right-click to ★ favourite</div>` + Object.entries(CATS).map(([cat, label]) =>
      `<div class="tcat">${label}</div><div class="theme-grid">${Object.entries(THEMES).filter(([, t]) => t.cat === cat).map(([k, t]) => `<button data-theme="${k}">${t.name}</button>`).join('')}</div>`).join('');
    if (c.type === 'palette') return `<div class="pal-grid">${Object.entries(PALETTES).map(([k, p]) => {
      const sw = p.cycle ? 'linear-gradient(90deg,#f05,#fc0,#0f6,#0cf,#a0f)' : p.tri ? `linear-gradient(90deg,hsl(${p.tri[0]},100%,50%) 33%,hsl(${p.tri[1]},100%,55%) 33% 66%,hsl(${p.tri[2]},100%,60%) 66%)` : p.duo ? `linear-gradient(90deg,hsl(${p.duo[0]},100%,50%) 50%,hsl(${p.duo[1]},100%,55%) 50%)` : `hsl(${p.base},${p.sat ?? 100}%,${p.sat === 0 ? 85 : 50}%)`;
      return `<button data-pal="${k}"><i style="background:${sw}"></i>${p.label}</button>`;
    }).join('')}</div>`;
    if (c.type === 'layer2') return `<label>LAYER 2 <em class="dim">a second theme blended over the first</em></label><select id="vj-layer2"><option value="none">— none —</option>${Object.entries(CATS).map(([cat, label]) =>
      `<optgroup label="${label}">${Object.entries(THEMES).filter(([, t]) => t.cat === cat).map(([k, t]) => `<option value="${k}">${t.name}</option>`).join('')}</optgroup>`).join('')}</select>`;
    if (c.type === 'images') return '<div class="dim tiny">black backgrounds disappear, so logos on black blend in perfectly</div><div class="img-grid" id="vj-imgs"></div>';
    if (c.type === 'showpresets') return `<div class="preset-row"><input id="vj-spname" class="rt-input" placeholder="name this show…" spellcheck="false" /><button class="act" id="vj-spsave" title="Save the whole theme stack and every setting">SAVE</button></div><div id="vj-splist" class="vj-plist"></div><div class="dim tiny">click or press 1-9 to recall · right-click to rename or delete</div>`;
    if (c.type === 'lookpack') return `<div class="vj-plist">${LOOK_PACK.map((l, i) => `<button class="vj-pchip" data-lpack="${i}" title="${esc(l.tip)}">${esc(l.name)}</button>`).join('')}</div><div class="dim tiny">one-click loop looks: they set the theme, colours, camera punch and build/drop for you</div>`;
    if (c.type === 'looprec') return `<div class="preset-row"><button class="act" id="vj-rec" title="Plays the BPM clock from bar 1 and saves exactly this many bars as a WebM video (ULTRA quality, 60 fps)">● RECORD LOOP</button></div><div class="dim tiny" id="vj-recstat"></div>`;
    if (c.type === 'presets') return `<div class="preset-row"><input id="vj-pname" class="rt-input" placeholder="name this look…" spellcheck="false" /><button class="act" id="vj-psave">SAVE</button><button class="act" id="vj-random" title="Roll a random look">🎲 RANDOM</button></div><div id="vj-plist" class="vj-plist"></div>`;
    if (c.type === 'wallpaper') return `<div class="sp-top"><label class="switch" title="Put the visualizer behind your desktop icons"><input type="checkbox" id="wp-on" /><span></span></label><div id="wp-status" class="sp-status">off</div></div>
      <div id="wp-displays" class="wp-displays"></div>
      <div class="sp-grid"><div class="seg small" id="wp-fps"><button data-v="30">30 FPS</button><button data-v="60">60 FPS</button></div>
      <div class="seg small" id="wp-q"><button data-v="eco">ECO</button><button data-v="balanced">BALANCED</button></div></div>
      <label class="check"><input type="checkbox" id="wp-pause" /> pause while a game or video fills the screen</label>`;
    if (c.type === 'check') return `<label class="check"><input type="checkbox" data-k="${c.k}" /> ${c.label}</label>`;
    if (c.type === 'range') return `<label>${c.label} <b data-v="${c.k}"></b></label><input type="range" class="slider" data-k="${c.k}" min="${c.min}" max="${c.max}" step="${c.step}" />`;
    if (c.type === 'seg') return `<label>${c.label}</label><div class="seg small" data-seg="${c.k}">${c.options.map(([v, l]) => `<button data-v="${v}">${l}</button>`).join('')}</div>`;
    if (c.type === 'source') return '<label>LISTEN TO</label><select id="vj-source"><option value="default">laptop output (whatever is playing)</option></select>';
    if (c.type === 'output') return '<label>SEND TO DISPLAY</label><select id="vj-display"></select><div class="seg small" style="margin-top:6px"><button id="vj-send">OPEN OUTPUT</button><button id="vj-close">CLOSE OUTPUT</button></div>';
    if (c.type === 'spout') return `<div class="sp-top"><label class="switch" title="Send these visuals out over Spout"><input type="checkbox" id="sp-on" /><span></span></label><div id="sp-status" class="sp-status">off</div></div>
      <div class="sp-grid"><input id="sp-name" class="rt-input" spellcheck="false" title="The name receivers will list" /><select id="sp-res">
        <option value="1280x720">1280 × 720</option><option value="1920x1080">1920 × 1080</option><option value="2560x1440">2560 × 1440</option><option value="3840x2160">3840 × 2160</option></select></div>
      <div class="sp-grid"><div class="seg small" id="sp-fps"><button data-v="30">30 FPS</button><button data-v="60">60 FPS</button></div>
      <div class="seg small" id="sp-gpu" title="Must match the GPU your receiving app runs on"><button data-v="nvidia">NVIDIA</button><button data-v="integrated">INTEL</button></div></div>
      <div class="seg small" id="sp-when" title="Sending frames is heavy: by default it only runs while Resolume, OBS, MilkDrop, TouchDesigner or another VJ app is open"><button data-v="vjapp">ONLY WHILE A VJ APP IS OPEN</button><button data-v="always">ALWAYS</button></div>
      <div class="dim tiny sp-hint">Resolume: Sources → Spout → <b id="sp-hint-name">HYPERSPACE</b> · OBS: Spout2 Capture · TouchDesigner: Syphon Spout In</div>`;
    if (c.type === 'reset') return '<div class="seg small" style="margin-top:12px"><button id="vj-reset">RESET VJ SETTINGS</button></div>';
    return '';
  }).join('');

  function syncControls() {
    for (const el of box.querySelectorAll('[data-k]')) {
      const k = el.dataset.k;
      if (el.type === 'checkbox') el.checked = !!S[k];
      else { el.value = S[k]; const c = CONTROLS.find((x) => x.k === k); const lbl = box.querySelector(`[data-v="${k}"]`); if (lbl) lbl.textContent = fmt(c, S[k]); }
    }
    const favs = S.favs || [];
    box.querySelectorAll('[data-theme]').forEach((b) => {
      b.classList.toggle('on', b.dataset.theme === S.theme);
      b.classList.toggle('stacked', b.dataset.theme !== S.theme && (S.stack || []).includes(b.dataset.theme));
      b.classList.toggle('fav', favs.includes(b.dataset.theme));
    });
    box.querySelectorAll('[data-pal]').forEach((b) => b.classList.toggle('on', b.dataset.pal === S.palette));
    box.querySelectorAll('[data-seg]').forEach((seg) => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === String(S[seg.dataset.seg]))));
    const src = document.getElementById('vj-source');
    if (src && [...src.options].some((o) => o.value === S.source)) src.value = S.source;
    const l2 = document.getElementById('vj-layer2');
    if (l2) l2.value = S.layer2;
  }
  box.addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    setS({ [k]: e.target.type === 'checkbox' ? e.target.checked : Number(e.target.value) });
    if (k === 'clockBpm') setRecUi();
  });
  box.addEventListener('click', (e) => {
    const th = e.target.closest('[data-theme]');
    if (th) {
      const k = th.dataset.theme;
      if (!e.shiftKey) return setS({ theme: k, stack: [] });
      if (k === S.theme) return;
      const st = (S.stack || []).filter((x) => x !== S.theme);
      if (st.includes(k)) return setS({ stack: st.filter((x) => x !== k) });
      if (st.length >= 4) return toast('UP TO 4 STACKED THEMES (shift-click one to drop it)');
      return setS({ stack: [...st, k] });
    }
    const pal = e.target.closest('[data-pal]');
    if (pal) return setS({ palette: pal.dataset.pal });
    const sg = e.target.closest('[data-seg] button');
    if (sg) { const v = sg.dataset.v; setS({ [sg.parentElement.dataset.seg]: isNaN(Number(v)) ? v : Number(v) }); if (sg.parentElement.dataset.seg === 'loopBars') setRecUi(); return; }
    if (e.target.id === 'vj-reset' && confirm('Reset every VJ slider? Saved presets stay.')) { setS({ ...DEFAULTS, favs: S.favs || [] }); toast('VJ SETTINGS RESET'); }
    if (e.target.id === 'vj-send') hs.call('vjOut', Number(document.getElementById('vj-display').value)).then(() => toast('VJ OUTPUT OPEN · ESC CLOSES IT')).catch((er) => toast(er.message, true));
    if (e.target.id === 'vj-close') hs.call('vjOut', null).catch(() => {});
    if (e.target.id === 'vj-random') randomLook();
    if (e.target.id === 'vj-psave') savePreset();
    if (e.target.id === 'vj-rec') recordLoop();
    const lp = e.target.closest('[data-lpack]');
    if (lp) { const l = LOOK_PACK[+lp.dataset.lpack]; setS({ ...l.s }); toast(`LOOK · ${l.name}`); setRecUi(); }
    const pb = e.target.closest('[data-preset]');
    if (pb) {
      const list = HS.config.vjPresets || [];
      if (e.target.classList.contains('x')) { HS.saveConfig({ vjPresets: list.filter((p) => p.name !== pb.dataset.preset) }).then(renderPresets); return; }
      const p = list.find((x) => x.name === pb.dataset.preset);
      if (p) { setS({ ...p.s }); toast(`LOOK · ${p.name.toUpperCase()}`); }
    }
  });
  box.addEventListener('contextmenu', (e) => {
    const th = e.target.closest('[data-theme]');
    if (!th) return;
    e.preventDefault();
    const favs = new Set(S.favs || []);
    favs.has(th.dataset.theme) ? favs.delete(th.dataset.theme) : favs.add(th.dataset.theme);
    setS({ favs: [...favs] });
    toast(`${favs.has(th.dataset.theme) ? '★' : '☆'} ${themeName(th.dataset.theme)}`);
  });
  box.addEventListener('change', (e) => {
    if (e.target.id === 'vj-source') setS({ source: e.target.value });
    if (e.target.id === 'vj-layer2') setS({ layer2: e.target.value });
  });

  // ---------------- pictures ----------------
  function renderImgs() {
    const box = document.getElementById('vj-imgs');
    if (!box) return;
    box.innerHTML = `<button class="img-tile none${S.img === 'none' ? ' on' : ''}" data-img="none">NONE</button>` +
      imgList.map((n) => `<button class="img-tile${S.img === n ? ' on' : ''}" data-img="${esc(n)}" title="${n === '@logo' ? 'SUBASHTON logo' : esc(n)}" style="background-image:url('${imgUrl(n)}')">${n === '@logo' ? '' : '<span class="x" title="Remove">✕</span>'}</button>`).join('') +
      '<button class="img-tile add" id="vj-imgadd" title="Add pictures">＋</button>';
  }
  document.getElementById('vj-imgs')?.addEventListener('click', async (e) => {
    if (e.target.closest('#vj-imgadd')) { await hs.call('vjImageAdd'); return; }
    const t = e.target.closest('[data-img]');
    if (!t) return;
    if (e.target.classList.contains('x')) { if (S.img === t.dataset.img) setS({ img: 'none' }); await hs.call('vjImageRemove', t.dataset.img); return; }
    setS({ img: t.dataset.img });
    renderImgs();
  });
  renderImgs();

  // ---------------- looks: presets + dice ----------------
  // a look is everything visual; audio source, quality and favourites stay as they are
  const NOT_LOOK = ['source', 'quality', 'fps', 'favs', 'reactUi', 'auto', 'autoMode', 'autoBeats', 'sensitivity'];
  const look = () => Object.fromEntries(Object.entries(S).filter(([k]) => !NOT_LOOK.includes(k)));
  function renderPresets() {
    const list = HS.config.vjPresets || [];
    document.getElementById('vj-plist').innerHTML = list.length
      ? list.map((p) => `<button class="vj-pchip" data-preset="${esc(p.name)}" title="${esc(themeName(p.s.theme))}">${esc(p.name)}<span class="x" title="Delete">✕</span></button>`).join('')
      : '<span class="dim tiny">no saved looks yet</span>';
  }
  function savePreset() {
    const inp = document.getElementById('vj-pname');
    const name = inp.value.trim() || `${themeName(S.theme)} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const list = (HS.config.vjPresets || []).filter((p) => p.name !== name);
    HS.saveConfig({ vjPresets: [...list, { name, s: look() }] }).then(renderPresets);
    inp.value = '';
    toast(`LOOK SAVED · ${name.toUpperCase()}`);
  }
  function randomLook() {
    const pick = (a) => a[(Math.random() * a.length) | 0];
    const keys = Object.keys(THEMES);
    const r = (a, b, d = 2) => +(a + Math.random() * (b - a)).toFixed(d);
    setS({
      theme: pick(keys), stack: [], palette: Math.random() < 0.45 ? 'matrix' : pick(Object.keys(PALETTES)),
      complexity: 1 + ((Math.random() * 5) | 0), fold: 5 + ((Math.random() * 8) | 0), scale: r(0.75, 1.15), lineW: r(0.8, 1.7), tilt: r(0, 1),
      speed: r(0.4, 1.8), dir: pick(['cw', 'ccw', 'pingpong']), punch: r(0.5, 3, 1), zoom: r(0, 0.7), trails: r(0.72, 0.94),
      glow: r(0.6, 1.4), chroma: r(0, 0.6), kaleido: pick([0, 0, 0, 6, 8]), mirror: pick([0, 0, 0, 1, 3]), hue: Math.round(r(-25, 25)),
      layer2: Math.random() < 0.5 ? 'none' : pick(keys), layer2Mix: r(0.3, 0.7), layer2Scale: r(0.4, 0.95),
      backdrop: pick(['none', 'none', 'rain', 'stars', 'grid', 'particles']),
    });
    toast(`🎲 ${document.getElementById('vj-theme-name').textContent}`);
  }
  HS.actions.vjRandom = randomLook;
  hs.on('config', () => renderPresets());
  renderPresets();

  // ---------------- show presets: the whole theme stack + every parameter, recalled with one click or keys 1-9 ----------------
  const SP_KEY = 'hs-vj-presets', SP_SKIP = ['source', 'quality', 'fps', 'favs'];
  let spRename = -1;
  const spLoad = () => { try { const l = JSON.parse(localStorage.getItem(SP_KEY) || '[]'); return Array.isArray(l) ? l.filter((p) => p && p.name && p.s) : []; } catch { return []; } };
  const spStore = (l) => { try { localStorage.setItem(SP_KEY, JSON.stringify(l)); } catch {} renderShowPresets(); };
  function renderShowPresets() {
    const box = document.getElementById('vj-splist');
    if (!box) return;
    const l = spLoad();
    box.innerHTML = l.length ? l.map((p, i) => spRename === i
      ? `<input class="rt-input vj-sprn" data-i="${i}" value="${esc(p.name)}" spellcheck="false" />`
      : `<button class="vj-pchip" data-sp="${i}" title="${esc([p.s.theme, ...(p.s.stack || [])].map(themeName).join(' + '))}">${i < 9 ? `<b>${i + 1}</b>` : ''}${esc(p.name)}</button>`).join('')
      : '<span class="dim tiny">no saved shows yet</span>';
    const rn = box.querySelector('.vj-sprn'); if (rn) { rn.focus(); rn.select(); }
  }
  function recallShow(i) {
    const p = spLoad()[i];
    if (!p) return;
    setS({ ...p.s });
    toast(`SHOW · ${p.name.toUpperCase()}`);
  }
  HS.actions.vjRecall = recallShow;
  document.getElementById('vj-controls').addEventListener('click', (e) => {
    if (e.target.id === 'vj-spsave') {
      const inp = document.getElementById('vj-spname');
      const name = inp.value.trim() || `${themeName(S.theme)}${(S.stack || []).length ? ' +' + S.stack.length : ''} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      const s = Object.fromEntries(Object.entries(S).filter(([k]) => !SP_SKIP.includes(k)));
      spStore([...spLoad().filter((p) => p.name !== name), { name, s }]);
      inp.value = ''; toast(`SHOW SAVED · ${name.toUpperCase()}`);
      return;
    }
    const c = e.target.closest('[data-sp]');
    if (c) recallShow(+c.dataset.sp);
  });
  document.getElementById('vj-controls').addEventListener('contextmenu', (e) => {
    const c = e.target.closest('[data-sp]');
    if (!c || !window.hsMenu) return;
    e.preventDefault();
    const i = +c.dataset.sp, p = spLoad()[i];
    window.hsMenu(e, [
      { label: 'Recall', run: () => recallShow(i) },
      { label: 'Rename', run: () => { spRename = i; renderShowPresets(); } },
      { label: 'Overwrite with the current look', run: () => { const l = spLoad(); l[i] = { name: p.name, s: Object.fromEntries(Object.entries(S).filter(([k]) => !SP_SKIP.includes(k))) }; spStore(l); toast('SHOW UPDATED'); } },
      '-',
      { label: 'Delete', danger: true, run: () => spStore(spLoad().filter((_, k) => k !== i)) },
    ], p.name);
  });
  const spCommit = (inp, ok) => {
    const l = spLoad(), i = +inp.dataset.i, nm = inp.value.trim();
    spRename = -1;
    if (ok && nm && l[i]) { l[i].name = nm; spStore(l); } else renderShowPresets();
  };
  document.getElementById('vj-controls').addEventListener('keydown', (e) => {
    if (!e.target.classList?.contains('vj-sprn')) return;
    e.stopPropagation();
    if (e.key === 'Enter') spCommit(e.target, true); else if (e.key === 'Escape') spCommit(e.target, false);
  });
  document.getElementById('vj-controls').addEventListener('focusout', (e) => { if (e.target.classList?.contains('vj-sprn') && spRename >= 0) spCommit(e.target, true); });
  window.addEventListener('keydown', (e) => {
    if (!HS.inVJ() || e.ctrlKey || e.altKey || e.metaKey || !/^[1-9]$/.test(e.key) || ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable) return;
    recallShow(+e.key - 1);
  });
  renderShowPresets();

  // ---------------- live wallpaper ----------------
  let wp = null;
  function renderWall(st) {
    wp = st;
    $('#wp-on').checked = !!st.enabled;
    $('#wp-pause').checked = st.pauseCovered !== false;
    $$('#wp-fps button').forEach((b) => b.classList.toggle('on', +b.dataset.v === st.fps));
    $$('#wp-q button').forEach((b) => b.classList.toggle('on', b.dataset.v === st.quality));
    $('#wp-displays').innerHTML = (st.displays || []).map((d) => `<label class="check"><input type="checkbox" data-wd="${d.id}"${st.screens.includes(String(d.id)) ? ' checked' : ''} /> ${esc(d.label)}</label>`).join('');
    const el = $('#wp-status');
    el.classList.toggle('live', !!st.live);
    el.classList.toggle('bad', !!st.error);
    el.textContent = st.error ? `⚠ ${st.error}` : st.live ? `● ON THE DESKTOP · ${st.live} screen${st.live > 1 ? 's' : ''}${st.paused ? ' · paused (covered)' : ''}` : st.enabled ? 'starting…' : 'off · beats behind your desktop icons';
  }
  const wpSet = (patch) => hs.call('wallSet', patch).then((s) => {
    renderWall(s);
    if (s.restartHint) setTimeout(() => toast('IF THE WALLPAPER EVER FREEZES, RESTART HYPERSPACE ONCE'), 2800);
  }).catch((e) => toast(e.message, true));
  $('#wp-on').addEventListener('change', (e) => { wpSet({ enabled: e.target.checked }); toast(e.target.checked ? 'LIVE WALLPAPER ON · PEEK AT YOUR DESKTOP' : 'WALLPAPER BACK TO NORMAL'); });
  $('#wp-pause').addEventListener('change', (e) => wpSet({ pauseCovered: e.target.checked }));
  $('#wp-fps').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) wpSet({ fps: +b.dataset.v }); });
  $('#wp-q').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) wpSet({ quality: b.dataset.v }); });
  $('#wp-displays').addEventListener('change', (e) => {
    const ids = $$('#wp-displays [data-wd]').filter((x) => x.checked).map((x) => x.dataset.wd);
    if (!ids.length) { toast('PICK AT LEAST ONE SCREEN', true); renderWall(wp); return; }
    wpSet({ screens: ids });
  });
  hs.on('wallpaper', renderWall);
  hs.call('wallGet').then(renderWall).catch(() => {});
  HS.actions.wallToggle = () => { const on = !wp?.enabled; wpSet({ enabled: on }); toast(on ? 'LIVE WALLPAPER ON' : 'LIVE WALLPAPER OFF'); };

  // Spout controls
  let sp = null;
  function renderSpout(st) {
    sp = st;
    $('#sp-on').checked = !!st.enabled;
    if (document.activeElement !== $('#sp-name')) $('#sp-name').value = st.name;
    $('#sp-hint-name').textContent = st.name;
    $('#sp-res').value = `${st.width}x${st.height}`;
    $$('#sp-fps button').forEach((b) => b.classList.toggle('on', +b.dataset.v === st.fps));
    $$('#sp-gpu button').forEach((b) => b.classList.toggle('on', b.dataset.v === st.gpu));
    $$('#sp-when button').forEach((b) => b.classList.toggle('on', b.dataset.v === (st.when || 'vjapp')));
    const live = st.running && st.fps > 0;
    const el = $('#sp-status');
    el.classList.toggle('live', live);
    el.classList.toggle('bad', !!st.error);
    el.textContent = st.error ? `⚠ ${st.error}` : live ? `● LIVE · ${st.size} @ ${st.fps} fps · ${(st.adapter || '').replace(/NVIDIA GeForce |Intel\(R\) /, '')}`
      : st.waiting ? '◌ ready · starts when Resolume, OBS, MilkDrop or another VJ app opens' : st.enabled ? 'starting…' : 'off · flip on to feed Resolume, MilkDrop, OBS';
    $('#vj-spout').classList.toggle('hidden', !live);
  }
  const spSet = (patch) => hs.call('spoutSet', patch).then(renderSpout).catch((e) => toast(e.message, true));
  $('#sp-on').addEventListener('change', (e) => { spSet({ enabled: e.target.checked }); toast(e.target.checked ? `SPOUT ON · LOOK FOR "${sp?.name || 'HYPERSPACE'}"` : 'SPOUT OFF'); });
  $('#sp-name').addEventListener('change', (e) => spSet({ name: e.target.value }));
  $('#sp-res').addEventListener('change', (e) => { const [w, h] = e.target.value.split('x').map(Number); spSet({ width: w, height: h }); });
  $('#sp-fps').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) spSet({ fps: +b.dataset.v }); });
  $('#sp-gpu').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) spSet({ gpu: b.dataset.v }); });
  $('#sp-when').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) spSet({ when: b.dataset.v }); });
  hs.on('spout', renderSpout);
  hs.call('spoutGet').then(renderSpout).catch(() => {});
  HS.actions.spoutToggle = () => { const on = !sp?.enabled; spSet({ enabled: on }); toast(on ? 'SPOUT ON' : 'SPOUT OFF'); };

  async function loadSources() {
    try {
      const d = await coreCall('audio.devices');
      const sel = document.getElementById('vj-source');
      sel.innerHTML = '<option value="default">laptop output (whatever is playing)</option>' +
        d.outputs.map((o) => `<option value="render:${o.id}">output · ${esc(o.name)}</option>`).join('') +
        d.inputs.map((o) => `<option value="capture:${o.id}">input · ${esc(o.name)}</option>`).join('');
      syncControls();
    } catch {}
    try {
      const ds = await hs.call('vjDisplays');
      document.getElementById('vj-display').innerHTML = ds.map((d) => `<option value="${d.id}"${d.primary ? '' : ' selected'}>${esc(d.label)}</option>`).join('');
    } catch {
      document.getElementById('vj-display').innerHTML = '<option>only on the laptop</option>';
    }
  }
  HS.onView(() => { if (HS.inVJ()) loadSources(); }); window.addEventListener('hs-crate-section', () => { if (HS.inVJ()) loadSources(); });
  hs.on('core', (s) => { if (s.state === 'online' && HS.inVJ()) loadSources(); });

  document.getElementById('vj-fs').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen(); else stage.requestFullscreen().catch(() => {});
  });
  window.addEventListener('keydown', (e) => {
    if (!HS.inVJ() || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'f' || e.key === 'F') document.getElementById('vj-fs').click();
    if (e.key === ' ') { e.preventDefault(); nextTheme(); }
  });
  setRecUi();
  hs.on('audio', () => {
    const src = document.getElementById('vj-src');
    if (src) src.textContent = A.silent ? 'silence…' : `beats ${A.beats}`;
  });
})();
