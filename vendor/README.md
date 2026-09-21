# Vendored libraries

Self-hosted (not loaded from a CDN) so the service worker can cache them as
part of the offline app shell — a `<script src="https://...">` pointed at a
CDN has no offline fallback once the network is gone, which defeats the
point of an offline-first app.

| Library | Version | License | Notes |
|---|---|---|---|
| [maplibre-gl](https://maplibre.org/) | 6.10.0 | BSD-3-Clause | ESM build (`maplibre-gl.mjs` + its `-shared` and `-worker` chunks). Pinned above 6.4.0 to avoid [a known XSS sanitizer-bypass vulnerability](https://github.com/advisories) in 4.x/≤6.4.0 — do not downgrade below 6.5.0 without checking `npm audit` again. |
| [pmtiles](https://github.com/protomaps/pmtiles) | 4.5.0 | BSD-3-Clause | Classic UMD build (`pmtiles.js`, global `pmtiles`). |
| [dexie](https://dexie.org/) | 4.4.6 | Apache-2.0 | Classic minified UMD build (`dexie.js`, global `Dexie`). |

## Updating

```bash
mkdir /tmp/vendor-update && cd /tmp/vendor-update
npm init -y && npm install maplibre-gl@latest pmtiles@latest dexie@latest
npm audit   # check for known vulnerabilities before copying anything in

cp node_modules/maplibre-gl/dist/maplibre-gl.mjs \
   node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs \
   node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs \
   node_modules/maplibre-gl/dist/maplibre-gl.css \
   <repo>/vendor/maplibre-gl/

cp node_modules/pmtiles/dist/pmtiles.js <repo>/vendor/pmtiles/
cp node_modules/dexie/dist/dexie.min.js <repo>/vendor/dexie/dexie.js
```

Then bump the version in this table and in `sw.js`'s `SHELL_CACHE` name so
clients pick up the update.
