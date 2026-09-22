// Caches the app shell so Trailmark loads with zero connectivity.
const SHELL_CACHE = "trailmark-shell-v1.49";
// Live online-basemap tiles/style/sprite/glyphs, cached opportunistically
// as "Download This Area" (js/app.js) walks a bounding box and fetches
// each tile — see the fetch handler below for what qualifies.
const ONLINE_TILES_CACHE = "trailmark-online-tiles";

const SHELL_ASSETS = [
  "./",
  "index.html",
  "manifest.json",
  "version.json",
  "css/style.css",
  "js/db.js",
  "js/gps.js",
  "js/app.js",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-180.png",
  "icons/icon-32.png",
  "vendor/maplibre-gl/maplibre-gl.mjs",
  "vendor/maplibre-gl/maplibre-gl-shared.mjs",
  "vendor/maplibre-gl/maplibre-gl-worker.mjs",
  "vendor/maplibre-gl/maplibre-gl.css",
  "vendor/dexie/dexie.js",
  "vendor/supabase/supabase.js",
  "js/group/config.js",
  "js/group/backend.js",
  "js/cell-coverage.js",
];

self.addEventListener("install", (event) => {
  // No self.skipWaiting() here on purpose: a new worker should sit in
  // "waiting" until the page explicitly tells it to take over (see the
  // SKIP_WAITING message below, triggered by the "Update available" banner
  // in js/app.js). That's what makes the update visible and controllable
  // instead of silently swapping app code under an in-progress GPS
  // recording session.
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)));
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== ONLINE_TILES_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // App shell + everything same-origin: cache-first, falling back to
  // network, so the app still opens with no connectivity.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
    return;
  }

  // Online basemap (style.json, sprite, vector tiles, glyph fonts) from
  // whatever host it's actually served from — host-agnostic on purpose
  // so this doesn't need updating if that host ever changes. Matched by
  // path shape rather than a hardcoded domain: vector tiles and glyph
  // fonts are ".pbf", the style document lives under "/styles/", sprite
  // assets have "sprite" in the filename. Cache-first once downloaded
  // (via "Download This Area" walking a bounding box, or opportunistically
  // as you just browse online), network otherwise — GET requests only,
  // since a cross-origin POST/analytics call has no business being cached.
  if (
    event.request.method === "GET" &&
    (url.pathname.endsWith(".pbf") || url.pathname.includes("/styles/") || url.pathname.includes("sprite"))
  ) {
    event.respondWith(
      caches.open(ONLINE_TILES_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const response = await fetch(event.request);
        if (response.ok) cache.put(event.request, response.clone());
        return response;
      })
    );
  }
});
