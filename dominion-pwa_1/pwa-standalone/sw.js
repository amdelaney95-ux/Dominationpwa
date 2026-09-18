/**
 * Service worker — the game keeps working with the network switched off.
 *
 * Written as a source file with two placeholders that build.js fills in — a
 * hash of what was built, and the list of files to precache. Never edit the copy
 * in `pwa/`; it is generated, and build.js refuses to emit one that still has a
 * placeholder in it.
 *
 * ## Why this exists when the game is already one self-contained file
 *
 * Because "already cached" is not the same as "will still be there". The
 * ordinary HTTP cache is a hint: browsers evict it under storage pressure, a
 * hard reload bypasses it, and iOS is especially willing to clear it for a site
 * you have not opened in a while. A service worker cache is not evicted the same
 * way, and — more to the point — it is *consulted first*, so a page load with no
 * network is a cache hit rather than a spinner and an error.
 *
 * ## The strategy, and why it is this one
 *
 * Cache-first for everything, network only as a fallback. That is usually the
 * wrong default, because it ships stale content. It is right here: the whole
 * game is one static file with no server behind it and no content to go stale.
 * The only reason to reach the network at all is to pick up a new build, and
 * that is handled by the version in the cache name — a new build means a new
 * worker, which precaches afresh and deletes what came before.
 *
 * Google Fonts are cached at runtime rather than precached, because the exact
 * font files depend on the browser asking: the stylesheet at fonts.googleapis.com
 * hands back different woff2 URLs to different engines, so there is no fixed list
 * to precache. First online load fills them in; every load after that, online or
 * not, is served from the cache. Cross-origin responses without CORS come back
 * opaque — unreadable status, unknown size — and they are cached anyway, because
 * an opaque response replays perfectly well even though it cannot be inspected.
 */
const VERSION = '64d0c9ef4c32';
const SHELL_CACHE = `dominion-shell-${VERSION}`;
const FONT_CACHE = 'dominion-fonts';
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png"
];

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Individually rather than addAll: addAll is all-or-nothing, so one 404 on
    // an icon would leave the game with no offline copy at all.
    await Promise.all(SHELL.map(async (url) => {
      try {
        await cache.add(new Request(url, { cache: 'reload' }));
      } catch (err) {
        console.warn('[dominion] could not precache', url, err);
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((name) => {
      if (name === SHELL_CACHE || name === FONT_CACHE) return null;
      return caches.delete(name);        // an older build's shell
    }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Fonts: serve what we have, and quietly refresh it when there is a network.
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith((async () => {
      const cache = await caches.open(FONT_CACHE);
      const hit = await cache.match(request);
      const fetching = fetch(request).then((response) => {
        if (response) cache.put(request, response.clone()).catch(() => {});
        return response;
      }).catch(() => null);
      return hit || (await fetching) || Response.error();
    })());
    return;
  }

  if (url.origin !== self.location.origin) return;

  /**
   * A navigation is answered with the app shell whatever path was asked for.
   *
   * Opening the game deep-linked, or with a stale URL, or as a home-screen app
   * that remembers a path that no longer exists, must not produce the browser's
   * offline page. There is only one page.
   */
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      return (await cache.match('./index.html'))
        || (await cache.match(request))
        || (await fetch(request).catch(() => null))
        || new Response('Dominion is not cached yet — open it once with a network.', {
          status: 503, headers: { 'Content-Type': 'text/plain' },
        });
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response && response.ok) {
        const cache = await caches.open(SHELL_CACHE);
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    } catch (err) {
      return Response.error();
    }
  })());
});
