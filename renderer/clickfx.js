// CLICK EFFECTS: one delegated capture listener, one overlay canvas, drawn only while something is alive.
// Classifies what was clicked and plays a random variant. Some effects launch from the rabbit's burrow (twr.homePoint).
// Settings: localStorage 'hs-clickfx' {level:'off|low|normal|max', house:true}; API: window.hsClickFx.
(() => {
  'use strict';
  if (window.hs && hs.remote) return;
  const KEY = 'hs-clickfx', LEVELS = ['off', 'low', 'normal', 'max'];
  let prefs = { level: 'off', geo: false, house: true }; // fresh install: all off; a stored setting wins
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch {}
  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)');
  const lite = () => document.body.classList.contains('lite') || !!(window.hs && hs.lite && hs.lite.on);
  const level = () => { if (!LEVELS.includes(prefs.level)) return 'off'; if (prefs.level !== 'off' && lite()) return 'low'; return prefs.level; };
  const mult = () => ({ off: 0, low: 0.5, normal: 1, max: 1.8 }[level()]);
  const R = (a, b) => a + Math.random() * (b - a), pick = (a) => a[(Math.random() * a.length) | 0], rint = (a, b) => Math.floor(R(a, b + 1));
  const GREEN = ['#00ff6e', '#9dffb8', '#00c853', '#1de9b6'], ACC = ['#00e5ff', '#ff4fd8', '#b388ff'], ALL = GREEN.concat(ACC), RED = ['#ff3b5c', '#ff6a3d', '#c2185b'];
  const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽﾊﾋﾌﾍﾎ01<>+*:=';
  const RUNES = '◈◇✦✧⬡⬢△▽⊕⊗☉✺';
  const rg = () => GLYPHS[rint(0, GLYPHS.length - 1)], rr = () => RUNES[rint(0, RUNES.length - 1)];

  let cv, cx, parts = [], effects = [], raf = 0, last = 0, dpr = 1, W = 0, H = 0, sliding = null, lastSl = 0;
  function ensure() {
    if (cv) return true;
    if (!document.body) return false;
    cv = document.createElement('canvas'); cv.id = 'hs-clickfx'; cv.setAttribute('aria-hidden', 'true');
    document.body.appendChild(cv); cx = cv.getContext('2d'); size();
    addEventListener('resize', size);
    return true;
  }
  function size() { dpr = Math.min(window.devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; cx.setTransform(dpr, 0, 0, dpr, 0, 0); }

  // ---- particle kinds: dot, pix, glyph, shard, ring, petals, hex, star, line (sweep), brackets, under, arc ----
  function add(p) { if (parts.length < 260) { p.age = 0; parts.push(p); } }
  function dots(x, y, n, o = {}) {
    for (let i = 0; i < n; i++) {
      const a = o.up ? -Math.PI / 2 + R(-0.7, 0.7) : R(0, 6.283), s = R(40, 150);
      add({ k: o.k || 'dot', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: o.g === undefined ? 120 : o.g, life: R(0.35, 0.8), c: o.c || pick(ALL), s: o.s || R(1.5, 3.2), r: R(0, 6.28), vr: R(-6, 6) });
    }
  }
  const ring = (x, y, c, r1 = 26, life = 0.5, sides = 0) => add({ k: 'ring', x, y, life, c, r1, sides, vx: 0, vy: 0, g: 0 });
  const glyph = (x, y, c, up = true, t) => add({ k: 'glyph', x, y, vx: R(-14, 14), vy: up ? R(-55, -30) : R(-20, 20), g: 0, life: R(0.7, 1.1), c, s: R(11, 15), t: t || rg() });
  const petals = (x, y, c, r = 22, life = 0.9) => add({ k: 'petals', x, y, life, c, r1: r, vx: 0, vy: 0, g: 0 });

  // ---- effects per class (each picks a random variant) ----
  const FX = {
    button(x, y, m) {
      const v = rint(0, 3);
      if (v === 0) dots(x, y, 8 * m, { k: 'pix', s: 3 });
      else if (v === 1) { dots(x, y, 6 * m, { k: 'pix', s: 2.5, c: pick(ACC) }); ring(x, y, '#00ff6e', 18, 0.4); }
      else if (v === 2) dots(x, y, 7 * m, { k: 'pix', up: true, s: 3, g: 200 });
      else dots(x, y, 5 * m, { k: 'pix', s: 3, c: '#9dffb8' });
      glyph(x, y - 6, pick(GREEN));
    },
    toggle(x, y, m, on) {
      if (on !== false) {
        ring(x, y, '#00ff6e', 22, 0.5); ring(x, y, pick(ACC), 12, 0.35);
        for (let i = 0; i < 6 * m; i++) { const a = R(0, 6.28); add({ k: 'glyph', x, y, vx: Math.cos(a) * 70, vy: Math.sin(a) * 70, g: 60, life: R(0.5, 0.8), c: pick(GREEN), s: 11, t: pick(['1', '0', '✓', '+']) }); }
      } else {
        ring(x, y, pick(RED), 16, 0.35);
        for (let i = 0; i < 9 * m; i++) add({ k: 'pix', x: x + R(-12, 12), y: y + R(-7, 7), vx: R(-30, 30), vy: R(-10, 10), g: 0, life: R(0.15, 0.35), c: pick(RED), s: R(1.5, 3), r: 0, vr: 0 });
      }
    },
    nav(x, y) { ring(x, y, pick(ALL), 20, 0.6, rint(0, 1) ? 6 : 3); if (Math.random() < 0.6) glyph(x, y, pick(ACC), true, rr()); },
    tab(x, y, m) { const v = rint(0, 2); if (v === 0) dots(x, y, 5 * m, { up: true, g: -20, s: 2 }); else if (v === 1) ring(x, y, pick(GREEN), 14, 0.35, 6); else glyph(x, y, pick(GREEN)); dots(x, y, 3 * m, { k: 'pix', up: true }); },
    row(x, y, m, on, el) {
      const r = el && el.getBoundingClientRect();
      if (r && r.width < W * 0.95 && r.height < H * 0.7) add({ k: 'line', x: r.left, y: r.top, w: r.width, h: r.height, life: 0.5, c: pick(GREEN), vx: 0, vy: 0, g: 0 });
      for (let i = 0; i < 4 * m; i++) add({ k: 'hex', x, y, vx: R(-70, 70), vy: R(-60, 20), g: 60, life: R(0.4, 0.7), c: pick(ALL), s: R(3, 5), r: R(0, 6), vr: R(-4, 4) });
    },
    link(x, y, m) { const v = rint(0, 2); if (v === 0) glyph(x, y, pick(ACC), true, '→'); else if (v === 1) dots(x, y, 5 * m, { up: true, c: pick(ACC), g: 0, s: 2 }); else ring(x, y, pick(ACC), 12, 0.35); },
    chevron(x, y, m) { dots(x, y, 4 * m, { k: 'pix', s: 2.5 }); ring(x, y, pick(GREEN), 12, 0.3); },
    danger(x, y, m) {
      for (let i = 0; i < 12 * m; i++) add({ k: 'shard', x: x + R(-14, 14), y: y + R(-6, 6), vx: R(-60, 60), vy: R(-50, 10), g: 360, life: R(0.5, 0.9), c: pick(RED.concat(['#00e5ff'])), s: R(8, 13), t: rg() });
      ring(x, y, pick(RED), 20, 0.35, 4);
    },
    save(x, y, m) { for (let i = 0; i < 6 * m; i++) add({ k: 'star', x: x + R(-10, 10), y, vx: R(-25, 25), vy: R(-110, -50), g: 60, life: R(0.5, 0.9), c: pick(['#c6ff00', '#9dffb8', '#00e5ff', '#ff4fd8']), s: R(3, 5.5), r: 0, vr: R(-4, 4) }); ring(x, y, '#c6ff00', 16, 0.4); },
    art(x, y, m) { const v = rint(0, 2); if (v === 0) ring(x, y, pick(ACC), 30, 0.7, 6); else if (v === 1) dots(x, y, 8 * m, { k: 'hex', s: 4 }); else petals(x, y, pick(ALL), 18, 0.8); },
    bg(x, y) { const v = Math.random(); if (v < 0.5) petals(x, y, pick(ALL), R(16, 26), R(0.8, 1.1)); else if (v < 0.75) ring(x, y, pick(ALL), 24, 0.7, rint(3, 6)); else { ring(x, y, pick(GREEN), 18, 0.5); glyph(x, y, pick(ACC), true, rr()); } },
    jackpot(x, y, m) {
      petals(x, y, '#c6ff00', 46, 1.4); petals(x, y, '#00e5ff', 30, 1.1); ring(x, y, '#ff4fd8', 60, 1.0, 6);
      for (let i = 0; i < 22 * m; i++) { const a = R(0, 6.28), s = R(80, 220); add({ k: 'glyph', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, g: 260, life: R(0.9, 1.5), c: pick(['#c6ff00', '#ffd54a', '#9dffb8']), s: R(12, 18), t: pick(['◈', '$', '¤', '₿', '✦']) }); }
    },
  };

  // ---- SACRED GEOMETRY ONLY: procedural line art that draws itself, turns a little and fades ----
  const TAU = 6.283185307, PHI = 1.618034;
  const poly = (n, r, rot = -1.5708, ox = 0, oy = 0) => { const a = []; for (let i = 0; i <= n; i++) { const t = rot + i * TAU / n; a.push([ox + Math.cos(t) * r, oy + Math.sin(t) * r]); } return a; };
  const circ = (x, y, r) => poly(40, r, 0, x, y);
  const seg2 = (a, b) => [a, b];
  function star(n, k, r, rot = -1.5708) { const v = []; for (let i = 0; i < n; i++) v.push([Math.cos(rot + i * TAU / n) * r, Math.sin(rot + i * TAU / n) * r]); const out = []; for (let i = 0; i <= n; i++) out.push(v[(i * k) % n]); return out; }
  const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  function solid(V) {
    const mx = Math.max(...V.map((v) => Math.hypot(v[0], v[1], v[2]))), N = V.map((v) => [v[0] / mx, v[1] / mx, v[2] / mx]);
    let m = 1e9; for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) m = Math.min(m, dist3(N[i], N[j]));
    const E = []; for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) if (dist3(N[i], N[j]) < m * 1.02) E.push([i, j]);
    return { V: N, E };
  }
  const SOL = {};
  const solidDef = {
    tetra: () => solid([[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]]),
    cube: () => solid([-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => [x, y, z])))),
    octa: () => solid([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]),
    icosa: () => { const V = []; for (const a of [-1, 1]) for (const b of [-PHI, PHI]) V.push([0, a, b], [a, b, 0], [b, 0, a]); return solid(V); },
    dodeca: () => { const V = []; for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) V.push([x, y, z]); for (const a of [-1, 1]) for (const b of [-1 / PHI, 1 / PHI]) V.push([0, a * PHI, b], [a * PHI, b, 0], [b, 0, a * PHI]); return solid(V); },
    merkaba: () => { const a = solidDef.tetra(); return { V: a.V.concat(a.V.map((v) => [-v[0], -v[1], -v[2]])), E: a.E.concat(a.E.map(([i, j]) => [i + 4, j + 4])) }; },
  };
  const FIG = { // flat figures: lists of polylines inside a unit circle
    flower() { const a = 1 / 3, L = [circ(0, 0, a)]; for (let i = 0; i < 6; i++) L.push(circ(Math.cos(i * 1.0472) * a, Math.sin(i * 1.0472) * a, a)); for (let i = 0; i < 6; i++) { L.push(circ(Math.cos(i * 1.0472) * 2 * a, Math.sin(i * 1.0472) * 2 * a, a)); L.push(circ(Math.cos(i * 1.0472 + 0.5236) * 1.732 * a, Math.sin(i * 1.0472 + 0.5236) * 1.732 * a, a)); } L.push(circ(0, 0, 1)); return L; },
    seed() { const a = 0.5, L = [circ(0, 0, a)]; for (let i = 0; i < 6; i++) L.push(circ(Math.cos(i * 1.0472) * a, Math.sin(i * 1.0472) * a, a)); L.push(circ(0, 0, 1)); return L; },
    vesica() { return [circ(-0.3, 0, 0.6), circ(0.3, 0, 0.6), seg2([0, -0.52], [0, 0.52]), seg2([-0.9, 0], [0.9, 0]), poly(3, 0.6)]; },
    metatron() { const C = [[0, 0]]; for (let i = 0; i < 6; i++) C.push([Math.cos(i * 1.0472 - 1.5708) * 0.5, Math.sin(i * 1.0472 - 1.5708) * 0.5]); for (let i = 0; i < 6; i++) C.push([Math.cos(i * 1.0472 - 1.5708), Math.sin(i * 1.0472 - 1.5708)]); const L = C.map(([x, y]) => circ(x, y, 0.13)); for (let i = 0; i < C.length; i++) for (let j = i + 1; j < C.length; j++) L.push(seg2(C[i], C[j])); return L; },
    sriyantra() { const L = [circ(0, 0, 1), circ(0, 0, 0.94)]; [[0.85, 0.05], [0.68, 0], [0.52, -0.04], [0.34, -0.01]].forEach(([s, o]) => L.push(poly(3, s, -1.5708, 0, o))); [[0.8, -0.04], [0.62, 0.01], [0.46, 0], [0.3, -0.02], [0.56, 0.08]].forEach(([s, o]) => L.push(poly(3, s, 1.5708, 0, o))); for (let i = 0; i < 8; i++) { const a = i * TAU / 8; L.push([[Math.cos(a) * 0.94, Math.sin(a) * 0.94], [Math.cos(a + 0.2), Math.sin(a + 0.2)], [Math.cos(a + 0.39) * 0.94, Math.sin(a + 0.39) * 0.94]]); } L.push(circ(0, 0, 0.05)); return L; },
    spiral() { const p = []; for (let i = 0; i <= 140; i++) { const t = i / 140 * 3.6 * Math.PI, r = Math.pow(PHI, t * 2 / Math.PI) / Math.pow(PHI, 7.2) * 1.05; p.push([Math.cos(t) * r, Math.sin(t) * r]); } const L = [p], f = [1, 1]; for (let i = 0; i < 5; i++) f.push(f[i] + f[i + 1]); let x = -0.7; for (let i = 0; i < 6; i++) { const q = f[i] / f[6] * 1.4; L.push([[x, -0.5], [x + q, -0.5], [x + q, -0.5 + q], [x, -0.5 + q], [x, -0.5]]); x += q; } return L; },
    hexagram() { return [poly(3, 1), poly(3, 1, 1.5708), circ(0, 0, 1), circ(0, 0, 0.5)]; },
    pentagram() { return [star(5, 2, 1), circ(0, 0, 1), poly(5, 0.38, 1.5708)]; },
    mandala() { const L = [circ(0, 0, 1), circ(0, 0, 0.8), circ(0, 0, 0.45), circ(0, 0, 0.12)]; for (let i = 0; i < 12; i++) { const a = i * TAU / 12, b = a + TAU / 24, c = a + TAU / 12; L.push([[Math.cos(a) * 0.45, Math.sin(a) * 0.45], [Math.cos(b) * 0.8, Math.sin(b) * 0.8], [Math.cos(c) * 0.45, Math.sin(c) * 0.45]]); L.push(seg2([Math.cos(a) * 0.8, Math.sin(a) * 0.8], [Math.cos(a), Math.sin(a)])); } return L; },
    tree() { const N = [[0, -0.95], [0.35, -0.7], [-0.35, -0.7], [0.35, -0.3], [-0.35, -0.3], [0, -0.1], [0.35, 0.2], [-0.35, 0.2], [0, 0.5], [0, 0.88]], P = [[0, 1], [0, 2], [1, 2], [1, 3], [2, 4], [1, 5], [2, 5], [3, 4], [3, 5], [4, 5], [3, 6], [4, 7], [5, 6], [5, 7], [5, 8], [6, 7], [6, 8], [7, 8], [6, 9], [7, 9], [8, 9], [2, 3]]; return N.map(([x, y]) => circ(x, y, 0.09)).concat(P.map(([i, j]) => seg2(N[i], N[j]))); },
  };
  const KNOT = () => { const p = []; for (let i = 0; i <= 160; i++) { const t = i / 160 * TAU, r = 0.6 + 0.25 * Math.cos(3 * t); p.push([r * Math.cos(2 * t), r * Math.sin(2 * t), 0.3 * Math.sin(3 * t)]); } return p; };
  const GEO_NAMES = ['flower', 'seed', 'vesica', 'metatron', 'sriyantra', 'merkaba', 'spiral', 'tetra', 'cube', 'octa', 'dodeca', 'icosa', 'knot', 'hexagram', 'pentagram', 'mandala', 'tree'];
  const figCache = {};
  const flat = (n) => figCache[n] || (figCache[n] = FIG[n]());
  const sol = (n) => SOL[n] || (SOL[n] = solidDef[n]());
  function strokeProg(lines, d) { // draw only the first part (d, 0..1) of all lines: they draw themselves one after another
    const N = lines.length; cx.beginPath();
    for (let i = 0; i < N; i++) {
      const f = Math.max(0, Math.min(1, d * N - i * 0.8)); if (f <= 0) continue;
      const pl = lines[i], n = pl.length - 1, upto = f * n;
      cx.moveTo(pl[0][0], pl[0][1]);
      for (let k = 1; k <= n; k++) { if (k <= upto) cx.lineTo(pl[k][0], pl[k][1]); else { const w = upto - (k - 1); if (w > 0) cx.lineTo(pl[k - 1][0] + (pl[k][0] - pl[k - 1][0]) * w, pl[k - 1][1] + (pl[k][1] - pl[k - 1][1]) * w); break; } }
    }
    cx.stroke();
  }
  function drawGeo(p, u) {
    const rot = p.r + u * p.vr, cs = Math.cos(rot), sn = Math.sin(rot), S = p.s * (0.88 + 0.12 * Math.min(1, u * 4));
    const d = Math.min(1, u / 0.55), alpha = u < 0.65 ? 1 : Math.max(0, 1 - (u - 0.65) / 0.35);
    let lines;
    if (solidDef[p.fig] || p.fig === 'knot') {
      const ay = p.r + u * p.vr * 1.6, ax = 0.5 + u * 0.8, cy = Math.cos(ay), sy = Math.sin(ay), cxx = Math.cos(ax), sxx = Math.sin(ax);
      const pr = (v) => { const x1 = v[0] * cy + v[2] * sy, z1 = -v[0] * sy + v[2] * cy; return [p.x + x1 * S, p.y + (v[1] * cxx - z1 * sxx) * S]; };
      if (p.fig === 'knot') lines = [(p.knot || (p.knot = KNOT())).map(pr)]; else { const so = sol(p.fig); lines = so.E.map(([i, j]) => [pr(so.V[i]), pr(so.V[j])]); }
    } else lines = flat(p.fig).map((pl) => pl.map(([x, y]) => [p.x + (x * cs - y * sn) * S, p.y + (x * sn + y * cs) * S]));
    cx.lineCap = cx.lineJoin = 'round'; cx.strokeStyle = p.c;
    if (!p.thin) { cx.globalAlpha = alpha * 0.22; cx.lineWidth = 4.5; strokeProg(lines, d); } // soft glow underlay (cheaper than shadowBlur)
    cx.globalAlpha = alpha; cx.lineWidth = 1.2; strokeProg(lines, d);
  }
  function geoSize(el) { if (!el || !el.getBoundingClientRect) return R(52, 80); const r = el.getBoundingClientRect(), m = Math.min(r.width, r.height); return (m < 4 || m > 700) ? R(52, 80) : Math.max(28, Math.min(110, m * 0.55 + 16)); }
  function geoBurst(x, y, m, name, size, jackpot) {
    const fig = name && (FIG[name] || solidDef[name] || name === 'knot') ? name : pick(GEO_NAMES), s = size || R(52, 80);
    add({ k: 'geo', fig, x, y, s: jackpot ? Math.max(s, 120) : s, c: pick(ALL.concat(['#c6ff00'])), life: R(1.3, 1.8), r: R(0, 6.28), vr: R(-0.9, 0.9) * (jackpot ? 2 : 1), thin: level() === 'low', vx: 0, vy: 0, g: 0 });
    if (jackpot || m > 1.4) add({ k: 'geo', fig: pick(GEO_NAMES), x, y, s: s * 1.6, c: pick(ACC), life: R(1.5, 2), r: R(0, 6.28), vr: R(-0.5, 0.5), thin: true, vx: 0, vy: 0, g: 0 });
  }

  // ---- from the burrow: a dotted curved arc to the click, bursting on arrival ----
  function launch(hp, x, y, done) {
    const cp = { x: (hp.x + x) / 2 + R(-60, 60), y: Math.min(hp.y, y) - R(40, 120) };
    add({ k: 'arc', x: hp.x, y: hp.y, p0: hp, p1: { x, y }, cp, life: R(0.45, 0.7), c: pick(ALL), vx: 0, vy: 0, g: 0, done, trail: [] });
  }

  const SKIP = '[data-fx="none"], #hs-clickfx, .win-btn, .winbtn, .window-controls, .wc, .titlebar, #titlebar, .topbar, header.top, .top-actions, .rabbit, .twr, [id^="twr"]';
  function classify(t) {
    if (!t || !t.closest) return { kind: 'bg' };
    if (t.closest(SKIP)) return null;
    if (t.closest('input[type="checkbox"], input[type="radio"], .switch, .toggle, [role="switch"]')) return { kind: 'toggle', label: 'switch' };
    if (t.closest('input[type="range"]')) return { kind: 'slider' };
    if (t.closest('input, textarea, select, [contenteditable="true"]')) return null; // focusin handles these
    const nav = t.closest('.nav'); if (nav) return { kind: 'nav', label: 'tile', el: nav };
    const btn = t.closest('button, .btn, .act, [role="button"]');
    if (btn) {
      const s = (btn.className + ' ' + (btn.id || '') + ' ' + (btn.textContent || '').trim().slice(0, 24)).toLowerCase();
      if (/del|remove|trash|danger|kill|clear|wipe|reset|✕|✖|×/.test(s)) return { kind: 'danger', label: 'button', el: btn };
      if (/save|add|new|create|\+|apply|done/.test(s)) return { kind: 'save', label: 'button', el: btn };
      if (/chev|caret|arrow|expand|collapse|fold|▸|▾|▶|▼/.test(s)) return { kind: 'chevron', label: 'button', el: btn };
      return { kind: 'button', label: 'button', el: btn };
    }
    if (t.closest('.tab, [role="tab"]')) return { kind: 'tab', label: 'tile' };
    if (t.closest('a[href], .link')) return { kind: 'link', label: 'link' };
    const row = t.closest('tr, li, .row, .card, .item, .proc, .todo, [data-row]');
    if (row) return { kind: 'row', label: 'generic', el: row };
    if (t.closest('img, svg, canvas:not(#bg), .art, .thumb')) return { kind: 'art', label: 'generic' };
    return { kind: 'bg', label: 'generic' };
  }

  // ---- scheduling (max ~4 effects at once) ----
  function play(kind, x, y, o = {}) {
    if (!ensure()) return;
    const now = performance.now();
    effects = effects.filter((t) => t > now);
    if (effects.length >= (level() === 'max' ? 6 : 4)) return;
    effects.push(now + 1300);
    const m = mult(), fn = FX[kind] || FX.bg;
    const go = () => { if (prefs.geo || o.forceGeo) geoBurst(x, y, m, o.fig, o.size, o.jackpot); else if (o.jackpot) FX.jackpot(x, y, m); else fn(x, y, m, o.on, o.el); start(); };
    const rb = twrOn() && twr.home && twr.home(), hp = rb && twr.homePoint ? twr.homePoint() : null, ok = hp && Number.isFinite(hp.x) && Number.isFinite(hp.y); // only while the rabbit is on and its burrow is showing
    if (!prefs.geo && prefs.house && ok && level() !== 'low' && Math.random() < 0.34) { launch({ x: hp.x, y: hp.y }, x, y, go); start(); }
    else go();
  }
  // the rabbit is dormant on a fresh install: no sparks from its house, no pokes, until it has been found
  function twrOn() { try { return !!(window.twr && twr.cfg && twr.cfg().on); } catch { return false; } }
  function onDown(e) {
    if (level() === 'off' || document.hidden || (reduced && reduced.matches)) return;
    if (e.button) return;
    const c = classify(e.target); if (!c) return;
    if (c.kind === 'slider') { sliding = e.target.closest('input[type="range"]'); return; }
    let on = true;
    if (c.kind === 'toggle') { const l = e.target.closest('label'), inp = e.target.closest('input') || (l && l.querySelector('input')); if (inp && 'checked' in inp) on = !inp.checked; }
    // navfx already draws the tile ripple; here a nav click only adds a small rune ring
    const sz = prefs.geo ? geoSize(c.el || (e.target.closest && e.target.closest('button, label, a, li, tr, .card, .item')) || e.target) : 0;
    play(c.kind, e.clientX, e.clientY, { on, el: c.el, size: sz, jackpot: Math.random() < 1 / 40 });
    if (twrOn() && prefs.house && Math.random() < 1 / 14) {
      const k = { button: 'button', danger: 'button', save: 'button', chevron: 'button', toggle: 'switch', nav: 'tile', tab: 'tile', link: 'link' }[c.kind] || 'generic';
      try { document.dispatchEvent(new CustomEvent('twr', { detail: { do: 'poke', x: e.clientX, y: e.clientY, kind: k, label: c.label || '' } })); } catch {}
    }
  }
  function onMove(e) {
    if (!sliding || prefs.geo || level() === 'off' || document.hidden || !ensure()) return;
    const n = performance.now(); if (n - lastSl < 55 || parts.length > 120) return; lastSl = n;
    const r = sliding.getBoundingClientRect();
    add({ k: 'dot', x: e.clientX, y: r.top + r.height / 2, vx: R(-20, 20), vy: R(-40, -10), g: 40, life: R(0.3, 0.5), c: pick(ALL), s: R(1.5, 2.6), r: 0, vr: 0 });
    start();
  }
  function onFocus(e) {
    const t = e.target;
    if (prefs.geo || level() === 'off' || document.hidden || (reduced && reduced.matches) || !t || !t.matches || !t.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea') || t.closest('[data-fx="none"]') || !ensure()) return;
    const n = performance.now(); effects = effects.filter((q) => q > n); if (effects.length >= 4) return; effects.push(n + 900);
    const r = t.getBoundingClientRect(); if (r.width < 4 || r.height < 4) return;
    add({ k: 'brackets', x: r.left, y: r.top, w: r.width, h: r.height, life: 0.7, c: pick(GREEN.concat(ACC)), vx: 0, vy: 0, g: 0 });
    add({ k: 'under', x: r.left, y: r.bottom, w: r.width, life: 0.55, c: pick(GREEN), vx: 0, vy: 0, g: 0 });
    start();
  }

  // ---- draw loop ----
  function start() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }
  function hexPath(x, y, r, rot) { cx.beginPath(); for (let i = 0; i < 6; i++) { const a = rot + i * 1.0472; cx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r, y + Math.sin(a) * r); } cx.closePath(); }
  function frame(now) {
    raf = 0;
    if (document.hidden) { parts = []; effects = []; cx.clearRect(0, 0, W, H); return; }
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    cx.clearRect(0, 0, W, H);
    const keep = [], dones = [];
    for (const p of parts) {
      p.age += dt;
      const u = p.age / p.life;
      if (u >= 1) { if (p.done) dones.push(p.done); continue; }
      keep.push(p);
      const a = 1 - u; cx.globalAlpha = Math.max(0, Math.min(1, a * 1.3)); cx.fillStyle = cx.strokeStyle = p.c;
      switch (p.k) {
        case 'arc': {
          const e = 1 - a * a, q = 1 - e;
          p.x = q * q * p.p0.x + 2 * q * e * p.cp.x + e * e * p.p1.x; p.y = q * q * p.p0.y + 2 * q * e * p.cp.y + e * e * p.p1.y;
          const tl = p.trail, lt = tl[tl.length - 1];
          if (!lt || Math.hypot(lt.x - p.x, lt.y - p.y) > 9) tl.push({ x: p.x, y: p.y });
          if (tl.length > 18) tl.shift();
          tl.forEach((t, i) => { cx.globalAlpha = (i / tl.length) * 0.8; cx.fillRect(t.x - 1, t.y - 1, 2, 2); });
          cx.globalAlpha = 1; cx.beginPath(); cx.arc(p.x, p.y, 3, 0, 6.283); cx.fill();
          break;
        }
        case 'geo': drawGeo(p, u); break;
        case 'ring': {
          const r = p.r1 * (0.3 + 0.7 * (1 - a * a)); cx.lineWidth = 1.5; cx.beginPath();
          if (p.sides) for (let i = 0; i < p.sides; i++) { const ang = u * 1.5 + i * 6.283 / p.sides; cx[i ? 'lineTo' : 'moveTo'](p.x + Math.cos(ang) * r, p.y + Math.sin(ang) * r); }
          else cx.arc(p.x, p.y, r, 0, 6.283);
          if (p.sides) cx.closePath();
          cx.stroke(); break;
        }
        case 'petals': { const r = p.r1 * (0.4 + 0.6 * (1 - a * a)); cx.lineWidth = 1; cx.beginPath(); cx.arc(p.x, p.y, r, 0, 6.283); cx.stroke(); for (let i = 0; i < 6; i++) { const ang = i * 1.0472 + u * 0.6; cx.beginPath(); cx.arc(p.x + Math.cos(ang) * r, p.y + Math.sin(ang) * r, r, 0, 6.283); cx.stroke(); } break; }
        case 'line': { const y = p.y + p.h * u, g = cx.createLinearGradient(0, y - 6, 0, y + 6); g.addColorStop(0, 'rgba(0,255,110,0)'); g.addColorStop(0.5, p.c); g.addColorStop(1, 'rgba(0,255,110,0)'); cx.fillStyle = g; cx.globalAlpha = a * 0.55; cx.fillRect(p.x, y - 6, p.w, 12); break; }
        case 'brackets': { const L = 7 + 4 * a, x0 = p.x - 2, y0 = p.y - 2, x1 = p.x + p.w + 2, y1 = p.y + p.h + 2; cx.lineWidth = 1.5; cx.beginPath(); cx.moveTo(x0, y0 + L); cx.lineTo(x0, y0); cx.lineTo(x0 + L, y0); cx.moveTo(x1 - L, y0); cx.lineTo(x1, y0); cx.lineTo(x1, y0 + L); cx.moveTo(x0, y1 - L); cx.lineTo(x0, y1); cx.lineTo(x0 + L, y1); cx.moveTo(x1 - L, y1); cx.lineTo(x1, y1); cx.lineTo(x1, y1 - L); cx.stroke(); break; }
        case 'under': cx.fillRect(p.x, p.y - 1, p.w * Math.min(1, u * 3), 2); break;
        case 'glyph': case 'shard': p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt; cx.font = `${p.s}px monospace`; cx.textAlign = 'center'; cx.fillText(p.t, p.x, p.y); break;
        case 'hex': p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt; p.r += p.vr * dt; cx.lineWidth = 1; hexPath(p.x, p.y, p.s, p.r); cx.stroke(); break;
        case 'star': p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt; cx.fillRect(p.x - p.s, p.y - 0.8, p.s * 2, 1.6); cx.fillRect(p.x - 0.8, p.y - p.s, 1.6, p.s * 2); break;
        default: p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt; if (p.k === 'pix') cx.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s); else { cx.beginPath(); cx.arc(p.x, p.y, p.s * 0.6, 0, 6.283); cx.fill(); }
      }
    }
    cx.globalAlpha = 1; parts = keep;
    dones.forEach((f) => { try { f(); } catch {} }); // arrival bursts add new particles to the fresh list
    if (parts.length) raf = requestAnimationFrame(frame); else cx.clearRect(0, 0, W, H);
  }

  const cap = { capture: true, passive: true };
  document.addEventListener('pointerdown', onDown, cap);
  document.addEventListener('pointermove', onMove, cap);
  addEventListener('pointerup', () => { sliding = null; }, cap);
  document.addEventListener('focusin', onFocus, true);

  window.hsClickFx = {
    get: () => ({ level: prefs.level, geo: !!prefs.geo, house: !!prefs.house }),
    set(patch) {
      if (patch && typeof patch === 'object') {
        if (LEVELS.includes(patch.level)) prefs.level = patch.level;
        if ('house' in patch) prefs.house = !!patch.house;
        if ('geo' in patch) prefs.geo = !!patch.geo;
        try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch {}
      }
      return window.hsClickFx.get();
    },
    // kind: a click class (button, toggle...) or a geometry name (see geoNames)
    burst(x, y, kind, size) { if (level() === 'off') return; const g = FIG[kind] || solidDef[kind] || kind === 'knot'; play(FX[kind] ? kind : 'bg', x, y, g ? { fig: kind, size, forceGeo: true } : { size }); },
    geoNames: () => GEO_NAMES.slice(),
  };
})();
