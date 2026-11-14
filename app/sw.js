'use strict';

/*
 * Service worker: network-first with cache fallback.
 *
 * - While the local server is running you always get the latest files
 *   (no "stale until second reload" surprise while editing).
 * - When the server is NOT running, the installed app still starts, served
 *   entirely from the cache below.
 *
 * Bump VERSION when the asset list changes, or to make every browser store
 * all the files afresh (v12 did that, for the page fix described below).
 */

const VERSION = 'v12';
const CACHE = `countdown-${VERSION}`;
// The page itself is precached by name, not as './', so that installing the
// service worker doesn't depend on the web server mapping '/' to countdown.html.
const PAGE = 'countdown.html';
const ASSETS = [
  PAGE,
  'styles.css',
  'app.js',
  'manifest.json',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('countdown-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Is this request the app's page being opened? The page has two addresses:
// the folder ("/", which the web server maps to countdown.html) and
// countdown.html itself, each with or without "?t=5m" style parameters.
// Opening any other file directly (e.g. manifest.json in a tab) is also a
// "navigate" request, but it isn't the page and must not be stored as it.
const FOLDER = new URL('./', self.location).pathname;
function isPage(req) {
  if (req.mode !== 'navigate') return false;
  const p = new URL(req.url).pathname;
  return p === FOLDER || p === FOLDER + PAGE;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // The page is always stored and looked up under the one name PAGE, whichever
    // address it was opened by. Why it matters: every online load stores the
    // newest app.js and styles.css, so it must replace the stored page as well.
    // Before v12 the page fetched online went under './' while an offline start
    // of countdown.html (the manifest's start_url and shortcuts) was served the
    // copy precached at install time, never refreshed. After an update that
    // gave an old page with a new app.js, which don't fit together.
    const key = isPage(req) ? PAGE : req;
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(key, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(key, { ignoreSearch: true });
      if (hit) return hit;
      throw err;
    }
  })());
});
