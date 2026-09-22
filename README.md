# Trailmark

An offline-first trail marking app for the southeast — a free, self-hostable
alternative to onX built on open web technology.

## Stack

- **[MapLibre GL JS](https://maplibre.org/)** — free, open-source vector map
  rendering (no API key).
- **[Dexie.js](https://dexie.org/)** (IndexedDB wrapper) — stores trails,
  waypoints, and GPS tracks locally in the browser. Works fully offline.
- **Service Worker** — caches the app shell (HTML/CSS/JS) so the app itself
  loads with zero connectivity.
- **[Supabase](https://supabase.com/)** (optional — the app works fully
  standalone without it) — free-tier Postgres backend for two things once
  you sign in: crew features (shared trails/waypoints/photos, live
  location, chat — see the "Share" button and Chat tab) and a private
  backup of your own My Content (`personal_trails`/`personal_waypoints`,
  visible only to you) so it survives a lost phone or carries over to a
  new device. See `js/group/config.js` to activate it and `sql/schema.sql`
  for the tables/policies.

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
│   └── gps.js             # Geolocation tracking (record a trail live)
├── sw.js                # Service worker — offline app shell caching
└── manifest.json        # PWA manifest (installable, offline icon etc.)
```

## Getting started

1. Serve the folder with any static file server (needed because service
   workers and fetch() require http/https, not file://):

   ```bash
   npx serve .
   # or: python3 -m http.server 8080
   ```

2. Open the app, allow location access.

3. Before you lose signal: open **Offline Maps**, pan/zoom to the area
   you want, and tap **Download This Area** — see below.

## Getting offline map data

No pre-built regions or separate pipeline needed — **Offline Maps** in the
app itself lets you pan/zoom to any area (an ORV park, a trailhead,
anywhere) and download exactly that view while you're online. It fetches
the online basemap's own vector tiles for that bounding box and caches
them in the browser's Cache Storage (`sw.js`'s `ONLINE_TILES_CACHE`), so
they render offline afterward exactly like they did online — no fixed
list, no CI build step, no `.pmtiles` archive to manage.

## Roadmap

- [x] Scaffold: map shell, offline tile support, local trail storage, PWA shell
- [x] Draw/record trails (GPS track recording via `watchPosition`)
- [x] Waypoint markers with notes/photos
- [x] Offline region download UI (pan/zoom to any area, download that view)
- [x] Elevation profile for recorded trails
- [x] Supabase sync for multi-device / sharing
- [x] Export trail as GPX

## License

MIT
