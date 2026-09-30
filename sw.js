const SCOPE = new URL(self.registration.scope);
const VERSION = '0.8.2';
const CACHE = `cri-shell-${VERSION}-${SCOPE.pathname}`;
const ASSETS = ['index.html', 'styles.css', 'manifest.webmanifest', 'launch.js', 'app.js', 'i18n.js', 'store.js', 'training.js', 'rewards.js', 'reward-ui.js', 'cloud.js', 'cloud-config.js', 'sync.js', 'lucide.min.js', 'supabase.min.js', 'manrope.ttf', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'launch-1206x2622.png', 'launch-2622x1206.png', 'launch-1320x2868.png', 'launch-2868x1320.png'];
const VERSIONED = ASSETS.filter(path => path === 'manifest.webmanifest' || path.endsWith('.png')).map(path => `${path}?v=${VERSION}`);
const ALLOWED = new Set([...ASSETS, ...VERSIONED].map(path => new URL(path, SCOPE).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll([...ALLOWED].map(url => new Request(url, {cache:'reload'})))));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE && key.startsWith('cri-shell-') && key.endsWith(`-${SCOPE.pathname}`)) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;
  const target = request.mode === 'navigate' ? new URL('index.html', SCOPE).href : url.href;
  if (!ALLOWED.has(target)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (url.pathname === new URL('manifest.webmanifest', SCOPE).pathname) {
      try {
        const response = await fetch(request, {cache:'no-cache'});
        if (response.ok) { await cache.put(target, response.clone()); return response; }
      } catch {}
    }
    return await cache.match(target) || fetch(request);
  })());
});