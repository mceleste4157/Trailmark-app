// Caches the app shell so Trailmark loads with zero connectivity.
// Map tile (.pmtiles) requests use a separate cache managed by
// js/offline-regions.js, keyed by the region download flow.
const SHELL_CACHE = "trailmark-shell-v3";
const TILES_CACHE = "trailmark-tiles";

const SHELL_ASSETS = [
  "./",
  "index.html",
  "manifest.json",
  "css/style.css",
  "js/db.js",
  "js/gps.js",
  "js/offline-regions.js",
  "js/app.js",
  "icons/icon.svg",
  "data/regions/regions-manifest.json",
  "vendor/maplibre-gl/maplibre-gl.mjs",
  "vendor/maplibre-gl/maplibre-gl-shared.mjs",
  "vendor/maplibre-gl/maplibre-gl-worker.mjs",
  "vendor/maplibre-gl/maplibre-gl.css",
  "vendor/pmtiles/pmtiles.js",
  "vendor/dexie/dexie.js",
  "vendor/supabase/supabase.js",
  "js/group/config.js",
  "js/group/backend.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== TILES_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // .pmtiles region files: cache-first, and persist into the tiles cache
  // so they survive as "downloaded" even across app updates.
  if (url.pathname.includes("/data/regions/") && url.pathname.endsWith(".pmtiles")) {
    event.respondWith(
      caches.open(TILES_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const response = await fetch(event.request);
        if (response.ok) cache.put(event.request, response.clone());
        return response;
      })
    );
    return;
  }

  // App shell + everything same-origin: cache-first, falling back to
  // network, so the app still opens with no connectivity.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
  }
});
