// The build fills in both placeholders and writes the result to dist/sw.js (see vite.config.ts).
//
// Only the files listed here are ever stored, and only while installing. Nothing is cached at
// run time, so a song can't end up in here, and any other request (the demo track check, a
// missing file) is left alone and gets the server's real answer.
const CACHE = 'resonance-__VERSION__';
const FILES = new Set(__FILES__);
const PAGE = '/';
const PAGE_TIMEOUT_MS = 3000;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([...FILES])));
});

// No skipWaiting: a tab left open keeps its own version's lazy chunks until it closes.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('resonance-') && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      ),
  );
});

/** The server's page when it answers, so a deploy shows on the next load; ours when it doesn't. */
async function openPage(request) {
  const network = fetch(request);
  const timeout = new Promise((resolve) => setTimeout(resolve, PAGE_TIMEOUT_MS));
  const response = await Promise.race([network, timeout]).catch(() => undefined);
  if (response) return response;
  return (await caches.match(PAGE, { cacheName: CACHE })) ?? network;
}

async function openFile(request) {
  return (await caches.match(request, { cacheName: CACHE })) ?? fetch(request);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Shared links carry their settings in the query, and they still open the one page.
  if (request.mode === 'navigate') {
    if (url.pathname === PAGE) event.respondWith(openPage(request));
  } else if (url.pathname !== PAGE && FILES.has(url.pathname)) {
    event.respondWith(openFile(request));
  }
});
