// HARDWARE → PORTS & POWER: the battery's live electrics (volts, amps, watts, charge, wear), where the power goes
// (CPU / graphics / USB), a live graph, and a map of every USB path (laptop → socket → hub → device) with each
// device's ID card, speed, power ask and live drive / network traffic. Click a device for everything about it.
// Sockets can be renamed ("LEFT FRONT") by clicking their name.
(() => {
  const root = $('#view-hardware');
  if (!root) return;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const W = (ma) => (ma * 5 / 1000).toFixed(ma >= 1000 ? 1 : 2);
  const rate = (b) => (b == null ? '…' : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB/s` : b >= 1e3 ? `${(b / 1e3).toFixed(0)} KB/s` : `${Math.round(b)} B/s`);
  const gb = (b) => (b == null ? '?' : `${(b / 1e9).toFixed(b >= 1e11 ? 0 : 1)} GB`);
  const mins = (m) => (m == null ? '—' : m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`);
  const num = (v, d = 1) => (v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(d));
  let data = null, names = {}, timer = null, busy = false, tele = null, pick = null;
  // live graph: battery watts (+ in / − out), CPU and graphics watts, one point every few seconds, 5 minutes kept
  const hist = [];
  const HIST = 75;

  root.innerHTML = `
    <div class="hw-wrap">
      <div class="hw-head">
        <div><div class="kicker">HARDWARE</div><h2 class="glitch" data-text="PORTS & POWER">PORTS &amp; POWER</h2></div>
        <div class="hw-status" id="hw-status"></div>
        <button class="chip" id="hw-refresh" title="Read everything again">⟳ REFRESH</button>
      </div>
      <div class="hw-cards" id="hw-cards"></div>
      <div class="hw-row">
        <div class="hw-panel hw-graph-p"><div class="hw-ph">LIVE POWER · LAST 5 MIN <span class="hw-keys"><i class="k-bat"></i>BATTERY <i class="k-cpu"></i>CPU <i class="k-gpu"></i>GRAPHICS</span></div><canvas id="hw-graph" height="150"></canvas></div>
        <div class="hw-panel hw-where"><div class="hw-ph">WHERE THE POWER GOES</div><div id="hw-where"></div></div>
      </div>
      <div class="hw-legend">
        <span><i class="ln s10"></i>10 Gbps+</span><span><i class="ln s5"></i>5 Gbps (USB 3)</span><span><i class="ln s480"></i>480 Mbps (USB 2)</span><span><i class="ln s12"></i>12 Mbps or slower</span>
        <span class="dim">Click a device for its full details · click a socket's name to rename it.</span>
      </div>
      <div class="hw-maprow">
        <div class="hw-map" id="hw-map"><div class="dim">reading the ports… (the first read takes a few seconds)</div></div>
        <aside class="hw-detail hidden" id="hw-detail"></aside>
      </div>
      <details class="hw-builtin"><summary>BUILT INTO THE LAPTOP</summary><div id="hw-builtin"></div></details>
      <p class="hw-note dim">Battery, CPU and graphics numbers are real measurements. Laptops have no sensors on their USB ports, so USB power is what each device
        <b>asks for</b> at 5 V. For real volts and amps on a port, a USB-C power meter has to sit in between.</p>
    </div>`;

  // a generic Windows name ("USB Composite Device") hides what the thing is: the device's own name, or its parts, say it better
  const title = (d) => {
    if (d.product && !/^usb\d|hub$/i.test(d.product) && /composite|^generic|^usb (input|device)/i.test(d.name)) return d.product;
    const f = (d.functions || []).filter((x) => !/^(HID|USB|Microsoft|Generic|Intel Tile)/i.test(x) && !/enumerator|ethernet|usb device|composite/i.test(x))
      .sort((a, b) => a.length - b.length)[0];
    return /composite|^generic|^usb (input|device)/i.test(d.name) && f ? f : d.name;
  };
  const cls = (d) => (!d ? 'none' : /10 Gbps/.test(d.speed) ? 's10' : /5 Gbps/.test(d.speed) ? 's5' : /480/.test(d.speed) ? 's480' : 's12');
  const devKey = (d) => d.id || `${d.vid}:${d.pid}:${d.address}`;

  // ---------------- battery cards ----------------
  function cards() {
    const p = data?.power || {};
    if (!p.battery) { $('#hw-cards').innerHTML = '<div class="hw-card"><b>—</b><span>NO BATTERY FOUND</span></div>'; return; }
    const flow = p.charging ? 'in' : p.dischargeW ? 'out' : '';
    const watts = p.charging ? p.chargeW : p.dischargeW;
    const bar = (pct, c = '') => `<div class="hw-bar"><i class="${c}" style="width:${Math.max(0, Math.min(100, pct || 0))}%"></i></div>`;
    $('#hw-status').innerHTML = `<span class="hw-pill ${p.plugged ? 'on' : 'off'}">${p.plugged ? '⚡ CHARGER IN' : '▭ ON BATTERY'}</span>${p.critical ? '<span class="hw-pill bad">CRITICAL</span>' : ''}`;
    $('#hw-cards').innerHTML = `
      <div class="hw-card"><span>VOLTAGE</span><b>${num(p.volts, 2)}<small> V</small></b><em>battery pack</em></div>
      <div class="hw-card ${flow}"><span>CURRENT</span><b>${p.amps > 0 ? '+' : ''}${num(p.amps, 2)}<small> A</small></b><em>${p.charging ? 'into the battery' : p.dischargeW ? 'out of the battery' : 'resting'}</em></div>
      <div class="hw-card ${flow}"><span>POWER</span><b>${flow === 'in' ? '+' : flow === 'out' ? '−' : ''}${num(watts, 1)}<small> W</small></b><em>${p.charging ? 'charging' : p.dischargeW ? 'the laptop is using' : p.plugged ? 'full, running on the charger' : '—'}</em></div>
      <div class="hw-card"><span>CHARGE</span><b>${num(p.percent, 0)}<small> %</small></b>${bar(p.percent)}<em>${num(p.remainWh, 1)} of ${num(p.fullWh, 1)} Wh</em></div>
      <div class="hw-card"><span>${p.charging ? 'FULL IN' : 'TIME LEFT'}</span><b class="sm">${p.charging ? mins(p.minutesToFull) : mins(p.minutesLeft)}</b><em>${p.charging ? 'at this charging rate' : p.plugged ? 'on the charger' : "Windows' estimate"}</em></div>
      <div class="hw-card" title="How much the battery holds now compared to when it was new"><span>HEALTH</span><b>${num(p.health, 0)}<small> %</small></b>${bar(p.health, p.health < 60 ? 'hot' : p.health < 80 ? 'warm' : '')}<em>${num(p.fullWh, 1)} of ${num(p.designWh, 1)} Wh when new</em></div>
      <div class="hw-card"><span>BATTERY</span><b class="sm">${esc(p.model || '—')}</b><em>${esc([String(p.maker || '').trim(), p.chemistry && /^li/i.test(p.chemistry) ? 'lithium-ion' : p.chemistry, p.cycles ? `${p.cycles} cycles` : null].filter(Boolean).join(' · ') || '—')}</em></div>`;
  }

  // ---------------- where the power goes ----------------
  function where() {
    const p = data?.power || {}, c = tele?.cpu || {}, g = tele?.gpu || {};
    const usbW = (data?.totalMa || 0) * 5 / 1000;
    const rows = [
      ['CPU', c.power, c.voltage != null ? `${c.voltage.toFixed(3)} V core` : 'core voltage needs the PawnIO driver', 'k-cpu'],
      ['GRAPHICS', g.power, [g.voltage != null ? `${(g.voltage > 10 ? g.voltage / 1000 : g.voltage).toFixed(3)} V core` : null, g.powerLimit ? `limit ${Math.round(g.powerLimit)} W` : null].filter(Boolean).join(' · ') || 'NVIDIA card asleep or not found', 'k-gpu'],
      ['USB DEVICES', usbW, `${data?.totalMa || 0} mA asked at 5 V`, 'k-usb'],
    ];
    // on battery the pack's output is the whole laptop: what isn't CPU / graphics / USB is screen, memory, Wi-Fi, fans…
    if (p.battery && !p.plugged && p.dischargeW) rows.push(['EVERYTHING ELSE', Math.max(0, p.dischargeW - (c.power || 0) - (g.power || 0) - usbW), 'screen, memory, storage, Wi-Fi, fans', 'k-rest']);
    if (p.battery && p.charging) rows.push(['INTO THE BATTERY', p.chargeW, `${num(p.amps, 2)} A at ${num(p.volts, 2)} V`, 'k-bat']);
    const max = Math.max(10, ...rows.map((r) => r[1] || 0));
    $('#hw-where').innerHTML = rows.map(([n, w, sub, k]) => `
      <div class="hw-w"><div class="hw-wh"><span>${n}</span><b>${w == null ? '—' : `${w.toFixed(1)} W`}</b></div>
        <div class="hw-bar"><i class="${k}" style="width:${w == null ? 0 : Math.min(100, (w / max) * 100)}%"></i></div><em>${esc(sub)}</em></div>`).join('') +
      (p.battery && !p.plugged && p.dischargeW ? `<div class="hw-total">WHOLE LAPTOP <b>${p.dischargeW.toFixed(1)} W</b></div>` : p.plugged ? '<div class="hw-total dim">On the charger, the laptop\'s total draw isn\'t measured; unplug to see the whole-laptop number.</div>' : '');
  }

  // ---------------- graph ----------------
  function graph() {
    const cv = $('#hw-graph');
    if (!cv || !cv.offsetWidth) return;
    const dpr = window.devicePixelRatio || 1, w = cv.offsetWidth, h = 150;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const x = cv.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, w, h);
    const vals = hist.flatMap((s) => [s.bat, s.cpu, s.gpu]).filter((v) => v != null);
    const top = Math.max(20, ...vals.map(Math.abs)) * 1.15;
    const zero = hist.some((s) => s.bat < 0) ? h / 2 : h - 14;
    const y = (v) => zero - (v / top) * (zero - 6);
    x.strokeStyle = 'rgba(0,255,110,.12)'; x.lineWidth = 1;
    for (const v of [top / 2, top / 4 * 3]) { x.beginPath(); x.moveTo(0, y(v)); x.lineTo(w, y(v)); x.stroke(); }
    x.strokeStyle = 'rgba(0,255,110,.35)'; x.beginPath(); x.moveTo(0, zero); x.lineTo(w, zero); x.stroke();
    x.fillStyle = 'rgba(42,157,90,.9)'; x.font = '10px monospace';
    x.fillText(`${Math.round(top / 1.15)} W`, 4, 12);
    const line = (k, col) => {
      x.strokeStyle = col; x.lineWidth = 1.6; x.shadowColor = col; x.shadowBlur = 6; x.beginPath();
      let on = false;
      hist.forEach((s, i) => { if (s[k] == null) { on = false; return; } const px = w - (hist.length - 1 - i) * (w / (HIST - 1)); if (on) x.lineTo(px, y(s[k])); else { x.moveTo(px, y(s[k])); on = true; } });
      x.stroke(); x.shadowBlur = 0;
    };
    const css = getComputedStyle(document.body);
    line('gpu', css.getPropertyValue('--amber').trim() || '#ffc400');
    line('cpu', '#c77dff');
    line('bat', css.getPropertyValue('--g').trim() || '#00ff6e');
  }

  // ---------------- the USB map ----------------
  function live(d) {
    const out = [];
    for (const x of d.drives || []) out.push(`<em class="lv">${esc(x.letter)} ↓${rate(x.readBps)} ↑${rate(x.writeBps)}</em>`);
    for (const x of d.nets || []) if (x.up) out.push(`<em class="lv">${esc(x.name)} ↓${rate(x.rxBps)} ↑${rate(x.txBps)}</em>`);
    return out.join('');
  }
  function device(d) {
    if (!d) return '';
    const parts = (d.functions || []).filter((x) => x !== title(d)).slice(0, 3);
    const hub = d.hub ? `
      <div class="hw-hub">
        <div class="hw-hubbar" title="Power the devices on this hub ask for${d.hub.busPowered === false ? ' (the hub says it has its own power supply)' : ' (all of it comes from the laptop)'}">
          <span>${d.hub.busPowered === false ? '⚡ OWN POWER' : '↯ POWERED BY LAPTOP'}</span><b>${d.hub.usedMa} mA · ${(d.hub.usedMa / 1000).toFixed(2)} A · ${W(d.hub.usedMa)} W asked</b>
        </div>
        <ul class="hw-tree">${d.hub.ports.map((p) => `<li class="${cls(p.device)}"><span class="hw-pn">PORT ${p.port}</span>${p.device ? device(p.device) : '<span class="hw-empty">empty</span>'}</li>`).join('')}</ul>
      </div>` : '';
    return `<div class="hw-dev${d.isHub ? ' is-hub' : ''}${pick === devKey(d) ? ' picked' : ''}" data-dev="${esc(devKey(d))}">
        <div class="hw-dn">${d.isHub ? '⑂ ' : ''}${esc(title(d))}${d.maker ? `<span class="hw-mk">${esc(d.maker)}</span>` : ''}</div>
        <div class="hw-meta"><em class="sp">${esc(d.gen || '')} · ${esc(d.speed || '')}</em>${d.maxMa >= 0 ? `<em>${(d.maxMa / 1000).toFixed(2)} A · ${W(d.maxMa)} W asked</em>` : ''}${d.selfPowered ? '<em title="The device says it has its own power (battery or adapter)">own power</em>' : ''}${live(d)}</div>
        ${parts.length ? `<div class="hw-parts dim">${parts.map(esc).join(' · ')}</div>` : ''}
        ${hub}
      </div>`;
  }
  function allDevices() {
    const out = [];
    const walk = (d, where) => { if (!d) return; out.push([d, where]); for (const p of d.hub?.ports || []) walk(p.device, `${where} → hub port ${p.port}`); };
    for (const s of data?.sockets || []) walk(s.device, names[s.id] || s.label);
    for (const d of data?.builtin || []) walk(d, 'inside the laptop');
    return out;
  }
  function detail() {
    const box = $('#hw-detail');
    const hit = pick && allDevices().find(([d]) => devKey(d) === pick);
    if (!hit) { box.classList.add('hidden'); return; }
    const [d, path] = hit;
    const row = (k, v) => (v == null || v === '' ? '' : `<div class="hw-kv"><span>${k}</span><b>${esc(v)}</b></div>`);
    box.classList.remove('hidden');
    box.innerHTML = `
      <div class="hw-dh"><b>${esc(title(d))}</b><button class="chip mini" id="hw-dclose" title="Close">✕</button></div>
      <div class="hw-path">${esc(path)}</div>
      ${row('MAKER', d.maker)}${row('PRODUCT', d.product)}${row('WINDOWS CALLS IT', d.name)}
      ${row('VENDOR : PRODUCT ID', `${d.vid} : ${d.pid}`)}${row('DEVICE VERSION', d.version)}${row('USB VERSION', `USB ${d.usb}`)}
      ${row('LINK', `${d.gen} · ${d.speed}`)}${row('TYPE', d.cls)}
      ${row('POWER ASKED', d.maxMa >= 0 ? `${d.maxMa} mA · ${(d.maxMa / 1000).toFixed(3)} A · ${W(d.maxMa)} W at 5 V` : null)}
      ${row('POWERED BY', d.selfPowered ? 'its own battery / adapter' : 'the laptop (bus powered)')}
      ${row('BUS ADDRESS', d.address)}${row('OPEN DATA PIPES', d.pipes)}${row('DRIVER', d.driver)}
      ${(d.drives || []).map((x) => row(`DRIVE ${x.letter}`, `${x.label || 'no label'} · ${x.fs || ''} · ${gb(x.free)} free of ${gb(x.size)} · read ${rate(x.readBps)} · write ${rate(x.writeBps)}`)).join('')}
      ${(d.nets || []).map((x) => row(`NETWORK ${x.name}`, `${x.up ? 'connected' : 'not connected'}${x.mbps ? ` · ${x.mbps} Mbps link` : ''} · down ${rate(x.rxBps)} · up ${rate(x.txBps)} · ${gb(x.rx)} in / ${gb(x.tx)} out so far`)).join('')}
      ${d.functions?.length ? `<div class="hw-kv col"><span>INSIDE IT</span><b>${d.functions.map(esc).join('<br>')}</b></div>` : ''}
      ${row('INSTANCE ID', d.id)}`;
  }

  function render() {
    if (!data) return;
    cards(); where();
    const sc = $('#hw-map').scrollLeft;
    $('#hw-map').innerHTML = `
      <div class="hw-laptop"><div class="hw-chip">◈</div><div>LAPTOP</div><em>${(data.totalMa / 1000).toFixed(2)} A · ${W(data.totalMa)} W to USB</em></div>
      <ul class="hw-tree hw-sockets">${data.sockets.map((s) => {
        const pct = Math.min(100, Math.round((s.usedMa / s.supplyMa) * 100));
        return `<li class="${cls(s.device)}">
          <div class="hw-sock">
            <button class="hw-sname" data-id="${esc(s.id)}" title="Rename this socket">${esc(names[s.id] || s.label)}</button>
            <span class="hw-kind">${esc(s.kind)}</span>
            <div class="hw-budget" title="${s.usedMa} mA asked of about ${s.supplyMa} mA this kind of socket supplies"><i style="width:${pct}%" class="${pct > 90 ? 'hot' : pct > 70 ? 'warm' : ''}"></i></div>
            <span class="hw-bt">${(s.usedMa / 1000).toFixed(2)} / ${(s.supplyMa / 1000).toFixed(1)} A</span>
          </div>
          ${s.device ? device(s.device) : '<span class="hw-empty">empty</span>'}
        </li>`;
      }).join('')}</ul>`;
    $('#hw-map').scrollLeft = sc;
    $('#hw-builtin').innerHTML = `<ul class="hw-tree">${data.builtin.map((d) => `<li class="${cls(d)}">${device(d)}</li>`).join('')}</ul>`;
    detail();
  }

  async function load() {
    if (busy) return;
    busy = true;
    try {
      const [t, n] = await Promise.all([hs.call('usbTree'), hs.call('portNames')]);
      data = t; names = n || {};
      const p = t.power || {};
      hist.push({ bat: p.battery ? (p.charging ? p.chargeW : -(p.dischargeW || 0)) : null, cpu: tele?.cpu?.power ?? null, gpu: tele?.gpu?.power ?? null });
      if (hist.length > HIST) hist.shift();
      render(); graph();
    } catch (e) { $('#hw-map').innerHTML = `<div class="hw-err">Couldn't read the ports: ${esc(String(e.message || e).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''))}</div>`; }
    busy = false;
  }

  hs.on('telemetry', (t) => { tele = t; if (HS.view === 'hardware' && data) where(); });

  root.addEventListener('click', async (e) => {
    if (e.target.id === 'hw-refresh') return load();
    if (e.target.id === 'hw-dclose') { pick = null; return render(); }
    const b = e.target.closest('.hw-sname');
    if (b) {
      const now = names[b.dataset.id] || b.textContent;
      const inp = document.createElement('input');
      inp.className = 'hw-rename'; inp.value = now; inp.maxLength = 24;
      b.replaceWith(inp); inp.focus(); inp.select();
      let done = false;
      const finish = async (save) => {
        if (done) return; done = true;
        if (save) names = await hs.call('portNames', { id: b.dataset.id, name: inp.value.trim() });
        render();
      };
      inp.addEventListener('keydown', (k) => { if (k.key === 'Enter') finish(true); if (k.key === 'Escape') finish(false); });
      inp.addEventListener('blur', () => finish(true));
      return;
    }
    const dv = e.target.closest('.hw-dev');
    if (dv) { pick = pick === dv.dataset.dev ? null : dv.dataset.dev; render(); }
  });
  window.addEventListener('resize', () => { if (HS.view === 'hardware') graph(); });

  // live while the page is open: plugging something in shows up within a few seconds
  HS.viewListeners.push((v) => {
    clearInterval(timer);
    if (v !== 'hardware') return;
    load();
    timer = setInterval(load, 4000);
  });
})();
