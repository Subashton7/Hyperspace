// FIND (Ctrl+K or the ⌕ FIND chip): type what you're after ("fans", "phone", "journal", "blackjack") and jump
// straight there. Made for people who don't know the layout yet: every page and the main features are listed
// in plain words, with the extra words people might search for.
(() => {
  const view = (v) => () => $(`.nav[data-view="${v}"]`)?.click();
  const set = (tab) => () => { view('settings')(); setTimeout(() => $(`#set-tabs [data-st="${tab}"]`)?.click(), 50); };
  const click = (sel, v) => () => { if (v) view(v)(); setTimeout(() => $(sel)?.click(), v ? 120 : 0); };
  const scrollTo = (v, sel) => () => { view(v)(); setTimeout(() => $(sel)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150); };
  const E = [
    ['OPERATIONS', 'home: live stats, mic & camera shields', 'operations nexus home dashboard overview start cpu memory gpu', view('nexus')],
    ['Mic & camera kill switches', 'OPERATIONS', 'privacy microphone webcam shield block', view('nexus')],
    ['Cooling & fans', 'FANS: one-click QUIET / BALANCED / COOL / MAX', 'burner afterburner fan fans cooling temperature temp hot loud quiet noise nitrosense', scrollTo('afterburner', '.ab-cool')],
    ['Fan curves (advanced)', 'FANS: draw your own fan curve', 'curve custom fan rpm', click('#cool-adv', 'afterburner')],
    ['Overheat protocol', 'FANS: alarm + max fans when too hot', 'overheat alarm throttle temperature safety', scrollTo('afterburner', '.ab-heat')],
    ['Power modes & clocks', 'FANS page: GAMER / SILENT / ECO, GPU clocks', 'power mode performance battery eco silent gamer overclock gpu clock', view('afterburner')],
    ['Clean up RAM (vacuum)', 'OPERATIONS: frees memory', 'ram memory vacuum clean speed', view('nexus')],
    ['Task manager', 'OPERATIONS: what\'s running, end tasks', 'processes task manager kill end close app running entities', view('nexus')],
    ['Privacy: mic & camera', 'SENSES: seal the mic or camera, see which apps used them', 'senses privacy mic microphone camera webcam listened watched', view('senses')],
    ['Accent colour', 'SETTINGS → LOOK: pick purple, cyan, pink, amber… or any colour', 'purple color colour theme accent look style violet cyan pink amber red blue', () => HS.actions.purpleToggle?.()],
    ['VJ visualizer', 'VJ: visuals that dance to music', 'vj visuals visualizer lights spout resolume obs wallpaper', view('vj')],
    ['Live wallpaper', 'VJ: visuals behind your desktop', 'wallpaper desktop background', view('vj')],
    ['CRATE: your music', 'rekordbox library, BPM, keys, cues', 'music library rekordbox tracks songs bpm key crate', view('crate')],
    ['DJ decks', 'CRATE: two decks, sync, line up drops', 'dj decks mix crossfader sync drop', view('crate')],
    ['Grab a SoundCloud link', 'CRATE: ⇩ GET', 'soundcloud download grab klickaud link', view('crate')],
    ['Audio, media & displays', 'DECK: volume, now playing, screens', 'audio sound volume media spotify display monitor screen', view('deck')],
    ['File router', 'auto-sort your downloads', 'router file downloads sort files organize', view('router')],
    ['NOTES', 'your encrypted notebook (OneNote replacement)', 'notes notebook onenote write diary', view('notes')],
    ['Journal entry', 'NOTES: today\'s page', 'journal diary today entry write', click('#nt-journal', 'notes')],
    ['Import OneNote', 'NOTES: bring your notebooks over', 'onenote import microsoft', click('#nt-import', 'notes')],
    ['TO-DO', 'your list + the De-Big-Tech quest line', 'todo to-do tasks list checklist', view('todo')],
    ['De-Big-Tech My Life', 'TO-DO: quests, XP, ranks', 'quest de-big-tech degoogle privacy google microsoft apple xp level', view('todo')],
    ['GAMES', 'blackjack, spades, poker', 'games play cards casino', view('games')],
    ['HARDWARE · PORTS & POWER', 'every USB socket, hub and device, with speed and power', 'usb ports hub hubs power voltage volts amps watts battery type-c devices hardware', view('hardware')],
    ['Blackjack', 'GAMES', '21 blackjack cards casino', () => { view('games')(); setTimeout(() => window.GAMES?.open('blackjack'), 80); }],
    ['Spades', 'GAMES: you + a partner vs two bots', 'spades cards partner trick', () => { view('games')(); setTimeout(() => window.GAMES?.open('spades'), 80); }],
    ['Poker', 'GAMES: Hold\'em, 5-card draw, video poker', 'poker holdem texas draw video jacks cards', () => { view('games')(); setTimeout(() => window.GAMES?.open('poker'), 80); }],
    ['Connect VPN', 'side dock: one-click CONNECT / DISCONNECT (WireGuard)', 'vpn connect proton wireguard disconnect private', () => hs.call('vpnWgInfo').then((i) => (i.profile ? hs.call(i.state === 'RUNNING' ? 'vpnWgDown' : 'vpnWgUp') : hs.call('vpnWgImport'))).then(() => toast('VPN SWITCHED')).catch((e) => toast(e.message.toUpperCase(), true))],
    ['Phone link', 'control HYPERSPACE from your phone', 'phone iphone remote qr link mobile', click('#link-btn')],
    ['Lite mode', 'turn the looks down while something heavy runs', 'lite performance slow lag fast battery', set('general')],
    ['Visual effects', 'SETTINGS → DISPLAY: rain, tunnel, glow', 'effects display background rain matrix tunnel look theme', set('display')],
    ['Startup animation', 'SETTINGS → GENERAL', 'intro startup animation boot', set('general')],
    ['NitroSense key', 'SETTINGS → GENERAL: make it open HYPERSPACE', 'nitrosense key button', set('general')],
    ['Graphics card / safe drawing', 'SETTINGS → GENERAL: UI RENDERS ON', 'gpu graphics nvidia integrated safe freeze crash', set('general')],
    ['Side dock', 'SETTINGS → SIDE DOCK', 'dock sidebar side panel widget', set('dock')],
    ['Widgets', 'add or move cards on a page', 'widgets cards customize layout', click('#widgets-btn')],
    ['About HYPERSPACE', 'SETTINGS → ABOUT', 'about version help', set('about')],
  ];
  let box = null, sel = 0, hits = [];
  function score(e, q) {
    if (!q) return 1;
    const hay = `${e[0]} ${e[1]} ${e[2]}`.toLowerCase();
    const ws = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!ws.every((w) => hay.includes(w))) return 0;
    return (e[0].toLowerCase().startsWith(ws[0]) ? 3 : 0) + (e[0].toLowerCase().includes(ws[0]) ? 2 : 0) + 1;
  }
  function draw() {
    const q = box.querySelector('input').value.trim();
    hits = E.map((e) => [score(e, q), e]).filter(([s]) => s).sort((a, b) => b[0] - a[0]).map(([, e]) => e).slice(0, 7);
    // and always: look for the words inside your own stuff
    if (q) {
      const fill = (v, sel) => () => { view(v)(); setTimeout(() => { const i = $(sel); if (i) { i.value = q; i.dispatchEvent(new Event('input', { bubbles: true })); i.focus(); } }, 250); };
      hits.push([`Search your music for “${q}”`, 'CRATE: tracks, artists, genres', '', fill('crate', '#cr-search')]);
      hits.push([`Search your notes for “${q}”`, 'NOTES: every page (unlock first)', '', fill('notes', '#nt-q')]);
    }
    sel = Math.min(sel, Math.max(0, hits.length - 1));
    box.querySelector('.fd-list').innerHTML = hits.length ? hits.map((e, k) => `<div class="fd-row ${k === sel ? 'on' : ''}" data-k="${k}"><b>${e[0]}</b><span>${e[1]}</span></div>`).join('') : '<div class="fd-none">Type what you want, like "fans", "phone" or a song name.</div>';
    box.querySelectorAll('.fd-row').forEach((r) => r.addEventListener('click', () => go(+r.dataset.k)));
  }
  function go(k) { const e = hits[k]; close(); if (e) e[3](); }
  function open() {
    if (box?.isConnected) return; // (a box removed some other way counts as closed)
    box = document.createElement('div');
    box.className = 'fd-wrap';
    box.innerHTML = '<div class="fd panel"><input placeholder="what are you looking for? (fans, phone, journal, blackjack…)" spellcheck="false"><div class="fd-list"></div><div class="fd-tip">↑↓ to pick · Enter to go · Esc to close · Ctrl+F opens this anywhere</div></div>';
    document.body.appendChild(box);
    const inp = box.querySelector('input');
    inp.addEventListener('input', () => { sel = 0; draw(); });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { sel = Math.min(hits.length - 1, sel + 1); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
      else if (e.key === 'Enter') go(sel);
      else if (e.key === 'Escape') close();
    });
    box.addEventListener('click', (e) => { if (e.target === box) close(); });
    draw(); inp.focus();
  }
  function close() { box?.remove(); box = null; }
  $('#find-btn')?.addEventListener('click', open);
  // Ctrl+F (what everyone tries first) and Ctrl+K both open FIND, from any page
  document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && !e.altKey && ['k', 'f'].includes(e.key.toLowerCase())) { e.preventDefault(); box?.isConnected ? close() : open(); } }, true);
  window.FIND = { open };
})();
