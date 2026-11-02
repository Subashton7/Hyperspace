// THERMAL HISTORY: a long CPU/GPU temperature trace like NitroSense's monitor. The main process keeps the
// samples (every 2 s, 12 h, survives restarts); this draws any window of it with fans and load on the same
// timeline, alarm lines, min/max bands on long ranges and a hover readout.
(() => {
  const RANGES = { '5m': 300e3, '30m': 1800e3, '2h': 7200e3, '6h': 21600e3, '12h': 43200e3 };
  const TICK = { '5m': 60e3, '30m': 300e3, '2h': 900e3, '6h': 3600e3, '12h': 7200e3 };
  // row layout from main.js: [t, cpuT, gpuT, cpuFan, gpuFan, cpuLoad, gpuLoad]
  const SERIES = [
    { i: 1, id: 'cpuT', label: 'CPU °C', color: '#00ff6e', axis: 'temp' },
    { i: 2, id: 'gpuT', label: 'GPU °C', color: '#1de9b6', axis: 'temp' },
    { i: 3, id: 'cpuFan', label: 'CPU FAN', color: '#c6ff00', axis: 'rpm' },
    { i: 4, id: 'gpuFan', label: 'GPU FAN', color: '#ffc400', axis: 'rpm' },
    { i: 5, id: 'cpuLoad', label: 'CPU LOAD', color: '#00ff6e', axis: 'pct' },
    { i: 6, id: 'gpuLoad', label: 'GPU LOAD', color: '#1de9b6', axis: 'pct' },
  ];
  const GAP = 12e3; // samples further apart than this were taken across a restart: break the line
  let rows = [];
  let range = '30m';
  let on = { cpuT: true, gpuT: true, cpuFan: false, gpuFan: false, cpuLoad: true, gpuLoad: false };
  try {
    const s = JSON.parse(localStorage.getItem('thermal') || '{}');
    if (s.range in RANGES) range = s.range;
    if (s.on) on = { ...on, ...s.on };
  } catch {}
  const save = () => { try { localStorage.setItem('thermal', JSON.stringify({ range, on })); } catch {} };

  const canvas = document.getElementById('th-graph');
  if (!canvas) return;
  let hoverX = null;

  async function pull() {
    try {
      const add = await hs.call('thermalHistory', rows.length ? rows[rows.length - 1][0] : 0);
      if (add.length) rows = rows.concat(add);
      const cut = Date.now() - RANGES['12h'];
      let k = 0;
      while (k < rows.length && rows[k][0] < cut) k++;
      if (k) rows = rows.slice(k);
    } catch {}
  }
  HS.thermal = { rows: () => rows };

  // first sample index at or after t
  function lowerBound(t) {
    let lo = 0, hi = rows.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (rows[m][0] < t) lo = m + 1; else hi = m; }
    return lo;
  }

  // collapse samples into one point per pixel column: avg + min/max, with breaks across gaps
  function columns(s, t0, span, x0, pw, from) {
    const out = [];
    let col = -1, sum = 0, n = 0, mn = 0, mx = 0, prevT = 0, brk = false;
    const flush = () => { if (n) out.push({ x: x0 + col, v: sum / n, mn, mx, brk }); };
    for (let k = from; k < rows.length; k++) {
      const r = rows[k], v = r[s.i];
      if (v == null) { prevT = 0; continue; }
      const c = Math.floor(((r[0] - t0) / span) * pw);
      const gap = !prevT || r[0] - prevT > GAP;
      prevT = r[0];
      if (c !== col || gap) {
        flush();
        col = c; sum = 0; n = 0; mn = v; mx = v; brk = gap;
      }
      sum += v; n++; if (v < mn) mn = v; if (v > mx) mx = v;
    }
    flush();
    return out;
  }

  function draw() {
    const box = canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(2, box.width * dpr); canvas.height = Math.max(2, box.height * dpr);
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const L = 44 * dpr, R = 52 * dpr, T = 10 * dpr, B = 22 * dpr;
    const pw = Math.max(10, W - L - R), ph = Math.max(10, H - T - B);
    const span = RANGES[range], now = Date.now(), t0 = now - span;
    const from = lowerBound(t0);
    ctx.font = `${10 * dpr}px "Share Tech Mono", monospace`;

    // temperature axis: 30–100 °C unless the data says otherwise
    let tMin = 30, tMax = 100, rpmMax = 6000;
    for (let k = from; k < rows.length; k++) {
      const r = rows[k];
      for (const i of [1, 2]) if (r[i] != null) { if (r[i] < tMin + 2) tMin = Math.floor((r[i] - 5) / 10) * 10; if (r[i] > tMax - 2) tMax = Math.ceil((r[i] + 5) / 10) * 10; }
      for (const i of [3, 4]) if (r[i] != null && r[i] * 1.1 > rpmMax) rpmMax = Math.ceil((r[i] * 1.1) / 1000) * 1000;
    }
    const yT = (v) => T + ph - ((v - tMin) / (tMax - tMin)) * ph;
    const yR = (v) => T + ph - (v / rpmMax) * ph;
    const yP = (v) => T + ph - (v / 100) * ph;

    // grid + axes
    ctx.lineWidth = 1;
    ctx.textBaseline = 'middle';
    for (let v = tMin; v <= tMax; v += 10) {
      const y = Math.round(yT(v)) + 0.5;
      ctx.strokeStyle = 'rgba(0,255,110,0.08)';
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
      ctx.fillStyle = '#0b9a48'; ctx.textAlign = 'right'; ctx.fillText(`${v}°`, L - 6 * dpr, y);
    }
    if (on.cpuFan || on.gpuFan) {
      ctx.textAlign = 'left';
      for (let v = 0; v <= rpmMax; v += rpmMax > 6000 ? 2000 : 1000) { ctx.fillStyle = '#8a9a20'; ctx.fillText(`${v / 1000}k`, L + pw + 6 * dpr, yR(v)); }
    }
    ctx.textBaseline = 'top'; ctx.textAlign = 'center';
    const tick = TICK[range];
    for (let t = Math.ceil(t0 / tick) * tick; t <= now; t += tick) {
      const x = Math.round(L + ((t - t0) / span) * pw) + 0.5;
      ctx.strokeStyle = 'rgba(0,255,110,0.06)';
      ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke();
      ctx.fillStyle = '#0b9a48';
      ctx.fillText(new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }), x, T + ph + 6 * dpr);
    }

    // overheat alarm lines
    const oh = HS.config.overheat || {};
    for (const [v, col, txt] of [[oh.cpu ?? 95, '#ff2d55', 'CPU ALARM'], [oh.gpu ?? 87, '#ffc400', 'GPU ALARM']]) {
      if (v < tMin || v > tMax) continue;
      const y = Math.round(yT(v)) + 0.5;
      ctx.setLineDash([6 * dpr, 5 * dpr]); ctx.strokeStyle = col + '99';
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = col; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText(`${txt} ${v}°`, L + 4 * dpr, y - 2 * dpr);
    }

    // series: load as faint areas underneath, then fans (dashed), then temps on top
    const order = ['cpuLoad', 'gpuLoad', 'cpuFan', 'gpuFan', 'gpuT', 'cpuT'];
    for (const id of order) {
      if (!on[id]) continue;
      const s = SERIES.find((x) => x.id === id);
      const pts = columns(s, t0, span, L, pw, from);
      if (!pts.length) continue;
      const y = s.axis === 'temp' ? yT : s.axis === 'rpm' ? yR : yP;
      if (s.axis === 'pct') {
        ctx.fillStyle = s.color + '1c';
        let open = false;
        ctx.beginPath();
        pts.forEach((p, k) => {
          if (p.brk && open) { ctx.lineTo(pts[k - 1].x, T + ph); open = false; }
          if (!open) { ctx.moveTo(p.x, T + ph); open = true; }
          ctx.lineTo(p.x, y(p.v));
        });
        if (open) ctx.lineTo(pts[pts.length - 1].x, T + ph);
        ctx.fill();
        continue;
      }
      if (s.axis === 'temp' && span > RANGES['30m']) { // min/max band once a column holds many samples
        ctx.strokeStyle = s.color + '30'; ctx.lineWidth = 1 * dpr;
        ctx.beginPath();
        for (const p of pts) if (p.mx > p.mn) { ctx.moveTo(p.x + 0.5, y(p.mn)); ctx.lineTo(p.x + 0.5, y(p.mx)); }
        ctx.stroke();
      }
      ctx.strokeStyle = s.color;
      ctx.lineWidth = (s.axis === 'temp' ? 2 : 1.3) * dpr;
      ctx.setLineDash(s.axis === 'rpm' ? [5 * dpr, 4 * dpr] : []);
      ctx.shadowColor = s.color; ctx.shadowBlur = s.axis === 'temp' ? 6 * dpr : 0;
      ctx.beginPath();
      pts.forEach((p) => (p.brk ? ctx.moveTo(p.x, y(p.v)) : ctx.lineTo(p.x, y(p.v))));
      ctx.stroke();
      ctx.setLineDash([]); ctx.shadowBlur = 0;
    }

    if (!rows.length || from >= rows.length) {
      ctx.fillStyle = '#0b9a48'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `${12 * dpr}px "Share Tech Mono", monospace`;
      ctx.fillText(HS.core.state === 'online' ? 'collecting samples…' : 'temperatures need HyperCore', L + pw / 2, T + ph / 2);
    }

    // hover readout
    if (hoverX != null && rows.length) {
      const x = Math.max(L, Math.min(L + pw, hoverX * dpr));
      const t = t0 + ((x - L) / pw) * span;
      let k = lowerBound(t);
      if (k >= rows.length || (k > 0 && t - rows[k - 1][0] < rows[k][0] - t)) k--;
      const r = rows[Math.max(0, k)];
      if (r && Math.abs(r[0] - t) < Math.max(GAP, span / pw * 3)) {
        const rx = Math.round(L + ((r[0] - t0) / span) * pw) + 0.5;
        ctx.strokeStyle = 'rgba(234,255,240,0.5)';
        ctx.beginPath(); ctx.moveTo(rx, T); ctx.lineTo(rx, T + ph); ctx.stroke();
        const lines = [new Date(r[0]).toLocaleTimeString([], { hour12: false })];
        for (const s of SERIES) if (on[s.id] && r[s.i] != null) lines.push(`${s.label.padEnd(9)} ${r[s.i]}${s.axis === 'temp' ? '°' : s.axis === 'rpm' ? ' rpm' : '%'}`);
        ctx.font = `${11 * dpr}px "Share Tech Mono", monospace`;
        const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16 * dpr, bh = lines.length * 15 * dpr + 8 * dpr;
        const bx = rx + 10 * dpr + bw > L + pw ? rx - bw - 10 * dpr : rx + 10 * dpr;
        ctx.fillStyle = 'rgba(0,14,6,0.92)'; ctx.strokeStyle = 'rgba(0,255,110,0.5)';
        ctx.fillRect(bx, T + 4 * dpr, bw, bh); ctx.strokeRect(bx + 0.5, T + 4 * dpr + 0.5, bw, bh);
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        lines.forEach((l, j) => {
          const s = SERIES.find((x) => l.startsWith(x.label));
          ctx.fillStyle = j === 0 ? '#eafff0' : s?.color || '#00ff6e';
          ctx.fillText(l, bx + 8 * dpr, T + 8 * dpr + j * 15 * dpr);
        });
        for (const s of SERIES) {
          if (!on[s.id] || r[s.i] == null || s.axis === 'pct') continue;
          const yy = s.axis === 'temp' ? yT(r[s.i]) : yR(r[s.i]);
          ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(rx, yy, 3.5 * dpr, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    stats(from, oh);
  }

  function stats(from, oh) {
    const acc = SERIES.map(() => ({ sum: 0, n: 0, max: -Infinity }));
    let hot = 0, prev = 0;
    for (let k = from; k < rows.length; k++) {
      const r = rows[k];
      SERIES.forEach((s, j) => { const v = r[s.i]; if (v != null) { acc[j].sum += v; acc[j].n++; if (v > acc[j].max) acc[j].max = v; } });
      if (prev && r[0] - prev <= GAP && ((r[1] ?? 0) >= (oh.cpu ?? 95) || (r[2] ?? 0) >= (oh.gpu ?? 87))) hot += r[0] - prev;
      prev = r[0];
    }
    const cls = (v, lim) => (v >= lim ? 'hot' : v >= lim - 8 ? 'warm' : '');
    const out = [];
    const t = (j, lim) => (acc[j].n ? `avg<b>${Math.round(acc[j].sum / acc[j].n)}°</b> peak<b class="${cls(acc[j].max, lim)}">${acc[j].max}°</b>` : '<b>--</b>');
    out.push(`<span>CPU ${t(0, oh.cpu ?? 95)}</span>`, `<span>GPU ${t(1, oh.gpu ?? 87)}</span>`);
    if (acc[2].n) out.push(`<span>CPU FAN avg<b>${Math.round(acc[2].sum / acc[2].n)}</b></span>`);
    if (acc[3].n) out.push(`<span>GPU FAN avg<b>${Math.round(acc[3].sum / acc[3].n)}</b></span>`);
    if (acc[4].n) out.push(`<span>CPU LOAD avg<b>${Math.round(acc[4].sum / acc[4].n)}%</b></span>`);
    out.push(`<span>at alarm temps<b class="${hot ? 'hot' : ''}">${hot ? `${Math.max(1, Math.round(hot / 60e3))} min` : 'never'}</b></span>`);
    document.getElementById('th-stats').innerHTML = out.join('');
    const first = rows[from];
    document.getElementById('th-span').textContent = first ? `since ${new Date(first[0]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}` : '';
  }

  // controls
  const ser = document.getElementById('th-series');
  ser.innerHTML = SERIES.map((s) => `<button data-s="${s.id}" style="color:${s.color}">${s.label}</button>`).join('');
  const sync = () => {
    ser.querySelectorAll('button').forEach((b) => b.classList.toggle('on', !!on[b.dataset.s]));
    document.querySelectorAll('#th-range button').forEach((b) => b.classList.toggle('on', b.dataset.v === range));
  };
  ser.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; on[b.dataset.s] = !on[b.dataset.s]; save(); sync(); draw(); });
  document.getElementById('th-range').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; range = b.dataset.v; save(); sync(); draw(); });
  canvas.addEventListener('mousemove', (e) => { hoverX = e.offsetX; draw(); });
  canvas.addEventListener('mouseleave', () => { hoverX = null; draw(); });
  sync();

  const visible = () => HS.view === 'afterburner';
  async function loop() {
    await pull();
    if (visible()) draw();
    setTimeout(loop, visible() ? 2000 : 10000);
  }
  HS.onView((v) => { if (v === 'afterburner') pull().then(draw); });
  new ResizeObserver(() => { if (visible()) draw(); }).observe(canvas.parentElement);
  loop();
})();
