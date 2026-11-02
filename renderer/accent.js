// ACCENT COLOUR (Settings → LOOK, and the swatches at the top of NOTES). The green stays; this is the second colour
// layered on top (borders, glows, highlights). Everything reads the --acc-* variables that purple.css is built on,
// so one function here recolours the whole app, the side dock and the phone page.
(() => {
  const SWATCHES = [
    ['green', 'GREEN', ''], ['cyan', 'CYAN', '#19e3ff'], ['blue', 'BLUE', '#4d8dff'], ['purple', 'PURPLE', '#b14cff'],
    ['pink', 'PINK', '#ff4fd8'], ['red', 'RED', '#ff4d6a'], ['amber', 'AMBER', '#ffb800'], ['white', 'WHITE', '#e6f2ff'],
  ];
  const parse = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const hueOf = ([r, g, b]) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0; const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return Math.round((h * 60 + 360) % 360); };
  const VARS = ['--acc', '--acc-rgb', '--acc-hot', '--acc-ghost', '--acc-glow', '--panel-edge'];
  // look = config.look: { purple: true/false (accent on), accent: '#rrggbb' }
  window.applyAccent = (look) => {
    const b = document.body, rgb = look?.purple ? parse(look.accent || '#b14cff') : null;
    b.classList.toggle('purple', !!look?.purple);
    if (!rgb) { VARS.forEach((v) => b.style.removeProperty(v)); delete b.dataset.accHue; return; }
    const c = rgb.join(', '), hot = rgb.map((x) => Math.round(x + (255 - x) * 0.55)).join(', ');
    b.style.setProperty('--acc', `rgb(${c})`);
    b.style.setProperty('--acc-rgb', c);
    b.style.setProperty('--acc-hot', `rgb(${hot})`);
    b.style.setProperty('--acc-ghost', `rgba(${c}, 0.1)`);
    b.style.setProperty('--acc-glow', `0 0 6px rgba(${c}, 0.8), 0 0 18px rgba(${c}, 0.35)`);
    b.style.setProperty('--panel-edge', `rgba(${c}, 0.34)`);
    b.dataset.accHue = String(hueOf(rgb));
  };
  window.ACCENT_SWATCHES = SWATCHES;
  // which swatch is on: 'green' when the accent is off, else the named colour, else 'custom'
  window.accentName = (look) => { if (!look?.purple) return 'green'; const a = String(look.accent || '#b14cff').toLowerCase(); return (SWATCHES.find((s) => s[2] === a) || ['custom'])[0]; };
  // the one place that changes it: saves it, applies it, and tells the other windows through the config event
  window.setAccent = (name, custom) => {
    const sw = SWATCHES.find((s) => s[0] === name);
    const look = { ...(HS.config?.look || {}), purple: name !== 'green', accent: name === 'custom' ? custom : sw?.[2] || '#b14cff' };
    HS.saveConfig({ look });
    window.applyAccent(look);
    return look;
  };
  // a row of colour dots plus a "pick any colour" box; every row on the page (SETTINGS, NOTES) stays in step
  window.drawAccentRow = (el) => {
    if (!el) return;
    const cur = window.accentName(HS.config?.look), custom = HS.config?.look?.accent || '#b14cff';
    el.innerHTML = SWATCHES.map(([k, label, hex]) => `<button class="acc-dot ${cur === k ? 'on' : ''}" data-acc="${k}" title="${label}" style="--c:${hex || '#00ff6e'}"></button>`).join('')
      + `<label class="acc-dot custom ${cur === 'custom' ? 'on' : ''}" title="Pick any colour" style="--c:${custom}"><input type="color" value="${custom}"></label>`;
    const redraw = () => document.querySelectorAll('.acc-row').forEach(window.drawAccentRow);
    el.querySelectorAll('[data-acc]').forEach((b) => b.addEventListener('click', () => { window.setAccent(b.dataset.acc); redraw(); }));
    el.querySelector('input[type=color]').addEventListener('change', (e) => { window.setAccent('custom', e.target.value); redraw(); });
  };
})();
