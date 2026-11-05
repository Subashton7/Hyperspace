// HYPERSPACE app logic: polling, process table, sensory shield, core status, alarms, vacuum, phone link.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const call = (name, ...args) => hs.call(name, ...args);
const coreCall = (cmd, args) => hs.call('core', cmd, args);

const fmtBytes = (b) => {
  if (b == null || isNaN(b)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(b >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
};
const fmtRate = (b) => `${fmtBytes(b)}/s`;
const fmtUptime = (sec) => {
  const d = Math.floor(sec / 86400), h = Math.floor(sec / 3600) % 24, m = Math.floor(sec / 60) % 60;
  return d ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ago = (ms) => {
  if (!ms) return '—';
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

let toastTimer;
function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('bad', bad);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), bad ? 6000 : Math.max(2600, String(msg).length * 70));
}

// Shared state for the other modules (afterburner.js, vj.js, deck.js).
const HS = {
  inVJ: () => HS.view === 'crate' && HS.crateSection === 'vj', // true while CRATE > VJ is showing
  data: {},    // latest perf / telemetry / hw / procs / media / volume / router, read by widgets
  actions: {}, // things widgets and shortcuts can trigger (filled in by each module)
  telemetry: null, core: { state: 'offline' }, config: {}, view: 'nexus', viewListeners: [],
  // a tab popped out into its own window: it shows pages but leaves global duties to the main window
  solo: new URLSearchParams(location.search).get('solo') === '1',
  onView(fn) { this.viewListeners.push(fn); },
  saveConfig(patch) { Object.assign(this.config, patch); return call('setConfig', patch).catch(() => {}); },
};
window.HS = HS;

const MANTRAS = ['the veil is thin', 'all is signal', 'as above, so below', 'breathe with the machine',
  'every process is a being', 'follow the white rabbit', 'the pattern recognizes you', 'entropy is just unread order'];
setInterval(() => { $('#sb-msg').textContent = MANTRAS[(Math.random() * MANTRAS.length) | 0]; }, 12000);

// ---------------- window chrome ----------------
$$('[data-win]').forEach((b) => b.addEventListener('click', () => hs.win(b.dataset.win)));
setInterval(() => { $('#clock').textContent = new Date().toLocaleTimeString([], { hour12: false }); }, 1000);

const FX_LEVELS = ['high', 'low', 'off'];
let fxLevel = hs.remote ? 'low' : matchMedia('(prefers-reduced-motion: reduce)').matches ? 'off' : 'high';
try { fxLevel = localStorage.getItem('fx') || fxLevel; } catch {}
function applyFx() {
  document.body.dataset.fx = fxLevel;
  $('#fx-btn').textContent = `FX: ${fxLevel.toUpperCase()}`;
  FX.setLevel(HS.lite?.on ? 'off' : fxLevel);
  try { localStorage.setItem('fx', fxLevel); } catch {}
}
$('#fx-btn').addEventListener('click', () => { fxLevel = FX_LEVELS[(FX_LEVELS.indexOf(fxLevel) + 1) % 3]; applyFx(); });
applyFx();
HS.actions.setFx = (l) => { if (FX_LEVELS.includes(l)) { fxLevel = l; applyFx(); } };
HS.fxLevel = () => fxLevel;

// ---------------- LITE MODE: looks off while something heavy runs (the switch lives in the laptop's main process) ----------------
const LITE_MODES = ['auto', 'on', 'off'];
function applyLite(s) {
  HS.lite = s;
  document.body.classList.toggle('lite', !!s.on);
  FX.setLite(!!s.on);
  applyFx();
  const b = $('#lite-btn');
  b.textContent = s.mode === 'auto' ? `LITE: AUTO${s.on ? ' · ON' : ''}` : `LITE: ${s.mode.toUpperCase()}`;
  b.classList.toggle('lit', !!s.on);
  b.title = s.on ? `Lite mode is on${s.why && s.why !== 'switched on' ? ` (${s.why})` : ''}: background, motion and glow are off. Click to change.` : 'Lite mode: AUTO turns the looks off while the laptop is busy or hot. Click: AUTO → ON → OFF';
  window.dispatchEvent(new CustomEvent('hs-lite', { detail: s }));
}
$('#lite-btn').addEventListener('click', async () => {
  const next = LITE_MODES[(LITE_MODES.indexOf(HS.lite?.mode || 'auto') + 1) % 3];
  applyLite(await call('liteSet', { mode: next }));
  toast(next === 'auto' ? 'LITE MODE: AUTO · LOOKS DROP WHILE THE LAPTOP WORKS HARD' : next === 'on' ? 'LITE MODE ON · LOOKS OFF, EVERYTHING STILL RUNS' : 'LITE MODE OFF · FULL LOOKS');
});
hs.on('lite', (s) => {
  const was = HS.lite?.on;
  applyLite(s);
  if (s.mode === 'auto' && was !== undefined && was !== s.on) toast(s.on ? `LITE MODE ON · ${String(s.why || 'busy').toUpperCase()}` : 'LAPTOP CALM AGAIN · FULL LOOKS BACK');
});
call('liteGet').then(applyLite).catch(() => {});

// ---------------- navigation ----------------
function showView(name) {
  if (name === 'vj') { name = 'crate'; HS.crateSection = 'vj'; } // VJ lives inside CRATE now (CRATE > VJ)
  $$('.nav').forEach((x) => x.classList.toggle('active', x.dataset.view === name));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  FX.setSealed($(`#view-${name} .sealed-canvas`) || null);
  document.body.classList.toggle('vj-mode', name === 'crate' && HS.crateSection === 'vj'); // the VJ stage covers the background: don't draw it
  HS.view = name;
  HS.viewListeners.forEach((fn) => fn(name));
  if (!HS.solo) try { localStorage.setItem('view', name); } catch {}
}
$$('.nav').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

// ---------------- static info ----------------
call('info').then((i) => {
  $('#host').textContent = i.host.toUpperCase();
  document.body.classList.toggle('no-acer', !i.acer); document.body.classList.toggle('is-acer', !!i.acer);
  $('#cpu-name').textContent = `${i.cpu.replace(/CPU|Processor/g, '').replace(/\s+/g, ' ').trim()} · ${i.cores} threads`;
  if ($('#ab-cpu-name')) $('#ab-cpu-name').textContent = `CPU · ${i.cpu.replace(/\(R\)|\(TM\)|CPU|Processor|\d+th Gen|Intel|AMD|Core/gi, '').replace(/\s+/g, ' ').trim()}`;
  const g0 = (i.gpu || []).map((x) => (typeof x === 'string' ? x : x?.name || x?.model || '')).find((x) => /nvidia|radeon|rx |arc/i.test(x)) || (i.gpu || [])[0];
  if ($('#ab-gpu-name') && g0) $('#ab-gpu-name').textContent = `GPU · ${String(typeof g0 === 'string' ? g0 : g0.name || g0.model || '').replace(/NVIDIA|GeForce|AMD|Laptop GPU|\(R\)/gi, '').replace(/\s+/g, ' ').trim()}`;
  $('#sb-machine').textContent = `${i.machine} · ${i.os}`;
  $('#v-gpu-sub').textContent = i.gpu.join(' + ') || '—';
}).catch(() => {});

// ---------------- sparklines / radar ----------------
const HIST = 90;
const hist = { cpu: [], mem: [], gpu: [], disk: [], net: [], net2: [] };
const sparkColors = { cpu: '#00ff6e', mem: '#00ff6e', gpu: '#1de9b6', disk: '#c6ff00', net: '#00ff6e' };
function push(k, v) { hist[k].push(v); if (hist[k].length > HIST) hist[k].shift(); }

function drawSpark(k) {
  if (radar && (k === 'disk' || k === 'net')) return; // fx.js animates these in radar mode
  const c = $(`.vital[data-k="${k}"] .spark`);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const r = c.getBoundingClientRect();
  c.width = Math.max(1, r.width * dpr); c.height = Math.max(1, r.height * dpr);
  const ctx = c.getContext('2d');
  const w = c.width, h = c.height;
  ctx.strokeStyle = 'rgba(0,255,110,0.07)';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 12 * dpr) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  const series = k === 'net' ? [[hist.net, '#00ff6e'], [hist.net2, '#1de9b6']] : [[hist[k], sparkColors[k]]];
  const max = k === 'net' ? Math.max(1024, ...hist.net, ...hist.net2) * 1.15 : 100;
  for (const [data, col] of series) {
    if (data.length < 2) continue;
    const step = w / (HIST - 1);
    const off = (HIST - data.length) * step;
    ctx.beginPath();
    data.forEach((v, i) => { const x = off + i * step, y = h - (v / max) * (h - 2) - 1; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.strokeStyle = col; ctx.lineWidth = 1.5 * dpr;
    ctx.stroke();
    ctx.lineTo(w, h); ctx.lineTo(off, h); ctx.closePath();
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, col + '55'); g.addColorStop(1, col + '00');
    ctx.fillStyle = g; ctx.fill();
  }
}

let radar = false;
function applyRadar() {
  $('#radar-btn').textContent = `MODE: ${radar ? 'RADAR' : 'GRAPH'}`;
  FX.setRadar(radar ? { disk: $('.vital[data-k="disk"] .spark'), net: $('.vital[data-k="net"] .spark') } : null);
  if (!radar) { drawSpark('disk'); drawSpark('net'); }
}
$('#radar-btn').addEventListener('click', () => { radar = !radar; applyRadar(); HS.saveConfig({ vitalsMode: radar ? 'radar' : 'graphs' }); });

// ---------------- performance loop ----------------
async function tickPerf() {
  // minimised / hidden: nothing to draw, so don't ask (the loop keeps ticking and picks up when it's back)
  if (document.hidden) return setTimeout(tickPerf, 1000);
  try {
    const p = await call('perf');
    HS.data.perf = p;
    const memPct = (p.mem.used / p.mem.total) * 100;
    push('cpu', p.cpu); push('mem', memPct); push('gpu', p.gpu); push('disk', p.disk.pct);
    push('net', p.net.rx); push('net2', p.net.tx);
    $('#core-pct').textContent = `${Math.round(memPct)}%`;
    $('#core-sub').textContent = `${fmtBytes(p.mem.used)} / ${fmtBytes(p.mem.total)}`;
    $('#v-cpu').textContent = `${p.cpu.toFixed(1)}%`;
    const hot = p.cores.reduce((m, v, i) => (v > p.cores[m] ? i : m), 0);
    const temp = p.temps?.cpu != null ? ` · ${p.temps.cpu}°C` : '';
    $('#v-cpu-sub').textContent = `${p.cores.length} threads · hottest #${hot} @ ${Math.round(p.cores[hot])}%${temp}`;
    $('#v-mem').textContent = `${memPct.toFixed(0)}%`;
    $('#v-mem-sub').textContent = `${fmtBytes(p.mem.used)} / ${fmtBytes(p.mem.total)}`;
    $('#v-gpu').textContent = `${Math.round(p.gpu)}%`;
    $('#v-disk').textContent = `${Math.round(p.disk.pct)}%`;
    $('#v-disk-sub').textContent = `R ${fmtRate(p.disk.read)} · W ${fmtRate(p.disk.write)}`;
    $('#v-net').textContent = fmtRate(p.net.rx + p.net.tx);
    $('#v-net-sub').textContent = `↓ ${fmtRate(p.net.rx)} · ↑ ${fmtRate(p.net.tx)}`;
    ['cpu', 'mem', 'gpu', 'disk', 'net'].forEach(drawSpark);
    const legend = { mem: memPct, gpu: p.gpu, disk: p.disk.pct, cpu: p.cpu };
    for (const [k, v] of Object.entries(legend)) $(`.rl[data-k="${k}"] b`).textContent = `${Math.round(v)}%`;
    FX.setPerf({ cpu: p.cpu / 100, cores: p.cores.map((c) => c / 100), mem: memPct / 100, gpu: p.gpu / 100, disk: p.disk.pct / 100 });
    FX.setIo({ rx: p.net.rx, tx: p.net.tx, read: p.disk.read, write: p.disk.write });
    $('#sb-self').textContent = p.selfGpu != null ? `◈ SELF GPU ${Math.round(p.selfGpu)}%` : '';
    $('#sb-uptime').textContent = `uptime ${fmtUptime(p.uptime)}`;
    $('#sb-drives').textContent = p.drives.map((d) => `${d.mount} ${fmtBytes(d.size - d.used)} free`).join(' · ');
    $('#sb-batt').textContent = p.battery ? `⚡ ${p.battery.pct}%${p.battery.charging ? ' charging' : ''}` : '';
  } catch (e) { console.error(e); }
  setTimeout(tickPerf, hs.remote ? 2000 : 1000);
}

// ---------------- processes ----------------
let procs = [];
let sort = { key: 'cpu', dir: -1 };
let grouped = true;
let query = '';
let armed = null;

function view() {
  let rows;
  if (grouped) {
    const m = new Map();
    for (const p of procs) {
      const k = p.name.toLowerCase();
      const g = m.get(k);
      if (g) { g.cpu += p.cpu; g.mem += p.mem; g.vram += p.vram || 0; g.n++; g.pids.push(p.pid); }
      else m.set(k, { ...p, vram: p.vram || 0, n: 1, pids: [p.pid] });
    }
    rows = [...m.values()];
  } else rows = procs.map((p) => ({ ...p, vram: p.vram || 0, n: 1, pids: [p.pid] }));
  if (query) rows = rows.filter((r) => r.name.toLowerCase().includes(query) || String(r.pid).includes(query));
  const { key, dir } = sort;
  rows.sort((a, b) => (key === 'name' ? a.name.localeCompare(b.name) : (a[key] || 0) - (b[key] || 0)) * dir);
  return rows;
}

function renderProcs() {
  const rows = view().slice(0, 250);
  const maxMem = Math.max(1, ...rows.map((r) => r.mem));
  $('#proc-body').innerHTML = rows.map((r) => {
    const key = r.pids.join(',');
    const isSel = sel && (grouped ? sel.name === r.name.toLowerCase() : sel.pids[0] === r.pid);
    return `<div class="row${r.cpu > 10 ? ' hot' : ''}${isSel ? ' sel' : ''}" data-pids="${key}" data-name="${esc(r.name)}">
      <div class="c-name">${esc(r.name)}${r.n > 1 ? `<span class="n">×${r.n}</span>` : ''}</div>
      <div class="c-pid">${r.n > 1 ? '—' : r.pid}</div>
      <div class="meter"><div class="bar${r.cpu > 25 ? ' heavy' : ''}"><i style="width:${Math.min(100, r.cpu)}%"></i></div><span>${r.cpu.toFixed(1)}%</span></div>
      <div class="meter"><div class="bar"><i style="width:${(r.mem / maxMem) * 100}%"></i></div><span>${fmtBytes(r.mem)}</span></div>
      <div class="c-vram${r.vram ? '' : ' none'}">${r.vram ? fmtBytes(r.vram) : '·'}</div>
      <div class="c-act"><button class="loc" title="Show file location">◱</button><button class="kill${armed === key ? ' arm' : ''}">${armed === key ? 'SURE?' : 'END'}</button></div>
    </div>`;
  }).join('');
}

// ---------------- task manager controls: select a row, then act on it (bar or right-click menu) ----------------
let sel = null; // { name (lower-case), pids, label }
function selectRow(row) {
  const pids = row.dataset.pids.split(',').map(Number);
  sel = { name: row.dataset.name.toLowerCase(), pids, label: row.dataset.name };
  renderProcs();
  updateBar();
}
function selPids() {
  if (!sel) return [];
  if (!grouped) return sel.pids;
  const live = procs.filter((p) => p.name.toLowerCase() === sel.name).map((p) => p.pid);
  return live.length ? live : sel.pids;
}
function updateBar() {
  $('#proc-bar').classList.toggle('active', !!sel);
  $('#pb-sel').innerHTML = sel ? `<b>${esc(sel.label)}</b>${selPids().length > 1 ? ` ×${selPids().length}` : ` · ${selPids()[0]}`}` : 'click a row to select · right-click for everything';
}
async function procAct(action, value) {
  if (!sel) return toast('CLICK AN APP IN THE LIST FIRST', true);
  const pids = selPids(), label = sel.label.toUpperCase();
  if ((action === 'end' || action === 'tree' || action === 'restart') && !confirm(`${action === 'restart' ? 'Restart' : 'End'} ${sel.label}? Anything unsaved in it will be lost.`)) return;
  const each = async (fn) => { const r = await Promise.allSettled(pids.map(fn)); const bad = r.filter((x) => x.status === 'rejected'); if (bad.length) throw new Error(bad[0].reason?.message || 'refused'); };
  try {
    switch (action) {
      case 'end': await each(async (pid) => { const r = await call('kill', pid); if (!r.ok) throw new Error(r.error); }); toast(`ENTITY RELEASED · ${label}`); sel = null; break;
      case 'tree': await each((pid) => coreCall('proc.tree', { pid })); toast(`TREE RELEASED · ${label}`); sel = null; break;
      case 'restart': toast(`RESTARTING ${label}…`); await call('procRestart', pids[0], pids); toast(`${label} RESTARTED`); sel = null; break;
      case 'suspend': {
        const on = !sel.suspended;
        await each((pid) => coreCall('proc.suspend', { pid, on }));
        sel.suspended = on;
        toast(on ? `${label} FROZEN · SUSPEND AGAIN TO WAKE IT` : `${label} RESUMED`);
        break;
      }
      case 'eco': { const on = !sel.eco; await each((pid) => coreCall('proc.efficiency', { pid, on })); sel.eco = on; toast(`${label} ECO MODE ${on ? 'ON' : 'OFF'}`); break; }
      case 'prio': if (!value) return; await each((pid) => coreCall('proc.priority', { pid, level: value })); toast(`${label} PRIORITY → ${value.toUpperCase()}`); break;
      case 'info': return showProcInfo(pids[0]);
      case 'loc': if (!(await call('reveal', pids[0]))) toast('LOCATION HIDDEN (PROTECTED PROCESS)', true); return;
      case 'web': return call('procSearch', sel.label);
    }
  } catch (e) { toast(`${label}: ${e.message}`, true); }
  updateBar();
  setTimeout(tickProcsOnce, 400);
}
$('#proc-bar').addEventListener('click', (e) => { const b = e.target.closest('button[data-pa]'); if (b) procAct(b.dataset.pa); });
$('#proc-bar').addEventListener('change', (e) => { if (e.target.dataset.pa === 'prio') { procAct('prio', e.target.value); e.target.value = ''; } });
async function showProcInfo(pid) {
  try {
    const i = await coreCall('proc.info', { pid });
    $('#pi-name').textContent = `${i.name} · ${i.pid}`;
    const rows = [['description', i.description], ['company', i.company], ['path', i.path], ['command line', i.cmd], ['parent', i.parent], ['priority', i.priority],
      ['started', i.start ? new Date(i.start).toLocaleString() : null], ['threads', i.threads], ['handles', i.handles], ['state', i.suspended ? 'SUSPENDED' : 'running']];
    $('#pi-rows').innerHTML = rows.filter(([, v]) => v != null && v !== '').map(([k, v]) => `<div><span>${k}</span><b class="sel-text">${esc(v)}</b></div>`).join('');
    $('#proc-info').classList.remove('hidden');
  } catch (e) { toast(`DETAILS: ${e.message}`, true); }
}
$('#pi-close').addEventListener('click', () => $('#proc-info').classList.add('hidden'));
$('#proc-info').addEventListener('click', (e) => { if (e.target.id === 'proc-info') $('#proc-info').classList.add('hidden'); });
// right-click menu
const MENU = [['end', 'End task'], ['tree', 'End process tree'], ['restart', 'Restart'], ['-'], ['suspend', 'Suspend / resume'], ['eco', 'Efficiency mode'],
  ['prio:high', 'Priority: high'], ['prio:above', 'Priority: above normal'], ['prio:normal', 'Priority: normal'], ['prio:below', 'Priority: below normal'], ['prio:idle', 'Priority: low'],
  ['-'], ['info', 'Details'], ['loc', 'Open file location'], ['web', 'Search online']];
$('#proc-body').addEventListener('contextmenu', (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  e.preventDefault();
  selectRow(row);
  const m = $('#proc-menu');
  m.innerHTML = `<div class="cm-head">${esc(sel.label)}</div>` + MENU.map(([k, l]) => (k === '-' ? '<hr />' : `<button data-m="${k}"${k === 'end' || k === 'tree' ? ' class="danger"' : ''}>${l}</button>`)).join('');
  m.classList.remove('hidden');
  m.style.left = `${Math.min(e.clientX, innerWidth - 220)}px`;
  m.style.top = `${Math.min(e.clientY, innerHeight - m.offsetHeight - 10)}px`;
});
$('#proc-menu').addEventListener('click', (e) => {
  const b = e.target.closest('[data-m]');
  if (!b) return;
  $('#proc-menu').classList.add('hidden');
  const [a, v] = b.dataset.m.split(':');
  procAct(a, v);
});
document.addEventListener('click', (e) => { if (!e.target.closest('#proc-menu')) $('#proc-menu').classList.add('hidden'); });
// run a new task, like Win+R
$('#run-btn').addEventListener('click', () => { $('#run-box').classList.toggle('hidden'); if (!$('#run-box').classList.contains('hidden')) $('#run-cmd').focus(); });
async function runTask() {
  const cmd = $('#run-cmd').value.trim();
  if (!cmd) return;
  try { await call('runTask', cmd); toast(`LAUNCHED · ${cmd.toUpperCase()}`); $('#run-cmd').value = ''; $('#run-box').classList.add('hidden'); setTimeout(tickProcsOnce, 1200); }
  catch (e) { toast(`COULDN'T RUN: ${e.message}`, true); }
}
$('#run-go').addEventListener('click', runTask);
$('#run-cmd').addEventListener('keydown', (e) => { if (e.key === 'Enter') runTask(); if (e.key === 'Escape') $('#run-box').classList.add('hidden'); });

$('#proc-body').addEventListener('click', async (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  if (!e.target.closest('button')) { // plain click on a row: select it (click again to let go)
    if (sel && row.classList.contains('sel')) { sel = null; renderProcs(); updateBar(); } else selectRow(row);
    return;
  }
  if (e.target.classList.contains('loc')) {
    if (!(await call('reveal', Number(row.dataset.pids.split(',')[0])))) toast('LOCATION HIDDEN (PROTECTED PROCESS)', true);
    return;
  }
  if (!e.target.classList.contains('kill')) return;
  const key = row.dataset.pids;
  if (armed !== key) {
    armed = key;
    renderProcs();
    setTimeout(() => { if (armed === key) { armed = null; renderProcs(); } }, 3000);
    return;
  }
  armed = null;
  row.classList.add('dying');
  const pids = key.split(',').map(Number);
  const results = await Promise.all(pids.map((p) => call('kill', p)));
  const failed = results.filter((r) => !r.ok);
  if (failed.length) toast(`${failed.length}/${pids.length} RESISTED (${failed[0].error})`, true);
  else toast(`ENTITY RELEASED · ${row.querySelector('.c-name').firstChild.textContent}`);
  setTimeout(tickProcsOnce, 500);
});

$$('.sortable').forEach((h) => h.addEventListener('click', () => {
  const k = h.dataset.sort;
  sort = { key: k, dir: sort.key === k ? -sort.dir : (k === 'name' ? 1 : -1) };
  $$('.sortable').forEach((x) => x.classList.remove('asc', 'desc'));
  h.classList.add(sort.dir > 0 ? 'asc' : 'desc');
  renderProcs();
}));
$('.sortable[data-sort="cpu"]').classList.add('desc');
$('#proc-search').addEventListener('input', (e) => { query = e.target.value.trim().toLowerCase(); renderProcs(); });
$('#group-btn').addEventListener('click', () => {
  grouped = !grouped;
  $('#group-btn').textContent = `GROUP: ${grouped ? 'ON' : 'OFF'}`;
  renderProcs();
});

async function tickProcsOnce() {
  try {
    // the GPU columns cost the core the most: only while the task list is on screen
    const r = await call('procs', { gpu: HS.view === 'nexus' });
    procs = r.list;
    HS.data.procs = procs;
    $('#proc-count').textContent = `${r.total} beings`;
    if (HS.view === 'nexus') renderProcs();
    const top = [...procs].filter((p) => !/^(System Idle Process|Idle)$/i.test(p.name))
      .sort((a, b) => b.cpu - a.cpu).slice(0, 7).map((p) => ({ name: p.name.replace(/\.exe$/i, ''), cpu: p.cpu }));
    FX.setEntities(top);
  } catch (e) { console.error(e); }
}
async function tickProcs() { if (!document.hidden) await tickProcsOnce(); setTimeout(tickProcs, 3000); }

// ---------------- sensory shield ----------------
let hwState = null;
const busy = { mic: false, cam: false };

function renderHw() {
  if (!hwState) return;
  HS.data.hw = hwState;
  for (const kind of ['mic', 'cam']) {
    const s = hwState[kind];
    const orb = $(`#orb-${kind}`);
    orb.classList.toggle('on', s.on);
    orb.classList.toggle('off', !s.on);
    orb.classList.toggle('busy', busy[kind]);
    orb.querySelector('.orb-state').textContent = busy[kind] ? 'SHIFTING…' : s.on ? 'OPEN' : 'SEALED';
    FX.setOrb(kind, s.on);
  }
  const live = [
    ...hwState.mic.apps.filter((a) => a.active).map((a) => `🎙 ${a.name}`),
    ...hwState.cam.apps.filter((a) => a.active).map((a) => `👁 ${a.name}`),
  ];
  $('#shield-watch').innerHTML = live.length
    ? `<span class="live">● IN USE:</span> ${esc(live.join('  ·  '))}`
    : 'no app is using the mic or camera right now';

  const m = hwState.mic, c = hwState.cam;
  const setB = (id, text, bad) => { const el = $(id); el.textContent = text; el.classList.toggle('bad', !!bad); };
  setB('#s-mic-priv', m.privacyAllow ? 'ALLOWED' : 'DENIED', !m.privacyAllow);
  setB('#s-mic-mute', m.muted == null ? 'unknown' : m.muted ? 'MUTED' : 'LIVE', m.muted);
  setB('#s-mic-level', m.level == null ? '—' : `${Math.round(m.level * 100)}%`);
  setB('#s-cam-priv', c.privacyAllow ? 'ALLOWED' : 'DENIED', !c.privacyAllow);
  setB('#s-cam-dev', c.devices.length ? c.devices.map((d) => `${d.name} · ${d.status === 'OK' ? 'ENABLED' : 'DISABLED'}`).join(', ') : 'no camera found',
    c.devices.some((d) => d.status !== 'OK'));
  const appList = (apps) => apps.length
    ? apps.map((a) => `<div class="app${a.active ? ' active' : ''}" title="${esc(a.path)}"><span>${esc(a.name)}</span><span class="when">${a.active ? '● IN USE NOW' : ago(a.lastUsed)}</span></div>`).join('')
    : '<div class="app"><span>none recorded</span></div>';
  $('#s-mic-apps').innerHTML = appList(m.apps);
  $('#s-cam-apps').innerHTML = appList(c.apps);
}

async function refreshHw() {
  try { hwState = await call('hwState'); renderHw(); } catch (e) { console.error(e); }
}

async function toggle(kind, hard = false) {
  if (!hwState || busy[kind]) return;
  const next = hard ? false : !hwState[kind].on;
  busy[kind] = true; renderHw();
  try {
    hwState = kind === 'mic' ? await call('setMic', next) : await call('setCam', next, hard);
    const now = hwState[kind].on;
    const name = kind === 'mic' ? 'MICROPHONE' : 'CAMERA';
    if (now === next) toast(`${name} ${now ? 'OPENED' : hard ? 'HARD-KILLED' : 'SEALED'}`, !now);
    else toast(`${name} DID NOT CHANGE`, true);
  } catch (e) { toast(`FAILED: ${e.message}`, true); }
  busy[kind] = false; renderHw();
}

$('#orb-mic').addEventListener('click', () => toggle('mic'));
$('#orb-cam').addEventListener('click', () => toggle('cam'));
$('#s-mic-toggle').addEventListener('click', () => toggle('mic'));
$('#s-cam-toggle').addEventListener('click', () => toggle('cam'));
$('#s-cam-hard').addEventListener('click', () => toggle('cam', true));
hs.on('hotkey', (kind) => { if (!HS.solo) toggle(kind); }); // every window hears it; only the main one acts
// summoned from another app (HYPERSPACE button / icon): the window jumped on top, so play the entrance again
hs.on('summon', () => { if (!HS.solo && !HS.lite?.on && window.INTRO && window.INTRO.mode !== 'off') window.INTRO.replay(); }); // lite: straight in, no intro
HS.actions.toggleMic = () => toggle('mic');
HS.actions.toggleCam = () => toggle('cam');

// ---------------- core status / telemetry / alarm ----------------
function renderCore(s) {
  HS.core = s;
  const chip = $('#sb-core');
  const cls = s.state !== 'online' ? 'off' : s.elevated ? 'admin' : 'limited';
  chip.className = `core-chip ${cls}`;
  chip.textContent = s.state !== 'online' ? `HARDWARE: ${s.state.toUpperCase()}` : s.elevated ? 'HARDWARE: FULL CONTROL' : 'HARDWARE: LIMITED';
  chip.title = s.error || (s.elevated ? 'full hardware control' : 'running without admin: fans, tuning and RAM vacuum are locked');
}
hs.on('core', renderCore);
hs.on('toast', (m) => toast(m));
hs.on('open-view', (v) => { if (!HS.solo && $(`#view-${v}`)) showView(v); });
// Hardware controls that need Windows' admin permission ask for it right when they're used
HS.askAdmin = async (what = 'This') => {
  if (HS.core.elevated) return true;
  if (!confirm(`${what} needs Windows' admin permission.

Ask Windows now? (You'll see a "Do you want to allow…" prompt.)`)) return false;
  toast('ASKING WINDOWS FOR ADMIN…');
  try { const s = await call('coreRestart', { elevate: true }); if (s?.elevated) { toast('HARDWARE: FULL CONTROL'); return true; } } catch {}
  toast('STILL LIMITED · WINDOWS SAID NO OR THE PROMPT WAS CLOSED', true);
  return false;
};
$('#sb-core').addEventListener('click', () => { if (HS.core.state === 'online' && !HS.core.elevated) HS.askAdmin('Full hardware control'); else showView('afterburner'); });

hs.on('telemetry', (t) => {
  HS.telemetry = t;
  HS.data.tele = t;
  const parts = [];
  if (t.cpu?.temp != null) parts.push(`CPU ${t.cpu.temp}°C`);
  if (t.gpuTemp != null) parts.push(`GPU ${t.gpuTemp}°C`);
  $('#sb-temps').textContent = parts.join(' · ');
  if (t.alarm) renderAlarm(t.alarm);
});

function renderAlarm(a) {
  const on = !!a.active;
  $('#alarm').classList.toggle('hidden', !on);
  document.body.classList.toggle('alarm', on);
  FX.setAlarm(on);
  if (!on) return;
  $('#alarm-reason').textContent = a.reason || '';
  const acts = [];
  if (a.simulated) acts.push('this is how a real overheat looks · fans and power were not touched');
  else {
    if (a.maxFans) acts.push('fans forced to MAX');
    if (a.throttle) acts.push('power limits throttled');
    acts.push(`peak CPU ${a.peakCpu}°C · GPU ${a.peakGpu}°C`);
    acts.push('close games or heavy apps and keep the vents clear · this clears itself once it cools down');
  }
  $('#alarm-actions').textContent = acts.join(' · ');
  $('#alarm-dismiss').classList.toggle('hidden', !a.simulated);
}
hs.on('alarm', renderAlarm);
$('#alarm-dismiss').addEventListener('click', () => coreCall('overheat.simulate', { on: false }).then(renderAlarm).catch(() => {}));

// ---------------- RAM vacuum ----------------
let vacTimer = null;
async function showVacPlan() {
  const tip = $('#vac-tip');
  try {
    const p = await coreCall('mem.plan', { trim: HS.config.vacuum?.trim !== false });
    const skipped = p.skipped.map((s) => `${esc(s.name)} (${esc(s.why)})`).join(', ');
    tip.innerHTML = `<h4>CLICK TO VACUUM · RIGHT NOW THIS WILL:</h4><ol>${p.actions.map((a) => `<li>${esc(a)}</li>`).join('')}</ol>
      <div>Available now: <b>${fmtBytes(p.available)}</b> · free: ${fmtBytes(p.free)}</div>
      ${p.top.length ? `<div class="skip">biggest trims: ${p.top.map((t) => `${esc(t.name)} ${fmtBytes(t.mem)}`).join(' · ')}</div>` : ''}
      ${skipped ? `<div class="skip">protected: ${skipped}</div>` : ''}
      ${p.elevated ? '' : '<div class="warn">⚠ core is not running as admin: click will be refused</div>'}
      <div class="skip">right-click toggles app trimming (${p.trim ? 'ON' : 'OFF'})</div>`;
  } catch (e) {
    tip.innerHTML = `<h4>RAM VACUUM</h4><div class="warn">needs HyperCore (${esc(e.message)})</div>`;
  }
}
$('#vac-btn').addEventListener('mouseenter', (e) => {
  const tip = $('#vac-tip');
  const r = e.target.getBoundingClientRect();
  tip.style.left = `${Math.max(8, r.left - 400)}px`;
  tip.style.top = `${Math.min(window.innerHeight - 260, r.top)}px`;
  tip.classList.remove('hidden');
  tip.innerHTML = '<h4>SCANNING MEMORY…</h4>';
  showVacPlan();
  vacTimer = setInterval(showVacPlan, 2500);
});
$('#vac-btn').addEventListener('mouseleave', () => { $('#vac-tip').classList.add('hidden'); clearInterval(vacTimer); });
$('#vac-btn').addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const trim = HS.config.vacuum?.trim === false;
  HS.saveConfig({ vacuum: { ...(HS.config.vacuum || {}), trim } });
  toast(`APP TRIMMING ${trim ? 'ON' : 'OFF'}`);
  showVacPlan();
});
$('#vac-btn').addEventListener('click', () => runVacuum());
HS.actions.vacuum = () => runVacuum();
async function runVacuum() {
  const b = $('#vac-btn');
  b.classList.add('busy');
  FX.vacuum();
  try {
    const r = await coreCall('mem.run', { trim: HS.config.vacuum?.trim !== false });
    const freed = r.availableAfter - r.availableBefore;
    toast(`VACUUM COMPLETE · ${freed > 0 ? '+' + fmtBytes(freed) : 'no change'} available${r.trimmed ? ` · ${r.trimmed} apps trimmed` : ''}`);
  } catch (e) { toast(`VACUUM REFUSED: ${e.message}`, true); }
  b.classList.remove('busy');
}

// ---------------- phone link ----------------
async function renderLink(info) {
  $('#link-enabled').checked = info.enabled;
  $('#link-qr').src = info.qr || '';
  $('#link-off').classList.toggle('hidden', !!info.running);
  $('#link-off').textContent = info.paused ? `paused on "${info.network}": not a trusted network` : info.error ? `could not start: ${info.error}` : 'link is off';
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 2 ? 'just now' : m < 120 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
  $('#link-sec').innerHTML = !info.enabled ? '' : `
    <div class="ls-row ${info.encrypted ? 'ok' : 'bad'}">${info.encrypted ? '🔒 ENCRYPTED · the key, music and controls only travel over TLS' : '⚠ ENCRYPTION OFF · the secure door could not start'}</div>
    <div class="ls-row ${info.paused ? 'bad' : 'ok'}">${info.paused ? '⏸' : '✓'} WI-FI <b>${esc(info.network || '…')}</b> ${info.paused ? `isn't trusted, so the link is off here <button class="act sm" id="link-trust">TRUST THIS NETWORK</button>` : 'is trusted'}</div>
    ${info.trusted.length ? `<div class="ls-list">trusted: ${info.trusted.map((n) => `<span>${esc(n)} <button data-untrust="${esc(n)}" title="stop trusting">✕</button></span>`).join('')}</div>` : ''}
    ${info.devices.length ? `<div class="ls-list">paired: ${info.devices.map((d) => `<span>${esc(d.kind)} · ${esc(d.ip)} · ${ago(d.last)}</span>`).join('')}</div>` : ''}`;
  $('#link-trust')?.addEventListener('click', async () => renderLink(await call('remoteSet', { trust: true })));
  $$('#link-sec [data-untrust]').forEach((b) => b.addEventListener('click', async () => renderLink(await call('remoteSet', { untrust: b.dataset.untrust }))));
  $('#link-urls').innerHTML = info.urls.map((u) => `<div><b>${esc(u.name)}</b> ${esc(u.url.replace(/#k=.*/, ''))}</div>`).join('') +
    (info.secureUrl ? `<div><b>encrypted</b> ${esc(info.secureUrl.replace(/#k=.*/, ''))}</div>` : '') +
    (info.running ? `<div><b>phones connected</b> ${info.clients}</div>` : '');
}
hs.on('link-network', async () => { if (!$('#link-modal').classList.contains('hidden')) renderLink(await call('remoteInfo')); });
$('#link-btn').addEventListener('click', async () => { $('#link-modal').classList.remove('hidden'); renderLink(await call('remoteInfo')); });
$('#link-close').addEventListener('click', () => $('#link-modal').classList.add('hidden'));
$('#link-modal').addEventListener('click', (e) => { if (e.target.id === 'link-modal') $('#link-modal').classList.add('hidden'); });
$('#link-enabled').addEventListener('change', async (e) => renderLink(await call('remoteSet', { enabled: e.target.checked })));
$('#link-regen').addEventListener('click', async () => { renderLink(await call('remoteSet', { regenerate: true })); toast('NEW KEY · OLD PHONES UNPAIRED'); });

// ---------------- boot ----------------
// PURPLE ACCENTS switch (Settings → LOOK)
const applyLook = (c) => window.applyAccent(c?.look);
hs.on('config', (c) => { HS.config = c; applyLook(c); });
call('config').then((c) => {
  HS.config = c;
  applyLook(c);
  radar = c.vitalsMode === 'radar';
  applyRadar();
}).catch(() => {});
call('coreStatus').then(renderCore).catch(() => {});
async function tickHw() { if (!document.hidden && !Object.values(busy).some(Boolean)) await refreshHw(); setTimeout(tickHw, 3000); }
// the core pushes the new state the moment Windows' mic / camera settings change (an app opening the mic too)
hs.on('hw-state', (s) => { if (!Object.values(busy).some(Boolean)) { hwState = s; renderHw(); } });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { tickProcsOnce(); refreshHw(); } }); // fresh at once when it comes back
tickHw();
tickPerf();
tickProcs();
try {
  const v = new URLSearchParams(location.search).get('view') || localStorage.getItem('view');
  if (v && $(`#view-${v}`) && !$(`.nav[data-view="${v}"]`).classList.contains('sealed')) setTimeout(() => showView(v), 0);
} catch {}

// Escape closes whichever pop-up is open (phone link, get a track, shortcuts, app info, right-click menu)
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  for (const m of document.querySelectorAll('.modal:not(.hidden)')) m.classList.add('hidden');
  document.getElementById('proc-menu')?.classList.add('hidden');
});
// app version in the title bar
call('appInfo').then((i) => { if (i?.version) $('.ver').textContent = `// SYSTEM SHAMAN v${i.version}`; }).catch(() => {});

// First launch: one card that says what this is and how to get around (never on the phone or a popped-out tab)
if (!hs.remote && !HS.solo && !new URLSearchParams(location.search).has('intro')) { // (test runs pass ?intro)
  let seen = true; try { seen = !!localStorage.getItem('welcomed'); } catch {}
  if (!seen) setTimeout(() => {
    const m = document.createElement('div');
    m.className = 'modal'; m.id = 'welcome-modal';
    m.innerHTML = `<div class="panel modal-box welcome"><div class="panel-head"><span class="glyph">◈</span> WELCOME TO HYPERSPACE <button class="wbtn close right" id="wl-x" aria-label="Close" title="Close">✕</button></div>
      <div class="welcome-body">
        <p>Each icon on the left is a page. <b>Hover one</b> to see what it does.</p>
        <p>Press <b>Ctrl+F</b> any time to find a setting, a page or a song by name.</p>
        <p>Some hardware controls (fans, power limits) need Windows' permission. HYPERSPACE asks only when you use them; everything else works without it.</p>
        <p>Too much movement or heat? The <b>FX</b> and <b>LITE</b> buttons at the top calm things down. <b>Settings → LOOK</b> lets you pick an accent colour.</p>
        <div class="welcome-acts"><button class="act" id="wl-ok">GOT IT</button><button class="act" id="wl-find">OPEN FIND</button></div>
      </div></div>`;
    document.body.appendChild(m);
    const done = () => { try { localStorage.setItem('welcomed', '1'); } catch {} m.remove(); };
    m.querySelector('#wl-ok').addEventListener('click', done);
    m.querySelector('#wl-x').addEventListener('click', done);
    // Escape (which hides every pop-up) counts as GOT IT too, so the card doesn't come back next launch
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && m.isConnected) done(); });
    m.querySelector('#wl-find').addEventListener('click', () => { done(); window.FIND?.open(); });
    m.querySelector('#wl-ok').focus();
  }, 7000);
}
