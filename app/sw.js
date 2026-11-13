'use strict';

/*
 * Service worker: network-first with cache fallback.
 *
 * - While the local server is running you always get the latest files
 *   (no "stale until second reload" surprise while editing).
 * - When the server is NOT running, the installed app still starts, served
 *   entirely from the cache below.
 *
 * Bump VERSION when the asset list changes.
 */

const VERSION = 'v6-hover';
const CACHE = `countdown-${VERSION}`;
const ASSETS = [
  './',
  'index.html',
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

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok) {
        // Store navigations under './' so "?t=5m" style URLs share one entry.
        cache.put(req.mode === 'navigate' ? './' : req, res.clone());
      }
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true })
        || (req.mode === 'navigate' ? await cache.match('./') : undefined);
      if (hit) return hit;
      throw err;
    }
  })());
});
