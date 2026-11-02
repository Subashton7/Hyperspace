// TO-DO: a plain to-do list, plus the quest line "DE-BIG-TECH MY LIFE": stages from quick wins to running
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
  let st = { quests: {}, tasks: [], badges: {}, rank: 0, tab: 'quests', sort: 'stage', hideDone: false, open: {} };
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
  function render() {
    const p = pct(), r = rankAt(p), nm = nextMove(), nextRank = RANKS[r + 1];
    const toNext = nextRank ? Math.max(0, Math.ceil(nextRank.at * TOTAL - xp())) : 0;
    const C = 2 * Math.PI * 52;
    root.innerHTML = `<div class="td-wrap">
      <div class="td-hero panel">
        <div class="td-ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" class="bg"/><circle cx="60" cy="60" r="52" class="fg" style="stroke-dasharray:${C};stroke-dashoffset:${C * (1 - p / 100)}"/>
          <g class="geo">${[0, 60, 120].map((a) => `<ellipse cx="60" cy="60" rx="34" ry="13" transform="rotate(${a} 60 60)"/>`).join('')}</g></svg>
          <div class="td-pct"><b>${p}%</b><span>DE-BIG-TECHED</span></div></div>
        <div class="td-who">
          <div class="td-kicker">QUEST LINE · DE-BIG-TECH MY LIFE</div>
          <div class="td-rank glitch" data-text="${RANKS[r].name}">${RANKS[r].name}</div>
          <div class="td-line">${RANKS[r].line}</div>
          <div class="td-xp"><b>${xp()}</b> / ${TOTAL} XP · ${done().length} of ${Q.length} quests${nextRank ? ` · <span>${toNext} XP to ${nextRank.name}</span>` : ''}</div>
          <div class="td-lvl"><i style="width:${nextRank ? Math.min(100, ((xp() - RANKS[r].at * TOTAL) / ((nextRank.at - RANKS[r].at) * TOTAL)) * 100) : 100}%"></i></div>
          ${nm ? `<div class="td-next"><span>NEXT BEST MOVE</span> <b>${esc(nm.name)}</b> · ${esc(nm.t)} · <em>+${XP(nm)} XP</em> <button class="act" data-jump="${nm.id}">GO</button></div>` : '<div class="td-next"><b>Every quest done.</b></div>'}
        </div>
        <div class="td-badges">${BADGES.map((b) => `<div class="td-badge ${st.badges[b.id] ? 'got' : ''}" title="${esc(b.how)}${st.badges[b.id] ? ` · earned ${new Date(st.badges[b.id]).toLocaleDateString()}` : ''}"><i>⬢</i><span>${b.name}</span></div>`).join('')}</div>
      </div>
      <div class="td-tabs"><button data-tab="quests" class="${st.tab === 'quests' ? 'on' : ''}">⬢ QUESTS</button><button data-tab="tasks" class="${st.tab === 'tasks' ? 'on' : ''}">☐ MY TO-DO <em>${st.tasks.filter((t) => !t.done).length}</em></button>
        ${st.tab === 'quests' ? `<span class="grow"></span><div class="seg small" id="td-sort">${[['stage', 'BY STAGE'], ['value', 'BEST VALUE'], ['easy', 'EASIEST'], ['impact', 'BIGGEST IMPACT']].map(([k, l]) => `<button data-sort="${k}" class="${st.sort === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <label class="td-hide"><input type="checkbox" id="td-hide" ${st.hideDone ? 'checked' : ''}> hide done</label>` : ''}</div>
      <div class="td-body">${st.tab === 'quests' ? questsHtml() : tasksHtml()}</div></div>`;
    wire();
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
  function tasksHtml() {
    const open = st.tasks.filter((t) => !t.done), fin = st.tasks.filter((t) => t.done);
    const row = (t) => `<div class="td-t ${t.done ? 'done' : ''}"><label class="td-check"><input type="checkbox" data-t="${t.id}" ${t.done ? 'checked' : ''}><i></i></label><span>${esc(t.text)}</span><button data-del="${t.id}" title="remove">✕</button></div>`;
    return `<div class="td-stage"><div class="td-add"><input id="td-new" placeholder="add a to-do and press Enter…" maxlength="200"><button class="act" id="td-addb">ADD</button></div>
      ${open.map(row).join('') || '<p class="dim">Nothing to do. Nice.</p>'}
      ${fin.length ? `<div class="td-shead"><b>DONE</b><span class="dim">${fin.length}</span><span class="grow"></span><button class="act" id="td-clear">CLEAR DONE</button></div>${fin.slice(-30).reverse().map(row).join('')}` : ''}</div>`;
  }

  function wire() {
    root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { st.tab = b.dataset.tab; save(); render(); }));
    root.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => { st.sort = b.dataset.sort; save(); render(); }));
    $('#td-hide')?.addEventListener('change', (e) => { st.hideDone = e.target.checked; save(); render(); });
    root.querySelectorAll('[data-toggle]').forEach((el) => el.addEventListener('click', () => { st.open[el.dataset.toggle] = !st.open[el.dataset.toggle]; render(); }));
    root.querySelectorAll('[data-jump]').forEach((b) => b.addEventListener('click', () => {
      st.tab = 'quests'; st.sort = 'stage'; st.hideDone = false; st.open[b.dataset.jump] = true; render();
      $(`#q-${b.dataset.jump}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
    const add = () => { const v = $('#td-new').value.trim(); if (!v) return; st.tasks.push({ id: Date.now().toString(36), text: v, done: false, at: Date.now() }); save(); render(); $('#td-new')?.focus(); };
    $('#td-addb')?.addEventListener('click', add);
    $('#td-new')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    root.querySelectorAll('[data-t]').forEach((cb) => cb.addEventListener('change', () => { const t = st.tasks.find((x) => x.id === cb.dataset.t); t.done = cb.checked; t.doneAt = Date.now(); save(); render(); }));
    root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { st.tasks = st.tasks.filter((x) => x.id !== b.dataset.del); save(); render(); }));
    $('#td-clear')?.addEventListener('click', (e) => {
      if (e.target.dataset.armed !== '1') { e.target.dataset.armed = '1'; e.target.textContent = 'SURE? CLEARS ALL DONE'; setTimeout(() => { e.target.dataset.armed = ''; e.target.textContent = 'CLEAR DONE'; }, 3000); return; }
      st.tasks = st.tasks.filter((t) => !t.done); save(); render();
    });
  }

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
    render();
  }).catch(render);
})();
