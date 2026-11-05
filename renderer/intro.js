// HYPERSPACE boot sequence (~7.4 s, click or any key skips):
//   Om / trident / wheel of samsara glitch out of the rain -> an emblem of sacred geometry is assembled piece by piece from
//   falling glyphs -> ignition + bloom -> title decode -> warp into the UI.
// Sound is synthesized with Web Audio (no files). Mode: full | silent | off (localStorage 'intro').
(() => {
  const TAU = Math.PI * 2;
  const root = document.getElementById('intro');
  const cv = root.querySelector('canvas');
  const ctx = cv.getContext('2d');
  const titleEl = root.querySelector('.intro-title');
  const mainEl = root.querySelector('.it-main');
  const subEl = root.querySelector('.it-sub');
  const GLYPHS = Array.from({ length: 46 }, (_, i) => String.fromCharCode(0xFF71 + i)).join('') + '0123456789\u2609\u263D\u2721\u269B\u25B3\u25BD\u25EC\u232C\u2742\u229B';
  const TITLE = 'HYPERSPACE';
  // emblem = 'sigil' of sacred geometry. Symbols (Om, trident, wheel) 0-2.7 s, emblem assembles from the rain to ignition
  const T = { rain: 0.15, vortex: 2.7, ignite: 4.7, title: 5.2, drain: 6.2, warp: 6.5, end: 7.4 };

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
  let cols = [], sparks = null, start = 0;

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

  // ---------------- shapes: Om, trident, wheel of samsara, and the HYPERSPACE emblem ----------------
  // Everything is drawn procedurally (no fonts, no images). A "group" is a set of polylines. Each group is shown two
  // ways at once: falling green glyphs that land on the lines, and the sharp luminous line art that comes into focus
  // out of a glitch (colour-split, jittering) as the glyphs settle.
  const fxHigh = () => document.body.dataset.fx === 'high';
  const COL = [[0, 255, 110], [80, 240, 255], [255, 120, 190], [150, 90, 255], [234, 255, 239]]; // green, cyan, pink, purple, white
  let syms = [], symO = [], emb = [], embO = [], AM = 1;

  const bez = (a, b, c, d, n = 22) => {
    const o = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n, v = 1 - u;
      o.push([v * v * v * a[0] + 3 * v * v * u * b[0] + 3 * v * u * u * c[0] + u * u * u * d[0], v * v * v * a[1] + 3 * v * v * u * b[1] + 3 * v * u * u * c[1] + u * u * u * d[1]]);
    }
    return o;
  };
  const circ = (cx, cy, r, a0 = 0, a1 = TAU, n = 56) => Array.from({ length: n + 1 }, (_, i) => [cx + Math.cos(a0 + ((a1 - a0) * i) / n) * r, cy + Math.sin(a0 + ((a1 - a0) * i) / n) * r]);
  const P = (p, c = 0, a = 1, w = 1.6, np = false) => ({ p, c, a, w, np });

  function omPolys() {
    const body = [].concat(
      bez([-0.55, -0.4], [-0.25, -0.75], [0.25, -0.65], [0.12, -0.3]),
      bez([0.12, -0.3], [0.04, -0.1], [-0.15, -0.05], [-0.32, -0.05]),
      bez([-0.32, -0.05], [0.2, -0.1], [0.62, 0.05], [0.52, 0.42]),
      bez([0.52, 0.42], [0.42, 0.82], [-0.2, 0.85], [-0.5, 0.6]),
      bez([-0.5, 0.6], [-0.68, 0.42], [-0.5, 0.22], [-0.3, 0.3]));
    return [P(body, 0, 1, 3.2), P(bez([0.15, -0.28], [0.4, -0.25], [0.7, -0.3], [0.66, 0.0]), 0, 1, 3.2),
      P(circ(0.42, -0.64, 0.2, 0.1 * Math.PI, 0.9 * Math.PI, 20), 2, 1, 3.2), P(circ(0.42, -0.72, 0.04, 0, TAU, 12), 1, 1, 4)];
  }
  function tridentPolys() {
    const shaft = [[0, -0.62], [0, 0.95]];
    const U = bez([-0.5, -0.62], [-0.5, -0.1], [-0.36, 0.08], [0, 0.08], 18).concat(bez([0, 0.08], [0.36, 0.08], [0.5, -0.1], [0.5, -0.62], 18));
    const head = (x) => [[x - 0.09, -0.5], [x, -0.82], [x + 0.09, -0.5], [x, -0.58], [x - 0.09, -0.5]];
    return [P(shaft, 0, 1, 3.2), P(U, 1, 1, 3.2), P(head(-0.5), 2, 1, 3), P(head(0), 2, 1, 3), P(head(0.5), 2, 1, 3),
      P([[-0.14, 0.2], [0.14, 0.2]], 0, 1, 3), P([[-0.1, 0.34], [0.1, 0.34]], 0, 0.8, 3), P([[-0.07, 0.95], [0, 1.05], [0.07, 0.95]], 0, 1, 3)];
  }
  function wheelPolys() {
    const o = [P(circ(0, 0, 0.88), 0, 1, 3.2), P(circ(0, 0, 0.78), 1, 0.7, 2), P(circ(0, 0, 0.17), 3, 1, 3), P(circ(0, 0, 0.07, 0, TAU, 20), 4, 1, 3.5)];
    for (let i = 0; i < 8; i++) {
      const a = (i * TAU) / 8, c = Math.cos(a), s = Math.sin(a);
      o.push(P([[c * 0.17, s * 0.17], [c * 0.78, s * 0.78]], 1, 1, 3));
      o.push(P(circ(c * 0.96, s * 0.96, 0.06, 0, TAU, 14), 2, 1, 3));
    }
    return o;
  }
  function emblemParts() {
    const ring = [P(circ(0, 0, 1, 0, TAU, 96), 0, 1, 2.4), P(circ(0, 0, 1.07, 0, TAU, 96), 1, 0.7, 1.2)];
    for (let i = 0; i < 72; i++) { const a = (i / 72) * TAU, c = Math.cos(a), s = Math.sin(a), l = i % 6 === 0 ? 0.1 : 0.04; ring.push(P([[c * 1.09, s * 1.09], [c * (1.09 + l), s * (1.09 + l)]], i % 6 === 0 ? 2 : 0, 0.8, 1.2, true)); }
    const r = 1 / 3, petals = [P(circ(0, 0, r), 0, 1, 1.6)];
    for (let i = 0; i < 6; i++) {
      const a = (i * TAU) / 6, b = ((i + 1) * TAU) / 6;
      petals.push(P(circ(Math.cos(a) * r, Math.sin(a) * r, r), 0, 0.9, 1.6));
      petals.push(P(circ(Math.cos(a) * 2 * r, Math.sin(a) * 2 * r, r), 3, 0.85, 1.4));
      petals.push(P(circ((Math.cos(a) + Math.cos(b)) * r, (Math.sin(a) + Math.sin(b)) * r, r), 0, 0.5, 1.2));
    }
    const R2 = 0.82, tri = (a0, c) => P(Array.from({ length: 4 }, (_, i) => [Math.cos(a0 + (i * TAU) / 3) * R2, Math.sin(a0 + (i * TAU) / 3) * R2]), c, 1, 2.2);
    const star = [tri(-Math.PI / 2, 1), tri(Math.PI / 2, 2),
      P(Array.from({ length: 7 }, (_, i) => [Math.cos(-Math.PI / 3 + (i * TAU) / 6) * R2 / 1.732, Math.sin(-Math.PI / 3 + (i * TAU) / 6) * R2 / 1.732]), 0, 0.7, 1.4)];
    for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + (i * TAU) / 6; star.push(P([[Math.cos(a) * 0.12, Math.sin(a) * 0.12], [Math.cos(a) * R2, Math.sin(a) * R2]], 0, 0.35, 1, true)); }
    const eyeTop = bez([-0.3, 0], [-0.1, -0.3], [0.1, -0.3], [0.3, 0]), eyeBot = bez([-0.3, 0], [-0.1, 0.3], [0.1, 0.3], [0.3, 0]);
    const hub = [P(circ(0, 0, 0.32, 0, TAU, 48), 0, 0.5, 1.2), P(eyeTop, 4, 1, 2), P(eyeBot, 4, 1, 2), P(circ(0, 0, 0.1, 0, TAU, 28), 1, 1, 2.2), P(circ(0, 0, 0.04, 0, TAU, 16), 4, 1, 3.5)];
    return [ring, petals, star, hub];
  }

  // turn polylines (unit coords) into a drawable group: one Path2D per style, plus glyph particles along the lines
  function buildGroup(polys, sc, maxN, rot) {
    const hi = fxHigh(), cls = {}, scaled = [];
    let total = 0;
    for (const o of polys) {
      const p = o.p.map(([x, y]) => [x * sc, y * sc]);
      const key = `${o.c}|${o.a}|${o.w}`;
      const c = cls[key] || (cls[key] = { c: o.c, a: o.a, w: o.w, path: new Path2D() });
      c.path.moveTo(p[0][0], p[0][1]);
      for (let i = 1; i < p.length; i++) c.path.lineTo(p[i][0], p[i][1]);
      if (o.np) continue;
      scaled.push(p);
      for (let i = 1; i < p.length; i++) total += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    }
    const sp = Math.max(9 * k * (hi ? 1 : 1.8), total / (hi ? maxN : maxN * 0.55)), pts = [];
    for (const p of scaled) {
      let carry = 0;
      for (let i = 1; i < p.length; i++) {
        const dx = p[i][0] - p[i - 1][0], dy = p[i][1] - p[i - 1][1], L = Math.hypot(dx, dy);
        if (!L) continue;
        for (let d = sp - carry; d <= L; d += sp) pts.push({ x: p[i - 1][0] + (dx * d) / L, y: p[i - 1][1] + (dy * d) / L, ch: glyph(), d: Math.random(), fall: H * (0.6 + Math.random() * 0.5), cx: 0, cy: 0, arr: true });
        carry = (carry + L) % sp;
      }
    }
    return { cls: Object.values(cls), pts, rot };
  }

  const emblemRot = (t) => (t > T.ignite ? (t - T.ignite) * 0.3 : 0) + easeIn(seg(t, T.warp, T.end)) * 5;
  function buildShapes() {
    const sz = S * 0.2, R = S * 0.3;
    syms = [buildGroup(omPolys(), sz, 170, null), buildGroup(tridentPolys(), sz, 170, null), buildGroup(wheelPolys(), sz, 190, (t) => (t - 1.8) * 0.9)];
    symO = [0.1, 0.95, 1.8].map((s) => ({ t0: s, dur: 0.62, sIn0: s + 0.12, sIn1: s + 0.6, sOut: s + 0.74, sOutLen: 0.12, gFade: s + 0.72, gLen: 0.25, fall: true }));
    const parts = emblemParts(), caps = [130, 260, 150, 70];
    emb = parts.map((pl, i) => buildGroup(pl, R, caps[i], i === 2 ? (t) => emblemRot(t) - (t > T.ignite ? (t - T.ignite) * 0.55 : 0) : emblemRot));
    const wins = [[T.vortex, 0.7], [T.vortex + 0.45, 0.8], [T.vortex + 1.0, 0.7], [T.vortex + 1.5, 0.5]];
    const flash = (t) => (t >= T.ignite ? Math.exp(-(t - T.ignite) * 5) : 0);
    embO = wins.map(([a, d]) => ({ t0: a, dur: d, sIn0: a + d * 0.7, sIn1: a + d + 0.2, sOut: 1e9, sOutLen: 1, gFade: a + d, gLen: 0.35, fall: false, flash }));
  }

  function drawGroup(g, t, o) {
    const gl = 1 - seg(t, o.sIn0, o.sIn1);
    const sa = seg(t, o.sIn0, o.sIn1 + 0.05) * (1 - seg(t, o.sOut, o.sOut + o.sOutLen)) * AM;
    const ga = (1 - seg(t, o.gFade, o.gFade + o.gLen)) * AM;
    const showG = t > o.t0 && ga > 0.01, showS = sa > 0.01;
    if (!showG && !showS) return;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    if (g.rot) ctx.rotate(g.rot(t));
    if (showG) {
      ctx.font = `${(14 * k).toFixed(1)}px "Share Tech Mono", monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const A = o.dur * 0.55, w = o.fall ? seg(t, o.gFade, o.gFade + o.gLen) : 0;
      for (const p of g.pts) {
        if (Math.random() < 0.22) p.ch = glyph();
        const u = easeOut(clamp01((t - o.t0 - p.d * o.dur * 0.45) / A));
        p.cx = p.x; p.cy = p.y - p.fall * (1 - u) + w * w * H * 0.5 * (0.4 + p.d); p.arr = u < 0.97;
      }
      ctx.fillStyle = 'rgb(220,255,232)'; ctx.globalAlpha = ga * 0.9;
      for (const p of g.pts) if (p.arr) ctx.fillText(p.ch, p.cx, p.cy);
      ctx.fillStyle = 'rgb(0,255,110)'; ctx.globalAlpha = ga * 0.7;
      for (const p of g.pts) if (!p.arr) ctx.fillText(p.ch, p.cx, p.cy);
    }
    if (showS) {
      const hi = fxHigh(), fl = o.flash ? o.flash(t) : 0;
      ctx.lineJoin = ctx.lineCap = 'round';
      ctx.globalAlpha = 1;
      const pass = (dx, a, wm, col) => {
        if (dx) ctx.translate(dx, 0);
        for (const c of g.cls) {
          const q = col || COL[c.c];
          ctx.strokeStyle = `rgba(${q[0]},${q[1]},${q[2]},${Math.min(1, a * c.a).toFixed(3)})`;
          ctx.lineWidth = c.w * k * wm; ctx.stroke(c.path);
        }
        if (dx) ctx.translate(-dx, 0);
      };
      if (hi) pass(0, sa * 0.14, 4.5);
      if (gl > 0.05) {
        if (hi) { pass(-gl * 16 * k, sa * 0.45, 1, COL[2]); pass(gl * 16 * k, sa * 0.45, 1, COL[1]); }
        if (Math.random() > gl * 0.55) pass((Math.random() - 0.5) * gl * 20 * k, sa, 1);
      } else pass(0, sa, 1);
      if (fl > 0.02) pass(0, fl * sa * 0.8, 1.6, COL[4]);
    }
    ctx.restore();
  }

  function drawSymbols(t) { for (let i = 0; i < syms.length; i++) if (t < symO[i].gFade + symO[i].gLen + 0.05) drawGroup(syms[i], t, symO[i]); }

  // the emblem: ring, then petals, then the star, then the hub come into focus out of the rain; after ignition it turns slowly
  function drawEmblem(t) {
    if (t < embO[0].t0) return;
    const age = t - T.ignite, out = seg(t, T.warp, T.warp + 0.55);
    const sc = t < T.ignite ? 1 : (1 + 0.06 * Math.exp(-age * 3) + Math.sin(t * 1.6) * 0.008) * (1 + easeIn(seg(t, T.warp, T.end)) * 1.2);
    AM = 1 - out;
    ctx.save();
    ctx.translate(W / 2, H / 2); ctx.scale(sc, sc); ctx.translate(-W / 2, -H / 2);
    for (let i = 0; i < emb.length; i++) drawGroup(emb[i], t, embO[i]);
    ctx.restore();
    AM = 1;
    // core glow building toward ignition
    const u = seg(t, T.vortex + 1.2, T.ignite) * (1 - seg(t, T.ignite, T.ignite + 0.4));
    if (u > 0.01) {
      const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, S * (0.05 + u * 0.12));
      g.addColorStop(0, `rgba(234,255,239,${u * 0.8})`); g.addColorStop(0.4, `rgba(0,255,110,${u * 0.5})`); g.addColorStop(1, 'rgba(0,255,110,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
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

  function rainY(c, t) { const v = t - T.rain - c.delay; return v < 0 ? -1e9 : (v * c.speed * H * 0.9) % (H + 16 * 18 * k); }

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

    const rf = 0.45 * seg(t, T.rain, T.rain + 0.4) * (1 - seg(t, T.ignite, T.ignite + 0.6));
    if (rf > 0.01) drawRain(t, rf);
    if (t < T.ignite) {
      drawSymbols(t);
      drawEmblem(t);
    } else {
      if (!sparks) buildSparks();
      drawRays(t);
      drawEmblem(t);
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
    sparks = streaks = rayImg = null;
    document.body.classList.add('booting');
    resize();
    buildRain();
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    audio = mode === 'full' ? sound() : null;
    // build the heavy pieces now, not at the moment they first appear (that caused a hitch mid-intro)
    buildSparks();
    buildRays();
    buildShapes();
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
