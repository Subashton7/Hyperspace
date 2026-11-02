// HYPERSPACE phone app, offline: keeps the app itself (pages, scripts, fonts, icons) so it opens from the home
// screen with the laptop off. Music and covers live in the 'hs-music' cache, filled by SYNC in phone.js;
// covers are served from there, tracks are read by the page itself. The laptop's API is never cached.
const APP = 'hs-app-v1';
const SHELL = ['phone.html', 'phone.css', 'phone.js', 'phone-vj.js', 'remote.js', 'vj-themes.js', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  '../node_modules/@fontsource/share-tech-mono/index.css', '../node_modules/@fontsource/orbitron/500.css', '../node_modules/@fontsource/orbitron/800.css', '../assets/subashton-text.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('hs-app-') && k !== APP).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// the laptop may simply be off: don't wait long for it
const timed = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/setup/') || url.pathname.startsWith('/media/track/') || url.pathname.startsWith('/media/zip/')) return;
  // covers: what SYNC saved, else the laptop
  if (url.pathname.startsWith('/media/art/')) {
    e.respondWith(caches.open('hs-music').then(async (c) => (await c.match(url.pathname)) || fetch(e.request).catch(() => new Response('', { status: 404 }))));
    return;
  }
  // the app: fresh from the laptop when it answers quickly, otherwise the saved copy
  e.respondWith((async () => {
    const c = await caches.open(APP);
    try {
      const r = await timed(fetch(e.request), 2500);
      if (r.ok) c.put(e.request, r.clone()).catch(() => {});
      return r;
    } catch {
      return (await c.match(e.request, { ignoreSearch: true })) || (e.request.mode === 'navigate' ? (await c.match('phone.html')) : null) || new Response('offline', { status: 503 });
    }
  })());
});
