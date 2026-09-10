const CACHE_NAME = "multab-cache-v2";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./fractions/index.html",
  "./fractions/styles.css",
  "./fractions/engine.js",
  "./fractions/models.js",
  "./fractions/interactives.js",
  "./fractions/data/cells.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

// The app's own code is served network-first so a freshly deployed version
// shows up on the very next load — cache-first would keep serving the
// previous build and make every update look like it didn't happen. The
// cache is still written on every success, so offline play keeps working.
// Icons and other static assets stay cache-first; they rarely change.
// Covers the fractions hub's scripts too (engine/models/interactives/cells),
// or a freshly deployed fractions build would keep serving the cached one.
const APP_SHELL = /\/(index\.html|app\.js|styles\.css|manifest\.json|engine\.js|models\.js|interactives\.js|cells\.js)$|\/$/;

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const networkFirst = event.request.mode === "navigate" || APP_SHELL.test(url.pathname);

  if (networkFirst) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
