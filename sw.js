/* Dropper UA service worker — офлайн-кеш оболонки застосунку (як у MoneyMe).
   Дані застосунку живуть у localStorage (не тут); SW кешує лише статику,
   щоб усе відкривалося без мережі. Cross-origin запити (Monobank, CORS-проксі) не чіпаємо. */
const BUILD = '__BUILD__';   // підставляється деплой-workflow (git SHA) — новий кеш на кожен деплой
const CACHE = 'dropper-shell-' + BUILD;
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './Інструкція-користувача.html',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.allSettled(ASSETS.map((u) => c.add(u)));   // не валимо інсталяцію, якщо якогось файлу нема
    await self.skipWaiting();   // нова версія активується одразу — швидке розкочування фіксів
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // Monobank / CORS-проксі — напряму в мережу

  // Документ (single-file HTML): NETWORK-FIRST з таймаутом — онлайн віддає свіжий код,
  // офлайн/повільна мережа — одразу з кешу (без зависання).
  const isDoc = req.mode === 'navigate' || req.destination === 'document' ||
    url.pathname === '/' || url.pathname.endsWith('/') || url.pathname.endsWith('.html');
  if (isDoc) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = (await cache.match(req, { ignoreSearch: true })) || (await cache.match('./index.html'));
      const ctrl = new AbortController();
      let to; const timer = new Promise((_, rej) => { to = setTimeout(() => { ctrl.abort(); rej(new Error('sw-timeout')); }, cached ? 3000 : 12000); });
      const net = fetch(req, { signal: ctrl.signal }); net.catch(() => {});
      try {
        const res = await Promise.race([net, timer]); clearTimeout(to);
        if (res && res.status === 200) cache.put(req, res.clone());
        return res;
      } catch (e2) { clearTimeout(to); return cached || Response.error(); }
    })());
    return;
  }
  // Інша статика (іконки/маніфест/скріни) — stale-while-revalidate: миттєво з кешу, у фоні оновлюємо.
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    const network = fetch(req).then((res) => {
      if (res && res.status === 200 && res.type === 'basic') cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    return cached || (await network) || Response.error();
  })());
});
