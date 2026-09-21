# Trailmark

An offline-first trail marking app for the southeast — a free, self-hostable
alternative to onX built on open web technology.

## Stack

- **[MapLibre GL JS](https://maplibre.org/)** — free, open-source vector map
  rendering (no API key).
- **[PMTiles](https://protomaps.com/)** — single-file map tile archives you
  download once per region and read directly in the browser via HTTP range
  requests. No tile server, no internet required after download. This is
  what makes offline regions possible, the same way onX's offline maps work.
- **[Dexie.js](https://dexie.org/)** (IndexedDB wrapper) — stores trails,
  waypoints, and GPS tracks locally in the browser. Works fully offline.
- **Service Worker** — caches the app shell (HTML/CSS/JS) so the app itself
  loads with zero connectivity.
- **[Supabase](https://supabase.com/)** (optional, not wired up yet) — free
  tier Postgres + PostGIS backend for syncing trails across devices when
  online. The app works fully standalone without it.

No build step. No framework. Plain HTML/CSS/JS, same as a static site.

## Project structure

```
trailmark-app/
├── index.html          # App shell — map container + UI
├── css/
│   └── style.css
├── js/
│   ├── app.js           # Map init, UI wiring
│   ├── db.js             # Dexie schema — trails, waypoints, tracks
│   ├── gps.js             # Geolocation tracking (record a trail live)
│   └── offline-regions.js # PMTiles region download/management
├── sw.js                # Service worker — offline app shell caching
├── manifest.json        # PWA manifest (installable, offline icon etc.)
└── data/
    └── regions/          # Downloaded .pmtiles files live here (gitignored)
```

## Getting started

1. Serve the folder with any static file server (needed because service
   workers and fetch() require http/https, not file://):

   ```bash
   npx serve .
   # or: python3 -m http.server 8080
   ```

2. Open the app, allow location access.

3. Download an offline region (see below) before you lose signal.

## Getting offline map data for the southeast

PMTiles files are generated from OpenStreetMap data. Two free ways to get one
for your area:

**Option A — Protomaps' hosted builder (easiest)**
Use https://app.protomaps.com/downloads to extract a `.pmtiles` file for a
bounding box (e.g., a national forest, a county, or a whole state). Free,
no signup required for small extracts. Drop the file into `data/regions/`.

**Option B — Build your own extract (full control, still free)**
```bash
# Download a regional OSM extract (e.g. from Geofabrik)
curl -O https://download.geofabrik.de/north-america/us/georgia-latest.osm.pbf

# Convert to PMTiles with the free `pmtiles` + `tippecanoe` CLI tools
tippecanoe -o georgia.pmtiles georgia-latest.osm.pbf
```

Either way, the app reads the `.pmtiles` file directly from
`data/regions/` — no server-side tile hosting needed, which is what keeps
this free at any scale.

## Roadmap

- [x] Scaffold: map shell, offline tile support, local trail storage, PWA shell
- [ ] Draw/record trails (GPS track recording via `watchPosition`)
- [ ] Waypoint markers with notes/photos
- [ ] Offline region download UI (pick a bounding box, fetch PMTiles)
- [ ] Elevation profile for recorded trails
- [ ] Supabase sync for multi-device / sharing
- [ ] Export trail as GPX

## License

MIT
