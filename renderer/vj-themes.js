// VJ geometry pack: more sacred geometry, yantras, 4D polytopes and cosmic patterns for vj.js. Each theme
// draws on a 2D canvas centred at 0,0 inside radius R; vj.js adds trails, tunnel, kaleidoscope and glow.
// f = { t, dt, rot, bass, mid, treble, beat, level, complexity (1-5), fold (symmetry), tilt (0-1), spec[48] }
window.VJ_EXTRA = ({ TAU, H, stroke, circle, poly }) => {
  const PHI = (1 + Math.sqrt(5)) / 2;
  const sp = (f, i) => (f.spec[((i % 48) + 48) % 48] || 0) / 255;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);

  // ---------------- shared yantra parts ----------------
  function bhupura(ctx, s, f) { // square enclosure with four T-shaped gates
    stroke(ctx, H(f.t, 1), 55, 0.5, 2);
    const b = s * 1.05, gw = s * 0.18;
    ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const px = -dy, py = dx;
      ctx.moveTo(b * dx + b * px, b * dy + b * py);
      ctx.lineTo(b * dx + gw * px, b * dy + gw * py);
      ctx.lineTo((b + gw * 0.6) * dx + gw * px, (b + gw * 0.6) * dy + gw * py);
      ctx.moveTo(b * dx - b * px, b * dy - b * py);
      ctx.lineTo(b * dx - gw * px, b * dy - gw * py);
      ctx.lineTo((b + gw * 0.6) * dx - gw * px, (b + gw * 0.6) * dy - gw * py);
    }
    ctx.stroke();
  }
  function lotus(ctx, n, rr, f, dir, off = 0) {
    stroke(ctx, H(f.t, n + off), 60, 0.55 + f.mid * 0.3, 1.5);
    ctx.save();
    ctx.rotate(f.rot * dir * 0.6);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      ctx.rotate(TAU / n);
      const swell = 1 + f.mid * 0.3 + sp(f, i * 3 + off) * 0.25;
      ctx.moveTo(rr * 0.8, 0);
      ctx.quadraticCurveTo(rr * 0.95, rr * 0.16 * swell * (16 / Math.max(8, n)), rr * 1.08, 0);
      ctx.quadraticCurveTo(rr * 0.95, -rr * 0.16 * swell * (16 / Math.max(8, n)), rr * 0.8, 0);
    }
    ctx.stroke();
    ctx.restore();
    circle(ctx, 0, 0, rr * 0.8);
  }
  function bindu(ctx, f, size = 1) {
    ctx.fillStyle = `hsla(${H(f.t)},100%,${70 + f.beat * 30}%,1)`;
    ctx.beginPath(); ctx.arc(0, 0, (3 + f.beat * 10 + f.bass * 4) * size, 0, TAU); ctx.fill();
  }

  // ---------------- 3D / 4D helpers ----------------
  function solid(verts) { // unit circumradius, edges = closest vertex pairs
    const s = Math.hypot(...verts[0]);
    const v = verts.map((p) => p.map((x) => x / s));
    const d = (a, b) => Math.hypot(...a.map((x, i) => x - b[i]));
    let min = Infinity;
    for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) min = Math.min(min, d(v[i], v[j]));
    const e = [];
    for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) if (Math.abs(d(v[i], v[j]) - min) < 1e-3) e.push([i, j]);
    return { v, e };
  }
  const cube = [...Array(8)].map((_, i) => [i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1]);
  const pm = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const SOLIDS = [
    solid(pm.flatMap(([a, b]) => [[0, a, b * PHI], [a, b * PHI, 0], [b * PHI, 0, a]])), // icosahedron
    solid([...cube, ...pm.flatMap(([a, b]) => [[0, a / PHI, b * PHI], [a / PHI, b * PHI, 0], [b * PHI, 0, a / PHI]])]), // dodecahedron
    solid(cube),
    solid([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]), // octahedron
    solid([[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]]), // tetrahedron
  ];
  function rot3([x, y, z], ax, ay, az) {
    let c = Math.cos(ax), s = Math.sin(ax);
    [y, z] = [y * c - z * s, y * s + z * c];
    c = Math.cos(ay); s = Math.sin(ay);
    [x, z] = [x * c + z * s, -x * s + z * c];
    c = Math.cos(az); s = Math.sin(az);
    [x, y] = [x * c - y * s, x * s + y * c];
    return [x, y, z];
  }
  // 24-cell: every permutation of (±1, ±1, 0, 0)
  const CELL24 = (() => {
    const v = [];
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) for (const [a, b] of pm) { const p = [0, 0, 0, 0]; p[i] = a; p[j] = b; v.push(p); }
    const e = [];
    for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) {
      const d2 = v[i].reduce((s, x, k) => s + (x - v[j][k]) ** 2, 0);
      if (Math.abs(d2 - 2) < 1e-6) e.push([i, j]);
    }
    return { v, e };
  })();

  // Apollonian gasket in the unit circle (Descartes' theorem, complex form), [x, y, r, depth]
  const GASKET = (() => {
    const out = [];
    const r1 = 1 / (1 + 2 / Math.sqrt(3));
    const outer = { k: -1, x: 0, y: 0 };
    const inner = [0, 1, 2].map((i) => { const a = -Math.PI / 2 + (i * TAU) / 3; return { k: 1 / r1, x: Math.cos(a) * (1 - r1), y: Math.sin(a) * (1 - r1) }; });
    inner.forEach((c) => out.push([c.x, c.y, 1 / c.k, 0]));
    const rec = (a, b, c, other, depth) => {
      const k = 2 * (a.k + b.k + c.k) - other.k;
      if (k <= 0 || 1 / k < 0.007 || depth > 6) return;
      const n = { k, x: (2 * (a.k * a.x + b.k * b.x + c.k * c.x) - other.k * other.x) / k, y: (2 * (a.k * a.y + b.k * b.y + c.k * c.y) - other.k * other.y) / k };
      out.push([n.x, n.y, 1 / k, depth]);
      rec(a, b, n, c, depth + 1); rec(a, c, n, b, depth + 1); rec(b, c, n, a, depth + 1);
    };
    const [p, q, s] = inner;
    rec(p, q, s, outer, 1);
    rec(outer, p, q, s, 1); rec(outer, q, s, p, 1); rec(outer, p, s, q, 1);
    return out.sort((a, b) => a[3] - b[3]);
  })();

  // Tree of Life: sephirot (x, y in grid units) and the 22 paths
  const SEPH = [[0, 0], [1, 1], [-1, 1], [1, 3], [-1, 3], [0, 4], [1, 5], [-1, 5], [0, 6], [0, 7.6]];
  const PATHS = [[0, 1], [0, 2], [0, 5], [1, 2], [1, 5], [1, 3], [2, 5], [2, 4], [3, 4], [3, 5], [3, 6], [4, 5], [4, 7], [5, 6], [5, 7], [5, 8], [6, 7], [6, 8], [6, 9], [7, 8], [7, 9], [8, 9]];

  const COS = new Float32Array(240), SIN = new Float32Array(240);
  for (let j = 0; j < 240; j++) { COS[j] = Math.cos((j / 240) * TAU); SIN[j] = Math.sin((j / 240) * TAU); }

  const T = {};

  // ================= SIGNATURE =================
  // SUBASHTON: the logo rebuilt as live geometry in its own colours (blue ring, cyan star, purple nodes,
  // pink lettering lifted straight from the artwork so the type stays exact)
  const logoText = new Image();
  logoText.crossOrigin = 'anonymous'; // keeps the canvas clean for the WebGL passes
  logoText.src = window.HS_ASSET ? window.HS_ASSET('subashton-text.png') : 'hsmedia://asset/subashton-text.png'; // the phone has no hsmedia://
  T.subashton = { name: 'SUBASHTON', cat: 'SIGNATURE', draw(ctx, R, f) {
    const r = R * 0.74 * (1 + f.bass * 0.05), ro = R * 0.94;
    const V = [...Array(6)].map((_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / 3; return [Math.cos(a) * r, Math.sin(a) * r]; });
    ctx.save();
    ctx.rotate(Math.sin(f.t * 0.17) * 0.06);
    // outer ring + its spectrum fringe
    stroke(ctx, 202, 58 + f.beat * 20, 0.9, 3 + f.bass * 3);
    circle(ctx, 0, 0, ro * (1 + f.beat * 0.015));
    if (f.complexity >= 3) {
      ctx.beginPath();
      for (let i = 0; i < 96; i++) { const a = (i / 96) * TAU + f.rot * 0.2, e = sp(f, i >> 1); ctx.moveTo(Math.cos(a) * ro * 1.02, Math.sin(a) * ro * 1.02); ctx.lineTo(Math.cos(a) * ro * (1.03 + e * 0.07), Math.sin(a) * ro * (1.03 + e * 0.07)); }
      stroke(ctx, 205, 65, 0.55, 1.2);
      ctx.stroke();
    }
    // side chevrons
    stroke(ctx, 210, 62, 0.7, 2);
    ctx.beginPath();
    for (const s of [-1, 1]) { const x = s * ro * 0.96; ctx.moveTo(x - s * R * 0.03, -R * 0.05); ctx.lineTo(x + s * R * 0.03, 0); ctx.lineTo(x - s * R * 0.03, R * 0.05); }
    ctx.stroke();
    if (f.complexity >= 4) { ctx.save(); ctx.rotate(f.rot * 0.4); stroke(ctx, 180, 65, 0.18 + f.mid * 0.2, 1.2); poly(ctx, 3, ro * 0.98, -Math.PI / 2); poly(ctx, 3, ro * 0.98, Math.PI / 2); ctx.restore(); }
    // hexagon + the rectangle sides, fine and pale
    stroke(ctx, 290, 82, 0.3 + f.treble * 0.3, 1.2);
    poly(ctx, 6, r, -Math.PI / 2);
    // the cube's inner edges (inner nodes on the axis join the far corners)
    const nt = [0, -r / 2], nb = [0, r / 2];
    stroke(ctx, 178, 70, 0.35 + f.mid * 0.35, 1.3 + f.mid);
    ctx.beginPath();
    for (const [a, b] of [[nt, V[2]], [nt, V[4]], [nb, V[1]], [nb, V[5]], [V[0], V[3]], [nt, V[1]], [nt, V[5]], [nb, V[2]], [nb, V[4]]]) { ctx.moveTo(...a); ctx.lineTo(...b); }
    ctx.stroke();
    // the star itself
    stroke(ctx, 176, 72 + f.treble * 15, 0.95, 2.6 + f.bass * 2.6);
    poly(ctx, 3, r, -Math.PI / 2);
    poly(ctx, 3, r, Math.PI / 2);
    stroke(ctx, 180, 75, 0.85, 2.2 + f.bass * 2);
    ctx.beginPath(); ctx.moveTo(...V[1]); ctx.lineTo(...V[2]); ctx.moveTo(...V[5]); ctx.lineTo(...V[4]); ctx.stroke();
    // nodes: purple rings on the four sides, cyan on top and bottom, beads on the axis
    V.forEach(([x, y], i) => {
      const e = sp(f, i * 7 + 3);
      if (i === 0 || i === 3) { stroke(ctx, 182, 72, 0.8, 1.6); circle(ctx, x, y, r * 0.1 * (1 + e * 0.3)); circle(ctx, x, y, r * 0.05); }
      else {
        stroke(ctx, 288, 62 + e * 25, 0.85, 2 + e * 2); circle(ctx, x, y, r * 0.15 * (1 + e * 0.25));
        stroke(ctx, 300, 70, 0.6, 1.2); circle(ctx, x, y, r * 0.075);
        ctx.fillStyle = `hsla(288,90%,60%,${0.12 + e * 0.3})`; ctx.beginPath(); ctx.arc(x, y, r * 0.15, 0, TAU); ctx.fill();
      }
    });
    ctx.fillStyle = `hsla(180,100%,75%,${0.6 + f.treble * 0.4})`;
    for (const [x, y] of [nt, nb]) { ctx.beginPath(); ctx.arc(x, y, r * 0.035 * (1 + f.beat * 0.5), 0, TAU); ctx.fill(); }
    ctx.restore();
    // the name, upright, breathing with the bass
    const tw = R * 1.58 * (1 + f.bass * 0.06 + f.beat * 0.03);
    if (logoText.complete && logoText.naturalWidth) {
      const th = tw * (logoText.naturalHeight / logoText.naturalWidth);
      ctx.globalAlpha = Math.min(1, 0.85 + f.beat * 0.3);
      ctx.drawImage(logoText, -tw / 2, -th / 2, tw, th);
      ctx.globalAlpha = 1;
    } else {
      ctx.font = `800 ${Math.round(tw / 6)}px Orbitron, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ff9ccf'; ctx.fillText('SUBASHTON', 0, 0);
    }
  } };

  // ================= SACRED GEOMETRY =================
  T.om = { name: 'OM', cat: 'SACRED', draw(ctx, R, f) {
    ctx.save();
    ctx.rotate(f.rot * 0.15);
    lotus(ctx, Math.max(8, Math.round(f.fold)), R * 0.9, f, 1, 2);
    if (f.complexity >= 2) lotus(ctx, Math.max(8, Math.round(f.fold)) * 2, R * 1.04, f, -1, 7);
    ctx.beginPath(); // sound rays between the lotus and the glyph
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * TAU, e = sp(f, i);
      ctx.moveTo(Math.cos(a) * R * 0.6, Math.sin(a) * R * 0.6);
      ctx.lineTo(Math.cos(a) * R * (0.62 + e * 0.1), Math.sin(a) * R * (0.62 + e * 0.1));
    }
    stroke(ctx, H(f.t, 3), 65, 0.5 + f.treble * 0.4, 1.2);
    ctx.stroke();
    stroke(ctx, H(f.t, 1), 62, 0.7, 1.6);
    circle(ctx, 0, 0, R * 0.58);
    if (f.complexity >= 3) { stroke(ctx, H(f.t, 5), 60, 0.35, 1); poly(ctx, 6, R * 0.58, f.rot * 0.5); poly(ctx, 3, R * 0.58, -Math.PI / 2 + f.rot * 0.5); poly(ctx, 3, R * 0.58, Math.PI / 2 + f.rot * 0.5); }
    ctx.restore();
    const size = R * 0.86 * (1 + f.bass * 0.1 + f.beat * 0.03);
    ctx.font = `${Math.round(size)}px "Nirmala UI", "Nirmala Text", Mangal, "Segoe UI Symbol", serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const OM = 'ॐ';
    ctx.fillStyle = `hsla(${H(f.t, 2)},100%,55%,${0.14 + f.beat * 0.35})`;
    ctx.fillText(OM, 0, size * 0.06);
    stroke(ctx, H(f.t), 72 + f.treble * 18, 0.95, 2.4 + f.bass * 3);
    ctx.strokeText(OM, 0, size * 0.06);
  } };

  T.seed = { name: 'SEED OF LIFE', cat: 'SACRED', draw(ctx, R, f) {
    const r = R * 0.3 * (1 + f.bass * 0.12);
    ctx.rotate(f.rot * 0.6);
    const pts = [[0, 0]];
    for (let i = 0; i < 6; i++) { const a = (i * TAU) / 6 - Math.PI / 2; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
    pts.forEach(([x, y], i) => {
      const e = sp(f, i * 6 + 2);
      stroke(ctx, H(f.t, i), 55 + e * 35, 0.45 + e * 0.5, 1.4 + f.bass * 2 + e * 2);
      circle(ctx, x, y, r * (1 + Math.sin(f.t * 2 + i) * f.mid * 0.05));
    });
    stroke(ctx, H(f.t), 70, 0.8, 2 + f.bass * 2);
    circle(ctx, 0, 0, r * 2 * (1 + f.beat * 0.03));
    if (f.complexity >= 2) { // egg of life: the six circles between the petals, a ring further out
      for (let i = 0; i < 6; i++) {
        const a = (i * TAU) / 6;
        stroke(ctx, H(f.t, i + 3), 60, 0.4 + f.treble * 0.4, 1.2 + f.treble * 2);
        circle(ctx, Math.cos(a) * r * Math.sqrt(3), Math.sin(a) * r * Math.sqrt(3), r * 0.5 * (1 + f.treble * 0.3));
      }
    }
    if (f.complexity >= 3) { // fruit of life: 13 circles, counter-rotating
      ctx.save(); ctx.rotate(-f.rot * 1.2);
      const d = r * 0.66;
      stroke(ctx, H(f.t, 5), 65, 0.35 + f.mid * 0.4, 1 + f.mid * 1.5);
      circle(ctx, 0, 0, d / 2);
      for (let i = 0; i < 6; i++) { const a = (i * TAU) / 6; circle(ctx, Math.cos(a) * d, Math.sin(a) * d, d / 2); circle(ctx, Math.cos(a) * d * 2, Math.sin(a) * d * 2, d / 2); }
      ctx.restore();
    }
    if (f.complexity >= 4) { stroke(ctx, H(f.t, 7), 75, 0.3 + f.beat * 0.4, 1); poly(ctx, 6, r * 2, f.rot); poly(ctx, 3, r * 2, -Math.PI / 2 - f.rot); poly(ctx, 3, r * 2, Math.PI / 2 - f.rot); }
  } };

  T.vesica = { name: 'VESICA PISCIS', cat: 'SACRED', draw(ctx, R, f) {
    const n = clamp(Math.round(f.complexity), 1, 5);
    const r = R * 0.42 * (1 + f.bass * 0.15);
    ctx.rotate(f.rot * 0.3);
    for (let k = 0; k < n; k++) {
      ctx.save();
      ctx.rotate((k * Math.PI) / n + Math.sin(f.t * 0.5 + k) * f.mid * 0.1);
      const e = sp(f, k * 9 + 3);
      stroke(ctx, H(f.t, k), 55 + e * 30, 0.5 + e * 0.4, 1.5 + f.bass * 2);
      circle(ctx, -r / 2, 0, r); circle(ctx, r / 2, 0, r);
      ctx.fillStyle = `hsla(${H(f.t, k + 2)},100%,${50 + f.beat * 30}%,${0.06 + f.bass * 0.12})`;
      ctx.beginPath(); ctx.arc(-r / 2, 0, r, -Math.PI / 3, Math.PI / 3); ctx.arc(r / 2, 0, r, (2 * Math.PI) / 3, (4 * Math.PI) / 3); ctx.fill();
      const lh = (r * Math.sqrt(3)) / 2;
      stroke(ctx, H(f.t, k + 1), 75, 0.3 + f.treble * 0.5, 1);
      ctx.beginPath(); ctx.moveTo(0, -lh * 1.3); ctx.lineTo(0, lh * 1.3); ctx.moveTo(-r * 1.5, 0); ctx.lineTo(r * 1.5, 0); ctx.stroke();
      // the lens holds a smaller vesica, and that one a smaller one
      for (let j = 1; j <= 2; j++) { const rr = r / (2 * j + 1); stroke(ctx, H(f.t, k + j), 65, 0.4, 1); circle(ctx, -rr / 2, 0, rr); circle(ctx, rr / 2, 0, rr); }
      ctx.restore();
    }
    stroke(ctx, H(f.t), 70, 0.7, 2);
    circle(ctx, 0, 0, r * 1.5 * (1 + f.beat * 0.03));
  } };

  T.golden = { name: 'GOLDEN SPIRAL', cat: 'SACRED', draw(ctx, R, f) {
    const n = 160 + Math.round(f.complexity) * 90;
    const c = (R * 0.92) / Math.sqrt(n);
    const ga = Math.PI * (3 - Math.sqrt(5));
    ctx.rotate(f.rot * 0.3);
    for (let i = 1; i < n; i++) {
      const a = i * ga, r = c * Math.sqrt(i);
      const e = sp(f, (i * 7) % 48);
      ctx.fillStyle = `hsla(${H(f.t, i * 0.01)},100%,${45 + e * 45}%,${0.35 + e * 0.6})`;
      ctx.beginPath(); ctx.arc(Math.cos(a) * r, Math.sin(a) * r, (1.2 + e * 3.5 + f.beat * 1.5) * (0.5 + r / R), 0, TAU); ctx.fill();
    }
    for (let s = 0; s < 2; s++) {
      ctx.save();
      if (s) ctx.scale(-1, 1);
      ctx.rotate(-f.rot * 0.8);
      ctx.beginPath();
      for (let th = 0; th < TAU * 3.4; th += 0.05) {
        const r = R * 0.012 * Math.pow(PHI, th / (Math.PI / 2));
        if (r > R) break;
        th ? ctx.lineTo(Math.cos(th) * r, Math.sin(th) * r) : ctx.moveTo(r, 0);
      }
      stroke(ctx, H(f.t, s * 2), 70 + f.treble * 20, 0.7, 1.6 + f.bass * 2.5);
      ctx.stroke();
      ctx.restore();
    }
  } };

  T.treeoflife = { name: 'TREE OF LIFE', cat: 'SACRED', draw(ctx, R, f) {
    const u = (R * 1.8) / 7.6;
    const trees = f.complexity >= 3 ? 2 : 1;
    for (let k = 0; k < trees; k++) {
      const turn = f.rot * 0.5 + (k * Math.PI) / 2;
      const sx = Math.cos(turn);
      const P = SEPH.map(([x, y]) => [x * u * 1.3 * sx, (y - 3.8) * u]);
      stroke(ctx, H(f.t, k), 55, 0.35 + f.mid * 0.3, 1.2 + f.mid);
      ctx.beginPath();
      for (const [a, b] of PATHS) { ctx.moveTo(...P[a]); ctx.lineTo(...P[b]); }
      ctx.stroke();
      // light travelling down the paths
      ctx.fillStyle = `hsla(${H(f.t, 4)},100%,85%,${0.4 + f.treble * 0.6})`;
      PATHS.forEach(([a, b], i) => {
        const q = (f.t * (0.3 + f.bass * 0.6) + i * 0.137) % 1;
        ctx.beginPath(); ctx.arc(P[a][0] + (P[b][0] - P[a][0]) * q, P[a][1] + (P[b][1] - P[a][1]) * q, 1.5 + f.treble * 3, 0, TAU); ctx.fill();
      });
      P.forEach(([x, y], i) => {
        const e = sp(f, i * 4 + 2);
        stroke(ctx, H(f.t, i * 0.6), 60 + e * 30, 0.6 + e * 0.4, 1.6 + e * 3 + f.beat * 2);
        circle(ctx, x, y, u * 0.36 * (1 + e * 0.25));
        ctx.fillStyle = `hsla(${H(f.t, i)},100%,60%,${0.05 + e * 0.25})`;
        ctx.beginPath(); ctx.arc(x, y, u * 0.36, 0, TAU); ctx.fill();
      });
      ctx.setLineDash([4, 5]);
      stroke(ctx, H(f.t, 9), 60, 0.35, 1);
      circle(ctx, 0, -1.8 * u, u * 0.3); // Da'at, the hidden sphere
      ctx.setLineDash([]);
    }
  } };

  T.girih = { name: 'GIRIH STARS', cat: 'SACRED', draw(ctx, R, f) {
    const g = R / (1.4 + f.complexity * 0.45);
    const reach = Math.ceil((R * 1.2) / g);
    const breathe = 1 + f.bass * 0.15;
    for (let i = -reach; i <= reach; i++) for (let j = -reach; j <= reach; j++) {
      const x = i * g * breathe, y = j * g * breathe, d = Math.hypot(x, y);
      if (d > R * 1.2) continue;
      const e = sp(f, (Math.abs(i) + Math.abs(j)) * 5);
      const fade = 1 - d / (R * 1.25);
      const rot = f.rot * ((i + j) & 1 ? 1 : -1) * 0.6 + Math.PI / 8;
      const r = g * 0.52 * (1 + e * 0.3);
      stroke(ctx, H(f.t, (i + j) * 0.3), 55 + e * 35, fade * (0.5 + e * 0.5), 1.1 + e * 2);
      ctx.beginPath();
      for (let k = 0; k <= 8; k++) { const a = rot + (((k * 3) % 8) * TAU) / 8; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.stroke();
      stroke(ctx, H(f.t, 3), 65, fade * 0.35, 1);
      poly(ctx, 8, g * 0.2 * breathe, -rot, x + (g * breathe) / 2, y + (g * breathe) / 2);
    }
  } };

  T.starpoly = { name: 'STELLAR POLYGONS', cat: 'SACRED', draw(ctx, R, f) {
    const layers = 2 + Math.round(f.complexity);
    const base = Math.max(5, Math.round(f.fold) - 1);
    for (let L = 0; L < layers; L++) {
      const n = base + L;
      const k = Math.max(2, Math.floor((n - 1) / 2) - (L % 2));
      const g = gcd(n, k);
      const r = R * 0.95 * (1 - L / (layers + 0.6)) * (1 + sp(f, L * 7) * 0.12 + f.beat * 0.03);
      const rot = f.rot * (L % 2 ? -1 : 1) * (0.5 + L * 0.2) - Math.PI / 2;
      stroke(ctx, H(f.t, L), 58 + f.treble * 25, 0.75, 1.4 + f.bass * 2);
      ctx.beginPath();
      for (let c = 0; c < g; c++) for (let i = 0; i <= n / g; i++) {
        const a = rot + (((c + i * k) % n) * TAU) / n;
        i ? ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.stroke();
      ctx.fillStyle = `hsla(${H(f.t, L + 2)},100%,80%,${0.3 + f.treble * 0.6})`;
      for (let i = 0; i < n; i++) { const a = rot + (i * TAU) / n; ctx.beginPath(); ctx.arc(Math.cos(a) * r, Math.sin(a) * r, 1.5 + f.treble * 3, 0, TAU); ctx.fill(); }
    }
  } };

  // ================= YANTRAS =================
  T.kali = { name: 'KALI YANTRA', cat: 'YANTRA', draw(ctx, R, f) {
    const s = R * 0.92;
    ctx.rotate(f.rot * 0.2);
    bhupura(ctx, s, f);
    stroke(ctx, H(f.t, 2), 60, 0.6, 1.6); circle(ctx, 0, 0, s * 0.9);
    lotus(ctx, 8, s * 0.78, f, 1);
    stroke(ctx, H(f.t, 3), 62, 0.6, 1.6); circle(ctx, 0, 0, s * 0.58);
    for (let i = 0; i < 5; i++) { // five nested downward triangles
      const r = s * 0.55 * (1 - i * 0.18) * (1 + Math.sin(f.t * 1.4 + i) * f.bass * 0.06);
      stroke(ctx, H(f.t, i * 0.8), 58 + f.treble * 25, 0.8, 1.6 + f.bass * 2 + sp(f, i * 8) * 2);
      poly(ctx, 3, r, Math.PI / 2, 0, -r * 0.12);
    }
    bindu(ctx, f);
  } };

  T.shatkona = { name: 'SHATKONA YANTRA', cat: 'YANTRA', draw(ctx, R, f) {
    const s = R * 0.92;
    ctx.rotate(f.rot * 0.2);
    bhupura(ctx, s, f);
    lotus(ctx, 16, s * 0.86, f, 1, 4);
    lotus(ctx, 8, s * 0.64, f, -1, 9);
    for (const up of [true, false]) {
      stroke(ctx, H(f.t, up ? 0 : 2), 60 + f.treble * 25, 0.85, 1.8 + f.bass * 2.5);
      poly(ctx, 3, s * 0.5 * (1 + f.bass * 0.08), up ? -Math.PI / 2 : Math.PI / 2);
    }
    ctx.save();
    ctx.rotate(f.rot * 1.5);
    for (const up of [true, false]) { stroke(ctx, H(f.t, 4), 70, 0.7 + f.beat * 0.3, 1.3); poly(ctx, 3, s * 0.2 * (1 + f.mid * 0.3), up ? -Math.PI / 2 : Math.PI / 2); }
    ctx.restore();
    stroke(ctx, H(f.t, 5), 65, 0.6, 1.2); circle(ctx, 0, 0, s * 0.25);
    bindu(ctx, f);
  } };

  T.sahasrara = { name: 'THOUSAND-PETAL LOTUS', cat: 'YANTRA', draw(ctx, R, f) {
    const rings = 2 + Math.round(f.complexity);
    const base = Math.max(5, Math.round(f.fold));
    const band = (R * 0.82) / rings;
    for (let k = rings; k >= 1; k--) {
      const n = Math.min(140, base * k);
      const e = sp(f, k * 6);
      const ri = R * 0.1 + (k - 1) * band, ro = ri + band * (1.3 + e * 0.5) * (1 + f.beat * 0.05);
      const w = Math.tan(Math.PI / n) * (ri + ro) * 0.5;
      ctx.save();
      ctx.rotate(f.rot * (k % 2 ? 1 : -1) * (0.3 + k * 0.08) + (k % 2) * (Math.PI / n));
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        ctx.rotate(TAU / n);
        ctx.moveTo(ri, 0); ctx.quadraticCurveTo((ri + ro) / 2, w, ro, 0); ctx.quadraticCurveTo((ri + ro) / 2, -w, ri, 0);
      }
      stroke(ctx, H(f.t, k * 0.7), 52 + e * 35, 0.45 + e * 0.45, 1 + e * 2 + f.bass);
      ctx.stroke();
      ctx.fillStyle = `hsla(${H(f.t, k)},100%,55%,${0.03 + e * 0.08})`;
      ctx.fill();
      ctx.restore();
    }
    stroke(ctx, H(f.t), 75, 0.9, 2); poly(ctx, 6, R * 0.07 * (1 + f.bass), f.rot * 2);
    bindu(ctx, f, 0.8);
  } };

  // ================= HYPERDIMENSIONAL =================
  T.platonic = { name: 'PLATONIC SOLIDS', cat: 'HYPER', draw(ctx, R, f) {
    const count = clamp(Math.round(f.complexity), 1, 5);
    const sizes = [1, 0.8, 0.62, 0.5, 0.36];
    for (let k = 0; k < count; k++) {
      const { v, e } = SOLIDS[k];
      const s = R * 0.76 * sizes[k] * (1 + f.bass * 0.2) * (1 + sp(f, k * 9) * 0.1);
      const P = v.map((p) => {
        const [x, y, z] = rot3(p, f.rot * (0.6 + k * 0.13) + f.tilt, f.rot * (k % 2 ? -0.8 : 0.9), f.t * 0.07 * (k + 1));
        const q = 3 / (3.6 - z);
        return [x * q * s, y * q * s, z];
      });
      for (const [i, j] of e) {
        const front = (P[i][2] + P[j][2]) / 2;
        stroke(ctx, H(f.t, k), 55 + (front + 1) * 12 + f.treble * 15, 0.35 + (front + 1) * 0.3, (1 + f.bass * 1.8) * (0.8 + (front + 1) * 0.3));
        ctx.beginPath(); ctx.moveTo(P[i][0], P[i][1]); ctx.lineTo(P[j][0], P[j][1]); ctx.stroke();
      }
      ctx.fillStyle = `hsla(${H(f.t, k + 3)},100%,82%,${0.4 + f.treble * 0.5})`;
      for (const p of P) { ctx.beginPath(); ctx.arc(p[0], p[1], 1.5 + f.treble * 3, 0, TAU); ctx.fill(); }
    }
  } };

  T.octaplex = { name: '24-CELL OCTAPLEX', cat: 'HYPER', draw(ctx, R, f) {
    const { v, e } = CELL24;
    const rot = (p, i, j, a) => { const c = Math.cos(a), s = Math.sin(a), x = p[i], y = p[j]; p[i] = x * c - y * s; p[j] = x * s + y * c; };
    const s = R * 0.5 * (1 + f.bass * 0.22);
    const P = v.map((p0) => {
      const p = [...p0];
      rot(p, 0, 3, f.rot * 0.9); rot(p, 1, 2, f.rot * 0.55); rot(p, 2, 3, f.rot * 0.4 + f.t * 0.05); rot(p, 0, 1, f.t * 0.12);
      const w = 1 / (2.9 - p[3]);
      const x = p[0] * w, y = p[1] * w, z = p[2] * w;
      const q = 1 / (1.6 - z);
      return [x * q * s * 3.6, y * q * s * 3.6, p[3]];
    });
    for (const [i, j] of e) {
      const inner = P[i][2] + P[j][2] > 0;
      stroke(ctx, H(f.t, inner ? 1 : 0), inner ? 72 : 52, inner ? 0.85 : 0.45, (inner ? 1.8 : 1.1) + f.bass * 1.6);
      ctx.beginPath(); ctx.moveTo(P[i][0], P[i][1]); ctx.lineTo(P[j][0], P[j][1]); ctx.stroke();
    }
    ctx.fillStyle = `hsla(${H(f.t, 3)},100%,85%,${0.5 + f.treble * 0.5})`;
    for (const p of P) { ctx.beginPath(); ctx.arc(p[0], p[1], 2 + f.treble * 4, 0, TAU); ctx.fill(); }
  } };

  T.torus = { name: 'TORUS FIELD', cat: 'HYPER', draw(ctx, R, f) {
    const Rm = R * 0.42, rm = R * 0.24 * (1 + f.bass * 0.25);
    const tilt = 0.85 + f.tilt * 0.6 + Math.sin(f.t * 0.25) * 0.15;
    const cx = Math.cos(tilt), sx = Math.sin(tilt), cy = Math.cos(f.rot * 0.5), sy = Math.sin(f.rot * 0.5);
    const P = (u, v, mod = 1) => {
      const rr = rm * mod;
      let x = (Rm + rr * Math.cos(v)) * Math.cos(u), y = rr * Math.sin(v), z = (Rm + rr * Math.cos(v)) * Math.sin(u);
      [x, z] = [x * cy - z * sy, x * sy + z * cy];
      [y, z] = [y * cx - z * sx, y * sx + z * cx];
      const q = 2.6 / (2.6 + z / R);
      return [x * q, y * q, z];
    };
    const M = 12 + Math.round(f.complexity) * 6;
    for (let i = 0; i < M; i++) {
      const u = (i / M) * TAU;
      const mod = 1 + sp(f, i) * 0.35;
      ctx.beginPath();
      for (let j = 0; j <= 24; j++) { const p = P(u, (j / 24) * TAU, mod); j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }
      const depth = 0.5 - P(u, 0)[2] / (R * 1.4);
      stroke(ctx, H(f.t, i * 0.15), 52 + f.treble * 22, 0.18 + depth * 0.55, 1 + f.bass * 1.5);
      ctx.stroke();
    }
    for (let k = 0; k < 8; k++) { // energy flowing round the tube
      const v = (k / 8) * TAU + f.t * (0.6 + f.mid);
      ctx.beginPath();
      for (let j = 0; j <= 64; j++) { const p = P((j / 64) * TAU, v); j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }
      stroke(ctx, H(f.t, k + 3), 70, 0.3 + f.beat * 0.4, 1.2 + f.bass * 2);
      ctx.stroke();
    }
  } };

  T.torusknot = { name: 'TORUS KNOT', cat: 'HYPER', draw(ctx, R, f) {
    const KN = [[2, 3], [3, 5], [2, 5], [3, 7], [5, 8]];
    const [p, q] = KN[clamp(Math.round(f.complexity) - 1, 0, 4)];
    const N = 700, s = R * 0.3;
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * TAU;
      const r = 2 + Math.cos(q * t) * (0.9 + f.bass * 0.3 + sp(f, Math.floor((i / N) * 24)) * 0.2); // spectrum swells along the knot
      const [x, y, z] = rot3([r * Math.cos(p * t), r * Math.sin(p * t), Math.sin(q * t) * (1.1 + f.mid * 0.4)], 0.5 + f.tilt * 0.6 + Math.sin(f.t * 0.2) * 0.3, f.rot * 0.6, f.rot * 0.2);
      const k = 4 / (4.5 - z / 3);
      pts.push([x * k * s, y * k * s]);
    }
    for (const [w, light, a] of [[7 + f.bass * 8, 45, 0.18], [1.6 + f.bass * 2, 75, 0.9]]) {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      stroke(ctx, H(f.t, w), light + f.treble * 15, a, w);
      ctx.stroke();
    }
    ctx.fillStyle = `hsla(${H(f.t, 2)},100%,88%,${0.5 + f.treble * 0.5})`;
    const off = Math.floor(f.t * 60) % 25;
    for (let i = off; i < pts.length; i += 25) { ctx.beginPath(); ctx.arc(pts[i][0], pts[i][1], 2 + f.treble * 4, 0, TAU); ctx.fill(); }
  } };

  // ================= COSMIC =================
  T.chrysanthemum = { name: 'DMT CHRYSANTHEMUM', cat: 'COSMIC', draw(ctx, R, f) {
    const rings = 5 + Math.round(f.complexity) * 2;
    const base = Math.max(5, Math.round(f.fold));
    ctx.rotate(f.rot * 0.2);
    for (let k = rings - 1; k >= 0; k--) {
      const q = (k + 1) / rings;
      const e = sp(f, k * 3);
      const ro = R * (0.06 + 0.94 * Math.pow(q, 0.85)) * (1 + e * 0.08 + f.beat * 0.03);
      const ri = ro * 0.6;
      const n = Math.min(160, base * (1 + Math.floor(k / 2)));
      const w = Math.tan(Math.PI / n) * (ri + ro) * 0.55;
      ctx.save();
      ctx.rotate(f.rot * (k % 2 ? 1 : -1) * (0.3 + q) + (k % 2) * (Math.PI / n));
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        ctx.rotate(TAU / n);
        const mid = (ri + ro) / 2 + (ro - ri) * 0.2;
        ctx.moveTo(ri, 0); ctx.quadraticCurveTo(mid, w, ro, 0); ctx.quadraticCurveTo(mid, -w, ri, 0);
      }
      stroke(ctx, H(f.t, k * 0.5), 50 + e * 38, 0.3 + (1 - q) * 0.4 + e * 0.3, 0.9 + e * 2 + f.bass * 0.8);
      ctx.stroke();
      ctx.fillStyle = `hsla(${H(f.t, k + 1)},100%,55%,${0.025 + e * 0.07})`;
      ctx.fill();
      ctx.restore();
    }
    ctx.beginPath(); // the core spiral
    for (let i = 0; i < 120; i++) { const a = i * 0.35 - f.rot * 3, r = R * 0.002 * i * (1 + f.bass); i ? ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.moveTo(0, 0); }
    stroke(ctx, H(f.t, 9), 80, 0.9, 1.5 + f.bass * 2);
    ctx.stroke();
  } };

  T.apollonian = { name: 'APOLLONIAN GASKET', cat: 'COSMIC', draw(ctx, R, f) {
    const maxDepth = 2 + Math.round(f.complexity);
    const s = R * 0.96 * (1 + f.beat * 0.02);
    ctx.rotate(f.rot * 0.2);
    stroke(ctx, H(f.t), 70, 0.8, 2 + f.bass * 2);
    circle(ctx, 0, 0, s);
    let d = -1;
    for (const [x, y, r, depth] of GASKET) {
      if (depth > maxDepth) break;
      if (depth !== d) {
        if (d >= 0) ctx.stroke();
        d = depth;
        const wave = Math.max(0, Math.sin(f.t * 2.5 - depth * 0.9));
        const e = sp(f, depth * 6 + 2);
        stroke(ctx, H(f.t, depth), 50 + wave * 25 + e * 20, 0.3 + wave * 0.45 + e * 0.25, Math.max(0.6, 2.2 - depth * 0.3) + f.bass * (depth < 2 ? 2 : 0.5));
        ctx.beginPath();
      }
      const rr = r * s * (1 + (depth === 0 ? f.bass * 0.04 : 0));
      ctx.moveTo(x * s + rr, y * s);
      ctx.arc(x * s, y * s, Math.max(0.5, rr), 0, TAU);
    }
    if (d >= 0) ctx.stroke();
  } };

  T.wormhole = { name: 'HEX WORMHOLE', cat: 'COSMIC', draw(ctx, R, f) {
    const sides = clamp(Math.round(f.fold) - 2, 3, 12);
    const layers = 26;
    this.z = ((this.z || 0) + f.dt * (0.35 + f.bass * 1.6 + f.level * 0.3)) % 1;
    let prev = null;
    for (let i = layers; i >= 1; i--) {
      const z = (i - this.z) / layers;
      if (z <= 0.03) continue;
      const r = (R * 0.12) / z;
      if (r > R * 3) continue;
      const twist = f.rot * 0.6 + z * (2 + f.mid * 3);
      const e = sp(f, Math.floor(z * 47));
      stroke(ctx, H(f.t, z * 6), 48 + e * 42, (1 - z) * 0.85, (0.8 + e * 3) * (1.6 - z));
      poly(ctx, sides, r, twist);
      if (prev && i % 2 === 0) { // struts between rings
        ctx.beginPath();
        for (let k = 0; k < sides; k++) {
          const a0 = twist + (k / sides) * TAU, a1 = prev.twist + (k / sides) * TAU;
          ctx.moveTo(Math.cos(a0) * r, Math.sin(a0) * r); ctx.lineTo(Math.cos(a1) * prev.r, Math.sin(a1) * prev.r);
        }
        stroke(ctx, H(f.t, z * 6 + 1), 50, (1 - z) * 0.35, 1);
        ctx.stroke();
      }
      prev = { r, twist };
    }
  } };

  T.spirograph = { name: 'SPIROGRAPH', cat: 'COSMIC', draw(ctx, R, f) {
    const curves = clamp(Math.round(f.complexity / 2), 1, 3);
    const SETS = [[5, 3], [7, 4], [8, 3], [9, 5], [11, 4], [13, 8], [12, 5]];
    for (let c = 0; c < curves; c++) {
      const [q, p] = SETS[(c * 2 + Math.floor(f.t / 18)) % SETS.length];
      const r = p / q, d = 0.45 + 0.3 * Math.sin(f.t * 0.3 + c) + f.bass * 0.2;
      const turns = p / gcd(p, q);
      const steps = Math.round(360 * turns);
      const scale = ((R * 0.92) / (1 - r + d)) * (1 - c * 0.2);
      ctx.save();
      ctx.rotate(f.rot * (c % 2 ? -1 : 1) * 0.5);
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * TAU * turns;
        const x = (1 - r) * Math.cos(t) + d * Math.cos(((1 - r) / r) * t);
        const y = (1 - r) * Math.sin(t) - d * Math.sin(((1 - r) / r) * t);
        i ? ctx.lineTo(x * scale, y * scale) : ctx.moveTo(x * scale, y * scale);
      }
      stroke(ctx, H(f.t, c * 2), 60 + f.treble * 25, 0.7, 1.1 + f.bass * 2);
      ctx.stroke();
      ctx.restore();
    }
  } };

  T.thirdeye = { name: 'THIRD EYE', cat: 'COSMIC', draw(ctx, R, f) {
    const s = R * 0.92;
    if (f.beat > 0.95 && !this.blink && Math.random() < 0.08) this.blink = 1;
    if (this.blink) { this.blink -= f.dt * 5; if (this.blink <= 0) this.blink = 0; }
    const open = this.blink ? Math.abs(this.blink * 2 - 1) : 1;
    stroke(ctx, H(f.t, 1), 60, 0.7, 1.8 + f.bass * 2);
    poly(ctx, 3, s * 0.98, -Math.PI / 2, 0, s * 0.12);
    ctx.save(); // rays
    ctx.rotate(f.rot * 0.3);
    ctx.beginPath();
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * TAU, e = sp(f, i);
      ctx.moveTo(Math.cos(a) * s * 0.62, Math.sin(a) * s * 0.62);
      ctx.lineTo(Math.cos(a) * s * (0.7 + e * 0.35), Math.sin(a) * s * (0.7 + e * 0.35));
    }
    stroke(ctx, H(f.t, 3), 70, 0.4 + f.treble * 0.4, 1.2);
    ctx.stroke();
    ctx.restore();
    const ew = s * 0.56, eh = s * 0.3 * open;
    stroke(ctx, H(f.t), 70 + f.beat * 20, 0.9, 2.2 + f.bass * 2);
    ctx.beginPath(); ctx.moveTo(-ew, 0); ctx.quadraticCurveTo(0, -eh * 1.6, ew, 0); ctx.quadraticCurveTo(0, eh * 1.6, -ew, 0); ctx.stroke();
    if (open < 0.25) return;
    const ir = s * 0.2 * Math.min(1, open * 1.3);
    ctx.save();
    ctx.rotate(-f.rot);
    ctx.beginPath();
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * TAU, e = sp(f, i);
      ctx.moveTo(Math.cos(a) * ir * 0.4, Math.sin(a) * ir * 0.4);
      ctx.lineTo(Math.cos(a) * ir * (0.55 + e * 0.5), Math.sin(a) * ir * (0.55 + e * 0.5));
    }
    stroke(ctx, H(f.t, 2), 65 + f.treble * 20, 0.85, 1.3);
    ctx.stroke();
    ctx.restore();
    stroke(ctx, H(f.t, 5), 80, 0.9, 2 + f.bass * 3);
    circle(ctx, 0, 0, ir * (0.25 + f.bass * 0.2));
    circle(ctx, 0, 0, ir * 1.05);
  } };

  // ================= AUDIO =================
  T.cymatics = { name: 'CYMATIC WATER', cat: 'AUDIO', draw(ctx, R, f) {
    // modes change on the beat, like sand jumping into a new figure on a Chladni plate
    if (!this.m) { this.m = 4; this.k = 3; this.last = 0; }
    if (f.beat > 0.9 && f.t - this.last > 1.5) {
      let peak = 0, pi = 0;
      for (let i = 0; i < 48; i++) if (f.spec[i] > peak) { peak = f.spec[i]; pi = i; }
      this.m = Math.max(2, Math.round(f.fold / 2) + (pi % 5));
      this.k = 2 + Math.round(f.complexity * 0.8) + (pi % 3);
      this.last = f.t;
    }
    const m = this.m, k = this.k, m2 = m + 2;
    const NR = 64, thr = 0.07 + f.treble * 0.05;
    const amp2 = 0.4 + f.mid * 0.6;
    for (let i = 1; i <= NR; i++) {
      const r = i / NR;
      const s1 = Math.sin(k * Math.PI * r), s2 = Math.sin((k + 1) * Math.PI * r) * amp2;
      ctx.fillStyle = `hsla(${H(f.t, r * 3)},100%,${55 + r * 20 + f.bass * 15}%,${0.55 + f.bass * 0.4})`;
      const rr = r * R * (1 + f.beat * 0.02);
      for (let j = 0; j < 240; j++) {
        const a = (j / 240) * TAU;
        const v = Math.cos(m * a + f.rot) * s1 + Math.cos(m2 * a - f.rot * 0.7) * s2;
        if (v < thr && v > -thr) ctx.fillRect(COS[j] * rr - 1, SIN[j] * rr - 1, 2.2, 2.2);
      }
    }
    stroke(ctx, H(f.t), 65, 0.6, 1.5 + f.bass * 2);
    circle(ctx, 0, 0, R * 1.01);
  } };

  // ================= LOOP PRODUCTION =================
  // Built for recording loops: they read f.build (0..1 riser), f.drop (1 -> 0 after a drop) and f.beatPh, all capped.
  // SACRED TUNNEL: nested polygons (triangle / hexagon / square / octagon) rushing toward you, with struts between rings
  let tunZ = 0;
  T.sactunnel = { name: 'SACRED TUNNEL', cat: 'LOOP', draw(ctx, R, f) {
    tunZ += f.dt * (0.16 + f.bass * 0.34 + f.build * 0.7 + f.drop * 1.4);
    const N = 16, sides = [6, 3, 6, 4, 6, 8], keep = [];
    for (let i = 0; i < N; i++) {
      const k = (i / N + tunZ) % 1, sc = Math.pow(k, 2.3) * 1.55 * (1 + f.beat * 0.05 + f.drop * 0.25), n = sides[(i + Math.floor(tunZ)) % sides.length];
      keep.push({ k, sc, n, i });
    }
    keep.sort((a, b) => a.k - b.k); // far to near
    let prev = null;
    for (const r of keep) {
      const rr = R * r.sc, a = Math.sin(Math.PI * Math.min(1, r.k * 1.15)) * (0.35 + f.level * 0.4 + f.drop * 0.3);
      if (rr < 2 || a < 0.02) { prev = null; continue; }
      const rot = f.rot * (r.i % 2 ? 1 : -1) * 0.55 + r.k * (1.1 + f.build * 1.5);
      stroke(ctx, H(f.t, r.i), 55 + r.k * 25, Math.min(1, a), 0.8 + r.k * (2.4 + f.bass * 3));
      poly(ctx, r.n, rr, rot);
      if (prev && prev.n === r.n && r.i % 2 === 0) { // struts join each ring to the one behind it
        stroke(ctx, H(f.t, r.i + 1), 60, Math.min(0.7, a * 0.7), 0.8 + r.k * 1.4);
        ctx.beginPath();
        for (let v = 0; v < r.n; v++) {
          const a0 = rot + (v / r.n) * TAU, a1 = prev.rot + (v / r.n) * TAU;
          ctx.moveTo(Math.cos(a0) * rr, Math.sin(a0) * rr);
          ctx.lineTo(Math.cos(a1) * prev.rr, Math.sin(a1) * prev.rr);
        }
        ctx.stroke();
      }
      prev = { n: r.n, rr, rot };
    }
    // the vanishing point: a flower of life core that flares on the drop
    stroke(ctx, H(f.t, 2), 80, 0.8, 1.5 + f.drop * 4);
    circle(ctx, 0, 0, R * (0.05 + f.bass * 0.03 + f.drop * 0.18));
    for (let i = 0; i < 6; i++) { const a = f.rot + (i / 6) * TAU, rr = R * (0.05 + f.drop * 0.18); circle(ctx, Math.cos(a) * rr, Math.sin(a) * rr, rr); }
  } };

  // MATRIX VORTEX: falling code that bends into a spiral and is sucked into the centre
  const VG = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ΦΨΩ∆'.split('');
  const vort = [];
  T.matrixvortex = { name: 'MATRIX VORTEX', cat: 'LOOP', draw(ctx, R, f) {
    const cap = 240;
    while (vort.length < cap) vort.push({ r: 0.1 + Math.random() * 1.1, a: Math.random() * TAU, v: 0.5 + Math.random(), g: VG[(Math.random() * VG.length) | 0], c: (Math.random() * 3) | 0 });
    const pull = 0.18 + f.bass * 0.35 + f.build * 0.6 + f.drop * 1.6;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const p of vort) {
      p.r -= f.dt * p.v * pull * (0.4 + p.r);
      p.a += f.dt * (0.35 + f.mid * 0.6 + f.build * 1.2) * (1.4 / (0.25 + p.r)) * 0.5;
      if (p.r < 0.03) { p.r = 1.05 + Math.random() * 0.2; p.a = Math.random() * TAU; p.g = VG[(Math.random() * VG.length) | 0]; p.v = 0.5 + Math.random(); }
      if (Math.random() < 0.02) p.g = VG[(Math.random() * VG.length) | 0];
      const x = Math.cos(p.a) * p.r * R, y = Math.sin(p.a) * p.r * R * (0.9 + f.tilt * 0.1), size = 9 + p.r * 15 + f.bass * 5;
      ctx.font = `${size | 0}px "Share Tech Mono", monospace`;
      const head = p.r < 0.5 && f.beat > 0.5;
      ctx.fillStyle = `hsla(${H(f.t, head ? p.c + 1 : 0)},100%,${head ? 88 : 52 + p.r * 18}%,${Math.min(1, 0.25 + (1 - p.r * 0.7) * 0.7)})`;
      ctx.fillText(p.g, x, y);
    }
    stroke(ctx, H(f.t, 1), 75, 0.55 + f.drop * 0.4, 1.2 + f.drop * 3);
    circle(ctx, 0, 0, R * (0.04 + f.beat * 0.02 + f.drop * 0.3));
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  } };

  // STROBE KALEIDOSCOPE: petals mirrored around the centre; the colours swap (cyan / pink / purple) on every beat
  let kbCount = 0, kbLast = 0;
  T.kaleidoburst = { name: 'STROBE KALEIDOSCOPE', cat: 'LOOP', draw(ctx, R, f) {
    if (f.beat > 0.9 && f.t - kbLast > 0.15) { kbCount++; kbLast = f.t; }
    const segs = clamp(Math.round(f.fold), 4, 14) + (f.build > 0.6 ? 2 : 0);
    ctx.rotate(f.rot * 0.5);
    for (let s = 0; s < segs * 2; s++) {
      ctx.save();
      ctx.rotate((s / (segs * 2)) * TAU);
      if (s % 2) ctx.scale(1, -1);
      const n = 6;
      for (let i = 0; i < n; i++) {
        const k = (i + 1) / n, amp = sp(f, i * 4 + 2), rr = R * (0.12 + k * 0.85) * (1 + f.bass * 0.05 * (i % 2 ? 1 : -1));
        stroke(ctx, H(f.t, i + kbCount), 52 + amp * 30 + f.beat * 18, 0.35 + amp * 0.5 + f.beat * 0.25, 1 + amp * 3 + f.drop * 3);
        ctx.beginPath();
        ctx.moveTo(rr * 0.5, 0);
        ctx.quadraticCurveTo(rr * 0.8, rr * (0.2 + amp * 0.4 + f.mid * 0.15), rr, rr * 0.06 * Math.sin(f.t * 3 + i));
        ctx.quadraticCurveTo(rr * 0.8, -rr * 0.12, rr * 0.5, 0);
        ctx.stroke();
        if (i % 2 === 0) { ctx.fillStyle = `hsla(${H(f.t, i + kbCount + 1)},100%,${70 + amp * 25}%,${0.4 + amp * 0.5})`; ctx.beginPath(); ctx.arc(rr, 0, 1.5 + amp * 4 + f.beat * 3, 0, TAU); ctx.fill(); }
      }
      ctx.restore();
    }
    stroke(ctx, H(f.t, kbCount), 80, 0.6 + f.drop * 0.4, 2 + f.bass * 3);
    circle(ctx, 0, 0, R * (0.1 + f.beat * 0.04 + f.drop * 0.2));
  } };

  // GLITCH MERKABA: a star tetrahedron split into cyan / pink / purple ghosts, torn into slices that slide on the beat
  T.glitchmerk = { name: 'GLITCH MERKABA', cat: 'LOOP', draw(ctx, R, f) {
    const star = (r, rot) => {
      ctx.beginPath();
      for (let k = 0; k < 2; k++) for (let i = 0; i <= 3; i++) { const a = rot + (i / 3) * TAU + k * Math.PI + Math.PI / 2, x = Math.cos(a) * r, y = Math.sin(a) * r * (k ? 1 : 1); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
      circle(ctx, 0, 0, r * 0.52);
    };
    const r = R * 0.62 * (1 + f.bass * 0.08 + f.drop * 0.2), spread = (f.beat * 0.05 + f.drop * 0.1 + f.build * 0.02) * R;
    ctx.globalCompositeOperation = 'lighter';
    for (let c = 0; c < 3; c++) { // ghosts
      ctx.save();
      ctx.translate((c - 1) * spread, 0);
      stroke(ctx, H(f.t, c), 58, 0.55, 1.5 + f.bass * 3 + f.drop * 3);
      star(r, f.rot * 0.4 + c * 0.03 * f.beat);
      ctx.restore();
    }
    // slices: horizontal bands that slide sideways (more of them as the build climbs, all of them on the drop)
    const slices = 3 + Math.round(f.build * 4 + f.drop * 6), seed = Math.floor(f.t * 12);
    for (let i = 0; i < slices; i++) {
      const hsh = Math.abs(Math.sin(seed * 12.9898 + i * 78.233)) , y = (hsh * 2 - 1) * r, h = R * (0.015 + (i % 3) * 0.02), dx = (Math.abs(Math.sin(seed * 4.1 + i * 9.7)) - 0.5) * R * (0.15 + f.drop * 0.5 + f.beat * 0.2);
      ctx.save();
      ctx.beginPath(); ctx.rect(-R, y, R * 2, h); ctx.clip();
      ctx.translate(dx, 0);
      stroke(ctx, H(f.t, i + 1), 70, 0.9, 2 + f.drop * 2);
      star(r, f.rot * 0.4);
      ctx.restore();
    }
    stroke(ctx, H(f.t, 2), 80, 0.7, 1.2);
    circle(ctx, 0, 0, r * 1.12);
  } };

  return T;
};
