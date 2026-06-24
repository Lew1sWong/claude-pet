/* Claude Pet PWA service worker — cache the app shell so it opens offline.
   Bump CACHE when you change any shell file. */
const CACHE = "claude-pet-v1";
const SHELL = [
  ".",
  "index.html",
  "style.css",
  "app.js",
  "sprites.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-180.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // never cache API / usage calls — always go to the network
  if (url.origin !== self.location.origin) return;
  // cache-first for the static shell, fall back to network
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).catch(() => caches.match("index.html")))
  );
});
