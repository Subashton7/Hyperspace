// SETTINGS > THE WHITE RABBIT: master switch, live stage, level, wardrobe shop, personality, frequency.
// Everything goes through window.twr (rabbit.js); if the rabbit isn't loaded yet we show "asleep" and retry.
// The tab is an easter egg: it stays hidden until the rabbit has been found (cfg.found, set by rabbit.js; see 'twr-found').
(() => {
  const tabs = document.getElementById('set-tabs');
  if (!tabs || !document.getElementById('view-settings')) return;
  // add our own tab button + page so index.html stays untouched
  const btn = document.createElement('button');
  btn.dataset.st = 'rabbit'; btn.textContent = '\u{1F407} THE WHITE RABBIT';
  const aboutBtn = tabs.querySelector('[data-st="about"]');
  tabs.insertBefore(btn, aboutBtn || null);
  btn.style.display = 'none'; // hidden until found
  const page = document.createElement('div');
  page.className = 'set-page hidden'; page.dataset.page = 'rabbit'; page.id = 'set-rabbit';
  const aboutPage = document.getElementById('set-about');
  if (aboutPage) aboutPage.parentNode.insertBefore(page, aboutPage); else tabs.parentNode.appendChild(page);

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const CATS = [['skins', 'skin', 'SKINS'], ['hats', 'hat', 'HATS'], ['glasses', 'glasses', 'GLASSES'], ['colors', 'color', 'COLOURS'], ['vehicles', 'vehicle', 'VEHICLES']];
  const POSES = ['stand', 'wave', 'sit', 'sleep', 'dance'];
  const ready = () => window.twr && window.TWR_CATALOG && typeof twr.cfg === 'function';
  const rarity = (c) => (c <= 0 ? 'common' : c <= 50 ? 'uncommon' : c <= 150 ? 'rare' : c <= 400 ? 'epic' : 'legend');
  const RLAB = { common: 'COMMON', uncommon: 'UNCOMMON', rare: 'RARE', epic: 'EPIC', legend: 'LEGENDARY' };
  let pose = 'stand', msg = '', msgBad = false, tmr = 0, pending = false;

  // show the tab only once the rabbit has been found (a fresh install never shows it)
  function syncTab() {
    const found = ready() && !!(twr.cfg() || {}).found;
    btn.style.display = found ? '' : 'none';
    if (!found && btn.classList.contains('on')) { const o = tabs.querySelector('[data-st]:not([data-st="rabbit"])'); if (o) o.click(); }
    return found;
  }
  const owned = (it) => !it.cost || (twr.owns ? twr.owns(it.id) : false);
  const safeDraw = (el, over, p) => { if (!el) return; try { twr.draw(el, over, p); } catch { el.textContent = '\u{1F407}'; } };

  const fmtD = (t) => { try { return new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
  function foundList() {
    let m = {}; try { m = twr.mem() || {}; } catch {}
    const g = Array.isArray(m.gifts) ? m.gifts : [];
    if (!g.length) return '<p class="dim tiny">Nothing yet. Every 45 to 90 minutes of real use he might find something and mail it from his burrow.</p>';
    return `<ul class="twrs-found">${g.slice(0, 20).map((x) => `<li${x.kind === 'golden' ? ' class="gold"' : ''}><b>${x.kind === 'golden' ? '\u{1F955}' : x.kind === 'item' ? '\u{1F381}' : x.kind === 'xp' ? '★' : '◈'}</b> ${esc(x.text)} <em>${esc(fmtD(x.t))}</em></li>`).join('')}</ul>`;
  }
  function memLine() {
    let m = {}; try { m = twr.mem() || {}; } catch {}
    const s = m.summary || {};
    return s.first ? `He remembers counts only (never content): first seen ${esc(s.first)}, ${s.days || 0} days opened, streak ${s.streak || 0}${s.user ? `, calls you ${esc(s.user)}` : ''}. Type <b>recap</b> in his terminal for your week.` : 'He remembers counts only (never content). Nothing yet.';
  }
  function render() {
    if (!ready()) {
      page.innerHTML = '<div class="panel twrs-asleep"><div class="set-body"><div class="twrs-zzz">z z Z</div><p class="dim">The rabbit is asleep. It will wake up in a moment…</p></div></div>';
      if (!tmr) tmr = setInterval(() => { if (ready()) { clearInterval(tmr); tmr = 0; render(); } }, 700);
      return;
    }
    const cfg = twr.cfg() || {}, C = window.TWR_CATALOG;
    syncTab();
    const lv = (twr.level && twr.level()) || { lvl: 1, xp: 0, next: 100, title: 'RABBIT' };
    const pct = Math.max(0, Math.min(100, lv.next ? Math.round((lv.xp / lv.next) * 100) : 100));
    const st = cfg.stats || {};
    const stat = (k, l, i) => `<div class="twrs-stat"><b>${st[k] || 0}</b><span>${i} ${l}</span></div>`;
    const antics = twr.antics || [];
    const card = (key, it) => {
      const own = owned(it), eq = cfg[key] === it.id, r = rarity(it.cost || 0);
      return `<div class="twrs-card r-${r}${eq ? ' eq' : ''}${own ? '' : ' locked'}" data-cat="${key}" data-id="${esc(it.id)}" title="${esc(it.desc || '')}">
        <div class="twrs-mini" data-prev></div>${it.hex ? `<i class="twrs-sw" style="background:${esc(it.hex)}"></i>` : ''}
        <div class="twrs-nm">${esc(it.name)}</div>
        <div class="twrs-pr">${eq ? '<em>EQUIPPED</em>' : own ? '<em class="own">OWNED · EQUIP</em>' : `<em class="buy">\u{1F512} ${it.cost} ◈ · BUY</em>`}</div>
        <div class="twrs-rar">${RLAB[r]}</div></div>`;
    };
    const wardrobe = CATS.map(([cat, key, label]) => ((C[cat] || []).length ? `<div class="panel set-card twrs-wide"><div class="panel-head"><span class="glyph">◈</span> ${label}</div>
      <div class="set-body"><div class="twrs-grid">${C[cat].map((it) => card(key, it)).join('')}</div></div></div>` : '')).join('');
    const pers = (C.personalities || []).map((p) => `<div class="twrs-card twrs-pers${cfg.personality === p.id ? ' eq' : ''}" data-pers="${esc(p.id)}"><div class="twrs-nm">${esc(p.name)}</div><div class="twrs-desc">${esc(p.desc || '')}</div></div>`).join('');
    const fxp = window.hsClickFx ? hsClickFx.get() : { level: 'off', geo: false, house: true };
    const freq = (C.freq || []).map((f) => `<button data-freq="${esc(f.id)}" class="${cfg.freq === f.id ? 'on' : ''}">${esc(f.name)}</button>`).join('');
    page.innerHTML = `
      <div class="twrs-master ${cfg.on ? 'on' : ''}" id="twrs-master"><span>RABBIT: <b>${cfg.on ? 'ON' : 'OFF'}</b></span><small>${cfg.on ? 'The White Rabbit roams HYPERSPACE. Click to put it to sleep (this tab stays).' : 'Dormant: no burrow, no pop-ups. Click to wake it.'}</small></div>
      <div class="set-grid twrs-top">
        <div class="panel set-card"><div class="panel-head"><span class="glyph">\u{1F407}</span> STAGE <span class="hint">live preview</span></div><div class="set-body">
          <div class="twrs-stage" id="twrs-stage"></div>
          <div class="seg small" id="twrs-poses">${POSES.map((p) => `<button data-pose="${p}" class="${p === pose ? 'on' : ''}">${p.toUpperCase()}</button>`).join('')}</div>
          ${antics.length ? `<label class="set-l">TEST ANIMATION <em>runs on the live rabbit</em></label><div class="seg small" id="twrs-antics">${antics.map((a) => `<button data-antic="${esc(a)}">▶ ${esc(String(a).toUpperCase())}</button>`).join('')}</div>` : ''}
        </div></div>
        <div class="panel set-card"><div class="panel-head"><span class="glyph">★</span> YOUR RABBIT</div><div class="set-body">
          <label class="set-l">NAME</label><input class="twrs-name" id="twrs-name" maxlength="16" spellcheck="false" value="${esc(cfg.name || '')}" placeholder="name your rabbit" />
          <label class="set-l">LEVEL <b>${lv.lvl}</b> · ${esc(lv.title || '')} <em>${lv.xp} / ${lv.next || '—'} XP</em></label>
          <div class="twrs-xp"><div style="width:${pct}%"></div></div>
          <div class="twrs-coins">◈ <b>${cfg.coins || 0}</b> coins</div>
          <div class="twrs-stats">${stat('pets', 'PETS', '♥')}${stat('saves', 'SAVES', '⛨')}${stat('tows', 'TOWS', '⚓')}${stat('hacks', 'HACKS', '⌨')}${stat('pops', 'POPS', '✸')}</div>
          <label class="set-l">BURROW <em>the little house in the screen corner</em></label><div class="seg small" id="twrs-home"><button data-home="false" class="${cfg.home ? '' : 'on'}">OFF</button><button data-home="true" class="${cfg.home ? 'on' : ''}">ON</button></div>
          <p class="dim tiny">Also: the power button on the burrow's corner, or right-click it. With the burrow hidden a tiny tab stays in the corner, and <b>Ctrl+Space</b> still opens the assistant (ask it anything: commands, tabs, settings, songs, notes, to-dos).</p>
          <label class="set-l">APPEARS <em>how often it pops up</em></label><div class="seg small" id="twrs-freq">${freq}</div>
          <label class="set-l">CLICK EFFECTS <em>little animations when you click</em></label><div class="seg small" id="twrs-fx">${['off', 'low', 'normal', 'max'].map((l) => `<button data-fx="${l}" class="${fxp.level === l ? 'on' : ''}">${l.toUpperCase()}</button>`).join('')}</div>
          <label class="set-l">SACRED GEOMETRY ONLY <em>clicks draw only sacred geometry</em></label><div class="seg small" id="twrs-fxg"><button data-g="false" class="${fxp.geo ? '' : 'on'}">OFF</button><button data-g="true" class="${fxp.geo ? 'on' : ''}">ON</button></div>
          <label class="set-l">SPARKS FROM THE RABBIT'S HOUSE</label><div class="seg small" id="twrs-fxh"><button data-h="false" class="${fxp.house ? '' : 'on'}">OFF</button><button data-h="true" class="${fxp.house ? 'on' : ''}">ON</button></div>
          <p class="dim tiny twrs-msg ${msgBad ? 'bad' : ''}" id="twrs-msg">${esc(msg)}</p>
        </div></div>
      </div>
      <div class="panel set-card twrs-wide"><div class="panel-head"><span class="glyph">i</span> TIPS &amp; TUTORIAL <span class="hint">short how-to cards</span></div><div class="set-body">
        <p class="dim tiny">New installs get a few tips in the first two days, then they stop. The tutorial walks through every tab, one tip at a time. Press <b>NEXT</b> to move on or <b>SKIP</b> to stop.</p>
        <div><button class="btn" id="twrs-tutorial">TUTORIAL</button> <button class="btn" id="twrs-mock" title="Makes the rabbit mock a pretend spelling mistake">TEST MOCKING</button></div>
      </div></div>
      <div class="panel set-card twrs-wide"><div class="panel-head"><span class="glyph">☺</span> PERSONALITY</div><div class="set-body"><div class="twrs-grid twrs-pgrid">${pers}</div></div></div>
      ${wardrobe}
      <div class="panel set-card twrs-wide"><div class="panel-head"><span class="glyph">\u{1F381}</span> FOUND ITEMS <span class="hint">gifts he finds while you work</span></div><div class="set-body">${foundList()}</div></div>
      <div class="panel set-card twrs-wide"><div class="panel-head"><span class="glyph">?</span> SECRETS &amp; RESET</div><div class="set-body">
        <p class="dim tiny">There are hidden things. Try <b>Ctrl+6 then 7</b> for the hacker terminal, and type <b>casino</b> somewhere when nobody is looking.</p>
        <p class="dim tiny">${memLine()}</p>
        <div><button class="btn twrs-reset" id="twrs-reset">RESET RABBIT</button> <button class="btn" id="twrs-memreset" title="Forget the habit counts (no content is ever stored)">FORGET MY HABITS</button></div>
      </div></div>`;
    safeDraw(page.querySelector('#twrs-stage'), cfg, pose);
    page.querySelectorAll('.twrs-card[data-cat]').forEach((c) => safeDraw(c.querySelector('[data-prev]'), { ...cfg, [c.dataset.cat]: c.dataset.id }, 'stand'));
  }

  function say(t, bad) { msg = t; msgBad = !!bad; const m = page.querySelector('#twrs-msg'); if (m) { m.textContent = t; m.classList.toggle('bad', !!bad); } }

  page.addEventListener('click', (e) => {
    if (!ready()) return;
    const t = e.target;
    if (t.closest('#twrs-master')) return twr.setCfg({ on: !twr.cfg().on });
    if (t.closest('#twrs-tutorial')) { try { (window.hsTips || twr).tutorial(); } catch { say('Tutorial not available right now.', true); } return; }
    if (t.closest('#twrs-mock')) { try { if (!twr.mock('teh', 'the', true)) say('The rabbit is asleep. Turn it on first.', true); } catch { say('The rabbit is not on stage right now.', true); } return; }
    const ps = t.closest('[data-pose]'); if (ps) { pose = ps.dataset.pose; return render(); }
    const an = t.closest('[data-antic]'); if (an) { try { twr.stage.demo(an.dataset.antic); } catch { say('The rabbit is not on stage right now.', true); } return; }
    const hm = t.closest('#twrs-home button'); if (hm) return twr.setCfg({ home: hm.dataset.home === 'true' });
    const fq = t.closest('[data-freq]'); if (fq) return twr.setCfg({ freq: fq.dataset.freq });
    const fb = t.closest('#twrs-fx button'); if (fb && window.hsClickFx) { hsClickFx.set({ level: fb.dataset.fx }); return render(); }
    const gb = t.closest('#twrs-fxg button'); if (gb && window.hsClickFx) { hsClickFx.set({ geo: gb.dataset.g === 'true' }); return render(); }
    const hb = t.closest('#twrs-fxh button'); if (hb && window.hsClickFx) { hsClickFx.set({ house: hb.dataset.h === 'true' }); return render(); }
    const pr = t.closest('[data-pers]'); if (pr) return twr.setCfg({ personality: pr.dataset.pers });
    if (t.closest('#twrs-memreset')) { if (!confirm('Make the rabbit forget your habits (visit counts, streak, name, found items log)?')) return; try { twr.resetMem(); } catch {} say('Habits forgotten.'); return render(); }
    if (t.closest('#twrs-reset')) {
      if (!confirm('Reset the rabbit? Coins, XP, stats and everything you bought will be wiped.')) return;
      try { localStorage.removeItem('hs-twr-cfg'); } catch {}
      try { twr.resetMem(); } catch {} twr.setCfg({ on: true, coins: 0, xp: 0, owned: [], stats: { pets: 0, saves: 0, tows: 0, hacks: 0, pops: 0 }, name: '' });
      say('Rabbit reset. A fresh start.'); return render();
    }
    const cd = t.closest('.twrs-card[data-cat]');
    if (cd) {
      const key = cd.dataset.cat, id = cd.dataset.id;
      const it = Object.values(window.TWR_CATALOG).flat().find((x) => x && x.id === id);
      if (it && owned(it)) { twr.setCfg({ [key]: id }); return say(`Equipped ${it.name}.`); }
      let r = { ok: false, reason: 'cannot buy right now' };
      try { r = twr.buy(id) || r; } catch {}
      if (r.ok) {
        twr.setCfg({ [key]: id }); say(`Unlocked ${it ? it.name : id}!`);
        setTimeout(() => { const n = page.querySelector(`.twrs-card[data-id="${CSS.escape(id)}"]`); if (n) n.classList.add('unlock'); }, 30);
      } else say(r.reason || 'Not enough coins.', true);
    }
  });
  page.addEventListener('change', (e) => { if (e.target.id === 'twrs-name' && ready()) twr.setCfg({ name: e.target.value.trim().slice(0, 16) }); });

  // re-render when the rabbit changes (debounced; skipped while typing the name or when the tab isn't showing)
  function later() {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      if (page.classList.contains('hidden')) return;
      if (document.activeElement && document.activeElement.id === 'twrs-name') return;
      render();
    }, 150);
  }
  document.addEventListener('twr-config', () => { syncTab(); later(); });
  document.addEventListener('twr-found', () => { syncTab(); later(); });
  document.addEventListener('twr-ready', () => { syncTab(); render(); });
  tabs.addEventListener('click', (e) => { if (e.target.closest('[data-st="rabbit"]')) render(); });
  render();
  setTimeout(syncTab, 400); setTimeout(syncTab, 2000);
  try { if (localStorage.getItem('settingsTab') === 'rabbit') setTimeout(() => { if (syncTab()) btn.click(); }, 600); } catch {}
})();
