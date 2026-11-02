// AFTERBURNER: live readouts, telemetry trace, presets, tuning, fan-curve node editor, overheat protocol, VRAM, core.
(() => {
  const view = $('#view-afterburner');
  let status = null; // core "status" payload (limits, presets, curves)
  let power = null;

  // ---------------- readouts ----------------
  const tiles = Object.fromEntries($$('.tile', view).map((t) => [t.dataset.t, t]));
  function setTile(k, v, digits = 0, pct = null, warn = null, hot = null) {
    const t = tiles[k];
    if (!t) return;
    const na = v == null || isNaN(v);
    t.classList.toggle('na', na);
    t.querySelector('b').textContent = na ? 'N/A' : Number(v).toFixed(digits);
    t.style.setProperty('--p', `${na || pct == null ? 0 : Math.max(0, Math.min(100, pct))}%`);
    t.classList.toggle('warm', !na && warn != null && v >= warn && !(hot != null && v >= hot));
    t.classList.toggle('hot', !na && hot != null && v >= hot);
  }

  // ---------------- telemetry trace ----------------
  const SERIES = [
    { k: 'cpuTemp', label: 'CPU °C', color: '#00ff6e', min: 30, max: 100, on: true },
    { k: 'gpuTemp', label: 'GPU °C', color: '#1de9b6', min: 30, max: 100, on: true },
    { k: 'cpuClock', label: 'CPU MHz', color: '#9dffb8', min: 0, max: 4600, on: true },
    { k: 'gpuClock', label: 'GPU MHz', color: '#c6ff00', min: 0, max: 2100, on: true },
    { k: 'cpuPower', label: 'CPU W', color: '#69f0ae', min: 0, max: 90, on: false },
    { k: 'gpuPower', label: 'GPU W', color: '#64ffda', min: 0, max: 95, on: false },
    { k: 'cpuFan', label: 'FAN RPM', color: '#ffc400', min: 0, max: 6500, on: false },
  ];
  const trace = Object.fromEntries(SERIES.map((s) => [s.k, []]));
  const TRACE_LEN = 150;
  try { const saved = JSON.parse(localStorage.getItem('ab-series') || 'null'); if (saved) SERIES.forEach((s) => { s.on = saved.includes(s.k); }); } catch {}
  $('#ab-series').innerHTML = SERIES.map((s) => `<button data-k="${s.k}" class="${s.on ? 'on' : ''}" style="color:${s.color};border-color:${s.color}">${s.label}</button>`).join('');
  $('#ab-series').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const s = SERIES.find((x) => x.k === b.dataset.k);
    s.on = !s.on;
    b.classList.toggle('on', s.on);
    try { localStorage.setItem('ab-series', JSON.stringify(SERIES.filter((x) => x.on).map((x) => x.k))); } catch {}
    drawTrace();
  });

  function drawTrace() {
    const c = $('#ab-graph');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = c.getBoundingClientRect();
    if (!r.width) return;
    c.width = r.width * dpr; c.height = r.height * dpr;
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height, padR = 70 * dpr, gw = w - padR;
    ctx.strokeStyle = 'rgba(0,255,110,0.07)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 6; i++) { const y = (h * i) / 6; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(gw, y); ctx.stroke(); }
    for (let x = 0; x < gw; x += 30 * dpr) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    const labels = [];
    for (const s of SERIES) {
      const d = trace[s.k];
      if (!s.on || d.length < 2) continue;
      const step = gw / (TRACE_LEN - 1), off = (TRACE_LEN - d.length) * step;
      const y = (v) => h - ((Math.max(s.min, Math.min(s.max, v)) - s.min) / (s.max - s.min)) * (h - 8 * dpr) - 4 * dpr;
      ctx.beginPath();
      let started = false;
      d.forEach((v, i) => { if (v == null) { started = false; return; } const X = off + i * step; started ? ctx.lineTo(X, y(v)) : ctx.moveTo(X, y(v)); started = true; });
      ctx.strokeStyle = s.color; ctx.globalAlpha = 0.25; ctx.lineWidth = 5 * dpr; ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineWidth = 1.5 * dpr; ctx.stroke();
      const last = d[d.length - 1];
      if (last != null) labels.push({ y: y(last), text: `${Math.round(last)} ${s.label.split(' ')[1]}`, color: s.color });
    }
    // right-edge value tags, nudged apart so they don't overlap
    labels.sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 13 * dpr);
    ctx.font = `${11 * dpr}px "Share Tech Mono", monospace`;
    for (const l of labels) { ctx.fillStyle = l.color; ctx.fillText(l.text, gw + 8 * dpr, Math.min(h - 4, l.y + 4 * dpr)); }
  }

  // ---------------- telemetry handler ----------------
  hs.on('telemetry', (t) => {
    const g = t.gpu || {};
    const vals = {
      cpuTemp: t.cpu?.temp, gpuTemp: t.gpuTemp, cpuClock: t.cpu?.clock, gpuClock: g.clock,
      cpuPower: t.cpu?.power, gpuPower: g.power, cpuFan: t.cpu?.fanRpm,
    };
    for (const s of SERIES) { trace[s.k].push(vals[s.k] ?? null); if (trace[s.k].length > TRACE_LEN) trace[s.k].shift(); }
    if (HS.view !== 'afterburner') return;
    const cpuLim = status?.overheat?.cpuLimit ?? 95, gpuLim = status?.overheat?.gpuLimit ?? 87;
    setTile('cpuClock', t.cpu?.clock, 0, (t.cpu?.clock / 4500) * 100);
    setTile('cpuTemp', t.cpu?.temp, 0, t.cpu?.temp, cpuLim - 10, cpuLim);
    setTile('cpuPower', t.cpu?.power, 1, (t.cpu?.power / 95) * 100);
    setTile('cpuVolt', t.cpu?.voltage, 3, (t.cpu?.voltage / 1.5) * 100);
    setTile('cpuFan', t.cpu?.fanRpm, 0, (t.cpu?.fanRpm / 6500) * 100);
    setTile('cpuUtil', t.cpu?.util, 0, t.cpu?.util);
    setTile('gpuClock', g.clock, 0, (g.clock / 2100) * 100);
    setTile('gpuMem', g.memClock, 0, (g.memClock / 6001) * 100);
    setTile('gpuTemp', t.gpuTemp, 0, t.gpuTemp, gpuLim - 10, gpuLim);
    setTile('gpuPower', g.power, 1, (g.power / (g.powerLimit || 80)) * 100);
    setTile('gpuVolt', g.voltage, 3, (g.voltage / 1.1) * 100);
    setTile('gpuFan', t.gpuFanRpm, 0, (t.gpuFanRpm / 6500) * 100);
    const notes = [];
    if (g.throttle?.length) notes.push(`GPU limited by: ${g.throttle.join(', ')}`);
    if (g.pstate != null) notes.push(`P-state P${g.pstate}`);
    if (t.cpu?.voltage == null) notes.push('CPU voltage needs the optional PawnIO driver');
    if (t.cpu?.temp == null) notes.push('CPU temp + fans need the core running as admin');
    $('#ab-throttle').textContent = notes.join(' · ');
    if (t.acerProfile) markSeg('acerProfile', t.acerProfile);
    drawTrace();
    if (t.fans) { fanLive = t; drawFans(); }
  });

  // ---------------- presets ----------------
  $$('.preset', view).forEach((b) => {
    b.addEventListener('mouseenter', () => { $('#preset-desc').textContent = status?.presets?.[b.dataset.preset]?.desc || 'core offline'; });
    b.addEventListener('click', async () => {
      b.classList.add('busy');
      try {
        const r = await coreCall('preset.apply', { name: b.dataset.preset });
        const bad = r.steps.filter((s) => !s.ok);
        $$('.preset', view).forEach((x) => x.classList.toggle('on', x === b));
        $('#preset-desc').innerHTML = r.steps.map((s) => `${s.ok ? '✓' : '✗'} ${esc(s.step)}${s.ok ? '' : ` <span class="dim">(${esc(s.msg)})</span>`}`).join('<br>');
        toast(bad.length ? `${status?.presets?.[b.dataset.preset]?.label} · ${bad.length} step(s) refused` : `${status?.presets?.[b.dataset.preset]?.label} ENGAGED`, bad.length > 0);
        power = r.power; renderPower();
        applyFanState(r.fans, true);
        HS.saveConfig({ preset: b.dataset.preset });
      } catch (e) { toast(`MODE FAILED: ${e.message}`, true); }
      b.classList.remove('busy');
    });
  });

  HS.actions.preset = (name) => $(`.preset[data-preset="${name}"]`, view)?.click();

  // ---------------- tuning ----------------
  function markSeg(key, v) { $$(`.seg[data-key="${key}"] button`, view).forEach((b) => b.classList.toggle('on', String(b.dataset.v) === String(v))); }
  function renderPower() {
    if (!power) return;
    markSeg('overlay', power.overlay);
    markSeg('acerProfile', power.acerProfile);
    markSeg('boost', power.boost);
    $('#t-cpuMax').value = power.cpuMax; $('#tv-cpuMax').textContent = `${power.cpuMax}%`;
    $('#t-gpuMax').max = power.gpuRange[1];
    $('#t-gpuMax').value = power.gpuMax || power.gpuRange[1];
    $('#tv-gpuMax').textContent = power.gpuMax ? `${power.gpuMax} MHz` : 'UNLOCKED';
    $('#t-memMax').max = power.memRange[1];
    $('#t-memMax').value = power.memMax || power.memRange[1];
    $('#tv-memMax').textContent = power.memMax ? `${power.memMax} MHz` : 'UNLOCKED';
  }
  async function setPower(key, value) {
    try {
      const r = await coreCall('power.set', { key, value });
      power = r.state; renderPower();
      const NAMES = { overlay: 'POWER MODE', acerProfile: 'THERMAL PROFILE', boost: 'TURBO BOOST', cpuMax: 'CPU MAX', gpuMax: 'GPU CLOCK CAP', memMax: 'GPU MEMORY CAP' };
      if (r.result !== 'ok') toast(`${NAMES[key] || key.toUpperCase()}: ${r.result === 'denied' ? 'needs admin (HARDWARE: FULL CONTROL)' : r.result}`, true);
      else toast(`${key.toUpperCase()} → ${value === 0 && /Max$/.test(key) ? 'UNLOCKED' : value}`);
      $$('.preset', view).forEach((x) => x.classList.remove('on'));
    } catch (e) { toast(`TUNING FAILED: ${e.message}`, true); }
  }
  $$('.seg[data-key]', view).forEach((seg) => seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const v = /^\d+$/.test(b.dataset.v) ? Number(b.dataset.v) : b.dataset.v;
    setPower(seg.dataset.key, v);
  }));
  const sliderLabel = { cpuMax: (v) => `${v}%`, gpuMax: (v) => `${v} MHz`, memMax: (v) => `${v} MHz` };
  for (const k of ['cpuMax', 'gpuMax', 'memMax']) {
    const s = $(`#t-${k}`);
    s.addEventListener('input', () => { $(`#tv-${k}`).textContent = sliderLabel[k](s.value); });
    s.addEventListener('change', () => setPower(k, Number(s.value)));
  }
  $('#t-gpuReset').addEventListener('click', () => setPower('gpuMax', 0));
  $('#t-memReset').addEventListener('click', () => setPower('memMax', 0));

  // ---------------- fan curve editor ----------------
  let fanTab = 'cpu';
  let fanMode = 'auto';
  let curves = { cpu: [[40, 20], [55, 30], [65, 45], [75, 65], [85, 90], [92, 100]], gpu: [[40, 20], [55, 30], [65, 50], [72, 70], [80, 90], [86, 100]] };
  let fanLive = null;
  let drag = null;
  const T_MIN = 30, T_MAX = 100;
  // what Acer's custom % really spins at on this laptop (measured; 0% is the firmware's idle speed)
  const RPM = { cpu: [2800, 3700, 4600, 5500, 6250, 7500], gpu: [3150, 4100, 5000, 5950, 6750, 7600] };
  const fanRpm = (fan, p) => {
    const t = RPM[fan] || RPM.cpu, x = Math.max(0, Math.min(100, p)) / 20, i = Math.min(4, Math.floor(x));
    return Math.round((t[i] + (t[i + 1] - t[i]) * (x - i)) / 50) * 50;
  };
  const fc = $('#fan-graph');

  function geom() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = fc.getBoundingClientRect();
    const pad = { l: 40 * dpr, r: 16 * dpr, t: 14 * dpr, b: 26 * dpr };
    return { dpr, r, pad, w: r.width * dpr, h: r.height * dpr };
  }
  const toX = (g, t) => g.pad.l + ((t - T_MIN) / (T_MAX - T_MIN)) * (g.w - g.pad.l - g.pad.r);
  const toY = (g, p) => g.h - g.pad.b - (p / 100) * (g.h - g.pad.t - g.pad.b);

  function drawFans() {
    const g = geom();
    if (!g.r.width) return;
    fc.width = g.w; fc.height = g.h;
    const ctx = fc.getContext('2d');
    const { dpr, pad } = g;
    const pts = curves[fanTab];
    // grid + axes
    ctx.font = `${10 * dpr}px "Share Tech Mono", monospace`;
    ctx.lineWidth = 1;
    for (let t = T_MIN; t <= T_MAX; t += 10) {
      const x = toX(g, t);
      ctx.strokeStyle = 'rgba(0,255,110,0.08)'; ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, g.h - pad.b); ctx.stroke();
      ctx.fillStyle = 'rgba(0,255,110,0.5)'; ctx.textAlign = 'center'; ctx.fillText(`${t}°`, x, g.h - 8 * dpr);
    }
    for (let p = 0; p <= 100; p += 20) {
      const y = toY(g, p);
      ctx.strokeStyle = 'rgba(0,255,110,0.08)'; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(g.w - pad.r, y); ctx.stroke();
      ctx.fillStyle = 'rgba(0,255,110,0.5)'; ctx.textAlign = 'right'; ctx.fillText(`${p}%`, pad.l - 6 * dpr, y + 3 * dpr);
      ctx.fillStyle = 'rgba(0,255,110,0.3)'; ctx.textAlign = 'left'; ctx.fillText(`${(fanRpm(fanTab, p) / 1000).toFixed(1)}k rpm`, pad.l + 4 * dpr, y - 3 * dpr);
    }
    // safety floor zone (core forces fans up on sustained heat above 88°C no matter the curve)
    const sx = toX(g, 88);
    const grad = ctx.createLinearGradient(sx, 0, g.w - pad.r, 0);
    grad.addColorStop(0, 'rgba(255,45,85,0.04)'); grad.addColorStop(1, 'rgba(255,45,85,0.16)');
    ctx.fillStyle = grad; ctx.fillRect(sx, pad.t, g.w - pad.r - sx, g.h - pad.t - pad.b);
    ctx.fillStyle = 'rgba(255,90,122,0.7)'; ctx.textAlign = 'left'; ctx.fillText('SAFETY FLOOR', sx + 4 * dpr, pad.t + 12 * dpr);
    // the other fan's curve, faint
    const other = curves[fanTab === 'cpu' ? 'gpu' : 'cpu'];
    ctx.setLineDash([3 * dpr, 4 * dpr]);
    ctx.strokeStyle = 'rgba(29,233,182,0.3)';
    ctx.beginPath(); other.forEach(([t, p], i) => (i ? ctx.lineTo(toX(g, t), toY(g, p)) : ctx.moveTo(toX(g, t), toY(g, p)))); ctx.stroke();
    ctx.setLineDash([]);
    // fill under curve
    ctx.beginPath();
    ctx.moveTo(toX(g, T_MIN), toY(g, pts[0][1]));
    pts.forEach(([t, p]) => ctx.lineTo(toX(g, t), toY(g, p)));
    ctx.lineTo(toX(g, T_MAX), toY(g, pts[pts.length - 1][1]));
    const lastX = toX(g, T_MAX);
    ctx.lineTo(lastX, g.h - pad.b); ctx.lineTo(toX(g, T_MIN), g.h - pad.b); ctx.closePath();
    const fill = ctx.createLinearGradient(0, pad.t, 0, g.h - pad.b);
    fill.addColorStop(0, 'rgba(0,255,110,0.28)'); fill.addColorStop(1, 'rgba(0,255,110,0.02)');
    ctx.fillStyle = fill; ctx.fill();
    // curve line with glow
    ctx.beginPath();
    pts.forEach(([t, p], i) => (i ? ctx.lineTo(toX(g, t), toY(g, p)) : ctx.moveTo(toX(g, t), toY(g, p))));
    ctx.strokeStyle = 'rgba(0,255,110,0.3)'; ctx.lineWidth = 8 * dpr; ctx.stroke();
    ctx.strokeStyle = '#9dffb8'; ctx.lineWidth = 2 * dpr; ctx.stroke();
    // live position: the curve follows a smoothed temperature, so a one-second spike doesn't spin the fans up
    const raw = fanTab === 'cpu' ? fanLive?.cpu?.temp : fanLive?.gpuTemp;
    const smooth = fanTab === 'cpu' ? fanLive?.fans?.cpuSmooth : fanLive?.fans?.gpuSmooth;
    const liveT = smooth ?? raw;
    if (liveT != null) {
      const x = toX(g, Math.max(T_MIN, Math.min(T_MAX, liveT)));
      ctx.strokeStyle = 'rgba(255,196,0,0.7)'; ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, g.h - pad.b); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#ffc400'; ctx.textAlign = 'center';
      ctx.fillText(smooth != null && raw != null && Math.abs(raw - smooth) >= 2 ? `${smooth}°C (now ${raw}°)` : `${liveT}°C NOW`, x, pad.t + 2 * dpr + 10 * dpr);
    }
    // nodes
    const now = performance.now() / 1000;
    pts.forEach(([t, p], i) => {
      const x = toX(g, t), y = toY(g, p);
      const pulse = 1 + Math.sin(now * 3 + i) * 0.15;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, 16 * dpr * pulse);
      glow.addColorStop(0, 'rgba(0,255,110,0.7)'); glow.addColorStop(1, 'rgba(0,255,110,0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, 16 * dpr * pulse, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = drag?.i === i ? '#ffffff' : '#9dffb8';
      ctx.beginPath(); ctx.arc(x, y, 5 * dpr, 0, Math.PI * 2); ctx.fill();
      if (drag?.i === i) {
        ctx.fillStyle = '#eafff0'; ctx.textAlign = 'center';
        ctx.fillText(`${t}°C → ${p}% (~${fanRpm(fanTab, p)} rpm)`, x, y - 14 * dpr);
      }
    });
    const applied = fanLive?.fans;
    const pct = applied ? (fanTab === 'cpu' ? applied.cpuPct : applied.gpuPct) : -1;
    $('#fan-note').textContent = fanMode === 'curve'
      ? `CURVE ACTIVE${applied?.overridden ? ' · OVERRIDDEN BY OVERHEAT (MAX)' : ''}${pct >= 0 ? ` · ${fanTab.toUpperCase()} fan at ${pct}% (~${fanRpm(fanTab, pct)} rpm)` : ''}${applied?.error ? ` · ${applied.error}` : ''} · 0% = Acer's idle speed`
      : fanMode === 'max' ? 'FANS PINNED AT MAX' : 'FIRMWARE AUTO · switch to CURVE to drive the fans from this graph';
  }
  setInterval(() => { if (HS.view === 'afterburner') drawFans(); }, 120); // node pulse

  function nodeAt(e) {
    const g = geom();
    const mx = (e.clientX - g.r.left) * g.dpr, my = (e.clientY - g.r.top) * g.dpr;
    let best = -1, bd = 22 * g.dpr;
    curves[fanTab].forEach(([t, p], i) => { const d = Math.hypot(toX(g, t) - mx, toY(g, p) - my); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  fc.addEventListener('pointerdown', (e) => {
    const i = nodeAt(e);
    if (i < 0) return;
    drag = { i };
    fc.setPointerCapture(e.pointerId);
    drawFans();
  });
  fc.addEventListener('pointermove', (e) => {
    if (!drag) { fc.style.cursor = nodeAt(e) >= 0 ? 'grab' : 'crosshair'; return; }
    const g = geom();
    const pts = curves[fanTab];
    const i = drag.i;
    let t = T_MIN + (((e.clientX - g.r.left) * g.dpr - g.pad.l) / (g.w - g.pad.l - g.pad.r)) * (T_MAX - T_MIN);
    let p = (100 * (g.h - g.pad.b - (e.clientY - g.r.top) * g.dpr)) / (g.h - g.pad.t - g.pad.b);
    const loT = i > 0 ? pts[i - 1][0] + 2 : T_MIN, hiT = i < pts.length - 1 ? pts[i + 1][0] - 2 : T_MAX;
    const loP = i > 0 ? pts[i - 1][1] : 0, hiP = i < pts.length - 1 ? pts[i + 1][1] : 100; // keep the curve rising
    pts[i] = [Math.round(Math.max(loT, Math.min(hiT, t))), Math.round(Math.max(loP, Math.min(hiP, p)))];
    drawFans();
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    drawFans();
    pushFans();
  };
  fc.addEventListener('pointerup', endDrag);
  fc.addEventListener('pointercancel', endDrag);

  async function pushFans() {
    HS.saveConfig({ fans: { mode: fanMode, cpu: curves.cpu, gpu: curves.gpu } });
    try { applyFanState(await coreCall('fans.set', { mode: fanMode, cpu: curves.cpu, gpu: curves.gpu })); }
    catch (e) { toast(`FANS: ${e.message}`, true); }
  }
  function applyFanState(f, fromPreset = false) {
    if (!f) return;
    fanMode = f.mode;
    if (f.cpuCurve) curves.cpu = f.cpuCurve.map((x) => [...x]);
    if (f.gpuCurve) curves.gpu = f.gpuCurve.map((x) => [...x]);
    $$('#fan-mode button').forEach((b) => b.classList.toggle('on', b.dataset.v === fanMode));
    if (fromPreset) HS.saveConfig({ fans: { mode: fanMode, cpu: curves.cpu, gpu: curves.gpu } });
    drawFans();
  }
  // one path for the BURNER buttons, the dock widget and the shortcuts deck
  let lastNonMax = 'curve';
  async function setFanMode(m, announce = false) {
    if (m === 'toggleMax') m = fanMode === 'max' ? lastNonMax : 'max';
    if (!['auto', 'curve', 'max'].includes(m)) return;
    if (m !== 'max') lastNonMax = m;
    if (!HS.core.elevated) { HS.askAdmin('Fan control'); return; }
    // the saved curve is the truth even if this page hasn't loaded yet
    const f = HS.config.fans;
    if (f?.cpu && !drag) curves = { cpu: f.cpu, gpu: f.gpu || curves.gpu };
    fanMode = m;
    $$('#fan-mode button').forEach((x) => x.classList.toggle('on', x.dataset.v === m));
    await pushFans();
    if (announce) toast(m === 'max' ? 'FANS → MAX (press again to go back)' : m === 'curve' ? 'FANS → YOUR CURVE' : 'FANS → ACER AUTO');
  }
  $('#fan-mode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setFanMode(b.dataset.v); });
  HS.actions.fanMode = (m) => setFanMode(m, true);
  // saved curve changed elsewhere (another window, a migration, a preset): follow it
  hs.on('config', (c) => {
    if (drag || !c.fans?.cpu) return;
    curves = { cpu: c.fans.cpu, gpu: c.fans.gpu || curves.gpu };
    if (c.fans.mode) { fanMode = c.fans.mode; $$('#fan-mode button').forEach((x) => x.classList.toggle('on', x.dataset.v === fanMode)); }
    if (HS.view === 'afterburner') drawFans();
  });
  $('#fan-tab').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    fanTab = b.dataset.v;
    $$('#fan-tab button').forEach((x) => x.classList.toggle('on', x === b));
    drawFans();
  });
  $('#fan-tpl').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !status?.curves?.[b.dataset.v]) return;
    curves = { cpu: status.curves[b.dataset.v].cpu.map((x) => [...x]), gpu: status.curves[b.dataset.v].gpu.map((x) => [...x]) };
    drawFans();
    pushFans();
    toast(`${b.dataset.v.toUpperCase()} CURVE LOADED`);
  });

  // ---------------- COOLING: one-click presets over the curve editor ----------------
  // AUTO and MAX are fan modes; QUIET / BALANCED / COOL load HyperCore's tuned curves for both fans.
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const flat = (c) => (c && c.every((p) => p[1] === c[0][1]) ? c[0][1] : null); // a fixed-speed 'curve'
  function coolPreset() {
    if (fanMode !== 'curve') return fanMode;
    for (const k of ['quiet', 'balanced', 'aggressive']) if (status?.curves?.[k] && same(status.curves[k].cpu, curves.cpu) && same(status.curves[k].gpu, curves.gpu)) return k;
    return flat(curves.cpu) != null && flat(curves.gpu) != null ? 'manual' : 'custom';
  }
  function markCool() {
    const p = coolPreset();
    $$('#cool-presets button').forEach((b) => b.classList.toggle('on', b.dataset.p === p));
    $('#cool-mode').textContent = { auto: 'AUTO', max: 'MAX', quiet: 'QUIET', balanced: 'BALANCED', aggressive: 'COOL', custom: 'YOUR OWN CURVE', manual: 'SET BY HAND' }[p] || '—';
    if (document.activeElement?.id !== 'cool-mc' && document.activeElement?.id !== 'cool-mg') {
      const c = flat(curves.cpu), g = flat(curves.gpu);
      $('#cool-mc').value = c ?? 30; $('#cool-mcv').textContent = c != null && fanMode === 'curve' ? `${c}%` : '—';
      $('#cool-mg').value = g ?? 30; $('#cool-mgv').textContent = g != null && fanMode === 'curve' ? `${g}%` : '—';
    }
  }
  $('#cool-presets').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const p = b.dataset.p;
    if (p === 'auto' || p === 'max') { await setFanMode(p, true); return markCool(); }
    if (!HS.core.elevated) return HS.askAdmin('Fan control');
    if (!status?.curves?.[p]) return toast('FAN PRESETS AREN\'T LOADED YET', true);
    curves = { cpu: status.curves[p].cpu.map((x) => [...x]), gpu: status.curves[p].gpu.map((x) => [...x]) };
    fanMode = 'curve';
    await pushFans();
    markCool();
    toast(`COOLING → ${b.querySelector('b').textContent}`);
  });
  $('#cool-adv').addEventListener('click', () => {
    const adv = $('.ab-fans');
    adv.classList.toggle('hidden');
    $('#cool-adv').textContent = adv.classList.contains('hidden') ? 'CURVE GRAPH ▸' : 'CURVE GRAPH ▾';
    if (!adv.classList.contains('hidden')) { drawFans(); adv.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  });
  // manual: each slider makes that fan's curve a flat line at the chosen speed
  let manT;
  for (const [id, fan, lbl] of [['#cool-mc', 'cpu', '#cool-mcv'], ['#cool-mg', 'gpu', '#cool-mgv']]) {
    $(id).addEventListener('input', (e) => { $(lbl).textContent = `${e.target.value}%`; });
    $(id).addEventListener('change', (e) => {
      if (!HS.core.elevated) return HS.askAdmin('Fan control');
      const v = +e.target.value;
      curves = { ...curves, [fan]: [[40, v], [95, v]] };
      const other = fan === 'cpu' ? 'gpu' : 'cpu';
      if (flat(curves[other]) == null) curves[other] = [[40, +$(fan === 'cpu' ? '#cool-mg' : '#cool-mc').value], [95, +$(fan === 'cpu' ? '#cool-mg' : '#cool-mc').value]];
      fanMode = 'curve';
      clearTimeout(manT); manT = setTimeout(async () => { await pushFans(); markCool(); toast(`${fan.toUpperCase()} FAN SET TO ${v}%`); }, 150);
    });
  }
  hs.on('telemetry', (t) => {
    if (HS.view !== 'afterburner') return;
    const ct = t.cpu?.temp, gt = t.gpuTemp;
    // how hard each fan is working, out of its top speed (~7,900 rpm measured on this laptop)
    for (const [rpm, bar, lbl] of [[t.cpu?.fanRpm, '#cool-cb', '#cool-cp'], [t.gpuFanRpm, '#cool-gb', '#cool-gp']]) {
      const pct = rpm != null ? Math.max(0, Math.min(100, Math.round((rpm / 7900) * 100))) : null;
      $(bar).style.width = `${pct ?? 0}%`;
      $(bar).style.background = pct >= 85 ? 'var(--red)' : pct >= 60 ? 'var(--amber)' : 'var(--g)';
      $(lbl).textContent = pct != null ? `${pct}%` : '--%';
    }
    const heat = (el, v, warm, hot) => { el.textContent = v != null ? `${Math.round(v)}°` : '--°'; el.classList.toggle('hot', v >= hot); el.classList.toggle('warm', v >= warm && v < hot); };
    heat($('#cool-ct'), ct, 85, 93); heat($('#cool-gt'), gt, 78, 85);
    $('#cool-cf').textContent = t.cpu?.fanRpm != null ? `${t.cpu.fanRpm} rpm` : '-- rpm';
    $('#cool-gf').textContent = t.gpuFanRpm != null ? `${t.gpuFanRpm} rpm` : '-- rpm';
    const f = t.fans;
    $('#cool-why').textContent = f?.overridden ? 'overheat protocol has the fans on MAX' : f?.applied === 'curve' && f.cpuPct >= 0 ? `fans at ${f.cpuPct}% / ${f.gpuPct}%` : '';
    markCool();
  });

  // ---------------- overheat protocol ----------------
  function renderOverheat(o) {
    if (!o) return;
    $('#oh-enabled').checked = o.enabled;
    $('#oh-cpu').value = o.cpuLimit; $('#ohv-cpu').textContent = `${o.cpuLimit}°C`;
    $('#oh-gpu').value = o.gpuLimit; $('#ohv-gpu').textContent = `${o.gpuLimit}°C`;
    $('#oh-fans').checked = o.maxFans;
    $('#oh-throttle').checked = o.throttle;
    $('#oh-sim').textContent = o.simulated ? 'END SIMULATION' : 'SIMULATE ALARM';
  }
  async function pushOverheat() {
    const o = { enabled: $('#oh-enabled').checked, cpu: Number($('#oh-cpu').value), gpu: Number($('#oh-gpu').value), maxFans: $('#oh-fans').checked, throttle: $('#oh-throttle').checked };
    HS.saveConfig({ overheat: o });
    try { const r = await coreCall('overheat.set', o); if (status) status.overheat = r; renderOverheat(r); } catch (e) { toast(`PROTOCOL: ${e.message}`, true); }
  }
  ['oh-enabled', 'oh-fans', 'oh-throttle', 'oh-cpu', 'oh-gpu'].forEach((id) => $(`#${id}`).addEventListener('change', pushOverheat));
  $('#oh-cpu').addEventListener('input', (e) => { $('#ohv-cpu').textContent = `${e.target.value}°C`; });
  $('#oh-gpu').addEventListener('input', (e) => { $('#ohv-gpu').textContent = `${e.target.value}°C`; });
  $('#oh-sim').addEventListener('click', async () => {
    const on = !(status?.overheat?.simulated);
    try { const r = await coreCall('overheat.simulate', { on }); if (status) status.overheat = r; renderOverheat(r); } catch (e) { toast(e.message, true); }
  });
  hs.on('alarm', (a) => { if (status) status.overheat = a; renderOverheat(a); });

  // ---------------- VRAM ----------------
  async function tickVram() {
    if (HS.view === 'afterburner' && HS.core.state === 'online') {
      try {
        const r = await coreCall('vram');
        const g = r.gpu || {};
        const pct = g.memTotal ? (g.memUsed / g.memTotal) * 100 : 0;
        $('#vram-fill').style.width = `${pct}%`;
        $('#vram-total').textContent = g.memTotal ? `${fmtBytes(g.memUsed)} / ${fmtBytes(g.memTotal)}` : '—';
        const max = Math.max(1, ...r.list.map((x) => x.vram));
        $('#vram-list').innerHTML = r.list.length ? r.list.map((x) => `<div class="vram-row${x.vram > 512 * 1024 * 1024 ? ' heavy' : ''}">
          <span class="n">${esc(x.name)}${x.count > 1 ? ` <span class="dim">×${x.count}</span>` : ''}</span><span class="v">${fmtBytes(x.vram)}</span><span class="gp">${x.gpu ? x.gpu + '%' : ''}</span>
          <div class="bar"><i style="width:${(x.vram / max) * 100}%"></i></div></div>`).join('') : '<div class="dim">nothing is holding VRAM</div>';
      } catch {}
    }
    setTimeout(tickVram, 3000);
  }

  // ---------------- core panel ----------------
  async function renderCorePanel() {
    let s;
    try { s = await call('coreStatus'); } catch { return; }
    const row = (k, v, bad) => `<div><span>${k}</span><b class="${bad ? 'bad' : ''}">${esc(v)}</b></div>`;
    const st = status;
    $('#core-rows').innerHTML = [
      row('state', s.state === 'online' ? (s.elevated ? 'ONLINE · ADMIN' : 'ONLINE · LIMITED') : s.state.toUpperCase(), !s.elevated),
      row('launch', s.mode === 'task' ? 'silent admin task' : s.mode === 'uac' ? 'admin prompt' : s.mode || '—'),
      row('Acer fans/profiles', st?.acer?.ok ? 'ready' : st?.acer?.error || '—', !st?.acer?.ok),
      row('NVIDIA (NVML)', st?.gpu?.ok ? 'ready' : st?.gpu?.error || '—', !st?.gpu?.ok),
      row('CPU voltage', st?.cpu?.lhmVoltage ? 'LibreHardwareMonitor' : `off (${st?.cpu?.lhmNote || 'PawnIO not installed'})`, !st?.cpu?.lhmVoltage),
      row('skip-prompt task', s.task ? 'installed' : 'not installed'),
      s.error ? row('note', s.error, true) : '',
    ].join('');
    $('#core-task').textContent = s.task ? 'REMOVE SILENT ADMIN' : 'SKIP ADMIN PROMPT';
    $$('#render-gpu button').forEach((b) => b.classList.toggle('on', b.dataset.v === s.renderGpu));
    $('#ab-core-badge').textContent = s.state === 'online' ? (s.elevated ? 'core: admin' : 'core: limited (no admin)') : `core ${s.state}`;
  }
  $('#core-admin').addEventListener('click', async () => {
    toast('RESTARTING CORE · APPROVE THE WINDOWS PROMPT');
    await call('coreRestart', { elevate: true });
    await loadStatus();
  });
  $('#render-gpu').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || b.classList.contains('on')) return;
    toast(`RESTARTING ON ${b.dataset.v === 'nvidia' ? 'NVIDIA' : 'INTEGRATED GPU'}…`);
    await call('setRenderGpu', b.dataset.v).catch(() => {});
  });
  if (hs.remote) $('#render-gpu').classList.add('hidden');

  const markIntro = () => $$('#intro-mode button').forEach((b) => b.classList.toggle('on', b.dataset.v === window.INTRO?.mode));
  $('#intro-mode').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !window.INTRO) return;
    if (b.dataset.v === 'replay') return INTRO.replay();
    INTRO.setMode(b.dataset.v);
    markIntro();
    toast(`STARTUP ANIMATION: ${b.dataset.v.toUpperCase()}`);
  });
  markIntro();

  // NitroSense key (above the numpad) → HYPERSPACE
  function renderNsKey(s) {
    const on = !!s.enabled;
    $$('#ns-key button').forEach((b) => b.classList.toggle('on', (b.dataset.v === 'key') === on));
    $('#ns-status').textContent = !on ? 'the key opens NitroSense as usual'
      : !s.running ? 'starting the key watcher…'
        : `watching · ${s.triggers ? `swapped ${s.triggers}× so far` : 'press the key to try it'}${s.acerEvents ? '' : ' · until the key has been seen, opening NitroSense any other way also opens HYPERSPACE'}`;
  }
  $('#ns-key').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const enabled = b.dataset.v === 'key';
    $('#ns-status').textContent = enabled ? 'starting the key watcher…' : 'handing the key back to NitroSense…';
    try { renderNsKey(await call('keySet', { enabled })); toast(enabled ? 'NITROSENSE KEY → HYPERSPACE' : 'NITROSENSE KEY → NITROSENSE'); }
    catch (er) { toast(er.message, true); }
  });
  if (hs.remote) $('#ns-key').closest('label')?.classList.add('hidden');
  else { call('keyGet').then(renderNsKey).catch(() => {}); HS.onView((v) => { if (v === 'afterburner') call('keyGet').then(renderNsKey).catch(() => {}); }); }

  $('#core-task').addEventListener('click', async () => {
    const s = await call('coreStatus');
    toast(s.task ? 'REMOVING TASK · APPROVE THE PROMPT' : 'INSTALLING TASK · APPROVE THE PROMPT');
    const r = await call('coreTask', s.task ? 'remove' : 'install');
    toast(r.ok ? (s.task ? 'SILENT ADMIN REMOVED' : 'NEXT LAUNCH SKIPS THE ADMIN PROMPT') : 'CANCELLED', !r.ok);
    renderCorePanel();
  });

  // ---------------- load ----------------
  async function loadStatus() {
    renderCorePanel();
    try {
      status = await coreCall('status');
      power = await coreCall('power.get');
      renderPower();
      const f = (await call('config')).fans; // fresh: main may have just re-tuned an old curve
      if (f?.cpu) curves = { cpu: f.cpu, gpu: f.gpu || curves.gpu };
      else if (status.fans) curves = { cpu: status.fans.cpuCurve, gpu: status.fans.gpuCurve };
      fanMode = f?.mode || status.fans?.mode || 'auto';
      if (fanMode !== 'max') lastNonMax = fanMode;
      $$('#fan-mode button').forEach((b) => b.classList.toggle('on', b.dataset.v === fanMode));
      renderOverheat(status.overheat);
      if (HS.config.preset) $$('.preset', view).forEach((x) => x.classList.toggle('on', x.dataset.preset === HS.config.preset));
      drawFans(); drawTrace();
    } catch { /* core not up yet; the 'core' event retries */ }
  }
  hs.on('core', (s) => { if (s.state === 'online') setTimeout(loadStatus, 300); else renderCorePanel(); });
  HS.onView((v) => { if (v === 'afterburner') { loadStatus(); setTimeout(() => { drawTrace(); drawFans(); }, 50); } });
  window.addEventListener('resize', () => { if (HS.view === 'afterburner') { drawTrace(); drawFans(); } });
  call('coreStatus').then((s) => { if (s.state === 'online') loadStatus(); }).catch(() => {}); // core may beat the page
  tickVram();
})();
