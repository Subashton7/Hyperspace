// TO-DO: a personal to-do list in colour-coded categories. The quest line "DE-BIG-TECH MY LIFE": stages from quick wins to running
// your own cloud, every quest rated for difficulty and impact, with XP, ranks, badges and a live percentage.
// Progress is saved in todo.json next to the app's settings (it holds checkmarks, nothing private).
(() => {
  const root = $('#view-todo');
  if (!root) return;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------------- the quest line ----------------
  // d = difficulty 1-5 (how hard / how long), i = impact 1-5 (how much big tech it actually cuts out)
  const STAGES = [
    { n: 1, name: 'QUICK WINS', sub: 'minutes each · big effect for almost no effort' },
    { n: 2, name: 'MOVE YOUR STUFF', sub: 'an afternoon each · get your data out' },
    { n: 3, name: 'LOCK IT DOWN', sub: 'make what you own private and safe' },
    { n: 4, name: 'YOUR OWN CLOUD', sub: 'the home server replaces their servers' },
    { n: 5, name: 'ENDGAME', sub: 'the hard, life-changing ones' },
  ];
  const Q = [
    // stage 1
    { id: 'browser', need: 'brave', s: 1, d: 1, i: 4, t: '5 min', name: 'Make Brave your default browser', why: 'Your browser sees everything you do online. Brave blocks trackers and ads out of the box.', spot: 'Brave is installed and you use it already: tick this if it\'s also the default on the laptop and phone.',
      steps: ['Laptop: Settings → Apps → Default apps → Brave → Set default', 'iPhone: Settings → Apps → Default Apps → Browser App → Brave', 'Move your bookmarks over (Brave: Settings → Import bookmarks)'] },
    { id: 'search', s: 1, d: 1, i: 4, t: '5 min', name: 'Search without Google or Bing', why: 'Search history is one of the most personal things they keep on you.',
      steps: ['In Brave: Settings → Search engine → Brave Search (or DuckDuckGo / Startpage)', 'Same on the iPhone in Brave', 'If you still use Safari: Settings → Apps → Safari → Search Engine → DuckDuckGo'] },
    { id: 'vpn', need: 'protonvpn', s: 1, d: 1, i: 3, t: '5 min', name: 'Run a no-logs VPN (Proton VPN)', why: 'Hides what you do from your internet provider and public Wi-Fi.', spot: 'HYPERSPACE sees Proton VPN on this computer.',
      steps: ['Proton VPN on the laptop: turn on "Start on boot" and the kill switch', 'Proton VPN on the iPhone, set to always-on'] },
    { id: 'signal', need: 'signal', s: 1, d: 2, i: 4, t: '1 hour', name: 'Move your close chats to Signal', why: 'End-to-end encrypted and run by a non-profit: nobody can read or sell your messages.', spot: 'Signal is installed on this computer.',
      steps: ['Signal on your phone and laptop', 'Get your 5 most-messaged people on it', 'Make a group chat for your crew / gigs'] },
    { id: 'passwords', s: 1, d: 2, i: 5, t: '1 hour', name: 'Passwords out of Google / Apple / Microsoft', why: 'Whoever holds your passwords holds every account. Proton Pass or Bitwarden are independent.', help: 'proton-pass',
      steps: ['Export saved passwords from Chrome / Edge / iCloud Keychain', 'Import them into Proton Pass', 'Delete them from the browser and turn off "offer to save passwords"', 'Proton Pass on the iPhone: Settings → General → AutoFill & Passwords'] },
    { id: 'winprivacy', s: 1, d: 1, i: 3, t: '15 min', name: 'Turn off Windows ads and tracking', why: 'Windows sends a stream of usage data to Microsoft and shows ads in Start.',
      steps: ['Settings → Privacy & security → General: turn everything off', 'Privacy & security → Diagnostics & feedback: required data only, tailored experiences off', 'Privacy & security → Search permissions: cloud content search off', 'Personalization → Start: recommendations and tips off', 'Personalization → Lock screen: "fun facts, tips" off'] },
    { id: 'iphone', s: 1, d: 1, i: 3, t: '15 min', name: 'Tighten the iPhone\'s privacy', why: 'Apps track you across each other unless you say no.',
      steps: ['Settings → Privacy & Security → Tracking: "Allow apps to request" off', 'Location Services: set each app to "While Using" or Never', 'Privacy & Security → Analytics & Improvements: all off', 'Privacy & Security → Apple Advertising: Personalized Ads off'] },
    { id: 'bloat', s: 1, d: 1, i: 2, t: '15 min', name: 'Uninstall big-tech apps you don\'t use', why: 'Fewer apps phoning home, more space and memory.',
      steps: ['Settings → Apps → Installed apps', 'Remove: Microsoft Teams (personal), Clipchamp, News, Microsoft To Do, anything else you never open', 'Chrome too, once Brave has your bookmarks'] },
    // stage 2
    { id: 'onedrive', need: 'fromonedrive', s: 2, d: 2, i: 5, t: '2 hours', name: 'Get your files out of OneDrive', why: 'Your documents shouldn\'t live on Microsoft\'s servers by default.', spot: 'There\'s a "From OneDrive" folder in Documents: looks like you\'ve started.',
      steps: ['Copy everything onto the laptop', 'Check nothing is missing (open a few folders)', 'Settings → Accounts → (OneDrive) → Unlink this PC', 'Uninstall OneDrive'], pre: [0] },
    { id: 'onenote', s: 2, d: 2, i: 5, t: '30 min', name: 'Replace OneNote with HYPERSPACE NOTES', why: 'Your journal belongs on your own drives, encrypted with a password only you know.', help: 'notes',
      steps: ['Open NOTES and make your master password', 'Write your recovery key on paper', 'IMPORT ONENOTE', 'Add the SSD as a copy', 'Spot-check a few journal pages, then stop using OneNote'] },
    { id: 'music', s: 2, d: 2, i: 4, t: '1 hour', name: 'Back up your music library to the SSD', why: 'Your tracks, crates and cue points are your livelihood: keep them on hardware you own.',
      steps: ['Copy your music folders to the SSD', 'rekordbox: File → Library → Backup Library, save it to the SSD', 'Repeat after big download sessions'] },
    { id: 'email', s: 2, d: 4, i: 5, t: 'a few weeks, bit by bit', name: 'Make Proton Mail your main email', why: 'Email is the key to every account. Proton can\'t read yours; Gmail and Outlook scan it.',
      steps: ['Gmail / Outlook: forward everything to Proton Mail', 'Tell your contacts and bookings people your new address', 'Change the login email on each account (bank, SoundCloud, Beatport, stores…) one at a time', 'After a few quiet months, stop the forwarding'] },
    { id: 'calendar', s: 2, d: 2, i: 3, t: '1 hour', name: 'Calendar and contacts to Proton', why: 'Your gig schedule and contacts say a lot about you.',
      steps: ['Export your calendar (.ics) and contacts (.vcf) from Google / Outlook', 'Import them into Proton Calendar and Proton Contacts', 'Add Proton Calendar on the iPhone'] },
    { id: 'photos', s: 2, d: 3, i: 5, t: 'an evening + downloads', name: 'Get your photos out of Google Photos / iCloud', why: 'Photos are the biggest pile of personal data most people have in the cloud.',
      steps: ['Google: takeout.google.com → only Google Photos → export', 'iCloud: privacy.apple.com → request a copy of your photos', 'Unzip onto the laptop and copy to the SSD', 'Later: Immich on the home server (stage 4)'] },
    { id: 'office', s: 2, d: 2, i: 3, t: '30 min', name: 'LibreOffice instead of Word, Excel and PowerPoint', why: 'Free, open-source, opens your existing files, no account.',
      steps: ['Install LibreOffice (libreoffice.org)', 'Open a few of your documents to check they look right', 'Make it the default for .docx / .xlsx / .pptx'] },
    { id: 'twofa', s: 2, d: 2, i: 4, t: '1 hour', name: 'Move your 2-step codes off Google / Microsoft Authenticator', why: 'If those apps lock you out, so does every account behind them.',
      steps: ['Install Ente Auth (open-source) or use Proton Pass\'s built-in codes', 'For each account: Security settings → set up the authenticator again with the new app', 'Write each site\'s backup codes on paper', 'Delete the old authenticator only when everything is moved'] },
    { id: 'youtube', s: 2, d: 1, i: 2, t: '10 min', name: 'Watch YouTube without the tracking', why: 'No account, no watch-history profile, no ads.',
      steps: ['Laptop: FreeTube (freetubeapp.io), import your subscriptions', 'iPhone: watch YouTube in Brave instead of the app'] },
    { id: 'maps', s: 2, d: 1, i: 2, t: '10 min', name: 'Maps without Google: Organic Maps', why: 'Works offline, no location history sent anywhere.',
      steps: ['Install Organic Maps on the iPhone', 'Download your city\'s map for offline use'] },
    // stage 3
    { id: 'diskenc', s: 3, d: 3, i: 5, t: '1 hour', name: 'Encrypt the laptop\'s drive', why: 'If the laptop is lost or stolen, nothing on it can be read. (Right now it isn\'t encrypted.)',
      steps: ['Settings → Privacy & security → Device encryption → On (if it\'s listed)', 'Not listed? VeraCrypt (veracrypt.fr) can encrypt the whole drive', 'Keep the recovery key on paper, NOT only in your Microsoft account'] },
    { id: 'ssdenc', s: 3, d: 3, i: 4, t: '1 hour + copying', name: 'Encrypt the backup SSD', why: 'A portable SSD is easy to lose. HYPERSPACE NOTES is already encrypted; this covers everything else on it.',
      steps: ['VeraCrypt: make an encrypted container (or encrypt the whole drive)', 'Move your backups into it', 'Test opening it on the laptop'] },
    { id: 'domain', s: 3, d: 3, i: 4, t: '1 hour', name: 'Your own email address (e.g. you@yourname.com)', why: 'Own your address: you can switch email providers forever without telling anyone. Looks pro for bookings too.',
      steps: ['Buy the domain (an independent registrar like Porkbun or Namecheap)', 'Add it to Proton Mail (needs a paid plan)', 'Use it for new accounts and bookings'] },
    { id: 'localacct', s: 3, d: 3, i: 4, t: '30 min', name: 'Sign in to Windows with a local account', why: 'A Microsoft account ties your Windows login, settings and activity to Microsoft.',
      steps: ['First: OneDrive unlinked and Store purchases sorted', 'Settings → Accounts → Your info → "Sign in with a local account instead"', 'Pick a strong password'] },
    { id: 'dns', s: 3, d: 2, i: 3, t: '20 min', name: 'Private DNS for the whole house', why: 'Every website lookup goes through DNS; your provider logs it unless you change it.',
      steps: ['Router settings → DNS → Quad9: 9.9.9.9 and 149.112.112.112', 'Or NextDNS for blocking trackers on every device'] },
    { id: 'accounts', s: 3, d: 3, i: 3, t: 'an evening', name: 'Close the accounts you don\'t use', why: 'Every forgotten account is a leak waiting to happen.',
      steps: ['Go through your password manager list', 'Delete accounts you don\'t need (justdeleteme.xyz shows how for each site)', 'Remove them from the password manager'] },
    // stage 4
    { id: 'server', s: 4, d: 2, i: 3, t: 'research + order', name: 'Pick your home server hardware', why: 'A small quiet box at home that holds your files, photos and notes.',
      steps: ['A used mini PC (Lenovo / Dell / HP "tiny") with 16 GB RAM is plenty', 'Two drives, so one can fail without losing anything', 'Or start with an old laptop to learn'] },
    { id: 'serveros', s: 4, d: 4, i: 4, t: 'a weekend', name: 'Install the server\'s system', why: 'Free, open-source systems made for exactly this.',
      steps: ['TrueNAS SCALE (point-and-click NAS) or Debian / Ubuntu Server', 'Set up two drives mirrored', 'Share a folder on your home network'] },
    { id: 'syncthing', s: 4, d: 3, i: 5, t: '1 hour', name: 'Sync the laptop with the server (Syncthing)', why: 'Your own Dropbox / OneDrive: files copy between your devices directly, no company in the middle.',
      steps: ['Syncthing on the laptop and the server', 'Share Documents, your music and From OneDrive', 'Optional: Möbius Sync on the iPhone'] },
    { id: 'notesmirror', s: 4, d: 1, i: 4, t: '5 min', name: 'Add the server as a NOTES copy', why: 'Your journal on a third device: laptop, SSD and home.', help: 'notes',
      steps: ['NOTES → ⚙ VAULT → CHOOSE A FOLDER → the server share', 'Check it shows ✓ in the copies bar'] },
    { id: 'immich', s: 4, d: 4, i: 5, t: 'an evening', name: 'Immich: your own Google Photos', why: 'Auto-backs up the iPhone camera roll to your server, with face search and albums.',
      steps: ['Install Immich on the server', 'Immich app on the iPhone, turn on backup', 'Import the Google / iCloud export from stage 2'] },
    { id: 'remote', s: 4, d: 4, i: 4, t: 'an evening', name: 'Reach home from anywhere (WireGuard)', why: 'Your files and notes from the road, without opening your home to the internet.',
      steps: ['WireGuard on the server (or Headscale / Tailscale)', 'WireGuard on the iPhone and laptop', 'Test from mobile data'] },
    { id: 'backups', s: 4, d: 4, i: 5, t: 'an evening', name: 'Real backups: 3-2-1', why: '3 copies, on 2 kinds of storage, 1 away from home. The rule that saves people.',
      steps: ['Laptop + server + SSD = 3 copies', 'Automate it (restic or Borg on the server)', 'Keep the SSD at family / a friend\'s, swap it monthly'] },
    // stage 5
    { id: 'hostages', s: 5, d: 1, i: 3, t: '20 min', name: 'List your "hostage" apps', why: 'Know exactly what still keeps you on Windows, Apple or Google, and what could replace each one.',
      steps: ['Write the list in NOTES (rekordbox, Serato, Resolume, iCloud for the iPhone, games…)', 'Next to each: an open alternative, or "keep for now"'] },
    { id: 'linux', s: 5, d: 5, i: 5, t: 'a weekend', name: 'Try Linux (dual boot Linux Mint)', why: 'The biggest single step away from Microsoft. Dual boot keeps Windows for the apps that need it.',
      steps: ['Back up everything first (stage 4)', 'Make a Linux Mint USB stick and try it live', 'Install alongside Windows', 'Use Linux for everyday things; boot Windows for DJ software'] },
    { id: 'phone', s: 5, d: 5, i: 5, t: 'when the iPhone is due', name: 'A de-Googled phone (GrapheneOS)', why: 'A phone with no Google or Apple services at all. It runs on Pixel hardware but without Google\'s software.',
      steps: ['When it\'s time for a new phone: a Pixel', 'Install GrapheneOS (grapheneos.org, web installer)', 'Your apps: Signal, Proton, Organic Maps, Immich…'] },
    { id: 'ownsearch', need: 'searxng', s: 5, d: 3, i: 2, t: 'an evening', name: 'Your own private search (SearXNG)', why: 'A search engine on your server that asks many engines for you, without profiling.', spot: 'There\'s a searxng-master folder on your desktop: you may have started this.',
      steps: ['Run SearXNG on the home server (Docker)', 'Set it as Brave\'s search engine'] },
  ];
  const XP = (q) => q.d * 10 + q.i * 15;
  const TOTAL = Q.reduce((a, q) => a + XP(q), 0);
  const RANKS = [
    { at: 0, name: 'DATA SERF', line: 'They know everything. Time to change that.' },
    { at: 0.1, name: 'GLITCH IN THE FEED', line: 'The algorithm just lost track of you for a second.' },
    { at: 0.25, name: 'SIGNAL RUNNER', line: 'Your messages, your passwords, your rules.' },
    { at: 0.45, name: 'OFF-GRID OPERATOR', line: 'Your data lives on hardware you own.' },
    { at: 0.7, name: 'SOVEREIGN NODE', line: 'You run your own cloud now.' },
    { at: 1, name: 'GHOST IN THE MACHINE', line: 'Fully de-big-teched. Legend.' },
  ];
  const BADGES = [
    { id: 'first', name: 'FIRST BREAKOUT', how: 'finish any quest', test: (d) => d.length >= 1 },
    { id: 'quick', name: 'QUICK DRAW', how: 'clear every quick win', test: () => stageDone(1) },
    { id: 'heavy', name: 'HEAVY HITTER', how: '5 impact-5 quests', test: (d) => d.filter((q) => q.i === 5).length >= 5 },
    { id: 'mover', name: 'DATA EXODUS', how: 'clear MOVE YOUR STUFF', test: () => stageDone(2) },
    { id: 'vault', name: 'VAULT KEEPER', how: 'clear LOCK IT DOWN', test: () => stageDone(3) },
    { id: 'cloud', name: 'CLOUD BREAKER', how: 'clear YOUR OWN CLOUD', test: () => stageDone(4) },
    { id: 'days', name: 'COMMITTED', how: 'finish quests on 5 different days', test: () => new Set(Object.values(st.quests).filter((x) => x.done).map((x) => new Date(x.at).toDateString())).size >= 5 },
    { id: 'half', name: 'HALFWAY THERE', how: 'reach 50%', test: () => pct() >= 50 },
    { id: 'boss', name: 'BOSS FIGHT', how: 'finish a difficulty-5 quest', test: (d) => d.some((q) => q.d === 5) },
    { id: 'ghost', name: 'GHOST', how: 'reach 100%', test: () => pct() >= 100 },
  ];

  // ---------------- state ----------------
  let st = { quests: {}, tasks: [], badges: {}, rank: 0, sort: 'stage', hideDone: false, open: {}, cats: [], tcat: 'all', tcol: {} };
  const save = () => call('todoSave', st).catch(() => {});
  const done = () => Q.filter((q) => st.quests[q.id]?.done);
  const xp = () => done().reduce((a, q) => a + XP(q), 0);
  const pct = () => Math.round((xp() / TOTAL) * 100);
  const stageDone = (n) => Q.filter((q) => q.s === n).every((q) => st.quests[q.id]?.done);
  const rankAt = (p) => RANKS.reduce((r, x, k) => (p / 100 >= x.at ? k : r), 0);
  const value = (q) => q.i / q.d;
  const dots = (n, ch, cls) => `<span class="td-dots ${cls}">${[1, 2, 3, 4, 5].map((k) => `<i class="${k <= n ? 'on' : ''}">${ch}</i>`).join('')}</span>`;

  function nextMove() {
    const open = Q.filter((q) => !st.quests[q.id]?.done);
    if (!open.length) return null;
    const lowest = Math.min(...open.map((q) => q.s));
    return open.filter((q) => q.s <= lowest + 1).sort((a, b) => value(b) - value(a) || a.s - b.s)[0];
  }

  // ---------------- render ----------------
  function render() { renderTodo(); renderQuest(); }
  // The quest line is not part of the TO-DO page any more: SETTINGS mounts it into its own tile (window.hsQuestMount).
  let qroot = null;
  window.hsQuestMount = (el) => { qroot = el || null; renderQuest(); };
  function renderQuest() {
    if (!qroot) return;
    const root = qroot;
    const p = pct(), r = rankAt(p), nm = nextMove(), nextRank = RANKS[r + 1];
    const toNext = nextRank ? Math.max(0, Math.ceil(nextRank.at * TOTAL - xp())) : 0;
    const C = 2 * Math.PI * 52;
    root.innerHTML = `<div class="td-wrap td-qwrap">
      <div class="td-hero panel">
        <div class="td-ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" class="bg"/><circle cx="60" cy="60" r="52" class="fg" style="stroke-dasharray:${C};stroke-dashoffset:${C * (1 - p / 100)}"/>
          <g class="geo">${[0, 60, 120].map((a) => `<ellipse cx="60" cy="60" rx="34" ry="13" transform="rotate(${a} 60 60)"/>`).join('')}</g></svg>
          <div class="td-pct"><b>${p}%</b><span>DE-BIG-TECHED</span></div></div>
        <div class="td-who">
          <div class="td-kicker">GLITCH IN THE FEED · DE-BIG-TECH MY LIFE</div>
          <div class="td-rank glitch" data-text="${RANKS[r].name}">${RANKS[r].name}</div>
          <div class="td-line">${RANKS[r].line}</div>
          <div class="td-xp"><b>${xp()}</b> / ${TOTAL} XP · ${done().length} of ${Q.length} quests${nextRank ? ` · <span>${toNext} XP to ${nextRank.name}</span>` : ''}</div>
          <div class="td-lvl"><i style="width:${nextRank ? Math.min(100, ((xp() - RANKS[r].at * TOTAL) / ((nextRank.at - RANKS[r].at) * TOTAL)) * 100) : 100}%"></i></div>
          ${nm ? `<div class="td-next"><span>NEXT BEST MOVE</span> <b>${esc(nm.name)}</b> · ${esc(nm.t)} · <em>+${XP(nm)} XP</em> <button class="act" data-jump="${nm.id}">GO</button></div>` : '<div class="td-next"><b>Every quest done.</b></div>'}
        </div>
        <div class="td-badges">${BADGES.map((b) => `<div class="td-badge ${st.badges[b.id] ? 'got' : ''}" title="${esc(b.how)}${st.badges[b.id] ? ` · earned ${new Date(st.badges[b.id]).toLocaleDateString()}` : ''}"><i>⬢</i><span>${b.name}</span></div>`).join('')}</div>
      </div>
      <div class="td-tabs"><span class="grow"></span><div class="seg small" id="td-sort">${[['stage', 'BY STAGE'], ['value', 'BEST VALUE'], ['easy', 'EASIEST'], ['impact', 'BIGGEST IMPACT']].map(([k, l]) => `<button data-sort="${k}" class="${st.sort === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <label class="td-hide"><input type="checkbox" id="td-hide" ${st.hideDone ? 'checked' : ''}> hide done</label></div>
      <div class="td-body">${questsHtml()}</div></div>`;
    wireQuest(root);
  }
  function questCard(q) {
    const s = st.quests[q.id] || {}, steps = s.steps || {}, isOpen = st.open[q.id];
    const best = value(q) >= 2;
    return `<div class="td-q ${s.done ? 'done' : ''} ${isOpen ? 'open' : ''}" id="q-${q.id}">
      <div class="td-qhead">
        <label class="td-check"><input type="checkbox" data-q="${q.id}" ${s.done ? 'checked' : ''}><i></i></label>
        <div class="td-qname" data-toggle="${q.id}"><b>${esc(q.name)}</b>
          <div class="td-rate">DIFFICULTY ${dots(q.d, '●', 'diff')} IMPACT ${dots(q.i, '⚡', 'imp')}<span class="td-time">${esc(q.t)}</span>${best ? '<span class="td-best">BEST VALUE</span>' : ''}${spotted(q) && !s.done ? '<span class="td-spot">SPOTTED</span>' : ''}</div></div>
        <div class="td-xpc">+${XP(q)}<span>XP</span></div>
      </div>
      ${isOpen ? `<div class="td-qbody"><p>${esc(q.why)}</p>${spotted(q) ? `<p class="td-spotline">◈ ${esc(q.spot)}</p>` : ''}
        <ol>${q.steps.map((x, k) => `<li><label><input type="checkbox" data-step="${q.id}:${k}" ${steps[k] ? 'checked' : ''}> <span>${esc(x)}</span></label></li>`).join('')}</ol>
        ${q.help === 'notes' ? '<button class="act" data-open="notes">OPEN NOTES ›</button>' : ''}</div>` : ''}
    </div>`;
  }
  function questsHtml() {
    let list = Q.filter((q) => !(st.hideDone && st.quests[q.id]?.done));
    if (st.sort !== 'stage') {
      const f = { value: (a, b) => value(b) - value(a) || b.i - a.i, easy: (a, b) => a.d - b.d || b.i - a.i, impact: (a, b) => b.i - a.i || a.d - b.d }[st.sort];
      return `<div class="td-stage">${list.sort(f).map(questCard).join('') || '<p class="dim">All done here.</p>'}</div>`;
    }
    return STAGES.map((sg) => {
      const all = Q.filter((q) => q.s === sg.n), dn = all.filter((q) => st.quests[q.id]?.done).length, sp = Math.round((dn / all.length) * 100);
      const shown = list.filter((q) => q.s === sg.n);
      return `<div class="td-stage ${dn === all.length ? 'clear' : ''}">
        <div class="td-shead"><span class="td-sn">STAGE ${sg.n}</span><b>${sg.name}</b><span class="dim">${sg.sub}</span><span class="grow"></span>
          ${dn === all.length ? '<span class="td-clear">STAGE CLEAR</span>' : `<span class="dim">${dn}/${all.length}</span>`}<div class="td-sbar"><i style="width:${sp}%"></i></div></div>
        ${shown.map(questCard).join('') || '<p class="dim td-alldone">All done in this stage.</p>'}</div>`;
    }).join('');
  }
  function wireQuest(root) {
    root.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => { st.sort = b.dataset.sort; save(); renderQuest(); }));
    root.querySelector('#td-hide')?.addEventListener('change', (e) => { st.hideDone = e.target.checked; save(); renderQuest(); });
    root.querySelectorAll('[data-toggle]').forEach((el) => el.addEventListener('click', () => { st.open[el.dataset.toggle] = !st.open[el.dataset.toggle]; renderQuest(); }));
    root.querySelectorAll('[data-jump]').forEach((b) => b.addEventListener('click', () => {
      st.sort = 'stage'; st.hideDone = false; st.open[b.dataset.jump] = true; renderQuest();
      root.querySelector(`#q-${b.dataset.jump}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }));
    root.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => $(`.nav[data-view="${b.dataset.open}"]`)?.click()));
    root.querySelectorAll('[data-q]').forEach((cb) => cb.addEventListener('change', () => setQuest(cb.dataset.q, cb.checked)));
    root.querySelectorAll('[data-step]').forEach((cb) => cb.addEventListener('change', () => {
      const [id, k] = cb.dataset.step.split(':');
      const s = (st.quests[id] ||= {}); (s.steps ||= {})[k] = cb.checked;
      const q = Q.find((x) => x.id === id);
      if (cb.checked && !s.done && q.steps.every((_, j) => s.steps[j])) return setQuest(id, true); // every step ticked: quest done
      save();
    }));
  }

  // ---------------- the personal to-do list, in categories ----------------
  const COLORS = ['#00ff6e', '#c6ff00', '#19e6ff', '#ff4fd8', '#b388ff', '#ff8a65', '#ffd54f', '#7fd8a0'];
  const COLORNAME = { '#00ff6e': 'green', '#c6ff00': 'lime', '#19e6ff': 'cyan', '#ff4fd8': 'pink', '#b388ff': 'violet', '#ff8a65': 'orange', '#ffd54f': 'gold', '#7fd8a0': 'mint' };
  const catOf = (id) => st.cats.find((c) => c.id === id) || st.cats[0];
  const tcat = (t) => catOf(t.cat).id;
  const dayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  function ensureCats() {
    if (!Array.isArray(st.cats) || !st.cats.length) st.cats = [{ id: 'general', name: 'General', color: COLORS[0] }];
    if (!st.cats.some((c) => c.id === 'general')) st.cats.unshift({ id: 'general', name: 'General', color: COLORS[0] });
    if (st.tcat !== 'all' && !st.cats.some((c) => c.id === st.tcat)) st.tcat = 'all';
    st.tcol ||= {};
  }
  // little pop-up asking for a name (the browser prompt() does not exist in Electron)
  function askName(title, initial, cb, withColor) {
    const el = document.createElement('div');
    el.className = 'td-ask';
    let color = withColor ? COLORS[st.cats.length % COLORS.length] : null;
    el.innerHTML = `<div class="panel"><div class="td-kicker">${esc(title)}</div><input maxlength="30" value="${esc(initial || '')}" placeholder="name…">
      ${withColor ? `<div class="td-colors">${COLORS.map((c) => `<i data-c="${c}" style="background:${c}" class="${c === color ? 'on' : ''}"></i>`).join('')}</div>` : ''}
      <div class="td-askb"><button class="act" data-ok>OK</button><button class="act" data-no>CANCEL</button></div></div>`;
    document.body.appendChild(el);
    const inp = el.querySelector('input'); inp.focus(); inp.select();
    const close = () => el.remove();
    const ok = () => { const v = inp.value.trim(); if (!v) return inp.focus(); close(); cb(v, color); };
    el.querySelector('[data-ok]').addEventListener('click', ok);
    el.querySelector('[data-no]').addEventListener('click', close);
    el.addEventListener('mousedown', (e) => { if (e.target === el) close(); });
    el.querySelectorAll('[data-c]').forEach((i) => i.addEventListener('click', () => { color = i.dataset.c; el.querySelectorAll('[data-c]').forEach((x) => x.classList.toggle('on', x === i)); }));
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); else if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  }
  function addCat() {
    askName('NEW CATEGORY', '', (name, color) => {
      const c = { id: newId(), name, color }; st.cats.push(c); st.draftCat = c.id; save(); renderTodo();
    }, true);
  }
  function catMenu(e, c) {
    window.hsMenu?.(e, [
      { label: 'Rename…', run: () => askName('RENAME CATEGORY', c.name, (v) => { c.name = v; save(); renderTodo(); }) },
      '-',
      ...COLORS.map((x) => ({ label: `Colour: ${COLORNAME[x]}${x === c.color ? ' (now)' : ''}`, off: x === c.color, run: () => { c.color = x; save(); renderTodo(); } })),
      '-',
      { label: 'Mark all done', run: () => { st.tasks.forEach((t) => { if (tcat(t) === c.id && !t.done) { t.done = true; t.doneAt = Date.now(); } }); save(); renderTodo(); } },
      ...(c.id === 'general' ? [] : ['-', { label: 'Delete category (items move to General)', danger: true, run: () => { st.tasks.forEach((t) => { if (t.cat === c.id) t.cat = 'general'; }); st.cats = st.cats.filter((x) => x !== c); if (st.tcat === c.id) st.tcat = 'all'; save(); renderTodo(); } }]),
    ], c.name);
  }
  function taskRow(t) {
    const c = catOf(t.cat);
    return `<div class="td-t ${t.done ? 'done' : ''} ${t.star ? 'star' : ''}" draggable="true" data-row="${t.id}" style="--cc:${c.color}"><label class="td-check"><input type="checkbox" data-t="${t.id}" ${t.done ? 'checked' : ''}><i></i></label><span class="td-tx">${esc(t.text)}</span>${dueChip(t)}<button class="td-star" data-star="${t.id}" title="${t.star ? 'remove priority' : 'mark as priority'}">${t.star ? '★' : '☆'}</button><button data-del="${t.id}" title="remove">✕</button></div>`;
  }
  function sectionHtml(c) {
    const mine = st.tasks.filter((t) => tcat(t) === c.id);
    const open = mine.filter((t) => !t.done).sort(st.tsort === 'due' ? (a, b) => dueMs(a) - dueMs(b) || a.at - b.at : (a, b) => (b.star ? 1 : 0) - (a.star ? 1 : 0) || a.at - b.at);
    const fin = mine.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
    const total = mine.length, pc = total ? Math.round((fin.length / total) * 100) : 0;
    const col = !!st.tcol['c:' + c.id], dcol = st.tcol['d:' + c.id] !== false; // the done pile is folded by default
    return `<div class="td-sec ${col ? 'folded' : ''}" data-sec="${c.id}" style="--cc:${c.color}">
      <div class="td-sh" data-cat="${c.id}" title="click to fold · right-click for rename, colour, delete"><span class="td-arrow">${col ? '▸' : '▾'}</span><b>${esc(c.name)}</b><span class="td-cnt">${fin.length}/${total}</span><div class="td-sbar"><i style="width:${pc}%"></i></div></div>
      ${col ? '' : `<div class="td-sb">${open.map(taskRow).join('') || `<p class="dim td-none">${total ? 'All done here.' : 'Empty. Drag an item here or add one above.'}</p>`}
      ${fin.length ? `<div class="td-dh" data-dfold="${c.id}"><span>${dcol ? '▸' : '▾'}</span> DONE <em>${fin.length}</em></div>${dcol ? '' : fin.slice(0, 40).map(taskRow).join('')}` : ''}</div>`}
    </div>`;
  }
  function renderTodo() {
    ensureCats();
    const openAll = st.tasks.filter((t) => !t.done), overdueN = openAll.filter((t) => dueState(t) === 'over').length, doneToday = st.tasks.filter((t) => t.done && (t.doneAt || 0) >= dayStart()).length;
    const cnt = (id) => openAll.filter((t) => tcat(t) === id).length;
    const shown = st.tcat === 'all' ? st.cats.filter((c) => st.tasks.some((t) => tcat(t) === c.id)) : st.cats.filter((c) => c.id === st.tcat);
    const pick = st.draftCat && st.cats.some((c) => c.id === st.draftCat) ? st.draftCat : (st.tcat !== 'all' ? st.tcat : 'general');
    const empty = !st.tasks.length;
    root.innerHTML = `<div class="td-wrap">
      <div class="td-top"><div><div class="td-kicker">PERSONAL LIST</div><h2>TO-DO</h2></div><span class="grow"></span>
        <div class="td-stat"><b>${openAll.length}</b><span>OPEN</span></div><div class="td-stat ${overdueN ? 'bad' : ''}"><b>${overdueN}</b><span>OVERDUE</span></div><div class="td-stat"><b>${doneToday}</b><span>DONE TODAY</span></div></div>
      <div class="td-add panel"><input id="td-new" placeholder="add a to-do and press Enter…" maxlength="200">
        <input type="datetime-local" id="td-due" value="${dueDraft}" title="optional: due date and time">
        <select id="td-pick" title="category">${st.cats.map((c) => `<option value="${c.id}" ${c.id === pick ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}<option value="__new">+ NEW CATEGORY…</option></select>
        <button class="td-starb" id="td-prio" title="priority (shows first)">☆</button><button class="act" id="td-addb">ADD</button></div>
      <div class="td-quick"><span>DUE</span>${[['today', 'Today'], ['tomorrow', 'Tomorrow'], ['week', 'Next week']].map(([k, l]) => `<button class="td-chip" data-q="${k}" style="--cc:var(--g)">${l}</button>`).join('')}<button class="td-chip" id="td-qpick" style="--cc:var(--g)">Pick…</button><span class="grow"></span><button class="td-chip ${st.tsort === 'due' ? 'on' : ''}" id="td-sortdue" style="--cc:var(--g)" title="order each list by due date">SORT: ${st.tsort === 'due' ? 'DUE' : 'DEFAULT'}</button></div>
      <div class="td-chips"><button class="td-chip ${st.tcat === 'all' ? 'on' : ''}" data-chip="all" style="--cc:var(--g)">ALL <em>${openAll.length}</em></button>
        ${st.cats.map((c) => `<button class="td-chip ${st.tcat === c.id ? 'on' : ''}" data-chip="${c.id}" style="--cc:${c.color}"><i></i>${esc(c.name)} <em>${cnt(c.id)}</em></button>`).join('')}
        <button class="td-chip plus" id="td-newcat" title="new category">+</button><span class="grow"></span>
        ${st.tasks.some((t) => t.done) ? '<button class="act" id="td-clear">CLEAR DONE</button>' : ''}</div>
      ${empty ? `<div class="td-empty"><svg viewBox="0 0 120 120"><g fill="none" stroke="currentColor" stroke-width="1.2">${[0, 60, 120].map((a) => `<ellipse cx="60" cy="60" rx="40" ry="15" transform="rotate(${a} 60 60)"/>`).join('')}<circle cx="60" cy="60" r="50"/></g></svg><b>NOTHING TO DO. YET.</b><span>Type something above, pick a category, press Enter. Right-click anything for more.</span></div>`
        : shown.map(sectionHtml).join('') || '<div class="td-empty"><b>NOTHING IN THIS CATEGORY</b><span>Add something above, or drag an item onto its chip.</span></div>'}
    </div>`;
    wireTodo();
  }
  function wireTodo() {
    let prio = false;
    const inp = $('#td-new');
    const add = () => {
      const v = inp.value.trim(); if (!v) return;
      const cat = $('#td-pick').value === '__new' ? 'general' : $('#td-pick').value;
      const task = { id: newId(), text: v, done: false, at: Date.now(), cat, star: prio };
      if (dueDraft) { const ms = Date.parse(dueDraft); if (!isNaN(ms)) { task.due = new Date(ms).toISOString(); if (ms <= Date.now()) task.reminded = true; } }
      dueDraft = ''; st.tasks.push(task);
      st.draftCat = cat; save(); renderTodo(); $('#td-new')?.focus();
    };
    $('#td-addb').addEventListener('click', add);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    $('#td-prio').addEventListener('click', (e) => { prio = !prio; e.target.textContent = prio ? '★' : '☆'; e.target.classList.toggle('on', prio); });
    $('#td-pick').addEventListener('change', (e) => { if (e.target.value === '__new') { e.target.value = 'general'; addCat(); } else st.draftCat = e.target.value; });
    $('#td-newcat').addEventListener('click', addCat);
    $('#td-due').addEventListener('change', (e) => { dueDraft = e.target.value; });
    root.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => { dueDraft = toLocalInput(quickDue(b.dataset.q)); $('#td-due').value = dueDraft; $('#td-new').focus(); }));
    $('#td-qpick').addEventListener('click', () => { const d = $('#td-due'); d.focus(); try { d.showPicker(); } catch {} });
    $('#td-sortdue').addEventListener('click', () => { st.tsort = st.tsort === 'due' ? 'default' : 'due'; save(); renderTodo(); });
    root.querySelectorAll('[data-chip]').forEach((b) => {
      b.addEventListener('click', () => { st.tcat = b.dataset.chip; st.draftCat = null; save(); renderTodo(); });
      b.addEventListener('contextmenu', (e) => { const c = st.cats.find((x) => x.id === b.dataset.chip); if (c) catMenu(e, c); });
      b.addEventListener('dragover', (e) => { if (b.dataset.chip !== 'all') { e.preventDefault(); b.classList.add('over'); } });
      b.addEventListener('dragleave', () => b.classList.remove('over'));
      b.addEventListener('drop', (e) => { e.preventDefault(); b.classList.remove('over'); if (b.dataset.chip !== 'all') moveTask(drag, b.dataset.chip); });
    });
    root.querySelectorAll('[data-cat]').forEach((h) => {
      const c = st.cats.find((x) => x.id === h.dataset.cat);
      h.addEventListener('click', () => { st.tcol['c:' + c.id] = !st.tcol['c:' + c.id]; save(); renderTodo(); });
      h.addEventListener('contextmenu', (e) => catMenu(e, c));
    });
    root.querySelectorAll('[data-dfold]').forEach((h) => h.addEventListener('click', () => { const k = 'd:' + h.dataset.dfold; st.tcol[k] = st.tcol[k] === false; save(); renderTodo(); }));
    root.querySelectorAll('[data-sec]').forEach((s) => {
      s.addEventListener('dragover', (e) => { e.preventDefault(); s.classList.add('over'); });
      s.addEventListener('dragleave', (e) => { if (!s.contains(e.relatedTarget)) s.classList.remove('over'); });
      s.addEventListener('drop', (e) => { e.preventDefault(); s.classList.remove('over'); moveTask(drag, s.dataset.sec); });
    });
    root.querySelectorAll('[data-row]').forEach((r) => {
      r.addEventListener('dragstart', (e) => { drag = r.dataset.row; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', drag); } catch {} r.classList.add('drag'); });
      r.addEventListener('dragend', () => { r.classList.remove('drag'); drag = null; });
    });
    root.querySelectorAll('[data-t]').forEach((cb) => cb.addEventListener('change', () => { const t = st.tasks.find((x) => x.id === cb.dataset.t); t.done = cb.checked; t.doneAt = Date.now(); save(); renderTodo(); }));
    root.querySelectorAll('[data-star]').forEach((b) => b.addEventListener('click', () => { const t = st.tasks.find((x) => x.id === b.dataset.star); t.star = !t.star; save(); renderTodo(); }));
    root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { st.tasks = st.tasks.filter((x) => x.id !== b.dataset.del); save(); renderTodo(); twr({ do: 'react', name: 'deleted' }); }));
    root.querySelectorAll('[data-row]').forEach((r) => r.addEventListener('contextmenu', (e) => {
      const id = r.dataset.row, t = st.tasks.find((x) => x.id === id);
      if (!t) return;
      window.hsMenu?.(e, [
        { label: t.done ? 'Mark as not done' : 'Mark as done', run: () => { t.done = !t.done; t.doneAt = Date.now(); save(); renderTodo(); } },
        { label: t.star ? 'Remove priority star' : 'Priority star', run: () => { t.star = !t.star; save(); renderTodo(); } },
        '-',
        ...st.cats.map((c) => ({ label: `Move to ${c.name}`, off: c.id === tcat(t), run: () => moveTask(id, c.id) })),
        '-',
        { label: 'Set due date…', run: () => dueDialog(t) },
        ...(t.due ? [{ label: 'Clear due date', run: () => setDue(t, null) }] : []),
        { label: 'Copy text', run: () => navigator.clipboard.writeText(t.text).catch(() => {}) },
        { label: 'Delete', danger: true, run: () => { st.tasks = st.tasks.filter((x) => x.id !== id); save(); renderTodo(); } },
      ], t.text.slice(0, 40));
    }));
    $('#td-clear')?.addEventListener('click', (e) => {
      if (e.target.dataset.armed !== '1') { e.target.dataset.armed = '1'; e.target.textContent = 'SURE? CLEARS ALL DONE'; setTimeout(() => { e.target.dataset.armed = ''; e.target.textContent = 'CLEAR DONE'; }, 3000); return; }
      st.tasks = st.tasks.filter((t) => !t.done); save(); renderTodo();
    });
  }
  let drag = null;
  // ---------------- due dates + reminders ----------------
  let dueDraft = '';
  const dueMs = (t) => { const m = t.due ? Date.parse(t.due) : NaN; return isNaN(m) ? 1e15 : m; };
  const pad2 = (n) => String(n).padStart(2, '0');
  const toLocalInput = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
  const dueState = (t) => { const m = dueMs(t); if (m >= 1e15 || t.done) return ''; if (m < Date.now()) return 'over'; return new Date(m).toDateString() === new Date().toDateString() ? 'today' : ''; };
  const dueLabel = (ms) => { const d = new Date(ms); return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`; };
  function dueChip(t) { const m = dueMs(t); return m >= 1e15 ? '' : `<span class="td-due ${dueState(t)}" title="due ${esc(new Date(m).toLocaleString())}">⏰ ${esc(dueLabel(m))}</span>`; }
  function quickDue(k) {
    const d = new Date();
    if (k === 'today') { d.setHours(18, 0, 0, 0); if (d.getTime() <= Date.now()) d.setHours(23, 59, 0, 0); }
    else if (k === 'tomorrow') { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }
    else { d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); d.setHours(9, 0, 0, 0); }
    return d.getTime();
  }
  function setDue(t, iso) {
    delete t.reminded;
    if (iso) { t.due = iso; if (Date.parse(iso) <= Date.now()) t.reminded = true; } else delete t.due;
    save(); renderTodo();
  }
  function dueDialog(t) {
    const m = document.createElement('div'); m.className = 'td-duedlg';
    m.innerHTML = `<div class="panel"><b>DUE DATE · ${esc(t.text.slice(0, 40))}</b><input type="datetime-local" value="${dueMs(t) < 1e15 ? toLocalInput(dueMs(t)) : ''}"><div class="row"><button class="act" data-ok>SET</button><button class="act" data-no>CANCEL</button></div></div>`;
    document.body.appendChild(m);
    const inp = m.querySelector('input'); inp.focus();
    const ok = () => { const ms = Date.parse(inp.value); m.remove(); if (!isNaN(ms)) setDue(t, new Date(ms).toISOString()); };
    m.querySelector('[data-ok]').addEventListener('click', ok);
    m.querySelector('[data-no]').addEventListener('click', () => m.remove());
    m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') m.remove(); });
  }
  // fire a twr event (mascot); never throws
  const twr = (detail) => { try { document.dispatchEvent(new CustomEvent('twr', { detail })); } catch {} };
  // tow: remember where an element was, re-render, then ask the rabbit to tow the new node from there to its new spot
  const towFrom = (el) => { try { return el ? el.getBoundingClientRect() : null; } catch { return null; } };
  const towTo = (from, el) => { try { if (!from || !el) return; const to = el.getBoundingClientRect(); if (Math.hypot(to.left - from.left, to.top - from.top) < 8) return; twr({ do: 'tow', el, from, to }); } catch {} };
  function moveTask(id, cat) {
    const t = st.tasks.find((x) => x.id === id);
    if (!t || !cat || tcat(t) === cat) return;
    let from = null; try { from = towFrom(root.querySelector(`[data-row="${id}"]`)); } catch {}
    t.cat = cat; save(); renderTodo();
    try { towTo(from, root.querySelector(`[data-row="${id}"]`)); } catch {}
  }
  // tiny read-only API for other pages
  // for the rabbit / dock: what is overdue and what is due today (open items only)
  window.hsTodoDue = () => {
    const items = st.tasks.filter((t) => !t.done && dueMs(t) < 1e15).sort((a, b) => dueMs(a) - dueMs(b)).map((t) => ({ id: t.id, text: t.text, due: t.due, overdue: dueState(t) === 'over', today: dueState(t) === 'today' }));
    return { overdue: items.filter((x) => x.overdue).length, today: items.filter((x) => x.today).length, items };
  };
  // reminder: when an item's time comes, say so once (the item remembers it was reminded)
  function checkDue() {
    const now = Date.now(); let hit = false;
    for (const t of st.tasks) {
      if (t.done || !t.due || t.reminded) continue;
      const m = Date.parse(t.due);
      if (isNaN(m) || m > now) continue;
      t.reminded = true; hit = true;
      try { toast(`DUE NOW · ${String(t.text).slice(0, 60).toUpperCase()}`); } catch {}
      twr({ say: `${t.text} is due` });
    }
    if (hit) { save(); if (!root.contains(document.activeElement) || document.activeElement?.tagName !== 'INPUT') renderTodo(); }
  }
  setInterval(checkDue, 30000); setTimeout(checkDue, 5000);
  window.hsTodoOpen = () => st.tasks.filter((t) => !t.done).map((t) => ({ id: t.id, text: t.text, category: catOf(t.cat).name, star: !!t.star }));


  function setQuest(id, on) {
    const q = Q.find((x) => x.id === id), before = rankAt(pct());
    const s = (st.quests[id] ||= {});
    s.done = on; s.at = Date.now();
    if (on) toast(`QUEST COMPLETE · ${q.name.toUpperCase()} · +${XP(q)} XP`);
    // new badges
    const d = done();
    for (const b of BADGES) if (!st.badges[b.id] && b.test(d)) { st.badges[b.id] = Date.now(); setTimeout(() => celebrate('BADGE UNLOCKED', b.name), 900); }
    const after = rankAt(pct());
    if (after > before) setTimeout(() => celebrate('RANK UP', RANKS[after].name), 300);
    st.rank = after;
    save(); render();
  }
  function celebrate(kind, name) {
    const el = document.createElement('div');
    el.className = 'td-celebrate';
    el.innerHTML = `<div><span>${kind}</span><b class="glitch" data-text="${esc(name)}">${esc(name)}</b></div>`;
    document.body.appendChild(el);
    if (!document.body.classList.contains('lite')) for (let k = 0; k < 40; k++) { const g = document.createElement('i'); g.textContent = '⬢✦◈⟁'[k % 4]; g.style.left = `${Math.random() * 100}%`; g.style.animationDelay = `${Math.random() * 0.6}s`; el.appendChild(g); }
    el.addEventListener('click', () => el.remove());
    setTimeout(() => el.remove(), 3200);
  }

  // what's really on this computer (Brave, Proton VPN, Signal…): hints only show when it's found
  let found = {};
  const spotted = (q) => !!q.spot && (!q.need || !!found[q.need]);
  Promise.all([call('todoGet'), call('todoDetect').catch(() => ({}))]).then(([s, f]) => {
    found = f || {};
    if (s) st = { ...st, ...s };
    // quests HYPERSPACE already knows part of: pre-tick those steps (never the whole quest)
    for (const q of Q) if (q.pre && spotted(q) && !st.quests[q.id]) st.quests[q.id] = { steps: Object.fromEntries(q.pre.map((k) => [k, true])) };
    ensureCats(); render();
  }).catch(render);
})();
