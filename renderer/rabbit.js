// THE WHITE RABBIT ("twr"): a pixel-art Matrix-style assistant that pops up, reacts, does little tab-specific tricks and tows
// dragged sidebar tiles back to where they landed (car, hover-board, forklift, UFO beam, rocket sled, rope, shove, surf, teleport, conveyor).
// Drawn as 8-bit sprite maps on <canvas> (no images). Materialises from / dissolves into falling green glyphs.
//
// TRIGGERING FROM OTHER CODE (nothing breaks if the rabbit is missing):
//   document.dispatchEvent(new CustomEvent('twr', { detail: { do: 'saved' } }));              // named reaction
//   document.dispatchEvent(new CustomEvent('twr', { detail: { say: 'Hello', ms: 2500 } }));   // just talk
//   document.dispatchEvent(new CustomEvent('twr', { detail: { do: 'react', name: 'error' } }));
//   document.dispatchEvent(new CustomEvent('twr', { detail: { do: 'tow', el, from, to } }));  // el is already at `to`; from/to = rects
//   document.dispatchEvent(new CustomEvent('twr', { detail: { do: 'antic', name: 'sleep' } }));
//   Reactions: saved deleted error moved welcome unlock locked copied
// New: THE BURROW (a little pixel room in a screen corner where the rabbit lives; everything he does starts and ends at its door),
//   the ASSISTANT terminal (click the house or Ctrl+Space), proactive help nudges, and {do:'poke', x, y, kind, label} (kinds: button switch tile input link generic).
//   DEFAULT OFF + EASTER EGG: a fresh install has cfg.on=false/found=false: the rabbit, burrow and its Settings tab are dormant and invisible until found
//   (type "follow the white rabbit", Konami code, click the HYPERSPACE title 7x, FIND "rabbit", or document event 'twr' {do:'found'}). Events: 'twr-found', 'twr-config'.
//   twr.home() -> DOMRect|null, twr.homePoint() -> {x,y}, twr.poke(d), twr.assistant.{open,close,toggle,run}. No audio at all.
// API: window.twr = { say, react, tow(el,from,to,opts), scene(...names), scenes, popBehind, pet, enable, enabled,
//   cfg(), setCfg(patch), buy(id), owns(id), level(), coins(), draw(container, cfgOverride, pose), stage:{demo(name)}, antics:[names], tab() }
//   window.TWR_CATALOG = { skins, hats, glasses, colors, vehicles, personalities, freq }.  Config: localStorage 'hs-twr-cfg'.
// Roams every tab: strolls along the status bar and panel tops, peeks from the screen edge, status bar and title bar.
// twr.mock(from, to) = mock a corrected spelling (also on window event 'hs-spell-corrected' {from,to}); twr.tutorial() / hsTips.tutorial() = guided tips with NEXT/SKIP.
// Autosave 'saved' events are counted but never spoken.
// Never blocks clicks (pointer-events none except his own body). Phone remote: skipped.
(() => {
  'use strict';
  // ---------- catalogue (public contract for the settings tile) ----------
  const CATALOG = {
    skins: [
      { id: 'classic', name: 'Phosphor White', desc: 'The original. Cool white with green scanlines.', cost: 0 },
      { id: 'matrix', name: 'Matrix Green', desc: 'Rendered entirely in falling-code green.', cost: 120 },
      { id: 'cyber', name: 'Cyber Pink/Cyan', desc: 'Split-tone neon, rain-slick street vibes.', cost: 200 },
      { id: 'glitch', name: 'Corrupted', desc: 'Bad sectors, colour tearing, twitchy rows.', cost: 250 },
      { id: 'gold', name: 'Gold Boss', desc: 'Premium plating. Sparkles included.', cost: 500 },
      { id: 'ghost', name: 'Hologram', desc: 'See-through, flickery projection.', cost: 300 },
      { id: 'ascii', name: 'Terminal ASCII', desc: 'Pure text. No pixels were harmed.', cost: 180 },
    ],
    hats: [
      { id: 'nohat', name: 'No hat', cost: 0 }, { id: 'tophat', name: 'Top hat', cost: 60 }, { id: 'cap', name: 'Red cap', cost: 40 },
      { id: 'crown', name: 'Crown', cost: 150 }, { id: 'phones', name: 'DJ headphones', cost: 80 }, { id: 'wizard', name: 'Wizard hat', cost: 100 },
      { id: 'propeller', name: 'Propeller beanie', cost: 70 }, { id: 'halo', name: 'Halo', cost: 90 }, { id: 'party', name: 'Party hat', cost: 50 },
    ],
    glasses: [
      { id: 'noglass', name: 'No glasses', cost: 0 }, { id: 'shades', name: 'Deal-with-it shades', cost: 60 }, { id: 'round', name: 'Nerd specs', cost: 40 },
      { id: 'visor', name: 'Cyber visor', cost: 120 }, { id: 'threed', name: '3D glasses', cost: 50 }, { id: 'hearts', name: 'Heart eyes', cost: 70 },
    ],
    colors: [
      { id: 'phosphor', name: 'Phosphor Green', hex: '#00ff9c', cost: 0 }, { id: 'cyan', name: 'Neon Cyan', hex: '#3df0ff', cost: 30 },
      { id: 'magenta', name: 'Hot Magenta', hex: '#ff4fd8', cost: 30 }, { id: 'amber', name: 'Amber CRT', hex: '#ffb000', cost: 30 },
      { id: 'violet', name: 'Ultraviolet', hex: '#a974ff', cost: 40 }, { id: 'crimson', name: 'Red Pill', hex: '#ff3d52', cost: 40 },
    ],
    vehicles: [
      { id: 'car', name: 'Toy car', cost: 0 }, { id: 'hoverboard', name: 'Hover-board', cost: 100 }, { id: 'forklift', name: 'Tiny forklift', cost: 120 },
      { id: 'ufo', name: 'UFO tractor beam', cost: 200 }, { id: 'rocket', name: 'Rocket sled', cost: 160 },
    ],
    personalities: [
      { id: 'sassy', name: 'Sassy', desc: 'Cheeky remarks and eye-rolls.' }, { id: 'helpful', name: 'Helpful', desc: 'Friendly tips and encouragement.' },
      { id: 'chaotic', name: 'Chaotic', desc: 'Says whatever. Mostly nonsense.' }, { id: 'zen', name: 'Zen', desc: 'Calm, short, slightly smug.' },
      { id: 'hacker', name: 'Hacker', desc: 'Speaks in terminal commands.' },
    ],
    freq: [{ id: 'off', name: 'Off' }, { id: 'rare', name: 'Rare' }, { id: 'normal', name: 'Normal' }, { id: 'chatty', name: 'Chatty' }],
  };
  if (!window.TWR_CATALOG) window.TWR_CATALOG = CATALOG;
  if (window.twr || (window.hs && hs.remote)) return;

  const rnd = (a, b) => a + Math.random() * (b - a);
  const rint = (a, b) => Math.floor(rnd(a, b + 1));
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
  const mq = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const reduced = () => mq.matches;
  const isLite = () => !!(document.body && document.body.classList.contains('lite')) || !!(window.hs && hs.lite && hs.lite.on);
  const ease = (t) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---------- config, items, economy ----------
  const ITEMS = {};
  const KIND = { skin: 'skins', hat: 'hats', glasses: 'glasses', color: 'colors', vehicle: 'vehicles' };
  for (const k of Object.keys(KIND)) for (const it of CATALOG[KIND[k]]) ITEMS[it.id] = { kind: k, cost: it.cost || 0 };
  const DEF = { on: false, found: false, freq: 'normal', skin: 'classic', hat: 'nohat', glasses: 'noglass', color: 'phosphor', vehicle: 'car', personality: 'sassy', name: 'twr', home: true, homeCorner: 'br', help: true, seenTabs: [], coins: 0, xp: 0, owned: [], mem: {}, stats: { pets: 0, saves: 0, tows: 0, hacks: 0, pops: 0, pokes: 0, helps: 0, cmds: 0, timers: 0, nudges: 0, gifts: 0 } };
  const loadCfg = () => {
    let o = {}; try { o = JSON.parse(lsGet('hs-twr-cfg') || '{}') || {}; } catch {}
    const fresh = lsGet('hs-twr-cfg') == null; // never stored = a fresh install: dormant until found (existing users keep what they had)
    const c = Object.assign({}, DEF, fresh ? {} : { on: true, found: true }, o);
    c.stats = Object.assign({}, DEF.stats, o.stats && typeof o.stats === 'object' ? o.stats : {});
    c.owned = Array.isArray(o.owned) ? o.owned.filter((x) => typeof x === 'string') : [];
    c.coins = Math.max(0, +c.coins || 0); c.xp = Math.max(0, +c.xp || 0);
    if (!('on' in o) && lsGet('hs-twr') === 'off') c.on = false; // migrate the old off switch
    c.on = !!c.on; c.found = !!c.found; delete c.sound; // old saved configs may still carry 'sound': ignored, never used
    c.home = c.home !== false; c.help = c.help !== false;
    if (!['br', 'bl', 'tr', 'tl'].includes(c.homeCorner)) c.homeCorner = 'br';
    c.mem = o.mem && typeof o.mem === 'object' && !Array.isArray(o.mem) ? o.mem : {};
    c.seenTabs = Array.isArray(o.seenTabs) ? o.seenTabs.filter((x) => typeof x === 'string').slice(0, 40) : [];
    return c;
  };
  const CFG = loadCfg();
  let saveT = 0;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => lsSet('hs-twr-cfg', JSON.stringify(CFG)), 150); };
  const saveNow = () => { clearTimeout(saveT); lsSet('hs-twr-cfg', JSON.stringify(CFG)); lsSet('hs-twr', CFG.on ? null : 'off'); };
  const cfgCopy = () => JSON.parse(JSON.stringify(CFG));
  const owns = (id) => { const it = ITEMS[id]; return !!it && (it.cost === 0 || CFG.owned.includes(id)); };
  const accentOf = (c) => { const x = CATALOG.colors.find((i) => i.id === (c || CFG).color); return x ? x.hex : '#00ff9c'; };
  const TITLES = ['NEWBIE', 'SCRIPT KIDDIE', 'OPERATOR', 'HACKER', 'ARCHITECT', 'NEO', 'THE ONE'];
  function level() {
    const xp = CFG.xp, lvl = 1 + Math.floor(Math.sqrt(xp / 20));
    return { lvl, xp, next: 20 * lvl * lvl, title: TITLES[Math.min(TITLES.length - 1, lvl - 1)] };
  }
  const coins = () => CFG.coins;
  function addXp(n) {
    const before = level().lvl; CFG.xp += n; save();
    const L = level();
    if (L.lvl > before) setTimeout(() => { try { say(`${voice('level')} LEVEL ${L.lvl}: ${L.title}.`, 4600); } catch {} }, 1200);
  }
  function addCoins(n) { CFG.coins += n; save(); }
  function fire(name, detail) { try { document.dispatchEvent(new CustomEvent(name, { detail })); } catch {} }
  function buy(id) {
    try {
      const it = ITEMS[id];
      if (!it) return { ok: false, reason: 'unknown' };
      if (owns(id)) return { ok: false, reason: 'owned' };
      if (CFG.coins < it.cost) return { ok: false, reason: 'coins' };
      CFG.coins -= it.cost; CFG.owned.push(id); saveNow(); fire('twr-config', cfgCopy());
      return { ok: true, coins: CFG.coins };
    } catch { return { ok: false, reason: 'error' }; }
  }
  function setCfg(p) {
    try {
      p = p || {};
      for (const k of Object.keys(p)) {
        if (!(k in DEF) || k === 'mem') continue; // mem is private (twr.mem() reads it, twr.resetMem() wipes it)
        let v = p[k];
        if (KIND[k]) { if (!CATALOG[KIND[k]].some((i) => i.id === v) || !owns(v)) continue; }
        else if (k === 'freq') { if (!CATALOG.freq.some((i) => i.id === v)) continue; }
        else if (k === 'personality') { if (!CATALOG.personalities.some((i) => i.id === v)) continue; }
        else if (k === 'on' || k === 'home' || k === 'help' || k === 'found') v = !!v;
        else if (k === 'homeCorner') { if (!['br', 'bl', 'tr', 'tl'].includes(v)) continue; }
        else if (k === 'seenTabs') v = Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 40) : CFG.seenTabs;
        else if (k === 'name') v = String(v || 'twr').replace(/[^\w .-]/g, '').slice(0, 12) || 'twr';
        else if (k === 'coins' || k === 'xp') v = Math.max(0, +v || 0);
        else if (k === 'owned') v = Array.isArray(v) ? v.filter((x) => typeof x === 'string') : CFG.owned;
        else if (k === 'stats') v = Object.assign({}, CFG.stats, v && typeof v === 'object' ? v : {});
        CFG[k] = v;
      }
      saveNow(); if (CFG.on) memOpen();
      const homeOnly = Object.keys(p).every((k) => ['home', 'homeCorner', 'help', 'seenTabs', 'found'].includes(k));
      if (!CFG.on) cancel(true); else if (!homeOnly) { cancel(false); }
      if (spr) { spr.setCfg(CFG); }
      try { applyHome(); } catch {}
      fire('twr-config', cfgCopy());
      return cfgCopy();
    } catch (e) { console.warn('twr.setCfg', e); return cfgCopy(); }
  }
  const awake = () => CFG.on && lsGet('hs-twr') !== 'off' && Date.now() >= (+lsGet('hs-twr-until') || 0);
  const stat = (k, n = 1) => { CFG.stats[k] = (CFG.stats[k] || 0) + n; save(); };

  // ---------- words ----------
  const LINES = {
    saved: ['Saved. You are welcome.', 'Look at you, being responsible.', 'Backed up and glowing.', 'Ctrl+S energy. Respect.'],
    deleted: ['Deleted. Gone.', 'Poof. Deleted.', 'Cleared away.'],
    error: ['Well. That went poorly.', 'Oof. Not my fault.', 'Red text again. Classic.'],
    moved: ['A tile moved. Let me tidy that up.', 'Putting the tile back where it belongs.'],
    welcome: ['Welcome back, operator.', 'The Matrix has you. I have snacks.', 'You again. Good.'],
    unlock: ['Unlocked. Be good.', 'Open sesame.'],
    locked: ['Locked. My lips are sealed.', 'Vault sealed. I saw nothing.'],
    copied: ['Copied to the clipboard.', 'Ctrl+C, Ctrl+Cute.'],
    pet: ['Hehe, that tickles!', 'Careful, the ears are sensitive.', 'Ok ok ok, you may continue.', 'I allow this.'],
    idle: ['Psst. Hydrate.', 'Your fans are doing their best.', 'Do not mind me.', 'Carrots: 0. Please send carrots.', 'I live here now.', 'Have you tried turning it off and on?', 'Nice rig. Very green.'],
    tab: ['New tab. New me.', 'Nice choice.', 'I will just watch from here.'],
    tow: ['BEEP BEEP!', 'Delivery complete.', 'Parked. Perfectly.'],
  };
  const PL = {
    sassy: {}, // sassy = the defaults above
    helpful: {
      saved: ['Saved! Your work is safe.', 'All backed up. Nicely done.'], error: ['That did not work. Check the details and try again?', 'Hmm, an error. I believe in you.'],
      moved: ['Let me put that back neatly for you.', 'Allow me to tidy that up!'], pet: ['Thank you! Happy to help.', 'Aww. Need anything?'],
      idle: ['Tip: right-click things. Most of them have menus.', 'Tip: drag sidebar tiles to reorder them.', 'Remember to take a stretch break.', 'Need a hand? Just ask.'],
      tab: ['Welcome to this page! Hover for hints.', 'Good spot. Everything you need is here.'], tow: ['All tidy now!', 'There you go.'], deleted: ['Removed. You can always redo it.'],
    },
    chaotic: {
      saved: ['SAVED!!! (maybe)', 'Saved to the moon.', 'I saved it. Somewhere. Probably here.'], error: ['AAAAA. It is fine.', 'The error did it, not me.', 'Chaos achieved.'],
      moved: ['Tile heist in progress!', 'Wheeeee tiles!'], pet: ['BOOP!', 'Pet me again I dare you.', 'My ears have WiFi now.'],
      idle: ['I ate a USB stick. Tasty.', 'What if the mouse is the real user?', 'Carrot. Carrot. Carrot.', 'I rearranged your pixels. Look closer.'],
      tab: ['Ooh, shiny page!', 'Switching tabs is just teleporting with extra steps.'], tow: ['ZOOM!', 'Delivered it sort of.'], deleted: ['KABOOM. Gone.'],
    },
    zen: {
      saved: ['Saved. Breathe.', 'The file is at peace.'], error: ['An error is just a lesson.', 'This too shall pass.'],
      moved: ['Everything finds its place.', 'The tile returns.'], pet: ['...yes.', 'Mm. Calm.'],
      idle: ['Be like the idle process.', 'Inhale. Exhale. Defrag.', 'Silence is also a feature.'],
      tab: ['A new page. A new moment.', 'Flow.'], tow: ['It is where it should be.', 'Balance restored.'], deleted: ['Let go.'],
    },
    hacker: {
      saved: ['$ sync --force ... ok', 'write(fd) = OK. Easy.'], error: ['segfault in reality.dll', 'stderr: nope.', '$ cat error | sigh'],
      moved: ['$ mv tile --back', 'sudo rearrange tiles'], pet: ['$ pet --gently', 'access granted: ears'],
      idle: ['Scanning ports... just kidding. Mostly.', '$ whoami -> your biggest fan', 'Packet loss: 0%. Vibes: 100%.', 'tail -f /dev/matrix'],
      tab: ['$ cd ./newtab', 'Loading view... 100%.'], tow: ['$ mv ok', 'tile.exe relocated.'], deleted: ['rm -rf success.'],
    },
  };
  const L = (ev) => voice(ev); // voice packs live in the VOICE block near the bottom of this file
  const TABNAME = { nexus: 'OPERATIONS', afterburner: 'FANS', vj: 'CRATE > VJ', crate: 'CRATE', deck: 'DECK', router: 'FILE ROUTER', senses: 'SENSES', notes: 'NOTES', todo: 'TO-DO', hardware: 'HARDWARE', experts: 'EXPERTS', settings: 'SETTINGS', games: 'GAMES' };
  const TABLINES = {
    nexus: ['Ops deck online. All eyes on the gauges.', 'Mission control, but make it green.'],
    afterburner: ['Fans! My favourite breeze.', 'Let us make some wind.'],
    vj: ['Visuals! Lasers when?', 'Drop the bass, not the framerate.', 'The VJ moved into CRATE. Roommates now.', 'Lights down. Visuals up.'],
    crate: ['Crate digging. Bring snacks.', 'So many tunes, so little time.', 'The library. Shhh, the records are sleeping.'],
    deck: ['The deck. Tiny knobs, big dreams.', 'The deck: tiny knobs, handle with care.'],
    router: ['Files go in. Files come out. Magic.', 'Router duty. I am a mailman now.'],
    senses: ['Senses: the mic and camera switches live here.', 'Privacy first. Eyes closed.'],
    notes: ['Notes! Write something brilliant.', 'Journal time? I will not peek.'],
    todo: ['The to-do list. Let us pick one task.', 'Tasks to tick off. You can do it.'],
    hardware: ['Hardware: your USB devices and temperatures.', 'Plug things in or out. I will keep watch.'],
    experts: ['The experts! Best behaviour.', 'Ask them anything. I just carry the clipboard.'],
    settings: ['Settings: switches and knobs live here.', 'Knobs and switches everywhere.'],
  };

  // ---------- pixel data ----------
  const GW = 28, GH = 32, OX = 2, OY = 3, SC = 3, W = GW * SC, H = GH * SC;
  // ---------- profile rabbit generator: he is drawn from the SIDE, facing right (the flip layer mirrors him going left) ----------
  // Shapes are built from ellipses and thick lines on a 26x29 local grid, then outlined automatically, so every pose keeps
  // one clean pixel outline. Parts are painted back to front: far ear, tail, far arm, body, hind foot, head, near ear, near arm.
  const LW = GW - OX, LH = GH - OY;
  const inb = (x, y) => x >= 0 && y >= 0 && x < LW && y < LH;
  const cellsOf = (f) => { const a = []; for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) if (f(x, y)) a.push([x, y]); return a; };
  const ell = (cx, cy, rx, ry) => cellsOf((x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1);
  function seg(x0, y0, x1, y1, w) {
    const a = [], n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) { const cx = Math.round(lerp(x0, x1, i / n)), cy = Math.round(lerp(y0, y1, i / n)); for (let dy = 0; dy < w; dy++) for (let dx = 0; dx < w; dx++) a.push([cx + dx, cy + dy]); }
    return a;
  }
  const join = (...l) => [].concat(...l);
  // ol: 1 = outline on empty cells; 2 = also a soft line over white; 3 = hard outline over everything it touches
  function lay(g, cells, fill, ol) {
    const set = new Set(cells.map(([x, y]) => y * 100 + x));
    if (ol) for (const [x, y] of cells) for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + ax, ny = y + ay; if (!inb(nx, ny) || set.has(ny * 100 + nx)) continue;
      const cur = g[ny][nx];
      if (cur === '.') g[ny][nx] = 'k'; else if (ol === 3) g[ny][nx] = 'k'; else if (ol === 2 && cur === 'W') g[ny][nx] = 'w';
    }
    for (const [x, y] of cells) if (inb(x, y)) g[y][x] = fill;
  }
  const dot = (g, x, y, ch) => { x = Math.round(x); y = Math.round(y); if (inb(x, y)) g[y][x] = ch; };
  const stamp = (g, x, y, rows) => { for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) { const ch = rows[r][c]; if (ch === '.' || ch === ' ') continue; dot(g, x + c, y + r, ch); } };
  // an upright ear: base (bx,by) going up, leaning back (to the left) by `lean` columns per row
  function earUp(bx, by, len, lean) {
    const f = [], inner = [];
    for (let i = 0; i < len; i++) { const x0 = Math.round(bx - i * lean), y = by - i, w = i === len - 1 ? 1 : 3, o = i === len - 1 ? 1 : 0; for (let c = 0; c < w; c++) f.push([x0 + o + c, y]); if (i >= 1 && i <= len - 3) inner.push([x0 + 1, y]); }
    return { f, inner };
  }
  const earBack = (bx, by, len, rise, th) => ({ f: seg(bx - len, by - rise, bx, by, th), inner: [] });
  const ARMS = { down: [1, 6], fwd: [7, 1], up: [4, -6], up2: [7, -7], out: [6, -3], hold: [4, -2], face: [3, -8], reach: [5, 3] };
  // how each pose is built: head centre / radii, muzzle, shoulder, ear base
  const KINDS = {
    sit: { hc: [16.5, 12.5], hr: [5, 4.2], mz: [20, 14.3, 2.9, 2.1], S: [14, 18.5], ear: [15, 8, 0.45] },
    up: { hc: [15.5, 9.5], hr: [5, 4.2], mz: [19, 11.3, 2.9, 2.1], S: [13.5, 14.5], ear: [14, 5, 0.3] },
    loaf: { hc: [18, 21.5], hr: [4.5, 3.5], mz: [21.2, 22.6, 2.6, 1.8], S: [16, 24], ear: [16, 18, 0] },
    run: { hc: [19, 14.5], hr: [4.6, 3.8], mz: [22, 15.7, 2.4, 1.8], S: [16, 19], ear: [16, 12, 0] },
  };
  function compose(spec, s, k) {
    const g = Array.from({ length: LH }, () => Array(LW).fill('.'));
    const c = s.cfg, ov = s.over || {}, kind = spec.kind || 'sit', K = KINDS[kind], hd = spec.hdy || 0, ed = spec.ears || 'up';
    const hc = [K.hc[0], K.hc[1] + hd], mz = [K.mz[0], K.mz[1] + hd, K.mz[2], K.mz[3]], S = [Math.round(K.S[0]), Math.round(K.S[1]) + (kind === "sit" || kind === "up" ? hd : 0)];
    const head = join(ell(hc[0], hc[1], K.hr[0], K.hr[1]), ell(mz[0], mz[1], mz[2], mz[3]));
    const top = Math.min(...head.map((p) => p[1])), A = { cx: Math.round(hc[0]), top, ex: Math.round(hc[0] + 1.5), ey: Math.round(hc[1] - 1.8), nx: Math.floor(mz[0] + mz[2]), ny: Math.round(mz[1]) - 1 };
    if (kind === 'loaf') A.ey = Math.round(hc[1] - 0.6);
    let bodyC;
    const bx = K.ear[0], by = K.ear[1] + hd;
    let near, far;
    if (ed === 'back' || kind === 'loaf' || kind === 'run') {
      const th = 2;
      near = earBack(bx, by, kind === 'loaf' ? 9 : 10, kind === 'loaf' ? 0 : 2, th); far = earBack(bx - 1, by - 2, kind === 'loaf' ? 8 : 9, kind === 'loaf' ? 1 : 3, th);
    } else {
      const L = kind === 'up' ? 8 : 9, lean = ed === 'flop' ? 0.9 : K.ear[2] + (spec.tw ? 0.5 : 0);
      near = earUp(bx, by, L - (spec.tw ? 1 : 0), lean); far = earUp(bx - 3, by, L - 1, ed === 'flop' ? 1.1 : K.ear[2] + 0.2);
    }
    lay(g, far.f, 'w', 1);
    const tail = kind === 'loaf' ? ell(1.6, 23, 1.6, 1.8) : kind === 'run' ? ell(1.2, spec.gait ? 18 : 16, 1.4, 1.6) : kind === 'up' ? ell(1.8, 23, 1.7, 1.7) : ell(1.2, 21, 1.7, 1.8);
    lay(g, tail, 't', 1);
    const arm = (kd, off, fill, ol) => {
      const a = ARMS[kd]; if (!a) return; const x0 = S[0] + off, y0 = S[1] + (off ? 1 : 0), x1 = x0 + a[0], y1 = y0 + a[1];
      const cs = seg(x0, y0, x1, y1, 2); if (kd === 'down') cs.push([x1 + 2, y1], [x1 + 2, y1 + 1], [x1 + 1, y1 + 1], [x1, y1 + 1]); lay(g, cs, fill, ol);
    };
    if (kind === 'sit') {
      bodyC = join(ell(9.5, 20, 8.5, 6.7), ell(14.4, 20.5, 3.8, 6.2)); arm(spec.L, -2, 'w', 1);
      lay(g, bodyC, 'W', 2); lay(g, ell(13.5, 25.5, 5.3, 1.1), 'W', 3);
    } else if (kind === 'up') {
      bodyC = join(ell(11, 19, 5.3, 8), ell(8.5, 22.3, 6.2, 4.4)); arm(spec.L, -2, 'w', 1);
      lay(g, bodyC, 'W', 2); lay(g, ell(12.5, 25.5, 5.6, 1.1), 'W', 3);
    } else if (kind === 'loaf') {
      bodyC = join(ell(12, 22, 10, 4.9), ell(16, 24, 5, 3)); lay(g, bodyC, 'W', 2);
    } else if (spec.gait) {
      bodyC = join(ell(11, 19.5, 7.2, 5.2), ell(6.5, 20, 4.5, 4.6)); lay(g, bodyC, 'W', 2);
      lay(g, ell(12.5, 25.5, 4.6, 1.1), 'W', 3); lay(g, ell(18.5, 25.6, 3, 1.0), 'W', 3);
    } else {
      bodyC = join(ell(10.5, 16.5, 7.6, 4.4), ell(5, 17.5, 4.6, 4.4)); lay(g, bodyC, 'W', 2);
      lay(g, seg(4, 20, 0, 24, 2), 'W', 3); lay(g, seg(14, 20, 20, 23, 2), 'W', 3);
    }
    if (ov.acc === 'parka') { for (const [x, y] of bodyC) if (g[y][x] === 'W' || g[y][x] === 'w') g[y][x] = (x + y) % 5 === 0 ? 'O' : 'o'; }
    lay(g, head, 'W', 2);
    lay(g, near.f, 'W', 1); for (const [x, y] of near.inner) dot(g, x, y, 'n');
    if (kind === 'sit' || kind === 'up') arm(spec.R, 0, 'W', 3);
    // face
    const E = spec.eyes || 'o', ex = A.ex + (E === 'l' ? -1 : E === 'r' ? 1 : 0), ey = A.ey;
    if (E === 'o' || E === 'l' || E === 'r') stamp(g, ex, ey, ['kk', 'ee', 'kk']);
    else if (E === 'w') stamp(g, ex, ey - 1, ['kk', 'kk', 'ee', 'kk']);
    else if (E === 's') stamp(g, ex, ey + 1, ['kk', 'kk']);
    else stamp(g, ex, ey + 1, ['kk']);
    const nw = spec.nose ? ((k >> 1) & 1) : 0;
    dot(g, A.nx, A.ny + nw, 'n'); dot(g, A.nx, A.ny + 1 + nw, 'n');
    const my = Math.round(mz[1]) + 1;
    if (spec.mouth === 1) stamp(g, A.nx - 2, my, ['kk']); else if (spec.mouth === 2) stamp(g, A.nx - 2, my, ['kk', 'kk']);
    else if (kind !== 'loaf' && spec.eyes !== 'z') dot(g, A.nx - 1, my, 'w');
    // props
    const pr = spec.prop;
    if (pr === 'carrot') stamp(g, A.nx - 3, A.ny + 4, ['.oooo.g', 'ooooOgg', '.oooo.g']);
    if (pr === 'sign') stamp(g, 11, 17, ['kkkkkkkkkkkkkk', 'kyyyyyyyyyyyyk', 'kyhhhyhhhhyyyk', 'kyyyyyyyyyyyyk', 'kyhhhhhyhhyyyk', 'kkkkkkkkkkkkkk']);
    if (pr === 'laptop') {
      stamp(g, 12, 25, ['kkkkkkkkkkkkk', 'ksssssssssssk', 'kkkkkkkkkkkkk']);
      const b = (spec.flick >> 1) & 1; stamp(g, 23, 15, ['kkk', b ? 'kGk' : 'kgk', 'kgk', b ? 'kgk' : 'kGk', 'kgk', b ? 'kGk' : 'kgk', 'kgk', 'kgk', 'kkk']);
    }
    if (spec.z != null && spec.z < 3) { const z = [[[A.cx + 2, 12], ['zzz', '.z.', 'zzz']], [[A.cx + 4, 8], ['zz', '.z', 'zz']], [[A.cx + 3, 5], ['z']]][spec.z]; stamp(g, z[0][0], z[0][1], z[1]); }
    // glasses sit on the eye side
    const gk = ov.glasses || c.glasses, gx = A.ex, gy = A.ey;
    const GL = {
      shades: () => [[gx - 1, gy - 1, ['kkkkkk', 'khhcck', 'khhhhk', '.kkkk.']], [gx - 6, gy - 1, ['kkkkk']]],
      round: () => [[gx - 1, gy - 1, ['.kkkk.', 'k....k', 'k....k', 'k....k', '.kkkk.']], [gx - 6, gy, ['kkkkk']]],
      visor: (kk) => [[gx - 7, gy, ['kkkkkkkkkkkkkk', 'kcccccccccccck', 'kkkkkkkkkkkkkk']], [gx - 6 + (kk % 12), gy + 1, ['W']]],
      threed: () => [[gx - 1, gy - 1, ['kkkkkk', 'krrcck', 'krrcck', '.kkkk.']], [gx - 6, gy - 1, ['kkkkk']]],
      hearts: () => [[gx - 1, gy - 1, ['.r.r.', 'rrrrr', '.rrr.', '..r..']]],
    }[gk];
    if (GL && spec.eyes !== 'z') for (const p of GL(k)) stamp(g, p[0], p[1], p[2]);
    // hats sit on top of the head, between the ears and the forehead
    const hk = ov.hat || c.hat, ax = A.cx, ay = A.top - (ov.hatLift ? 3 : 0);
    const HT = {
      tophat: () => [[ax - 1, ay - 4, ['..kkkk..', '..khhk..', '..khhk..', '..krrk..', 'kkkkkkkk']]],
      cap: () => [[ax - 3, ay - 3, ['..kkkk.....', '.krrrrk....', 'krrrrrrkkkk', '.kkkkkkkkkk']]],
      crown: () => [[ax - 1, ay - 3, ['k..kk..k', 'kyykkyyk', 'kyyyyyyk', 'kkkkkkkk']]],
      phones: () => [[ax - 3, ay - 1, ['.kkkkkk']], [ax - 4, A.ey - 1, ['kkkk', 'kccc', 'kccc', 'kccc', 'kkkk']], [ax - 3, ay, ['k', 'k']]],
      wizard: () => [[ax - 3, ay - 6, ['....kk..', '...kbbk.', '...kbyk.', '..kbbbbk', '..kbbbbk', '.kbbbbbbk', 'kkkkkkkkkk']]],
      propeller: (kk) => [[ax - 1, ay - 3, (kk >> 1) & 1 ? ['rrr..ccc', '.yyyyyy.'] : ['ccc..rrr', '.yyyyyy.']], [ax - 1, ay - 1, ['.kkkkkk.']]],
      halo: (kk) => [[ax - 1, ay - 5 + ((kk >> 2) & 1), ['.yyyyyy.', 'y......y', '.yyyyyy.']]],
      party: () => [[ax - 2, ay - 5, ['..rr..', '..ryr.', '..rbr.', '.rybyr', 'rbrbrb', 'kkkkkk']]],
    }[hk];
    if (HT) for (const p of HT(k)) stamp(g, p[0], p[1], p[2]);
    const out = Array.from({ length: GH }, () => Array(GW).fill('.')), dx = spec.dx || 0, dy = spec.dy || 0;
    for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) { const ch = g[y][x]; if (ch === '.') continue; const gx2 = x + OX + dx, gy2 = y + OY + dy; if (gx2 >= 0 && gx2 < GW && gy2 >= 0 && gy2 < GH) out[gy2][gx2] = ch; }
    return out;
  }
  const POSES = {
    idle: (k) => ({ kind: 'sit', eyes: k % 37 < 1 || k % 53 === 20 ? 'c' : 'o', hdy: (k >> 3) & 1 ? 0 : -1, tw: k % 61 < 3, nose: k % 29 < 9 || k % 47 < 5, mouth: k % 97 > 88 ? ((k >> 1) & 1 ? 1 : 2) : 0 }),
    peek: (k) => ({ kind: 'sit', eyes: (k >> 3) & 1 ? 'l' : 'r', nose: k % 13 < 6, tw: k % 29 < 3 }),
    wave: (k) => ({ kind: 'up', eyes: 'o', R: k & 1 ? 'up' : 'up2', mouth: 1, nose: true }),
    dance: (k) => ({ kind: 'up', eyes: 'o', L: k & 1 ? 'up' : 'down', R: k & 1 ? 'down' : 'up', dy: k & 1 ? -2 : 0, dx: k & 1 ? 1 : -1, ears: k & 1 ? 'up' : 'flop', mouth: 2 }),
    bob: (k) => ({ kind: 'sit', eyes: 'c', hdy: k & 1 ? 1 : 0, mouth: 1, ears: (k >> 1) & 1 ? 'up' : 'flop' }),
    push: (k) => ({ kind: 'up', eyes: 'o', L: 'fwd', R: 'fwd', dx: 1, ears: 'back', hdy: k & 1 ? 1 : 0 }),
    heave: (k) => ({ kind: 'up', eyes: 's', L: 'up', R: 'up', ears: 'back', hdy: k & 1 ? 1 : 0 }),
    run: (k) => ({ kind: 'run', gait: k & 1, eyes: 'o', dy: k & 1 ? 0 : -1, ears: 'back' }),
    sit: (k) => ({ kind: 'sit', eyes: k % 41 < 1 ? 'c' : 'o', nose: k % 23 < 6, tw: k % 67 < 3 }),
    sleep: (k) => ({ kind: 'loaf', eyes: 'z', ears: 'back', z: Math.floor(k / 3) % 4 }),
    shrug: (k) => ({ kind: 'up', eyes: 's', L: 'out', R: 'out', hdy: (k >> 2) & 1 ? -1 : 0 }),
    facepalm: () => ({ kind: 'up', eyes: 'c', R: 'face' }),
    type: (k) => ({ kind: 'sit', eyes: 'o', R: 'fwd', prop: 'laptop', hdy: (k >> 1) & 1, flick: k }),
    carrot: (k) => ({ kind: 'sit', eyes: 'o', R: 'hold', prop: 'carrot', mouth: k & 1 ? 2 : 1, nose: true }),
    sign: (k) => ({ kind: 'up', eyes: 'o', R: 'reach', prop: 'sign', hdy: (k >> 3) & 1 }),
    nibble: (k) => ({ kind: 'sit', eyes: 'o', R: 'hold', prop: 'carrot', mouth: k & 1 ? 2 : 1, nose: true }),
  };
  const SMALL = { // little props placed on screen (not on the rabbit)
    file: ['kkkkk..', 'kWWWkk.', 'kWWWWWk', 'kWccWWk', 'kWWWWWk', 'kWccWWk', 'kWWWWWk', 'kkkkkkk'],
    sticky: ['kkkkkkk', 'kyyyyyk', 'kyhhhyk', 'kyyyyyk', 'kyhhyyk', 'kyyyyyk', 'kkkkkkk'],
    usb: ['kkkkkkkk.....', 'ksssssskhhhhh', 'kscscssk.....', 'kkkkkkkk.....'],
    binoc: ['kkkk..kkkk', 'kccckkkccck', 'kcWck..kcWck', 'kkkk....kkkk'.slice(0, 10)],
    stamp: ['..kkk..', '.krrrk.', '.krrrk.', '..krk..', 'kkkkkkk', 'krrrrrk', 'kkkkkkk'],
    broom: ['..y..', '..y..', '..y..', '..y..', '.yyy.', 'ysysy', 'ysysy'],
    knob: ['.kkkkk.', 'kssGssk', 'kssssck'.replace('c', 's'), 'kssssck'.replace('c', 's'), '.kkkkk.'],
    mic: ['.kkk.', 'ksssk', 'ksssk', '.kkk.', '..h..', '..h..', '.hhh.'],
    thermo: ['.kk.', 'krrk', 'krrk', 'krrk', 'krrk', 'krrk', 'krrk', '.kk.'],
    trophy: ['kkkkkkkkk', 'kyyyyyyyk', 'kyyWyyyyk', '.kyyyyyk.', '..kyyyk..', '...kyk...', '...kyk...', '..kkkkk..', '.kyyyyyk.', '.kkkkkkk.'],
    dict: ['kkkkkkkkk', 'kbbbbbbbk', 'kbWWWWWbk', 'kbWkkkWbk', 'kbWWWWWbk', 'kbbbbbbbk', 'kkkkkkkkk'],
  };
  const PIX = { W: '#f2fff7', w: '#bfe6d0', k: '#06150d', h: '#1d2a24', r: '#ff3d6e', y: '#ffd54a', c: '#46f0ff', b: '#3a7bff', g: '#00e887', G: '#c8ffe2', p: '#b86bff', s: '#8a97a0', o: '#ff8a1f', O: '#c4470a', z: '#9dffe0', B: '#10c070', D: '#0a5a34', f: '#ffb300', F: '#fff2a0', L: '#2a3a34' };

  // vehicles: frames(k) -> rows; faces right
  const VFR = {
    car: (k) => ['......kkkkkkkk........', '.....kccckccck.......', '....kcccckcccck......', '.kkkkkBBBBBBBBkkkk...', 'kBBBBBBBBBBBBBBBBBk..', 'kBBBBBBBBBBBBBBBByyk.', 'kkkkkkkkkkkkkkkkkkkk.', k & 1 ? '..kkWWkk......kkWWkk.' : '..kWkkWk......kWkkWk.', k & 1 ? '..kWkkWk......kWkkWk.' : '..kkWWkk......kkWWkk.', '...kkkk........kkkk..'],
    hoverboard: (k) => ['kkkkkkkkkkkkkkkkkk', 'kccccccccccccccccck', '.kkkkkkkkkkkkkkkk.', k & 1 ? '..c..c..c..c..c..' : '...c..c..c..c..c.'],
    forklift: (k) => ['...kkkkkk.........k.', '...kccccck........k.', '..kkcccckkkk......k.', '..kyyyyyyyyk......k.', '..kyyyyyyyyk......k.', '..kyyyyyyyykkkkkkkk.', '..kkkkkkkkkk........', k & 1 ? '...kWWk....kWWk.....' : '...kWkWk...kWkWk....', '...kkkk....kkkk.....'],
    ufo: (k) => ['.......kkkkkk.......', '......kccccccck.....'.slice(0, 20), '...kkkkkkkkkkkkkk...', '.kGGGGGGGGGGGGGGGGk.', k & 1 ? 'kGgGgGgGgGgGgGgGgGk' : 'kgGgGgGgGgGgGgGgGgk', '.kkkkkkkkkkkkkkkkk..', '....b...b...b...b...'],
    rocket: (k) => ['..........kkkkkk......', '........kkRRRRRRkk....'.replace(/R/g, 'r'), '..kkkkkkrrrrrrrrrrk...', '.kssssssssssssssssk...', '..kkkkkkkkkkkkkkkk....', k & 1 ? 'fffFFk................' : 'ffFFFFk...............', k & 1 ? '.ffFk.................' : '..fFk.................'],
  };
  const VEH = {
    car: { rider: 'peek', mode: 'rope', rot: true, honk: 'BEEP BEEP!', overlap: 10 },
    hoverboard: { rider: 'full', mode: 'kick', rot: false, honk: 'Kickflip complete!', overlap: 0, pose: 'dance' },
    forklift: { rider: 'peek', mode: 'rigid', rot: true, honk: 'Beep... beep... beep.', overlap: 18 },
    ufo: { rider: 'peek', mode: 'beam', rot: false, honk: 'Abduction successful.', overlap: 12 },
    rocket: { rider: 'peek', mode: 'rope', rot: true, honk: 'WHOOOSH!', overlap: 12, fast: true },
  };

  // ---------- colour helpers ----------
  const hex2 = (h) => { h = String(h || '#000').replace('#', ''); if (h.length === 3) h = h.replace(/./g, '$&$&'); return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0]; };
  const mix = (a, b, t) => { const x = hex2(a), y = hex2(b); return '#' + [0, 1, 2].map((i) => Math.round(lerp(x[i], y[i], t)).toString(16).padStart(2, '0')).join(''); };
  function mkPal(skin, A) {
    let sk;
    switch (skin) {
      case 'matrix': sk = { W: '#22d46a', w: '#0f9a4a', k: '#02170a', t: '#7dffb0', n: '#d8ffe6', e: '#f0fff5' }; break;
      case 'gold': sk = { W: '#ffe27a', w: '#e0a82e', k: '#4a2f00', t: '#fff3b0', n: '#ff9a1f', e: '#fff7cc' }; break;
      case 'ghost': sk = { W: '#bff7ff', w: '#7fd6e6', k: '#0f6f88', t: '#e6fdff', n: A, e: '#ffffff' }; break;
      case 'cyber': sk = { W: '#ff6fd8', w: '#c93bb0', k: '#220033', t: '#6ff6ff', n: '#6ff6ff', e: '#ffffff' }; break;
      default: sk = { W: '#f2fff7', w: mix('#bfe6d0', A, 0.25), k: mix(A, '#00140a', 0.82), t: '#ffffff', n: A, e: mix(A, '#ffffff', 0.55) };
    }
    const pal = Object.assign({}, PIX, sk);
    if (skin === 'ascii') { pal.W = A; pal.w = mix(A, '#000000', 0.35); pal.k = mix(A, '#ffffff', 0.4); pal.e = '#ffffff'; }
    const scan = {}; for (const ch of 'Wwt') scan[ch] = mix(pal[ch], '#003a1c', 0.22);
    const alt = skin === 'cyber' ? Object.assign({}, pal, { W: '#5ff0ff', w: '#2aa8c8', n: '#ff6fd8', t: '#ff6fd8' }) : null;
    const altScan = {}; if (alt) for (const ch of 'Wwt') altScan[ch] = mix(alt[ch], '#003a1c', 0.22);
    return { pal, scan, alt, altScan };
  }
  const hash = (x, y) => { const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return v - Math.floor(v); };
  const GLY = 'ｱｲｳｴｵｶｷｸｹｺ01234567890:.=*+-<>|ﾊﾐﾋ';

  // ---------- sprite engine ----------
  const SPRS = new Set();
  let tickN = 0, tickTimer = 0;
  function ensureTicker() {
    if (tickTimer) return;
    tickTimer = setInterval(() => {
      if (document.hidden) return;
      tickN++;
      for (const s of SPRS) {
        if (!s.cv.isConnected && !s.keep) { SPRS.delete(s); continue; }
        try { s.tick(tickN); } catch {}
      }
      if (!SPRS.size) { clearInterval(tickTimer); tickTimer = 0; }
    }, 110);
  }
  function paintGrid(s, g, k) {
    const ctx = s.ctx, sc = s.scale, sk = s.cfg.skin, P = s.palSet, rev = s.rev;
    ctx.clearRect(0, 0, s.cv.width, s.cv.height);
    ctx.globalAlpha = sk === 'ghost' ? clamp(0.62 + 0.14 * Math.sin(k * 1.7) + (Math.random() < 0.06 ? -0.25 : 0), 0.25, 0.85) : 1;
    // glitch: a few rows shift sideways, red/cyan ghost layer
    let rows = null;
    if (sk === 'glitch') { if (!s.gl || Math.random() < 0.35) { s.gl = {}; if (Math.random() < 0.7) for (let i = 0; i < rint(1, 3); i++) s.gl[rint(0, GH - 1)] = rint(-2, 2); } rows = s.gl; }
    const ascii = sk === 'ascii';
    if (ascii) { ctx.font = `bold ${Math.round(sc * 2.1)}px monospace`; ctx.textBaseline = 'top'; }
    const glows = [];
    for (let pass = rows ? 0 : 1; pass < 2; pass++) {
      for (let y = 0; y < GH; y++) {
        const row = g[y];
        for (let x = 0; x < GW; x++) {
          const ch = row[x]; if (ch === '.') continue;
          let edge = false;
          if (rev) {
            const thr = 0.62 * (y / GH) + 0.38 * hash(x, y);
            const vis = rev.mode === 'in' ? thr < rev.p : thr > rev.p;
            if (!vis) continue;
            edge = Math.abs(thr - rev.p) < 0.07;
          }
          let px = x + (rows && pass === 1 && rows[y] ? rows[y] : 0);
          const use = P.alt && x >= 14 ? [P.alt, P.altScan] : [P.pal, P.scan];
          let col = (y % 2 === 0 && use[1][ch]) ? use[1][ch] : use[0][ch] || '#fff';
          if (pass === 0) { col = (x & 1) ? '#ff2d6e' : '#2df0ff'; ctx.globalAlpha = 0.35; px = x + 1; }
          else ctx.globalAlpha = sk === 'ghost' ? ctx.globalAlpha : 1;
          if (edge) { ctx.fillStyle = '#c8ffd8'; ctx.font = `bold ${sc * 2}px monospace`; ctx.textBaseline = 'top'; ctx.fillText(GLY[(x * 7 + y * 3 + k) % GLY.length], px * sc, y * sc); if (ascii) ctx.font = `bold ${Math.round(sc * 2.1)}px monospace`; continue; }
          if (ch === 'e' && pass === 1) glows.push([px, y]);
          if (ascii) { ctx.fillStyle = col; const set = ch === 'k' ? '#%@' : ch === 'W' ? '01' : ch === 'w' ? ':;' : ch === 'e' ? '@' : '+*'; ctx.fillText(set[(x * 5 + y * 3 + (k >> 2)) % set.length], px * sc, y * sc); }
          else { ctx.fillStyle = col; ctx.fillRect(px * sc, y * sc, sc, sc); }
        }
      }
      ctx.globalAlpha = sk === 'ghost' ? ctx.globalAlpha : 1;
    }
    ctx.globalAlpha = 1;
    // glowing eye pixels get a real glow
    if (glows.length) { ctx.save(); ctx.shadowColor = s.accent; ctx.shadowBlur = sc * 3; ctx.fillStyle = P.pal.e; for (const [x, y] of glows) ctx.fillRect(x * sc, y * sc, sc, sc); ctx.restore(); }
    if (sk === 'gold' && !reduced()) { ctx.fillStyle = '#fffbe0'; for (let i = 0; i < 2; i++) { const x = rint(3, GW - 4), y = rint(4, GH - 6); if (g[y][x] !== '.') ctx.fillRect(x * sc, y * sc, sc, sc); } }
    if (sk === 'ghost') { const by = (k * 2) % (GH + 8) - 4; ctx.fillStyle = 'rgba(190,255,255,.22)'; ctx.fillRect(0, by * sc, s.cv.width, 2 * sc); }
  }
  function Spr(cfgO, scale) {
    const cv = document.createElement('canvas'); cv.className = 'twr-cv'; cv.width = GW * scale; cv.height = GH * scale;
    const s = { cv, ctx: cv.getContext('2d'), scale, cfg: cfgO, pose: 'idle', t0: tickN, over: {}, rev: null, dirty: true, skip: null, accent: '#00ff9c', palSet: null };
    s.refresh = () => { s.accent = accentOf(s.cfg); s.palSet = mkPal(s.cfg.skin, s.accent); cv.style.filter = `drop-shadow(0 0 ${scale}px ${s.accent})`; };
    s.draw = () => { const k = tickN - s.t0; const f = POSES[s.pose] || POSES.idle; paintGrid(s, compose(f(k), s, k), tickN); };
    s.set = (p) => { if (s.pose !== p) { s.pose = p; s.t0 = tickN; } s.dirty = true; try { s.draw(); } catch {} };
    s.setCfg = (c) => { s.cfg = c; s.refresh(); s.dirty = true; try { s.draw(); } catch {} };
    s.tick = () => { if (s.skip && s.skip()) return; if (reduced() && !s.dirty && !s.rev) return; s.draw(); s.dirty = false; };
    s.refresh(); try { s.draw(); } catch {}
    SPRS.add(s); ensureTicker();
    return s;
  }
  function mkPix(provider, scale, animated) {
    const g0 = provider(0), w = Math.max(...g0.map((r) => r.length)), h = g0.length;
    const cv = document.createElement('canvas'); cv.width = w * scale; cv.height = h * scale; cv.className = 'twr-cv';
    const ctx = cv.getContext('2d'); const s = { cv, ctx, scale, w, h };
    const draw = (k) => {
      const g = provider(k); ctx.clearRect(0, 0, cv.width, cv.height);
      for (let y = 0; y < g.length; y++) for (let x = 0; x < g[y].length; x++) { const ch = g[y][x]; if (ch === '.' || ch === ' ') continue; ctx.fillStyle = PIX[ch] || '#fff'; ctx.fillRect(x * scale, y * scale, scale, scale); }
    };
    s.tick = (n) => { if (animated && !reduced()) draw(n); };
    draw(0);
    if (animated) { SPRS.add(s); ensureTicker(); }
    return s;
  }

  // ---------- DOM ----------
  let layer, ui, pos, tv, slide, flip, bubble, spr;
  function build() {
    if (layer) return true;
    if (!document.body) return false;
    layer = document.createElement('div'); layer.id = 'twr-layer';
    pos = document.createElement('div'); pos.className = 'twr-pos';
    tv = document.createElement('div'); tv.className = 'twr-trav';
    slide = document.createElement('div'); slide.className = 'twr-slide';
    flip = document.createElement('div'); flip.className = 'twr-flip';
    spr = Spr(CFG, SC); spr.skip = () => pos.style.display === 'none' && !S.always; spr.keep = true;
    flip.appendChild(spr.cv); slide.appendChild(flip); tv.appendChild(slide); pos.appendChild(tv); layer.appendChild(pos);
    ui = document.createElement('div'); ui.id = 'twr-ui';
    bubble = document.createElement('div'); bubble.className = 'twr-bubble'; ui.appendChild(bubble);
    document.body.append(layer, ui);
    // hovering the bubble pauses its timeout (and the rabbit's exit); clicking it dismisses it early
    bubble.addEventListener('pointerenter', () => { clearTimeout(S.bubT); clearTimeout(S.hideT); S.bubHover = true; });
    bubble.addEventListener('pointerleave', () => { S.bubHover = false; if (!bubble.classList.contains('on')) return; clearTimeout(S.bubT); S.bubT = setTimeout(() => bubble.classList.remove('on'), S.bubHold || 1500); if (S.busy) stayThenHide((S.bubHold || 1500) + 600); });
    bubble.addEventListener('click', (e) => { e.stopPropagation(); clearTimeout(S.bubT); clearTimeout(S.bubQ); bubble.classList.remove('on'); S.bubHover = false; if (S.busy) stayThenHide(400); });
    spr.cv.addEventListener('click', (e) => { e.stopPropagation(); pet(); });
    spr.cv.addEventListener('contextmenu', (e) => { e.stopPropagation(); menu(e); });
    return true;
  }

  // ---------- state, timers ----------
  const S = { tok: 0, busy: false, timers: [], undo: [], head: { x: innerWidth - 80, y: innerHeight - 90, nx: 0, ny: -1 }, last: {}, mat: false, forceScenes: null };
  const later = (ms, fn) => { const t = S.tok; const id = setTimeout(() => { if (t === S.tok) { try { fn(); } catch (e) { console.warn('twr', e); } } }, ms); S.timers.push(id); return id; };
  function runUndo() { for (const f of S.undo.splice(0)) { try { f(); } catch {} } }
  function cancel(fast) {
    S.tok++; S.timers.forEach(clearTimeout); S.timers = []; clearTimeout(S.hideT); clearInterval(S.typeT); clearTimeout(S.bubT); runUndo();
    if (pos) {
      clearTimeout(S.hideFin); spr.rev = null; spr.over = {};
      if (fast) { pos.style.display = 'none'; layer.style.clipPath = ''; tv.style.transform = ''; setAway(false); }
    }
    HM.tr++; rmTrail(false); rmVeh();
    bubble && bubble.classList.remove('on');
    S.busy = false;
  }
  const setPose = (p) => { if (pos) { pos.dataset.pose = p; spr.set(p); } };

  // ---------- materialise / dissolve ----------
  function reveal(mode, ms, cb) {
    if (!spr) { cb && cb(); return; }
    if (reduced() || isLite()) { spr.rev = null; cb && cb(); return; }
    const tok = S.tok, T0 = performance.now(); spr.rev = { mode, p: mode === 'in' ? 0 : 0 };
    const f = (n) => {
      if (S.tok !== tok) return;
      const p = Math.min(1, (n - T0) / ms); spr.rev = { mode, p: mode === 'in' ? p * 1.08 : p * 1.08 }; spr.dirty = true; spr.draw();
      if (p < 1) requestAnimationFrame(f); else { spr.rev = null; spr.draw(); cb && cb(); }
    };
    requestAnimationFrame(f);
  }
  function glyphBurst(r, ms, dens) {
    if (reduced() || isLite() || !ui) return;
    try {
      const w = Math.max(20, Math.ceil(r.width) + 16), h = Math.max(20, Math.ceil(r.height) + 40);
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.className = 'twr-glyphs';
      cv.style.left = `${r.left - 8}px`; cv.style.top = `${r.top - 20}px`; ui.appendChild(cv);
      const g = cv.getContext('2d'); g.font = 'bold 11px monospace';
      const cols = Math.floor(w / 9), ys = Array.from({ length: cols }, () => rnd(-h * 0.6, h * 0.2)), sp = Array.from({ length: cols }, () => rnd(2.5, 6.5));
      const T0 = performance.now(), tok = S.tok;
      const f = (n) => {
        const t = n - T0; if (t > ms || !cv.isConnected) { cv.remove(); return; }
        g.globalCompositeOperation = 'destination-out'; g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(0, 0, w, h); g.globalCompositeOperation = 'source-over';
        for (let i = 0; i < cols; i++) {
          if (Math.random() > (dens || 0.8)) continue;
          ys[i] += sp[i]; const ch = GLY[rint(0, GLY.length - 1)];
          g.fillStyle = '#c8ffd8'; g.fillText(ch, i * 9, ys[i]); g.fillStyle = '#00ff8c'; g.fillText(GLY[rint(0, GLY.length - 1)], i * 9, ys[i] - 12);
        }
        requestAnimationFrame(f);
      };
      requestAnimationFrame(f); void tok;
    } catch {}
  }

  // ---------- showing / hiding ----------
  // Edge-peek (popBehind): spec { rect, side, along, f, pose, z, clip, keepHidden }
  function show(spec) {
    build(); S.mat = false;
    const R = spec.rect, f = spec.f ?? 0.62, side = spec.side || 'top';
    const [nx, ny, rot] = { top: [0, -1, 0], right: [1, 0, 90], left: [-1, 0, -90], bottom: [0, 1, 180] }[side];
    const ex = side === 'top' || side === 'bottom' ? spec.along : (side === 'left' ? R.left : R.right);
    const ey = side === 'left' || side === 'right' ? spec.along : (side === 'top' ? R.top : R.bottom);
    const off = f * H - H / 2, cx = ex + nx * off, cy = ey + ny * off;
    clearTimeout(S.hideFin);
    pos.style.display = 'block'; flip.classList.remove('flip');
    pos.style.transform = `translate(${cx - W / 2}px,${cy - H / 2}px) rotate(${rot}deg)`;
    layer.style.zIndex = spec.z ?? 40;
    if (spec.clip) {
      const e2 = { left: R.left, top: R.top, right: R.right, bottom: R.bottom };
      if (side === 'top') e2.bottom += H; else if (side === 'bottom') e2.top -= H; else if (side === 'left') e2.right += H; else e2.left -= H;
      layer.style.clipPath = `path(evenodd,"M0 0H${innerWidth}V${innerHeight}H0Z M${e2.left} ${e2.top}H${e2.right}V${e2.bottom}H${e2.left}Z")`;
    } else layer.style.clipPath = '';
    const hid = `translateY(${f * H + 8}px)`;
    slide.style.transition = 'none'; slide.style.transform = hid; void slide.offsetWidth;
    S.hidTransform = hid; S.head = { x: ex + nx * f * H, y: ey + ny * f * H, nx, ny };
    tv.style.transform = '';
    if (homeOn() && !reduced()) { setAway(true); departFx(S.head.x, S.head.y); }
    if (spec.keepHidden) { slide.style.transition = ''; setPose(spec.pose || 'peek'); return; }
    slide.style.transition = ''; slide.style.transform = 'none'; setPose(spec.pose || 'peek');
  }
  const emerge = () => { slide.style.transform = 'none'; };
  // Standing spot (feet at x,y): materialises out of glyphs
  function stand(x, y, o) {
    o = o || {}; build(); clearTimeout(S.hideFin);
    const wasOut = pos.style.display === 'block' && S.mat && S.at ? { x: S.at.x, y: S.at.y } : null;
    S.mat = true;
    x = clamp(x, W / 2 + 4, innerWidth - W / 2 - 4); y = clamp(y, H - 6, innerHeight - 2);
    pos.style.display = 'block'; slide.style.transition = 'none'; slide.style.transform = 'none';
    pos.style.transform = `translate(${x - W / 2}px,${y - H + SC}px)`;
    flip.classList.toggle('flip', !!o.flip); layer.style.zIndex = o.z || 60; layer.style.clipPath = '';
    S.head = { x, y: y - H + OY * SC + 2, nx: 0, ny: -1 }; S.at = { x, y };
    setPose(o.pose || 'idle');
    if (o.travel !== false && !reduced() && (wasOut || homeOn())) { travelOut(x, y, o, wasOut); return; }
    tv.style.transform = ''; if (homeOn()) setAway(true);
    if (o.mat !== false) { reveal('in', 650); if (!isLite()) glyphBurst({ left: x - W / 2, top: y - H, width: W, height: H }, 650, 0.9); }
  }
  function moveTo(x, y, fl) {
    if (!pos) return; x = clamp(x, W / 2, innerWidth - W / 2);
    pos.style.transform = `translate(${x - W / 2}px,${y - H + SC}px)`; if (fl != null) flip.classList.toggle('flip', !!fl);
    S.head = { x, y: y - H + OY * SC + 2, nx: 0, ny: -1 }; S.at = { x, y }; updTrail(null, x, y - 30);
  }
  function hide() {
    if (!pos || pos.style.display === 'none') { S.busy = false; runUndo(); return; }
    bubble.classList.remove('on'); clearInterval(S.typeT);
    runUndo();
    const t = S.tok;
    const fin = () => { if (t !== S.tok) return; pos.style.display = 'none'; layer.style.clipPath = ''; tv.style.transform = ''; pos.classList.remove('giggle'); spr.over = {}; spr.rev = null; rmTrail(true); setAway(false); S.busy = false; };
    if (S.mat && S.at && homeOn() && !reduced()) { travelHome(fin); return; }
    if (S.mat) { if (S.at && !isLite()) glyphBurst({ left: S.at.x - W / 2, top: S.at.y - H, width: W, height: H }, 600, 0.7); reveal('out', 600, fin); }
    else { slide.style.transform = S.hidTransform || 'translateY(90px)'; S.hideFin = setTimeout(fin, 520); }
  }
  // the rabbit never leaves while his speech bubble is still up (or the pointer is on it)
  const stayThenHide = (ms) => { clearTimeout(S.hideT); const fire = () => { try { if (S.busy && bubble && bubble.classList.contains('on') && (S.bubHover || Date.now() - (S.bubAt || 0) < 16000)) { S.hideT = setTimeout(fire, 500); return; } hide(); } catch {} }; S.hideT = setTimeout(fire, ms); };

  // ---------- speech (matrix typewriter bubble), particles ----------
  function putBubble(text, ms, ax, ay, nx, ny) {
    if (!ui) build();
    clearInterval(S.typeT); clearTimeout(S.bubT);
    bubble.classList.remove('on', 'below'); bubble.dataset.nm = `${CFG.name || 'twr'}>`;
    bubble.style.width = ''; bubble.style.height = ''; bubble.textContent = text;
    const bw = bubble.offsetWidth, bh = bubble.offsetHeight;
    bubble.style.width = `${bw}px`; bubble.style.height = `${bh}px`;
    let l, t;
    if (ny > 0) { bubble.classList.add('below'); l = ax - bw / 2; t = ay + 8; }
    else if (ny < 0) { l = ax - bw / 2; t = ay - bh - 10; }
    else { l = nx < 0 ? ax - bw - 10 : ax + 10; t = ay - bh / 2; if (nx < 0) l = Math.max(6, l); }
    const Lx = Math.max(6, Math.min(l, innerWidth - bw - 6)), T = Math.max(6, Math.min(t, innerHeight - bh - 6));
    bubble.style.left = `${Lx}px`; bubble.style.top = `${T}px`;
    bubble.style.setProperty('--tail', `${Math.max(14, Math.min(bw - 14, ax - Lx))}px`);
    bubble.textContent = ''; void bubble.offsetWidth; bubble.classList.add('on');
    let i = 0; const n = text.length, tick = n > 40 ? Math.max(8, Math.round(1100 / n)) : 22;
    const step = () => { i += reduced() ? n : 1; bubble.textContent = text.slice(0, i); if (i >= n) clearInterval(S.typeT); };
    step(); if (n > 1) S.typeT = setInterval(step, tick);
    S.bubAt = Date.now(); S.bubMin = Math.min(4500, ms || 4500); S.bubMs = (ms || 4500) + n * tick; S.bubHold = Math.max(1500, Math.min(4000, ms || 0));
    S.bubT = setTimeout(() => bubble.classList.remove('on'), S.bubMs);
  }
  // how long a message stays: long enough to read (about 70 ms a character), never under 4.5 s, never over 14 s
  const bubbleMs = (text, ms) => Math.min(14000, Math.max(4500, 1800 + 70 * String(text).length, ms ? ms * 2 : 0));
  function bubbleText(text, ms) {
    const h = S.head; ms = bubbleMs(text, ms); const tick = text.length > 40 ? Math.max(8, Math.round(1100 / text.length)) : 22;
    // a new message never cuts off the one on screen before that one has had its minimum time
    const wait = bubble && bubble.classList.contains('on') ? Math.max(0, (S.bubAt || 0) + (S.bubMin || 0) - Date.now()) : 0;
    if (wait > 80) { const t = S.tok; clearTimeout(S.bubQ); S.bubQ = setTimeout(() => { if (t === S.tok) putBubble(text, ms, h.x, h.y, h.nx, h.ny); }, wait); return wait + ms + text.length * tick; }
    putBubble(text, ms, h.x, h.y, h.nx, h.ny); return ms + text.length * tick;
  }
  function particle(kind, ch, x, y) {
    if (!ui || reduced()) return;
    const p = document.createElement('div'); p.className = `twr-p ${kind}`; p.textContent = ch;
    p.style.left = `${x}px`; p.style.top = `${y}px`; p.style.setProperty('--dx', `${rnd(-16, 16)}px`);
    ui.appendChild(p); setTimeout(() => p.remove(), 1300);
  }
  const burst = (kind, ch, n) => { const h = S.head; for (let i = 0; i < n; i++) later(i * 90, () => particle(kind, Array.isArray(ch) ? pick(ch) : ch, h.x + rnd(-24, 24), h.y + rnd(0, 40))); };

  // ---------- say / react / pet ----------
  const corner = () => {
    if (homeOn()) { const b = homeBox(), lf = CFG.homeCorner[1] === 'l'; return { x: clamp(lf ? b.right + 48 + rnd(0, 60) : b.left - 48 - rnd(0, 60), W / 2 + 4, innerWidth - W / 2 - 4), y: clamp(b.bottom - 2, H, innerHeight - 2) }; }
    return { x: innerWidth - 100 + rnd(-40, 10), y: innerHeight - 14 };
  };
  function say(text, ms) {
    try {
      if (!awake() || !text || !build()) return false;
      if (reduced()) { const b = homeBox(); S.head = homeOn() ? { x: (b.left + b.right) / 2, y: b.top - 4, nx: 0, ny: CFG.homeCorner[0] === 't' ? 1 : -1 } : { x: innerWidth - 100, y: innerHeight - 60, nx: 0, ny: -1 }; if (S.head.ny > 0) S.head.y = b.bottom + 4; putBubble(text, ms, S.head.x, S.head.y, 0, S.head.ny); return true; }
      if (S.busy && pos.style.display !== 'none') { const d = bubbleText(text, ms); stayThenHide(d + 700); return true; }
      cancel(); S.busy = true;
      const c = corner(); stand(c.x, c.y, { pose: 'sit' });
      later(450, () => { const d = bubbleText(text, ms); stayThenHide(d + 600); });
      return true;
    } catch (e) { console.warn('twr.say', e); return false; }
  }
  const REACT = {
    saved: { pose: 'dance', fx: ['spark', ['✦', '1', '0'], 8], hold: 2200, xp: 5, coins: 2 }, deleted: { pose: 'shrug', hold: 2000, xp: 3, coins: 1 },
    error: { pose: 'facepalm', hold: 2400, xp: 3, coins: 1 }, welcome: { pose: 'wave', hold: 2600, xp: 2, coins: 1 },
    unlock: { pose: 'wave', hold: 2200, xp: 3, coins: 1 }, locked: { pose: 'sit', hold: 2200, xp: 3, coins: 1 },
    copied: { pose: 'nibble', hold: 2000, xp: 2, coins: 1 }, moved: { pose: 'push', hold: 1800, xp: 3, coins: 1 },
  };
  function react(name) {
    try {
      const r = REACT[name];
      if (!r || !awake() || !build()) return false;
      const now = Date.now(); if (now - (S.last[name] || 0) < 2500) return false; S.last[name] = now;
      if (name === 'saved') { stat('saves'); memSaved(); }
      addXp(r.xp); addCoins(r.coins);
      const text = L(name);
      if (reduced()) return say(text, 2200);
      cancel(); S.busy = true;
      const c = corner(); stand(c.x, c.y, { pose: r.pose });
      later(500, () => { bubbleText(text, r.hold); if (r.fx) burst(r.fx[0], r.fx[1], r.fx[2]); });
      stayThenHide(r.hold + 900);
      return true;
    } catch (e) { console.warn('twr.react', e); return false; }
  }
  function pet() {
    try {
      if (!pos) return;
      pos.classList.remove('giggle'); void pos.offsetWidth; pos.classList.add('giggle');
      burst('heart', '♥', 4); bubbleText(L('pet'), 2000);
      stat('pets'); const now = Date.now(); if (now - (S.petCoin || 0) > 3000) { S.petCoin = now; addCoins(1); addXp(2); }
      if (S.busy) stayThenHide(3200);
    } catch {}
  }
  function menu(e) {
    if (typeof window.hsMenu !== 'function') { e.preventDefault(); return; }
    window.hsMenu(e, [
      { label: 'Say something', run: () => { bubbleText(L('idle'), 2800); stayThenHide(3600); } },
      { label: 'Do a trick', run: () => { if (!randomAct(true)) bubbleText('Out of tricks. Try again.', 2000); } },
      { label: CFG.home ? 'Hide home' : 'Show home', run: () => setCfg({ home: !CFG.home }) },
      { label: 'Go away for an hour', run: () => { lsSet('hs-twr-until', String(Date.now() + 3600e3)); cancel(); hide(); } },
      '-',
      { label: 'Turn off the rabbit', run: () => api.enable(false) },
    ], 'THE WHITE RABBIT');
  }

  // ---------- DOM helpers (safe, transform-only) ----------
  const inVJ = () => { try { return !!(window.HS && HS.inVJ && HS.inVJ()); } catch { return false; } };
  // VJ is a section of CRATE now: while it is showing, the "tab" is 'vj' (antics, quips, tips); the library is 'crate'
  const curTab = () => { if (inVJ()) return 'vj'; const v = document.querySelector('.view.active'); if (v && v.id) return v.id.replace(/^view-/, ''); const n = document.querySelector('.nav.active'); return (n && n.dataset && n.dataset.view) || ''; };
  // true only while the VJ is filling the screen (the burrow and rabbit stay out of its way); the plain VJ section is fair game
  const vjFill = () => { try { const b = document.body; if (!b || !b.classList.contains('vj-mode')) return false; const v = document.getElementById('view-crate'); return !inVJ() || !!(v && v.classList.contains('vj-full')); } catch { return false; } };
  const vis = (el, mw = 6, mh = 6) => { if (!el || !el.isConnected) return null; const r = el.getBoundingClientRect(); if (r.width < mw || r.height < mh || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return null; return r; };
  const $$ = (sel, mw, mh) => { let a = []; try { a = [...document.querySelectorAll(sel.split(',').map((s) => `.view.active ${s.trim()}`).join(','))]; } catch {} return a.filter((e) => vis(e, mw, mh) && !e.closest('#twr-layer')); };
  const $1 = (sel, mw, mh) => { const a = $$(sel, mw, mh); return a.length ? pick(a) : null; };
  function quiet() { const a = document.activeElement; return !(a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)); }
  function tw(el, props, ms, easing) {
    if (!el || !el.isConnected) return;
    if (!el._twr) { el._twr = { saved: {}, trans: el.style.transition }; S.undo.push(() => restoreEl(el)); }
    const st = el._twr;
    for (const k of Object.keys(props)) if (!(k in st.saved)) st.saved[k] = el.style.getPropertyValue(k);
    el.style.transition = Object.keys(st.saved).map((k) => `${k} ${ms || 250}ms ${easing || 'cubic-bezier(.34,1.56,.64,1)'}`).join(',');
    for (const k of Object.keys(props)) el.style.setProperty(k, props[k]);
  }
  function restoreEl(el) {
    const st = el._twr; if (!st) return;
    for (const k of Object.keys(st.saved)) el.style.setProperty(k, st.saved[k]);
    delete el._twr; setTimeout(() => { try { if (!el._twr) el.style.transition = st.trans; } catch {} }, 450);
  }
  function overlay(cls, r, html) { const d = document.createElement('div'); d.className = cls; if (r) { d.style.left = `${r.left}px`; d.style.top = `${r.top}px`; d.style.width = `${r.width}px`; d.style.height = `${r.height}px`; } if (html) d.textContent = html; ui.appendChild(d); S.undo.push(() => d.remove()); return d; }
  function propAt(name, x, y, sc) { const cv = mkPix(() => SMALL[name], sc || 3, false).cv; cv.classList.add('twr-prop'); cv.style.transform = `translate(${x}px,${y}px)`; ui.appendChild(cv); S.undo.push(() => cv.remove()); return cv; }
  const at = (cv, x, y, rot, sc) => { cv.style.transform = `translate(${x}px,${y}px) rotate(${rot || 0}deg) scale(${sc == null ? 1 : sc})`; };
  function rprop(name, gx, gy, sc) { const cv = mkPix(() => SMALL[name], sc || SC, false).cv; cv.classList.add('twr-rprop'); cv.style.left = `${(gx + OX) * SC}px`; cv.style.top = `${(gy + OY) * SC}px`; flip.appendChild(cv); S.undo.push(() => cv.remove()); return cv; }
  function timeline(tok, total, steps, onEnd) {
    const T0 = performance.now();
    const f = (now) => {
      if (S.tok !== tok) return; const t = now - T0;
      for (const s of steps) { if (t >= s.a && !s.done) { const p = s.d ? Math.min(1, (t - s.a) / s.d) : 1; try { s.fn(p, t); } catch {} if (p >= 1) s.done = true; } }
      if (t < total) requestAnimationFrame(f); else onEnd && onEnd();
    };
    requestAnimationFrame(f);
  }
  function telemetry() {
    const t = (id) => { const e = document.getElementById(id); return e ? (e.textContent || '').replace(/\s+/g, ' ').trim() : ''; };
    const temps = t('sb-temps'), m = temps.match(/(\d{2,3})\s*°/);
    return { temps, hot: m ? +m[1] : 0, machine: t('sb-machine'), msg: t('sb-msg'), batt: t('sb-batt'), up: t('sb-uptime') };
  }
  // where the rabbit stands relative to an element (feet y). side 'beside' or 'above'
  function beside(r) { const left = r.left > 120; const x = left ? r.left - 34 : r.right + 34; return { x, y: clamp(r.bottom, H, innerHeight - 4), flip: !left }; }
  function above(r) { return { x: clamp(r.left + r.width / 2 + rnd(-30, 30), 60, innerWidth - 60), y: r.top > H + 50 ? r.top + 4 : clamp(r.bottom + H - 10, H, innerHeight - 4) }; }

  // ---------- antics ----------
  const ANTICS = {};
  const A = (name, tab, lvl, fn) => { ANTICS[name] = { tab, lvl, fn }; };
  const START = (spot, pose, o) => stand(spot.x, spot.y, Object.assign({ pose, flip: spot.flip }, o || {}));
  const SIGNS = { nexus: 'ALL SYSTEMS GO', afterburner: 'MORE FANS', vj: 'DROP IT', crate: 'NEXT TRACK?', deck: 'MORE BASS?', router: 'FILE ME', senses: 'I SEE NOTHING', notes: 'DEAR DIARY', todo: 'ONE TASK AT A TIME', hardware: 'TURN IT OFF/ON', experts: 'EXPERT APPROVED', settings: 'DO NOT TOUCH', '*': 'HELLO WORLD' };
  // generic
  A('sleep', '*', 1, () => { const c = corner(); START(c, 'sleep'); later(900, () => bubbleText('zzz...', 2600)); later(4300, () => { setPose('shrug'); bubbleText('Huh? I was just resting my eyes.', 2200); }); return 7200; });
  A('carrot', '*', 1, () => { const c = corner(); START(c, 'carrot'); later(700, () => bubbleText(pick(['Nom nom nom.', 'Carrot break. Back in a minute.', 'Snack time: one carrot.']), 2200)); return 4800; });
  A('type', '*', 1, () => { const c = corner(); START(c, 'type'); stat('hacks'); later(700, () => bubbleText(pick(['Typing up some notes.', 'Compiling... please hold.', 'Running a quick script.', 'Typing very important things.']), 2600)); later(3600, () => burst('spark', ['1', '0', '<', '>'], 6)); return 5400; });
  A('sign', '*', 1, () => { const c = corner(); const tab = curTab(); START(c, 'sign'); later(700, () => bubbleText(SIGNS[tab] || SIGNS['*'], 2800)); return 4800; });
  A('dance', '*', 1, () => { const c = corner(); START(c, 'dance'); burst('spark', ['♪', '♫'], 6); later(800, () => bubbleText(pick(['Happy dance time!', 'Dancing because things are going well.', 'Just a little dance.']), 2000)); return 4400; });
  A('glitch-hop', '*', 2, () => {
    let n = 0; const hop = () => { const x = rnd(120, innerWidth - 120), y = rnd(H + 60, innerHeight - 10); stand(x, y, { pose: pick(['wave', 'sit', 'dance']) }); n++; if (n < 4) later(1300, () => { reveal('out', 400); later(450, hop); }); };
    hop(); later(600, () => bubbleText(pick(['Hopping around the screen. Ignore me.', 'Just stretching my legs.']), 1800)); return 6200;
  });
  A('gossip', '*', 1, () => {
    const t = telemetry(); let line = null;
    if (t.hot >= 80) line = `${t.hot}°C?! Somebody open a window.`;
    else if (t.temps) line = `Psst. Status bar says: ${t.temps.slice(0, 44)}.`;
    else if (t.batt) line = `Battery says ${t.batt.slice(0, 20)}. Just saying.`;
    else if (t.up) line = `${t.up.slice(0, 30)}. Impressive. Or worrying.`;
    if (!line) return false;
    const c = corner(); START(c, 'wave'); stat('hacks'); later(700, () => bubbleText(line, 3200)); return 5200;
  });
  // OPERATIONS
  A('poke-gauges', 'nexus', 1, () => {
    const el = $1('canvas, svg, [class*=gauge], [class*=ring], .panel', 40, 40); if (!el) return false;
    const r = el.getBoundingClientRect(); START(beside(r), 'push');
    later(1100, () => { tw(el, { scale: '1.04' }, 140); later(160, () => tw(el, { scale: '1' }, 220)); setPose('wave'); bubbleText(pick(['Poking the gauge. Still working.', 'Checking the needle. All good.']), 2000); });
    return 3800;
  });
  A('wipe-screen', 'nexus', 1, () => {
    const el = $1('.panel', 120, 60); if (!el) return false;
    const r = el.getBoundingClientRect(); const x0 = r.left + 40, x1 = r.right - 40, y = clamp(r.bottom, H, innerHeight - 4);
    START({ x: x0, y, flip: false }, 'push', { z: 60 });
    const wipe = overlay('twr-wipe', { left: r.left, top: r.top, width: 36, height: r.height }); wipe.style.opacity = '0';
    timeline(S.tok, 2600, [{ a: 400, d: 2000, fn: (p) => { const x = lerp(x0, x1, ease(p)); moveTo(x, y, false); wipe.style.opacity = '1'; wipe.style.transform = `translateX(${x - 18 - r.left}px)`; } }, { a: 2500, d: 0, fn: () => { wipe.style.opacity = '0'; setPose('wave'); bubbleText('All wiped clean.', 1600); } }]);
    return 4600;
  });
  // FANS
  A('blow-fan', 'afterburner', 1, () => {
    const el = $1('[class*=fan] svg, [class*=fan] canvas, svg, canvas', 24, 24); if (!el) return false;
    const r = el.getBoundingClientRect(); START(beside(r), 'push');
    later(900, () => { tw(el, { rotate: '1080deg' }, 1700, 'cubic-bezier(.1,.7,.2,1)'); setPose('wave'); for (let i = 0; i < 6; i++) later(i * 180, () => particle('spark', '~~', S.head.x + 40, S.head.y + 40 + rnd(-10, 10))); });
    later(2800, () => bubbleText('Extra airflow, just for you.', 2000));
    return 4600;
  });
  A('parka', 'afterburner', 1, () => {
    const t = telemetry(); const c = corner(); START(c, 'sit'); spr.over = { acc: t.hot >= 70 ? 'parka' : null };
    later(700, () => bubbleText(t.hot >= 70 ? `${t.hot}°C in here. Hot! Parka on, fans up.` : 'Temperatures are fine. No parka needed.', 3000)); return 4800;
  });
  A('fan-flex', 'afterburner', 2, () => {
    const el = $1('input[type=range], .panel', 60, 10); if (!el) return false;
    const r = el.getBoundingClientRect(); START(above(r), 'shrug');
    later(900, () => { setPose('dance'); burst('spark', ['~'], 5); bubbleText('Dance fan dance!', 1800); }); return 3800;
  });
  // VJ
  A('beat-dance', 'vj', 1, () => { const c = corner(); START(c, 'dance'); spr.over = { hat: 'phones' }; burst('spark', ['♪', '♫'], 10); later(700, () => bubbleText('Feel that beat.', 1800)); return 5200; });
  A('dj-headset', 'vj', 1, () => { const c = corner(); START(c, 'bob'); spr.over = { hat: 'phones', glasses: 'shades' }; later(700, () => bubbleText('Headset on. Bass up.', 2000)); burst('spark', ['♪'], 6); return 5000; });
  A('laser-show', 'vj', 2, () => {
    const c = corner(); START(c, 'dance'); const cols = ['#ff3d6e', '#46f0ff', '#00ff9c', '#ffd54a']; const ls = [];
    for (let i = 0; i < 4; i++) { const d = overlay('twr-laser'); d.style.background = cols[i]; d.style.boxShadow = `0 0 8px ${cols[i]}`; ls.push(d); }
    timeline(S.tok, 3600, [{ a: 400, d: 3000, fn: (p) => ls.forEach((d, i) => { const ang = -140 + 100 * Math.sin(p * 9 + i * 1.3) + i * 12; d.style.transform = `translate(${S.head.x}px,${S.head.y + 70}px) rotate(${ang}deg)`; d.style.opacity = p < 0.97 ? '1' : '0'; }) }]);
    later(900, () => bubbleText('Laser time!', 1600)); return 4800;
  });
  // CRATE
  A('flip-records', 'crate', 1, () => {
    let items = $$('.card, [class*=crate] > *, li, .row, tr, img', 30, 20); if (items.length < 3) return false;
    const i0 = rint(0, Math.max(0, items.length - 4)); items = items.slice(i0, i0 + 4);
    const r = items[0].getBoundingClientRect(); START(above(r), 'push');
    items.forEach((el, i) => { later(900 + i * 420, () => { tw(el, { translate: '0 -9px', rotate: '-3deg' }, 200); later(380, () => tw(el, { translate: '0 0', rotate: '0deg' }, 260)); }); });
    later(900, () => bubbleText(pick(['Digging through the crate for good tracks.', 'Looking for the right track...']), 2000)); later(3000, () => { setPose('dance'); bubbleText('Found a good one!', 1600); }); return 5000;
  });
  A('toss-records', 'crate', 1, () => {
    const el = $1('.card, li, .row, img', 30, 20); const c = el ? above(el.getBoundingClientRect()) : corner(); START(c, 'heave');
    for (let i = 0; i < 3; i++) later(800 + i * 500, () => { const f = propAt('file', S.head.x - 10, S.head.y + 30, 2); const sx = S.head.x, sy = S.head.y + 30, dir = i % 2 ? 1 : -1; timeline(S.tok, 900, [{ a: 0, d: 800, fn: (p) => { at(f, sx + dir * 90 * p, sy - 60 * Math.sin(p * Math.PI) + 40 * p * p, p * 360 * dir); f.style.opacity = String(1 - p * p); } }]); });
    later(900, () => bubbleText(pick(['Skipping the tracks I do not need.', 'Not for this set. Tossing it out.']), 2200)); return 4600;
  });
  A('crate-cue', 'crate', 2, () => { const c = corner(); START(c, 'sign'); later(700, () => bubbleText('NEXT TRACK? Please say yes.', 2400)); spr.over = { hat: 'phones' }; return 4600; });
  // DECK
  A('fader-nudge', 'deck', 1, () => {
    const el = $1('input[type=range]', 30, 4); if (!el) return false;
    const r = el.getBoundingClientRect(); START(above(r), 'push');
    later(1000, () => { tw(el, { translate: '1px 0' }, 150); later(260, () => tw(el, { translate: '0 0' }, 180)); bubbleText(pick(['Nudging the volume a tiny bit.', 'Fine-tuning the volume knob.']), 2200); });
    return 3800;
  });
  A('tiny-knob', 'deck', 1, () => {
    const c = corner(); START(c, 'wave'); const k = propAt('knob', c.x - 60, c.y - 70, 4); k.style.transformOrigin = '50% 50%'; let a = 0;
    timeline(S.tok, 3400, [{ a: 400, d: 2800, fn: (p) => { a = Math.sin(p * 8) * 140; at(k, c.x - 60, c.y - 70, a); } }]);
    later(700, () => bubbleText('Adjusting the little knob.', 2200)); return 4600;
  });
  A('deck-sign', 'deck', 2, () => { const c = corner(); START(c, 'sign'); later(600, () => bubbleText('MORE BASS?', 2200)); return 4200; });
  // FILE ROUTER
  A('carry-file', 'router', 1, () => {
    const boxes = $$('.panel', 80, 40); if (boxes.length < 2) return false;
    const a = boxes[0].getBoundingClientRect(), b = boxes[boxes.length - 1].getBoundingClientRect();
    const ya = clamp(a.top + a.height / 2 + 40, H, innerHeight - 6), yb = clamp(b.top + b.height / 2 + 40, H, innerHeight - 6);
    const xa = a.left + a.width / 2, xb = b.left + b.width / 2;
    START({ x: xa, y: ya }, 'run'); const f = rprop('file', 19, 16, 3);
    timeline(S.tok, 3600, [{ a: 700, d: 2400, fn: (p) => moveTo(lerp(xa, xb, ease(p)), lerp(ya, yb, ease(p)), xb < xa) }, { a: 3150, d: 0, fn: () => { setPose('wave'); f.remove(); bubbleText('File delivered to the right folder.', 1800); } }]);
    return 5400;
  });
  A('stamp-approved', 'router', 1, () => {
    const el = $1('.panel', 80, 40); if (!el) return false;
    const r = el.getBoundingClientRect(); START(above(r), 'wave');
    const st = propAt('stamp', r.left + r.width / 2, r.top + 20, 4), ok = overlay('twr-stampmark', null, 'APPROVED'); ok.style.left = `${r.left + r.width / 2 - 20}px`; ok.style.top = `${r.top + r.height / 2}px`; ok.style.opacity = '0';
    timeline(S.tok, 3000, [{ a: 800, d: 400, fn: (p) => at(st, r.left + r.width / 2, r.top + 20 + 40 * ease(p)) }, { a: 1200, d: 0, fn: () => { ok.style.opacity = '1'; } }, { a: 1500, d: 500, fn: (p) => at(st, r.left + r.width / 2, r.top + 60 - 60 * ease(p)) }, { a: 2600, d: 0, fn: () => { ok.style.opacity = '0'; } }]);
    later(700, () => bubbleText('Stamp: approved. This panel looks good.', 2200)); return 4400;
  });
  A('mail-sort', 'router', 2, () => {
    const c = corner(); START(c, 'heave');
    for (let i = 0; i < 4; i++) later(700 + i * 400, () => { const f = propAt('file', S.head.x, S.head.y + 40, 2); const sx = S.head.x, sy = S.head.y + 40; timeline(S.tok, 800, [{ a: 0, d: 700, fn: (p) => { at(f, sx - 150 * p, sy - 70 * Math.sin(p * Math.PI) + 60 * p, p * 300); } }]); });
    later(800, () => bubbleText('Sorting your files into the right folders.', 2000)); return 4400;
  });
  // SENSES
  A('binoculars', 'senses', 1, () => {
    const el = $1('video, canvas, svg, img, .panel', 40, 40); if (!el) return false;
    const r = el.getBoundingClientRect(); START(above(r), 'idle'); const b = rprop('binoc', 13, 9, 3);
    later(900, () => bubbleText(pick(['Checking your camera and mic.', 'Looking over the privacy switches.']), 2200)); later(3200, () => { b.remove(); setPose('shrug'); });
    return 4600;
  });
  A('mic-check', 'senses', 1, () => {
    const c = corner(); START(c, 'wave'); const m = propAt('mic', c.x - 70, c.y - 60, 4);
    later(500, () => bubbleText('Mic check: one, two.', 2000)); for (let i = 0; i < 5; i++) later(1200 + i * 250, () => particle('spark', ')))', c.x - 40, c.y - 60 + i * 3)); return 4000;
  });
  A('privacy-guard', 'senses', 1, () => { const c = corner(); START(c, 'facepalm'); later(600, () => bubbleText('Camera and mic are off. I am not peeking.', 2600)); return 4400; });
  // NOTES
  A('tiny-note', 'notes', 1, () => {
    const el = $1('.panel, textarea, div', 100, 40); const c = el ? above(el.getBoundingClientRect()) : corner(); START(c, 'sit');
    const p = propAt('sticky', c.x + 36, c.y - 42, 3); later(500, () => setPose('type'));
    later(800, () => bubbleText('Writing a tiny note... "buy carrots"', 2400)); later(3300, () => { setPose('wave'); p.remove(); }); return 5000;
  });
  A('cross-out', 'notes', 1, () => {
    const el = $1('p, li, h3, label, .panel-head', 80, 10); if (!el) return false;
    const r = el.getBoundingClientRect(); START(above(r), 'shrug');
    const strike = overlay('twr-strike', { left: r.left, top: r.top + r.height / 2, width: Math.min(r.width, 280), height: 2 });
    strike.style.transform = 'scaleX(0)'; later(900, () => { strike.style.transform = 'scaleX(1)'; bubbleText('One task crossed off the list.', 1800); }); later(3200, () => { strike.style.opacity = '0'; });
    return 4400;
  });
  A('leave-sticky', 'notes', 1, () => {
    const el = $1('.panel', 120, 60); if (!el) return false;
    const r = el.getBoundingClientRect(); START(above(r), 'heave');
    const x = r.right - 40, y = r.top + 14; const s = propAt('sticky', S.head.x, S.head.y + 40, 3); const sx = S.head.x, sy = S.head.y + 40;
    timeline(S.tok, 3600, [{ a: 800, d: 700, fn: (p) => at(s, lerp(sx, x, ease(p)), lerp(sy, y, ease(p)) - 40 * Math.sin(p * Math.PI), p * 20) }, { a: 1500, d: 1700, fn: (p) => at(s, x, y, 20 - 20 * Math.min(1, p * 4) + Math.sin(p * 20) * 3) }, { a: 3200, d: 0, fn: () => { s.style.opacity = '0'; } }]);
    later(800, () => bubbleText('Left a sticky note for you. Read it when ready.', 2400)); return 4800;
  });
  // TO-DO
  A('stamp-check', 'todo', 1, () => {
    const el = $1('input[type=checkbox], [class*=check], li, .todo-item', 8, 8); if (!el) return false;
    const r = el.getBoundingClientRect(); START(above(r), 'wave');
    const st = propAt('stamp', r.left, r.top - 50, 3), good = Math.random() < 0.65, mark = overlay('twr-stampmark' + (good ? ' ok' : ''), null, good ? 'APPROVED' : 'NOPE'); mark.style.left = `${r.left + 4}px`; mark.style.top = `${r.top - 6}px`; mark.style.opacity = '0'; mark.style.fontSize = '17px';
    timeline(S.tok, 5400, [{ a: 800, d: 400, fn: (p) => at(st, r.left, r.top - 50 + 38 * ease(p)) }, { a: 1200, d: 0, fn: () => { mark.style.opacity = '1'; } }, { a: 1500, d: 500, fn: (p) => at(st, r.left, r.top - 12 - 38 * ease(p)) }, { a: 4800, d: 0, fn: () => { mark.style.opacity = '0'; } }]);
    later(700, () => bubbleText((good ? 'Stamp: approved.' : 'This one needs a rewrite.'), 2200)); return 5200;
  });
  A('sweep-dust', 'todo', 1, () => {
    const el = $1('.panel, li', 120, 40) || document.querySelector('.view.active'); if (!el) return false;
    const r = el.getBoundingClientRect(); const x0 = r.left + 50, x1 = r.right - 50, y = clamp(r.bottom, H, innerHeight - 4);
    START({ x: x0, y }, 'push'); const b = rprop('broom', 21, 14, 3);
    timeline(S.tok, 3400, [{ a: 400, d: 2600, fn: (p) => { moveTo(lerp(x0, x1, p), y, false); if (Math.random() < 0.25) particle('spark', pick(['.', ':', '·']), S.head.x + 50, S.head.y + 90); } }, { a: 3100, d: 0, fn: () => { setPose('wave'); bubbleText('Swept the clutter away.', 1600); } }]);
    return 5000;
  });
  A('todo-sign', 'todo', 2, () => { const c = corner(); START(c, 'sign'); later(600, () => bubbleText('ONE TASK AT A TIME', 2400)); return 4400; });
  // HARDWARE
  A('usb-plug', 'hardware', 1, () => {
    const el = $1('.panel', 120, 60); const r = el ? el.getBoundingClientRect() : { left: innerWidth - 400, top: innerHeight - 200, right: innerWidth - 40, bottom: innerHeight - 80, width: 360, height: 120 };
    const sp = el ? beside(r) : corner(); START(sp, 'wave');
    const sx = clamp(sp.x + (sp.flip ? -150 : 150), 60, innerWidth - 60), sy = sp.y - 60;
    const sock = overlay('twr-socket'); sock.style.left = `${sx - 12}px`; sock.style.top = `${sy - 8}px`; const plug = propAt('usb', sx - 70, sy - 6, 3);
    timeline(S.tok, 3800, [{ a: 600, d: 3000, fn: (p) => { const q = Math.abs(Math.sin(p * Math.PI * 3)); at(plug, sx - 70 + 50 * q, sy - 6); } }]);
    later(700, () => bubbleText(pick(['USB tip: try plugging it in the other way around.', 'USB tip: if it fails, unplug it and try again.']), 2400)); return 5200;
  });
  A('inspect-chip', 'hardware', 1, () => {
    const el = $1('.panel', 120, 60); if (!el) return false;
    const r = el.getBoundingClientRect(); const x0 = r.left + 60, x1 = r.right - 60, y = clamp(r.top > H + 40 ? r.top + 4 : r.bottom + H - 10, H, innerHeight - 4);
    START({ x: x0, y }, 'idle'); rprop('binoc', 13, 9, 3);
    timeline(S.tok, 3200, [{ a: 500, d: 2400, fn: (p) => moveTo(lerp(x0, x1, p), y, false) }]);
    later(700, () => bubbleText('Inspecting the hardware. Looks fine.', 2200)); return 4600;
  });
  A('led-blink', 'hardware', 2, () => {
    const el = $1('.panel', 120, 60); const r = el ? el.getBoundingClientRect() : null; const c = r ? above(r) : corner(); START(c, 'sit');
    const cols = ['#00ff9c', '#ffd54a', '#ff3d6e']; const leds = cols.map((col, i) => { const d = overlay('twr-led'); d.style.background = col; d.style.color = col; d.style.left = `${c.x + 50 + i * 14}px`; d.style.top = `${c.y - 50}px`; return d; });
    timeline(S.tok, 3600, [{ a: 400, d: 3000, fn: (p, t) => leds.forEach((d, i) => { d.style.opacity = Math.sin(t / 120 + i * 2) > 0 ? '1' : '.2'; }) }]);
    later(700, () => bubbleText('Checking the status lights.', 2000)); return 4800;
  });
  // EXPERTS
  A('tip-hat', 'experts', 1, () => {
    const c = corner(); START(c, 'idle'); spr.over = { hat: 'tophat', hatLift: false };
    later(1100, () => { spr.over = { hat: 'tophat', hatLift: true }; spr.dirty = true; setPose('wave'); bubbleText('*tips hat* Experts, I salute you.', 2200); }); later(2600, () => { spr.over = { hat: 'tophat', hatLift: false }; spr.dirty = true; }); return 4600;
  });
  A('clipboard', 'experts', 1, () => { const c = corner(); START(c, 'sign'); later(600, () => bubbleText('EXPERTS: ASK AWAY', 2400)); return 4400; });
  A('bow', 'experts', 1, () => { const c = corner(); START(c, 'bob'); spr.over = { hat: 'tophat' }; later(800, () => bubbleText('Your expert will see you now.', 2200)); return 4400; });
  // SETTINGS
  A('flip-switch', 'settings', 1, () => {
    const el = $1('input[type=checkbox], .switch, [class*=toggle]', 10, 8);
    const c = el ? above(el.getBoundingClientRect()) : corner(); START(c, 'wave');
    const t = overlay('twr-toggle'); t.style.left = `${c.x + 50}px`; t.style.top = `${c.y - 56}px`;
    const flipT = (on) => { t.classList.toggle('on', on); if (el) tw(el, { translate: on ? '1px 0' : '0 0' }, 120); };
    later(700, () => flipT(true)); later(1500, () => flipT(false)); later(2300, () => flipT(true)); later(3000, () => flipT(false));
    later(800, () => bubbleText('Testing a switch, then flipping it back.', 2400)); return 4800;
  });
  A('lost-sliders', 'settings', 1, () => {
    const el = $1('input[type=range]', 60, 4); if (!el) return false;
    const r = el.getBoundingClientRect(); const y = clamp(r.bottom + 6 < H ? H : r.top, H, innerHeight - 4); const x0 = r.left + 20, x1 = r.right - 20;
    START({ x: x0, y }, 'run');
    timeline(S.tok, 3400, [{ a: 400, d: 2600, fn: (p) => moveTo(lerp(x0, x1, ease(Math.abs(Math.sin(p * Math.PI * 1.5)))), y, Math.cos(p * Math.PI * 1.5) < 0) }, { a: 3100, d: 0, fn: () => { setPose('shrug'); bubbleText('Looking for the right setting...', 2000); } }]);
    return 5200;
  });
  A('settings-sign', 'settings', 2, () => { const c = corner(); START(c, 'sign'); later(600, () => bubbleText('CAREFUL WITH SETTINGS', 2400)); return 4400; });

  // ROAMING (every tab): he strolls along the status bar or the top edge of a panel, stops for a word, and carries on
  const ROAM_LINES = ['Just patrolling.', 'Nothing to see here.', 'Checking the perimeter.', 'Do not mind me.', 'Stretching my legs.', 'Carry on, operator.', 'Inspecting the pixels.'];
  function stroll(y, xa, xb) {
    const ltr = Math.random() < 0.5, x0 = ltr ? xa : xb, x1 = ltr ? xb : xa, xm = lerp(x0, x1, rnd(0.35, 0.65));
    const ms = (a, b) => clamp(Math.abs(b - a) / 0.14, 900, 9000), m1 = ms(x0, xm), m2 = ms(xm, x1), tok = S.tok;
    stand(x0, y, { pose: 'run', flip: x1 < x0, travel: false });
    const leg = (a, b, dur, cb) => { setPose('run'); timeline(tok, dur, [{ a: 0, d: dur, fn: (p) => moveTo(lerp(a, b, p), y, b < a) }], cb); };
    later(700, () => leg(x0, xm, m1, () => { setPose(pick(['wave', 'sit', 'nibble'])); bubbleText(Math.random() < 0.5 ? pick(ROAM_LINES) : voice('idle'), 2000); later(2400, () => leg(xm, x1, m2)); }));
    return 700 + m1 + 2400 + m2;
  }
  function floorSpan() {
    const hb = homeOn() ? homeBox() : null; let xa = W / 2 + 12, xb = innerWidth - W / 2 - 12;
    if (hb) { if (CFG.homeCorner[1] === 'r') xb = Math.min(xb, hb.left - 24); else xa = Math.max(xa, hb.right + 24); }
    return xb - xa > 260 ? [xa, xb] : null;
  }
  A('roam', '*', 1, () => {
    const sp = floorSpan(), sb = document.querySelector('.statusbar'), sr = sb && sb.getBoundingClientRect();
    if (!sp) return false;
    return stroll(sr && sr.top > H ? sr.top + 3 : innerHeight - 4, sp[0], sp[1]);
  });
  A('ledge-walk', '*', 1, () => {
    const el = pickEl('.view.active .panel, main .panel', (e) => { const r = e.getBoundingClientRect(); return r.top > H + 40 && r.width > 300; });
    if (!el) return false;
    const r = el.getBoundingClientRect(); return stroll(r.top + 3, r.left + W / 2 + 12, r.right - W / 2 - 12);
  });
  const ANTIC_NAMES = Object.keys(ANTICS);
  function antic(name, force) {
    try {
      const a = ANTICS[name];
      if (!a || !awake() || !build()) return false;
      if (!force && S.busy) return false;
      if (!force && a.lvl > level().lvl) return false;
      if (reduced()) { return say(pick(TABLINES[curTab()] || LINES.idle), 2400); }
      cancel(); S.busy = true;
      let d; try { d = a.fn(); } catch (e) { console.warn('twr antic', name, e); d = false; }
      if (d === false || d == null) { cancel(true); return false; }
      addXp(2); stayThenHide(d + 700);
      return true;
    } catch (e) { console.warn('twr.antic', e); S.busy = false; return false; }
  }

  // ---------- popBehind: surprise appearances from behind panels ----------
  const visibleRect = (el) => { const r = vis(el, 90, 24); return r; };
  const pickEl = (sel, filter) => { const all = [...document.querySelectorAll(sel)].filter((el) => visibleRect(el) && (!filter || filter(el))); return all.length ? pick(all) : null; };
  function popBehind(kind) {
    try {
      if (!awake() || reduced() || !build() || S.busy) return false;
      kind = kind || pick(['panel', 'text', 'bg', 'nav', 'edge', 'edge', 'status', 'status', 'titlebar', 'corner']);
      let spec = null, script = null;
      if (kind === 'panel' || kind === 'bg') {
        const el = pickEl('.view.active .panel, main .panel', (e) => e.getBoundingClientRect().top > 70);
        if (!el) kind = 'corner'; else {
          const R = el.getBoundingClientRect(), side = R.top > 80 ? 'top' : (R.left > 90 ? 'left' : 'right');
          const along = side === 'top' ? rnd(R.left + 40, Math.max(R.left + 41, R.right - 40)) : rnd(R.top + 40, Math.max(R.top + 41, R.bottom - 40));
          spec = { rect: R, side, along, f: 0.62, pose: 'peek', clip: true, z: 40, el };
          script = (e) => [[900, () => setPose('wave')], [2600, () => setPose('peek')], [3200, () => { e.classList.add('twr-shake'); S.undo.push(() => e.classList.remove('twr-shake')); }]];
        }
      }
      if (kind === 'text') {
        const el = pickEl('.view.active .panel-head, .view.active h1, .view.active h2');
        if (!el) kind = 'corner'; else {
          const R = el.getBoundingClientRect();
          spec = { rect: R, side: 'top', along: rnd(R.left + 30, Math.max(R.left + 31, Math.min(R.right, R.left + 260) - 30)), f: 0.7, pose: 'peek', clip: true, z: 40, el, nudge: true };
          script = () => [[1100, () => setPose('wave')], [2800, () => setPose('peek')]];
        }
      }
      if (kind === 'nav') {
        const side = document.querySelector('.side'), nav = pickEl('.side > .nav:not(.hidden)'), sr = side && side.getBoundingClientRect();
        if (!nav || !sr) kind = 'corner'; else {
          const nr = nav.getBoundingClientRect();
          spec = { rect: sr, side: 'right', along: nr.top + nr.height / 2, f: 0.55, pose: 'peek', clip: true, z: 40, nav };
          script = () => [[1000, () => { setPose('push'); tw(nav, { translate: '7px 0', rotate: '-7deg', scale: '.92' }, 350); }], [2400, () => { tw(nav, { translate: '0 0', rotate: '0deg', scale: '1' }, 300); setPose('wave'); bubbleText('Tile moved into place.', 1600); }]];
        }
      }
      // everywhere: peek in from the right screen edge, from behind the status bar, or hang from under the title bar
      const hb = homeOn() ? homeBox() : null, homeR = !!hb && CFG.homeCorner[1] === 'r';
      if (kind === 'edge') {
        const lo = H + 40, hi = (hb && homeR && CFG.homeCorner[0] === 'b' ? hb.top - 70 : innerHeight - 100);
        if (hi - lo < 80) kind = 'corner'; else {
          const R = { left: innerWidth, right: innerWidth + 2, top: 0, bottom: innerHeight };
          spec = { rect: R, side: 'left', along: rnd(lo, hi), f: 0.62, pose: 'peek', clip: false, z: 40 };
          script = () => [[900, () => setPose('wave')], [2600, () => setPose('peek')]];
        }
      }
      if (kind === 'status') {
        const sb = document.querySelector('.statusbar'), sr = sb && sb.getBoundingClientRect();
        const x1 = sr ? Math.min(sr.right - 200, hb && homeR ? hb.left - 80 : 1e9) : 0;
        if (!sr || sr.width < 400 || x1 < sr.left + 260) kind = 'corner'; else {
          spec = { rect: sr, side: 'top', along: rnd(sr.left + 260, x1), f: 0.7, pose: 'peek', clip: true, z: 40 };
          script = () => [[900, () => setPose('wave')], [2800, () => setPose('peek')]];
        }
      }
      if (kind === 'titlebar') {
        const tb = document.querySelector('.titlebar'), tr = tb && tb.getBoundingClientRect();
        if (!tr || tr.width < 600 || tr.bottom < 10) kind = 'corner'; else {
          spec = { rect: tr, side: 'bottom', along: rnd(tr.left + 300, tr.right - 300), f: 0.6, pose: 'peek', clip: true, z: 40 };
          script = () => [[1000, () => setPose('wave')], [2800, () => setPose('peek')]];
        }
      }
      if (kind === 'corner' || !spec) { const c = corner(); cancel(); S.busy = true; stand(c.x, c.y, { pose: pick(['wave', 'nibble']) }); stat('pops'); later(600, () => bubbleText(L('idle'), 2400)); stayThenHide(4200); return true; }
      cancel(); S.busy = true; stat('pops');
      const idle = Math.random() < 0.45 ? L('idle') : null;
      if (spec.bg) {
        show(Object.assign({}, spec, { clip: false, z: 1, keepHidden: true }));
        pos.classList.add('bgdim');
        const R = spec.rect; pos.style.transform = `translate(${R.left + R.width / 2 - W / 2}px,${R.top + R.height / 2 - H / 2}px)`; slide.style.transform = 'none';
        later(1500, () => { pos.classList.remove('bgdim'); show(Object.assign({}, spec, { clip: true, z: 40, keepHidden: true })); later(40, emerge); runScript(script(spec.el), idle); });
        return true;
      }
      show(Object.assign({}, spec, { keepHidden: true }));
      if (spec.nudge) tw(spec.el, { translate: '22px 0' }, 300);
      later(60, emerge); runScript(script(spec.el), idle);
      return true;
    } catch (e) { console.warn('twr.popBehind', e); S.busy = false; return false; }
  }
  function runScript(steps, idleLine) {
    let end = 0; for (const [ms, fn] of steps) { later(ms, fn); end = Math.max(end, ms); }
    if (idleLine) later(700, () => bubbleText(idleLine, 2400));
    stayThenHide(end + 1500);
  }

  // ---------- TOW: scenes ----------
  const rectOf = (r) => { const left = r.left ?? r.x ?? 0, top = r.top ?? r.y ?? 0, width = r.width ?? ((r.right ?? left) - left), height = r.height ?? ((r.bottom ?? top) - top); return { left, top, width, height, right: left + width, bottom: top + height }; };
  function mkAct(w, h) { const d = document.createElement('div'); d.className = 'twr-act'; d.style.width = `${w}px`; d.style.height = `${h}px`; d.style.marginLeft = `${-w / 2}px`; d.style.marginTop = `${-h / 2}px`; return d; }
  function mkVeh(vid) {
    const V = VEH[vid] || VEH.car, art = mkPix(VFR[vid] || VFR.car, 3, true), av = art.cv;
    const RW = GW * 2, rh = V.rider === 'full' ? GH * 2 - 8 : V.rider === 'peek' ? 42 : 0;
    const w = Math.max(av.width, RW) + 6, h = rh + av.height - (V.overlap || 0);
    const root = mkAct(w, h), inn = document.createElement('div'); inn.className = 'twr-act-in'; root.appendChild(inn);
    let rider = null;
    if (rh) {
      const box = document.createElement('div'); box.className = 'twr-rider'; box.style.cssText = `left:${(w - RW) / 2}px;top:0;width:${RW}px;height:${rh}px`;
      rider = Spr(CFG, 2); rider.set(V.pose || 'sit'); rider.cv.style.marginTop = V.rider === 'full' ? `${-OY * 2}px` : `${-OY * 2 + 2}px`; box.appendChild(rider.cv); inn.appendChild(box);
    }
    av.style.cssText = `position:absolute;left:${(w - av.width) / 2}px;top:${h - av.height}px`; inn.appendChild(av);
    return { root, inn, w, h, V };
  }
  const toss = (c, text, x, y, nx, ny) => { try { putBubble(text, 1600, x, y, nx == null ? 0 : nx, ny == null ? -1 : ny); } catch {} };

  function sceneVehicle(c) {
    const vid = VEH[CFG.vehicle] ? CFG.vehicle : 'car', veh = mkVeh(vid), V = veh.V; c.add(veh.root);
    const sp = rnd(0.85, 1.25) * (V.fast ? 1.25 : 1), up = c.yB < c.yA, mode = V.mode;
    const dist = Math.abs(c.yB - c.yA);
    const hp = homeOn() ? doorMid() : null;
    let TA = 650 / sp; const TB = (520 + Math.min(dist, 700) * 1.1) / sp, TC = hp ? 1500 : 1100;
    const fromV = !hp && Math.random() < 0.3 && V.rot;
    let ax = c.cx, ay = c.yA;
    if (mode === 'rigid') ax = c.F.right + veh.w / 2 - 6;
    if (mode === 'beam') { ax = c.F.left + c.F.width / 2; ay = c.yA - 78; }
    if (mode === 'kick') { ax = c.F.right + 52; }
    if (hp) TA = clamp(Math.hypot(ax - hp.x, ay - hp.y) * 1.05, 650, 1500) / sp;
    const s0 = hp ? { x: hp.x, y: hp.y - 20 } : fromV ? { x: ax, y: up ? innerHeight + 100 : -100 } : { x: ax + 240, y: ay };
    const toHome = hp ? (hp.x > ax ? 'scaleX(-1)' : '') : 'scaleX(-1)';
    const place = (x, y) => { veh.root.style.transform = `translate(${x}px,${y}px)`; };
    place(s0.x, s0.y);
    const rope = mode === 'rope' ? c.add(document.createElement('div')) : null; if (rope) { rope.className = 'twr-rope'; rope.style.opacity = '0'; }
    const beam = mode === 'beam' ? c.add(document.createElement('div')) : null; if (beam) beam.className = 'twr-beam';
    const faceL = hp ? (hp.x < ax ? '' : 'scaleX(-1)') : 'scaleX(-1)'; veh.inn.style.transform = fromV ? (up ? 'rotate(-90deg)' : 'rotate(90deg)') : faceL;
    const overshoot = mode === 'rope' && Math.random() < 0.3 ? rnd(30, 60) * (up ? -1 : 1) : 0;
    const lag = mode === 'rope' ? 0.1 : 0; let honked = false, tileP = 0;
    const tilePos = () => ({ x: c.T.right + c.dx * (1 - tileP), y: c.yB + c.dy * (1 - tileP) });
    S.head = { x: ax, y: ay - 40, nx: 0, ny: -1 };
    toss(c, mode === 'beam' ? 'Scanning tile...' : L('moved'), ax, ay - 50);
    c.tl(TA + TB + TC, [
      { a: 0, d: TA, fn: (p) => { const e = ease(p); place(lerp(s0.x, ax, e), lerp(s0.y, ay, e)); if (rope && p > 0.6) { const t = tilePos(), len = Math.hypot(ax - t.x, ay - t.y), ang = Math.atan2(ay - t.y, ax - t.x); rope.style.transform = `translate(${t.x}px,${t.y}px) rotate(${ang}rad) scaleX(${len})`; rope.style.opacity = '1'; } } },
      { a: TA, d: 0, fn: () => { if (V.rot && !fromV) veh.inn.style.transform = up ? 'rotate(-90deg)' : 'rotate(90deg)'; if (mode === 'kick') { try { veh.inn.classList.add('kick'); } catch {} } } },
      { a: TA, d: TB, fn: (p) => {
          const pm = ease(p); tileP = mode === 'kick' ? ease(Math.min(1, p * 1.7)) : ease(Math.max(0, (p - lag) / (1 - lag)));
          let vy = lerp(ay, mode === 'beam' ? c.yB - 78 : c.yB, pm); if (overshoot && p > 0.85) vy += overshoot * Math.sin((p - 0.85) / 0.15 * Math.PI);
          const wob = mode === 'kick' ? Math.sin(p * 18) * 2 : 0; place(ax, vy + wob); c.tile(tileP);
          if (mode === 'beam') { c.el.style.scale = String(1 + 0.14 * Math.sin(p * Math.PI)); const tt = tilePos(); const top = vy + veh.h / 2 - 4, bh = Math.max(10, tt.y - top); beam.style.cssText = `left:${tt.x - c.T.width / 2 - c.T.width * 0.45}px;top:${top}px;width:${c.T.width * 0.9}px;height:${bh}px;opacity:1`; }
          if (rope) { const t = tilePos(), len = Math.hypot(ax - t.x, vy - t.y), ang = Math.atan2(vy - t.y, ax - t.x); rope.style.transform = `translate(${t.x}px,${t.y}px) rotate(${ang}rad) scaleX(${len})`; }
          if (V.fast && Math.random() < 0.5) particle('honk', pick(['*', '·', '~']), ax + (up ? 0 : 0) + rnd(-10, 10), vy + (up ? 40 : -40));
        } },
      { a: TA + TB, d: 0, fn: () => { honked = true; c.tile(1); if (rope) rope.style.opacity = '0'; if (beam) { beam.style.opacity = '0'; c.el.style.scale = ''; } S.head = { x: ax, y: c.yB - 60, nx: 0, ny: -1 }; toss(c, V.honk, ax, c.yB - 60); for (let i = 0; i < 3; i++) setTimeout(() => particle('honk', ')))', ax + 30, c.yB + i * 6), i * 120); if (mode === 'rigid' || mode === 'rope') veh.inn.style.transform = hp ? toHome : faceL; } },
      { a: TA + TB + 500, d: TC - 500, fn: (p) => { const e = ease(p); if (p === 0 || !c.homing) { c.homing = true; if (hp) veh.inn.style.transform = toHome; } const by = mode === 'beam' ? c.yB - 78 : c.yB; if (hp) { place(lerp(ax, hp.x, e), lerp(by, hp.y - 20, e)); veh.root.style.opacity = String(1 - e * e); veh.root.style.scale = String(1 - 0.5 * e); } else { place(ax + (mode === 'beam' ? 0 : 280 * e), (mode === 'beam' ? c.yB - 78 - 260 * e : c.yB)); veh.root.style.opacity = String(1 - e); } } },
    ], () => c.finish());
  }
  // a mini rabbit actor (scale 2) positioned by centre
  function mkRab(pose, fl) { const a = mkAct(GW * 2, GH * 2), s = Spr(CFG, 2); s.set(pose); s.cv.style.cssText = `position:absolute;left:0;top:0;${fl ? 'transform:scaleX(-1)' : ''}`; a.appendChild(s.cv); return { root: a, spr: s }; }
  function sceneShove(c) {
    const down = c.yB > c.yA, ra = mkRab('heave', false); c.add(ra.root);
    const x = c.F.left + c.F.width / 2, TA = 550, TB = 700 + Math.min(Math.abs(c.yB - c.yA), 600), TC = 900;
    const rpos = (tileCY) => { const y = down ? tileCY - c.F.height / 2 - 52 : tileCY + c.F.height / 2 + 52; ra.root.style.transform = `translate(${x}px,${y}px) ${down ? 'rotate(180deg)' : ''}`; };
    let tileP = 0; ra.root.style.opacity = '0'; rpos(c.yA); toss(c, pick(['Heave-ho!', 'Back you go!', L('moved')]), x, c.yA - 50);
    c.tl(TA + TB + TC, [
      { a: 0, d: TA, fn: (p) => { ra.root.style.opacity = String(Math.min(1, p * 2)); rpos(c.yA); } },
      { a: TA, d: TB, fn: (p) => { tileP = ease(p); c.tile(tileP); rpos(c.yB + c.dy * (1 - tileP)); if (Math.random() < 0.2) particle('spark', '*', x + rnd(-20, 20), c.yB + c.dy * (1 - tileP)); } },
      { a: TA + TB, d: 0, fn: () => { c.tile(1); ra.spr.set('wave'); toss(c, 'Phew. Nailed it.', x, c.yB - 60); } },
      { a: TA + TB + 500, d: 400, fn: (p) => { ra.root.style.opacity = String(1 - p); } },
    ], () => c.finish());
  }
  function sceneRope(c) {
    const ra = mkRab('push', true); c.add(ra.root); const rope = c.add(document.createElement('div')); rope.className = 'twr-rope';
    const rx = c.T.right + 70, TA = 600, tugs = 4, TB = 2400, TC = 800; let tileP = 0;
    const rpos = (dx) => { ra.root.style.transform = `translate(${rx + dx}px,${c.yB}px)`; };
    rpos(260); toss(c, pick(['Tug of war!', 'Come here, tile.', 'Pulling... pulling...']), rx, c.yB - 60);
    c.tl(TA + TB + TC, [
      { a: 0, d: TA, fn: (p) => rpos(260 * (1 - ease(p))) },
      { a: TA, d: TB, fn: (p) => { const k = p * tugs, i = Math.floor(Math.min(k, tugs - 1)), f = k - i, e = ease(Math.min(1, f * 1.4)); tileP = (i + e) / tugs; c.tile(tileP); rpos(Math.sin(Math.min(1, f * 1.6) * Math.PI) * 12);
          const t = { x: c.T.right + c.dx * (1 - tileP), y: c.yB + c.dy * (1 - tileP) }, hx = rx - 26 + Math.sin(Math.min(1, f * 1.6) * Math.PI) * 12, hy = c.yB - 4; const len = Math.hypot(hx - t.x, hy - t.y), ang = Math.atan2(hy - t.y, hx - t.x); rope.style.transform = `translate(${t.x}px,${t.y}px) rotate(${ang}rad) scaleX(${len})`; } },
      { a: TA + TB, d: 0, fn: () => { c.tile(1); rope.style.opacity = '0'; ra.spr.set('dance'); toss(c, 'Gotcha!', rx, c.yB - 60); } },
      { a: TA + TB + 400, d: 400, fn: (p) => rpos(260 * ease(p)) },
    ], () => c.finish());
  }
  function sceneTeleport(c) {
    const ra = mkRab('type', false); c.add(ra.root); const x = c.T.right + 70;
    ra.root.style.transform = `translate(${x}px,${c.yB}px)`; ra.root.style.opacity = '0'; c.el.style.opacity = '1';
    toss(c, pick(['sudo mv tile', 'Teleporting tile...', 'mv tile /dev/there']), x, c.yB - 60);
    c.tl(2600, [
      { a: 0, d: 300, fn: (p) => { ra.root.style.opacity = String(p); } },
      { a: 350, d: 0, fn: () => { glyphBurst(c.F, 800, 0.9); } },
      { a: 350, d: 600, fn: (p) => { c.el.style.opacity = (Math.floor(p * 10) % 2 ? '0.15' : '0.7'); if (p > 0.85) c.el.style.opacity = '0'; } },
      { a: 1050, d: 0, fn: () => { c.tile(1); glyphBurst(c.T, 800, 0.9); } },
      { a: 1100, d: 700, fn: (p) => { c.el.style.opacity = (Math.floor(p * 10) % 2 ? '1' : '0.25'); if (p >= 1) c.el.style.opacity = '1'; } },
      { a: 1900, d: 0, fn: () => { ra.spr.set('wave'); toss(c, 'Teleport complete.', x, c.yB - 60); } },
      { a: 2300, d: 300, fn: (p) => { ra.root.style.opacity = String(1 - p); } },
    ], () => c.finish());
  }
  function sceneConveyor(c) {
    const belt = c.add(document.createElement('div')); belt.className = 'twr-conv';
    const x = c.F.left + c.F.width / 2, y0 = Math.min(c.yA, c.yB) - c.F.height / 2 - 6, h = Math.abs(c.yB - c.yA) + c.F.height + 12;
    belt.style.cssText = `left:${x - c.F.width / 2 - 4}px;top:${y0}px;width:${c.F.width + 8}px;height:${h}px;opacity:0`;
    belt.classList.toggle('rev', c.yB < c.yA);
    const ra = mkRab('wave', false); c.add(ra.root); const rx = c.F.right + 36; ra.root.style.transform = `translate(${rx}px,${c.yB}px)`; ra.root.style.opacity = '0';
    toss(c, pick(['Conveyor engaged.', 'All aboard the tile express.']), rx, c.yB - 60);
    const TB = 1100 + Math.min(Math.abs(c.yB - c.yA), 700);
    c.tl(500 + TB + 900, [
      { a: 0, d: 400, fn: (p) => { belt.style.opacity = String(p * 0.9); ra.root.style.opacity = String(p); } },
      { a: 500, d: TB, fn: (p) => { c.tile(ease(p)); } },
      { a: 500 + TB, d: 0, fn: () => { c.tile(1); ra.spr.set('dance'); toss(c, 'Next stop: your tile.', rx, c.yB - 60); } },
      { a: 500 + TB + 400, d: 400, fn: (p) => { belt.style.opacity = String(0.9 * (1 - p)); ra.root.style.opacity = String(1 - p); } },
    ], () => c.finish());
  }
  function sceneSurf(c) {
    const ra = mkRab('dance', false); c.add(ra.root); const TA = 400, TB = 1700 + Math.min(Math.abs(c.yB - c.yA), 600), x = c.F.left + c.F.width / 2;
    toss(c, pick(['Surf is up!', 'Cowabunga.', 'Wheee!']), x, c.yA - 60);
    c.tl(TA + TB + 800, [
      { a: 0, d: TA, fn: (p) => { ra.root.style.transform = `translate(${x}px,${c.yA - c.F.height / 2 - 28 - 80 * (1 - ease(p))}px)`; } },
      { a: TA, d: TB, fn: (p) => { const e = ease(p); c.tile(e); const tx = Math.sin(p * 14) * 8 * (1 - p) , ty = c.yB + c.dy * (1 - e) - c.F.height / 2 - 28; c.el.style.rotate = `${Math.sin(p * 12) * 3}deg`; ra.root.style.transform = `translate(${x + tx}px,${ty}px) rotate(${Math.sin(p * 12) * 6}deg)`; } },
      { a: TA + TB, d: 0, fn: () => { c.tile(1); c.el.style.rotate = ''; ra.spr.set('wave'); toss(c, 'Stuck the landing.', x, c.yB - 70); } },
      { a: TA + TB + 300, d: 450, fn: (p) => { ra.root.style.opacity = String(1 - p); ra.root.style.transform = `translate(${x}px,${c.yB - c.F.height / 2 - 28 - 60 * p}px)`; } },
    ], () => c.finish());
  }
  const SCENE_FN = { vehicle: sceneVehicle, shove: sceneShove, rope: sceneRope, teleport: sceneTeleport, conveyor: sceneConveyor, surf: sceneSurf };
  const SCENES = Object.keys(SCENE_FN);
  const SCENE_WEIGHTED = ['vehicle', 'vehicle', 'vehicle', 'shove', 'rope', 'teleport', 'conveyor', 'surf'];

  function tow(el, from, to, opts) {
    try {
      opts = opts || {};
      if (!el || !from || !to || !awake() || !build()) return false;
      const F = rectOf(from), T = rectOf(to), dx = F.left - T.left, dy = F.top - T.top;
      if (Math.hypot(dx, dy) < 10) return false;
      stat('tows'); addCoins(3); addXp(8);
      if (reduced()) { say(L('moved'), 1800); return true; }
      cancel(); S.busy = true; const tok = S.tok;
      let names = opts.scene ? [].concat(opts.scene) : (S.forceScenes || SCENE_WEIGHTED); S.forceScenes = null;
      names = names.filter((n) => SCENE_FN[n]); if (!names.length) names = SCENE_WEIGHTED;
      if (isLite()) names = ['vehicle', 'shove'];
      const name = pick(names);
      const orig = { transition: el.style.transition, translate: el.style.translate, opacity: el.style.opacity, scale: el.style.scale, rotate: el.style.rotate };
      el.style.transition = 'none'; el.style.translate = `${dx}px ${dy}px`; el.classList.add('twr-towed');
      const actors = []; let ended = false;
      const c = { el, F, T, dx, dy, tok, cx: Math.max(F.right, T.right) + 34, yA: F.top + F.height / 2, yB: T.top + T.height / 2, scene: name };
      c.add = (n) => { ui.appendChild(n); actors.push(n); return n; };
      c.tile = (p) => { el.style.translate = `${dx * (1 - p)}px ${dy * (1 - p)}px`; };
      c.tl = (total, steps, end) => timeline(tok, total, steps, end);
      const cleanup = () => {
        if (ended) return; ended = true;
        el.style.translate = orig.translate; el.style.transition = orig.transition; el.style.opacity = orig.opacity; el.style.scale = orig.scale; el.style.rotate = orig.rotate;
        el.classList.remove('twr-towed'); actors.forEach((a) => a.remove()); rmTrail(true); setAway(false); openDoor(700);
        if (S.tok === tok) { S.busy = false; bubble.classList.remove('on'); }
      };
      if (homeOn()) { setAway(true); departFx(T.left + T.width / 2, T.top + T.height / 2); }
      c.finish = () => { el.classList.remove('twr-land'); void el.offsetWidth; el.classList.add('twr-land'); setTimeout(() => el.classList.remove('twr-land'), 700); cleanup(); };
      S.undo.push(cleanup);
      SCENE_FN[name](c);
      return true;
    } catch (e) { console.warn('twr.tow', e); S.busy = false; return false; }
  }
  function scene(...names) { const l = names.flat().filter((n) => SCENE_FN[n]); S.forceScenes = l.length ? l : null; return SCENES.slice(); }
  function demoTow(sceneName) {
    const navs = [...document.querySelectorAll('.side > .nav')].filter((n) => vis(n, 20, 10));
    if (navs.length < 2) { say('I cannot find any sidebar tiles to move right now.', 2200); return false; }
    const el = navs[Math.min(1, navs.length - 1)], to = el.getBoundingClientRect(), far = navs[Math.min(navs.length - 1, 4)].getBoundingClientRect();
    return tow(el, { left: far.left, top: far.top, width: to.width, height: to.height }, to, { scene: sceneName });
  }

  // ---------- scheduler & tab watching ----------
  function nextDelay() { const r = { rare: [60, 150], normal: [20, 60], chatty: [10, 28] }[CFG.freq]; if (!r) return 30000; let [a, b] = r; if (isLite()) { a *= 2.5; b *= 2.5; } return rnd(a, b) * 1000; }
  function canRandom() {
    return awake() && CFG.freq !== 'off' && !document.hidden && document.hasFocus() && quiet() && !S.busy && !document.body.classList.contains('booting') && !vjFill() && !(document.getElementById('intro') && document.getElementById('intro').offsetParent);
  }
  function randomAct(force) {
    const lvl = level().lvl, tab = curTab();
    const mine = ANTIC_NAMES.filter((n) => ANTICS[n].tab === tab && ANTICS[n].lvl <= lvl), gen = ANTIC_NAMES.filter((n) => ANTICS[n].tab === '*' && ANTICS[n].lvl <= lvl);
    if (!force && isLite() && Math.random() < 0.5) return false;
    const r = Math.random();
    if (!force && r > 0.78) return popBehind();
    if (!force && r < 0.14 && antic(pick(['roam', 'ledge-walk']))) return true;
    const list = (r < 0.65 && mine.length) ? mine : gen;
    for (let i = 0; i < 4; i++) { if (antic(pick(list), force)) return true; }
    return popBehind();
  }
  function schedule() {
    setTimeout(() => { try { if (canRandom()) randomAct(false); } catch {} schedule(); }, nextDelay());
  }
  let lastTab = '';
  function watchTab() {
    setInterval(() => {
      try {
        const t = curTab(); if (!t || t === lastTab) return;
        const first = !lastTab; lastTab = t; if (first) return;
        tabTip(t); memTab(t); syncFill();
        if (!canRandom() || CFG.freq === 'off') return;
        if (memComment(t)) return;
        if (Math.random() > (CFG.freq === 'chatty' ? 0.6 : CFG.freq === 'rare' ? 0.15 : 0.35)) return;
        setTimeout(() => { try { if (canRandom() && curTab() === t) say(Math.random() < 0.55 ? tabQuip(t) : voice('tab'), 2400); } catch {} }, 700);
      } catch {}
    }, 1300);
  }

  // ---------- auto reactions & events ----------
  const SAVEISH = /(^|[\s_-])(save|saved)([\s_-]|$)/i;
  document.addEventListener('click', (e) => {
    try {
      const b = e.target.closest && e.target.closest('button, [role="button"], input[type="button"], input[type="submit"]');
      if (!b || b.closest('#twr-layer') || b.closest('.ctx-menu') || b.disabled) return;
      const key = `${b.id || ''} ${typeof b.className === 'string' ? b.className : ''}`, txt = (b.textContent || b.value || '').trim();
      if (SAVEISH.test(key) || /^(\W\s*)?save(d)?\b/i.test(txt) && txt.length < 14) { if (Date.now() - (S.saveClick || 0) > 180000) { S.saveClick = Date.now(); setTimeout(() => react('saved'), 250); } } // a real Save click gets a cheer, at most every 3 minutes
    } catch {}
  }, true);
  document.addEventListener('twr', (e) => {
    try {
      const d = e.detail || {};
      if (d.do === 'found') return foundIt(d.how || 'event');
      if (!CFG.on) return; // dormant: nothing below does anything
      if (d.do === 'saved' || (d.do === 'react' && d.name === 'saved')) { try { stat('saves'); memSaved(); } catch {} return; } // autosave chatter: counted quietly, never spoken
      if (d.do === 'unlock') S.unlockAt = Date.now(); else if (d.do === 'locked') S.unlockAt = 0;
      if (d.do === 'tow') tow(d.el, d.from, d.to, d);
      else if (d.do === 'react') react(d.name);
      else if (d.do === 'antic') { if (S.busy) enqueue(() => stage.demo(d.name), 15000); else stage.demo(d.name); }
      else if (d.do === 'poke') poke(d);
      else if (d.do) react(d.do);
      else if (d.say) say(String(d.say), d.ms);
    } catch {}
  });

  // ---------- the easter egg: the rabbit is dormant on a fresh install until somebody finds it ----------
  let foundAt = 0;
  function foundIt(how) {
    try {
      if (Date.now() - foundAt < 3000) return; foundAt = Date.now();
      const first = !CFG.on;
      CFG.found = true; lsSet('hs-twr-until', null);
      setCfg({ on: true, home: true, found: true });
      fire('twr-found', { how: how || '' });
      if (!first) { say('Still here. You rang?', 2200); return; }
      addCoins(5); addXp(5); memOpen();
      setTimeout(() => {
        try { applyHome(); HM.act = 'wave'; HM.spot = 'floor'; HM.until = Date.now() + 5000; if (homeOn()) { openDoor(1600); puff(); } say('hello... you found me.', 4200); } catch {}
      }, 450);
    } catch (e) { console.warn('twr.found', e); }
  }
  (() => {
    const PHRASE = 'follow the white rabbit', KON = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
    let buf = '', kon = 0, clicks = [];
    document.addEventListener('keydown', (e) => {
      try {
        if (CFG.found && CFG.on) return;
        const t = e.target, tag = t && t.tagName;
        if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(tag || '') || (t && t.isContentEditable)) return;
        const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        if (k.length === 1) { buf = (buf + k).slice(-PHRASE.length); if (buf === PHRASE) { buf = ''; foundIt('phrase'); } }
        kon = k === KON[kon] ? kon + 1 : (k === KON[0] ? 1 : 0);
        if (kon === KON.length) { kon = 0; foundIt('konami'); }
      } catch {}
    }, true);
    document.addEventListener('click', (e) => {
      try {
        if (CFG.found && CFG.on) return;
        if (!(e.target.closest && e.target.closest('.brand .glitch'))) return;
        const n = Date.now(); clicks = clicks.filter((x) => n - x < 3000); clicks.push(n);
        if (clicks.length >= 7) { clicks = []; foundIt('title'); }
      } catch {}
    }, true);
    document.addEventListener('input', (e) => {
      try {
        const i = e.target; if (!i || !i.closest || !i.closest('.fd')) return;
        if (/^(the )?(white )?rabbit$/i.test(i.value.trim()) && !(CFG.found && CFG.on)) { setTimeout(() => { try { i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch {} }, 60); foundIt('find'); }
      } catch {}
    }, true);
  })();

  // sidebar tow: remember rects at pointerdown, then FLIP when the order changes
  function wireSide() {
    const side = document.querySelector('.side'); if (!side) return;
    let grab = null, before = null;
    side.addEventListener('pointerdown', (e) => {
      try {
        const b = e.button === 0 && e.target.closest && e.target.closest('.nav'); if (!b) return;
        grab = b; before = new Map([...side.querySelectorAll(':scope > .nav')].map((n) => [n, n.getBoundingClientRect()])); clearTimeout(wireSide.t);
      } catch {}
    }, true);
    const done = () => { clearTimeout(wireSide.t); wireSide.t = setTimeout(() => { grab = null; before = null; }, 500); };
    window.addEventListener('pointerup', done, true); window.addEventListener('pointercancel', done, true);
    try {
      new MutationObserver(() => {
        try {
          if (!grab || !before) return;
          const el = grab, r0 = before.get(el); grab = null; before = null;
          if (!r0 || !el.isConnected) return;
          const r1 = el.getBoundingClientRect(); if (Math.abs(r1.top - r0.top) < 10) return;
          tow(el, r0, r1);
        } catch {}
      }).observe(side, { childList: true });
    } catch {}
  }

  // =====================================================================================================
  // THE BURROW: a tiny framed cutaway room in a screen corner where the rabbit lives. Everything he does starts
  // at its door and ends back there (door opens, glyph puff, a dotted "cable" glows between home and target).
  // =====================================================================================================
  const HW = 49, HR = 37, HP = 3, BW = HW * HP + 2, BH = HR * HP + 2; // grid 49x37 at 3px = 147x111 (+1px frame each side)
  const HM = { alert: null, el: null, cv: null, g: null, act: 'look', until: 0, spot: 'floor', k: 0, away: false, doorUntil: 0, door: 0, lastIn: Date.now(), lastKey: 0, mx: -1, my: -1, hover: false, forceSleep: 0, drag: null, tr: 0, trail: null, veh: null, box: { left: 0, top: 0, right: 0, bottom: 0 }, t0: Date.now(), nudge: null, timer: 0, arriveAt: 0, palKey: '', pal: null, tip: '', lit: true };
  const $q = (s) => document.querySelector(s);
  const homeOn = () => !!(HM.el && CFG.on && CFG.home && HM.el.style.display !== 'none' && !vjFill());
  const homeBox = () => HM.box;
  const mirrored = () => false; // the picture has a sign with writing on it, so it is never flipped
  const doorAt = (gy) => { const b = HM.box; return { x: b.left + 1 + (ACX + 0.5) * HP, y: b.top + 1 + gy * HP }; };
  const doorMid = () => doorAt(24), doorFeet = () => doorAt(29);
  const homeRectOrNull = () => { try { return homeOn() ? HM.el.getBoundingClientRect() : null; } catch { return null; } };
  const homePoint = () => { try { if (homeOn()) return doorMid(); } catch {} return { x: innerWidth - 60, y: innerHeight - 40 }; };
  const arrive = () => Math.max(0, HM.arriveAt - Date.now());
  const openDoor = (ms) => { HM.doorUntil = Math.max(HM.doorUntil, Date.now() + (ms || 900)); kickHome(); };
  function setAway(b) { if (HM.away !== b) { HM.away = b; kickHome(); } }
  function puff() { try { if (!homeOn() || !ui) return; const d = doorMid(); glyphBurst({ left: d.x - 14, top: d.y - 22, width: 28, height: 40 }, 650, 0.8); } catch {} }
  function departFx(tx, ty) { try { openDoor(900); puff(); mkTrail(doorMid(), { x: tx, y: ty }); } catch {} }

  // the dotted cable between home and wherever the rabbit is working
  function mkTrail(a, b) {
    try {
      rmTrail(false); if (!ui || !homeOn()) return;
      const el = document.createElement('div'); el.className = 'twr-trail'; ui.appendChild(el);
      HM.trail = { el, a, b, f: 1 }; updTrail(1);
    } catch {}
  }
  function updTrail(f, bx, by) {
    const T = HM.trail; if (!T) return;
    if (bx != null) T.b = { x: bx, y: by };
    if (f != null) T.f = f;
    const len = Math.hypot(T.b.x - T.a.x, T.b.y - T.a.y), ang = Math.atan2(T.b.y - T.a.y, T.b.x - T.a.x);
    T.el.style.width = `${Math.max(0, len * T.f)}px`; T.el.style.transform = `translate(${T.a.x}px,${T.a.y}px) rotate(${ang}rad)`;
  }
  function rmTrail(fade) { const T = HM.trail; HM.trail = null; if (!T) return; if (fade) { T.el.classList.add('off'); setTimeout(() => T.el.remove(), 450); } else T.el.remove(); }

  // the chosen vehicle, drawn under the rabbit while he travels
  const VPOSE = { car: 'sit', hoverboard: 'bob', forklift: 'sit', ufo: 'sit', rocket: 'sit' };
  const vehId = () => (VFR[CFG.vehicle] ? CFG.vehicle : 'car');
  function addVeh(dir) {
    rmVeh(); if (reduced() || !tv) return;
    const art = mkPix(VFR[vehId()], 2, !isLite()), cv = art.cv; cv.classList.add('twr-tveh'); cv.style.marginLeft = `${-cv.width / 2}px`; cv.style.transform = dir < 0 ? 'scaleX(-1)' : '';
    tv.appendChild(cv); HM.veh = cv;
  }
  function rmVeh() { if (HM.veh) { HM.veh.remove(); HM.veh = null; } }

  function travelOut(x, y, o, from) {
    try {
      const tok = S.tok, id = ++HM.tr, d = from || doorFeet(), dx = d.x - x, dy = d.y - y, vid = vehId();
      const ms = clamp(Math.hypot(dx, dy) * (VEH[vid].fast ? 0.8 : 1.15) + 380, 520, 1500);
      HM.arriveAt = Date.now() + ms;
      if (homeOn()) {
        setAway(true);
        if (!from) { openDoor(900); puff(); mkTrail(doorMid(), { x, y: y - 30 }); updTrail(0); } else if (!HM.trail) mkTrail(doorMid(), { x, y: y - 30 }); else updTrail(null, x, y - 30);
      }
      addVeh(-dx); const pose0 = VPOSE[vid] || 'sit'; setPose(pose0); spr.over = spr.over || {};
      tv.style.transformOrigin = '50% 100%';
      const T0 = performance.now();
      const f = (n) => {
        if (S.tok !== tok || HM.tr !== id) return;
        const p = Math.min(1, (n - T0) / ms), e = ease(p);
        tv.style.transform = `translate(${dx * (1 - e)}px,${dy * (1 - e)}px) scale(${(from ? 1 : 0.45 + 0.55 * e).toFixed(3)})`;
        if (!from) updTrail(e);
        if (p < 1) requestAnimationFrame(f); else { tv.style.transform = ''; rmVeh(); if (pos.dataset.pose === pose0) setPose(o.pose || 'idle'); }
      };
      requestAnimationFrame(f);
    } catch (e) { tv.style.transform = ''; }
  }
  function travelHome(fin) {
    try {
      const tok = S.tok, id = ++HM.tr, d = doorFeet(), x = S.at.x, y = S.at.y, dx = d.x - x, dy = d.y - y, vid = vehId();
      const ms = clamp(Math.hypot(dx, dy) * (VEH[vid].fast ? 0.8 : 1.1) + 300, 480, 1400);
      addVeh(dx); const pose0 = VPOSE[vid] || 'sit'; spr.over = {}; setPose(pose0);
      tv.style.transformOrigin = '50% 100%'; openDoor(ms + 500);
      const T0 = performance.now();
      const f = (n) => {
        if (S.tok !== tok || HM.tr !== id) return;
        const p = Math.min(1, (n - T0) / ms), e = ease(p);
        tv.style.transform = `translate(${dx * e}px,${dy * e}px) scale(${(1 - 0.55 * e).toFixed(3)})`; updTrail(1 - e);
        if (p < 1) requestAnimationFrame(f); else { rmVeh(); tv.style.transform = ''; puff(); fin(); }
      };
      requestAnimationFrame(f);
    } catch (e) { fin(); }
  }

  // ---------- placement, drawing ----------
  function placeHome() {
    try {
      const sb = $q('.statusbar'), tb = $q('.titlebar');
      const bot = sb ? Math.max(0, innerHeight - sb.getBoundingClientRect().top) : 26, top = tb ? Math.max(0, tb.getBoundingClientRect().bottom) : 34, m = 10;
      const c = CFG.homeCorner, left = c[1] === 'l' ? m : innerWidth - BW - m, t = c[0] === 't' ? top + m : innerHeight - bot - BH - m;
      HM.box = { left, top: t, right: left + BW, bottom: t + BH };
      if (HM.el && !HM.drag) { HM.el.style.left = `${left}px`; HM.el.style.top = `${t}px`; HM.cv.style.transform = ''; }
      if (HM.peek) { const pl = c[1] === 'l' ? m : innerWidth - 30 - m, pt = c[0] === 't' ? top + m : innerHeight - bot - 30 - m; HM.peek.style.left = `${pl}px`; HM.peek.style.top = `${pt}px`; }
      anchorStyle(AST.el); anchorStyle(HM.nudge && HM.nudge.el);
    } catch {}
  }
  function anchorStyle(el) {
    if (!el) return;
    if (el === AST.el) { el.style.transform = ''; if (AST.spot) { el.style.left = '50%'; el.style.right = 'auto'; el.style.top = '14vh'; el.style.bottom = 'auto'; el.style.transform = 'translateX(-50%)'; return; } }
    const b = HM.box, right = CFG.homeCorner[1] === 'r', bottomC = CFG.homeCorner[0] === 'b';
    el.style.left = right ? 'auto' : `${b.left}px`; el.style.right = right ? `${Math.max(6, innerWidth - b.right)}px` : 'auto';
    if (bottomC) { el.style.bottom = `${Math.max(6, innerHeight - b.top + 8)}px`; el.style.top = 'auto'; } else { el.style.top = `${b.bottom + 8}px`; el.style.bottom = 'auto'; }
  }
  function kickHome() { if (HM.el && CFG.on && CFG.home) { clearTimeout(HM.timer); HM.timer = setTimeout(homeLoop, 10); } }
  function homeLoop() {
    clearTimeout(HM.timer); let d = 900;
    try {
      if (HM.el && CFG.on && CFG.home && !document.hidden) {
        drawHome();
        const anim = Math.abs(HM.door - (Date.now() < HM.doorUntil ? 1 : 0)) > 0.02 || HM.away;
        d = reduced() ? 1500 : anim ? 70 : isLite() ? 420 : 160;
      }
    } catch (e) { d = 1500; }
    HM.timer = setTimeout(homeLoop, d);
  }
  function stepAct(now, idle, night) {
    if (HM.hover) { if (HM.act !== 'look') { HM.act = 'look'; HM.spot = 'floor'; } HM.until = now + 1500; return; }
    if (now < HM.until) return;
    let a;
    if (HM.forceSleep > now || ((idle || night) && Math.random() < 0.85)) a = 'sleep';
    else {
      const r = Math.random(), busyUser = now - HM.lastIn < 20000;
      a = r < (busyUser ? 0.4 : 0.22) ? 'type' : r < 0.47 ? 'read' : r < 0.62 ? 'eat' : r < 0.72 ? 'stretch' : r < 0.84 ? 'peek' : r < 0.93 ? 'look' : 'wave';
    }
    if (HM.nudge) a = 'wave';
    HM.act = a; HM.spot = a === 'type' ? 'desk' : a === 'sleep' ? 'bed' : 'floor';
    HM.until = now + (a === 'sleep' ? rnd(20, 40) : rnd(6, 14)) * 1000;
  }
  const HAT_C = { tophat: '#111a15', cap: '#ff3d6e', crown: '#ffd54a', phones: '#46f0ff', wizard: '#3a7bff', propeller: '#46f0ff', halo: '#ffd54a', party: '#ff4fd8' };
  function miniRab(P, x, y, act, k, pal, ld) {
    // a tiny rabbit in side profile, facing right (towards the window and the user); 10 wide, 10 tall
    const W_ = pal.W, w_ = pal.w, E_ = pal.e, N_ = pal.n, K_ = '#06150d', PK = '#ff9fbd';
    const blink = k % 43 < 2, twitch = k % 61 < 3, nose = k % 29 < 8 ? (k >> 2) & 1 : 0;
    const paint = (rows, ox, oy) => { for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) { const ch = rows[r][c]; if (ch === '.') continue; P(x + ox + c, y + oy + r, 1, 1, ch === 'W' ? W_ : ch === 'w' ? w_ : ch === 'p' ? PK : ch === 'n' ? N_ : ch === 'K' ? K_ : ch === 'e' ? E_ : W_); } };
    if (act === 'sleep') {
      paint(['..wwWW....', '.WWWWWWWW.', 'WWWWWWWWKn', 'wwwwwwwwww'], 0, 6);
      const zz = Math.floor(k / 4) % 3; P(x + 8, y + 3 - zz, 1, 1, '#9dffe0'); P(x + 9, y + 2 - zz, 1, 1, '#9dffe0'); return;
    }
    let dy = 0; if (act === 'stretch' && (k >> 2) % 2) dy = -1;
    const ears = twitch ? ['..wW......', '..wpW.....', '...pW.....'] : ['...wW.....', '...wpW....', '....pW....'];
    paint(ears, 0, dy);
    paint(['....WWWW..', '....WWWWWn', '...WWWWWWW', '.WWWWWWWW.', 'WWWWWWWWW.', 'wWWWWWWWW.', '.wwwwwWWWW'], 0, 3 + dy);
    const ey = y + 4 + dy + (act === 'read' ? 1 : 0), ex = x + clamp(6 + ld, 5, 7);
    const gl = CFG.glasses;
    if (gl === 'shades') P(x + 5, ey, 4, 1, '#0a0a0a'); else if (gl === 'round') P(x + 5, ey, 2, 1, '#8a97a0'); else if (gl === 'visor') P(x + 3, ey, 6, 1, '#46f0ff');
    else if (gl === 'threed') { P(x + 5, ey, 2, 1, '#ff3d6e'); P(x + 7, ey, 2, 1, '#46f0ff'); }
    else P(ex, ey, 1, 1, blink ? w_ : (gl === 'hearts' ? '#ff6fa5' : K_));
    if (nose) { P(x + 9, y + 4 + dy, 1, 1, W_); P(x + 9, y + 5 + dy, 1, 1, N_); }
    const hc = HAT_C[CFG.hat]; if (hc) { P(x + 4, y + 3 + dy, 4, 1, hc); if (CFG.hat === 'tophat' || CFG.hat === 'wizard') P(x + 5, y + 2 + dy, 2, 1, hc); }
    if (act === 'type') { P(x + 6, y + 9, 5, 1, '#3a4a44'); P(x + 10, y + 5, 1, 4, (k >> 2) & 1 ? '#00ff9c' : '#0a8a50'); P(x + 7 + ((k >> 1) & 1), y + 8, 2, 1, W_); }
    else if (act === 'read') { P(x + 6, y + 6, 3, 3, '#3a7bff'); P(x + 7, y + 6, 1, 3, (k >> 4) & 1 ? '#cfe6ff' : '#ffd54a'); P(x + 8, y + 7, 1, 1, W_); }
    else if (act === 'eat') {
      const L = 3 - (Math.floor(k / 8) % 4 === 3 ? 2 : Math.floor(k / 8) % 3); P(x + 10 - Math.max(1, L), y + 6, Math.max(1, L), 1, '#ff8a1f'); P(x + 10, y + 5, 1, 3, '#2ad468'); P(x + 7, y + 7, 2, 1, W_);
    }
    else if (act === 'stretch') { if ((k >> 2) % 2) P(x + 7, y + 6, 3, 1, W_); else P(x + 8, y + 8, 2, 1, W_); }
    else if (act === 'wave') P(x + 8, y + 6 - ((k >> 1) & 1), 1, 3, W_);
  }
  // The burrow picture: a round-doored hobbit hill with the rabbit in the doorway, a chimney with smoke, a lit window,
  // a lantern, a glowing TWR signboard, a mailbox, a carrot patch and a day/night sky. 49x37 grid at 3px = 147x111.
  const OL = '#04100a', GY = 31, HCX = 25, HA = 18, HTOP = 10, ACX = 25, ACY = 22, ABOT = 30, AR = 7;
  const FONT = { T: ['###', '.#.', '.#.', '.#.', '.#.'], W: ['#...#', '#...#', '#.#.#', '#.#.#', '.#.#.'], R: ['##.', '#.#', '##.', '#.#', '#.#'] };
  const hillTop = (x) => { const dx = (x - HCX) / HA; return Math.abs(dx) > 1 ? 99 : Math.ceil(GY - (GY - HTOP) * Math.sqrt(1 - dx * dx)); };
  const inHill = (x, y) => y < GY && y >= hillTop(x);
  const archH = (y, r) => { if (y > ABOT - (AR - r)) return -1; if (y >= ACY) return r; const dy = ACY - y; return dy > r ? -1 : Math.floor(Math.sqrt((r + 0.5) * (r + 0.5) - dy * dy)); };
  function hillMask() {
    if (HM.hill) return HM.hill;
    const a = [];
    for (let x = HCX - HA; x <= HCX + HA; x++) for (let y = HTOP; y < GY; y++) {
      if (!inHill(x, y)) continue;
      let t = 2;
      if (!inHill(x - 1, y) || !inHill(x + 1, y) || !inHill(x, y - 1)) t = 0;
      else if ((!inHill(x - 2, y - 1) || !inHill(x, y - 2) || !inHill(x - 1, y - 2)) && x < HCX + 8) t = 1;
      else if ((!inHill(x + 2, y) || !inHill(x + 2, y - 1)) && x > HCX) t = 3;
      a.push([x, y, t]);
    }
    return (HM.hill = a);
  }
  const SKY = { day: ['#58b8f0', '#8fd8ff'], night: ['#0a1238', '#16205a'] };
  const HILL = { day: ['#7be08a', '#3fb658', '#2a8a45', '#5bd16a', '#3fb658', '#5a3a1c'], night: ['#3f9a63', '#2a7a49', '#1c5a36', '#2f8a53', '#236f40', '#3a2410'] };
  const SUN7 = ['..XXX..', '.XXXXX.', 'XXXXXXX', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..'], DISC5 = ['.XXX.', 'XXXXX', 'XXXXX', 'XXXXX', '.XXX.'];
  function drawHome() {
    const g = HM.g, now = Date.now(), k = ++HM.k, d = new Date(), hr = d.getHours();
    const night = hr >= 23 || hr < 6, evening = hr >= 19 || hr < 6, idle = now - HM.lastIn > 300000, lit = !(night || idle); HM.lit = lit;
    const dT = now < HM.doorUntil ? 1 : 0; HM.door += (dT - HM.door) * 0.5; if (Math.abs(HM.door - dT) < 0.04) HM.door = dT;
    if (!HM.away) stepAct(now, idle, night);
    const key = `${CFG.skin}|${CFG.color}`; if (key !== HM.palKey) { HM.palKey = key; HM.pal = mkPal(CFG.skin, accentOf(CFG)).pal; }
    const pal = HM.pal, sk = SKY[evening ? 'night' : 'day'], hc = HILL[evening ? 'night' : 'day'];
    const P = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x * HP, y * HP, w * HP, h * HP); };
    const art = (x, y, rows, map) => { for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) { const ch = rows[r][c]; if (map[ch]) P(x + c, y + r, 1, 1, map[ch]); } };
    g.clearRect(0, 0, HW * HP, HR * HP);
    // sky: two flat bands
    P(0, 0, HW, HR, sk[0]); P(0, 20, HW, GY - 20, sk[1]);
    // sun / moon (dark outline) and stars or clouds
    art(40, 2, SUN7, { X: OL });
    if (evening) {
      [[20, 3], [29, 2], [40, 12], [3, 20], [46, 17], [18, 11], [19, 1], [23, 6], [45, 25], [4, 28], [28, 8]].forEach(([sx, sy], i) => P(sx, sy, 1, 1, ((k >> 2) + i) % 6 === 0 ? '#5a6a9a' : '#ffffff'));
      P(33, 3, 1, 3, '#ffffff'); P(32, 4, 3, 1, '#ffffff');
      art(41, 3, DISC5, { X: '#f6f1c0' }); P(43, 4, 1, 1, '#cfc78f'); P(42, 6, 2, 1, '#cfc78f');
    } else {
      art(41, 3, DISC5, { X: '#ffd54a' }); P(42, 4, 1, 1, '#fff3a0');
      if ((k >> 3) & 1) { P(43, 0, 1, 1, '#ffd54a'); P(38, 5, 1, 1, '#ffd54a'); P(48, 5, 1, 1, '#ffd54a'); }
      const cx = ((k >> 2) % 70) - 12;
      art(cx, 15, ['..XX..', '.XXXXX', 'XXXXXX'], { X: '#ffffff' }); art(((cx + 33) % 66) - 14, 5, ['.XXX..', 'XXXXXX'], { X: '#e8f6ff' });
    }
    // chimney (behind the hill) and rising smoke
    P(32, 8, 6, 7, OL); P(31, 6, 8, 3, OL); P(32, 7, 6, 2, '#df7b5a'); P(32, 8, 6, 1, '#a64a33');
    P(33, 9, 4, 6, '#c0553a'); P(33, 9, 1, 6, '#df7b5a'); P(36, 9, 1, 6, '#8f3a28'); P(33, 11, 4, 1, '#8f3a28'); P(33, 13, 4, 1, '#8f3a28');
    for (let i = 0; i < (lit ? 4 : 2); i++) {
      const t = (((k * 0.07) + i * 0.25) % 1), px = 34 + Math.round(Math.sin(k * 0.05 + i * 1.7) + t * 3), py = 5 - Math.floor(t * 6), s = t < 0.45 ? 2 : 3;
      P(px, py, s, s, t < 0.6 ? '#f2f8f5' : '#aebfb8');
    }
    // the hill and two flowers
    for (const [x, y, t] of hillMask()) P(x, y, 1, 1, t === 0 ? OL : hc[t - 1]);
    P(11, 27, 3, 1, '#ff6fa5'); P(12, 26, 1, 3, '#ff6fa5'); P(12, 27, 1, 1, '#ffd54a');
    P(38, 28, 3, 1, '#ffffff'); P(39, 27, 1, 3, '#ffffff'); P(39, 28, 1, 1, '#ffd54a');
    // round window (right): yellow when the lamp is on, dark at night
    const wc = lit ? '#ffe27a' : '#1b3a5c';
    P(35, 18, 7, 7, OL); P(34, 19, 9, 5, OL); P(36, 19, 5, 5, wc); P(35, 20, 7, 3, wc);
    P(38, 19, 1, 5, '#8a5a30'); P(35, 21, 7, 1, '#8a5a30'); if (!lit) { P(36, 20, 1, 1, '#4a78a8'); P(40, 22, 1, 1, '#2a5078'); }
    // lantern (left of the door)
    P(15, 19, 1, 2, OL); P(13, 21, 5, 6, OL); P(14, 22, 3, 4, lit ? '#ffd54a' : '#5a4a1a'); P(14, 21, 3, 1, '#8a5a30'); if (lit && (k >> 2) % 5) P(15, 23, 1, 2, '#fff3a0');
    // the round door: outline, wood ring, then the room inside
    const cl = HM.away ? 1 - HM.door : 0; // 1 = door shut (rabbit is out), 0 = open
    const row = (y, r, c) => { const h = archH(y, r); if (h >= 0) P(ACX - h, y, 2 * h + 1, 1, c); };
    for (let y = ACY - AR; y <= ABOT; y++) { row(y, AR, OL); row(y, AR - 1, '#8a5a30'); row(y, AR - 2, lit ? '#5a3618' : '#2c1a0e'); }
    for (let y = ACY - AR + 1; y <= ABOT - 1; y++) { const h = archH(y, AR - 1); if (h >= 0) P(ACX - h, y, 1, 1, '#a8713c'); }
    P(ACX - 5, ABOT - 2, 11, 1, '#1e1108'); // floor
    // the rabbit (when he is home); props sit to his right
    if (!HM.away) {
      g.save(); g.beginPath(); g.rect((ACX - 5) * HP, 16 * HP, 11 * HP, 13 * HP); g.clip();
      const act = HM.act, lookD = (() => { if (HM.mx < 0) return 0; const cx = (HM.box.left + HM.box.right) / 2; return clamp(Math.round((HM.mx - cx) / 160), -1, 1); })();
      if (act === 'sleep') miniRab(P, ACX - 5, 19, 'sleep', k, pal, 0);
      else if (act === 'peek') miniRab(P, ACX - 5, 22 + ((k >> 3) % 7 === 0 ? 1 : 0), 'look', k, pal, lookD);
      else {
        miniRab(P, ACX - 5, 19, act, k, pal, act === 'look' ? lookD : act === 'read' ? 0 : ((k >> 5) % 3) - 1);
      }
      g.restore();
    }
    // door shut: planks that swing open from the left hinge
    if (cl > 0.02) {
      for (let y = ACY - AR + 2; y <= ABOT - 2; y++) {
        const h = archH(y, AR - 2); if (h < 0) continue; const xl = ACX - h, n = Math.round((2 * h + 1) * cl);
        for (let x = xl; x < xl + n; x++) P(x, y, 1, 1, (x - xl) % 4 === 3 ? '#5a3a1c' : (x - xl) % 4 === 1 ? '#b27a42' : '#9a6a38');
        if (y === 20 || y === 26) P(xl, y, n, 1, '#4a5058');
      }
      if (cl > 0.8) P(ACX + 3, 23, 2, 2, '#ffd54a');
    }
    // sign post and the glowing TWR signboard (drawn after the hill so it stands in front)
    P(7, 13, 4, 18, OL); P(8, 13, 2, 18, '#8a5a30'); P(8, 13, 1, 18, '#a8713c');
    P(0, 4, 17, 9, OL); P(1, 5, 15, 7, '#04140c');
    { const col = HM.away ? '#2f8a5c' : ((k >> 3) & 1 ? '#8dffc6' : '#00ff9c'); let lx = 2;
      for (const ch of 'TWR') { const f = FONT[ch]; for (let r = 0; r < 5; r++) for (let c = 0; c < f[0].length; c++) if (f[r][c] === '#') { P(lx + c - 1, 6 + r, 3, 1, '#0b3a22'); P(lx + c, 5 + r, 1, 3, '#0b3a22'); } lx += f[0].length + 1; }
      lx = 2; for (const ch of 'TWR') { const f = FONT[ch]; for (let r = 0; r < 5; r++) for (let c = 0; c < f[0].length; c++) if (f[r][c] === '#') P(lx + c, 6 + r, 1, 1, col); lx += f[0].length + 1; } }
    // ground: grass edge, soil with the carrot patch
    P(0, GY, HW, 1, hc[3]); P(0, GY + 1, HW, 1, hc[4]); P(0, GY + 2, HW, HR - GY - 2, hc[5]);
    for (let x = 1; x < HW; x += 5) P(x, GY, 1, 1, hc[0]);
    P(0, GY + 3, HW, 1, evening ? '#2a1a0a' : '#4a2d15'); P(0, GY + 5, HW, 1, evening ? '#2a1a0a' : '#4a2d15');
    const n = 5;
    for (let i = 0; i < 5; i++) {
      const cx = 14 + i * 6, sway = (k >> 4) & 1;
      if (i < n) { P(cx - 1, GY - 1, 1, 2, '#1d9a4e'); P(cx + 1 + sway, GY - 1, 1, 2, '#1d9a4e'); P(cx, GY - 2, 1, 3, '#2ad468'); P(cx - 1, GY + 2, 3, 2, '#ff8a1f'); P(cx - 1, GY + 2, 1, 1, '#ffb25a'); P(cx, GY + 4, 1, 1, '#ff8a1f'); }
      else { P(cx, GY, 1, 2, '#2ad468'); P(cx - 1, GY - 1, 1, 1, '#2ad468'); P(cx + 1, GY - 1, 1, 1, '#2ad468'); }
    }
    // mailbox: red flag up for a nudge or a timer (gold), bright red on alert
    P(44, 24, 4, 7, OL); P(45, 25, 2, 6, '#8a5a30');
    art(43, 19, ['.OOOO.', 'OlRRRO', 'OlRRsO', 'OlDDsO', 'OOOOOO'], { O: OL, l: '#f0728d', R: '#d9486b', s: '#a82a4a', D: '#2a0a14' });
    const flag = HM.alert ? '#ff3d6e' : (HM.nudge || AST.tmr.length) ? '#ffd54a' : '#e8e8e8';
    P(47, 15, 2, 5, OL); P(48, 16, 1, 4, '#8a97a0'); P(45, 15, 3, 3, OL); P(46, 16, 2, 1, flag);
    // status light, top-left corner
    const led = HM.alert ? '#ff3d6e' : (HM.nudge || AST.tmr.length) ? '#ffb300' : HM.away ? '#46f0ff' : '#00ff9c';
    if (!(led === '#00ff9c' && (k >> 3) & 1)) P(1, 1, 2, 2, led);
    const tip = homeTipText(); if (tip !== HM.tip) { HM.tip = tip; HM.el.title = tip; }
  }
  function homeTipText() {
    const st = HM.away ? 'out and about' : ({ sleep: 'sleeping', type: 'typing at the monitor', read: 'reading', eat: 'eating a carrot', stretch: 'stretching', look: 'looking at you', wave: 'waving' }[HM.act] || 'at home'), L_ = level();
    return `${CFG.name || 'twr'}'s burrow: ${st} (level ${L_.lvl}, ${CFG.coins} coins)\nClick: ask me anything (Ctrl+Space). Right-click: menu. Hold and drag: move to another corner. The power button on the corner hides the burrow.`;
  }
  
  function buildHome() {
    if (HM.el || !document.body) return;
    const el = document.createElement('div'); el.id = 'twr-home'; el.tabIndex = 0; el.setAttribute('role', 'button'); el.setAttribute('aria-label', 'Open the twr assistant');
    const cv = document.createElement('canvas'); cv.width = HW * HP; cv.height = HR * HP; el.appendChild(cv);
    HM.el = el; HM.cv = cv; HM.g = cv.getContext('2d'); document.body.appendChild(el);
    // the little power button on the burrow's corner, and the peek tab that brings the burrow back
    const pw = document.createElement('button'); pw.type = 'button'; pw.className = 'twr-pwr'; pw.setAttribute('aria-label', 'Hide the burrow');
    pw.title = 'Hide the burrow (Ctrl+Space still opens the assistant; Settings > THE WHITE RABBIT brings it back)';
    pw.innerHTML = '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M6 1v5M3.2 3a4.2 4.2 0 1 0 5.6 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
    for (const ev of ['pointerdown', 'pointerup', 'pointermove', 'contextmenu', 'keydown']) pw.addEventListener(ev, (e) => e.stopPropagation());
    pw.addEventListener('click', (e) => { e.stopPropagation(); setCfg({ home: false }); });
    el.appendChild(pw);
    const pk = document.createElement('button'); pk.type = 'button'; pk.id = 'twr-peek'; pk.setAttribute('aria-label', 'Bring the burrow back');
    pk.title = 'The burrow is hidden. Click to bring it back (Ctrl+Space still opens the assistant).';
    pk.innerHTML = '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path d="M5 8V2h2v6M9 8V2h2v6" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="3" y="8" width="10" height="6" rx="3" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M6 11h1M9 11h1" stroke="currentColor" stroke-width="1.6"/></svg>';
    pk.addEventListener('click', () => setCfg({ home: true }));
    pk.addEventListener('contextmenu', (e) => { homeMenu(e); });
    document.body.appendChild(pk); HM.peek = pk;
    el.addEventListener('pointerenter', () => { HM.hover = true; HM.act = 'look'; HM.spot = 'floor'; HM.until = Date.now() + 1500; kickHome(); });
    el.addEventListener('pointerleave', () => { HM.hover = false; });
    el.addEventListener('contextmenu', (e) => { homeMenu(e); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleAst(); } });
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      HM.drag = { x: e.clientX, y: e.clientY, t: Date.now(), on: false };
      try { el.setPointerCapture(e.pointerId); } catch {}
    });
    el.addEventListener('pointermove', (e) => {
      const d = HM.drag; if (!d) return;
      const dist = Math.hypot(e.clientX - d.x, e.clientY - d.y), held = Date.now() - d.t;
      if (!d.on && (dist > 10 || (held > 350 && dist > 2))) { d.on = true; el.classList.add('drag'); closeAst(); }
      if (d.on) { el.style.left = `${e.clientX - BW / 2}px`; el.style.top = `${e.clientY - BH / 2}px`; }
    });
    const end = (e, cancelled) => {
      const d = HM.drag; HM.drag = null; try { el.releasePointerCapture(e.pointerId); } catch {}
      if (!d) return;
      el.classList.remove('drag');
      if (d.on) {
        const c = (e.clientY < innerHeight / 2 ? 't' : 'b') + (e.clientX < innerWidth / 2 ? 'l' : 'r');
        el.classList.add('snap'); setTimeout(() => el.classList.remove('snap'), 400);
        if (!cancelled && c !== CFG.homeCorner) { CFG.homeCorner = c; saveNow(); fire('twr-config', cfgCopy()); }
        placeHome(); HM.act = 'wave'; HM.until = Date.now() + 2500; kickHome();
      } else if (!cancelled) toggleAst();
    };
    el.addEventListener('pointerup', (e) => end(e, false));
    el.addEventListener('pointercancel', (e) => end(e, true));
  }
  function applyHome() {
    if (!HM.el) return;
    HM.el.style.display = CFG.on && CFG.home ? '' : 'none';
    if (HM.peek) HM.peek.style.display = CFG.on && !CFG.home ? 'grid' : 'none';
    if (!CFG.on) { closeAst(); hideNudge(); }
    placeHome(); kickHome();
  }
  function homeMenu(e) {
    if (typeof window.hsMenu !== 'function') { e.preventDefault(); return; }
    const names = { br: 'bottom-right', bl: 'bottom-left', tr: 'top-right', tl: 'top-left' };
    window.hsMenu(e, [
      { label: 'Open assistant', run: () => openAst() },
      { label: 'Come out', run: comeOut },
      { label: 'Go to sleep', run: () => { HM.forceSleep = Date.now() + 10 * 60e3; HM.act = 'sleep'; HM.spot = 'bed'; HM.until = HM.forceSleep; kickHome(); } },
      '-',
      ...Object.keys(names).map((c) => ({ label: `Move to ${names[c]}`, off: CFG.homeCorner === c, run: () => setCfg({ homeCorner: c }) })),
      '-',
      { label: 'Hide the burrow (Ctrl+Space still works)', run: () => setCfg({ home: false }) },
      { label: 'Turn the rabbit off', run: () => setCfg({ on: false }) },
      { label: 'Settings', run: () => { const n = $q('.nav[data-view="settings"]'); if (n) n.click(); } },
    ], `${CFG.name || 'twr'}'s BURROW`);
  }
  function comeOut() { try { lsSet('hs-twr-until', null); HM.forceSleep = 0; HM.until = 0; if (!randomAct(true)) say(L('idle'), 2400); } catch {} }

  // ---------- queue: one thing at a time ----------
  const QU = [];
  function enqueue(fn, maxWait) { if (QU.length >= 2) return false; QU.push({ fn, t: Date.now(), w: maxWait || 12000 }); return true; }
  function drainQ() { try { if (S.busy || !QU.length || !awake()) return; while (QU.length) { const j = QU.shift(); if (Date.now() - j.t > j.w) continue; if (j.fn() !== false) return; } } catch {} }

  // ---------- poke: global click effects ask the rabbit to scamper out and do something tiny ----------
  function poke(d) { try { d = d || {}; if (S.busy) return enqueue(() => doPoke(d), 4000); return doPoke(d); } catch { return false; } }
  function doPoke(d) {
    try {
      const x = +d.x, y = +d.y;
      if (!isFinite(x) || !isFinite(y) || !awake() || !CFG.on || !build() || reduced() || document.hidden) return false;
      const kind = ['button', 'switch', 'tile', 'input', 'link'].includes(d.kind) ? d.kind : 'generic';
      cancel(); S.busy = true; stat('pokes'); addXp(1); const nw = Date.now(); if (nw - (S.pokeCoin || 0) > 20000) { S.pokeCoin = nw; addCoins(1); }
      const side = x > 150 ? -1 : 1, sx = clamp(x + side * 42, W / 2 + 6, innerWidth - W / 2 - 6), sy = clamp(y + 34, H, innerHeight - 4);
      const pose = { button: 'push', switch: 'wave', tile: 'push', input: 'type', link: 'wave', generic: pick(['wave', 'bob', 'dance']) }[kind];
      stand(sx, sy, { pose, flip: side > 0 });
      const a = arrive(), ring = () => overlay('twr-ripple', { left: x - 12, top: y - 12, width: 24, height: 24 });
      later(a + 250, () => {
        ring();
        if (kind === 'switch') { const t = overlay('twr-toggle'); t.style.left = `${x - 20}px`; t.style.top = `${y - 36}px`; t.classList.add('on'); later(500, () => t.classList.remove('on')); }
        else if (kind === 'input') { const c = overlay('twr-caret', null, '▌'); c.style.left = `${x - 6}px`; c.style.top = `${y - 10}px`; }
        else if (kind === 'tile') { for (let i = 0; i < 6; i++) later(i * 100, () => particle('spark', pick(['1', '0']), x + rnd(-22, 22), y + rnd(-12, 10))); }
        else if (kind === 'link') { for (let i = 0; i < 3; i++) later(i * 140, () => particle('spark', '→', x + rnd(-10, 10), y + rnd(-8, 4))); }
        else { particle('spark', '✦', x, y - 6); particle('spark', '+', x + 9, y - 14); }
      });
      later(a + 1000, () => {
        setPose('wave');
        const lb = String(d.label || '').replace(/\s+/g, ' ').trim().slice(0, 16);
        if (lb && Math.random() < 0.3) bubbleText(pick([`Pressed "${lb}" for you.`, `Done: "${lb}".`, `You chose "${lb}". On it.`]), 1800);
      });
      stayThenHide(a + 2000);
      return true;
    } catch (e) { S.busy = false; return false; }
  }

  // =====================================================================================================
  // ASSISTANT: a small terminal anchored over the burrow. Real commands, run through the app's own APIs.
  // =====================================================================================================
  const JOKES = [
    'There are 10 kinds of people: those who understand binary and those who do not.', 'A SQL query walks into a bar, sees two tables, asks: can I join you?',
    'It works on my machine. Ship the machine.', 'To understand recursion, first understand recursion.', 'There is no place like 127.0.0.1.',
    'Why do programmers prefer dark mode? Light attracts bugs.', 'I would tell you a UDP joke, but you might not get it.', 'A byte walks into a bar looking pale. "Got a bit of a parity problem."',
    '!false is funny because it is true.', 'Off-by-one errors are the second hardest bug. And the second hardest bug.', 'Real programmers count from 0. Real rabbits count carrots.',
  ];
  const TAB_ALIASES = { ops: 'nexus', operations: 'nexus', home: 'nexus', dash: 'nexus', main: 'nexus', fan: 'afterburner', fans: 'afterburner', cooling: 'afterburner', burner: 'afterburner', temps: 'afterburner', visuals: 'vj', music: 'crate', dj: 'crate', audio: 'deck', files: 'router', file: 'router', privacy: 'senses', mic: 'senses', camera: 'senses', journal: 'notes', tasks: 'todo', 'to-do': 'todo', usb: 'hardware', hw: 'hardware', prefs: 'settings', options: 'settings', game: 'games', expert: 'experts' };
  function resolveTab(q) {
    q = String(q || '').toLowerCase().trim(); if (!q) return null;
    const navs = [...document.querySelectorAll('.nav[data-view]')], names = navs.map((n) => n.dataset.view);
    if (names.includes(q)) return q;
    if (TAB_ALIASES[q] && names.includes(TAB_ALIASES[q])) return TAB_ALIASES[q];
    let m = names.find((n) => n.startsWith(q)); if (m) return m;
    const al = Object.keys(TAB_ALIASES).find((a) => a.startsWith(q) && names.includes(TAB_ALIASES[a])); if (al) return TAB_ALIASES[al];
    m = q.length > 1 && names.find((n) => n.includes(q)); if (m) return m;
    const n2 = q.length > 2 && navs.find((n) => (n.getAttribute('title') || '').toLowerCase().includes(q)); return n2 ? n2.dataset.view : null;
  }
  const gotoTab = (v) => {
    if (v === 'vj') { const c = $q('.nav[data-view="crate"]'); if (!c) return false; c.click(); setTimeout(() => { try { if (window.HS && HS.setCrateSection) HS.setCrateSection('vj'); else { const b = $q('#cr-secseg button[data-sec="vj"]'); if (b) b.click(); } } catch {} }, 60); return true; }
    const n = $q(`.nav[data-view="${v}"]`); if (n) { n.click(); return true; } return false; };
  const sbText = (id) => { const e = document.getElementById(id); return e ? (e.textContent || '').replace(/\s+/g, ' ').trim() : ''; };
  function hotNow() { let mx = 0; const re = /(\d{2,3})\s*°/g, tx = sbText('sb-temps'); let m; while ((m = re.exec(tx))) mx = Math.max(mx, +m[1]); return mx; }
  function lowDisk() {
    const tx = sbText('sb-drives'), re = /([A-Za-z]):?\\?\s*([\d.,]+)\s*(KB|MB|GB|TB)\s+free/gi; let m, low = null;
    while ((m = re.exec(tx))) { const gb = parseFloat(m[2].replace(',', '.')) * { KB: 1e-6, MB: 1e-3, GB: 1, TB: 1000 }[m[3].toUpperCase()]; if (gb < 15 && (!low || gb < low.gb)) low = { d: m[1].toUpperCase(), gb }; }
    return low;
  }
  const fmtMs = (ms) => { const s = Math.round(ms / 1000); return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`; };
  const hsCall = (...a) => { if (!(window.hs && typeof hs.call === 'function')) throw new Error('not available here'); return hs.call(...a); };

  // ---- fuzzy match: higher is better, 0 = no match. q and s are lower-case.
  function fz(q, s) {
    if (!q) return 1; if (!s) return 0;
    if (s === q) return 100;
    if (s.startsWith(q)) return 85 - Math.min(20, (s.length - q.length) * 0.4);
    const i = s.indexOf(q);
    if (i >= 0) return (i === 0 || /[\s\-_:/>]/.test(s[i - 1]) ? 72 : 56) - Math.min(10, i * 0.2);
    const ws = q.split(/\s+/).filter(Boolean);
    if (ws.length > 1 && ws.every((w) => s.includes(w))) return 52;
    if (q.length < 3) return 0;
    let j = 0, gaps = 0, last = -1;
    for (const ch of q) { const k = s.indexOf(ch, j); if (k < 0) return 0; if (last >= 0 && k !== last + 1) gaps++; last = k; j = k + 1; }
    return Math.max(8, 32 - gaps * 4 - (s.length - q.length) * 0.15);
  }
  const strictFz = (q, s) => { const v = fz(q, s); return v >= 50 ? v : 0; };

  const AST = { el: null, out: null, inp: null, list: null, open: false, spot: false, log: [], hist: [], hi: -1, tmr: [], greeted: false, items: [], sel: 0 };
  try { AST.hist = (JSON.parse(lsGet('hs-twr-hist') || '[]') || []).filter((x) => typeof x === 'string').slice(-25); } catch {}
  let FAV = {}; try { FAV = JSON.parse(lsGet('hs-twr-fav') || '{}') || {}; } catch {}
  const favBump = (k) => { try { if (!k) return; FAV[k] = (FAV[k] || 0) + 1; const ks = Object.keys(FAV); if (ks.length > 60) { ks.sort((a, b) => FAV[a] - FAV[b]).slice(0, 20).forEach((x) => delete FAV[x]); } lsSet('hs-twr-fav', JSON.stringify(FAV)); } catch {} };
  const favBoost = (k) => Math.min(15, (FAV[k] || 0) * 3);

  // ---- what the assistant can do: commands (n = name, al = other names, arg = takes text, kw = extra search words)
  const CMDLIST = [
    { n: 'todo', ic: '☑', h: 'add a to-do (General)', arg: 1, kw: 'task add remind list' },
    { n: 'note', ic: '✎', h: 'add a line to "Sidedock notes"', arg: 1, kw: 'jot write memo' },
    { n: 'open', ic: '⇢', h: 'jump to a tab (fans, crate, notes...) or "vj" for the CRATE VJ section', arg: 1, kw: 'go goto page tab show' },
    { n: 'find', ic: '⌕', h: 'open FIND with these words', arg: 1, opt: 1, kw: 'search' },
    { n: 'temps', ic: '♨', h: 'temperatures, disks, battery', al: ['status', 'temp'], kw: 'hot cpu gpu heat warm' },
    { n: 'timer', ic: '⏲', h: 'timer 10m tea: I shout when it is done', arg: 1, opt: 1, kw: 'alarm countdown remind' },
    { n: 'volume', ic: '♪', h: 'volume 30, up or down', arg: 1, opt: 1, kw: 'sound loud quiet audio', al: ['vol'] },
    { n: 'mute', ic: '⊘', h: 'mute the master volume', kw: 'silence sound' },
    { n: 'unmute', ic: '♫', h: 'unmute the master volume', kw: 'sound' },
    { n: 'music', ic: '▶', h: 'music play / pause / next / prev', arg: 1, opt: 1, al: ['play', 'pause', 'next', 'prev', 'skip'], kw: 'song track spotify' },
    { n: 'fans', ic: '❋', h: 'fans auto / quiet / balanced / cool / max', arg: 1, al: ['fan'], kw: 'cooling noise loud hot' },
    { n: 'mode', ic: '⚡', h: 'power mode: gamer / silent / eco', arg: 1, kw: 'power performance battery' },
    { n: 'settings', ic: '⚙', h: 'jump to a Settings tab', arg: 1, opt: 1, kw: 'options preferences config' },
    { n: 'theme', ic: '✧', h: 'VJ theme by name, or next / random', arg: 1, opt: 1, kw: 'vj visual visualizer' },
    { n: 'accent', ic: '◐', h: 'accent colour: green, cyan, purple, pink...', arg: 1, opt: 1, kw: 'colour color look' },
    { n: 'lock', ic: '⚿', h: 'lock the notes journal', al: ['lock notes'], kw: 'notes journal secure' },
    { n: 'mic', ic: '◉', h: 'toggle the microphone shield', kw: 'microphone privacy' },
    { n: 'camera', ic: '◎', h: 'toggle the camera shield', al: ['cam'], kw: 'webcam privacy' },
    { n: 'ram', ic: '⌫', h: 'clean up RAM', al: ['vacuum'], kw: 'memory free speed' },
    { n: 'joke', ic: '☺', h: 'tell a joke', kw: 'funny' },
    { n: 'dance', ic: '♬', h: 'dance', kw: 'party' },
    { n: 'hack', ic: '⌨', h: 'open the hacker terminal', kw: 'terminal matrix' },
    { n: 'recap', ic: '☰', h: 'my week in a few lines', kw: 'week summary habits memory' },
    { n: 'name', ic: '☺', h: 'name Sam: I will call you that', arg: 1, opt: 1, kw: 'call me nickname' },
    { n: 'forget', ic: '⌫', h: 'wipe what I remember about your habits', kw: 'memory reset habits' },
    { n: 'stats', ic: '★', h: 'my level, coins and counters', al: ['stat'], kw: 'level xp coins' },
    { n: 'help', ic: '?', h: 'what can I ask?', al: ['?', 'h'], kw: 'what can you do commands' },
    { n: 'clear', ic: '⌧', h: 'clear this log', al: ['cls'], kw: '' },
  ];
  const CLOSERS = new Set(['open', 'settings', 'find', 'hack']);
  const cmdOf = (w) => { w = String(w || '').toLowerCase(); return CMDLIST.find((c) => c.n === w || (c.al || []).includes(w)); };

  // ---- app features and what to say for them (FIND-style words), each opens a tab or clicks something real
  const goView = (v, then) => () => { gotoTab(v); if (then) setTimeout(then, 160); };
  const fillIn = (v, sel, q) => () => { gotoTab(v); setTimeout(() => { const i = $q(sel); if (i) { i.value = q; i.dispatchEvent(new Event('input', { bubbles: true })); i.focus(); } }, 260); };
  const FEATS = [
    ['Mic & camera shields', 'OPERATIONS', 'privacy microphone webcam kill switch block', () => gotoTab('nexus')],
    ['Task manager', 'OPERATIONS: running apps', 'processes task manager entities kill end close running', () => gotoTab('nexus')],
    ['Cooling & fans', 'FANS: one-click QUIET / BALANCED / COOL / MAX', 'fan fans cooling noise loud quiet hot temperature curve', () => gotoTab('afterburner')],
    ['Power modes & clocks', 'FANS: GAMER / SILENT / ECO', 'power mode performance battery eco silent gamer overclock clock', () => gotoTab('afterburner')],
    ['Overheat protocol', 'FANS: alarm + max fans when hot', 'overheat alarm throttle safety', () => gotoTab('afterburner')],
    ['VJ visualizer (CRATE)', 'CRATE > VJ: visuals that dance to music', 'vj visuals visualizer lights spout resolume wallpaper', () => gotoTab('vj')],
    ['CRATE: your music', 'rekordbox library, BPM, keys, cues', 'music library rekordbox tracks songs bpm key dj decks crate', () => gotoTab('crate')],
    ['Audio, media & displays', 'DECK: volume, now playing, screens', 'audio sound volume media display monitor screen deck', () => gotoTab('deck')],
    ['File router', 'sort your downloads automatically', 'router file downloads sort organise organize', () => gotoTab('router')],
    ['NOTES', 'your encrypted notebook', 'notes notebook onenote write diary journal', () => gotoTab('notes')],
    ['TO-DO', 'your list and the quest line', 'todo to-do tasks list checklist quest xp', () => gotoTab('todo')],
    ['GAMES', 'blackjack, spades, poker', 'games play cards casino', () => gotoTab('games')],
    ['Blackjack', 'GAMES', '21 cards casino', goView('games', () => { try { window.GAMES && GAMES.open('blackjack'); } catch {} })],
    ['Spades', 'GAMES', 'cards partner trick', goView('games', () => { try { window.GAMES && GAMES.open('spades'); } catch {} })],
    ['Poker', 'GAMES: hold’em, draw, video poker', 'texas holdem cards', goView('games', () => { try { window.GAMES && GAMES.open('poker'); } catch {} })],
    ['HARDWARE: ports & power', 'every USB socket, with speed and power', 'usb ports hub power voltage battery type-c devices', () => gotoTab('hardware')],
    ['Phone link', 'control HYPERSPACE from your phone', 'phone iphone remote qr mobile', () => { const b = $q('#link-btn'); if (b) b.click(); }],
    ['Widgets', 'add or move cards on a page', 'widgets cards customise customize layout', () => { const b = $q('#widgets-btn'); if (b) b.click(); }],
    ['SENSES', 'who used the mic or camera', 'senses privacy listened watched', () => gotoTab('senses')],
  ];

  // ---- looking inside the live app: Settings tabs and headings, found by scanning the page
  const txtOf = (el) => { const c = el.cloneNode(true); c.querySelectorAll('.hint, .right, .glyph, em, button, input, select, small, svg').forEach((n) => n.remove()); return (c.textContent || '').replace(/\s+/g, ' ').trim(); };
  const DOMX = { t: 0, tabs: [], tiles: [] };
  function domIndex() {
    if (Date.now() - DOMX.t < 20000) return DOMX; DOMX.t = Date.now();
    try {
      DOMX.tabs = [...document.querySelectorAll('#set-tabs [data-st]')].filter((b) => b.dataset.st !== 'rabbit' || CFG.found).map((b) => ({ st: b.dataset.st, t: (b.textContent || '').trim() })).filter((b) => b.t);
      const seen = new Set(), tiles = [];
      document.querySelectorAll('#view-settings .panel-head, #view-settings .set-l').forEach((h) => {
        const t = txtOf(h); if (t.length < 3 || t.length > 60 || seen.has(t.toLowerCase())) return; seen.add(t.toLowerCase());
        const pg = h.closest('.set-page'); if (pg && pg.dataset.page === 'rabbit' && !CFG.found) return;
        tiles.push({ t, page: pg ? pg.dataset.page : '', el: h });
      });
      DOMX.tiles = tiles;
    } catch {}
    return DOMX;
  }
  const settingsJump = (st, el) => () => { gotoTab('settings'); setTimeout(() => { const b = $q(`#set-tabs [data-st="${st}"]`); if (b) b.click(); if (el) setTimeout(() => { try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {} }, 180); }, 80); };

  // ---- live data sources (fetched lazily through the app's own APIs, cached)
  const SRC = { tr: null, trT: 0, no: null, noT: 0, td: null, tdT: 0, pr: null, prT: 0 };
  function srcRefresh() {
    if (!(window.hs && typeof hs.call === 'function')) return;
    const now = Date.now(), jobs = [], ok = (p) => Promise.resolve(p).catch(() => null);
    if (now - SRC.noT > 45000) { SRC.noT = now; jobs.push(ok(hs.call('notesList')).then((l) => { SRC.no = (Array.isArray(l) ? l : []).filter((n) => n && !n.deleted && !n.journal && n.title).slice(0, 600); })); }
    if (now - SRC.tdT > 20000) { SRC.tdT = now; jobs.push(ok(hs.call('todoGet')).then((s) => { SRC.td = ((s && s.tasks) || []).filter((t) => t && !t.done && t.text).slice(0, 300); })); }
    if (now - SRC.prT > 15000) { SRC.prT = now; jobs.push(ok(hs.call('procs')).then((l) => { const m = new Map(); for (const p of Array.isArray(l) ? l : []) if (p && p.name && !m.has(p.name.toLowerCase())) m.set(p.name.toLowerCase(), p); SRC.pr = [...m.values()].slice(0, 400); })); }
    if (now - SRC.trT > 10 * 60e3) { SRC.trT = now; jobs.push(ok(hs.call('libLite')).then((l) => { SRC.tr = ((l && l.tracks) || []).slice(0, 8000); })); }
    if (jobs.length) Promise.all(jobs).then(() => { if (AST.open) renderSug(true); });
  }

  // ---- phrases people actually type, mapped onto real commands
  function natural(q) {
    const out = [], add = (cmd, t, h, ic) => out.push({ ic: ic || '→', t, h: h || cmd, cmd, s: 160, id: cmd }); let m;
    const cl = (x) => String(x || '').trim().replace(/[.!?]+$/, '');
    if ((m = q.match(/^(?:please\s+)?(?:add|put)\s+(.+?)\s+(?:to|on|in)\s+(?:my\s+)?(?:to-?do(?:\s*list)?|list|tasks?)$/i))) add(`todo ${cl(m[1])}`, `Add to your to-do list: ${cl(m[1])}`, 'todo', '☑');
    else if ((m = q.match(/^(?:remind me to|don'?t let me forget to|i need to|i have to)\s+(.+)$/i))) add(`todo ${cl(m[1])}`, `Add to your to-do list: ${cl(m[1])}`, 'todo', '☑');
    if ((m = q.match(/^(?:take a note|note down|note that|jot(?: down)?|write down|remember(?: that)?)\s*:?\s*(.+)$/i))) add(`note ${cl(m[1])}`, `Jot a note: ${cl(m[1])}`, 'note', '✎');
    if ((m = q.match(/^(?:open|go to|goto|show me|show|take me to|switch to|launch|bring up)\s+(?:my\s+|the\s+)?(.+?)(?:\s+(?:tab|page|screen|view))?$/i))) {
      const t = resolveTab(cl(m[1])); if (t) add(`open ${t}`, `Open ${TABNAME[t] || t.toUpperCase()}`, 'open ' + t, '⇢');
      else if (domIndex().tabs.some((x) => fz(cl(m[1]).toLowerCase(), x.t.toLowerCase()) >= 50)) add(`settings ${cl(m[1])}`, `Open Settings: ${cl(m[1])}`, 'settings', '⚙');
    }
    if (/\b(how\s+(?:hot|warm)|what(?:'s| is) the temp|temperatures?|cpu temp|gpu temp|is (?:it|my \w+) (?:hot|overheating)|overheat)/i.test(q)) add('temps', 'How hot is it? (temperatures and disks)', 'temps', '♨');
    if (/\b(volume|sound|audio|music)\b.*\b(down|lower|quieter|softer|less)\b|\b(lower|turn down|decrease|reduce)\b.*\b(volume|sound)\b|\bquieter\b/i.test(q) && !/fan/i.test(q)) add('volume down', 'Turn the volume down', 'volume down', '♪');
    if (/\b(volume|sound|audio|music)\b.*\b(up|raise|louder|higher|more)\b|\b(raise|turn up|increase)\b.*\b(volume|sound)\b|\blouder\b/i.test(q) && !/fan/i.test(q)) add('volume up', 'Turn the volume up', 'volume up', '♪');
    if (/^(?:please\s+)?(?:mute|silence|shut up)\b/i.test(q) && !/mic/i.test(q)) add('mute', 'Mute the master volume', 'mute', '⊘');
    if (/^(?:please\s+)?unmute\b/i.test(q)) add('unmute', 'Unmute the master volume', 'unmute', '♫');
    if ((m = q.match(/\bvolume\s+(?:to\s+)?(\d{1,3})\s*%?/i))) add(`volume ${m[1]}`, `Set the volume to ${Math.min(100, +m[1])}%`, 'volume ' + m[1], '♪');
    if (/\b(quiet|silence|calm|hush|soften)\b.*\bfans?\b|\bfans?\b.*\b(quiet|silent|down|too loud|louder than)\b|\b(my )?fans? (?:are )?(?:so |too )?loud\b/i.test(q)) add('fans quiet', 'Quiet the fans', 'fans quiet', '❋');
    else if (/\b(cool|cooler|max|full blast|boost)\b.*\bfans?\b|\bfans?\b.*\b(max|full|cool|cooler|faster)\b|\bcool (?:it|me|this) down\b/i.test(q)) add('fans max', 'Fans to MAX', 'fans max', '❋');
    if (/\block\b.*\b(notes?|journal)\b|\b(notes?|journal)\b.*\block\b/i.test(q)) add('lock', 'Lock the notes journal', 'lock', '⚿');
    if (/\b(clean|free|clear|speed up)\b.*\b(ram|memory)\b|\b(ram|memory)\b.*\b(clean|free|full)\b/i.test(q)) add('ram', 'Clean up RAM', 'ram', '⌫');
    if (/^(?:please\s+)?(?:play|pause|resume|stop)(?:\s+(?:the\s+)?(?:music|song|track|playback))?$/i.test(q)) add('music toggle', 'Play / pause the music', 'music', '▶');
    if (/^(?:please\s+)?(?:skip|next)(?:\s+(?:the\s+)?(?:song|track))?$/i.test(q)) add('music next', 'Next track', 'music next', '▶');
    if (/^(?:please\s+)?(?:prev|previous|go back)(?:\s+(?:the\s+)?(?:song|track))?$/i.test(q)) add('music prev', 'Previous track', 'music prev', '▶');
    if (/^(?:what|how)\b.*\b(?:can|could|do)\b.*\b(?:you|i)\b.*\b(?:do|ask|say|use)\b|^help\b|^commands?\b|^cheat ?sheet\b/i.test(q)) add('help', 'What can I ask? (the cheat sheet)', 'help', '?');
    if (/^(?:tell me )?(?:a )?joke\b/i.test(q)) add('joke', 'Tell a joke', 'joke', '☺');
    if (/^(?:dance|boogie|party)\b/i.test(q)) add('dance', 'Dance', 'dance', '♬');
    if (/^(?:hack|hacker|terminal|matrix)\b/i.test(q)) add('hack', 'Open the hacker terminal', 'hack', '⌨');
    if ((m = q.match(/^(?:set\s+)?(?:a\s+)?timer\s+(?:for\s+)?(.+)$/i))) add(`timer ${cl(m[1])}`, `Timer: ${cl(m[1])}`, 'timer', '⏲');
    if (/\b(?:turn|switch|toggle|kill|block)\b.*\b(?:mic|microphone)\b/i.test(q)) add('mic', 'Toggle the microphone shield', 'mic', '◉');
    if (/\b(?:turn|switch|toggle|kill|block)\b.*\b(?:camera|webcam)\b/i.test(q)) add('camera', 'Toggle the camera shield', 'camera', '◎');
    return out;
  }

  function suggest(raw) {
    const q = String(raw || '').trim(), low = q.toLowerCase(), out = [];
    if (!q) {
      const seen = new Set();
      for (const h of AST.hist.slice().reverse().slice(0, 4)) { if (seen.has(h)) continue; seen.add(h); const c = cmdOf(h.split(/\s+/)[0]); out.push({ ic: '⟲', t: h, h: 'recent', cmd: c ? h : null, fill: h, fillOnly: !c, s: 90, id: 'h:' + h }); }
      const pop = Object.keys(FAV).sort((a, b) => FAV[b] - FAV[a]).filter((k) => !seen.has(k) && FAV[k] >= 2).slice(0, 2);
      for (const k of pop) { const c = cmdOf(k.split(/\s+/)[0]); out.push({ ic: '★', t: k, h: 'favourite', cmd: c ? k : null, fill: k, fillOnly: !c, s: 85, id: 'f:' + k }); }
      out.push({ ic: '—', t: 'WHAT CAN I ASK?', h: 'pick one, or just start typing', s: 80, hdr: true });
      const ex = [['☑', 'todo buy carrots', 'add a to-do', 'todo '], ['✎', 'note a thought', 'jot it in your notes', 'note '], ['⇢', 'open fans', 'jump to any tab', 'open '], ['♨', 'how hot is my cpu', 'temperatures and disks', null, 'temps'],
        ['⏲', 'timer 10m tea', 'I shout when it is done', 'timer '], ['♪', 'volume 30  /  mute', 'master volume', 'volume '], ['❋', 'fans quiet', 'quiet / balanced / cool / max', 'fans '], ['⚙', 'settings display', 'jump to a Settings tab', 'settings '],
        ['✧', 'theme next', 'VJ themes by name', 'theme '], ['⌕', 'a song, a note, a setting...', 'I search CRATE, NOTES, TO-DO, apps and every Settings heading', null, null, true]];
      for (const e of ex) out.push({ ic: e[0], t: e[1], h: e[2], fill: e[3] || '', fillOnly: !e[4] && !!e[3], cmd: e[4] || null, s: 50, id: 'x:' + e[1], info: !!e[5] });
      return out;
    }
    const add = (o) => out.push(o);
    // 1. a command word first, with or without text after it
    const pm = q.match(/^(\S+)\s*([\s\S]*)$/), w = pm[1].toLowerCase(), arg = pm[2].trim();
    for (const c of CMDLIST) {
      const names = [c.n, ...(c.al || [])], exact = names.includes(w);
      if (exact) {
        const line = (c.al && c.al.includes(w) && ['play', 'pause', 'next', 'prev', 'skip'].includes(w)) ? `music ${w === 'play' || w === 'pause' ? 'toggle' : w === 'skip' ? 'next' : w}` : `${w} ${arg}`.trim();
        if (c.arg && !c.opt && !arg) add({ ic: c.ic, t: `${c.n} <${c.n === 'todo' || c.n === 'note' ? 'text' : 'what'}>`, h: c.h, fill: `${c.n} `, fillOnly: true, s: 96, id: c.n });
        else add({ ic: c.ic, t: line, h: c.h, cmd: line, s: arg ? 200 : 96, id: c.n, close: CLOSERS.has(c.n) && !!arg || c.n === 'hack' });
      } else if (!arg) {
        const pre = names.some((n) => n.startsWith(w)), sc = pre ? 92 : Math.max(fz(low, c.n), fz(low, ((c.kw || '') + ' ' + c.h).toLowerCase()) * 0.7);
        if (sc > 14) add({ ic: c.ic, t: c.n + (c.arg ? ' …' : ''), h: c.h, cmd: c.arg ? null : c.n, fill: c.arg ? `${c.n} ` : c.n, fillOnly: !!c.arg, s: sc + favBoost(c.n), id: c.n, close: CLOSERS.has(c.n) });
      }
    }
    // 2. natural phrases
    for (const n of natural(q)) add({ ...n, close: CLOSERS.has(n.cmd.split(' ')[0]) });
    // 3. tabs
    for (const nv of document.querySelectorAll('.nav[data-view]')) {
      const v = nv.dataset.view, name = TABNAME[v] || v.toUpperCase(), al = Object.keys(TAB_ALIASES).filter((a) => TAB_ALIASES[a] === v).join(' ');
      const sc = Math.max(fz(low, name.toLowerCase()), fz(low, v), fz(low, al) * 0.9, fz(low, (nv.getAttribute('title') || '').toLowerCase()) * 0.8);
      if (sc >= 50) add({ ic: '⇢', t: `Open ${name}`, h: 'tab', cmd: `open ${v}`, s: sc * 1.15 + favBoost('open ' + v), id: 'open ' + v, close: true });
    }
    // 4. features
    for (const f of FEATS) { const sc = Math.max(fz(low, f[0].toLowerCase()), strictFz(low, f[2]) * 0.85); if (sc >= 50) add({ ic: '◈', t: f[0], h: f[1], run: f[3], s: sc * 1.05, id: 'ft:' + f[0], close: true }); }
    // 5. Settings tabs and headings
    const dx = domIndex();
    for (const tb of dx.tabs) { const sc = fz(low, tb.t.toLowerCase()); if (sc >= 50 && /^(set|setting|settings|options|prefs)/.test(low) || sc >= 72) add({ ic: '⚙', t: `Settings: ${tb.t}`, h: 'settings tab', cmd: `settings ${tb.t}`, s: sc * 1.0, id: 'st:' + tb.st, close: true }); }
    for (const tl of dx.tiles) { const sc = strictFz(low, tl.t.toLowerCase()); if (sc) { const tb = dx.tabs.find((x) => x.st === tl.page); add({ ic: '⚙', t: tl.t, h: `Settings${tb ? ' > ' + tb.t : ''}`, run: settingsJump(tl.page || 'general', tl.el), s: sc * 0.95, id: 'se:' + tl.t, close: true }); } }
    // 6. your own stuff (needs a couple of letters)
    if (q.length >= 2) {
      srcRefresh();
      for (const n of SRC.no || []) { const sc = strictFz(low, String(n.title).toLowerCase()); if (sc) add({ ic: '✎', t: n.title, h: `NOTES${n.notebook ? ' > ' + n.notebook : ''}`, run: fillIn('notes', '#nt-q', n.title), s: sc * 0.95, id: 'no:' + n.id, close: true }); }
      for (const t of SRC.td || []) { const sc = strictFz(low, String(t.text).toLowerCase()); if (sc) add({ ic: '☐', t: String(t.text).slice(0, 70), h: 'TO-DO', run: () => gotoTab('todo'), s: sc * 0.9, id: 'td:' + t.id, close: true }); }
      for (const p of SRC.pr || []) { const sc = strictFz(low, String(p.name).toLowerCase()); if (sc) add({ ic: '⌬', t: p.name, h: `running app${p.cpu != null ? ' · ' + (+p.cpu).toFixed(0) + '% cpu' : ''}`, run: fillIn('nexus', '#proc-search', String(p.name).replace(/\.exe$/i, '')), s: sc * 0.9, id: 'pr:' + p.name, close: true }); }
      if (q.length >= 2) {
        let n = 0; for (const t of SRC.tr || []) { const hay = `${t.title || ''} ${t.artist || ''}`.toLowerCase(), sc = Math.max(strictFz(low, String(t.title || '').toLowerCase()), strictFz(low, hay) * 0.95); if (sc) { add({ ic: '♫', t: String(t.title || 'untitled').slice(0, 60), h: `${t.artist || 'CRATE'}${t.bpm ? ' · ' + Math.round(t.bpm) + ' bpm' : ''}`, run: fillIn('crate', '#cr-search', String(t.title || '')), s: sc * 0.9, id: 'tr:' + t.id, close: true }); if (++n >= 60) break; } }
      }
    }
    // 7. always something to fall back on
    add({ ic: '⌕', t: `Search everything for “${q}”`, h: 'opens FIND', cmd: `find ${q}`, s: 6, id: 'fd', close: true });
    add({ ic: '☑', t: `Add to-do: ${q}`, h: 'todo', cmd: `todo ${q}`, s: 5, id: 'td+' });
    return out;
  }
  const IC_CLS = (ic) => (ic === '—' ? ' hdr' : '');
  function renderSug(keep) {
    if (!AST.list) return;
    const q = AST.inp.value, prev = keep && AST.items[AST.sel] ? AST.items[AST.sel].id : null;
    let items = suggest(q);
    if (q.trim()) { const seen = new Set(); items = items.filter((i) => { const k = i.id || i.t; if (seen.has(k)) return false; seen.add(k); return true; }); items.sort((a, b) => b.s - a.s); items = items.slice(0, 9); }
    AST.items = items;
    let sel = prev ? items.findIndex((i) => i.id === prev) : 0; if (sel < 0) sel = 0;
    const pick = (k) => { for (let d = 0; d < items.length; d++) { const j = (k + d) % items.length; if (!items[j].hdr && !items[j].info) return j; } return 0; };
    AST.sel = items.length ? pick(sel) : 0;
    AST.list.textContent = '';
    items.forEach((it, i) => {
      const r = document.createElement('div'); r.className = `ta-r${i === AST.sel ? ' on' : ''}${it.hdr ? ' hdr' : ''}${it.info ? ' info' : ''}`; r.dataset.i = String(i);
      const ic = document.createElement('i'); ic.textContent = it.ic; const b = document.createElement('b'); b.textContent = it.t; const sp = document.createElement('span'); sp.textContent = it.h || '';
      r.append(ic, b, sp); AST.list.appendChild(r);
    });
    if (!items.length) { const e = document.createElement('div'); e.className = 'ta-none'; e.textContent = 'nothing yet. Keep typing, or press Enter to run it as a command.'; AST.list.appendChild(e); }
    const on = AST.list.querySelector('.ta-r.on'); if (on) { try { on.scrollIntoView({ block: 'nearest' }); } catch {} }
  }
  function moveSel(d) {
    const n = AST.items.length; if (!n) return;
    let k = AST.sel; for (let i = 0; i < n; i++) { k = (k + d + n) % n; if (!AST.items[k].hdr && !AST.items[k].info) break; }
    AST.sel = k; AST.list.querySelectorAll('.ta-r').forEach((r, i) => r.classList.toggle('on', i === k));
    const on = AST.list.querySelector('.ta-r.on'); if (on) { try { on.scrollIntoView({ block: 'nearest' }); } catch {} }
  }
  function remember(text) {
    text = String(text || '').trim(); if (!text) return;
    AST.hist = AST.hist.filter((h) => h !== text); AST.hist.push(text); AST.hist = AST.hist.slice(-25); lsSet('hs-twr-hist', JSON.stringify(AST.hist));
  }
  async function go(it) {
    try {
      if (!it || it.hdr || it.info) return;
      if (it.fillOnly) { AST.inp.value = it.fill || ''; AST.inp.focus(); renderSug(); return; }
      const typed = AST.inp.value.trim();
      favBump(it.id); remember(it.cmd || typed || it.t);
      AST.inp.value = ''; AST.hi = -1;
      if (it.cmd) await runCmd(it.cmd);
      else if (it.run) { addLine(`> ${it.t}`, 'cmd'); HM.act = 'type'; HM.spot = 'desk'; HM.until = Date.now() + 3000; await it.run(); stat('cmds'); addXp(1); addLine(`ok: ${it.h || it.t}`, 'ok'); }
      if (it.close) closeAst(); else renderSug();
    } catch (e) { addLine(`error: ${(e && e.message) || e}`, 'err'); }
  }

  function buildAst() {
    if (AST.el || !document.body) return;
    const el = document.createElement('div'); el.id = 'twr-ast';
    el.innerHTML = '<div class="ta-h"><b></b><span>ASSISTANT</span><button class="ta-x" title="Close (Esc)" aria-label="Close">×</button></div><label class="ta-in"><i>&gt;</i><input spellcheck="false" autocomplete="off" placeholder="ask me anything, or start typing…"></label><div class="ta-sug" role="listbox"></div><div class="ta-out" aria-live="polite"></div><div class="ta-foot">↑↓ pick · Tab complete · Enter run · Esc close</div>';
    document.body.appendChild(el); AST.el = el; AST.out = el.querySelector('.ta-out'); AST.inp = el.querySelector('input'); AST.list = el.querySelector('.ta-sug');
    el.querySelector('b').textContent = `${CFG.name || 'twr'}@burrow`;
    el.querySelector('.ta-x').addEventListener('click', closeAst);
    el.addEventListener('keydown', (e) => { if (!(e.ctrlKey || e.metaKey)) e.stopPropagation(); }, false);
    AST.inp.addEventListener('input', () => { AST.hi = -1; renderSug(); });
    AST.inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); const it = AST.items[AST.sel], v = AST.inp.value; if (it && !it.hdr && !it.info) go(it); else if (v.trim()) { remember(v.trim()); AST.inp.value = ''; renderSug(); runCmd(v); } }
      else if (e.key === 'ArrowDown') { e.preventDefault(); moveSel(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveSel(-1); }
      else if (e.key === 'Tab') { e.preventDefault(); const it = AST.items[AST.sel]; if (it && !it.hdr && !it.info) { const f = it.fill != null ? it.fill : (it.cmd || it.t); AST.inp.value = f; renderSug(); } }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeAst(); }
    });
    AST.list.addEventListener('mousedown', (e) => { const r = e.target.closest('.ta-r'); if (!r) return; e.preventDefault(); go(AST.items[+r.dataset.i]); });
    AST.list.addEventListener('mousemove', (e) => { const r = e.target.closest('.ta-r'); if (!r || r.classList.contains('hdr') || r.classList.contains('info')) return; const i = +r.dataset.i; if (i !== AST.sel) { AST.sel = i; AST.list.querySelectorAll('.ta-r').forEach((x, k) => x.classList.toggle('on', k === i)); } });
    el.addEventListener('mousedown', (e) => { if (e.target.closest('.ta-sug')) return; setTimeout(() => { try { if (AST.open && !getSelection().toString()) AST.inp.focus(); } catch {} }, 0); });
  }
  function addLine(text, cls) {
    AST.log.push({ t: String(text), c: cls || '' }); if (AST.log.length > 120) AST.log.shift();
    if (!AST.out) return;
    const d = document.createElement('div'); d.className = `ta-l ${cls || ''}`; d.textContent = String(text); AST.out.appendChild(d);
    while (AST.out.childNodes.length > 120) AST.out.removeChild(AST.out.firstChild);
    AST.out.scrollTop = AST.out.scrollHeight;
  }
  const bad = (t) => { addLine(t, 'err'); return false; };
  // mode: 'spot' = centred like a spotlight (the hotkey), 'anchor' = beside the burrow (clicking it); default: beside the burrow when it is showing
  function openAst(mode) {
    try {
      if (!CFG.on) return false;
      buildAst(); hideNudge(); AST.open = true; AST.spot = mode === 'spot' || (mode !== 'anchor' && !homeOn()); AST.el.classList.add('on'); anchorStyle(AST.el);
      AST.out.textContent = ''; for (const l of AST.log.slice(-40)) { const d = document.createElement('div'); d.className = `ta-l ${l.c}`; d.textContent = l.t; AST.out.appendChild(d); }
      if (!AST.greeted) { AST.greeted = true; addLine(`${CFG.name || 'twr'} ready. Ask me for anything.`, 'dim'); }
      AST.out.scrollTop = AST.out.scrollHeight; AST.inp.value = ''; renderSug(); srcRefresh(); setTimeout(() => { try { AST.inp.focus(); } catch {} }, 30);
      HM.act = 'type'; HM.spot = 'desk'; HM.until = Date.now() + 4000; kickHome();
      return true;
    } catch (e) { console.warn('twr.openAst', e); return false; }
  }
  function closeAst() { try { if (!AST.el) return; AST.open = false; AST.el.classList.remove('on'); if (AST.el.contains(document.activeElement)) AST.inp.blur(); } catch {} }
  const toggleAst = (mode) => (AST.open ? closeAst() : openAst(mode));
  document.addEventListener('keydown', (e) => {
    try {
      if (e.code === 'Space' && e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        if (!CFG.on || (window.hs && hs.remote)) return;
        const inAst = AST.el && AST.el.contains(e.target);
        if (inAst || quiet()) { e.preventDefault(); e.stopPropagation(); toggleAst('spot'); }
      } else if (e.key === 'Escape' && AST.open) closeAst();
    } catch {}
  }, true);

  // ---------- commands ----------
  let lastCmdXp = 0;
  const CMDS = {
    help() {
      addLine('Just start typing: I suggest as you go. Tab completes, Enter runs.', 'dim');
      for (const c of CMDLIST) if (c.n !== 'clear') addLine(`${c.n.padEnd(9)}${c.h}`, 'dim');
      addLine('Or say it: "open my notes", "add milk to my list", "how hot is my cpu", "quiet the fans".', 'dim');
      addLine('Ctrl+Space opens me anywhere. I also search CRATE, NOTES, TO-DO, apps and Settings.', 'dim');
    },
    async volume(arg) {
      let v = (await hsCall('core', 'audio.getVolume')) || {}; const cur = Math.round((v.level || 0) * 100), a = String(arg || '').trim().toLowerCase();
      if (!a) return addLine(`volume ${cur}%${v.muted ? ' (muted)' : ''}`, 'ok');
      let n; const m = a.match(/^(\d{1,3})\s*%?$/);
      if (/^(up|louder|higher|more|\+)/.test(a)) n = cur + 10; else if (/^(down|lower|quieter|softer|less|-)/.test(a)) n = cur - 10; else if (m) n = +m[1]; else if (a === 'mute') return CMDS.mute(); else return bad('usage: volume 0-100, up or down');
      n = clamp(Math.round(n), 0, 100); v = (await hsCall('core', 'audio.volume', { level: n / 100 })) || {};
      addLine(`volume ${Math.round((v.level != null ? v.level : n / 100) * 100)}%`, 'ok');
    },
    async mute() { await hsCall('core', 'audio.volume', { muted: true }); addLine('muted', 'ok'); },
    async unmute() { await hsCall('core', 'audio.volume', { muted: false }); addLine('unmuted', 'ok'); },
    music(arg, word) {
      const a = String(arg || word || 'toggle').toLowerCase(), m = { toggle: 'toggle', play: 'toggle', pause: 'toggle', resume: 'toggle', stop: 'toggle', next: 'next', skip: 'next', prev: 'prev', previous: 'prev', back: 'prev' }[a];
      if (!m) return bad('usage: music play | pause | next | prev'); if (!(window.HS && HS.actions && HS.actions.media)) return bad('media control is not available');
      HS.actions.media(m); addLine(`music: ${m === 'toggle' ? 'play / pause' : m}`, 'ok');
    },
    fans(arg) {
      const a = String(arg || '').toLowerCase().trim(), p = { auto: 'auto', quiet: 'quiet', silent: 'quiet', balanced: 'balanced', bal: 'balanced', cool: 'aggressive', aggro: 'aggressive', aggressive: 'aggressive', loud: 'aggressive', max: 'max', full: 'max' }[a];
      if (!p) return bad('usage: fans auto | quiet | balanced | cool | max');
      const b = $q(`#cool-presets [data-p="${p}"]`), pn = b && b.closest('.panel');
      if (!b || (pn && getComputedStyle(pn).display === 'none')) return bad('fan control works on Acer Nitro and Predator laptops only');
      b.click(); addLine(`fans: ${a}`, 'ok');
    },
    mode(arg) {
      const a = String(arg || '').toLowerCase().trim();
      if (!['gamer', 'silent', 'eco'].includes(a)) return bad('usage: mode gamer | silent | eco');
      if (!(window.HS && HS.actions && HS.actions.preset) || !$q(`.preset[data-preset="${a}"]`)) return bad('power modes are not available here'); HS.actions.preset(a); addLine(`power mode: ${a}`, 'ok');
    },
    settings(arg) {
      const a = String(arg || '').toLowerCase().trim(); gotoTab('settings');
      if (!a) return addLine('opened SETTINGS', 'ok');
      let best = null, bs = 0; for (const t of domIndex().tabs) { const sc = Math.max(fz(a, t.t.toLowerCase()), fz(a, t.st)); if (sc > bs) { bs = sc; best = t; } }
      if (!best || bs < 20) return bad(`no Settings tab called "${arg}"`);
      setTimeout(() => { const b = $q(`#set-tabs [data-st="${best.st}"]`); if (b) b.click(); }, 60); addLine(`opened SETTINGS > ${best.t}`, 'ok');
    },
    theme(arg) {
      const a = String(arg || '').toLowerCase().trim(), A = window.HS && HS.actions;
      if (!a || a === 'next') { if (A && A.vjNext) { A.vjNext(); return addLine('next VJ theme', 'ok'); } return bad('the VJ section is not loaded'); }
      if (a === 'random' || a === 'shuffle') { if (A && A.vjRandom) { A.vjRandom(); return addLine('random VJ look', 'ok'); } return bad('the VJ section is not loaded'); }
      let best = null, bs = 0; for (const b of document.querySelectorAll('#cr-vjwrap [data-theme], #view-vj [data-theme]')) { const sc = Math.max(fz(a, (b.textContent || '').toLowerCase()), fz(a, b.dataset.theme)); if (sc > bs) { bs = sc; best = b; } }
      if (!best || bs < 40) return bad(`no VJ theme called "${arg}"`); best.click(); addLine(`VJ theme: ${(best.textContent || '').trim()}`, 'ok');
    },
    accent(arg) {
      const a = String(arg || '').toLowerCase().trim(), sw = window.ACCENT_SWATCHES || [];
      if (!sw.length || typeof window.setAccent !== 'function') return bad('accent colours are not available');
      let best = null, bs = 0; for (const s of sw) { const sc = Math.max(fz(a, s[0]), fz(a, String(s[1]).toLowerCase())); if (sc > bs) { bs = sc; best = s; } }
      if (!best || bs < 40) return bad(`colours: ${sw.map((s) => s[0]).join(', ')}`); window.setAccent(best[0]); addLine(`accent: ${best[1]}`, 'ok');
    },
    async lock() { await hsCall('notesLock'); addLine('journal locked', 'ok'); try { document.dispatchEvent(new CustomEvent('twr', { detail: { do: 'locked' } })); } catch {} },
    mic() { const A = window.HS && HS.actions; if (!(A && A.toggleMic)) return bad('the mic shield is not available'); A.toggleMic(); addLine('toggled the microphone shield (OPERATIONS shows it)', 'ok'); },
    camera() { const A = window.HS && HS.actions; if (!(A && A.toggleCam)) return bad('the camera shield is not available'); A.toggleCam(); addLine('toggled the camera shield (OPERATIONS shows it)', 'ok'); },
    ram() { const A = window.HS && HS.actions; if (!(A && A.vacuum)) return bad('RAM cleanup is not available'); A.vacuum(); addLine('cleaning up RAM...', 'ok'); },
    async todo(text) {
      if (!text) return bad('usage: todo <text>');
      const inp = document.getElementById('td-new'), btn = document.getElementById('td-addb');
      if (inp && btn) { // the TO-DO page is alive in this window: add through it so its list stays in sync
        const pk = document.getElementById('td-pick'); if (pk && [...pk.options].some((o) => o.value === 'general')) pk.value = 'general';
        inp.value = text; btn.click(); setTimeout(() => { try { AST.open && AST.inp.focus(); } catch {} }, 30);
      } else {
        const s = (await hsCall('todoGet')) || {}; s.tasks = Array.isArray(s.tasks) ? s.tasks : [];
        s.tasks.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), text, done: false, at: Date.now(), cat: 'general', star: false }); await hsCall('todoSave', s);
      }
      addLine(`+ to-do added: ${text.slice(0, 60)}`, 'ok'); addXp(2); addCoins(1);
    },
    async note(text) {
      if (!text) return bad('usage: note <text>');
      const stamp = new Date().toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }), add = `**${stamp}**\n${text}`;
      const upd = (n) => (typeof n.updated === 'number' ? n.updated : Date.parse(n.updated) || 0);
      const l = ((await hsCall('notesList')) || []).filter((n) => !n.deleted && !n.journal && n.title === 'Sidedock notes' && (n.notebook || 'Notes') === 'Notes');
      let id;
      if (l.length) { const page = l.reduce((a, b) => (upd(b) > upd(a) ? b : a)), full = await hsCall('notesGet', page.id); await hsCall('notesSave', { ...full, body: `${(full.body || '').replace(/\s+$/, '')}\n\n${add}\n` }); id = page.id; }
      else { const r = await hsCall('notesSave', { title: 'Sidedock notes', notebook: 'Notes', section: '', body: `${add}\n` }); id = r && r.id; }
      if (id) { try { hsCall('notesUse', id).catch(() => {}); } catch {} }
      addLine('+ note added to "Sidedock notes"', 'ok'); addXp(2); addCoins(1);
    },
    open(q) {
      if (!q) return bad('usage: open <tab>  (fans, crate, vj, deck, notes, todo, settings...)');
      const t = resolveTab(q); if (!t || !gotoTab(t)) return bad(`no tab called "${q}"`);
      addLine(t === 'vj' ? 'opened CRATE > VJ' : `opened ${TABNAME[t] || t.toUpperCase()}`, 'ok');
    },
    find(q) {
      const b = $q('#find-btn'); if (b) b.click(); else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
      setTimeout(() => { const i = $q('.fd-wrap input, .fd input'); if (i) { if (q) { i.value = q; i.dispatchEvent(new Event('input', { bubbles: true })); } i.focus(); } }, 80);
      addLine(q ? `FIND: ${q}` : 'FIND opened', 'ok'); closeAst();
    },
    status() {
      let n = 0; for (const [k, id] of [['temps', 'sb-temps'], ['this app gpu', 'sb-self'], ['machine', 'sb-machine'], ['uptime', 'sb-uptime'], ['disks', 'sb-drives'], ['battery', 'sb-batt'], ['core', 'sb-core']]) { const v = sbText(id); if (v && v !== '—') { addLine(`${k}: ${v}`, 'ok'); n++; } }
      if (!n) addLine('the status bar is empty right now', 'dim');
      const T = hotNow(); if (T >= 85) addLine(`warning: ${T}°C is hot. try: open fans`, 'err'); else if (T) addLine(`all good. hottest sensor: ${T}°C`, 'ok');
      const dk = lowDisk(); if (dk) addLine(`warning: ${dk.d}: only ${dk.gb.toFixed(1)} GB free`, 'err');
    },
    timer(arg) {
      if (!arg) { if (!AST.tmr.length) return addLine('no timers running. usage: timer 10m tea', 'dim'); AST.tmr.forEach((t) => addLine(`${t.label}: ${fmtMs(t.at - Date.now())} left`, 'ok')); return; }
      const m = arg.match(/^(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?|s|sec|secs|seconds?)?(?:\s+([\s\S]*))?$/i); if (!m) return bad('usage: timer 10m <label>');
      const u = (m[2] || 'm')[0].toLowerCase(), ms = +m[1] * (u === 'h' ? 3600e3 : u === 's' ? 1e3 : 60e3);
      if (!(ms >= 1000 && ms <= 24 * 3600e3)) return bad('timers run from 1 second to 24 hours');
      const t = { at: Date.now() + ms, label: (m[3] || 'timer').trim().slice(0, 40) || 'timer' }; t.id = setTimeout(() => timerDone(t), ms); AST.tmr.push(t); stat('timers'); kickHome();
      addLine(`timer set: ${t.label} in ${fmtMs(ms)}`, 'ok');
    },
    hack() { if (window.hsHacker && hsHacker.open) { closeAst(); hsHacker.open(); stat('hacks'); } else return bad('the hacker terminal is not loaded'); },
    dance() { addLine('*dances*', 'ok'); stage.demo('dance'); },
    joke() { addLine(pick(JOKES), 'ok'); HM.act = 'wave'; HM.until = Date.now() + 3000; },
    stats() { const L_ = level(), s = CFG.stats; addLine(`level ${L_.lvl} ${L_.title} · ${CFG.xp}/${L_.next} xp · ${CFG.coins} coins`, 'ok'); addLine(`pets ${s.pets} · saves ${s.saves} · tows ${s.tows} · pokes ${s.pokes || 0} · helps ${s.helps || 0} · commands ${s.cmds || 0}`, 'dim'); },
    name(arg) {
      memInit(); const n = String(arg || '').replace(/[^\w .'-]/g, '').trim().slice(0, 14);
      if (!n) return addLine(uname() ? `I call you ${uname()}. change it: name <something>` : 'usage: name <what I should call you>', 'dim');
      CFG.mem.user = n; save(); addLine(`nice to meet you, ${n}`, 'ok'); HM.act = 'wave'; HM.until = Date.now() + 3000;
    },
    recap() {
      const r = recapData(); addLine(`last 7 days: ${r.activeDays} active day${r.activeDays === 1 ? '' : 's'} · about ${r.minutes} min with me`, 'ok');
      addLine(r.top.length ? `top tabs: ${r.top.map(([k, c]) => `${tabLabel(k)} ${c}`).join(' · ')}` : 'top tabs: none yet', 'dim');
      addLine(`saves ${r.notes} · commands ${r.cmds} · gifts found ${r.gifts} · streak ${r.streak} (best ${r.best})`, 'dim');
      addLine(withName(voice('idle'), 0.5), 'dim');
    },
    forget() { resetMem(); addLine('memory wiped. we start fresh.', 'ok'); },
    clear() { AST.log = []; if (AST.out) AST.out.textContent = ''; },
  };
  const CMD_ALIAS = { '?': 'help', h: 'help', go: 'open', goto: 'open', search: 'find', temp: 'status', temps: 'status', timers: 'timer', t: 'todo', n: 'note', cls: 'clear', stat: 'stats', vol: 'volume', fan: 'fans', cam: 'camera', vacuum: 'ram', play: 'music', pause: 'music', next: 'music', prev: 'music', skip: 'music', '?': 'help' };
  async function runCmd(line) {
    try {
      line = String(line || '').trim(); if (!line) return;
      addLine(`> ${line}`, 'cmd');
      const m = line.match(/^(\S+)\s*([\s\S]*)$/), cmd = m[1].toLowerCase(), arg = m[2].trim(), fn = CMDS[CMD_ALIAS[cmd] || cmd];
      HM.act = 'type'; HM.spot = 'desk'; HM.until = Date.now() + 4000;
      if (!fn || typeof fn !== 'function' || !Object.prototype.hasOwnProperty.call(CMDS, CMD_ALIAS[cmd] || cmd)) {
        const t = resolveTab(line); if (t) addLine(`did you mean: open ${t}?`, 'dim'); else addLine(`unknown command "${cmd}". try: help`, 'err'); return;
      }
      const r = await fn(arg, cmd); memCmd(CMD_ALIAS[cmd] || cmd);
      if (r !== false) { stat('cmds'); const now = Date.now(); if (now - lastCmdXp > 4000) { lastCmdXp = now; addXp(1); } }
    } catch (e) { addLine(`error: ${(e && e.message) || e}`, 'err'); }
  }
  function timerDone(t) {
    try {
      AST.tmr = AST.tmr.filter((x) => x !== t); kickHome(); addXp(3); addCoins(2);
      const msg = `Timer done: ${t.label}`; addLine(msg, 'ok');
      if (CFG.on && homeOn() && !AST.open) showNudge({ kind: 'timer', text: msg, ms: 45000, chips: [{ label: 'ok' }, { label: '+5 min', run: () => CMDS.timer(`5m ${t.label}`) }] });
      if (awake() && !reduced()) enqueue(() => { if (!antic('dance', true)) return false; later(900, () => bubbleText(msg, 3600)); }, 90000); else say(msg, 3000);
    } catch {}
  }

  // =====================================================================================================
  // PROACTIVE HELP: small, rate-limited nudges in a bubble above the burrow (off with cfg.help = false)
  // =====================================================================================================
  const TABTIPS = {
    nexus: 'Tip: sidebar tiles can be dragged. Click, hold, and move them.', afterburner: 'Tip: QUIET / BALANCED / COOL / MAX set the fans in one click. Curves are under advanced.',
    vj: 'Tip: the VJ lives inside CRATE now. VJ FULL fills the screen, and it can run as wallpaper or feed other apps.', crate: 'Tip: CRATE reads your rekordbox library: BPM, keys and cues. Its VJ section is one click away.',
    deck: 'Tip: DECK is volume, now playing and screens in one place.', router: 'Tip: the file router sorts new downloads into folders for you.',
    senses: 'Tip: SENSES can seal the mic or camera and shows who used them.', notes: 'Tip: type "note ..." in my terminal to jot a line without opening NOTES.',
    todo: 'Tip: type "todo ..." in my terminal to add an item from anywhere.', hardware: 'Tip: HARDWARE lists every USB port with power and speed.',
    settings: 'Tip: Ctrl+F (or the FIND chip) jumps to any setting by name.', experts: 'Tip: ask the experts anything. They know this project.',
  };
  const snzGet = () => { try { return JSON.parse(lsGet('hs-twr-snz') || '{}') || {}; } catch { return {}; } };
  const snoozed = (k) => (snzGet()[k] || 0) > Date.now();
  const snooze = (k, ms) => { const o = snzGet(); o[k] = Date.now() + ms; lsSet('hs-twr-snz', JSON.stringify(o)); };
  const canNudge = () => Date.now() - (+lsGet('hs-twr-nudge') || 0) > 10 * 60e3 && Date.now() - HM.t0 > 20e3;
  function helpOK() {
    return !!(CFG.help && CFG.on && homeOn() && !AST.open && !HM.nudge && !document.hidden && document.hasFocus() && quiet() && Date.now() - HM.lastKey > 8000 &&
      !document.body.classList.contains('booting') && !(document.getElementById('intro') && document.getElementById('intro').offsetParent));
  }
  function showNudge(o) {
    try {
      hideNudge(); if (!CFG.on || !document.body) return;
      const el = document.createElement('div'); el.id = 'twr-nudge'; el.innerHTML = '<div class="tn-t"></div><div class="tn-c"></div>'; el.firstChild.textContent = `${CFG.name || 'twr'}> ${o.text}`;
      for (const c of o.chips || []) { const b = document.createElement('button'); b.textContent = c.label; b.addEventListener('click', () => { hideNudge(); try { c.run && c.run(); } catch {} }); el.lastChild.appendChild(b); }
      document.body.appendChild(el); anchorStyle(el);
      HM.nudge = { el, kind: o.kind, t: setTimeout(() => hideNudge(true), Math.max(o.ms || 0, 20000)) };
      if (o.kind !== 'timer') lsSet('hs-twr-nudge', String(Date.now()));
      stat('nudges'); HM.act = 'wave'; HM.spot = 'floor'; HM.until = Date.now() + 4000; kickHome();
    } catch (e) { console.warn('twr.nudge', e); }
  }
  function hideNudge(auto) {
    const n = HM.nudge; if (!n) return; HM.nudge = null; clearTimeout(n.t); n.el.remove();
    if (auto && n.kind && !['timer', 'tour'].includes(n.kind)) snooze(n.kind, 30 * 60e3);
    kickHome();
  }
  const helped = () => { stat('helps'); addXp(3); addCoins(1); };
  const chipOpen = (label, tab, kind) => ({ label, run: () => { gotoTab(tab); helped(); snooze(kind, 3 * 3600e3); } });
  const chipGot = (kind) => ({ label: 'got it', run: () => snooze(kind, 6 * 3600e3) });
  const chipSnz = (kind) => ({ label: 'snooze', run: () => snooze(kind, 3600e3) });
  let lastTodoChk = 0;
  async function helpTick() {
    try {
      if (!helpOK()) return;
      if (!CFG.seenTabs.includes('_tour') && Date.now() - HM.t0 > 25e3) {
        CFG.seenTabs.push('_tour'); save();
        showNudge({ kind: 'tour', ms: 45000, text: "hey, I'm twr. Click my house and I'll help out. Ctrl+Space works too.", chips: [{ label: 'show me', run: () => { openAst(); ['tip 1: try  todo buy carrots  or  note a thought', 'tip 2: try  open fans,  find journal,  timer 10m tea', 'tip 3: right-click my house to move it, hide it, or send me to sleep', 'tip 4: I check on temps, disk and to-dos now and then (turn me off in settings)'].forEach((l) => addLine(l, 'ok')); } }, { label: 'got it' }] });
        return;
      }
      if (!canNudge()) return;
      const hot = hotNow();
      if (hot >= 88 && !snoozed('hot')) return showNudge({ kind: 'hot', text: `${hot}°C. ${voice('hot')}`, chips: [chipOpen('open FANS', 'afterburner', 'hot'), chipSnz('hot'), chipGot('hot')] });
      const dk = lowDisk();
      if (dk && !snoozed('disk')) return showNudge({ kind: 'disk', text: `${dk.d}: has only ${dk.gb.toFixed(1)} GB free. Time to clear some space?`, chips: [chipOpen('open FILES', 'router', 'disk'), chipSnz('disk'), chipGot('disk')] });
      if (S.unlockAt && Date.now() - S.unlockAt > 20 * 60e3 && !snoozed('lock')) return showNudge({ kind: 'lock', text: `The journal has been unlocked for ${Math.round((Date.now() - S.unlockAt) / 60e3)} min. Lock it when you are done?`, chips: [chipOpen('open NOTES', 'notes', 'lock'), chipSnz('lock'), chipGot('lock')] });
      if (Date.now() - lastTodoChk > 5 * 60e3 && !snoozed('todo') && window.hs && hs.call) {
        lastTodoChk = Date.now();
        const s = await hs.call('todoGet'), open = ((s && s.tasks) || []).filter((t) => t && !t.done), old = open.filter((t) => Date.now() - (t.at || Date.now()) > 7 * 86400e3);
        if (open.length >= 10 || old.length >= 3) { if (helpOK()) showNudge({ kind: 'todo', text: old.length >= 3 ? `${open.length} open to-dos, ${old.length} older than a week. Shall we tidy up?` : `${open.length} open to-dos. That is a lot of carrots.`, chips: [chipOpen('open TO-DO', 'todo', 'todo'), chipSnz('todo'), chipGot('todo')] }); }
      }
    } catch {}
  }
  function tabTip(t) {
    setTimeout(() => {
      try {
        if (!t || curTab() !== t || !TABTIPS[t] || CFG.seenTabs.includes(t)) return;
        if (!helpOK() || !canNudge()) return;
        CFG.seenTabs.push(t); save(); showNudge({ kind: 'tab', text: TABTIPS[t], chips: [{ label: 'got it' }] });
      } catch {}
    }, 2400);
  }
  function initHome() {
    try {
      buildHome(); applyHome(); homeLoop();
      setInterval(placeHome, 3000); addEventListener('resize', placeHome);
      setInterval(helpTick, 40000); setTimeout(helpTick, 27000);
      const opt = { passive: true, capture: true };
      addEventListener('pointermove', (e) => { HM.lastIn = Date.now(); HM.mx = e.clientX; HM.my = e.clientY; }, opt);
      addEventListener('pointerdown', () => { HM.lastIn = Date.now(); }, opt);
      addEventListener('keydown', () => { HM.lastIn = HM.lastKey = Date.now(); }, opt);
    } catch (e) { console.warn('twr home', e); }
  }

  // =====================================================================================================
  // MEMORY: habits kept locally in cfg.mem. COUNTS ONLY, never content (no note text, no file names, no song titles).
  //   twr.mem() reads it, twr.resetMem() wipes it (also in Settings > THE WHITE RABBIT). Commands: name <x>, recap, forget.
  // =====================================================================================================
  const MS = { gap: 0, greeted: false, lastCom: 0, lastLate: 0, giftBusy: false };
  const dayKey = (d) => { d = d || new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const dayBack = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return dayKey(d); };
  const dayNum = (k) => { const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(k || ''); return m ? Math.round(new Date(+m[1], +m[2] - 1, +m[3], 12).getTime() / 86400e3) : NaN; };
  const diffDays = (a, b) => dayNum(b) - dayNum(a);
  const ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
  const ord = (n) => ORD[n] || `${n}th`;
  const tabLabel = (t) => TABNAME[t] || String(t || '').toUpperCase();
  function memInit() {
    const m = CFG.mem = CFG.mem && typeof CFG.mem === 'object' && !Array.isArray(CFG.mem) ? CFG.mem : {};
    if (!Array.isArray(m.hr) || m.hr.length !== 24) m.hr = new Array(24).fill(0);
    for (const k of ['tabs', 'cmds', 'notes', 'dayTabs', 'act', 'tabHr', 'night', 'said']) if (!m[k] || typeof m[k] !== 'object' || Array.isArray(m[k])) m[k] = {};
    if (!Array.isArray(m.gifts)) m.gifts = [];
    for (const k of ['streak', 'best', 'days', 'active', 'nextGift']) m[k] = +m[k] || 0;
    if (typeof m.user !== 'string') m.user = '';
    if (typeof m.first !== 'string') m.first = ''; if (typeof m.last !== 'string') m.last = '';
  }
  function memPrune() {
    const m = CFG.mem, keep = new Set(); for (let i = 0; i < 21; i++) keep.add(dayBack(i));
    for (const k of ['dayTabs', 'notes', 'act']) for (const d of Object.keys(m[k])) if (!keep.has(d)) delete m[k][d];
    const sk = Object.keys(m.said); if (sk.length > 60) sk.slice(0, sk.length - 60).forEach((k) => delete m.said[k]);
    if (m.gifts.length > 50) m.gifts.length = 50;
    const ck = Object.keys(m.cmds); if (ck.length > 60) ck.sort((a, b) => m.cmds[a] - m.cmds[b]).slice(0, 20).forEach((k) => delete m.cmds[k]);
  }
  // called once when the rabbit is on: counts the day, the streak, and how long he was away
  function memOpen() {
    try {
      if (!CFG.on) return; memInit();
      const m = CFG.mem, today = dayKey();
      if (!m.first) m.first = today;
      if (m.last !== today) {
        const gap = m.last ? diffDays(m.last, today) : 0; MS.gap = gap > 0 ? gap : 0;
        m.streak = gap === 1 ? m.streak + 1 : 1; m.best = Math.max(m.best, m.streak); m.days++; m.last = today;
      }
      memPrune(); save();
    } catch (e) { console.warn('twr.mem', e); }
  }
  function memTab(t) {
    try {
      if (!CFG.on || !t) return; memInit();
      const m = CFG.mem, h = new Date().getHours(), d = dayKey();
      m.tabs[t] = (m.tabs[t] || 0) + 1; m.hr[h]++;
      (m.tabHr[t] = Array.isArray(m.tabHr[t]) && m.tabHr[t].length === 24 ? m.tabHr[t] : new Array(24).fill(0))[h]++;
      const dt = m.dayTabs[d] = m.dayTabs[d] || {}; dt[t] = (dt[t] || 0) + 1;
      if (h < 5) { // "nights in a row": after midnight counts for the evening before
        const nk = dayKey(new Date(Date.now() - 5 * 3600e3)), nr = m.night[t] = m.night[t] || { key: '', n: 0 };
        if (nr.key !== nk) { nr.n = nr.key && diffDays(nr.key, nk) === 1 ? nr.n + 1 : 1; nr.key = nk; }
      }
      save();
    } catch {}
  }
  const memSaved = () => { try { if (!CFG.on) return; memInit(); const d = dayKey(); CFG.mem.notes[d] = (CFG.mem.notes[d] || 0) + 1; save(); } catch {} };
  const memCmd = (n) => { try { if (!CFG.on || !n) return; memInit(); CFG.mem.cmds[n] = (CFG.mem.cmds[n] || 0) + 1; save(); } catch {} };
  const uname = () => (CFG.mem && CFG.mem.user) || '';
  const withName = (s, p) => { const u = uname(); return u && Math.random() < (p == null ? 0.15 : p) ? s.replace(/([.!?])?$/, (x) => `, ${u}${x || ''}`) : s; };

  // what he says about patterns, per personality (sparingly: one comment per ~20 min at most)
  const MC = {
    night: {
      sassy: (n, T) => `${ord(n)} night in a row in ${T} after midnight. Sleep is optional, apparently.`, helpful: (n, T) => `That is ${n} late nights in a row in ${T}. Maybe an early night soon?`,
      chaotic: (n, T) => `${n.toString()} MIDNIGHTS in ${T}!! We live here now!!`, zen: (n, T) => `${ord(n)} night with ${T} after dark. The moon knows.`, hacker: (n, T) => `cron: ${T} @ 0${n}:00 again. uptime of the user: concerning.`,
    },
    streak: {
      sassy: (n) => `${n} days in a row. Are you okay? Keep going.`, helpful: (n) => `${n} days in a row! That is a lovely habit.`, chaotic: (n) => `${n} DAYS!!! STREAK GOBLIN!!!`, zen: (n) => `${n} days. Consistency is quiet.`, hacker: (n) => `streak=${n}; no downtime. impressive.`,
    },
    fav: {
      sassy: (T, c) => `${T} again. ${c} visits. You two should get a room.`, helpful: (T, c) => `${T} is clearly your favourite: ${c} visits so far.`, chaotic: (T, c) => `${T} ${c} TIMES. It is basically your house!`, zen: (T, c) => `${T}. ${c} visits. The path wears a groove.`, hacker: (T, c) => `grep -c ${T}: ${c}. most used view.`,
    },
    hour: {
      sassy: (h) => `Funny, you always turn up around ${h}:00. I set my watch by you.`, helpful: (h) => `You tend to be here around ${h}:00. Good rhythm.`, chaotic: (h) => `${h}:00 O'CLOCK AGAIN! Spooky!`, zen: (h) => `You come at ${h}:00, like the tide.`, hacker: (h) => `log pattern: peak activity ${h}:00. predictable.`,
    },
    gone: {
      sassy: (d) => `You were gone ${d} days. I counted every one. Dramatically.`, helpful: (d) => `Welcome back! It has been ${d} days. I missed you.`, chaotic: (d) => `${d} DAYS!! I ate your carrots!!`, zen: (d) => `${d} days away. The door was open.`, hacker: (d) => `last_login: ${d} days ago. session restored.`,
    },
    tod: { late: 'Still up', night: 'Good evening', morn: 'Good morning', aft: 'Good afternoon' },
  };
  const mc = (kind, ...a) => { const f = (MC[kind][CFG.personality] || MC[kind].sassy); return f(...a); };
  const saidBefore = (k) => { const s = CFG.mem.said; if (s[k]) return true; s[k] = Date.now(); return false; };

  // one comment, now and then, when the tab changes (returns true if one is on its way)
  function memComment(t) {
    try {
      memInit(); const m = CFG.mem, now = Date.now(), h = new Date().getHours();
      if (now - MS.lastCom < 20 * 60e3 || Math.random() > 0.3) return false;
      let text = '';
      const nr = m.night[t];
      if (h < 5 && nr && nr.n >= 2 && !m.said[`night:${t}:${nr.n}:${nr.key}`]) { m.said[`night:${t}:${nr.n}:${nr.key}`] = now; text = mc('night', nr.n, tabLabel(t)); }
      else if ([3, 5, 7, 14, 30, 60, 100].includes(m.streak) && !m.said[`streak:${m.streak}`]) { m.said[`streak:${m.streak}`] = now; text = mc('streak', m.streak); }
      else if (m.tabs[t] >= 25 && m.tabs[t] % 25 === 0 && Object.keys(m.tabs).every((k) => m.tabs[k] <= m.tabs[t]) && !m.said[`fav:${t}:${m.tabs[t]}`]) { m.said[`fav:${t}:${m.tabs[t]}`] = now; text = mc('fav', tabLabel(t), m.tabs[t]); }
      else { const tot = m.hr.reduce((a, b) => a + b, 0); if (tot >= 40 && m.hr[h] >= 15 && m.hr[h] / tot >= 0.2 && !m.said[`hr:${dayKey()}`]) { m.said[`hr:${dayKey()}`] = now; text = mc('hour', h); } }
      if (!text) return false;
      MS.lastCom = now; save();
      setTimeout(() => { try { if (canRandom() && curTab() === t) say(text, 4200); } catch {} }, 900);
      return true;
    } catch { return false; }
  }
  // hello: by time of day, by absence, by name (once per session)
  function greetNow(tries) {
    try {
      if (MS.greeted || !CFG.on) return;
      if (!canRandom()) { if ((tries || 0) < 10) setTimeout(() => greetNow((tries || 0) + 1), 7000); return; }
      MS.greeted = true; memInit();
      const h = new Date().getHours(), tod = h < 5 ? MC.tod.late : h < 12 ? MC.tod.morn : h < 18 ? MC.tod.aft : MC.tod.night, u = uname();
      let text = (u && Math.random() < 0.6 ? `${tod}, ${u}. ` : '') + voice('greet');
      if (MS.gap >= 2) text = `${mc('gone', MS.gap)} ${Math.random() < 0.5 ? '' : voice('greet')}`.trim();
      say(text, 4800);
    } catch {}
  }
  function recapData() {
    memInit(); const m = CFG.mem, tabs = {}; let notes = 0, mins = 0, act = 0;
    for (let i = 0; i < 7; i++) {
      const d = dayBack(i), dt = m.dayTabs[d];
      if (dt) { act++; for (const k of Object.keys(dt)) tabs[k] = (tabs[k] || 0) + dt[k]; }
      notes += m.notes[d] || 0; mins += m.act[d] || 0;
    }
    const top = Object.keys(tabs).sort((a, b) => tabs[b] - tabs[a]).slice(0, 3).map((k) => [k, tabs[k]]);
    return { activeDays: act, minutes: Math.round(mins), notes, top, streak: m.streak, best: m.best, gifts: m.gifts.filter((g) => Date.now() - g.t < 7 * 86400e3).length, cmds: Object.values(m.cmds).reduce((a, b) => a + b, 0) };
  }
  function memRead() {
    try {
      memInit(); const m = JSON.parse(JSON.stringify(CFG.mem));
      m.summary = Object.assign(recapData(), { first: m.first, days: m.days, user: m.user, topTabs: Object.keys(m.tabs).sort((a, b) => m.tabs[b] - m.tabs[a]).slice(0, 5).map((k) => [k, m.tabs[k]]), peakHour: m.hr.indexOf(Math.max(...m.hr)) });
      return m;
    } catch { return {}; }
  }
  function resetMem() { CFG.mem = {}; MS.lastCom = 0; memInit(); memOpen(); saveNow(); fire('twr-config', cfgCopy()); return true; }
  // every 30 s: active time (for gifts and the recap), late-night remarks, and the gift timer
  function memTick() {
    try {
      if (!CFG.on || !awake() || document.hidden) return; memInit();
      const m = CFG.mem, now = Date.now();
      if (now - HM.lastIn < 60e3) { m.active += 30000; const d = dayKey(); m.act[d] = (m.act[d] || 0) + 0.5; save(); }
      const h = new Date().getHours();
      if (h < 5 && now - MS.lastLate > 90 * 60e3 && Math.random() < 0.35 && canRandom()) { MS.lastLate = now; say(voice('late'), 4200); return; }
      if (!m.nextGift) { m.nextGift = m.active + rnd(45, 90) * 60000; save(); }
      if (m.active >= m.nextGift && canRandom() && !AST.open && !MS.giftBusy) giveGift();
    } catch {}
  }

  // =====================================================================================================
  // GIFTS: once per ~45-90 min of ACTIVE use he finds something and mails it from the burrow in a little parcel
  // =====================================================================================================
  const KINDLAB = { skin: 'skin', hat: 'hat', glasses: 'glasses', color: 'colour', vehicle: 'vehicle' };
  const itemName = (id) => { for (const k of Object.keys(KIND)) { const it = CATALOG[KIND[k]].find((i) => i.id === id); if (it) return `${KINDLAB[k]}: ${it.name}`; } return id; };
  function pickGift(force) {
    const r = force || Math.random(), un = Object.keys(ITEMS).filter((id) => ITEMS[id].cost > 0 && !CFG.owned.includes(id));
    if (r < 0.04) return { kind: 'golden' };
    if (r < 0.34 && un.length) return { kind: 'item', id: pick(un) };
    if (r < 0.66) return { kind: 'xp', n: rint(12, 40) };
    return { kind: 'coins', n: rint(6, 30) };
  }
  function parcel(kind, done) {
    try {
      const from = homePoint(), side = homeOn() && CFG.homeCorner[1] === 'l' ? 1 : -1;
      const dx = side * (80 + rnd(0, 50)), dy = -rnd(26, 60), gold = kind === 'golden';
      const el = document.createElement('div'); el.className = `twr-parcel${gold ? ' gold' : ''}`; el.innerHTML = gold ? '<i class="pc-c">\u{1F955}</i>' : '<i class="pc-b"></i>';
      el.style.left = `${clamp(from.x, 20, innerWidth - 20)}px`; el.style.top = `${clamp(from.y, 20, innerHeight - 20)}px`;
      document.body.appendChild(el);
      if (homeOn()) { openDoor(1500); puff(); }
      const land = () => { el.classList.add('open'); try { const r = el.getBoundingClientRect(); glyphBurst({ left: r.left - 8, top: r.top - 8, width: r.width + 16, height: r.height + 16 }, 700, 0.9); } catch {} setTimeout(() => el.remove(), 2600); done && done(); };
      if (reduced() || !el.animate) { el.style.transform = `translate(${dx}px,${dy}px)`; setTimeout(land, 300); return; }
      const a = el.animate([
        { transform: 'translate(-50%,-50%) scale(.3) rotate(0deg)', opacity: 0 },
        { transform: `translate(calc(-50% + ${dx * 0.5}px), calc(-50% + ${dy - 56}px)) scale(1) rotate(-14deg)`, opacity: 1, offset: 0.5 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1) rotate(6deg)`, opacity: 1 },
      ], { duration: 1300, easing: 'cubic-bezier(.3,.7,.5,1)', fill: 'forwards' });
      a.onfinish = () => setTimeout(land, 150);
    } catch { done && done(); }
  }
  // force: a number 0..1 picks the gift (testing); returns the gift record or null
  function giveGift(force) {
    try {
      if (!CFG.on || !awake() || MS.giftBusy) return null; memInit();
      const m = CFG.mem, g = pickGift(force); MS.giftBusy = true;
      m.nextGift = m.active + rnd(45, 90) * 60000;
      let label = '';
      if (g.kind === 'golden') { label = 'THE GOLDEN CARROT! +100 coins, +60 XP'; addCoins(100); addXp(60); }
      else if (g.kind === 'item') { CFG.owned.push(g.id); label = `a free ${itemName(g.id)}`; saveNow(); fire('twr-config', cfgCopy()); }
      else if (g.kind === 'xp') { label = `+${g.n} XP`; setTimeout(() => addXp(g.n), 4200); } // after his gift line, so a level-up message does not talk over it
      else { label = `+${g.n} coins`; addCoins(g.n); }
      const rec = { t: Date.now(), kind: g.kind, text: label.replace(/^a free /, '').replace(/^THE /, ''), id: g.id || '' };
      m.gifts.unshift(rec); memPrune(); saveNow(); stat('gifts');
      parcel(g.kind, () => {
        MS.giftBusy = false;
        const head = g.kind === 'golden' ? `${voice('gift')} ${label}` : `${voice('gift')} ${label}.`;
        say(withName(head, 0.2), g.kind === 'golden' ? 6200 : 4600);
        fire('twr-config', cfgCopy());
      });
      setTimeout(() => { MS.giftBusy = false; }, 9000);
      return rec;
    } catch (e) { MS.giftBusy = false; console.warn('twr.gift', e); return null; }
  }
  // keep the "burrow/rabbit hidden while the VJ fills the screen" class in sync (see vjFill)
  function syncFill() { try { document.body.classList.toggle('twr-vjfill', vjFill()); } catch {} }
  function watchFill() {
    try {
      syncFill(); window.addEventListener('hs-crate-section', syncFill);
      const mo = new MutationObserver(syncFill); mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
      const v = document.getElementById('view-crate'); if (v) mo.observe(v, { attributes: true, attributeFilter: ['class'] });
    } catch {}
  }

  // =====================================================================================================
  // VOICE: five personalities. Each cell is { o: openers, c: closers }: any opener + any closer makes a line, so 7 x 6 = 42+
  // lines per cell. voice(ev) never repeats any of the last 10 lines. Cells: greet idle tab saved deleted error hot late pet
  // level gift. Anything else falls back to LINES/PL above. TABQ = tab-specific quips (sassy uses TABLINES).
  // =====================================================================================================
  const RECENT = [];
  function fresh(make) { let t = ''; for (let i = 0; i < 10; i++) { t = make(); if (!RECENT.includes(t)) break; } RECENT.push(t); if (RECENT.length > 10) RECENT.shift(); return t; }
  function voice(ev) {
    try {
      const cell = (VOICE[CFG.personality] || VOICE.sassy)[ev], legacy = (PL[CFG.personality] || {})[ev] || LINES[ev];
      const line = fresh(() => ((cell && !(legacy && Math.random() < 0.1)) ? `${pick(cell.o)} ${pick(cell.c)}` : pick(legacy || LINES.idle)));
      return /^(greet|gift|level|saved|pet)$/.test(ev) ? withName(line, 0.1) : line;
    } catch { return pick(LINES[ev] || LINES.idle); }
  }
  function tabQuip(t) {
    const q = (TABQ[CFG.personality] || {})[t], pool = (q || []).concat(CFG.personality === 'sassy' || !q ? (TABLINES[t] || []) : []);
    return pool.length ? fresh(() => pick(pool)) : voice('tab');
  }
  const VOICE = {
    sassy: {
      greet: { o: ['Oh, look who it is.', 'Back already?', 'Hello, operator.', 'Well, well.', 'Morning, sunshine. Or whatever time it is.', 'You again. I mean that fondly.', 'The prodigal user returns.'], c: ['I kept your seat warm.', 'Let us have a good session.', 'I have opinions, as usual.', 'The carrots will not find themselves.', 'Let us make some questionable decisions.', 'The pixels missed you. So did I. Much.'] },
      idle: { o: ['Just sitting here.', 'Fun fact: I am bored.', 'Do not mind me.', 'Take your time.', 'Psst.', 'Still here.', 'Nothing to see.'], c: ['Watching over things.', 'Hydrate. I am serious.', 'Your desktop could use a tidy.', 'I have been counting your pixels.', 'Wake me if something needs me.', 'Carrot level: critical.'] },
      tab: { o: ['Oh, this tab.', 'New view, same you.', 'Bold choice.', 'Fancy.', 'Ooh, moving on already?', 'Navigating like a pro.', 'Okay, okay.'], c: ['I approve. Mostly.', 'Careful with the red buttons.', 'I will just supervise.', 'Try to stay a while this time.', 'The sidebar is ready for you.', 'Make it count.'] },
      saved: { o: ['Saved.', 'Backed up and glowing.', 'Look at you, being responsible.', 'Ctrl+S energy.', 'Done and done.', 'Written in stone. Well, storage.', 'Safe and sound.'], c: ['You are welcome.', 'Nicely done.', 'Future you says thanks.', 'Disaster averted, again.', 'Go on, treat yourself.', 'That is the spirit.'] },
      deleted: { o: ['Gone.', 'Poof.', 'Deleted.', 'Into the void it goes.', 'Evidence destroyed.', 'Swept under the rug.', 'Bye bye.'], c: ['I saw nothing.', 'All tidy.', 'It was probably clutter anyway.', 'Check Undo if that was a slip.', 'The recycle bin sends regards.', 'Rest in pixels.'] },
      error: { o: ['Well. That went poorly.', 'Oof.', 'Red text. Classic.', 'Plot twist: it broke.', 'Yikes.', 'Not my fault.', 'Error detected.'], c: ['Turn it off and on again?', 'I blame the intern.', 'Take a breath and retry.', 'Computers, am I right?', 'Check the details, genius.', 'I am sure it is fine. It is not fine.'] },
      hot: { o: ['It is toasty in here.', 'Hot hot hot.', 'Your laptop is sweating.', 'Is that a heater or a laptop?', 'Warm. Very warm.', 'The fans are crying.', 'Fire alarm material.'], c: ['Maybe check the fans?', 'Give it a breather.', 'Open FANS and cool it down.', 'I can smell the silicon.', 'Roasting marshmallows is not a feature.', 'Close a few tabs, hero.'] },
      late: { o: ['It is the middle of the night.', 'Still up?', 'Sleep is for the weak, apparently.', 'Nocturnal mode engaged.', 'The moon says hi.', 'Past midnight, champion.', 'Even I am yawning.'], c: ['Your bed is jealous.', 'Bugs are scarier in the dark.', 'Tomorrow-you will hate tonight-you.', 'Hydrate and go to bed.', 'The carrots can wait.', 'One more thing, then sleep. Sure.'] },
      pet: { o: ['Hehe.', 'Ok ok ok.', 'Careful, the ears.', 'Hey!', 'Aww, shucks.', 'That tickles.', 'You may continue.'], c: ['I allow this.', 'Do not tell anyone.', 'Pets are on the house.', 'Right behind the ear, please.', 'I am not blushing. You are.', 'My dignity is gone.'] },
      level: { o: ['LEVEL UP!', 'Ding!', 'Promotion time!', 'Look at you go!', 'New rank unlocked!', 'Experience points: acquired.', 'Levelling up like a champ!'], c: ['Do not let it go to your head.', 'New antics unlocked.', 'I am almost proud.', 'Keep it coming.', 'The carrots salute you.', 'Power creep begins.'] },
      gift: { o: ['Found this in the carrot patch.', 'Psst, delivery!', 'Look what the mailbox coughed up.', 'A parcel for you!', 'I may have borrowed this for you.', 'Surprise!', 'Special delivery!'], c: ['Do not ask where it came from.', 'Finders keepers, but it is yours.', 'Unwrap it, I dare you.', 'You earned it. Probably.', 'No returns.', 'Do not tell the others.'] },
    },
    helpful: {
      greet: { o: ['Welcome back!', 'Hello there!', 'Good to see you!', 'Hi, operator!', 'Ready when you are!', 'Nice to have you here.', 'Welcome! Settle in.'], c: ['I am here if you need me.', 'Let me know how I can help.', 'Today is going to be good.', 'Everything is running smoothly.', 'Take your time, no rush.', 'Shall we get started?'] },
      idle: { o: ['Quick tip:', 'Just a thought:', 'Gentle reminder:', 'Friendly nudge:', 'By the way:', 'Pro tip:', 'Did you know?'], c: ['Right-click things, most have menus.', 'Drag sidebar tiles to reorder them.', 'Ctrl+Space opens my terminal anywhere.', 'A short stretch does wonders.', 'A glass of water is a great idea.', 'FIND jumps to any setting by name.'] },
      tab: { o: ['Nice, welcome to this page!', 'Good spot.', 'Great choice!', 'Here we are.', 'This one is a handy page.', 'Another useful corner.', 'Lovely, on we go.'], c: ['Hover for hints.', 'Everything you need is here.', 'Ask me if anything is unclear.', 'Take a look around.', 'Right-click for more options.', 'I am cheering you on.'] },
      saved: { o: ['Saved!', 'All backed up.', 'Nicely done.', 'Your work is safe.', 'Got it, that is stored.', 'Saved successfully.', 'Done, and safe.'], c: ['Great job.', 'You can relax now.', 'Good habit!', 'Proud of you.', 'One less thing to worry about.', 'Keep up the good work.'] },
      deleted: { o: ['Removed.', 'Deleted.', 'All cleared.', 'That is gone now.', 'Tidied up.', 'Cleaned away.', 'Done.'], c: ['You can always redo it.', 'Check Undo if that was a slip.', 'A tidy space is a tidy mind.', 'Nice and neat.', 'Lighter already.', 'No harm done.'] },
      error: { o: ['Hmm, an error.', 'That did not work.', 'Something went wrong.', 'Oh no, a hiccup.', 'That failed, but it is okay.', 'An error appeared.', 'Not quite right.'], c: ['Check the details and try again?', 'I believe in you.', 'Most errors are easy to fix.', 'Take a breath, then retry.', 'Want to read the message together?', 'Let us figure it out.'] },
      hot: { o: ['It is getting warm in here.', 'Your laptop is running hot.', 'Temperature alert.', 'Heads up on the heat.', 'Things are heating up.', 'The sensors say it is hot.', 'A little too warm.'], c: ['Maybe open FANS and cool it down?', 'A short break would help.', 'Close a few heavy apps?', 'Good airflow makes a difference.', 'I can help you check.', 'Lifting the laptop helps airflow.'] },
      late: { o: ['It is very late.', 'You have been up a while.', 'Past midnight!', 'Gentle note:', 'The night is deep.', 'Rest matters too.', 'Quiet hours now.'], c: ['Sleep helps everything.', 'Maybe save and call it a night?', 'Your work will be here tomorrow.', 'Take care of yourself.', 'A rested mind fixes bugs faster.', 'Water, then bed?'] },
      pet: { o: ['Thank you!', 'Aww!', 'That is so kind.', 'Happy to help!', 'Hehe, thanks!', 'What a nice gesture.', 'I appreciate that.'], c: ['Need anything?', 'You are great.', 'Made my day.', 'Anything I can do?', 'Back to it?', 'You are doing well.'] },
      level: { o: ['Level up!', 'Congratulations!', 'Well done!', 'You levelled up!', 'New level reached!', 'Great progress!', 'Wonderful!'], c: ['New antics are waiting.', 'Keep going!', 'Proud of you.', 'You are on a roll.', 'Small steps add up.', 'Every bit counts.'] },
      gift: { o: ['I found something for you!', 'A little gift!', 'Surprise, this is for you.', 'Look what turned up!', 'A present, just because.', 'Something nice arrived.', 'I saved this for you.'], c: ['Hope you like it.', 'You deserve it.', 'Enjoy!', 'Thanks for being here.', 'Use it well.', 'No strings attached.'] },
    },
    chaotic: {
      greet: { o: ['HELLO!!', 'You are back!!', 'Ahoy!', 'BEHOLD!', 'Greetings, meat person!', 'It is YOU!', 'Zoop!'], c: ['I rearranged your pixels.', 'The carrots are plotting.', 'I ate a USB stick again.', 'Everything is on fire (kidding).', 'I have 400 ideas, all bad.', 'WiFi is my love language.'] },
      idle: { o: ['What if the mouse is the real user?', 'I ate a USB stick.', 'Carrot. Carrot. Carrot.', 'Hot take.', 'Breaking news.', 'Random thought.', 'Bzzzt.'], c: ['Tabs are just doors.', 'I rearranged your pixels, look closer.', 'Left is right and right is left.', 'Clouds are free RAM.', 'The cursor looked at me.', 'Hamster wheels power the router.'] },
      tab: { o: ['Teleport!', 'Ooh, shiny page!', 'Zoom zoom!', 'Whee!', 'New dimension!', 'Tab hop!', 'Switching realities.'], c: ['No seat belts.', 'Is that new? It looks new.', 'My favourite page (today).', 'I licked the sidebar.', 'Buttons everywhere!', 'Try pressing everything.'] },
      saved: { o: ['SAVED!!!', 'Saved to the moon.', 'I saved it somewhere.', 'Banked it!', 'Ker-chunk!', 'Saved (probably).', 'Into the vault!'], c: ['Do not ask where.', 'The moon has a backup.', 'Pretty sure it worked.', 'High five, no hands.', 'Confetti!', 'Zero regrets.'] },
      deleted: { o: ['KABOOM.', 'Gone!', 'Poof, vanished!', 'Deleted into another dimension.', 'Yeet!', 'Erased!', 'It left the building.'], c: ['Goodbye forever (or until undo).', 'It had a good run.', 'Fireworks!', 'A moment of noise.', 'Vanished like socks in a dryer.', 'I did not do it.'] },
      error: { o: ['AAAAA.', 'Chaos achieved.', 'It is fine.', 'Whoopsie!', 'Everything is broken!', 'Red alert!', 'The gremlins did it.'], c: ['It is fine. Probably.', 'Not me. Not me. Me.', 'Have you tried yelling at it?', 'Turn it off and on and off.', 'Error is the new feature.', 'Panic responsibly.'] },
      hot: { o: ['IT IS SO HOT!', 'Laptop is a toaster!', 'Roasting!', 'Lava mode!', 'The CPU is on fire!', 'Sizzle sizzle!', 'Warm bread incoming!'], c: ['Put it in the fridge!', 'Blow on it!', 'Fans, fans, FANS!', 'Fry an egg on it?', 'Cool it, buddy.', 'Open all the windows.'] },
      late: { o: ['IT IS THE WITCHING HOUR.', 'Moon time!', 'Why are we awake?', 'Night owl mode!', '3 AM thoughts.', 'The dark side has snacks.', 'The bats are active.'], c: ['Sleep is a rumour.', 'The pillow is calling.', 'Everything makes sense at night.', 'Bed is a portal.', 'Tomorrow is a scam.', 'Nap strategically.'] },
      pet: { o: ['BOOP!', 'Pet me again I dare you.', 'My ears have WiFi now.', 'Eek!', 'Zap!', 'Tickle tickle!', 'Ear scratch achieved!'], c: ['More!', 'Do it again.', 'I am vibrating.', 'Purr (I am not a cat).', 'Chaos approves.', 'Ears unlocked.'] },
      level: { o: ['LEVEL UP!!', 'DING DING!', 'Power surge!', 'I feel stronger!', 'New level, who dis?', 'XP explosion!', 'Rank up!!'], c: ['Confetti cannon!', 'Do a barrel roll.', 'Time for a victory lap.', 'The carrots clap.', 'More chaos unlocked.', 'Spin, spin, spin!'] },
      gift: { o: ['GIFT!!', 'Parcel falling from the sky!', 'Look what I found!', 'Surprise parcel!', 'Special delivery, probably legal!', 'Boop, a present!', 'Found it under a rock!'], c: ['Open it open it!', 'No takebacks!', 'It ticked a bit (kidding).', 'I wrapped it myself.', 'Totally not stolen.', 'Sharing is caring!'] },
    },
    zen: {
      greet: { o: ['Welcome.', 'Breathe in.', 'You have arrived.', 'Hello, traveller.', 'A new moment begins.', 'Peace be with your pixels.', 'Here you are.'], c: ['The day unfolds.', 'Nothing needs to be rushed.', 'All is well.', 'I was just sitting.', 'Begin where you are.', 'Be present.'] },
      idle: { o: ['Be like the idle process.', 'Inhale. Exhale.', 'Silence is also a feature.', 'Stillness.', 'The cursor rests.', 'Nothing to fix.', 'Quiet mind.'], c: ['Defrag your thoughts.', 'Flow.', 'All tabs are one tab.', 'The carrot knows.', 'Let the CPU rest.', 'This too is a feature.'] },
      tab: { o: ['A new page.', 'Another door opens.', 'Flow.', 'The path turns.', 'A fresh view.', 'Onward.', 'The tab changes.'], c: ['A new moment.', 'You stay the same.', 'Notice your breath.', 'Nothing is lost.', 'Look, and see.', 'Everything finds its place.'] },
      saved: { o: ['Saved.', 'The file is at peace.', 'Preserved.', 'It is written.', 'Stored in stillness.', 'Kept safe.', 'Done.'], c: ['Breathe.', 'Nothing is lost.', 'Let go of worry.', 'All is well.', 'The moment is kept.', 'Rest easy.'] },
      deleted: { o: ['Let go.', 'Released.', 'Gone.', 'Emptiness.', 'It passes.', 'Space made.', 'Deleted.'], c: ['Space is a gift.', 'Nothing clings.', 'Lighter now.', 'Impermanence.', 'Breathe out.', 'The void is tidy.'] },
      error: { o: ['An error is a lesson.', 'This too shall pass.', 'It broke.', 'A stumble.', 'Resistance.', 'Red text appears.', 'The error arrives.'], c: ['Breathe, then try again.', 'Do not fight it.', 'Look closer.', 'The fix is near.', 'Be patient.', 'Rivers go around rocks.'] },
      hot: { o: ['The machine runs warm.', 'Heat gathers.', 'Even stone gets hot.', 'Too much fire.', 'Warmth rises.', 'The fans sing.', 'A gentle warning.'], c: ['Let it cool.', 'Give it rest.', 'Open the fans.', 'Balance returns.', 'Breathe, and so does the laptop.', 'Ease the load.'] },
      late: { o: ['The night is deep.', 'Midnight.', 'Even the moon rests.', 'The hour is late.', 'Stars are out.', 'Darkness holds you.', 'Quiet hours.'], c: ['Rest is also work.', 'Sleep calls.', 'Tomorrow will come.', 'Close your eyes soon.', 'Let the screen dim.', 'The carrots dream.'] },
      pet: { o: ['...yes.', 'Mm. Calm.', 'Peace.', 'Warmth.', 'Gentle.', 'Ah.', 'Soft ears.'], c: ['This is enough.', 'Thank you.', 'Be here.', 'Again, slowly.', 'All is calm.', 'Breathe.'] },
      level: { o: ['A step forward.', 'You have grown.', 'Level up.', 'The path rises.', 'Another ring on the tree.', 'Progress, quietly.', 'Higher ground.'], c: ['Stay humble.', 'The journey continues.', 'Onward, softly.', 'Growth needs no applause.', 'Breathe.', 'Well walked.'] },
      gift: { o: ['A small gift.', 'Something found.', 'This is for you.', 'The path gave this.', 'A parcel arrives.', 'Receive it.', 'Unexpected kindness.'], c: ['Accept with open hands.', 'Nothing is owed.', 'Let it be.', 'Use it gently.', 'It found its way.', 'Gratitude.'] },
    },
    hacker: {
      greet: { o: ['$ login --user operator', 'Handshake complete.', 'Booting presence...', 'Connection established.', 'ssh rabbit@hyperspace', 'Session restored.', 'Daemon awake.'], c: ['Welcome back, root.', 'All services nominal.', 'Uptime is looking good.', 'Packets are flowing.', 'No intruders detected. Probably.', 'Run something fun.'] },
      idle: { o: ['tail -f /dev/matrix', 'Scanning ports... just kidding.', '$ whoami', 'Idle loop.', 'ping 127.0.0.1', 'htop says I am bored.', '$ sleep 30'], c: ['Packet loss: 0%. Vibes: 100%.', 'Your biggest fan.', 'Cache warm.', 'Latency: zero.', 'Kernel panic averted.', 'Nothing in the logs.'] },
      tab: { o: ['$ cd ./newtab', 'Loading view...', 'Routing...', 'GET /view 200 OK', '$ ls', 'Context switch.', 'Mounting page...'], c: ['100%.', 'Cache hit.', 'Permissions OK.', 'Stack trace clean.', 'No sudo needed.', 'Compiled in 0ms.'] },
      saved: { o: ['$ sync --force', 'write(fd) = OK.', 'Commit pushed.', 'fsync complete.', 'Buffer flushed.', 'Checksum matches.', 'Saved to disk.'], c: ['Exit code 0.', 'Easy.', 'No data loss.', 'Backup verified.', 'Ship it.', 'Merged cleanly.'] },
      deleted: { o: ['rm -rf success.', 'unlink() = 0.', 'File removed.', '$ rm -i yes', 'Inode freed.', '/dev/null accepts it.', 'Deleted.'], c: ['No recovery.', 'Garbage collected.', 'Trash is write-only.', 'Bits released.', 'Exit code 0.', 'Logged and forgotten.'] },
      error: { o: ['segfault in reality.dll', 'stderr: nope.', '$ cat error | sigh', 'Exception caught.', 'Exit code 1.', 'Stack overflow in my feelings.', '404: success not found.'], c: ['Have you tried sudo?', 'Check the logs.', 'Retry with --verbose.', 'Did you read the traceback?', 'Rolling back.', 'Patch incoming.'] },
      hot: { o: ['WARN: thermal threshold.', '$ sensors | grep hot', 'CPU temp elevated.', 'Thermal throttle risk.', '/sys/thermal says hot.', 'ALERT: temps rising.', 'Heat sink saturated.'], c: ['Open FANS.', 'Kill some processes.', '$ fans --max', 'Reduce load.', 'Check airflow.', 'Cooling is a feature.'] },
      late: { o: ['03:00 and still compiling.', 'cron says bedtime.', '$ uptime: too long.', 'Night shift detected.', 'Sleep daemon failed.', 'The kernel is dreaming.', 'Circadian rhythm: segfault.'], c: ['$ shutdown -h now (you)', 'Commit and sleep.', 'Debug tomorrow.', 'Backups run at night.', 'Close the laptop.', 'Coffee is not a sleep strategy.'] },
      pet: { o: ['$ pet --gently', 'access granted: ears', 'chmod +h', '200 OK, fluffy.', 'ear.exe responded.', 'Touch event received.', '$ touch ear'], c: ['Permission granted.', 'No sudo needed.', 'Heartbeat steady.', 'Thanks, root.', 'Handler registered.', 'Logging this fondly.'] },
      level: { o: ['LEVEL++', 'XP buffer full.', 'Rank updated.', 'Privilege escalation!', '$ sudo levelup', 'Achievement unlocked.', 'Upgrade complete.'], c: ['New antics deployed.', 'Build passing.', 'All tests green.', 'Stay root.', 'Version bumped.', 'Respect +1.'] },
      gift: { o: ['Incoming transfer.', 'Package received.', '$ scp parcel.tar ~', 'Download complete.', 'Payload delivered.', 'Dropped a file for you.', 'Cron delivered a gift.'], c: ['Checksum OK.', 'No malware, promise.', 'Unpack at will.', 'chmod +x your day.', 'Signature verified.', 'Mirror: the burrow.'] },
    },
  };
  // tab-specific quips for the four non-sassy voices (sassy = TABLINES at the top)
  const TABQ = {
    helpful: {
      nexus: ['OPERATIONS is your overview. Everything at a glance.', 'Tiles here can be dragged into your favourite order.'], afterburner: ['FANS: pick a preset and I will keep an eye on temps.', 'Quiet, balanced, cool or max: your choice.'],
      vj: ['VJ lives in CRATE now. VJ FULL fills the screen!', 'Pick a theme and let the music drive.'], crate: ['CRATE: your whole library, searchable.', 'Click a track for BPM, key and cues.'],
      deck: ['DECK has volume and now playing in one spot.', 'Handy for quick changes mid-set.'], router: ['The router sorts downloads so you do not have to.', 'Set a rule once, forget it forever.'],
      senses: ['SENSES keeps your mic and camera in your control.', 'It shows who has used them, too.'], notes: ['NOTES: jot a thought, it is saved for you.', 'Tip: type "note ..." in my terminal for quick lines.'],
      todo: ['TO-DO: small steps, one at a time.', 'Tip: type "todo ..." in my terminal to add one fast.'], hardware: ['HARDWARE lists every USB port and its speed.', 'Handy when a device will not connect.'],
      experts: ['The experts are friendly. Ask away!', 'They know this project well.'], settings: ['SETTINGS: FIND (Ctrl+F) jumps to anything.', 'Take your time, nothing here is permanent.'], games: ['A little break is good for you!', 'Have fun, I will keep things tidy.'],
    },
    chaotic: {
      nexus: ['OPERATIONS! Gauges! Numbers! Beeping!', 'I pressed everything here once. Do not ask.'], afterburner: ['FANS GO BRRRR.', 'Maximum wind! Hair optional!'],
      vj: ['VJ: BLINKY LIGHTS ACTIVATED.', 'Visuals in CRATE. Crate of visuals. Visual crate.'], crate: ['So many songs! I want them ALL!', 'Crate digging: archaeology but louder.'],
      deck: ['Tiny faders! I want to lick them!', 'DECK: do not touch the red knob (touch the red knob).'], router: ['Files go brrr into folders!', 'I am a file mailman now, give me a hat.'],
      senses: ['I SEE NOTHING. (I see everything.)', 'Mic off, camera off, chaos on.'], notes: ['Dear diary: the rabbit ate a cable.', 'Notes! Draw a rabbit in the margin!'],
      todo: ['TO-DO: ignore, ignore, panic, do.', 'The list has teeth. Be careful.'], hardware: ['Plug it in! Unplug it! Plug it in again!', 'USB is just a tiny hole for electrons.'],
      experts: ['EXPERTS! Ask them about carrots!', 'Brains! Many brains! (friendly)'], settings: ['SETTINGS: switches!! Flip them all!!', 'Do not flip them all. Flip some.'], games: ['GAMES!! Can I play too??', 'Winning is just losing backwards.'],
    },
    zen: {
      nexus: ['The overview. All things, one glance.', 'Calm gauges, calm mind.'], afterburner: ['Cool air, quiet mind.', 'The fan turns. You need not.'],
      vj: ['Light follows sound.', 'The visuals dwell in the crate now.'], crate: ['Music waits in the crate.', 'Choose slowly.'],
      deck: ['Volume is breath.', 'Small changes, large calm.'], router: ['Files find their folder.', 'Order from small rules.'],
      senses: ['Privacy is peace.', 'Eyes closed. Ears closed. Rest.'], notes: ['Write what is true.', 'The page is patient.'],
      todo: ['One task. Then the next.', 'The list is not the day.'], hardware: ['Ports are doorways.', 'Connect gently.'],
      experts: ['Ask, and listen.', 'Wisdom has many voices.'], settings: ['Few knobs matter.', 'Adjust, then leave it be.'], games: ['Play is also practice.', 'Win or lose, breathe.'],
    },
    hacker: {
      nexus: ['$ top: ops view loaded.', 'dashboard.sh: all gauges green.'], afterburner: ['$ fans --status', 'thermal governor attached.'],
      vj: ['visualizer.exe started in CRATE.', '$ vj --theme random'], crate: ['$ ls ~/music | wc -l', 'indexing library... done.'],
      deck: ['mixer.sock connected.', '$ amixer set Master'], router: ['$ cat rules | sort', 'inotify watching Downloads.'],
      senses: ['$ cat /dev/mic: permission denied.', 'privacy.sh enforcing.'], notes: ['$ vim journal.txt', 'journal.enc mounted.'],
      todo: ['$ cat todo.txt | wc -l', 'tasks.db opened.'], hardware: ['$ lsusb', 'devices enumerated.'],
      experts: ['$ man experts', 'consulting the council.'], settings: ['$ vim ~/.config/hyperspace', 'config.json read-write.'], games: ['$ ./play --no-save', 'entering sandbox.'],
    },
  };

  // =====================================================================================================
  // MOCKING: window.twr.mock(from, to). The notes spell checker fires 'hs-spell-corrected' {from,to} when a misspelling is fixed.
  //   He pops out and laughs at you. Four animations (point-and-laugh, barrel roll, spelling-bee trophy, dropped dictionary).
  // =====================================================================================================
  const MOCKS = [
    'Ha! "{from}"? Did your fingers go on holiday?', 'You wrote "{from}". Bold. Wrong, but bold.', '"{from}" became "{to}". Want a gold star?',
    'Spell check had to carry you again.', 'I would help, but I am too busy laughing at "{from}".', 'Nobody tell the dictionary about "{from}".',
    'Even the red squiggle gave up on "{from}".', 'Typing is hard. "{from}" is harder, apparently.', 'I have seen carrots with better spelling.',
    'Fixed it? Good. "{to}" thanks you for the rescue.', 'Mind the gap between "{from}" and "{to}". It is wide.', 'Breaking news: "{from}" is not a word. Film at eleven.',
    'Your keyboard called. It wants an apology.', 'Was that a typo or a cry for help?',
  ];
  const mockClean = (w) => String(w == null ? '' : w).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 18);
  function mockLine(from, to) {
    let t = ''; for (let i = 0; i < 8; i++) { t = pick(MOCKS).replace(/\{from\}/g, from || 'that').replace(/\{to\}/g, to || 'the right word'); if (!RECENT.includes(t)) break; }
    RECENT.push(t); if (RECENT.length > 10) RECENT.shift(); return t;
  }
  const MOCK_ANIMS = {
    point(line, c) { // points and laughs, shaking
      START(c, 'shrug'); pos.classList.add('giggle');
      later(500, () => { setPose('dance'); burst('honk', ['HA', 'ha!', 'HA!'], 8); bubbleText(line, 2600); });
      later(1700, () => { setPose('shrug'); burst('honk', ['ha', 'HA!', 'ha ha'], 7); });
      later(3000, () => pos.classList.remove('giggle')); return 4800;
    },
    roll(line, c) { // rolls around laughing
      const dir = c.x > innerWidth / 2 ? -1 : 1, x0 = c.x, y = c.y; START(c, 'dance'); const tok = S.tok;
      later(500, () => timeline(tok, 1500, [{ a: 0, d: 1400, fn: (p) => { const x = x0 + dir * 200 * ease(p); pos.style.transform = `translate(${x - W / 2}px,${y - H + SC}px) rotate(${dir * 720 * ease(p)}deg)`; S.at = { x, y }; } }], () => { moveTo(x0 + dir * 200, y, dir < 0); setPose('shrug'); bubbleText(line, 2600); burst('honk', ['ha', 'HA!'], 6); }));
      return 4800;
    },
    trophy(line, c) { // pops up with a tiny spelling-bee trophy
      START(c, 'wave'); spr.over = { hat: 'party' }; spr.dirty = true;
      later(500, () => { const cv = propAt('trophy', c.x + 18, c.y - H * 0.78, 3); let k = 0; const iv = setInterval(() => { if (!cv.isConnected) return clearInterval(iv); k++; at(cv, c.x + 18, c.y - H * 0.78 + (k & 1 ? -3 : 0)); }, 280); S.undo.push(() => clearInterval(iv)); burst('spark', ['★', '✦', '*'], 8); bubbleText(line, 2800); });
      later(2600, () => bubbleText('Spelling bee champion. Not you. Me.', 2200)); return 5400;
    },
    dict(line, c) { // drops a dictionary
      START(c, 'idle'); const tok = S.tok, bx = c.x + (c.x > innerWidth - 150 ? -34 : 34);
      later(400, () => { const cv = propAt('dict', bx, -60, 4); timeline(tok, 700, [{ a: 0, d: 600, fn: (p) => at(cv, bx, -60 + (c.y - 28 + 60) * p * p) }], () => { at(cv, bx, c.y - 28); burst('spark', ['▒', '░', '.'], 6); setPose('shrug'); bubbleText('THUD. Look it up.', 1800); }); });
      later(2400, () => { setPose('wave'); bubbleText(line, 2600); }); return 5600;
    },
  };
  function mock(from, to, force) {
    try {
      if (!awake() || !build()) return false;
      from = mockClean(from); to = mockClean(to);
      const now = Date.now(); if (!force && now - (S.lastMock || 0) < 20000) return false; S.lastMock = now;
      const line = mockLine(from, to);
      if (reduced()) return say(line, 2800);
      cancel(); S.busy = true; const c = corner(); const names = Object.keys(MOCK_ANIMS); let k = pick(names); if (k === S.lastMockAnim && names.length > 1) k = names[(names.indexOf(k) + 1) % names.length]; S.lastMockAnim = k;
      const d = MOCK_ANIMS[k](line, c); stat('pops'); addXp(2); stayThenHide(d + 700); return k;
    } catch (e) { console.warn('twr.mock', e); S.busy = false; return false; }
  }
  const onSpell = (e) => { try { const d = (e && e.detail) || {}, key = `${d.from}>${d.to}`, n = Date.now(); if (onSpell.k === key && n - (onSpell.t || 0) < 400) return; onSpell.k = key; onSpell.t = n; if (CFG.on) mock(d.from, d.to); } catch {} };
  window.addEventListener('hs-spell-corrected', onSpell); document.addEventListener('hs-spell-corrected', onSpell);

  // =====================================================================================================
  // TIPS & TUTORIAL: a small card (works even while the rabbit is dormant) with NEXT / SKIP.
  //   Shown on the first run, then at random (~35% a launch, once a day at most) during the first 48 hours; never after.
  //   window.hsTips.tutorial() restarts every tip from the start (Settings > ABOUT and Settings > THE WHITE RABBIT). First-run stamp: localStorage 'hs-first-run' (welcome.js).
  // =====================================================================================================
  const TIPS = [
    { tab: 'nexus', rabbit: true, t: 'Hi, I am twr. I will show you around. Press NEXT for the next tip, or SKIP whenever you like.' },
    { tab: 'nexus', t: 'OPERATIONS is home base: live stats, the mic and camera shields, and a one-click RAM cleanup.' },
    { tab: 'nexus', t: 'Mic and camera hotkeys work from any app: Ctrl+Alt+Shift+M for the mic, Ctrl+Alt+Shift+C for the camera.' },
    { tab: 'nexus', t: 'Put your tabs in your own order: drag any tile in the left sidebar and drop it where you want it. HYPERSPACE remembers.' },
    { tab: 'nexus', t: 'The strip along the top holds several views at once. Drag one away from the window to pop it out as its own HYPERSPACE.' },
    { tab: 'nexus', t: 'FIND is one keystroke away: press Ctrl+F (or Ctrl+K) and type any setting or page name to jump straight to it.' },
    { tab: 'nexus', t: 'The side dock slides in and out with Ctrl+Alt+D from anywhere. It holds QUICK NOTE and TO-DO, and its modules drag to reorder.' },
    { tab: 'nexus', rabbit: true, t: 'Press Ctrl+Space and my terminal opens. Try "open fans", "find journal", "todo buy carrots" or "timer 10m tea".' },
    { tab: 'afterburner', t: 'FANS: QUIET, BALANCED, COOL and MAX set the whole cooling profile in one click. Custom curves are under advanced.' },
    { tab: 'afterburner', t: 'Thermal alerts can warn you when a part runs hot, so a laptop on a duvet does not cook in silence.' },
    { tab: 'crate', t: 'MUSIC has three sections: LIBRARY, PLAYER / DJ and VJ. Switch between them with the big tiles at the top.' },
    { tab: 'crate', t: 'LIBRARY reads your rekordbox collection: BPM, keys and cues. Smart playlists fill themselves from rules you pick.' },
    { tab: 'crate', t: 'In MUSIC > VJ, VJ FULL fills the screen with visuals that dance to your music, and a mini player keeps the controls in reach.' },
    { tab: 'deck', t: 'DECK puts volume, now playing, speakers and screens in one place. Save a SCENE to jump between setups with one click.' },
    { tab: 'gamehub', t: 'GAMING lists your games and tracks playtime. It also has a game mode, a performance overlay and a controller tester.' },
    { tab: 'router', t: 'FILE ROUTER sorts new downloads into folders by the rules you set. Set it once and your Downloads folder stays tidy.' },
    { tab: 'senses', t: 'SENSES can seal the mic or camera and shows which apps have used them.' },
    { tab: 'notes', t: 'NOTES keeps your pages in a private vault you can lock. Keep the recovery code somewhere safe, away from this laptop.' },
    { tab: 'notes', t: 'Write it like a bullet journal: "- " makes a bullet, "- [ ] " a tick box, "# " a heading. Dated Journal pages and the month calendar keep your days in order.' },
    { tab: 'notes', t: 'Drag a page from the list onto a notebook, a section or the trash to move it. Drag files onto a page to attach them.' },
    { tab: 'notes', t: 'The VIEW button flips a page between writing and the finished look. Templates start a page from a ready-made layout.' },
    { tab: 'todo', t: 'TO-DO has categories, due dates and reminders. The side dock has a TO-DO too, so you can add one from any tab.' },
    { tab: 'hardware', t: 'HARDWARE lists every USB port with power and speed, and remembers the devices you have plugged in.' },
    { tab: 'experts', t: 'EXPERTS: ask a question and the project experts answer. They know how this app works.' },
    { tab: 'settings', t: 'Settings has a backup card. Check it before big changes, and your setup travels with you.' },
    { tab: 'settings', t: 'Want to control HYPERSPACE from your phone? Pair it with the QR code in Settings (same Wi-Fi needed).' },
    { tab: 'nexus', t: 'That is the tour. Replay it any time from Settings > ABOUT > TIPS TUTORIAL. Have fun, operator.' },
  ];
  const TP = { el: null, list: [], i: 0, pi: 0, mode: '', roll: Math.random() < 0.35 };
  const tipTabOK = (t) => { if (!t.tab) return true; const nav = document.querySelector(`.nav[data-view="${t.tab}"]`); return !(nav && nav.classList.contains('hidden')); };
  const tipPool = () => TIPS.filter((t) => (!t.rabbit || CFG.on) && tipTabOK(t));
  function tipsClose() { if (TP.el) { TP.el.remove(); TP.el = null; } TP.list = []; }
  function tipsPlace() {
    const el = TP.el; if (!el) return;
    const sb = document.querySelector('.statusbar'), sr = sb && sb.getBoundingClientRect(), side = document.querySelector('.side'), sd = side && side.getBoundingClientRect();
    el.style.bottom = `${(sr && sr.height ? innerHeight - sr.top : 0) + 16}px`;
    if (homeOn() && CFG.homeCorner[1] === 'l') { el.style.left = ''; el.style.right = '18px'; } else { el.style.right = ''; el.style.left = `${(sd ? sd.right : 0) + 18}px`; }
  }
  function tipsShow() {
    if (!TP.list.length) return tipsClose();
    const t = TP.list[TP.i], last = TP.i >= TP.list.length - 1, tut = TP.mode === 'tutorial';
    if (tut && t.tab) { try { gotoTab(t.tab); } catch {} }
    if (!TP.el) {
      const el = document.createElement('div'); el.id = 'twr-tip'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Tip');
      el.innerHTML = '<div class="tt-pic" data-twr-scale="2"></div><div class="tt-body"><div class="tt-h"></div><div class="tt-t"></div><div class="tt-b"><button type="button" class="tt-skip">SKIP</button><button type="button" class="tt-next"></button></div></div>';
      el.querySelector('.tt-skip').addEventListener('click', () => tipsClose());
      el.querySelector('.tt-next').addEventListener('click', () => { if (TP.i >= TP.list.length - 1) return tipsClose(); TP.i++; tipsShow(); });
      document.body.appendChild(el); TP.el = el;
      try { draw(el.querySelector('.tt-pic'), null, 'wave'); } catch {}
    }
    const el = TP.el;
    el.querySelector('.tt-h').textContent = `${tut ? 'TUTORIAL' : 'TIP'} ${TP.i + 1} / ${TP.list.length}${t.tab && TABNAME[t.tab] ? ` · ${TABNAME[t.tab]}` : ''}`;
    el.querySelector('.tt-t').textContent = t.t;
    el.querySelector('.tt-next').textContent = last ? 'DONE' : 'NEXT';
    el.querySelector('.tt-skip').style.display = last ? 'none' : '';
    tipsPlace();
    if (!tut) lsSet('hs-tips-i', String(Math.max(+lsGet('hs-tips-i') || 0, TP.pi + TP.i + 1)));
  }
  function tipsStart(mode, count) {
    try {
      if (window.hs && hs.remote) return false;
      const pool = tipPool(); let list = pool, pi = 0;
      if (mode !== 'tutorial') { pi = Math.min(+lsGet('hs-tips-i') || 0, pool.length); list = pool.slice(pi, pi + count); if (!list.length) return false; }
      tipsClose(); TP.list = list; TP.i = 0; TP.mode = mode; TP.pi = pi; tipsShow(); return true;
    } catch (e) { console.warn('twr.tips', e); return false; }
  }
  function tipsAuto(tries) {
    try {
      if (/[?&]solo/.test(location.search)) return; // popped-out windows never show tips
      const fr = +lsGet('hs-first-run'); if (!fr) return; // 0 or missing: an existing install, never auto
      if (Date.now() - fr > 48 * 3600e3) return;
      const n = +lsGet('hs-tips-n') || 0;
      if (n > 0 && (!TP.roll || Date.now() - (+lsGet('hs-tips-last') || 0) < 20 * 3600e3)) return;
      const busyNow = document.body.classList.contains('booting') || document.getElementById('hsw') || (document.getElementById('intro') && document.getElementById('intro').offsetParent) || document.hidden || TP.el;
      if (busyNow) { if ((tries || 0) < 60) setTimeout(() => tipsAuto((tries || 0) + 1), 5000); return; }
      if (tipsStart('auto', n === 0 ? 6 : 3)) { lsSet('hs-tips-n', String(n + 1)); lsSet('hs-tips-last', String(Date.now())); }
    } catch {}
  }
  addEventListener('resize', () => { try { tipsPlace(); } catch {} });
  window.hsTips = { tutorial: () => tipsStart('tutorial'), close: tipsClose, count: () => tipPool().length };
  setTimeout(() => tipsAuto(0), 9000);

  // ---------- public API ----------
  function draw(container, over, pose) {
    try {
      if (!container) return null;
      const c = Object.assign(cfgCopy(), over || {}), sc = +container.dataset.twrScale || 3;
      container.textContent = '';
      const s = Spr(c, sc); s.set(pose || 'idle'); container.appendChild(s.cv);
      return { cv: s.cv, update(o, p) { Object.assign(c, o || {}); s.setCfg(c); if (p) s.set(p); }, pose(p) { s.set(p); } };
    } catch (e) { console.warn('twr.draw', e); return null; }
  }
  const stage = {
    demo(name) {
      try {
        if (!awake()) return false;
        if (typeof name === 'string' && name.startsWith('tow-')) return demoTow(name.slice(4));
        if (name === 'peek') { cancel(); return popBehind(pick(['panel', 'nav', 'text', 'corner'])); }
        if (REACT[name]) { S.last[name] = 0; return react(name); }
        if (ANTICS[name]) {
          if (antic(name, true)) return true;
          say(`Open the ${TABNAME[ANTICS[name].tab] || 'right'} tab to see that one.`, 2600); return false;
        }
        return false;
      } catch { return false; }
    },
  };
  const antics = ANTIC_NAMES.concat(['peek'], SCENES.map((s) => `tow-${s}`));
  const api = {
    say, react, tow, scene, scenes: SCENES.slice(), popBehind, pet, enabled: () => awake(), cfg: cfgCopy, setCfg, buy, owns, level, coins, draw, stage, antics, tab: curTab, mem: memRead, resetMem, gift: giveGift,
    catalog: CATALOG, poke, mock, tutorial: () => tipsStart('tutorial'), home: homeRectOrNull, homePoint, assistant: { open: openAst, close: closeAst, toggle: toggleAst, run: (t) => runCmd(String(t || '')) },
    enable(on) { setCfg({ on: !!on }); if (on) { lsSet('hs-twr-until', null); say('I am back. Miss me?', 2200); } return !!on; },
  };
  window.twr = api;
  setTimeout(() => fire('twr-ready', null), 0);
  document.addEventListener('visibilitychange', () => { if (document.hidden && S.busy) { /* timers keep running; the rabbit just finishes quietly */ } });
  const start = () => { try { build(); if (!CFG.on) cancel(true); wireSide(); lastTab = curTab(); memOpen(); memTab(lastTab); watchFill(); setTimeout(greetNow, 9000); setInterval(memTick, 30000); watchTab(); schedule(); initHome(); setInterval(drainQ, 500); } catch (e) { console.warn('twr init', e); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
