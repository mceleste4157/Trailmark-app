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

**Option A — the bundled GitHub Action (recommended)**
`.github/workflows/build-region.yml` downloads a Geofabrik state extract,
clips it to a bounding box with `osmium-tool`, and builds a `.pmtiles`
archive with [Planetiler](https://github.com/onthegomap/planetiler) — then
reads the archive's own header for bounds/zoom and commits both the file
and a `regions-manifest.json` entry back to the repo. Run it from the
repo's **Actions** tab (`Build offline map region` → **Run workflow**),
filling in:
- `region_name` / `region_label` — id and display name for the region
- `geofabrik_path` — e.g. `north-america/us/georgia`, `north-america/us/florida`
- `bbox` — `minLon,minLat,maxLon,maxLat` for the area to clip to

Planetiler's default profile outputs the **OpenMapTiles** schema
(`landcover` / `landuse` / `water` / `building` / `transportation` /
`mountain_peak` / …, with a `class` property on transportation features —
`path`/`track` is what `activateRegion()` in `js/app.js` styles as trails).
That's what the CI job produces and what the app is styled for.

**Option B — Protomaps' hosted builder**
https://app.protomaps.com/downloads extracts a `.pmtiles` for a bounding
box using a *different* schema (Protomaps basemap: `earth`/`landuse`/
`water`/`buildings`/`roads` with a `kind` property) — `activateRegion()`
would need restyling to match if you use this instead.

Either way, drop the `.pmtiles` file into `data/regions/` and add an entry
to `regions-manifest.json` (the CI workflow does this for you) — the app
reads it directly, no server-side tile hosting needed, which is what keeps
this free at any scale.

## Included test fixture

`data/regions/firenze-test.pmtiles` (Florence, Italy; © OpenStreetMap
contributors, ODbL) is bundled from the
[protomaps/PMTiles](https://github.com/protomaps/PMTiles) test fixtures to
verify the offline-map *mechanics* — PMTiles source, the download/cache
flow in **Offline Maps**, surviving a reload with no network — independent
of any one region. It's in the Protomaps basemap schema (see Option B
above), not the OpenMapTiles schema real regions use, so it downloads and
caches correctly but won't show roads/water/etc. — only real regions built
via the GitHub Action render fully styled.

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
