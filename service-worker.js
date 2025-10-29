const CACHE_NAME = "rovescino-static-v1";
const PRECACHE = [
  "./",
  "./index.html",
  "./style.css",
  "./new_app.js",
  "./manifest.json",
  // Se hai le icone, aggiungile:
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

// Installa: precache e attiva subito
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener("activate", (event) => {
  // Elimina eventuali cache con nome diverso
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => clients.claim())
  );
});

// Fetch: cache-first, nessuna scrittura in cache a runtime
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      // Se non è in cache (es. prima visita ad asset non elencato), prova rete
      return fetch(event.request);
    })
  );
});

