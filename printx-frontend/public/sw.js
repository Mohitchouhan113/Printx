/**
 * PrintX Service Worker — low-bandwidth app-shell cache.
 *
 * Strategy matrix:
 *   navigations (HTML)  → network-first (fresh content when online, cached
 *                         shell when the network drops — no raw dino page)
 *   /_next/static/*     → cache-first (immutable hashed assets, 1yr TTL)
 *   other /_next/*      → network-first (dev chunks, route data; always fresh)
 *   static assets       → cache-first (fonts, icons, images, pdf worker)
 *   Supabase + /api/*   → NETWORK ONLY (never cached — live data, auth,
 *                         uploads must not serve stale or queued copies)
 *
 * The precache list is intentionally tiny (~5 entries): the shell HTML,
 * the pdf.js worker (multi-MB, needed by the color scanner) and icons.
 * Everything else fills the runtime caches on first use, so a 2G customer's
 * SECOND page view is instant even before any revisit.
 *
 * Registration is injectable via a ?DEBUG=0/1 query for local testing; the
 * skip-waiting + clients.claim pair makes new versions go live immediately.
 */

const VERSION = 'v1';
const SHELL_CACHE = `printx-shell-${VERSION}`;
const STATIC_CACHE = `printx-static-${VERSION}`;
const IMG_CACHE = `printx-img-${VERSION}`;
const CACHES = [SHELL_CACHE, STATIC_CACHE, IMG_CACHE];

/* Dev guard: caches must never swallow Next.js HMR payloads. Registration
 * (layout.jsx) only mounts in production, but a stale SW from a previous
 * prod deploy could still control a dev origin — these checks make that
 * harmless. */
const isHmrUrl = (url) =>
  url.pathname.includes('/_next/webpack-hmr') ||
  url.pathname.includes('/__next') ||
  url.searchParams.has('_rsc');

/** App shell: the minimal set worth paying for on 2G. */
const PRECACHE_URLS = [
  '/',
  '/pdf.worker.min.mjs',
  '/icon.svg',
  '/favicon.ico',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Individual adds — one 404 must not abort the whole install.
      await Promise.allSettled(
        PRECACHE_URLS.map(async (url) => {
          try {
            const res = await fetch(url, { cache: 'no-cache' });
            if (res && (res.ok || res.type === 'opaque')) await cache.put(url, res);
          } catch {
            /* offline install — runtime cache fills later */
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set(CACHES);
      const names = await caches.keys();
      await Promise.all(names.map((n) => (keep.has(n) ? null : caches.delete(n))));
      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.disable();
        } catch {
          /* unsupported — no-op */
        }
      }
      await self.clients.claim();
    })()
  );
});

/** Cache-first: instant on repeat views; network only on a miss. */
async function cacheFirst(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) return hit;
  try {
    const res = await fetch(request);
    if (res && (res.ok || res.type === 'opaque')) {
      await cache.put(request, res.clone());
      if (maxEntries) await trimCache(cacheName, maxEntries);
    }
    return res;
  } catch {
    return hit || Response.error();
  }
}

/** Network-first: freshness wins online; cache is the offline fallback. */
async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res && res.ok) await cache.put(request, res.clone());
    return res;
  } catch {
    const cached = await cache.match(request, { ignoreVary: true });
    if (cached) return cached;
    if (fallbackUrl) {
      const shell = await cache.match(fallbackUrl, { ignoreVary: true });
      if (shell) return shell;
      // Navigations also consult the OTHER caches — the shell may live in
      // IMG_CACHE after a same-version reinstall shuffled ownership.
      for (const c of CACHES) {
        const any = await caches.open(c);
        const m = await any.match(fallbackUrl, { ignoreVary: true });
        if (m) return m;
      }
    }
    return new Response(
      '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PrintX — offline</title><style>body{font-family:system-ui;background:#0B0F17;color:#e2e8f0;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}main{text-align:center;padding:2rem}h1{font-size:1.3rem;margin:0 0 .5rem}p{color:#94a3b8;font-size:.9rem;margin:0 0 1.2rem}button{background:#06B6D4;color:#04202a;border:0;border-radius:10px;padding:.65rem 1.3rem;font-weight:800;font-size:.9rem;cursor:pointer}</style></head><body><main><h1>You are offline</h1><p>PrintX could not reach the network. Check your connection and try again — your file stays on this device.</p><button onclick="location.reload()">Retry</button></main></body></html>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
    );
  }
}

/** LRU-ish cap so the image cache can't eat a phone's storage. */
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  for (const key of keys.slice(0, keys.length - maxEntries)) {
    await cache.delete(key);
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  // Only same-origin requests are ever cached; everything else passes raw.
  if (url.origin !== self.location.origin) return;
  if (isHmrUrl(url)) return;

  // Live data & mutations are NEVER cached.
  if (url.pathname.startsWith('/api/') || url.hostname.includes('supabase')) return;

  // Navigations: network-first with the cached shell as the offline floor.
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, SHELL_CACHE, '/'));
    return;
  }

  // Immutable hashed production assets — cache them forever.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }

  // Other _next traffic (chunks in dev, RSC data, flight requests) — the
  // network keeps it honest; the cache is only an offline fallback.
  if (url.pathname.startsWith('/_next/')) {
    event.respondWith(networkFirst(req, STATIC_CACHE));
    return;
  }

  // Static assets: fonts → static cache; images → capped image cache.
  const isFont = /\.(?:woff2?|ttf|otf)$/i.test(url.pathname);
  const isImage = /\.(?:png|jpe?g|webp|gif|svg|ico|avif)$/i.test(url.pathname) || url.pathname === '/icon.svg';
  if (isFont) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }
  if (isImage) {
    event.respondWith(cacheFirst(req, IMG_CACHE, 200));
  }
  // Anything else (worker scripts, misc) falls through to the network.
});

/* Push-notification click → focus an existing tab or open the app root. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of all) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow('/');
    })()
  );
});

/* Message hook so the registration component can trigger an instant
 * update check after deploy (SKIP_WAITING / PING for liveness probes). */
self.addEventListener('message', (event) => {
  const type = event?.data?.type;
  if (type === 'SKIP_WAITING') self.skipWaiting();
  if (type === 'PING' && event.source) event.source.postMessage({ type: 'PONG', VERSION });
});
