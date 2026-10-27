// App-shell cache. Network first for pages so new deploys show up; API requests are never cached.
const CACHE = 'pr-shell-v3';   // plan 50: drop audio stored by the v2 worker (plan 39: drop pages stored by older builds)
const ART = 'pr-art-v1';   // plan 18: art file names carry a content hash, so cache-first is safe
const BAD_ART = '/art/card-batter-1901-light-a-90775c068d.webp';   // plan 52: broken-bat card, never served or kept
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== ART).map((k) => caches.delete(k))))
    .then(() => caches.open(ART)).then((c) => c.delete(BAD_ART, { ignoreSearch: true, ignoreVary: true }))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Plan 50: announcer audio and its manifest go straight to the network (immutable / no-cache headers do the caching).
  if (url.pathname.startsWith('/audio/') || url.pathname === '/voice-manifest.json' || e.request.headers.has('range')) return;
  if (url.pathname === BAD_ART) { e.respondWith(new Response('', { status: 404 })); return; }
  if (url.pathname.startsWith('/art/')) {
    e.respondWith(caches.open(ART).then((c) => c.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }))));
    return;
  }
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then((hit) => hit || caches.match('/')))
  );
});
