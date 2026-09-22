import * as maplibregl from "../vendor/maplibre-gl/maplibre-gl.mjs";

// ---------- Light/dark theme ----------
// Applied first, before anything else, so a returning visitor who chose
// light mode doesn't see a flash of the dark theme while the rest of the
// page sets up.
const THEME_KEY = "trailmark_theme";
const btnTheme = document.getElementById("btn-theme");
function applyTheme(theme) {
  if (theme === "light") {
    document.documentElement.dataset.theme = "light";
    btnTheme.textContent = "🌙";
    btnTheme.title = "Switch to dark mode";
  } else {
    delete document.documentElement.dataset.theme;
    btnTheme.textContent = "☀️";
    btnTheme.title = "Switch to light mode";
  }
}
let currentTheme = "dark";
try {
  currentTheme = localStorage.getItem(THEME_KEY) || "dark";
} catch {
  // Private browsing / storage blocked — just stays on the default.
}
applyTheme(currentTheme);
btnTheme.addEventListener("click", () => {
  currentTheme = currentTheme === "light" ? "dark" : "light";
  try {
    localStorage.setItem(THEME_KEY, currentTheme);
  } catch {
    // Preference won't persist across reloads, but the toggle still works.
  }
  applyTheme(currentTheme);
});

// ---------- Topbar height tracking ----------
// #topbar-right's buttons wrap onto a second line once there isn't room
// for them all in one row (narrow phones, or just enough toggles enabled
// at once) — everything below it (the location/update/error/maintenance
// banners, the speed/heading/elevation/tilt stats HUD, the recording and
// route-planning HUDs) used to sit at a fixed pixel offset that assumed
// a single-row topbar, so a wrapped second row visibly overlapped them
// instead of pushing them down. Keeping the topbar's real height in a
// CSS variable and having all of those position off of it (see
// style.css) fixes it for every one of them at once, and keeps working
// if the topbar's height changes again for some other reason later.
const topbarEl = document.getElementById("topbar");
function updateTopbarHeightVar() {
  document.documentElement.style.setProperty("--topbar-height", `${topbarEl.offsetHeight}px`);
}
updateTopbarHeightVar();
window.addEventListener("resize", updateTopbarHeightVar);
window.addEventListener("orientationchange", updateTopbarHeightVar);
// The ResizeObserver catches content-driven height changes the above two
// don't (e.g. the basemap label's own text width reflowing the wrap
// point without the *window* itself resizing).
new ResizeObserver(updateTopbarHeightVar).observe(topbarEl);

// OpenFreeMap (https://openfreemap.org) — a free, no-API-key, no-usage-limit
// hosted basemap, used only while online. It's what makes the map show a
// normal world/US view by default instead of a blank screen; offline use
// still depends entirely on downloaded regions (see js/offline-regions.js),
// since this isn't cached for offline access.
const ONLINE_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

// Esri World Imagery — free satellite basemap, no API key or billing
// account required (unlike Google Maps, which needs a paid Cloud billing
// account past a small monthly credit). Online-only, same as the streets
// basemap above; not cached for offline use.
const SATELLITE_STYLE = {
  version: 8,
  sources: {
    "esri-satellite": {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution: "Esri, Maxar, Earthstar Geographics, and the GIS User Community",
      // World_Imagery's tile scheme accepts requests up to z23, but real
      // photography for rural/backcountry areas (exactly where this app's
      // trails are) usually tops out well before that — the server's
      // answer for a tile it has no imagery for isn't an error, it's a
      // placeholder image with "Map data not yet available for this area"
      // baked into it, which is the broken-looking tile users were
      // hitting when zooming all the way in. Capping maxzoom here makes
      // MapLibre stop requesting past it and instead smoothly over-scale
      // the last real tile it has (standard raster-source behavior) —
      // a softer image beats a dead-end error tile.
      maxzoom: 19,
    },
    // Esri's free "hybrid" reference layers — transparent PNG tiles meant
    // to sit on top of World_Imagery exactly like this. Same server/ToS as
    // the imagery above, no separate API key. Two separate services: place
    // names/boundaries alone don't include streets — road lines and street
    // names live in the Transportation layer instead. Both capped to match
    // the satellite layer so they stay visually in sync at extreme zoom.
    "esri-transportation": {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution: "Esri",
      maxzoom: 19,
    },
    "esri-labels": {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution: "Esri",
      maxzoom: 19,
    },
  },
  layers: [
    { id: "esri-satellite-layer", type: "raster", source: "esri-satellite" },
    { id: "esri-transportation-layer", type: "raster", source: "esri-transportation" },
    { id: "esri-labels-layer", type: "raster", source: "esri-labels" },
  ],
};

const OFFLINE_FALLBACK_STYLE = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#0f172a" },
    },
  ],
};

// Always attempt the online style first, even if navigator.onLine is
// false at load time: a custom-downloaded area's tiles (see "Download
// This Area" below) can only resolve offline if the style.json itself
// was cached too, which only happens by actually requesting it — and
// the error handler below falls back to the offline background style
// if that request genuinely fails (nothing cached, no network).
const usingOnlineBasemap = true;

const map = new maplibregl.Map({
  container: "map",
  style: usingOnlineBasemap ? SATELLITE_STYLE : OFFLINE_FALLBACK_STYLE,
  center: [-84.39, 33.75], // roughly central southeast (Atlanta area)
  zoom: 6,
  // The default (non-compact) attribution control renders a full-width
  // text bar pinned to the bottom of the map, which sat directly behind
  // our custom #toolbar and showed through its gaps/translucent edges —
  // added explicitly below as a compact icon instead, out of the
  // toolbar's way.
  attributionControl: false,
});
map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
// If the online style URL itself fails to load (host down, no real
// connectivity despite navigator.onLine), fall back rather than leaving
// the map stuck mid-load with no explanation. Satellite imagery has no
// "style.json" of its own to fail (it's a plain raster source defined
// inline, see SATELLITE_STYLE) so there's nothing to catch here for it —
// this only matters once something calls switchBasemap("streets").
let onlineStyleFailed = false;
map.on("error", (e) => {
  const isStyleLoadError =
    usingOnlineBasemap && currentBasemap === "streets" && !onlineStyleFailed && !map.isStyleLoaded();
  if (isStyleLoadError) {
    onlineStyleFailed = true;
    console.warn("Online basemap failed to load, falling back to offline style:", e.error);
    map.setStyle(OFFLINE_FALLBACK_STYLE);
    document.getElementById("map-hint").classList.remove("hidden");
  }
});
// showCompass: false — MapLibre's default 3rd button here (rotate/reset-
// bearing) duplicates the app's own North-up/heading-up toggle
// (#btn-orientation in the stats HUD), just smaller, unlabeled, and
// easy to hit by accident right next to zoom in/out. One clear control
// for map bearing instead of two different ones doing similar things.
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
const geolocateControl = new maplibregl.GeolocateControl({
  positionOptions: { enableHighAccuracy: true },
  trackUserLocation: true,
  showUserHeading: true,
});
map.addControl(geolocateControl, "bottom-right");

// Browsers silently suppress a location permission prompt that isn't
// triggered by a direct user gesture (confirmed in practice: calling
// trigger() on map load showed no prompt at all, no error, nothing —
// a "drive-by prompt" protection). So: try the auto-trigger anyway
// (harmless, works on browsers that allow it), but always show a
// tappable banner as the reliable path, and surface real errors
// instead of failing silently.
const locateBanner = document.getElementById("locate-banner");

function hideLocateBanner() {
  locateBanner.classList.add("hidden");
}

geolocateControl.on("geolocate", hideLocateBanner);

// ---------- Live stats HUD (speed / heading / elevation) ----------
// Piggybacks on the GeolocateControl's own continuous, high-accuracy
// position stream (it keeps watching after the first trigger() since
// trackUserLocation is on) instead of opening a second GPS watch.
const statsHud = document.getElementById("stats-hud");
const statSpeedEl = document.getElementById("stat-speed");
const statHeadingEl = document.getElementById("stat-heading");
const statHeadingArrowEl = document.getElementById("stat-heading-arrow");
const statElevationEl = document.getElementById("stat-elevation");

const COMPASS_POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
function compassLabel(deg) {
  return COMPASS_POINTS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

// North-up (default) vs. track-up (map rotates so your current heading
// always points to the top of the screen, like onX/most nav apps).
const btnOrientation = document.getElementById("btn-orientation");
const statOrientationModeEl = document.getElementById("stat-orientation-mode");
let orientationMode = "north"; // "north" | "track"

btnOrientation.addEventListener("click", () => {
  orientationMode = orientationMode === "north" ? "track" : "north";
  btnOrientation.classList.toggle("active", orientationMode === "track");
  statOrientationModeEl.textContent = orientationMode === "track" ? "TRK-UP" : "N-UP";
  btnOrientation.title =
    orientationMode === "track"
      ? "Track-up: map rotates to your direction of travel. Tap for North-up."
      : "North-up. Tap for track-up (rotates map to your direction of travel).";
  if (orientationMode === "north") map.easeTo({ bearing: 0, duration: 300 });
});

function updateStatsHud(position) {
  // No longer gated behind a "hidden" class waiting for the first GPS
  // fix — the North-up/track-up toggle inside this HUD is useful (and
  // should be discoverable) even before location is on, same reasoning
  // as the tilt stat already showing "--" rather than not existing at
  // all until its sensor is enabled.
  const { speed, heading, altitude } = position.coords;

  statSpeedEl.textContent = typeof speed === "number" && isFinite(speed) && speed >= 0 ? Math.round(speed * 2.23694) : "--";

  if (typeof heading === "number" && isFinite(heading)) {
    statHeadingEl.textContent = compassLabel(heading);
    statHeadingArrowEl.classList.remove("dim");
    if (orientationMode === "track") {
      // The map itself now rotates to match your heading, so "up" on
      // screen already means "the way you're going" — the arrow just
      // points straight up rather than duplicating that rotation.
      statHeadingArrowEl.style.transform = "rotate(0deg)";
      map.easeTo({ bearing: heading, duration: 300 });
    } else {
      statHeadingArrowEl.style.transform = `rotate(${heading}deg)`;
    }
  } else {
    statHeadingEl.textContent = "--";
    statHeadingArrowEl.classList.add("dim");
  }

  // Device-reported GPS altitude only — the free AWS terrain tiles used
  // for the 3D terrain view have no CORS headers, so their elevation
  // data can be drawn on the map but not read back as a number in JS.
  // Altitude support varies a lot by device/browser, hence the "--".
  statElevationEl.textContent = typeof altitude === "number" && isFinite(altitude) ? Math.round(altitude * 3.28084) : "--";
}

// ---------- Tilt / roll meter ----------
// Left-right lean angle, read from the device's own tilt sensor — mount
// the phone the way it actually rides in the vehicle (usually upright in
// a dash/window mount) and this becomes a rough "how far over am I"
// gauge. Not a certified inclinometer, just a heads-up.
const btnTilt = document.getElementById("btn-tilt");
const statTiltEl = document.getElementById("stat-tilt");
const TILT_WARN_DEGREES = 45;
let tiltListening = false;

function formatTilt(gamma) {
  const rounded = Math.round(Math.abs(gamma));
  if (rounded === 0) return "0°";
  return `${rounded}°${gamma > 0 ? "R" : "L"}`;
}

function onDeviceOrientation(event) {
  if (typeof event.gamma !== "number") return;
  statTiltEl.textContent = formatTilt(event.gamma);
  btnTilt.classList.toggle("warn", Math.abs(event.gamma) >= TILT_WARN_DEGREES);
}

async function enableTilt() {
  if (tiltListening) return;
  // iOS 13+ gates this sensor behind an explicit permission prompt that
  // must be triggered by a direct tap (same "no drive-by prompts" rule
  // as the location banner elsewhere in this app) — everywhere else
  // (Android, desktop) it just works without asking.
  if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
    try {
      const result = await DeviceOrientationEvent.requestPermission();
      if (result !== "granted") {
        alert("Tilt sensor access was denied — enable it in your browser's site settings, then tap here to retry.");
        return;
      }
    } catch (err) {
      alert("Couldn't request tilt sensor access: " + err.message);
      return;
    }
  }
  window.addEventListener("deviceorientation", onDeviceOrientation);
  tiltListening = true;
  btnTilt.classList.add("active");
}

btnTilt.addEventListener("click", enableTilt);

geolocateControl.on("geolocate", updateStatsHud);

// A running cache of the most recent GPS fix, fed by the GeolocateControl's
// continuous watch. Used as a fallback when a one-off getCurrentPosition()
// call (e.g. for tagging a photo) times out or fails outright — e.g. right
// after the camera app hands focus back and the GPS radio hasn't
// reacquired yet — so a slow/failed fresh fix doesn't mean losing the
// capture entirely.
let lastKnownPosition = null;
geolocateControl.on("geolocate", (pos) => {
  lastKnownPosition = { lat: pos.coords.latitude, lng: pos.coords.longitude, t: Date.now() };
});

geolocateControl.on("error", (err) => {
  locateBanner.textContent =
    err.code === 1 // PERMISSION_DENIED
      ? "Location access is blocked for this site — enable it in your browser's site settings, then tap here to retry."
      : "Couldn't get your location — tap here to retry.";
  locateBanner.classList.remove("hidden");
});

locateBanner.addEventListener("click", () => geolocateControl.trigger());
map.on("load", () => geolocateControl.trigger());

// ---------- Basemap toggle (streets / satellite) ----------
// Satellite is the default view.
let currentBasemap = usingOnlineBasemap ? "satellite" : "offline";

function switchBasemap(kind) {
  if (kind === currentBasemap) return;
  if (kind === "satellite" && !navigator.onLine) {
    alert("Satellite imagery needs an internet connection — it isn't downloaded for offline use.");
    return;
  }
  currentBasemap = kind;
  map.setStyle(kind === "satellite" ? SATELLITE_STYLE : ONLINE_STYLE_URL);
  updateBasemapToggleLabel();
}

function updateBasemapToggleLabel() {
  const btn = document.getElementById("btn-basemap");
  if (!btn) return;
  btn.textContent = currentBasemap === "satellite" ? "🛰️ Satellite" : "🗺️ Streets";
}
updateBasemapToggleLabel();

document.getElementById("btn-basemap")?.addEventListener("click", () => {
  switchBasemap(currentBasemap === "satellite" ? "streets" : "satellite");
});

// A style.load fires after every map.setStyle() call (including the
// first, initial one) — re-add anything that isn't part of the base
// style, since setStyle wipes all custom sources/layers.
map.on("style.load", () => {
  if (terrain3dOn) add3dTerrainLayers(); // setTerrain/sky are wiped by setStyle same as any other layer — pitch itself isn't, so no need to re-ease it here
  if (cellTowersOn) refreshCellTowerLayer().catch((err) => console.warn("Cell tower re-layer failed:", err));
  if (radarOn) addRadarLayer().catch((err) => console.warn("Radar re-layer failed:", err.message));
  drawBreadcrumbLine();
});

// ---------- Breadcrumb trail (passive "everywhere I've been") ----------
// Distinct from Record: this runs continuously in the background whenever
// the app is open (throttled to conserve battery/storage), building up a
// permanent visual history across every visit — not one named session you
// start and stop. Local-only for now (not shared with the crew).
//
// Rendered as one line per calendar day (each gets its own source/layer,
// cycling through BREADCRUMB_COLORS in chronological order) rather than
// one continuous line, so a multi-day trip shows which day is which at a
// glance instead of everything blending into a single color.
const BREADCRUMB_SOURCE_PREFIX = "breadcrumb-trail-";
const BREADCRUMB_COLORS = ["#ec4899", "#06b6d4", "#f97316", "#84cc16", "#a855f7", "#eab308"];
let breadcrumbPoints = [];
let breadcrumbWatchId = null;
let activeBreadcrumbSourceIds = new Set();

// Per-day show/hide + custom color, a per-device preference (not shared
// data) so it's simplest kept in localStorage rather than IndexedDB.
const BREADCRUMB_PREFS_KEY = "trailmark_breadcrumb_day_prefs";
function loadBreadcrumbPrefs() {
  try {
    return JSON.parse(localStorage.getItem(BREADCRUMB_PREFS_KEY) || "{}");
  } catch {
    return {};
  }
}
let breadcrumbDayPrefs = loadBreadcrumbPrefs(); // { [dayKey]: { color?: string, hidden?: boolean, name?: string } }
function saveBreadcrumbPrefs() {
  try {
    localStorage.setItem(BREADCRUMB_PREFS_KEY, JSON.stringify(breadcrumbDayPrefs));
  } catch {
    // Private browsing / storage full — the toggle still works for this
    // session, it just won't persist across reloads.
  }
}
function breadcrumbDayColor(dayKey, i) {
  return breadcrumbDayPrefs[dayKey]?.color || BREADCRUMB_COLORS[i % BREADCRUMB_COLORS.length];
}
function isBreadcrumbDayVisible(dayKey) {
  return !breadcrumbDayPrefs[dayKey]?.hidden;
}
function setBreadcrumbDayColor(dayKey, color) {
  breadcrumbDayPrefs[dayKey] = { ...breadcrumbDayPrefs[dayKey], color };
  saveBreadcrumbPrefs();
}
function toggleBreadcrumbDayVisible(dayKey) {
  breadcrumbDayPrefs[dayKey] = { ...breadcrumbDayPrefs[dayKey], hidden: !breadcrumbDayPrefs[dayKey]?.hidden };
  saveBreadcrumbPrefs();
}
// Custom per-day display name ("Weekend at Ocala"), independent of the
// date — the date/time is always shown alongside it (see breadcrumbDayKey
// and breadcrumbDayTimeRange below) so renaming never hides when it was.
function breadcrumbDayLabel(dayKey) {
  const custom = breadcrumbDayPrefs[dayKey]?.name;
  if (custom && custom.trim()) return custom.trim();
  return breadcrumbDayDateLabel(dayKey);
}
function breadcrumbDayDateLabel(dayKey) {
  return new Date(dayKey + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function setBreadcrumbDayName(dayKey, name) {
  const trimmed = name && name.trim() ? name.trim() : undefined;
  breadcrumbDayPrefs[dayKey] = { ...breadcrumbDayPrefs[dayKey], name: trimmed };
  saveBreadcrumbPrefs();
}
// Earliest-to-latest clock time for a day's points (points arrive in
// chronological order already, so the first/last entries are the bounds).
function breadcrumbDayTimeRange(points) {
  if (!points || !points.length) return "";
  const fmt = (t) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const start = points[0].t;
  const end = points[points.length - 1].t;
  return start === end ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
}

function breadcrumbDayKey(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Chronological order (breadcrumbPoints is loaded/appended in time order),
// so day N always gets the same color across reloads as long as the same
// days of history exist — colors don't shuffle around session to session.
function breadcrumbPointsByDay() {
  const byDay = new Map();
  for (const p of breadcrumbPoints) {
    // A point with no usable timestamp can't be grouped into a real day
    // — skip it rather than let it form a "NaN-NaN-NaN" key, which
    // renders as a literal "Invalid Date" entry in My Content.
    if (typeof p.t !== "number" || !isFinite(p.t)) continue;
    const key = breadcrumbDayKey(p.t);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(p);
  }
  return byDay;
}

function drawBreadcrumbLine() {
  const byDay = breadcrumbPointsByDay();
  const nextIds = new Set();
  // Breadcrumbs log passively in the background the whole time the app
  // is open, including during an explicit Go & Track recording — without
  // this, today's dashed breadcrumb line and the recording's own solid
  // live-trail line both draw the same path at once, which just reads as
  // a rendering bug ("why are there two trails"). The live trail is the
  // more precise, real-time one, so today's breadcrumb line stays
  // suppressed (not deleted — still logging underneath) for as long as a
  // recording is actually running.
  const todayKey = GpsRecorder.isRecording() ? breadcrumbDayKey(Date.now()) : null;

  Array.from(byDay.entries()).forEach(([dayKey, points], i) => {
    if (points.length < 2) return; // need at least 2 points to draw a line
    if (!isBreadcrumbDayVisible(dayKey)) return; // hidden — leave out of nextIds so cleanup below removes it
    if (dayKey === todayKey) return; // suppressed while recording — see comment above
    const sourceId = BREADCRUMB_SOURCE_PREFIX + dayKey;
    nextIds.add(sourceId);
    const color = breadcrumbDayColor(dayKey, i);
    const geojson = {
      type: "Feature",
      geometry: { type: "LineString", coordinates: points.map((p) => [p.lng, p.lat]) },
    };
    if (map.getSource(sourceId)) {
      map.getSource(sourceId).setData(geojson);
      map.setPaintProperty(sourceId, "line-color", color); // picks up a color change without a full re-add
      return;
    }
    // Bright, saturated colors at near-full opacity and a heavier width —
    // a previous pale gray at 50% opacity blended into the dark basemap
    // and was hard to spot.
    map.addSource(sourceId, { type: "geojson", data: geojson });
    map.addLayer({
      id: sourceId,
      type: "line",
      source: sourceId,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": color,
        "line-width": 3.5,
        "line-opacity": 0.9,
        "line-dasharray": [2, 1.5],
      },
    });
  });

  // Drop any day-layers no longer represented (after clearing, or after a
  // style change wiped every custom source/layer out from under us).
  activeBreadcrumbSourceIds.forEach((sourceId) => {
    if (!nextIds.has(sourceId)) {
      if (map.getLayer(sourceId)) map.removeLayer(sourceId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    }
  });
  activeBreadcrumbSourceIds = nextIds;
}

function startBreadcrumbTracking() {
  if (!("geolocation" in navigator) || breadcrumbWatchId !== null) return;
  let lastSaved = 0;
  let lastPoint = null;
  breadcrumbWatchId = navigator.geolocation.watchPosition(
    async (pos) => {
      const now = Date.now();
      const point = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      // Throttle: at most every 20s, and only if we've actually moved
      // (avoids a dense cluster of points while parked).
      if (now - lastSaved < 20000) return;
      if (lastPoint && totalDistanceMeters([lastPoint, point]) < 15) return;
      lastSaved = now;
      lastPoint = point;
      await BreadcrumbStore.addPoint(point.lat, point.lng);
      breadcrumbPoints.push(point);
      drawBreadcrumbLine();
    },
    (err) => console.warn("Breadcrumb GPS error:", err.message),
    { enableHighAccuracy: false, maximumAge: 15000 }
  );
}

async function initBreadcrumbTrail() {
  breadcrumbPoints = await BreadcrumbStore.allPoints();
  drawBreadcrumbLine();
  startBreadcrumbTracking();
}

async function clearBreadcrumbTrail() {
  await BreadcrumbStore.clear();
  breadcrumbPoints = [];
  activeBreadcrumbSourceIds.forEach((sourceId) => {
    if (map.getLayer(sourceId)) map.removeLayer(sourceId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  });
  activeBreadcrumbSourceIds.clear();
}

// ---------- 3D terrain (pitched, elevation-extruded view) ----------
// AWS Terrain Tiles (free, public, no API key — a standard, widely-used
// source for exactly this) as the DEM MapLibre's setTerrain() extrudes.
// Online-only, like the satellite imagery — not cached for offline use.
let terrain3dOn = false;
const TERRAIN_SOURCE_ID = "aws-terrain-dem";
const TERRAIN_3D_PITCH = 60; // MapLibre's default maxPitch — as steep as it goes without raising that

function add3dTerrainLayers() {
  if (!map.getSource(TERRAIN_SOURCE_ID)) {
    map.addSource(TERRAIN_SOURCE_ID, {
      type: "raster-dem",
      tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
      tileSize: 256,
      encoding: "terrarium",
      attribution: "Terrain: AWS Terrain Tiles",
    });
  }
  map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: 1.3 });
  if (!map.getLayer("sky")) {
    map.addLayer({ id: "sky", type: "sky", paint: { "sky-type": "atmosphere", "sky-atmosphere-sun-intensity": 10 } });
  }
}

function remove3dTerrainLayers() {
  map.setTerrain(null);
  if (map.getLayer("sky")) map.removeLayer("sky");
  if (map.getSource(TERRAIN_SOURCE_ID)) map.removeSource(TERRAIN_SOURCE_ID);
}

function toggle3dTerrain() {
  if (!navigator.onLine && !terrain3dOn) {
    alert("3D terrain needs an internet connection — it isn't downloaded for offline use.");
    return;
  }
  terrain3dOn = !terrain3dOn;
  if (terrain3dOn) {
    add3dTerrainLayers();
    map.easeTo({ pitch: TERRAIN_3D_PITCH, duration: 800 });
  } else {
    remove3dTerrainLayers();
    map.easeTo({ pitch: 0, duration: 800 });
  }
}

// ---------- Cell tower locations (rough coverage proxy) ----------
let cellTowersOn = false;
const CELL_SOURCE_ID = "cell-towers";

async function refreshCellTowerLayer() {
  const towers = await CellCoverage.fetchTowers(map.getBounds());
  const geojson = CellCoverage.towersToCircleGeoJSON(towers);
  if (map.getSource(CELL_SOURCE_ID)) {
    map.getSource(CELL_SOURCE_ID).setData(geojson);
  } else {
    map.addSource(CELL_SOURCE_ID, { type: "geojson", data: geojson });
    map.addLayer({
      id: CELL_SOURCE_ID,
      type: "circle",
      source: CELL_SOURCE_ID,
      paint: {
        "circle-radius": 5,
        "circle-color": "#facc15",
        "circle-stroke-width": 1,
        "circle-stroke-color": "#78350f",
        "circle-opacity": 0.8,
      },
    });
  }
}

async function toggleCellTowers() {
  if (!navigator.onLine) {
    alert("Cell tower data needs an internet connection.");
    return;
  }
  cellTowersOn = !cellTowersOn;
  if (!cellTowersOn) {
    if (map.getLayer(CELL_SOURCE_ID)) map.removeLayer(CELL_SOURCE_ID);
    if (map.getSource(CELL_SOURCE_ID)) map.removeSource(CELL_SOURCE_ID);
    return;
  }
  try {
    await refreshCellTowerLayer();
  } catch (err) {
    alert("Could not load cell tower data: " + err.message);
    cellTowersOn = false;
  }
}

document.getElementById("btn-settings")?.addEventListener("click", openSettingsPanel);

let trailSourceCounter = 0;
let activeWaypointMarkers = [];

// ---------- Online/offline status pill ----------
function refreshStatusPill() {
  const pill = document.getElementById("status-pill");
  const online = navigator.onLine;
  pill.textContent = online ? "online" : "offline";
  pill.className = online ? "online" : "offline";
}
window.addEventListener("online", refreshStatusPill);
window.addEventListener("offline", refreshStatusPill);
refreshStatusPill();

// ---------- Panel helpers ----------
const panel = document.getElementById("panel");
const panelTitle = document.getElementById("panel-title");
const panelBody = document.getElementById("panel-body");

function openPanel(title, bodyHtml) {
  panelTitle.textContent = title;
  panelBody.innerHTML = bodyHtml;
  panel.classList.remove("hidden");
}
function closePanel() {
  panel.classList.add("hidden");
  document.querySelectorAll("#toolbar button.active").forEach((b) => b.classList.remove("active"));
}
document.getElementById("panel-close").addEventListener("click", closePanel);

// ---------- Version history ----------
const btnVersion = document.getElementById("btn-version");
fetch("version.json", { cache: "no-store" })
  .then((res) => res.json())
  .then((data) => {
    btnVersion.textContent = `v${data.current}`;
  })
  .catch(() => {});

btnVersion.addEventListener("click", async () => {
  let data;
  try {
    const res = await fetch("version.json", { cache: "no-store" });
    data = await res.json();
  } catch {
    openPanel("Version history", "<p>Couldn't load version history right now.</p>");
    return;
  }
  const rows = (data.history || [])
    .map(
      (h) => `
        <div class="row">
          <span>v${escHtml(h.version)}</span>
          <span style="color:var(--text-dim);font-size:12px;">${escHtml(h.date)}</span>
        </div>
        <p style="margin:-4px 0 10px;color:var(--text-dim);font-size:13px;">${escHtml(h.summary || "")}</p>
      `
    )
    .join("");
  openPanel(`Version history — current v${escHtml(data.current)}`, rows || "<p>No history yet.</p>");
});

// Minimal escaping for any user-entered text we inject into innerHTML.
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// A GPS fix requested for the photo currently being snapped — started
// the instant the Photo button is tapped (in parallel with the camera
// opening), not after the photo comes back. Opening the native camera
// app can cause mobile browsers to evict/reload the page under memory
// pressure; anything left waiting on an async result at that point is
// lost with no error shown. Fetching the location first means there's
// nothing left to await once the file comes back — saving is then a
// synchronous-feeling step instead of a several-second window where the
// whole capture can silently vanish.
let pendingPhotoLocation = null;

function requestPhotoLocation() {
  pendingPhotoLocation = new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      // Still fall back to the last fix from the map's own GPS watch
      // rather than losing the photo outright.
      if (lastKnownPosition) {
        resolve({ lat: lastKnownPosition.lat, lng: lastKnownPosition.lng });
      } else {
        reject(new Error("Geolocation isn't available on this device."));
      }
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => {
        // A fresh fix can time out or fail right after the camera app
        // hands focus back (GPS radio hasn't reacquired yet) — fall back
        // to the most recent fix from the map's continuous watch instead
        // of throwing the photo away.
        if (lastKnownPosition && Date.now() - lastKnownPosition.t < 5 * 60 * 1000) {
          resolve({ lat: lastKnownPosition.lat, lng: lastKnownPosition.lng });
        } else {
          reject(err);
        }
      },
      // maximumAge lets the browser hand back an already-cached fix from
      // its ongoing watch instantly instead of forcing a brand-new one —
      // a big part of why this could time out at all.
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 20000 }
    );
  });
}

// ---------- Toolbar wiring ----------
const toolbarButtons = document.querySelectorAll("#toolbar button");
toolbarButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const mode = btn.dataset.mode;
    // Go is an instant action (no panel), so it doesn't get the toolbar's
    // "active" panel-mode styling the other buttons use.
    if (mode === "record") {
      startRecordingNow();
      return;
    }
    toolbarButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    if (mode === "tools") openToolsPanel();
    if (mode === "regions") openRegionsPanel();
    if (mode === "trails") openTrailsPanel();
    if (mode === "group") openGroupPanel();
  });
});

// ---------- Waypoints ----------
const CATEGORY_COLORS = {
  trailhead: "#22c55e",
  campsite: "#f59e0b",
  fuel: "#ef4444",
  water_crossing: "#38bdf8",
  obstacle: "#a855f7",
  hazard: "#dc2626",
  other: "#facc15",
};
const CATEGORY_LABELS = {
  trailhead: "Trailhead",
  campsite: "Campsite",
  fuel: "Fuel",
  water_crossing: "Water Crossing",
  obstacle: "Obstacle",
  hazard: "Hazard",
  other: "Other",
};

function categoryOptionsHtml(selected) {
  return WAYPOINT_CATEGORIES.map(
    (c) => `<option value="${c}" ${c === selected ? "selected" : ""}>${CATEGORY_LABELS[c]}</option>`
  ).join("");
}

// Severity only means something for these three — "how bad is this
// water crossing/obstacle/hazard right now" — not for a trailhead or
// fuel stop, so the field is hidden entirely for other categories
// rather than showing a meaningless control.
const WAYPOINT_SEVERITY_CATEGORIES = ["water_crossing", "obstacle", "hazard"];
const SEVERITY_LABELS = { 1: "Minor", 2: "Moderate", 3: "Major" };
const SEVERITY_COLORS = { 1: "#eab308", 2: "#f97316", 3: "#dc2626" };

function severityFieldHtml(selectId, selected, category) {
  const hidden = WAYPOINT_SEVERITY_CATEGORIES.includes(category) ? "" : "hidden";
  return `<div id="${selectId}-wrap" ${hidden}>
    <label>Severity</label>
    <select id="${selectId}" style="width:100%;margin-top:6px;padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);">
      <option value="">Not set</option>
      ${[1, 2, 3].map((s) => `<option value="${s}" ${Number(selected) === s ? "selected" : ""}>${SEVERITY_LABELS[s]}</option>`).join("")}
    </select>
  </div>`;
}

// Wires a category <select> to show/hide a severity <select> next to it —
// shared by the drop-waypoint and edit-waypoint forms.
function wireSeverityVisibility(categorySelectId, severityWrapId) {
  const categorySelect = document.getElementById(categorySelectId);
  const wrap = document.getElementById(severityWrapId);
  if (!categorySelect || !wrap) return;
  categorySelect.addEventListener("change", () => {
    wrap.hidden = !WAYPOINT_SEVERITY_CATEGORIES.includes(categorySelect.value);
  });
}

function buildWaypointPopupContent(wp) {
  const container = document.createElement("div");
  container.style.maxWidth = "220px";

  const title = document.createElement("div");
  title.innerHTML = `<strong>${escHtml(wp.name)}</strong> <span style="color:#6b7280;font-size:12px;">(${CATEGORY_LABELS[wp.category] || "Other"})</span>`;
  container.appendChild(title);

  if (wp.severity) {
    const sev = document.createElement("div");
    sev.style.cssText = `font-size:12px;font-weight:700;margin-top:2px;color:${SEVERITY_COLORS[wp.severity]};`;
    sev.textContent = `⚠ ${SEVERITY_LABELS[wp.severity]}`;
    container.appendChild(sev);
  }

  if (wp.note) {
    const note = document.createElement("div");
    note.style.cssText = "font-size:12px;margin-top:4px;color:#374151;";
    note.textContent = wp.note;
    container.appendChild(note);
  }

  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;gap:6px;margin-top:8px;";

  const editBtn = document.createElement("button");
  editBtn.textContent = "Edit";
  editBtn.style.cssText = "flex:1;padding:6px;background:#166534;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;";
  editBtn.addEventListener("click", () => openEditWaypointPanel(wp));
  actions.appendChild(editBtn);

  const moveBtn = document.createElement("button");
  moveBtn.textContent = "Move Here";
  moveBtn.style.cssText = "flex:1;padding:6px;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;";
  moveBtn.addEventListener("click", () => {
    if (!("geolocation" in navigator)) {
      alert("Geolocation isn't available on this device.");
      return;
    }
    moveBtn.textContent = "…";
    moveBtn.disabled = true;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await WaypointStore.moveWaypoint(wp.id, pos.coords.latitude, pos.coords.longitude);
        await refreshWaypointMarkers();
      },
      (err) => {
        alert("Couldn't get your location: " + err.message);
        moveBtn.textContent = "Move Here";
        moveBtn.disabled = false;
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
  actions.appendChild(moveBtn);

  const delBtn = document.createElement("button");
  delBtn.textContent = "Delete";
  delBtn.style.cssText = "flex:1;padding:6px;background:#dc2626;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;";
  delBtn.addEventListener("click", async () => {
    if (!confirm(`Delete "${wp.name}"?`)) return;
    await WaypointStore.deleteWaypoint(wp.id);
    await refreshWaypointMarkers();
  });
  actions.appendChild(delBtn);

  container.appendChild(actions);
  return container;
}

function openEditWaypointPanel(wp) {
  openPanel(
    "Edit Waypoint",
    `
    <label>Name</label>
    <input id="wp-edit-name" value="${escHtml(wp.name)}" />
    <label>Category</label>
    <select id="wp-edit-category" style="width:100%;margin-top:6px;padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);">
      ${categoryOptionsHtml(wp.category)}
    </select>
    ${severityFieldHtml("wp-edit-severity", wp.severity, wp.category)}
    <label>Note (optional)</label>
    <textarea id="wp-edit-note" rows="2">${escHtml(wp.note || "")}</textarea>
    <button class="primary" id="wp-edit-save">Save Changes</button>
    <button class="primary" id="wp-edit-delete" style="background:var(--danger);border:none;margin-top:8px;">Delete Waypoint</button>
    `
  );
  wireSeverityVisibility("wp-edit-category", "wp-edit-severity-wrap");
  document.getElementById("wp-edit-save").addEventListener("click", async () => {
    const name = document.getElementById("wp-edit-name").value.trim() || "Unnamed waypoint";
    const category = document.getElementById("wp-edit-category").value;
    const severity = WAYPOINT_SEVERITY_CATEGORIES.includes(category)
      ? parseInt(document.getElementById("wp-edit-severity").value, 10) || null
      : null;
    const note = document.getElementById("wp-edit-note").value.trim();
    await WaypointStore.updateWaypoint(wp.id, { name, note, category, severity });
    await refreshWaypointMarkers();
    if (wp.remoteId && session) GroupBackend.upsertPersonalWaypoint({ ...wp, name, note, category, severity }).catch(() => {});
    closePanel();
  });
  document.getElementById("wp-edit-delete").addEventListener("click", async () => {
    if (!confirm(`Delete "${wp.name}"?`)) return;
    await WaypointStore.deleteWaypoint(wp.id);
    await refreshWaypointMarkers();
    closePanel();
  });
}

async function refreshWaypointMarkers() {
  activeWaypointMarkers.forEach((m) => m.remove());
  activeWaypointMarkers = [];
  const waypoints = await WaypointStore.listWaypoints();
  waypoints.forEach((wp) => {
    const color = CATEGORY_COLORS[wp.category] || CATEGORY_COLORS.other;
    const marker = new maplibregl.Marker({ color })
      .setLngLat([wp.lng, wp.lat])
      .setPopup(new maplibregl.Popup().setDOMContent(buildWaypointPopupContent(wp)))
      .addTo(map);
    activeWaypointMarkers.push(marker);
  });
}

// ---------- Photos (snap a geotagged picture) ----------
let activePhotoMarkers = [];

function buildPhotoPopupContent(photo, objectUrl) {
  const container = document.createElement("div");
  container.style.maxWidth = "220px";

  const img = document.createElement("img");
  img.src = objectUrl;
  img.alt = "Trail photo";
  img.style.cssText = "width:100%;border-radius:8px;display:block;";
  container.appendChild(img);

  if (photo.note) {
    const note = document.createElement("div");
    note.style.cssText = "font-size:12px;margin-top:6px;";
    note.textContent = photo.note;
    container.appendChild(note);
  }

  const date = document.createElement("div");
  date.style.cssText = "font-size:11px;color:#9ca3af;margin-top:4px;";
  date.textContent = new Date(photo.createdAt).toLocaleString();
  container.appendChild(date);

  const delBtn = document.createElement("button");
  delBtn.textContent = "Delete";
  delBtn.style.cssText =
    "margin-top:8px;width:100%;padding:6px;background:#dc2626;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600;";
  delBtn.addEventListener("click", async () => {
    if (!confirm("Delete this photo?")) return;
    await PhotoStore.deletePhoto(photo.id);
    await refreshPhotoMarkers();
  });
  container.appendChild(delBtn);

  return container;
}

async function refreshPhotoMarkers() {
  activePhotoMarkers.forEach((m) => m.remove());
  activePhotoMarkers = [];
  const photos = await PhotoStore.listPhotos();
  photos.forEach((photo) => {
    // One bad row (e.g. a corrupted Blob — IndexedDB's Blob support has
    // known bugs on some mobile browsers) shouldn't take down every
    // other photo's marker along with it.
    try {
      const el = document.createElement("div");
      el.textContent = "📷";
      el.style.cssText = "font-size:20px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.7));cursor:pointer;";
      // photo.data/type is the current format (see PhotoStore.savePhoto);
      // photo.blob is a fallback for any photo saved before that fix, on
      // a browser where storing the Blob directly happened to work.
      const blob = photo.data ? new Blob([photo.data], { type: photo.type }) : photo.blob;
      const objectUrl = URL.createObjectURL(blob);
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([photo.lng, photo.lat])
        .setPopup(new maplibregl.Popup().setDOMContent(buildPhotoPopupContent(photo, objectUrl)))
        .addTo(map);
      activePhotoMarkers.push(marker);
    } catch (err) {
      console.warn("Could not render a photo marker:", photo.id, err);
    }
  });
}

// The Tools panel's Photo row opens this file input directly.
const photoInput = document.getElementById("photo-input");
photoInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  if (!pendingPhotoLocation) {
    alert("Geolocation isn't available on this device — can't tag the photo's location.");
    return;
  }
  let lat, lng;
  try {
    ({ lat, lng } = await pendingPhotoLocation);
  } catch (err) {
    alert("Couldn't get your location for this photo: " + err.message);
    return;
  }

  await PhotoStore.savePhoto({ lat, lng, note: "", blob: file });
  await refreshPhotoMarkers();
  // Sharing is automatic while you're signed in — same as live location —
  // rather than a per-photo prompt breaking up the snap-and-go flow.
  if (session) {
    try {
      await GroupBackend.addPhoto({ lat, lng, note: "", photoFile: file });
      alert("Photo saved and shared with the crew.");
    } catch (err) {
      alert("Photo saved locally, but couldn't share it: " + err.message);
    }
  } else {
    alert("Photo saved at your location.");
  }
});

async function refreshGroupPhotoMarkers(rows) {
  const seen = new Set();
  for (const row of rows) {
    if (session && row.created_by === session.user.id) continue; // already shown via the local photo markers
    seen.add(row.id);
    if (groupPhotoMarkers[row.id]) continue; // already rendered this session
    let url;
    try {
      url = await GroupBackend.photoUrl(row.photo_path);
    } catch (err) {
      console.warn("Could not load a shared photo:", err.message);
      continue;
    }

    const el = document.createElement("div");
    el.textContent = "📷";
    el.style.cssText = "font-size:20px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.7));cursor:pointer;";

    const container = document.createElement("div");
    container.style.maxWidth = "220px";
    const img = document.createElement("img");
    img.src = url;
    img.alt = "Trail photo";
    img.style.cssText = "width:100%;border-radius:8px;display:block;";
    container.appendChild(img);
    const byline = document.createElement("div");
    byline.style.cssText = "font-size:12px;margin-top:6px;color:var(--text-dim);";
    byline.textContent = `By ${row.profiles?.display_name || "Rider"}`;
    container.appendChild(byline);
    if (row.note) {
      const note = document.createElement("div");
      note.style.cssText = "font-size:12px;margin-top:4px;";
      note.textContent = row.note;
      container.appendChild(note);
    }
    const date = document.createElement("div");
    date.style.cssText = "font-size:11px;color:#9ca3af;margin-top:4px;";
    date.textContent = new Date(row.created_at).toLocaleString();
    container.appendChild(date);

    groupPhotoMarkers[row.id] = new maplibregl.Marker({ element: el })
      .setLngLat([row.lng, row.lat])
      .setPopup(new maplibregl.Popup().setDOMContent(container))
      .addTo(map);
  }
  Object.keys(groupPhotoMarkers).forEach((id) => {
    if (!seen.has(id)) {
      groupPhotoMarkers[id].remove();
      delete groupPhotoMarkers[id];
    }
  });
}

async function refreshGroupWaypointMarkers(rows) {
  const seen = new Set();
  for (const row of rows) {
    if (session && row.created_by === session.user.id) continue; // already shown via the local waypoint markers
    seen.add(row.id);
    if (groupWaypointMarkers[row.id]) continue; // already rendered this session

    const color = CATEGORY_COLORS[row.category] || CATEGORY_COLORS.other;

    const container = document.createElement("div");
    container.style.maxWidth = "220px";
    const title = document.createElement("div");
    title.innerHTML = `<strong>${escHtml(row.name)}</strong> <span style="color:#6b7280;font-size:12px;">(${
      CATEGORY_LABELS[row.category] || "Other"
    })</span>`;
    container.appendChild(title);
    if (row.severity) {
      const sev = document.createElement("div");
      sev.style.cssText = `font-size:12px;font-weight:700;margin-top:2px;color:${SEVERITY_COLORS[row.severity]};`;
      sev.textContent = `⚠ ${SEVERITY_LABELS[row.severity]}`;
      container.appendChild(sev);
    }
    if (row.note) {
      const note = document.createElement("div");
      note.style.cssText = "font-size:12px;margin-top:4px;";
      note.textContent = row.note;
      container.appendChild(note);
    }
    if (row.photo_path) {
      try {
        const url = await GroupBackend.photoUrl(row.photo_path);
        const img = document.createElement("img");
        img.src = url;
        img.alt = "Waypoint photo";
        img.style.cssText = "width:100%;border-radius:8px;display:block;margin-top:6px;";
        container.appendChild(img);
      } catch (err) {
        console.warn("Could not load a shared waypoint's photo:", err.message);
      }
    }
    const byline = document.createElement("div");
    byline.style.cssText = "font-size:12px;margin-top:6px;color:var(--text-dim);";
    byline.textContent = `By ${row.profiles?.display_name || "Rider"}`;
    container.appendChild(byline);
    const date = document.createElement("div");
    date.style.cssText = "font-size:11px;color:#9ca3af;margin-top:4px;";
    date.textContent = new Date(row.created_at).toLocaleString();
    container.appendChild(date);

    groupWaypointMarkers[row.id] = new maplibregl.Marker({ color })
      .setLngLat([row.lng, row.lat])
      .setPopup(new maplibregl.Popup().setDOMContent(container))
      .addTo(map);
  }
  Object.keys(groupWaypointMarkers).forEach((id) => {
    if (!seen.has(id)) {
      groupWaypointMarkers[id].remove();
      delete groupWaypointMarkers[id];
    }
  });
}

// Consolidates the three "add something" actions (previously separate
// toolbar buttons/a buried Plan a Route row) into one Tools panel.
function openToolsPanel() {
  openPanel(
    "Tools",
    `
    <div class="tools-grid">
      <button class="tools-grid-btn" id="tools-photo-btn" title="Snap a geotagged photo">
        <span class="tools-grid-icon">📷</span><span>Add Photo</span>
      </button>
      <button class="tools-grid-btn" id="tools-waypoint-btn" title="Drop a marker at your current GPS location">
        <span class="tools-grid-icon">📍</span><span>Add Waypoint</span>
      </button>
      <button class="tools-grid-btn" id="tools-route-btn" title="Lay out a route ahead of time by tapping points on the map">
        <span class="tools-grid-icon">🛣️</span><span>Plan Route</span>
      </button>
      <button class="tools-grid-btn" id="tools-vehicles-btn" title="Track vehicles, maintenance, and receipts — private to you">
        <span class="tools-grid-icon">🔧</span><span>Vehicles</span>
      </button>
      <button class="tools-grid-btn" id="tools-stats-btn" title="Miles driven, elevation climbed, and more">
        <span class="tools-grid-icon">📊</span><span>Stats</span>
      </button>
    </div>
    `
  );
  document.getElementById("tools-photo-btn").addEventListener("click", () => {
    closePanel();
    requestPhotoLocation();
    document.getElementById("photo-input").click();
  });
  document.getElementById("tools-waypoint-btn").addEventListener("click", openWaypointPanel);
  document.getElementById("tools-vehicles-btn").addEventListener("click", openVehiclesPanel);
  document.getElementById("tools-stats-btn").addEventListener("click", () => openStatsPanel(false));
  document.getElementById("tools-route-btn").addEventListener("click", () => {
    if (GpsRecorder.isRecording()) {
      alert("You're already tracking a ride. Use the Stop & Save button on the map first.");
      return;
    }
    if (planningRoute) {
      alert("You're already planning a route. Use the Finish & Save or Cancel button on the map.");
      return;
    }
    const name = prompt("Route name:", "Unnamed route");
    if (name === null) return;
    startPlanningRoute(name.trim() || "Unnamed route");
    closePanel();
  });
}

function openWaypointPanel() {
  openPanel(
    "Drop a Waypoint",
    `
    <p style="color:var(--text-dim);font-size:13px;">Uses your current GPS location — get where you want it marked, then save.</p>
    <label>Name</label>
    <input id="wp-name" placeholder="e.g. Creek Crossing" />
    <label>Category</label>
    <select id="wp-category" style="width:100%;margin-top:6px;padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);">
      ${categoryOptionsHtml("other")}
    </select>
    ${severityFieldHtml("wp-severity", "", "other")}
    <label>Note (optional)</label>
    <textarea id="wp-note" rows="2" placeholder="Notes..."></textarea>
    ${
      session
        ? `<label><input type="checkbox" id="wp-share" /> Share with the crew</label>
           <label>Photo (optional, shared waypoints only)</label>
           <input type="file" id="wp-photo" accept="image/*" />`
        : ""
    }
    <button class="primary" id="wp-save">Save Waypoint Here</button>
    `
  );
  wireSeverityVisibility("wp-category", "wp-severity-wrap");
  document.getElementById("wp-save").addEventListener("click", () => {
    if (!("geolocation" in navigator)) {
      alert("Geolocation isn't available on this device.");
      return;
    }
    const name = document.getElementById("wp-name").value.trim() || "Unnamed waypoint";
    const category = document.getElementById("wp-category").value;
    const severity = WAYPOINT_SEVERITY_CATEGORIES.includes(category)
      ? parseInt(document.getElementById("wp-severity").value, 10) || null
      : null;
    const note = document.getElementById("wp-note").value.trim();
    const saveBtn = document.getElementById("wp-save");
    saveBtn.disabled = true;
    saveBtn.textContent = "Getting location…";
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        await WaypointStore.saveWaypoint({ name, lat, lng, note, category, severity });
        await refreshWaypointMarkers();
        syncPersonalData().catch(() => {});

        const shareBox = document.getElementById("wp-share");
        if (shareBox && shareBox.checked && session) {
          const photoInput = document.getElementById("wp-photo");
          const photoFile = photoInput && photoInput.files[0] ? photoInput.files[0] : null;
          try {
            await GroupBackend.addWaypoint({ name, note, lat, lng, category, severity, photoFile });
          } catch (err) {
            alert("Saved locally, but could not share it: " + err.message);
          }
        }
        closePanel();
      },
      (err) => {
        alert("Couldn't get your location: " + err.message);
        saveBtn.disabled = false;
        saveBtn.textContent = "Save Waypoint Here";
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

// ---------- Recording ----------
const recordingHud = document.getElementById("recording-hud");
const recordingTime = document.getElementById("recording-time");
const recordingDist = document.getElementById("recording-dist");
let recordingTimer = null;
let recordingStartedAt = null;
let liveTrailSourceId = null;

function metersToMiles(m) {
  return m / 1609.34;
}

function formatElapsed(ms) {
  const totalSec = Math.floor(ms / 1000);
  const min = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const sec = String(totalSec % 60).padStart(2, "0");
  return `${min}:${sec}`;
}

function drawLiveTrail(points) {
  if (points.length < 2) return;
  const coords = points.map((p) => [p.lng, p.lat]);
  const geojson = { type: "Feature", geometry: { type: "LineString", coordinates: coords } };

  if (!liveTrailSourceId) {
    liveTrailSourceId = `live-trail-${trailSourceCounter++}`;
    map.addSource(liveTrailSourceId, { type: "geojson", data: geojson });
    map.addLayer({
      id: liveTrailSourceId,
      type: "line",
      source: liveTrailSourceId,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#22c55e", "line-width": 4 },
    });
  } else {
    map.getSource(liveTrailSourceId).setData(geojson);
  }
}

// One tap starts recording immediately — no name prompt in the way while
// you're about to start driving. Name it afterward (defaults to today's
// date, renameable from My Content). Also starts sharing your live
// location with the crew if you're signed in — "Go" is meant as one tap
// for both, not two separate steps.
// ---------- Screen wake lock (keep the display on during an active session) ----------
// Without this, the phone's own screen-timeout dims and locks mid-ride —
// exactly when you're relying on the map/stats HUD being visible (mounted
// in a dash/window mount, glancing at it while driving). Held only while
// a GPS recording or route-planning session is actually running, not
// just because the app happens to be open — no reason to fight the OS's
// normal battery-saving dimming the rest of the time.
let wakeLock = null;

async function requestWakeLock() {
  if (!("wakeLock" in navigator) || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => {
      wakeLock = null;
    });
  } catch (err) {
    console.warn("Could not acquire a screen wake lock:", err.message);
  }
}

async function releaseWakeLock() {
  if (!wakeLock) return;
  await wakeLock.release().catch(() => {});
  wakeLock = null;
}

// The OS/browser force-releases the lock whenever the tab is backgrounded
// — re-acquire it if a session is still active once the page becomes
// visible again, otherwise a brief app-switch (checking a text, glancing
// at another app) would silently leave the screen dimming for the rest
// of the ride.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && (GpsRecorder.isRecording() || planningRoute)) {
    requestWakeLock();
  }
});

function startRecordingNow() {
  if (GpsRecorder.isRecording()) {
    openPanel("Ride in progress", `<p>You're already tracking a ride. Use the Stop &amp; Save button on the map.</p>`);
    return;
  }
  if (planningRoute) {
    openPanel("Planning in progress", `<p>You're already planning a route. Use the Finish &amp; Save or Cancel button on the map.</p>`);
    return;
  }
  try {
    GpsRecorder.start(({ points, distanceMeters }) => {
      drawLiveTrail(points);
      recordingDist.textContent = `${metersToMiles(distanceMeters).toFixed(2)} mi`;
    });
  } catch (e) {
    alert(e.message);
    return;
  }
  recordingStartedAt = Date.now();
  recordingHud.classList.remove("hidden");
  recordingTimer = setInterval(() => {
    recordingTime.textContent = formatElapsed(Date.now() - recordingStartedAt);
  }, 1000);
  window.__pendingTrailName = `Ride – ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  if (GroupBackend.enabled && session) activateSocial();
  requestWakeLock();
}

document.getElementById("btn-stop-recording").addEventListener("click", async () => {
  const result = GpsRecorder.stop();
  clearInterval(recordingTimer);
  recordingHud.classList.add("hidden");
  recordingTime.textContent = "00:00";
  recordingDist.textContent = "0.00 mi";
  releaseWakeLock();

  if (result.points.length < 2) {
    alert("Trail too short to save (need at least 2 GPS points).");
    if (liveTrailSourceId) {
      map.removeLayer(liveTrailSourceId);
      map.removeSource(liveTrailSourceId);
      liveTrailSourceId = null;
    }
    drawBreadcrumbLine(); // recording's over — un-suppress today's breadcrumb line
    return;
  }

  const savedTrailId = await TrailStore.saveTrail({
    name: window.__pendingTrailName || "Unnamed trail",
    kind: "recorded",
    points: result.points,
    distanceMeters: result.distanceMeters,
    startedAt: result.startedAt,
    endedAt: result.endedAt,
  });
  syncPersonalData().catch(() => {});
  backfillAndSaveTrailElevation(savedTrailId);

  if (liveTrailSourceId) {
    map.removeLayer(liveTrailSourceId);
    map.removeSource(liveTrailSourceId);
    liveTrailSourceId = null;
  }
  drawBreadcrumbLine(); // recording's over — un-suppress today's breadcrumb line
});

// ---------- Route planning (tap the map to lay out a route ahead of time) ----------
const planningHud = document.getElementById("planning-hud");
let planningRoute = false;
let planningPoints = [];
let planningName = "";

function totalDistanceMeters(points) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const s =
      Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    total += 2 * R * Math.asin(Math.sqrt(s));
  }
  return total;
}

function startPlanningRoute(name) {
  planningRoute = true;
  planningPoints = [];
  planningName = name;
  planningHud.classList.remove("hidden");
  updatePlanningHud();
  map.getCanvas().style.cursor = "crosshair";
  map.on("click", onPlanningMapClick);
  requestWakeLock();
}

function onPlanningMapClick(e) {
  planningPoints.push({ lat: e.lngLat.lat, lng: e.lngLat.lng, ele: null, t: Date.now() });
  drawLiveTrail(planningPoints);
  updatePlanningHud();
}

function updatePlanningHud() {
  document.getElementById("planning-count").textContent = planningPoints.length;
  document.getElementById("planning-dist").textContent = `${metersToMiles(totalDistanceMeters(planningPoints)).toFixed(2)} mi`;
}

function stopPlanningRoute() {
  planningRoute = false;
  planningHud.classList.add("hidden");
  map.getCanvas().style.cursor = "";
  map.off("click", onPlanningMapClick);
  if (liveTrailSourceId) {
    map.removeLayer(liveTrailSourceId);
    map.removeSource(liveTrailSourceId);
    liveTrailSourceId = null;
  }
  planningPoints = [];
  releaseWakeLock();
}

document.getElementById("btn-planning-undo").addEventListener("click", () => {
  planningPoints.pop();
  drawLiveTrail(planningPoints);
  if (planningPoints.length < 2 && liveTrailSourceId) {
    map.removeLayer(liveTrailSourceId);
    map.removeSource(liveTrailSourceId);
    liveTrailSourceId = null;
  }
  updatePlanningHud();
});

document.getElementById("btn-planning-cancel").addEventListener("click", () => {
  if (planningPoints.length > 0 && !confirm("Discard this planned route?")) return;
  stopPlanningRoute();
});

document.getElementById("btn-planning-finish").addEventListener("click", async () => {
  if (planningPoints.length < 2) {
    alert("Add at least 2 points before saving.");
    return;
  }
  const points = planningPoints;
  const name = planningName;
  stopPlanningRoute();
  const savedTrailId = await TrailStore.saveTrail({
    name,
    kind: "planned",
    points,
    distanceMeters: totalDistanceMeters(points),
    startedAt: null,
    endedAt: null,
  });
  syncPersonalData().catch(() => {});
  backfillAndSaveTrailElevation(savedTrailId);
  alert(`Saved "${name}" — find it under My Content.`);
});

// ---------- Custom area download ("select an area on the map") ----------
// Downloads the actual online basemap's tiles for whatever you're looking
// at — not limited to a fixed list of pre-picked regions. Works for any
// area: an ORV park, a specific trailhead, wherever. The vector trail/road
// data always comes from the streets style regardless of which basemap
// you're currently viewing (satellite is just raster imagery — no trail
// data to download from it), so this fetches ONLINE_STYLE_URL directly
// rather than reading whatever the map currently has loaded. No hardcoded
// tile host — reads whatever URL that style.json actually specifies, so
// it adapts automatically if the provider ever changes it.
let cachedStyleDoc = null;
// Throws a specific, distinguishable reason instead of a generic "offline"
// message — a weak-signal fetch failure, an HTTP error from the basemap
// server, and a style that genuinely has no vector source are three very
// different problems, and lumping them into one message makes a real bug
// indistinguishable from "you just need signal."
async function getOnlineStyleDoc() {
  if (cachedStyleDoc) return cachedStyleDoc;
  let res;
  try {
    res = await fetch(ONLINE_STYLE_URL, { cache: "no-store" });
  } catch (err) {
    throw new Error(`Couldn't reach the basemap server (${err.message}). Check your connection and try again.`);
  }
  if (!res.ok) {
    throw new Error(`Basemap server returned an error (HTTP ${res.status}). Try again in a moment.`);
  }
  try {
    cachedStyleDoc = await res.json();
  } catch (err) {
    throw new Error("Basemap server returned an unexpected response. Try again in a moment.");
  }
  return cachedStyleDoc;
}

async function getOnlineVectorTileTemplate() {
  const style = await getOnlineStyleDoc();
  for (const source of Object.values(style.sources || {})) {
    if (source.type !== "vector") continue;
    if (source.tiles && source.tiles.length) {
      return source.tiles[0];
    }
    if (source.url) {
      // Vector sources are commonly declared as a TileJSON reference (a
      // `url`) rather than an inline `tiles` array — the actual tile URL
      // template lives in that separate TileJSON document, one more
      // fetch away. Missing this was the real bug behind "no trail/road
      // data source" — not a provider-side issue, a client-side one.
      try {
        const tileJsonRes = await fetch(source.url, { cache: "no-store" });
        if (tileJsonRes.ok) {
          const tileJson = await tileJsonRes.json();
          if (tileJson.tiles && tileJson.tiles.length) {
            return tileJson.tiles[0];
          }
        }
      } catch (err) {
        // Fall through — try any other source, or the final error below.
      }
    }
  }
  throw new Error("The basemap style loaded but has no trail/road data source — this looks like a provider-side issue, not a connectivity one.");
}

// Sprite (POI/marker icons) and a base Latin glyph range (place-name
// labels) for the style — without these, tiles downloaded for offline use
// still render the trail/road geometry (that's the part that actually
// matters), but every label and icon quietly disappears the moment you
// lose signal, because MapLibre fetches them lazily on first use and
// nothing else in this app forces that "first use" to happen while
// online. Best-effort and non-fatal: a missing sprite/glyph shouldn't
// fail the whole area download over something that only affects polish.
async function cacheStyleChromeAssets(tileCache) {
  const style = await getOnlineStyleDoc();
  const puts = [];

  async function cacheUrl(url) {
    try {
      const response = await fetch(url);
      if (response.ok) await tileCache.put(url, response);
    } catch (err) {
      console.warn("Style asset fetch failed (skipping):", url, err.message);
    }
  }

  if (typeof style.sprite === "string") {
    for (const suffix of ["", "@2x"]) {
      puts.push(cacheUrl(`${style.sprite}${suffix}.json`));
      puts.push(cacheUrl(`${style.sprite}${suffix}.png`));
    }
  }

  if (typeof style.glyphs === "string") {
    // Every distinct font stack any layer actually uses, e.g. "Noto Sans
    // Regular" or "Noto Sans Italic" — MapLibre requests these joined by
    // comma. Just the 0-255 range (basic Latin + Latin-1 Supplement):
    // covers ordinary English place names/road labels, which is the vast
    // majority of what a US-southeast trail map needs; full coverage
    // would mean every 256-codepoint range for every font, hundreds of
    // requests for a benefit this app doesn't need.
    const fontStacks = new Set();
    for (const layer of style.layers || []) {
      const font = layer.layout && layer.layout["text-font"];
      if (Array.isArray(font) && font.length) fontStacks.add(font.join(","));
    }
    if (fontStacks.size === 0) fontStacks.add("Noto Sans Regular"); // sane fallback if no layer specifies one explicitly
    for (const stack of fontStacks) {
      const url = style.glyphs.replace("{fontstack}", encodeURIComponent(stack)).replace("{range}", "0-255");
      puts.push(cacheUrl(url));
    }
  }

  await Promise.all(puts);
}

function lonLatToTileXY(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return [Math.max(0, Math.min(n - 1, x)), Math.max(0, Math.min(n - 1, y))];
}

function tilesForBounds(bounds, minZoom, maxZoom) {
  const tiles = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const [x0, y1] = lonLatToTileXY(bounds.getWest(), bounds.getSouth(), z);
    const [x1, y0] = lonLatToTileXY(bounds.getEast(), bounds.getNorth(), z);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        tiles.push([z, x, y]);
      }
    }
  }
  return tiles;
}

async function downloadCustomArea(name, bounds, minZoom, maxZoom, onProgress) {
  const template = await getOnlineVectorTileTemplate(); // throws its own specific message on failure
  const tiles = tilesForBounds(bounds, minZoom, maxZoom);
  let done = 0;
  const CONCURRENCY = 8;
  let cursor = 0;
  // Write to Cache Storage directly rather than relying on the service
  // worker's own fetch interception to do it opportunistically: a service
  // worker doesn't necessarily control the page yet on a first visit (its
  // own clients.claim() call doesn't synchronously flip
  // navigator.serviceWorker.controller — confirmed in testing: `active:
  // true, controller: false` right after the very first load), so tiles
  // fetched right after a first-time page load could silently bypass
  // caching entirely. Writing directly here guarantees it regardless —
  // and it's the same cache name the SW's own fetch handler checks first,
  // so both paths share one source of truth.
  const tileCache = await caches.open("trailmark-online-tiles");
  async function worker() {
    while (cursor < tiles.length) {
      const [z, x, y] = tiles[cursor++];
      const url = template.replace("{z}", z).replace("{x}", x).replace("{y}", y);
      try {
        const response = await fetch(url);
        if (response.ok) await tileCache.put(url, response);
      } catch (err) {
        console.warn("Tile fetch failed (skipping):", url, err.message);
      }
      done++;
      if (onProgress) onProgress(done / tiles.length);
    }
  }
  await Promise.all([...Array.from({ length: CONCURRENCY }, worker), cacheStyleChromeAssets(tileCache)]);
  await CustomAreaStore.save({ name, bounds: bounds.toArray(), minZoom, maxZoom, tileCount: tiles.length });
  return tiles.length;
}

// ---------- Offline regions ----------
async function openRegionsPanel() {
  const customAreas = await CustomAreaStore.list();
  const customAreaRows = customAreas
    .map(
      (a) => `
      <div class="region-item" data-custom-name="${escHtml(a.name)}">
        <div>
          <div>${escHtml(a.name)}</div>
          <small>${a.tileCount} tiles · zoom ${a.minZoom}-${a.maxZoom} · ${new Date(a.downloadedAt).toLocaleDateString()}</small>
        </div>
        <button class="pill-btn danger" data-action="remove-custom">Remove</button>
      </div>`
    )
    .join("");

  openPanel(
    "Offline Maps",
    `
    <h4 style="margin-bottom:4px;">Download Current View</h4>
    <p style="color:var(--text-dim);font-size:13px;">
      Pan/zoom the map to the area you want (an ORV park, a trailhead, anywhere), then download
      it. Needs to be online right now to fetch the tiles.
    </p>
    <label>Name this area</label>
    <input id="custom-area-name" placeholder="e.g. Morris Mountain ORV Park" />
    <label>Detail level</label>
    <select id="custom-area-zoom" style="width:100%;margin-top:6px;padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);">
      <option value="4">Close area (fast, ~a few hundred tiles)</option>
      <option value="6" selected>Medium area (a couple minutes)</option>
      <option value="8">Wide area (slow, could be a lot of tiles)</option>
    </select>
    <button class="primary" id="download-custom-area-btn">Download This Area</button>
    ${customAreaRows}
    `
  );

  document.getElementById("download-custom-area-btn").addEventListener("click", async (e) => {
    if (!navigator.onLine) {
      alert("You need to be online to download an area.");
      return;
    }
    const name = document.getElementById("custom-area-name").value.trim();
    if (!name) {
      alert("Give this area a name first.");
      return;
    }
    const extraZoom = parseInt(document.getElementById("custom-area-zoom").value, 10);
    const bounds = map.getBounds();
    const minZoom = Math.max(0, Math.floor(map.getZoom()) - 1);
    const maxZoom = Math.min(15, minZoom + extraZoom);
    e.target.disabled = true;
    e.target.textContent = "0%";
    try {
      const count = await downloadCustomArea(name, bounds, minZoom, maxZoom, (frac) => {
        e.target.textContent = `${Math.round(frac * 100)}%`;
      });
      alert(`Downloaded "${name}" (${count} tiles). Available offline now.`);
      openRegionsPanel();
    } catch (err) {
      alert("Download failed: " + err.message);
      e.target.disabled = false;
      e.target.textContent = "Download This Area";
    }
  });

  panelBody.querySelectorAll('button[data-action="remove-custom"]').forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const name = e.target.closest(".region-item").dataset.customName;
      if (!confirm(`Remove "${name}"? You'll need to be online to re-download it.`)) return;
      await CustomAreaStore.remove(name);
      openRegionsPanel();
    });
  });
}

// ---------- Saved trails ----------
function difficultyLabel(d) {
  return d ? `Difficulty ${d}/10` : "Unrated";
}

// ---------- Elevation profile ----------
// Device GPS altitude support is spotty (see the comment in updateStatsHud),
// so a trail may have no elevation, partial elevation, or a full track of
// it. Distance is measured along the *entire* path (not just the points
// with elevation) so gaps don't skew the x-axis relative to the trail's
// real length.
function elevHaversineMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function metersToFeet(m) {
  return m * 3.28084;
}

function trailHasElevation(t) {
  const pts = t.points || [];
  let count = 0;
  for (const p of pts) {
    if (typeof p.ele === "number" && isFinite(p.ele)) {
      count++;
      if (count >= 2) return true;
    }
  }
  return false;
}

// ---------- Elevation backfill (USGS Elevation Point Query Service) ----------
// Device GPS altitude is unreliable across browsers/devices (see the
// comment in updateStatsHud) and a planned route (drawn by tapping the
// map, not GPS-tracked) has no altitude at all. Rather than a live
// per-point network lookup during recording — impractical over a
// multi-hour ride with spotty backcountry connectivity — this fills gaps
// in *after* a trail is saved: sample a modest number of points spread
// across the track from USGS's free, CORS-enabled, no-API-key Elevation
// Point Query Service (US coverage only, which matches this app's
// southeast-US scope) and linearly interpolate the rest. Best-effort:
// every failure is caught internally, so this never throws — offline or
// a flaky connection just means the trail keeps whatever elevation (if
// any) it already had, and callers don't need their own .catch().
const USGS_EPQS_URL = "https://epqs.nationalmap.gov/v1/json";
const ELEVATION_BACKFILL_MAX_SAMPLES = 60;

async function fetchUsgsElevationMeters(lat, lng) {
  const url = `${USGS_EPQS_URL}?x=${lng}&y=${lat}&units=Meters&wkid=4326&includeDate=false`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`USGS EPQS returned ${res.status}`);
  const data = await res.json();
  const meters = parseFloat(data.value);
  if (!isFinite(meters)) throw new Error("USGS EPQS returned no elevation for this point");
  return meters;
}

// Returns the trail's points with elevation filled in, or null if it
// didn't need backfilling (already had most of it) or the backfill
// couldn't get enough samples to interpolate from (offline, etc.) —
// never throws.
async function backfillTrailElevation(trail) {
  try {
    const points = trail.points;
    if (!points || points.length < 2) return null;
    const missing = points.filter((p) => typeof p.ele !== "number").length;
    if (missing / points.length < 0.5) return null; // device already gave us most of it — not worth the round trips

    const sampleCount = Math.min(ELEVATION_BACKFILL_MAX_SAMPLES, points.length);
    const sampleIndices = new Set();
    for (let i = 0; i < sampleCount; i++) {
      sampleIndices.add(Math.round((i * (points.length - 1)) / (sampleCount - 1)));
    }

    const sampledEle = new Map(); // index -> meters
    for (const idx of sampleIndices) {
      try {
        sampledEle.set(idx, await fetchUsgsElevationMeters(points[idx].lat, points[idx].lng));
      } catch (err) {
        console.warn("USGS elevation lookup failed for point", idx, err.message);
      }
      await new Promise((r) => setTimeout(r, 120)); // stay polite to a free public service
    }
    if (sampledEle.size < 2) return null; // not enough to interpolate from

    const sampledSorted = Array.from(sampledEle.keys()).sort((a, b) => a - b);
    const newPoints = points.map((p) => ({ ...p }));
    for (let s = 0; s < sampledSorted.length - 1; s++) {
      const i0 = sampledSorted[s];
      const i1 = sampledSorted[s + 1];
      const e0 = sampledEle.get(i0);
      const e1 = sampledEle.get(i1);
      for (let i = i0; i <= i1; i++) {
        const t = i1 === i0 ? 0 : (i - i0) / (i1 - i0);
        newPoints[i].ele = e0 + (e1 - e0) * t;
      }
    }
    // Points before the first sample or after the last take the nearest
    // sample's value rather than staying unset.
    const firstIdx = sampledSorted[0];
    const lastIdx = sampledSorted[sampledSorted.length - 1];
    for (let i = 0; i < firstIdx; i++) newPoints[i].ele = sampledEle.get(firstIdx);
    for (let i = lastIdx + 1; i < newPoints.length; i++) newPoints[i].ele = sampledEle.get(lastIdx);

    return newPoints;
  } catch (err) {
    console.warn("Elevation backfill failed:", err.message);
    return null;
  }
}

// Runs the backfill and, if it produced anything, persists it and pushes
// the update to the personal backup if this trail's already synced.
// Fire-and-forget safe (never throws) — call without .catch().
async function backfillAndSaveTrailElevation(trailId) {
  const trail = await TrailStore.getTrail(trailId);
  if (!trail) return;
  const newPoints = await backfillTrailElevation(trail);
  if (!newPoints) return;
  await TrailStore.updateTrailPoints(trailId, newPoints);
  if (trail.remoteId && session) {
    GroupBackend.upsertPersonalTrail({ ...trail, points: newPoints }).catch(() => {});
  }
}

// Returns { series: [{distMi, eleFt}], gainFt, lossFt, minFt, maxFt } or
// null if the trail doesn't have enough elevation samples to plot.
function buildElevationProfile(trail) {
  const points = trail.points || [];
  let cumMeters = 0;
  const series = [];
  for (let i = 0; i < points.length; i++) {
    if (i > 0) cumMeters += elevHaversineMeters(points[i - 1], points[i]);
    const ele = points[i].ele;
    if (typeof ele === "number" && isFinite(ele)) {
      series.push({ distMi: metersToMiles(cumMeters), eleFt: metersToFeet(ele) });
    }
  }
  if (series.length < 2) return null;

  let gainFt = 0;
  let lossFt = 0;
  let minFt = series[0].eleFt;
  let maxFt = series[0].eleFt;
  for (let i = 0; i < series.length; i++) {
    const eleFt = series[i].eleFt;
    if (eleFt < minFt) minFt = eleFt;
    if (eleFt > maxFt) maxFt = eleFt;
    if (i > 0) {
      const delta = eleFt - series[i - 1].eleFt;
      if (delta > 0) gainFt += delta;
      else lossFt += -delta;
    }
  }
  return { series, gainFt, lossFt, minFt, maxFt };
}

const ELEV_CHART_W = 600;
const ELEV_CHART_H = 220;
const ELEV_CHART_PAD = { l: 40, r: 12, t: 14, b: 26 };

function elevChartScales(profile) {
  const { series, minFt, maxFt } = profile;
  const plotW = ELEV_CHART_W - ELEV_CHART_PAD.l - ELEV_CHART_PAD.r;
  const plotH = ELEV_CHART_H - ELEV_CHART_PAD.t - ELEV_CHART_PAD.b;
  const distMax = series[series.length - 1].distMi || 1;
  const rangeFt = Math.max(maxFt - minFt, 10);
  const yMin = minFt - rangeFt * 0.08;
  const yMax = maxFt + rangeFt * 0.08;
  const x = (distMi) => ELEV_CHART_PAD.l + (distMi / distMax) * plotW;
  const y = (eleFt) => ELEV_CHART_PAD.t + plotH - ((eleFt - yMin) / (yMax - yMin)) * plotH;
  return { plotW, plotH, distMax, yMin, yMax, x, y };
}

function elevationProfileSvgHtml(profile) {
  const { series } = profile;
  const { plotW, plotH, distMax, yMin, yMax, x, y } = elevChartScales(profile);

  const linePath = series
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.distMi).toFixed(1)},${y(p.eleFt).toFixed(1)}`)
    .join(" ");
  const baseY = (ELEV_CHART_PAD.t + plotH).toFixed(1);
  const areaPath = `${linePath} L${x(series[series.length - 1].distMi).toFixed(1)},${baseY} L${x(0).toFixed(1)},${baseY} Z`;

  const gridCount = 4;
  let gridLines = "";
  for (let i = 0; i <= gridCount; i++) {
    const eleFt = yMin + ((yMax - yMin) * i) / gridCount;
    const gy = y(eleFt);
    gridLines += `<line x1="${ELEV_CHART_PAD.l}" y1="${gy.toFixed(1)}" x2="${ELEV_CHART_W - ELEV_CHART_PAD.r}" y2="${gy.toFixed(1)}" stroke="var(--border)" stroke-width="1" />`;
    gridLines += `<text x="${ELEV_CHART_PAD.l - 6}" y="${(gy + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--text-dim)">${Math.round(eleFt)}</text>`;
  }
  const distTicks = [0, distMax / 2, distMax];
  const distLabels = distTicks
    .map((d, i) => {
      const anchor = i === 0 ? "start" : i === distTicks.length - 1 ? "end" : "middle";
      return `<text x="${x(d).toFixed(1)}" y="${ELEV_CHART_H - 8}" text-anchor="${anchor}" font-size="10" fill="var(--text-dim)">${d.toFixed(1)} mi</text>`;
    })
    .join("");

  return `
    <div class="elev-chart-wrap">
      <svg id="elev-svg" viewBox="0 0 ${ELEV_CHART_W} ${ELEV_CHART_H}" style="width:100%;height:180px;display:block;touch-action:none;">
        ${gridLines}
        <path d="${areaPath}" fill="var(--accent-bright)" opacity="0.16" stroke="none" />
        <path d="${linePath}" fill="none" stroke="var(--accent-bright)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
        ${distLabels}
        <g id="elev-crosshair" style="display:none;">
          <line id="elev-crosshair-line" x1="0" y1="${ELEV_CHART_PAD.t}" x2="0" y2="${ELEV_CHART_PAD.t + plotH}" stroke="var(--text-dim)" stroke-width="1" stroke-dasharray="3,3" />
          <circle id="elev-crosshair-dot" r="4" fill="var(--accent-bright)" stroke="var(--panel)" stroke-width="2" />
        </g>
        <rect id="elev-hit-area" x="${ELEV_CHART_PAD.l}" y="${ELEV_CHART_PAD.t}" width="${plotW}" height="${plotH}" fill="transparent" />
      </svg>
      <div id="elev-tooltip" style="display:none;"></div>
    </div>
  `;
}

function wireElevationProfileInteraction(profile) {
  const svg = document.getElementById("elev-svg");
  const hitArea = document.getElementById("elev-hit-area");
  const crosshair = document.getElementById("elev-crosshair");
  const crosshairLine = document.getElementById("elev-crosshair-line");
  const dot = document.getElementById("elev-crosshair-dot");
  const tooltip = document.getElementById("elev-tooltip");
  if (!svg || !hitArea) return;

  const { series } = profile;
  const { distMax, x: xScale, y: yScale } = elevChartScales(profile);

  function nearestIndex(distMi) {
    let lo = 0,
      hi = series.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (series[mid].distMi < distMi) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && Math.abs(series[lo - 1].distMi - distMi) < Math.abs(series[lo].distMi - distMi)) return lo - 1;
    return lo;
  }

  function showAt(clientX) {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const svgX = ((clientX - rect.left) / rect.width) * ELEV_CHART_W;
    const distMi = Math.max(0, Math.min(distMax, ((svgX - ELEV_CHART_PAD.l) / (ELEV_CHART_W - ELEV_CHART_PAD.l - ELEV_CHART_PAD.r)) * distMax));
    const idx = nearestIndex(distMi);
    const p = series[idx];
    const cx = xScale(p.distMi);
    const cy = yScale(p.eleFt);
    crosshairLine.setAttribute("x1", cx);
    crosshairLine.setAttribute("x2", cx);
    dot.setAttribute("cx", cx);
    dot.setAttribute("cy", cy);
    crosshair.style.display = "block";

    // Local grade over a small window of samples around this point.
    const back = series[Math.max(0, idx - 2)];
    const fwd = series[Math.min(series.length - 1, idx + 2)];
    const runMi = fwd.distMi - back.distMi;
    const riseFt = fwd.eleFt - back.eleFt;
    const gradePct = runMi > 0.01 ? (riseFt / (runMi * 5280)) * 100 : 0;

    tooltip.textContent = `${p.distMi.toFixed(2)} mi · ${Math.round(p.eleFt).toLocaleString()} ft · grade ${gradePct >= 0 ? "+" : ""}${gradePct.toFixed(0)}%`;
    tooltip.style.display = "block";
  }

  function hide() {
    crosshair.style.display = "none";
    tooltip.style.display = "none";
  }

  hitArea.addEventListener("pointermove", (e) => showAt(e.clientX));
  hitArea.addEventListener("pointerdown", (e) => showAt(e.clientX));
  hitArea.addEventListener("pointerleave", hide);
}

function openElevationProfilePanel(trail) {
  const profile = buildElevationProfile(trail);
  if (!profile) {
    openPanel(
      `${trail.name} — Elevation`,
      `<p>No elevation data on this trail. GPS altitude support varies a lot by device/browser, so some rides won't have it — especially planned routes, which aren't GPS-tracked at all.</p>
      <button class="primary" id="elev-backfill-btn">Fetch Elevation from USGS</button>`
    );
    document.getElementById("elev-backfill-btn").addEventListener("click", async (e) => {
      e.target.disabled = true;
      e.target.textContent = "Fetching…";
      await backfillAndSaveTrailElevation(trail.id);
      const updated = await TrailStore.getTrail(trail.id);
      if (buildElevationProfile(updated)) {
        openElevationProfilePanel(updated);
      } else {
        e.target.disabled = false;
        e.target.textContent = "Fetch Elevation from USGS";
        alert("Couldn't get elevation data — check your connection and try again.");
      }
    });
    return;
  }
  const { gainFt, lossFt, minFt, maxFt } = profile;
  openPanel(
    `${trail.name} — Elevation`,
    `
    <div class="elev-stats">
      <div class="elev-stat"><div class="elev-stat-value">${Math.round(gainFt).toLocaleString()}</div><div class="elev-stat-label">Gain (ft)</div></div>
      <div class="elev-stat"><div class="elev-stat-value">${Math.round(lossFt).toLocaleString()}</div><div class="elev-stat-label">Loss (ft)</div></div>
      <div class="elev-stat"><div class="elev-stat-value">${Math.round(maxFt).toLocaleString()}</div><div class="elev-stat-label">Max (ft)</div></div>
      <div class="elev-stat"><div class="elev-stat-value">${Math.round(minFt).toLocaleString()}</div><div class="elev-stat-label">Min (ft)</div></div>
    </div>
    ${elevationProfileSvgHtml(profile)}
    `
  );
  wireElevationProfileInteraction(profile);
}

async function openTrailsPanel() {
  const trails = await TrailStore.listTrails();
  const waypoints = await WaypointStore.listWaypoints();
  const tripFolders = await TripFolderStore.listFolders();
  const folderNameById = new Map(tripFolders.map((f) => [f.id, f.name]));
  const breadcrumbCount = await BreadcrumbStore.count();
  const breadcrumbRows = rebuildBreadcrumbRows();
  const rows = trails
    .map(
      (t) => `
      <div class="trail-item" data-id="${t.id}" data-search="${escHtml(t.name.toLowerCase())}">
        <div>
          <div>${escHtml(t.name)} <small style="color:var(--text-dim);">${t.kind === "planned" ? "(planned)" : t.kind === "imported" ? "(imported)" : "(recorded)"}</small>${
            t.folderId && folderNameById.has(t.folderId) ? ` <small style="color:var(--accent-bright);">📁 ${escHtml(folderNameById.get(t.folderId))}</small>` : ""
          }</div>
          <small>${metersToMiles(t.distanceMeters).toFixed(2)} mi · ${difficultyLabel(t.difficulty)} · ${new Date(t.createdAt).toLocaleDateString()}</small>
        </div>
        <div>
          <button class="pill-btn" data-action="show">Show</button>
          <button class="pill-btn" data-action="profile">${trailHasElevation(t) ? "Profile" : "Elevation"}</button>
          <button class="pill-btn" data-action="rename">Rename</button>
          <button class="pill-btn" data-action="rate">Rate</button>
          <button class="pill-btn" data-action="export">GPX</button>
          ${session ? '<button class="pill-btn" data-action="share">Share</button>' : ""}
          <button class="pill-btn danger" data-action="delete">Delete</button>
        </div>
      </div>`
    )
    .join("");
  const waypointRows = waypoints
    .map(
      (wp) => `
      <div class="trail-item" data-wp-id="${wp.id}" data-search="${escHtml(wp.name.toLowerCase())}">
        <div>
          <div>${escHtml(wp.name)} <small style="color:var(--text-dim);">(${CATEGORY_LABELS[wp.category] || "Other"})</small>${
            wp.severity ? ` <small style="color:${SEVERITY_COLORS[wp.severity]};font-weight:700;">⚠ ${SEVERITY_LABELS[wp.severity]}</small>` : ""
          }${
            wp.folderId && folderNameById.has(wp.folderId) ? ` <small style="color:var(--accent-bright);">📁 ${escHtml(folderNameById.get(wp.folderId))}</small>` : ""
          }</div>
          <small>${new Date(wp.createdAt).toLocaleDateString()}</small>
        </div>
        <div>
          <button class="pill-btn" data-action="show">Show</button>
          <button class="pill-btn" data-action="rename">Rename</button>
          <button class="pill-btn" data-action="export">GPX</button>
          <button class="pill-btn danger" data-action="delete">Delete</button>
        </div>
      </div>`
    )
    .join("");

  openPanel(
    "My Content",
    `
    ${
      trails.length + waypoints.length > 0
        ? `<input type="search" id="content-search" placeholder="Search trails & waypoints…" style="margin-bottom:12px;" />`
        : ""
    }
    <h4 style="margin-bottom:4px;">Trails &amp; Routes</h4>
    <div id="trail-rows">${rows || "<p>No saved trails yet. Tap Go to track one.</p>"}</div>
    <h4 style="margin-bottom:4px;margin-top:14px;">Waypoints</h4>
    <div id="waypoint-rows">${waypointRows || "<p>No waypoints dropped yet.</p>"}</div>

    <h4 style="margin-bottom:4px;margin-top:20px;color:var(--text-dim);">Manage</h4>
    <div class="region-item">
      <div><div>Import GPX</div><small>From onX, Gaia, AllTrails, or a GPS unit — brings in the track and any waypoints</small></div>
      <button class="pill-btn" id="import-gpx-btn">Import</button>
    </div>
    <input type="file" id="import-gpx-input" accept=".gpx,application/gpx+xml" style="display:none;" />
    <div class="region-item">
      <div><div>Breadcrumb Trail</div><small>${breadcrumbCount} pts — automatic background location history, separate from the trails above</small></div>
      <button class="pill-btn" id="open-breadcrumb-btn">Manage</button>
    </div>
    <div class="region-item">
      <div><div>Trip Folders</div><small>Group your own trails/waypoints into a trip — stays on this device</small></div>
      <button class="pill-btn" id="open-personal-folders-btn">Manage</button>
    </div>
    `
  );
  const contentSearch = document.getElementById("content-search");
  if (contentSearch) {
    contentSearch.addEventListener("input", () => {
      const q = contentSearch.value.trim().toLowerCase();
      panelBody.querySelectorAll(".trail-item[data-search]").forEach((el) => {
        el.style.display = !q || el.dataset.search.includes(q) ? "" : "none";
      });
    });
  }
  document.getElementById("open-personal-folders-btn").addEventListener("click", openPersonalFoldersPanel);
  document.getElementById("open-breadcrumb-btn").addEventListener("click", () => openBreadcrumbPanel(breadcrumbCount, breadcrumbRows));
  document.getElementById("import-gpx-btn").addEventListener("click", () => {
    document.getElementById("import-gpx-input").click();
  });
  document.getElementById("import-gpx-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      await importGpxFile(file);
    } catch (err) {
      alert("Couldn't import that GPX file: " + err.message);
    }
    openTrailsPanel();
  });

  panelBody.querySelectorAll(".trail-item[data-id] button").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const id = Number(e.target.closest(".trail-item").dataset.id);
      const action = e.target.dataset.action;
      if (action === "delete") {
        const trail = await TrailStore.getTrail(id);
        if (!confirm(`Delete "${trail.name}"?`)) return;
        await TrailStore.deleteTrail(id);
        openTrailsPanel();
        // Best-effort: if this was never backed up (not signed in, or
        // sync hasn't run yet), there's nothing remote to remove, and a
        // failure here (offline) just means the remote copy outlives the
        // local delete until the next sync — acceptable for a backup, see
        // syncPersonalData()'s comment.
        if (trail.remoteId && session) GroupBackend.deletePersonalTrail(trail.remoteId).catch(() => {});
        showUndoToast(`Deleted "${trail.name}"`, async () => {
          await TrailStore.restoreTrail(trail);
          openTrailsPanel();
          if (trail.remoteId && session) GroupBackend.upsertPersonalTrail(trail).catch(() => {});
        });
      } else if (action === "rename") {
        const trail = await TrailStore.getTrail(id);
        const name = prompt("Rename trail:", trail.name);
        if (name === null || !name.trim()) return;
        await TrailStore.renameTrail(id, name.trim());
        openTrailsPanel();
        if (trail.remoteId && session) GroupBackend.upsertPersonalTrail({ ...trail, name: name.trim() }).catch(() => {});
      } else if (action === "rate") {
        const trail = await TrailStore.getTrail(id);
        const input = prompt("Technical difficulty, 1 (easy) to 10 (extreme). Leave blank to clear.");
        if (input === null) return;
        const value = input.trim() === "" ? null : Math.max(1, Math.min(10, parseInt(input, 10) || 0));
        await TrailStore.setDifficulty(id, value);
        openTrailsPanel();
        if (trail.remoteId && session) GroupBackend.upsertPersonalTrail({ ...trail, difficulty: value }).catch(() => {});
      } else if (action === "export") {
        const trail = await TrailStore.getTrail(id);
        downloadFile(`${trail.name.replace(/[^a-z0-9]+/gi, "-")}.gpx`, trailToGpx(trail), "application/gpx+xml");
      } else if (action === "profile") {
        const trail = await TrailStore.getTrail(id);
        openElevationProfilePanel(trail);
      } else if (action === "share") {
        const trail = await TrailStore.getTrail(id);
        try {
          await GroupBackend.addTrail({
            name: trail.name,
            kind: trail.kind,
            points: trail.points,
            distanceMeters: trail.distanceMeters,
            difficulty: trail.difficulty,
          });
          alert(`Shared "${trail.name}" with the crew.`);
        } catch (err) {
          alert("Could not share trail: " + err.message);
        }
      } else {
        const trail = await TrailStore.getTrail(id);
        showTrailOnMap(trail);
        closePanel();
      }
    });
  });

  panelBody.querySelectorAll(".trail-item[data-wp-id] button").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const id = Number(e.target.closest(".trail-item").dataset.wpId);
      const action = e.target.dataset.action;
      if (action === "delete") {
        const wp = await WaypointStore.getWaypoint(id);
        if (!confirm(`Delete "${wp.name}"?`)) return;
        await WaypointStore.deleteWaypoint(id);
        await refreshWaypointMarkers();
        openTrailsPanel();
        if (wp.remoteId && session) GroupBackend.deletePersonalWaypoint(wp.remoteId).catch(() => {});
        showUndoToast(`Deleted "${wp.name}"`, async () => {
          await WaypointStore.restoreWaypoint(wp);
          await refreshWaypointMarkers();
          openTrailsPanel();
          if (wp.remoteId && session) GroupBackend.upsertPersonalWaypoint(wp).catch(() => {});
        });
      } else if (action === "rename") {
        const wp = await WaypointStore.getWaypoint(id);
        const name = prompt("Rename waypoint:", wp.name);
        if (name === null || !name.trim()) return;
        await WaypointStore.updateWaypoint(id, { name: name.trim(), note: wp.note, category: wp.category, severity: wp.severity });
        await refreshWaypointMarkers();
        openTrailsPanel();
        if (wp.remoteId && session) GroupBackend.upsertPersonalWaypoint({ ...wp, name: name.trim() }).catch(() => {});
      } else if (action === "export") {
        const wp = await WaypointStore.getWaypoint(id);
        downloadFile(`${wp.name.replace(/[^a-z0-9]+/gi, "-")}.gpx`, waypointToGpx(wp), "application/gpx+xml");
      } else {
        const wp = await WaypointStore.getWaypoint(id);
        map.flyTo({ center: [wp.lng, wp.lat], zoom: 15 });
        closePanel();
      }
    });
  });
}

// ---------- Breadcrumb trail (background location history) ----------
// Its own panel rather than always-expanded inline in My Content — the
// per-day color/rename/hide legend was competing for space with (and
// visually resembling) actual saved trails, which is what made it read
// as unclear clutter rather than a distinct feature. breadcrumbCount/
// breadcrumbRows are passed in already computed by the caller
// (openTrailsPanel) rather than recomputed here, since both need the
// exact same data and there's no reason to query it twice.
function openBreadcrumbPanel(breadcrumbCount, breadcrumbRows) {
  openPanel(
    "Breadcrumb Trail",
    `
    <p style="color:var(--text-dim);font-size:13px;">
      Logged automatically in the background any time the app is open and has a location fix — not something you start
      or name yourself, and separate from the trails you explicitly record with Go &amp; Track. Useful for seeing
      everywhere you've been at a glance, grouped here by day.
    </p>
    <div class="region-item">
      <div><div>${breadcrumbCount} points logged</div><small>Clear erases this background history — your saved trails and waypoints aren't affected</small></div>
      <button class="pill-btn danger" id="clear-breadcrumb-btn">Clear</button>
    </div>
    ${breadcrumbRows || '<p style="color:var(--text-dim);font-size:13px;">No days logged yet.</p>'}
    <button class="primary" id="back-to-content-from-breadcrumb-btn" style="background:var(--panel);border:1px solid var(--border);margin-top:12px;">Back</button>
    `
  );
  document.getElementById("clear-breadcrumb-btn").addEventListener("click", async () => {
    if (!confirm(`Clear all ${breadcrumbCount} breadcrumb points? This can't be undone.`)) return;
    await clearBreadcrumbTrail();
    openTrailsPanel();
  });
  document.getElementById("back-to-content-from-breadcrumb-btn").addEventListener("click", openTrailsPanel);
  panelBody.querySelectorAll(".breadcrumb-day-color").forEach((input) => {
    input.addEventListener("input", (e) => {
      setBreadcrumbDayColor(e.target.dataset.day, e.target.value);
      drawBreadcrumbLine();
    });
  });
  panelBody.querySelectorAll(".breadcrumb-day-toggle").forEach((btn) => {
    btn.addEventListener("click", async () => {
      toggleBreadcrumbDayVisible(btn.dataset.day);
      drawBreadcrumbLine();
      // Re-render with fresh counts/rows rather than re-opening My
      // Content and losing the user's place in this panel.
      openBreadcrumbPanel(await BreadcrumbStore.count(), rebuildBreadcrumbRows());
    });
  });
  panelBody.querySelectorAll(".breadcrumb-day-rename").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const dayKey = btn.dataset.day;
      const current = breadcrumbDayPrefs[dayKey]?.name || "";
      const name = prompt(`Rename ${breadcrumbDayDateLabel(dayKey)}'s breadcrumb trail (leave blank to just show the date):`, current);
      if (name === null) return; // cancelled
      setBreadcrumbDayName(dayKey, name);
      openBreadcrumbPanel(await BreadcrumbStore.count(), rebuildBreadcrumbRows());
    });
  });
}

// Shared by openTrailsPanel (initial render) and openBreadcrumbPanel
// (re-render after a toggle/rename, without navigating back to My
// Content first) — same HTML generation either way.
function rebuildBreadcrumbRows() {
  const breadcrumbByDay = breadcrumbPointsByDay();
  const breadcrumbEntries = Array.from(breadcrumbByDay.entries()).reverse();
  return breadcrumbEntries
    .map(([dayKey, points], reverseIndex) => {
      const i = breadcrumbEntries.length - 1 - reverseIndex;
      const color = breadcrumbDayColor(dayKey, i);
      const visible = isBreadcrumbDayVisible(dayKey);
      const label = breadcrumbDayLabel(dayKey);
      const dateStr = breadcrumbDayDateLabel(dayKey);
      const timeStr = breadcrumbDayTimeRange(points);
      return `
      <div class="trail-item" data-breadcrumb-day="${dayKey}">
        <div style="display:flex;align-items:center;gap:8px;min-width:0;">
          <input type="color" class="breadcrumb-day-color" data-day="${dayKey}" value="${color}" title="Change this day's color" style="width:18px;height:18px;flex:none;padding:0;border:none;border-radius:50%;background:none;cursor:pointer;" />
          <div style="min-width:0;">
            <div class="breadcrumb-day-label" style="${visible ? "" : "color:var(--text-dim);text-decoration:line-through;"}">${escHtml(label)} <small style="color:var(--text-dim);">(${points.length} pts)</small></div>
            <small>${escHtml(dateStr)}${timeStr ? " · " + escHtml(timeStr) : ""}</small>
          </div>
        </div>
        <div>
          <button class="pill-btn breadcrumb-day-toggle" data-day="${dayKey}">${visible ? "Hide" : "Show"}</button>
          <button class="pill-btn breadcrumb-day-rename" data-day="${dayKey}">Rename</button>
        </div>
      </div>`;
    })
    .join("");
}

// ---------- Personal trip folders (local-only grouping of My Content) ----------
// Mirrors the shared/crew trip-folders UI (openFoldersPanel/
// openFolderDetailPanel below) but backed by TripFolderStore — local
// IndexedDB, never synced, since this is purely an on-device organizing
// tool rather than data worth backing up.
async function openPersonalFoldersPanel() {
  const folders = await TripFolderStore.listFolders();
  const [trails, waypoints] = await Promise.all([TrailStore.listTrails(), WaypointStore.listWaypoints()]);
  const countInFolder = (id) => trails.filter((t) => t.folderId === id).length + waypoints.filter((w) => w.folderId === id).length;

  const rows = folders
    .map(
      (f) => `<div class="region-item" data-id="${f.id}">
        <div><div>${escHtml(f.name)}</div><small>${countInFolder(f.id)} item${countInFolder(f.id) === 1 ? "" : "s"}</small></div>
        <button class="pill-btn" data-action="open">Open</button>
      </div>`
    )
    .join("");

  openPanel(
    "Trip Folders",
    `
    ${rows || '<p style="color:var(--text-dim);font-size:13px;">No trip folders yet.</p>'}
    <label>New folder name</label>
    <input id="new-personal-folder-name" placeholder="e.g. Windrock weekend" />
    <button class="primary" id="create-personal-folder-btn">Create Folder</button>
    <button class="primary" id="back-to-content-btn" style="background:var(--panel);border:1px solid var(--border);margin-top:12px;">Back</button>
    `
  );
  panelBody.querySelectorAll('.region-item button[data-action="open"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.closest(".region-item").dataset.id);
      const folder = folders.find((f) => f.id === id);
      openPersonalFolderDetailPanel(folder);
    });
  });
  document.getElementById("create-personal-folder-btn").addEventListener("click", async () => {
    const name = document.getElementById("new-personal-folder-name").value.trim();
    if (!name) return;
    await TripFolderStore.createFolder(name);
    openPersonalFoldersPanel();
  });
  document.getElementById("back-to-content-btn").addEventListener("click", openTrailsPanel);
}

async function openPersonalFolderDetailPanel(folder) {
  const [trails, waypoints] = await Promise.all([TrailStore.listTrails(), WaypointStore.listWaypoints()]);
  const inFolder = { trails: trails.filter((t) => t.folderId === folder.id), waypoints: waypoints.filter((w) => w.folderId === folder.id) };
  const unassigned = { trails: trails.filter((t) => !t.folderId), waypoints: waypoints.filter((w) => !w.folderId) };

  const trailRows = inFolder.trails
    .map(
      (t) => `<div class="trail-item" data-remove-trail="${t.id}">
        <div>🛣️ ${escHtml(t.name)} <small style="color:var(--text-dim);">${metersToMiles(t.distanceMeters).toFixed(1)} mi</small></div>
        <button class="pill-btn" data-action="remove">Remove</button>
      </div>`
    )
    .join("");
  const wpRows = inFolder.waypoints
    .map(
      (w) => `<div class="trail-item" data-remove-wp="${w.id}">
        <div>📍 ${escHtml(w.name)}</div>
        <button class="pill-btn" data-action="remove">Remove</button>
      </div>`
    )
    .join("");

  openPanel(
    escHtml(folder.name),
    `
    <h4 style="margin-bottom:4px;">Trails / Routes</h4>
    ${trailRows || '<p style="color:var(--text-dim);font-size:12px;">None yet.</p>'}
    ${
      unassigned.trails.length
        ? `<select id="add-personal-trail-select" style="width:100%;margin-top:6px;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);">
      <option value="">Add an existing trail...</option>
      ${unassigned.trails.map((t) => `<option value="${t.id}">${escHtml(t.name)}</option>`).join("")}
    </select>`
        : ""
    }
    <h4 style="margin-bottom:4px;margin-top:14px;">Waypoints</h4>
    ${wpRows || '<p style="color:var(--text-dim);font-size:12px;">None yet.</p>'}
    ${
      unassigned.waypoints.length
        ? `<select id="add-personal-wp-select" style="width:100%;margin-top:6px;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);">
      <option value="">Add an existing waypoint...</option>
      ${unassigned.waypoints.map((w) => `<option value="${w.id}">${escHtml(w.name)}</option>`).join("")}
    </select>`
        : ""
    }
    <label style="margin-top:16px;">Rename folder</label>
    <input id="rename-personal-folder-name" value="${escHtml(folder.name)}" />
    <button class="primary" id="rename-personal-folder-btn" style="background:var(--panel);border:1px solid var(--border);">Rename</button>
    <button class="primary" id="delete-personal-folder-btn" style="background:var(--danger);border:none;margin-top:8px;">Delete Folder</button>
    <button class="primary" id="back-to-personal-folders-btn" style="background:var(--panel);border:1px solid var(--border);margin-top:8px;">Back to Folders</button>
    `
  );
  document.getElementById("add-personal-trail-select")?.addEventListener("change", async (e) => {
    if (!e.target.value) return;
    await TrailStore.assignFolder(Number(e.target.value), folder.id);
    openPersonalFolderDetailPanel(folder);
  });
  document.getElementById("add-personal-wp-select")?.addEventListener("change", async (e) => {
    if (!e.target.value) return;
    await WaypointStore.assignFolder(Number(e.target.value), folder.id);
    openPersonalFolderDetailPanel(folder);
  });
  panelBody.querySelectorAll('[data-remove-trail] button[data-action="remove"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.closest("[data-remove-trail]").dataset.removeTrail);
      await TrailStore.assignFolder(id, null);
      openPersonalFolderDetailPanel(folder);
    });
  });
  panelBody.querySelectorAll('[data-remove-wp] button[data-action="remove"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.closest("[data-remove-wp]").dataset.removeWp);
      await WaypointStore.assignFolder(id, null);
      openPersonalFolderDetailPanel(folder);
    });
  });
  document.getElementById("rename-personal-folder-btn").addEventListener("click", async () => {
    const name = document.getElementById("rename-personal-folder-name").value.trim();
    if (!name) return;
    await TripFolderStore.renameFolder(folder.id, name);
    openPersonalFolderDetailPanel({ ...folder, name });
  });
  document.getElementById("delete-personal-folder-btn").addEventListener("click", async () => {
    if (!confirm(`Delete "${folder.name}"? Trails and waypoints inside stay put, just un-grouped.`)) return;
    await TripFolderStore.deleteFolder(folder.id);
    openPersonalFoldersPanel();
  });
  document.getElementById("back-to-personal-folders-btn").addEventListener("click", openPersonalFoldersPanel);
}

// ---------- Vehicle maintenance (private — no shared/crew variant) ----------
const MAINTENANCE_TYPE_LABELS = {
  oil_change: "Oil Change",
  tire_rotation: "Tire Rotation",
  brakes: "Brakes",
  fluids: "Fluids",
  battery: "Battery",
  filters: "Filters",
  inspection: "Inspection",
  repair: "Repair",
  other: "Other",
};

function maintenanceTypeOptionsHtml(selected) {
  return MAINTENANCE_TYPES.map((t) => `<option value="${t}" ${t === selected ? "selected" : ""}>${MAINTENANCE_TYPE_LABELS[t]}</option>`).join("");
}

function vehicleLabel(v) {
  const ymm = [v.year, v.make, v.model].filter(Boolean).join(" ");
  return ymm ? `${v.name} (${ymm})` : v.name;
}

// Reconstructs a Blob from a maintenance record's locally-stored receipt
// bytes — same ArrayBuffer-not-Blob pattern as PhotoStore, see its
// comment for why. Returns null if this record has no local receipt
// (either never had one, or it was pulled from another device and only
// exists in the private storage bucket — see openMaintenanceRecordPanel
// for fetching that case).
function localReceiptBlob(record) {
  if (!record.receiptData) return null;
  return new Blob([record.receiptData], { type: record.receiptType || "image/jpeg" });
}

async function openVehiclesPanel() {
  const vehicles = await VehicleStore.listVehicles();
  const counts = {};
  for (const v of vehicles) counts[v.id] = (await MaintenanceStore.listRecordsForVehicle(v.id)).length;

  const rows = vehicles
    .map(
      (v) => `<div class="region-item" data-id="${v.id}">
        <div><div>${escHtml(v.name)}</div><small>${escHtml([v.year, v.make, v.model].filter(Boolean).join(" ")) || "&nbsp;"}${
          v.odometer ? ` · ${v.odometer.toLocaleString()} mi` : ""
        } · ${counts[v.id]} record${counts[v.id] === 1 ? "" : "s"}</small></div>
        <button class="pill-btn" data-action="open">Open</button>
      </div>`
    )
    .join("");

  openPanel(
    "Vehicles",
    `
    <p style="color:var(--text-dim);font-size:13px;">Private to you — vehicles, maintenance history, and receipts, never shared with the crew.</p>
    ${rows || '<p style="color:var(--text-dim);font-size:13px;">No vehicles yet.</p>'}
    <button class="primary" id="add-vehicle-btn">Add Vehicle</button>
    `
  );
  panelBody.querySelectorAll('.region-item button[data-action="open"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.closest(".region-item").dataset.id);
      openVehicleDetailPanel(await VehicleStore.getVehicle(id));
    });
  });
  document.getElementById("add-vehicle-btn").addEventListener("click", () => openVehicleFormPanel(null));
}

// existingVehicle: null to add, or a vehicle record to edit.
function openVehicleFormPanel(existingVehicle) {
  const v = existingVehicle || { name: "", year: "", make: "", model: "", odometer: "" };
  openPanel(
    existingVehicle ? "Edit Vehicle" : "Add Vehicle",
    `
    <label>Name</label>
    <input id="veh-name" placeholder="e.g. The Wrangler" value="${escHtml(v.name)}" />
    <label>Year</label>
    <input id="veh-year" type="number" placeholder="e.g. 2018" value="${v.year || ""}" />
    <label>Make</label>
    <input id="veh-make" placeholder="e.g. Jeep" value="${escHtml(v.make || "")}" />
    <label>Model</label>
    <input id="veh-model" placeholder="e.g. Wrangler Rubicon" value="${escHtml(v.model || "")}" />
    <label>Current odometer (mi, optional)</label>
    <input id="veh-odometer" type="number" placeholder="e.g. 62000" value="${v.odometer || ""}" />
    <button class="primary" id="veh-save-btn">${existingVehicle ? "Save Changes" : "Add Vehicle"}</button>
    `
  );
  document.getElementById("veh-save-btn").addEventListener("click", async () => {
    const name = document.getElementById("veh-name").value.trim();
    if (!name) {
      alert("Give this vehicle a name.");
      return;
    }
    const year = parseInt(document.getElementById("veh-year").value, 10) || null;
    const make = document.getElementById("veh-make").value.trim();
    const model = document.getElementById("veh-model").value.trim();
    const odometer = parseInt(document.getElementById("veh-odometer").value, 10) || null;
    if (existingVehicle) {
      await VehicleStore.updateVehicle(existingVehicle.id, { name, year, make, model, odometer });
      const updated = await VehicleStore.getVehicle(existingVehicle.id);
      if (updated.remoteId && session) GroupBackend.upsertPersonalVehicle(updated).catch(() => {});
      openVehicleDetailPanel(updated);
    } else {
      await VehicleStore.saveVehicle({ name, year, make, model, odometer });
      syncPersonalData().catch(() => {});
      openVehiclesPanel();
    }
  });
}

async function openVehicleDetailPanel(vehicle) {
  const records = await MaintenanceStore.listRecordsForVehicle(vehicle.id);
  const rows = records
    .map(
      (r) => `<div class="trail-item" data-id="${r.id}">
        <div>
          <div>${MAINTENANCE_TYPE_LABELS[r.type] || "Other"}${r.receiptData || r.receiptRemotePath ? " 🧾" : ""}</div>
          <small>${new Date(r.date).toLocaleDateString()}${typeof r.miles === "number" ? ` · ${r.miles.toLocaleString()} mi` : ""}${
            typeof r.cost === "number" ? ` · $${r.cost.toFixed(2)}` : ""
          }${r.note ? ` · ${escHtml(r.note)}` : ""}</small>
          ${
            r.reminderDate
              ? `<small style="display:block;color:${r.reminderDate <= Date.now() ? "var(--danger)" : "var(--accent-bright)"};">${maintenanceReminderText(r)}</small>`
              : ""
          }
        </div>
        <div>
          <button class="pill-btn" data-action="view">View</button>
          <button class="pill-btn danger" data-action="delete">Delete</button>
        </div>
      </div>`
    )
    .join("");

  openPanel(
    vehicleLabel(vehicle),
    `
    <div class="region-item">
      <div><div>Odometer</div><small>${vehicle.odometer ? `${vehicle.odometer.toLocaleString()} mi` : "Not set"}</small></div>
      <button class="pill-btn" id="edit-vehicle-btn">Edit</button>
    </div>
    <button class="primary" id="log-maintenance-btn" style="margin-top:12px;">Log Maintenance</button>
    <h4 style="margin-bottom:4px;margin-top:14px;">History</h4>
    ${rows || '<p style="color:var(--text-dim);font-size:13px;">No maintenance logged yet.</p>'}
    <button class="primary" id="delete-vehicle-btn" style="background:var(--danger);border:none;margin-top:16px;">Delete Vehicle</button>
    <button class="primary" id="back-to-vehicles-btn" style="background:var(--panel);border:1px solid var(--border);margin-top:8px;">Back to Vehicles</button>
    `
  );
  document.getElementById("edit-vehicle-btn").addEventListener("click", () => openVehicleFormPanel(vehicle));
  document.getElementById("log-maintenance-btn").addEventListener("click", () => openMaintenanceRecordFormPanel(vehicle, null));
  document.getElementById("back-to-vehicles-btn").addEventListener("click", openVehiclesPanel);
  document.getElementById("delete-vehicle-btn").addEventListener("click", async () => {
    if (!confirm(`Delete "${vehicle.name}" and its entire maintenance history? This can't be undone.`)) return;
    if (vehicle.remoteId && session) GroupBackend.deletePersonalVehicle(vehicle.remoteId).catch(() => {});
    await VehicleStore.deleteVehicle(vehicle.id);
    openVehiclesPanel();
  });
  panelBody.querySelectorAll('.trail-item[data-id] button').forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const id = Number(btn.closest(".trail-item").dataset.id);
      const record = await MaintenanceStore.getRecord(id);
      if (e.target.dataset.action === "delete") {
        if (!confirm(`Delete this ${MAINTENANCE_TYPE_LABELS[record.type] || "Other"} record?`)) return;
        await MaintenanceStore.deleteRecord(id);
        openVehicleDetailPanel(vehicle);
        if (record.remoteId && session) GroupBackend.deletePersonalMaintenanceRecord(record.remoteId).catch(() => {});
        showUndoToast(`Deleted ${MAINTENANCE_TYPE_LABELS[record.type] || "Other"} record`, async () => {
          await MaintenanceStore.restoreRecord(record);
          openVehicleDetailPanel(vehicle);
          if (record.remoteId && session) {
            const v = await VehicleStore.getVehicle(vehicle.id);
            if (v.remoteId) GroupBackend.upsertPersonalMaintenanceRecord(record, v.remoteId).catch(() => {});
          }
        });
      } else {
        openMaintenanceRecordPanel(vehicle, record);
      }
    });
  });
}

// existingRecord: null to add, or a record to edit (receipt itself isn't
// editable in place — see MaintenanceStore.updateRecord's comment).
// Local date components, not toISOString() (which is UTC and can show
// the wrong calendar day in the evening in US timezones).
function dateInputValue(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function openMaintenanceRecordFormPanel(vehicle, existingRecord) {
  const r = existingRecord || { type: "other", date: Date.now(), miles: "", cost: "", note: "", reminderDate: null };
  const dateStr = dateInputValue(r.date);
  openPanel(
    existingRecord ? "Edit Maintenance" : "Log Maintenance",
    `
    <label>Type</label>
    <select id="maint-type" style="width:100%;margin-top:6px;padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);">
      ${maintenanceTypeOptionsHtml(r.type)}
    </select>
    <label>Date</label>
    <input id="maint-date" type="date" value="${dateStr}" />
    <label>Odometer (mi, optional)</label>
    <input id="maint-miles" type="number" placeholder="e.g. 62000" value="${r.miles || ""}" />
    <label>Cost (optional)</label>
    <input id="maint-cost" type="number" step="0.01" placeholder="e.g. 89.99" value="${r.cost || ""}" />
    <label>Note (optional)</label>
    <textarea id="maint-note" rows="2" placeholder="Synthetic 5W-30, rotated tires too...">${escHtml(r.note || "")}</textarea>
    ${
      existingRecord
        ? ""
        : `<label>Receipt photo (optional)</label>
           <input type="file" id="maint-receipt" accept="image/*" capture="environment" />`
    }
    <label>Remind me</label>
    <select id="maint-reminder-preset" style="width:100%;margin-top:6px;padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);">
      <option value="">No reminder</option>
      <option value="3">In 3 months</option>
      <option value="6">In 6 months</option>
      <option value="12">In 1 year</option>
      <option value="custom" ${r.reminderDate ? "selected" : ""}>Custom date…</option>
    </select>
    <input id="maint-reminder-date" type="date" value="${r.reminderDate ? dateInputValue(r.reminderDate) : ""}" style="${r.reminderDate ? "" : "display:none;"}" />
    <p style="color:var(--text-dim);font-size:12px;margin-top:4px;">
      This app can't send a notification while it's closed — you'll see a reminder the next time you open it on or after this date.
    </p>
    <button class="primary" id="maint-save-btn">${existingRecord ? "Save Changes" : "Save Record"}</button>
    `
  );
  document.getElementById("maint-reminder-preset").addEventListener("change", (e) => {
    document.getElementById("maint-reminder-date").style.display = e.target.value === "custom" ? "" : "none";
  });
  document.getElementById("maint-save-btn").addEventListener("click", async () => {
    const type = document.getElementById("maint-type").value;
    const dateVal = document.getElementById("maint-date").value;
    const date = dateVal ? new Date(dateVal + "T12:00:00").getTime() : Date.now();
    const miles = parseInt(document.getElementById("maint-miles").value, 10);
    const cost = parseFloat(document.getElementById("maint-cost").value);
    const note = document.getElementById("maint-note").value.trim();

    const presetVal = document.getElementById("maint-reminder-preset").value;
    let reminderDate = null;
    if (presetVal === "custom") {
      const rd = document.getElementById("maint-reminder-date").value;
      reminderDate = rd ? new Date(rd + "T12:00:00").getTime() : null;
    } else if (presetVal) {
      const base = new Date(date); // counts from the service date, not "today"
      base.setMonth(base.getMonth() + parseInt(presetVal, 10));
      reminderDate = base.getTime();
    }
    if (reminderDate) await ensureNotificationPermissionRequested();

    if (existingRecord) {
      await MaintenanceStore.updateRecord(existingRecord.id, {
        type,
        date,
        miles: isFinite(miles) ? miles : null,
        cost: isFinite(cost) ? cost : null,
        note,
        reminderDate,
      });
      const updated = await MaintenanceStore.getRecord(existingRecord.id);
      if (updated.remoteId && session) {
        const v = await VehicleStore.getVehicle(vehicle.id);
        if (v.remoteId) GroupBackend.upsertPersonalMaintenanceRecord(updated, v.remoteId).catch(() => {});
      }
    } else {
      const receiptInput = document.getElementById("maint-receipt");
      const receipt = receiptInput && receiptInput.files[0] ? receiptInput.files[0] : null;
      await MaintenanceStore.saveRecord({
        vehicleId: vehicle.id,
        type,
        date,
        miles: isFinite(miles) ? miles : null,
        cost: isFinite(cost) ? cost : null,
        note,
        receipt,
        reminderDate,
      });
      // Logging a service is the most common moment you'd actually know
      // the current mileage — keep the vehicle's odometer in step rather
      // than making that a separate manual edit.
      if (isFinite(miles) && miles > (vehicle.odometer || 0)) {
        await VehicleStore.updateVehicle(vehicle.id, { ...vehicle, odometer: miles });
        vehicle = await VehicleStore.getVehicle(vehicle.id);
      }
      syncPersonalData().catch(() => {});
    }
    openVehicleDetailPanel(vehicle);
  });
}

async function openMaintenanceRecordPanel(vehicle, record) {
  let receiptUrl = null;
  const localBlob = localReceiptBlob(record);
  if (localBlob) {
    receiptUrl = URL.createObjectURL(localBlob);
  } else if (record.receiptRemotePath && GroupBackend.enabled && session) {
    try {
      receiptUrl = await GroupBackend.maintenanceReceiptUrl(record.receiptRemotePath);
    } catch (err) {
      console.warn("Could not load receipt:", err.message);
    }
  }

  openPanel(
    `${MAINTENANCE_TYPE_LABELS[record.type] || "Other"} — ${vehicleLabel(vehicle)}`,
    `
    <p style="color:var(--text-dim);font-size:13px;">
      ${new Date(record.date).toLocaleDateString()}${typeof record.miles === "number" ? ` · ${record.miles.toLocaleString()} mi` : ""}${
        typeof record.cost === "number" ? ` · $${record.cost.toFixed(2)}` : ""
      }
    </p>
    ${record.note ? `<p>${escHtml(record.note)}</p>` : ""}
    ${
      record.reminderDate
        ? `<p style="color:${record.reminderDate <= Date.now() ? "var(--danger)" : "var(--accent-bright)"};font-weight:600;">⏰ ${maintenanceReminderText(record)}</p>`
        : ""
    }
    ${
      receiptUrl
        ? `<img src="${receiptUrl}" alt="Receipt" style="width:100%;border-radius:8px;display:block;margin-top:8px;" />`
        : record.receiptRemotePath || record.receiptData
        ? '<p style="color:var(--text-dim);font-size:13px;">Couldn\'t load the receipt photo.</p>'
        : ""
    }
    <button class="primary" id="edit-maint-btn" style="margin-top:12px;">Edit</button>
    <button class="primary" id="back-to-vehicle-btn" style="background:var(--panel);border:1px solid var(--border);margin-top:8px;">Back</button>
    `
  );
  document.getElementById("edit-maint-btn").addEventListener("click", () => openMaintenanceRecordFormPanel(vehicle, record));
  document.getElementById("back-to-vehicle-btn").addEventListener("click", () => openVehicleDetailPanel(vehicle));
}

// ---------- Maintenance reminders ----------
// Asked for only once, at the moment a reminder is first set — not
// proactively on load, which would be a surprise permission prompt for a
// feature the person hasn't touched yet. A "denied" or dismissed prompt
// just means the banner (always shown regardless — see
// checkMaintenanceReminders) is the only signal; this is a bonus on top
// of it, not a replacement.
let notificationPermissionRequested = false;
async function ensureNotificationPermissionRequested() {
  if (notificationPermissionRequested) return;
  notificationPermissionRequested = true;
  if (typeof Notification === "undefined" || Notification.permission !== "default") return;
  try {
    await Notification.requestPermission();
  } catch (err) {
    console.warn("Notification permission request failed:", err.message);
  }
}

function maintenanceReminderText(r) {
  const days = Math.round((r.reminderDate - Date.now()) / 86400000);
  if (days > 0) return `Due ${new Date(r.reminderDate).toLocaleDateString()}`;
  if (days === 0) return "Due today";
  return `Overdue since ${new Date(r.reminderDate).toLocaleDateString()}`;
}

// Runs once when the app loads (see map.on("load", ...) below) — the
// honest scope of what a static, no-backend app can do: there's no
// server to push a notification while this tab is closed, so "the next
// time you open the app on or after the due date" is the real mechanic.
// The banner covers that reliably; a real Notification on top of it only
// fires for the subset of due reminders this device hasn't shown yet,
// and only if the browser already granted permission.
async function checkMaintenanceReminders() {
  const now = Date.now();
  const allRecords = await MaintenanceStore.listAllRecords();
  const due = allRecords.filter((r) => r.reminderDate && r.reminderDate <= now);
  const newlyDue = due.filter((r) => !r.reminderNotified);

  for (const r of newlyDue) {
    await MaintenanceStore.markReminderNotified(r.id);
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        const vehicle = await VehicleStore.getVehicle(r.vehicleId);
        new Notification("Maintenance due", {
          body: `${MAINTENANCE_TYPE_LABELS[r.type] || "Maintenance"} for ${vehicle ? vehicleLabel(vehicle) : "your vehicle"}`,
          icon: "icons/icon-192.png",
        });
      } catch (err) {
        console.warn("Could not show a maintenance notification:", err.message);
      }
    }
  }

  const banner = document.getElementById("maintenance-reminder-banner");
  if (due.length > 0) {
    banner.textContent = `🔧 ${due.length} maintenance reminder${due.length === 1 ? "" : "s"} due — tap to view`;
    banner.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
  }
}

async function openMaintenanceRemindersDuePanel() {
  const now = Date.now();
  const allRecords = await MaintenanceStore.listAllRecords();
  const due = allRecords.filter((r) => r.reminderDate && r.reminderDate <= now).sort((a, b) => a.reminderDate - b.reminderDate);
  const vehicles = await VehicleStore.listVehicles();
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));

  const rows = due
    .map((r) => {
      const vehicle = vehicleById.get(r.vehicleId);
      return `<div class="trail-item" data-id="${r.id}">
        <div>
          <div>${MAINTENANCE_TYPE_LABELS[r.type] || "Other"} — ${escHtml(vehicle ? vehicle.name : "Unknown vehicle")}</div>
          <small style="color:var(--danger);">${maintenanceReminderText(r)}</small>
        </div>
        <button class="pill-btn" data-action="view">View</button>
      </div>`;
    })
    .join("");

  openPanel(
    "Maintenance Due",
    `${rows || '<p style="color:var(--text-dim);font-size:13px;">Nothing due.</p>'}`
  );
  panelBody.querySelectorAll('.trail-item[data-id] button[data-action="view"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.closest(".trail-item").dataset.id);
      const record = due.find((r) => r.id === id);
      const vehicle = vehicleById.get(record.vehicleId);
      if (vehicle) openMaintenanceRecordPanel(vehicle, record);
    });
  });
}

document.getElementById("maintenance-reminder-banner").addEventListener("click", openMaintenanceRemindersDuePanel);

// ---------- Stats dashboard ----------
// Everything here is derived from data already stored locally — no
// separate "stats" table, just an aggregation pass over trails/
// waypoints/vehicles/maintenance records each time the panel opens.
async function computeStats(yearOnly) {
  const [trails, waypoints, vehicles, records] = await Promise.all([
    TrailStore.listTrails(),
    WaypointStore.listWaypoints(),
    VehicleStore.listVehicles(),
    MaintenanceStore.listAllRecords(),
  ]);

  const currentYear = new Date().getFullYear();
  const inScope = (ms) => !yearOnly || new Date(ms).getFullYear() === currentYear;

  const recordedTrails = trails.filter((t) => t.kind === "recorded" && inScope(t.startedAt || t.createdAt));
  const plannedCount = trails.filter((t) => t.kind === "planned" && inScope(t.createdAt)).length;
  const importedCount = trails.filter((t) => t.kind === "imported" && inScope(t.createdAt)).length;

  let totalMeters = 0;
  let totalGainFt = 0;
  const activeDays = new Set();
  for (const t of recordedTrails) {
    totalMeters += t.distanceMeters || 0;
    const profile = buildElevationProfile(t);
    if (profile) totalGainFt += profile.gainFt;
    const d = new Date(t.startedAt || t.createdAt);
    activeDays.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
  }

  const scopedWaypoints = waypoints.filter((w) => inScope(w.createdAt));
  const scopedRecords = records.filter((r) => inScope(r.date));
  const maintenanceCost = scopedRecords.reduce((sum, r) => sum + (r.cost || 0), 0);

  return {
    recordedCount: recordedTrails.length,
    plannedCount,
    importedCount,
    totalMiles: metersToMiles(totalMeters),
    totalGainFt,
    activeDaysCount: activeDays.size,
    waypointCount: scopedWaypoints.length,
    vehicleCount: vehicles.length, // not year-scoped — "vehicles you own" isn't a per-year thing
    maintenanceCount: scopedRecords.length,
    maintenanceCost,
  };
}

function statTileHtml(value, label) {
  return `<div class="elev-stat"><div class="elev-stat-value">${value}</div><div class="elev-stat-label">${label}</div></div>`;
}

async function openStatsPanel(yearOnly) {
  const s = await computeStats(yearOnly);
  openPanel(
    "Stats",
    `
    <div style="display:flex;gap:8px;margin-bottom:12px;">
      <button class="pill-btn" id="stats-year-btn" style="${!yearOnly ? "" : "border-color:var(--accent-bright);color:var(--accent-bright);"}">This Year</button>
      <button class="pill-btn" id="stats-all-btn" style="${yearOnly ? "" : "border-color:var(--accent-bright);color:var(--accent-bright);"}">All Time</button>
    </div>
    <div class="elev-stats">
      ${statTileHtml(s.totalMiles.toFixed(0), "Miles Driven")}
      ${statTileHtml(Math.round(s.totalGainFt).toLocaleString(), "Ft Climbed")}
      ${statTileHtml(s.recordedCount, "Trails Recorded")}
      ${statTileHtml(s.activeDaysCount, "Days Out")}
    </div>
    <div class="elev-stats" style="margin-top:8px;">
      ${statTileHtml(s.waypointCount, "Waypoints")}
      ${statTileHtml(s.plannedCount + s.importedCount, "Planned/Imported")}
      ${statTileHtml(s.vehicleCount, "Vehicles")}
      ${statTileHtml("$" + s.maintenanceCost.toFixed(0), "Maintenance Spend")}
    </div>
    `
  );
  document.getElementById("stats-year-btn").addEventListener("click", () => openStatsPanel(true));
  document.getElementById("stats-all-btn").addEventListener("click", () => openStatsPanel(false));
}

// ---------- Weather & sunset ----------
// National Weather Service API (api.weather.gov) — free, no API key,
// CORS-enabled, official US government data, and unlike a generic
// forecast API it also carries active weather alerts (flash flood,
// severe storm warnings), which matter a lot more here than a plain
// forecast given this app's water-crossing waypoints. US coverage only,
// which matches this app's southeast-US scope. Based on the map's
// current center, not GPS — "what's it doing where I'm about to go" is
// usually more useful for trip planning than "what's it doing right here".
async function fetchNwsWeather(lat, lng) {
  const pointsRes = await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lng.toFixed(4)}`);
  if (!pointsRes.ok) throw new Error(`Location lookup failed (${pointsRes.status})`);
  const points = await pointsRes.json();
  const forecastUrl = points.properties.forecast;
  const loc = points.properties.relativeLocation?.properties;

  const [forecastRes, alertsRes] = await Promise.all([
    fetch(forecastUrl),
    fetch(`https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lng.toFixed(4)}`),
  ]);
  const forecast = forecastRes.ok ? await forecastRes.json() : null;
  const alerts = alertsRes.ok ? await alertsRes.json() : null;

  return {
    city: loc?.city,
    state: loc?.state,
    periods: forecast ? forecast.properties.periods.slice(0, 4) : [],
    alerts: alerts ? alerts.features : [],
  };
}

// The standard NOAA/Almanac sunrise-sunset algorithm — computed entirely
// client-side (no API needed for this part), zenith=90.833° for sunset
// (accounts for atmospheric refraction + the sun's apparent radius) or
// 96° for the end of civil twilight ("fully dark").
function calcSunEvent(lat, lng, date, zenith) {
  const rad = Math.PI / 180;
  const dayOfYear = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 86400000);
  const lngHour = lng / 15;
  const t = dayOfYear + (18 - lngHour) / 24;

  const M = 0.9856 * t - 3.289;
  let L = M + 1.916 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 282.634;
  L = ((L % 360) + 360) % 360;

  let RA = (1 / rad) * Math.atan(0.91764 * Math.tan(L * rad));
  RA = ((RA % 360) + 360) % 360;
  const Lquadrant = Math.floor(L / 90) * 90;
  const RAquadrant = Math.floor(RA / 90) * 90;
  RA = (RA + (Lquadrant - RAquadrant)) / 15;

  const sinDec = 0.39782 * Math.sin(L * rad);
  const cosDec = Math.cos(Math.asin(sinDec));

  const cosH = (Math.cos(zenith * rad) - sinDec * Math.sin(lat * rad)) / (cosDec * Math.cos(lat * rad));
  if (cosH > 1 || cosH < -1) return null; // sun never sets / never rises at this latitude today

  const H = (1 / rad) * Math.acos(cosH);
  const T = H / 15 + RA - 0.06571 * t - 6.622;

  let UT = ((T - lngHour) % 24 + 24) % 24;
  const midnightUtc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  // setUTCHours(fractionalValue) silently truncates the fraction instead
  // of carrying it into minutes — work in raw milliseconds instead.
  return new Date(midnightUtc + UT * 3600000);
}

function formatCountdown(target) {
  const ms = target - Date.now();
  if (ms <= 0) return "already passed";
  const h = Math.floor(ms / 3600000);
  const m = Math.round((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

async function openWeatherPanel() {
  // Your actual GPS fix when it's fresh (same 5-minute staleness window
  // requestPhotoLocation already uses elsewhere) — that's what "weather
  // right now" should mean for almost everyone. Falls back to the map's
  // current center (still handy for previewing conditions somewhere
  // you're planning to go but haven't driven to) when location is off,
  // denied, or just stale.
  const usingGps = lastKnownPosition && Date.now() - lastKnownPosition.t < 5 * 60 * 1000;
  const center = usingGps ? lastKnownPosition : map.getCenter();
  const now = new Date();
  const sunset = calcSunEvent(center.lat, center.lng, now, 90.833);
  const darkTime = calcSunEvent(center.lat, center.lng, now, 96);

  openPanel(
    "Weather",
    `<p style="color:var(--text-dim);font-size:13px;">Loading conditions for ${usingGps ? "your location" : "the map's current view"}…</p>`
  );

  const sunHtml = `
    <div class="region-item">
      <div><div>🌅 Sunset</div><small>${sunset ? sunset.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "N/A"}</small></div>
      <div style="color:var(--text-dim);font-size:13px;">${sunset ? "in " + formatCountdown(sunset) : ""}</div>
    </div>
    <div class="region-item">
      <div><div>🌑 Fully Dark</div><small>${darkTime ? darkTime.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "N/A"}</small></div>
      <div style="color:var(--text-dim);font-size:13px;">${darkTime ? "in " + formatCountdown(darkTime) : ""}</div>
    </div>
  `;

  if (!navigator.onLine) {
    openPanel("Weather", `${sunHtml}<p style="color:var(--warn);font-size:13px;margin-top:8px;">Forecast needs an internet connection.</p>`);
    return;
  }

  try {
    const w = await fetchNwsWeather(center.lat, center.lng);
    const alertsHtml = w.alerts.length
      ? w.alerts
          .map(
            (a) => `<div class="region-item" style="border-color:var(--danger);">
              <div><div style="color:var(--danger);font-weight:700;">⚠️ ${escHtml(a.properties.event)}</div><small>${escHtml(a.properties.headline || "")}</small></div>
            </div>`
          )
          .join("")
      : "";
    const forecastHtml = w.periods
      .map(
        (p) => `<div class="region-item">
          <div><div>${escHtml(p.name)}</div><small>${escHtml(p.shortForecast)}${
            p.probabilityOfPrecipitation?.value ? ` · ${p.probabilityOfPrecipitation.value}% precip` : ""
          }</small></div>
          <div style="font-size:20px;font-weight:700;">${p.temperature}°${p.temperatureUnit}</div>
        </div>`
      )
      .join("");
    openPanel(
      "Weather" + (w.city ? ` — ${escHtml(w.city)}, ${escHtml(w.state || "")}` : ""),
      `${alertsHtml}${sunHtml}${forecastHtml}
      <p style="color:var(--text-dim);font-size:11px;margin-top:8px;">National Weather Service · ${
        usingGps ? "your current location" : "the map's current view (no recent GPS fix — pan the map to check elsewhere)"
      }</p>`
    );
  } catch (err) {
    openPanel(
      "Weather",
      `${sunHtml}<p style="color:var(--warn);font-size:13px;margin-top:8px;">Couldn't load the forecast: ${escHtml(err.message)}${
        center.lat < 24 || center.lat > 50 || center.lng < -125 || center.lng > -66 ? " (NWS only covers the US)" : ""
      }</p>`
    );
  }
}

// ---------- Rain radar overlay ----------
// RainViewer's public API (rainviewer.com) — free, no API key, CORS-
// enabled, widely used for exactly this. Shows only the latest frame
// (not a full animated loop — that's a real feature in its own right,
// left for later if it's wanted) refreshed every 10 minutes while on,
// since that's roughly how often new radar sweeps land.
const RADAR_SOURCE_ID = "rainviewer-radar";
let radarOn = false;
let radarFrameTime = null;
let radarRefreshTimer = null;

async function fetchLatestRadarFrame() {
  const res = await fetch("https://api.rainviewer.com/public/weather-maps.json");
  if (!res.ok) throw new Error(`Radar lookup failed (${res.status})`);
  const data = await res.json();
  const frames = data.radar && data.radar.past;
  if (!frames || !frames.length) throw new Error("No radar frames available right now");
  const latest = frames[frames.length - 1];
  return { host: data.host, path: latest.path, time: latest.time * 1000 };
}

async function addRadarLayer() {
  const frame = await fetchLatestRadarFrame();
  radarFrameTime = frame.time;
  // 256px tiles, color scheme 2 (universal blue-green-red), smoothed
  // with snow shown separately (RainViewer's "1_1" options string) —
  // their own documented defaults for a legible overlay.
  const tileUrl = `${frame.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;
  if (map.getSource(RADAR_SOURCE_ID)) {
    map.getSource(RADAR_SOURCE_ID).setTiles([tileUrl]);
  } else {
    map.addSource(RADAR_SOURCE_ID, {
      type: "raster",
      tiles: [tileUrl],
      tileSize: 256,
      attribution: "Radar: RainViewer",
      // RainViewer's tile cache doesn't actually generate real imagery
      // past z7 — confirmed by fetching real tiles at several zooms:
      // every request past z7 comes back 200 OK, but every single one is
      // the exact same placeholder PNG with "Zoom Level Not Supported"
      // baked into the picture rather than an HTTP error, so there's no
      // way to detect it from the response alone. Capping maxzoom here
      // makes MapLibre stop requesting past it and over-scale the last
      // real tile instead — same fix already applied to the Esri
      // satellite layer for the same kind of placeholder-tile problem.
      maxzoom: 7,
    });
    map.addLayer({ id: "radar-layer", type: "raster", source: RADAR_SOURCE_ID, paint: { "raster-opacity": 0.65 } });
  }
}

function removeRadarLayer() {
  if (map.getLayer("radar-layer")) map.removeLayer("radar-layer");
  if (map.getSource(RADAR_SOURCE_ID)) map.removeSource(RADAR_SOURCE_ID);
  radarFrameTime = null;
}

async function toggleRadar() {
  if (!navigator.onLine && !radarOn) {
    alert("Radar needs an internet connection.");
    return;
  }
  if (!radarOn) {
    try {
      await addRadarLayer();
      radarOn = true;
      radarRefreshTimer = setInterval(() => {
        addRadarLayer().catch((err) => console.warn("Radar refresh failed:", err.message));
      }, 10 * 60 * 1000);
    } catch (err) {
      alert("Couldn't load radar: " + err.message);
      return;
    }
  } else {
    radarOn = false;
    clearInterval(radarRefreshTimer);
    radarRefreshTimer = null;
    removeRadarLayer();
  }
}

// ---------- Map Layers menu ----------
// Consolidates the 3D/Radar/Cell-coverage toggles that used to be their
// own topbar buttons — at real phone widths that row simply didn't fit
// (the status pill was running off the edge of the screen). Same
// tools-grid pattern as the Tools panel, which this exists right next to
// conceptually. Weather has its own topbar button rather than living
// here — unlike these three, it isn't an on/off map layer, it opens a
// whole separate panel (forecast, alerts, sunset), so grouping it with
// toggles was more confusing than it saved.
async function openLayersPanel() {
  const radarLabel = radarOn && radarFrameTime ? `Radar (${new Date(radarFrameTime).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })})` : "Radar";
  openPanel(
    "Map Layers",
    `
    <div class="tools-grid">
      <button class="tools-grid-btn" id="layers-3d-btn">
        <span class="tools-grid-icon${terrain3dOn ? " active" : ""}">🏔️</span><span>3D Terrain</span>
      </button>
      <button class="tools-grid-btn" id="layers-radar-btn">
        <span class="tools-grid-icon${radarOn ? " active" : ""}">📡</span><span>${radarLabel}</span>
      </button>
      ${
        CellCoverage.enabled
          ? `<button class="tools-grid-btn" id="layers-cell-btn">
        <span class="tools-grid-icon${cellTowersOn ? " active" : ""}">📶</span><span>Cell Coverage</span>
      </button>`
          : ""
      }
    </div>
    `
  );
  document.getElementById("layers-3d-btn").addEventListener("click", async () => {
    await toggle3dTerrain();
    openLayersPanel();
  });
  document.getElementById("layers-radar-btn").addEventListener("click", async () => {
    await toggleRadar();
    openLayersPanel();
  });
  document.getElementById("layers-cell-btn")?.addEventListener("click", async () => {
    await toggleCellTowers();
    openLayersPanel();
  });
}

document.getElementById("btn-weather")?.addEventListener("click", () => {
  // Toggle: tapping it again while it's already the open panel hides it,
  // rather than just re-fetching/re-rendering the same forecast.
  if (!panel.classList.contains("hidden") && panelTitle.textContent.startsWith("Weather")) {
    closePanel();
  } else {
    openWeatherPanel();
  }
});

document.getElementById("btn-layers")?.addEventListener("click", openLayersPanel);

// GPX 1.1 — the standard format for GPS tracks, readable by basically
// every mapping/GPS tool (Garmin, Google Earth, CalTopo, onX's own
// import, etc.), which is what makes "export where we went" useful.
function trailToGpx(trail) {
  const points = trail.points
    .map((p) => {
      const ele = typeof p.ele === "number" ? `<ele>${p.ele.toFixed(1)}</ele>` : "";
      const time = p.t ? `<time>${new Date(p.t).toISOString()}</time>` : "";
      return `      <trkpt lat="${p.lat}" lon="${p.lng}">${ele}${time}</trkpt>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Trailmark" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${escHtml(trail.name)}</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>
`;
}

function waypointToGpx(wp) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Trailmark" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="${wp.lat}" lon="${wp.lng}">
    <name>${escHtml(wp.name)}</name>
    ${wp.note ? `<desc>${escHtml(wp.note)}</desc>` : ""}
  </wpt>
</gpx>
`;
}

// GPX import — reads track(s), route(s), and waypoints out of a GPX file
// from onX (or Gaia, AllTrails, a Garmin unit, anything GPX-compliant) so
// existing trail data doesn't have to be re-mapped by hand. Uses the
// browser's built-in XML parser rather than a library; GPX files almost
// always use an unprefixed default namespace, so plain tag-name lookups
// (confirmed against real onX/Gaia exports) work without namespace juggling.
function parseGpx(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("That file isn't valid GPX/XML.");
  }

  function readPoints(pointEls) {
    const points = [];
    for (const pt of pointEls) {
      const lat = parseFloat(pt.getAttribute("lat"));
      const lng = parseFloat(pt.getAttribute("lon"));
      if (!isFinite(lat) || !isFinite(lng)) continue;
      const point = { lat, lng };
      const eleEl = pt.getElementsByTagName("ele")[0];
      if (eleEl) {
        const ele = parseFloat(eleEl.textContent);
        if (isFinite(ele)) point.ele = ele;
      }
      const timeEl = pt.getElementsByTagName("time")[0];
      if (timeEl) {
        const t = Date.parse(timeEl.textContent);
        if (isFinite(t)) point.t = t;
      }
      points.push(point);
    }
    return points;
  }

  const tracks = [];
  for (const trk of doc.getElementsByTagName("trk")) {
    const nameEl = trk.getElementsByTagName("name")[0];
    // A track can have multiple <trkseg> (e.g. GPS paused and resumed) —
    // concatenate them into one continuous line, same as a single Trailmark
    // recording session would produce.
    const points = readPoints(trk.getElementsByTagName("trkpt"));
    if (points.length >= 2) tracks.push({ name: nameEl ? nameEl.textContent.trim() : "", points });
  }

  // Some tools (including onX, for a planned-but-not-driven route) export
  // a <rte> instead of a <trk>. Only used as a fallback so a file with
  // real tracks doesn't also import them a second time as routes.
  if (tracks.length === 0) {
    for (const rte of doc.getElementsByTagName("rte")) {
      const nameEl = rte.getElementsByTagName("name")[0];
      const points = readPoints(rte.getElementsByTagName("rtept"));
      if (points.length >= 2) tracks.push({ name: nameEl ? nameEl.textContent.trim() : "", points });
    }
  }

  const waypoints = [];
  for (const wpt of doc.getElementsByTagName("wpt")) {
    const lat = parseFloat(wpt.getAttribute("lat"));
    const lng = parseFloat(wpt.getAttribute("lon"));
    if (!isFinite(lat) || !isFinite(lng)) continue;
    const nameEl = wpt.getElementsByTagName("name")[0];
    const descEl = wpt.getElementsByTagName("desc")[0];
    waypoints.push({
      lat,
      lng,
      name: nameEl && nameEl.textContent.trim() ? nameEl.textContent.trim() : "Imported waypoint",
      note: descEl ? descEl.textContent.trim() : "",
    });
  }

  return { tracks, waypoints };
}

async function importGpxFile(file) {
  const text = await file.text();
  const { tracks, waypoints } = parseGpx(text);
  if (tracks.length === 0 && waypoints.length === 0) {
    throw new Error("No tracks, routes, or waypoints found in that file.");
  }

  const baseName = file.name.replace(/\.gpx$/i, "");
  let firstImportedId = null;
  for (const [i, track] of tracks.entries()) {
    const rawName = track.name || (tracks.length > 1 ? `${baseName} (${i + 1})` : baseName);
    // Some export tools (and a filename echoed straight from a corrupt
    // source timestamp) can hand us a literal "Invalid Date" or empty
    // string here — fall back rather than saving that as the trail's name.
    const name =
      rawName && rawName.trim() && rawName.trim().toLowerCase() !== "invalid date"
        ? rawName.trim()
        : `Imported trail – ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
    const times = track.points.map((p) => p.t).filter((t) => typeof t === "number");
    const id = await TrailStore.saveTrail({
      name,
      kind: "imported",
      points: track.points,
      distanceMeters: totalDistanceMeters(track.points),
      startedAt: times.length ? Math.min(...times) : null,
      endedAt: times.length ? Math.max(...times) : null,
      difficulty: null,
    });
    if (firstImportedId === null) firstImportedId = id;
    backfillAndSaveTrailElevation(id);
  }
  for (const wpt of waypoints) {
    await WaypointStore.saveWaypoint({ name: wpt.name, lat: wpt.lat, lng: wpt.lng, note: wpt.note, category: "other" });
  }
  if (waypoints.length) await refreshWaypointMarkers();
  if (tracks.length || waypoints.length) syncPersonalData().catch(() => {});
  if (firstImportedId !== null) showTrailOnMap(await TrailStore.getTrail(firstImportedId));

  const parts = [];
  if (tracks.length) parts.push(`${tracks.length} trail${tracks.length === 1 ? "" : "s"}`);
  if (waypoints.length) parts.push(`${waypoints.length} waypoint${waypoints.length === 1 ? "" : "s"}`);
  alert(`Imported ${parts.join(" and ")}.`);
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// A brief window to undo a delete after it's already committed to the DB —
// the confirm() dialog guards against a stray tap, this catches "actually I
// didn't mean that" a beat later. Only one toast at a time: a second delete
// while one is showing replaces it rather than stacking, so the timeout and
// button listener never point at a stale record.
let undoToastTimeout = null;
function showUndoToast(message, onUndo) {
  clearTimeout(undoToastTimeout);
  const toast = document.getElementById("undo-toast");
  document.getElementById("undo-toast-msg").textContent = message;
  toast.classList.remove("hidden");
  const btn = document.getElementById("undo-toast-btn");
  const freshBtn = btn.cloneNode(true); // drop the previous toast's listener
  btn.replaceWith(freshBtn);
  freshBtn.addEventListener("click", async () => {
    clearTimeout(undoToastTimeout);
    toast.classList.add("hidden");
    await onUndo();
  });
  undoToastTimeout = setTimeout(() => toast.classList.add("hidden"), 6000);
}

// Grade tiers roughly follow common trail-difficulty signage (a paved
// road rarely exceeds ~8%; technical 4x4 trails routinely hit 15-30%+),
// so the color alone should read as "easy -> gnarly" without a legend.
function gradeColor(gradePct) {
  const g = Math.abs(gradePct);
  if (g < 8) return "#22c55e";
  if (g < 15) return "#eab308";
  if (g < 25) return "#f97316";
  return "#dc2626";
}

// One LineString feature per segment, colored by that segment's grade —
// MapLibre's line-gradient only interpolates smoothly along a line's own
// length, not against an independent data channel like grade, so
// per-segment features + data-driven line-color is the straightforward
// way to get "redder where it's steeper". Falls back to a single solid
// line when there isn't enough elevation data to compute grade (imported/
// planned trails, or a device that never reported GPS altitude).
function trailLineGeojson(trail) {
  const points = trail.points;
  if (!trailHasElevation(trail)) {
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { color: "#facc15" },
          geometry: { type: "LineString", coordinates: points.map((p) => [p.lng, p.lat]) },
        },
      ],
    };
  }
  const features = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (typeof a.ele !== "number" || typeof b.ele !== "number") continue; // no grade without both endpoints' elevation
    const runFt = metersToFeet(elevHaversineMeters(a, b));
    const riseFt = metersToFeet(b.ele - a.ele);
    const gradePct = runFt > 3 ? (riseFt / runFt) * 100 : 0; // ignore near-zero run — noise, not a real grade
    features.push({
      type: "Feature",
      properties: { color: gradeColor(gradePct) },
      geometry: {
        type: "LineString",
        coordinates: [
          [a.lng, a.lat],
          [b.lng, b.lat],
        ],
      },
    });
  }
  return { type: "FeatureCollection", features };
}

function showTrailOnMap(trail) {
  const sourceId = `saved-trail-${trail.id}`;
  const geojson = trailLineGeojson(trail);

  if (map.getSource(sourceId)) {
    map.getSource(sourceId).setData(geojson);
  } else {
    map.addSource(sourceId, { type: "geojson", data: geojson });
    map.addLayer({
      id: sourceId,
      type: "line",
      source: sourceId,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": ["get", "color"], "line-width": 4 },
    });
  }

  const coords = trail.points.map((p) => [p.lng, p.lat]);
  const bounds = coords.reduce(
    (b, c) => b.extend(c),
    new maplibregl.LngLatBounds(coords[0], coords[0])
  );
  map.fitBounds(bounds, { padding: 40 });
}

// ---------- Crew (accounts, chat, live locations) ----------
// No "group" concept — every signed-in user shares one space (see
// sql/schema.sql). `socialActive` tracks whether the realtime
// subscriptions + location broadcast are currently running, which starts
// the moment you sign in and open this panel, not automatically on a
// silent session restore (avoids starting a GPS watch + realtime
// connections in the background before you've actually opened the app's
// social features).
let session = null;
let socialActive = false;
let memberLocationMarkers = {};
let locationBroadcastWatchId = null;
let chatChannel = null;
let locationChannel = null;
let photoChannel = null;
let groupPhotoMarkers = {};
let waypointChannel = null;
let groupWaypointMarkers = {};

if (GroupBackend.enabled) {
  GroupBackend.getSession()
    .then((s) => {
      session = s;
      if (s) syncPersonalData().catch(() => {});
    })
    .catch((err) => console.warn("Could not restore session:", err));
  GroupBackend.onAuthChange((s) => {
    session = s;
    if (!s) deactivateSocial();
    else syncPersonalData().catch(() => {});
  });
}

// Private backup/restore of My Content (TrailStore/WaypointStore) —
// distinct from the "Share" button's shared_trails/shared_waypoints,
// which are visible to every signed-in user. This only ever talks to
// personal_trails/personal_waypoints, which RLS locks to auth.uid(), so
// nothing here is visible to anyone but the signed-in owner.
//
// Deliberately simple, not a full two-way sync: it pushes local records
// that have never been synced (no remoteId yet) and pulls remote records
// this device doesn't have yet (matched by remoteId). It does NOT
// reconcile edits made to the same record on two different devices, and
// it does NOT propagate a delete made on one device to a second device
// that already pulled a copy — deletes are pushed to the remote row at
// the moment you delete locally (see the trail/waypoint delete handlers
// below), so the backup itself stays accurate, but a second device keeps
// its already-downloaded local copy until you delete it there too. For a
// single-rider "don't lose my trails" use case that's the right
// trade-off; it avoids needing conflict resolution or tombstones for
// data that's realistically edited from one device at a time.
let personalSyncInFlight = null;
async function syncPersonalData() {
  if (!GroupBackend.enabled || !session) return;
  // Coalesce overlapping calls (e.g. a save right after sign-in both
  // trigger this) into the one already running instead of racing two
  // push passes against the same unsynced-local-record set.
  if (personalSyncInFlight) return personalSyncInFlight;
  personalSyncInFlight = (async () => {
    try {
      const [localTrails, localWaypoints] = await Promise.all([TrailStore.listTrails(), WaypointStore.listWaypoints()]);

      for (const t of localTrails) {
        if (t.remoteId) continue;
        const remote = await GroupBackend.upsertPersonalTrail(t);
        await TrailStore.setRemoteId(t.id, remote.id);
      }
      for (const wp of localWaypoints) {
        if (wp.remoteId) continue;
        const remote = await GroupBackend.upsertPersonalWaypoint(wp);
        await WaypointStore.setRemoteId(wp.id, remote.id);
      }

      const knownTrailRemoteIds = new Set(localTrails.map((t) => t.remoteId).filter(Boolean));
      const knownWaypointRemoteIds = new Set(localWaypoints.map((wp) => wp.remoteId).filter(Boolean));
      const [remoteTrails, remoteWaypoints] = await Promise.all([GroupBackend.listPersonalTrails(), GroupBackend.listPersonalWaypoints()]);

      for (const r of remoteTrails) {
        if (knownTrailRemoteIds.has(r.id)) continue;
        await TrailStore.importSynced({
          remoteId: r.id,
          name: r.name,
          kind: r.kind,
          points: r.points,
          distanceMeters: r.distance_meters,
          startedAt: r.started_at,
          endedAt: r.ended_at,
          difficulty: r.difficulty,
          createdAt: r.created_at,
        });
      }
      for (const r of remoteWaypoints) {
        if (knownWaypointRemoteIds.has(r.id)) continue;
        await WaypointStore.importSynced({
          remoteId: r.id,
          name: r.name,
          lat: r.lat,
          lng: r.lng,
          note: r.note,
          category: r.category,
          severity: r.severity,
          createdAt: r.created_at,
        });
      }

      // Vehicles push first — maintenance records need their vehicle's
      // remoteId (personal_maintenance_records.vehicle_id references
      // personal_vehicles.id), so a record whose vehicle hasn't synced
      // yet just waits for the next pass rather than erroring here.
      const localVehicles = await VehicleStore.listVehicles();
      for (const v of localVehicles) {
        if (v.remoteId) continue;
        const remote = await GroupBackend.upsertPersonalVehicle(v);
        await VehicleStore.setRemoteId(v.id, remote.id);
      }
      const vehiclesAfterPush = await VehicleStore.listVehicles();
      const vehicleRemoteIdByLocalId = new Map(vehiclesAfterPush.map((v) => [v.id, v.remoteId]));

      const localRecords = await MaintenanceStore.listAllRecords();
      for (const r of localRecords) {
        if (r.remoteId) continue;
        const vehicleRemoteId = vehicleRemoteIdByLocalId.get(r.vehicleId);
        if (!vehicleRemoteId) continue; // this record's vehicle hasn't synced yet
        const remote = await GroupBackend.upsertPersonalMaintenanceRecord(r, vehicleRemoteId);
        await MaintenanceStore.setRemoteId(r.id, remote.id);
        if (remote.receipt_path) await MaintenanceStore.setReceiptRemotePath(r.id, remote.receipt_path);
      }

      const knownVehicleRemoteIds = new Set(vehiclesAfterPush.map((v) => v.remoteId).filter(Boolean));
      const remoteVehicles = await GroupBackend.listPersonalVehicles();
      for (const r of remoteVehicles) {
        if (knownVehicleRemoteIds.has(r.id)) continue;
        await VehicleStore.importSynced({
          remoteId: r.id,
          name: r.name,
          year: r.year,
          make: r.make,
          model: r.model,
          odometer: r.odometer,
          createdAt: r.created_at,
        });
      }

      // Re-list after the pull above so a vehicle imported just now has a
      // local id available for its own records to attach to below.
      const vehiclesAfterPull = await VehicleStore.listVehicles();
      const localVehicleIdByRemoteId = new Map(vehiclesAfterPull.filter((v) => v.remoteId).map((v) => [v.remoteId, v.id]));
      const knownRecordRemoteIds = new Set((await MaintenanceStore.listAllRecords()).map((r) => r.remoteId).filter(Boolean));
      const remoteRecords = await GroupBackend.listPersonalMaintenanceRecords();
      for (const r of remoteRecords) {
        if (knownRecordRemoteIds.has(r.id)) continue;
        const localVehicleId = localVehicleIdByRemoteId.get(r.vehicle_id);
        if (!localVehicleId) continue; // this record's vehicle isn't on this device (yet) — picked up next sync
        await MaintenanceStore.importSynced({
          remoteId: r.id,
          vehicleId: localVehicleId,
          type: r.type,
          date: r.date,
          miles: r.miles,
          cost: r.cost,
          note: r.note,
          receiptData: null, // fetched on demand when actually viewed — see openMaintenanceRecordPanel
          receiptType: null,
          receiptRemotePath: r.receipt_path,
          reminderDate: r.reminder_date,
          reminderNotified: false, // local-only — this device hasn't shown it yet even if another one has
          createdAt: r.created_at,
        });
      }

      if (!panel.classList.contains("hidden") && document.getElementById("trail-rows")) {
        openTrailsPanel(); // refresh My Content if it's the panel currently open
      }
      if (!panel.classList.contains("hidden") && document.getElementById("vehicle-rows")) {
        openVehiclesPanel(); // refresh the Vehicles list if it's open
      }
    } catch (err) {
      console.warn("Personal sync failed (will retry next time):", err.message);
      throw err;
    } finally {
      personalSyncInFlight = null;
    }
  })();
  return personalSyncInFlight;
}

async function openGroupPanel() {
  if (!GroupBackend.enabled) {
    openPanel(
      "Chat",
      `<p style="color:var(--text-dim);font-size:13px;">Crew features (chat, live locations, shared markers) aren't set up yet — see js/group/config.js in the repo.</p>`
    );
    return;
  }
  if (!session) {
    // `session` is set once by the getSession() call at load time, which
    // can still be in flight the first time someone taps Chat (e.g. right
    // after opening the app) — re-check directly here rather than trust
    // a variable that might not have resolved yet, so an already-signed-in
    // visitor doesn't get bounced to the sign-in screen for no reason.
    session = await GroupBackend.getSession().catch(() => null);
  }
  if (!session) {
    renderAuthPanel();
    return;
  }
  activateSocial();
  renderChatPanel();
}

// Settings: everything that isn't chat itself — trip folders and account
// sign in/out. Split out from the Chat panel (which used to carry all of
// this) so Chat stays focused on just messaging.
async function openSettingsPanel() {
  if (!GroupBackend.enabled) {
    openPanel(
      "Settings",
      `<p style="color:var(--text-dim);font-size:13px;">Crew features aren't set up yet — see js/group/config.js in the repo.</p>`
    );
    return;
  }
  if (!session) {
    session = await GroupBackend.getSession().catch(() => null);
  }
  if (!session) {
    renderAuthPanel();
    return;
  }
  openPanel(
    "Settings",
    `
    <div class="region-item">
      <div><div>Back up My Content</div><small id="sync-status">Your trails and waypoints sync privately to your account — only you can see them.</small></div>
      <button class="pill-btn" id="sync-now-btn">Sync Now</button>
    </div>
    <button class="primary" id="open-folders-btn" style="background:var(--panel);border:1px solid var(--accent-bright);margin-top:12px;">Trip Folders</button>
    <button class="primary" id="sign-out-btn" style="background:var(--panel);border:1px solid var(--border);">Sign Out</button>
    `
  );
  document.getElementById("open-folders-btn").addEventListener("click", openFoldersPanel);
  document.getElementById("sync-now-btn").addEventListener("click", async (e) => {
    const status = document.getElementById("sync-status");
    e.target.disabled = true;
    status.textContent = "Syncing…";
    try {
      await syncPersonalData();
      status.textContent = "Synced just now — only you can see your backed-up trails and waypoints.";
    } catch (err) {
      status.textContent = "Couldn't sync (offline?) — it'll retry automatically next time. " + err.message;
    } finally {
      e.target.disabled = false;
    }
  });
  document.getElementById("sign-out-btn").addEventListener("click", async () => {
    await GroupBackend.signOut();
    session = null;
    deactivateSocial();
    closePanel();
  });
}

function activateSocial() {
  if (socialActive) return;
  socialActive = true;
  startLocationBroadcast();
  locationChannel = GroupBackend.subscribeLocations(refreshMemberMarkers);
  chatMessages = [];
  chatChannel = GroupBackend.subscribeMessages((msg) => {
    chatMessages.push(msg);
    appendChatMessageIfOpen(msg);
  });
  photoChannel = GroupBackend.subscribePhotos(refreshGroupPhotoMarkers);
  waypointChannel = GroupBackend.subscribeWaypoints(refreshGroupWaypointMarkers);
}

function deactivateSocial() {
  socialActive = false;
  stopLocationBroadcast();
  unreadMessageCount = 0;
  updateChatBadge();
  if (locationChannel) locationChannel.unsubscribe();
  if (chatChannel) chatChannel.unsubscribe();
  if (photoChannel) photoChannel.unsubscribe();
  if (waypointChannel) waypointChannel.unsubscribe();
  locationChannel = chatChannel = photoChannel = waypointChannel = null;
  Object.values(memberLocationMarkers).forEach((m) => m.remove());
  memberLocationMarkers = {};
  activeCrewRows = [];
  memberColorAssignments = {};
  Object.values(groupPhotoMarkers).forEach((m) => m.remove());
  groupPhotoMarkers = {};
  Object.values(groupWaypointMarkers).forEach((m) => m.remove());
  groupWaypointMarkers = {};
}

// mode: "signin" (default — email + password only, no display name; that
// was already set once at account creation and Supabase remembers who you
// are from the saved session) | "signup" (adds the display-name field,
// only needed the one time an account is created).
function renderAuthPanel(mode = "signin") {
  const isSignup = mode === "signup";
  // A real <form> (not just bare inputs + a JS-click button) with
  // autocomplete hints and a type="submit" button is what actually gets
  // the browser's own password manager to offer saving/autofilling this
  // — the app never sees or stores the password itself either way,
  // which is also just how it should be.
  openPanel(
    isSignup ? "Create Account" : "Sign In",
    `
    <form id="auth-form" autocomplete="on">
    ${
      isSignup
        ? `<label>Display name</label>\n    <input id="auth-name" name="name" autocomplete="name" placeholder="What everyone sees you as" />`
        : ""
    }
    <label>Email</label>
    <input id="auth-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" />
    <label>Password</label>
    <input id="auth-password" name="password" type="password" autocomplete="${
      isSignup ? "new-password" : "current-password"
    }" placeholder="At least 6 characters" />
    <button class="primary" type="submit" id="auth-submit">${isSignup ? "Create Account" : "Sign In"}</button>
    </form>
    <button id="auth-switch-mode" style="background:none;border:none;color:var(--accent);font-size:13px;margin-top:8px;cursor:pointer;">
      ${isSignup ? "Already have an account? Sign in" : "New here? Create an account"}
    </button>
    <p id="auth-error" style="color:var(--danger);font-size:13px;"></p>
    `
  );
  const showError = (err) => {
    document.getElementById("auth-error").textContent = err.message || String(err);
  };
  document.getElementById("auth-switch-mode").addEventListener("click", () => renderAuthPanel(isSignup ? "signin" : "signup"));
  document.getElementById("auth-form").addEventListener("submit", async (e) => {
    e.preventDefault(); // this is an SPA — handle it in JS, but the submit event itself is what a browser's password manager watches for
    try {
      const email = document.getElementById("auth-email").value.trim();
      const password = document.getElementById("auth-password").value;
      if (isSignup) {
        const name = document.getElementById("auth-name").value.trim() || "Rider";
        await GroupBackend.signUp(email, password, name);
      } else {
        await GroupBackend.signIn(email, password);
      }
      session = await GroupBackend.getSession();
      if (!session) {
        // The project requires email confirmation — there's no active
        // session yet, so don't proceed into a Crew panel that looks
        // signed in but can't actually write anything (every Supabase
        // call would silently fail row-level security). Tell the user
        // what's actually going on instead.
        showError(new Error("Account created — check your email to confirm it, then come back and sign in."));
        return;
      }
      activateSocial();
      syncPersonalData().catch(() => {});
      renderChatPanel();
    } catch (err) {
      showError(err);
    }
  });
}

let chatMessages = [];

function renderChatPanel() {
  openPanel(
    "Chat",
    `
    <div id="crew-roster" style="font-size:12px;color:var(--text-dim);margin-bottom:8px;"></div>
    <div id="chat-log" style="max-height:220px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:8px;margin:8px 0;display:flex;flex-direction:column;"></div>
    <div style="display:flex;gap:6px;">
      <input id="chat-input" placeholder="Message the crew..." style="margin-top:0;flex:1;" />
      <button class="pill-btn" id="chat-send">Send</button>
    </div>
    `
  );
  const log = document.getElementById("chat-log");
  chatMessages.forEach((m) => log.appendChild(chatMessageEl(m)));
  log.scrollTop = log.scrollHeight;
  unreadMessageCount = 0;
  updateChatBadge();
  renderCrewRoster();

  const send = async () => {
    const input = document.getElementById("chat-input");
    const body = input.value.trim();
    if (!body) return;
    input.value = "";
    try {
      await GroupBackend.sendMessage(body);
    } catch (err) {
      alert("Could not send message: " + err.message);
    }
  };
  document.getElementById("chat-send").addEventListener("click", send);
  document.getElementById("chat-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") send();
  });
}

// ---------- Trip folders ----------
async function openFoldersPanel() {
  let folders = [];
  try {
    folders = await GroupBackend.listFolders();
  } catch (err) {
    console.warn("Could not load folders:", err);
  }
  const rows = folders
    .map(
      (f) => `<div class="region-item" data-id="${f.id}">
        <div><div>${escHtml(f.name)}</div><small>${escHtml(f.description || "")}</small></div>
        <button class="pill-btn" data-action="open">Open</button>
      </div>`
    )
    .join("");

  openPanel(
    "Trip Folders",
    `
    ${rows || '<p style="color:var(--text-dim);font-size:13px;">No trip folders yet.</p>'}
    <label>New folder name</label>
    <input id="new-folder-name" placeholder="e.g. Saturday Windrock run" />
    <label>Description (optional)</label>
    <input id="new-folder-desc" placeholder="Meet at the gate, 9am" />
    <button class="primary" id="create-folder-btn">Create Folder</button>
    <button class="primary" id="back-to-group-btn" style="background:var(--panel);border:1px solid var(--border);margin-top:12px;">Back</button>
    `
  );
  panelBody.querySelectorAll('.region-item button[data-action="open"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.closest(".region-item").dataset.id;
      const folder = folders.find((f) => f.id === id);
      openFolderDetailPanel(folder);
    });
  });
  document.getElementById("create-folder-btn").addEventListener("click", async () => {
    const name = document.getElementById("new-folder-name").value.trim();
    if (!name) return;
    const description = document.getElementById("new-folder-desc").value.trim();
    try {
      await GroupBackend.createFolder(name, description);
      openFoldersPanel();
    } catch (err) {
      alert("Could not create folder: " + err.message);
    }
  });
  document.getElementById("back-to-group-btn").addEventListener("click", openSettingsPanel);
}

async function openFolderDetailPanel(folder) {
  const [waypoints, trails] = await Promise.all([
    GroupBackend.listWaypoints(),
    GroupBackend.listTrails(),
  ]);
  const inFolder = { waypoints: waypoints.filter((w) => w.folder_id === folder.id), trails: trails.filter((t) => t.folder_id === folder.id) };
  const unassigned = { waypoints: waypoints.filter((w) => !w.folder_id), trails: trails.filter((t) => !t.folder_id) };

  const wpRows = inFolder.waypoints
    .map((w) => `<div class="trail-item"><div>📍 ${escHtml(w.name)} <small style="color:var(--text-dim);">(${CATEGORY_LABELS[w.category] || "Other"})</small></div></div>`)
    .join("");
  const trailRows = inFolder.trails
    .map((t) => `<div class="trail-item"><div>🛣️ ${escHtml(t.name)} <small style="color:var(--text-dim);">${metersToMiles(t.distance_meters || 0).toFixed(1)} mi${t.difficulty ? " · " + t.difficulty + "/10" : ""}</small></div></div>`)
    .join("");

  openPanel(
    escHtml(folder.name),
    `
    <p style="color:var(--text-dim);font-size:13px;">${escHtml(folder.description || "")}</p>
    <h4 style="margin-bottom:4px;">Waypoints</h4>
    ${wpRows || '<p style="color:var(--text-dim);font-size:12px;">None yet.</p>'}
    ${unassigned.waypoints.length ? `
    <select id="add-wp-select" style="width:100%;margin-top:6px;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);">
      <option value="">Add an existing shared waypoint...</option>
      ${unassigned.waypoints.map((w) => `<option value="${w.id}">${escHtml(w.name)}</option>`).join("")}
    </select>` : ""}
    <h4 style="margin-bottom:4px;margin-top:14px;">Trails / Routes</h4>
    ${trailRows || '<p style="color:var(--text-dim);font-size:12px;">None yet.</p>'}
    ${unassigned.trails.length ? `
    <select id="add-trail-select" style="width:100%;margin-top:6px;padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);">
      <option value="">Add an existing shared trail...</option>
      ${unassigned.trails.map((t) => `<option value="${t.id}">${escHtml(t.name)}</option>`).join("")}
    </select>` : ""}
    <button class="primary" id="back-to-folders-btn" style="background:var(--panel);border:1px solid var(--border);margin-top:16px;">Back to Folders</button>
    `
  );
  document.getElementById("add-wp-select")?.addEventListener("change", async (e) => {
    if (!e.target.value) return;
    await GroupBackend.assignWaypointFolder(e.target.value, folder.id);
    openFolderDetailPanel(folder);
  });
  document.getElementById("add-trail-select")?.addEventListener("change", async (e) => {
    if (!e.target.value) return;
    await GroupBackend.assignTrailFolder(e.target.value, folder.id);
    openFolderDetailPanel(folder);
  });
  document.getElementById("back-to-folders-btn").addEventListener("click", openFoldersPanel);
}

function chatMessageEl(m) {
  const el = document.createElement("div");
  el.style.cssText =
    "font-size:13px;margin-bottom:6px;max-width:85%;padding:6px 10px;border-radius:10px;background:var(--panel);border:1px solid var(--border);word-break:break-word;overflow-wrap:anywhere;";
  const isMine = session && m.user_id === session.user.id;
  if (isMine) el.style.marginLeft = "auto";
  const name = m.profiles?.display_name || "Rider";
  const time = m.created_at
    ? new Date(m.created_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : "";
  el.innerHTML = `<strong>${escHtml(name)}:</strong> ${escHtml(m.body)}${
    time ? `<div style="font-size:10px;color:var(--text-dim);margin-top:2px;">${escHtml(time)}</div>` : ""
  }`;
  return el;
}

let unreadMessageCount = 0;
const chatBadge = document.getElementById("chat-badge");

function updateChatBadge() {
  if (unreadMessageCount > 0) {
    chatBadge.textContent = unreadMessageCount > 9 ? "9+" : String(unreadMessageCount);
    chatBadge.classList.remove("hidden");
  } else {
    chatBadge.classList.add("hidden");
  }
}

function appendChatMessageIfOpen(msg) {
  // Not just "does #chat-log exist" — closing the panel with the X button
  // hides it without clearing its contents, so the element can still be
  // in the DOM while the user isn't actually looking at it.
  const log = document.getElementById("chat-log");
  if (log && !panel.classList.contains("hidden")) {
    log.appendChild(chatMessageEl(msg));
    log.scrollTop = log.scrollHeight;
    return;
  }
  if (!session || msg.user_id !== session.user.id) {
    unreadMessageCount++;
    updateChatBadge();
  }
}

// Each signed-in crew member gets their own stable color (not just one
// blue dot for everyone) — assigned in the order they're first seen and
// kept for the rest of the session so a person's color doesn't shift
// around as the roster updates.
const MEMBER_COLORS = ["#2563eb", "#ec4899", "#f97316", "#22c55e", "#a855f7", "#eab308", "#06b6d4", "#ef4444"];
let memberColorAssignments = {};

function colorForMember(userId) {
  if (!memberColorAssignments[userId]) {
    const idx = Object.keys(memberColorAssignments).length % MEMBER_COLORS.length;
    memberColorAssignments[userId] = MEMBER_COLORS[idx];
  }
  return memberColorAssignments[userId];
}

let activeCrewRows = [];

function refreshMemberMarkers(rows) {
  const seen = new Set();
  rows.forEach((row) => {
    if (session && row.user_id === session.user.id) return; // don't show yourself
    seen.add(row.user_id);
    const name = row.profiles?.display_name || "Rider";
    const color = colorForMember(row.user_id);
    if (memberLocationMarkers[row.user_id]) {
      memberLocationMarkers[row.user_id].setLngLat([row.lng, row.lat]);
    } else {
      const el = document.createElement("div");
      el.style.cssText = `width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 0 0 2px rgba(0,0,0,0.25);`;
      memberLocationMarkers[row.user_id] = new maplibregl.Marker({ element: el })
        .setLngLat([row.lng, row.lat])
        .setPopup(new maplibregl.Popup({ offset: 12 }).setHTML(escHtml(name)))
        .addTo(map);
    }
  });
  Object.keys(memberLocationMarkers).forEach((uid) => {
    if (!seen.has(uid)) {
      memberLocationMarkers[uid].remove();
      delete memberLocationMarkers[uid];
    }
  });
  activeCrewRows = rows.filter((row) => !(session && row.user_id === session.user.id));
  renderCrewRoster();
}

// Who's currently on the map — shown at the top of the Chat panel. A
// no-op if that panel isn't open right now.
function renderCrewRoster() {
  const el = document.getElementById("crew-roster");
  if (!el) return;
  if (activeCrewRows.length === 0) {
    el.textContent = "No one else is on the map right now.";
    return;
  }
  el.innerHTML =
    `<div style="margin-bottom:4px;">${activeCrewRows.length} online:</div>` +
    activeCrewRows
      .map((row) => {
        const color = colorForMember(row.user_id);
        const name = row.profiles?.display_name || "Rider";
        return `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;"><span style="width:10px;height:10px;border-radius:50%;background:${color};display:inline-block;"></span>${escHtml(
          name
        )}</span>`;
      })
      .join("");
}

function startLocationBroadcast() {
  if (!("geolocation" in navigator) || locationBroadcastWatchId !== null) return;
  let lastSent = 0;
  let errorShown = false; // surface the first failure once, not on every 15s retry
  locationBroadcastWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const now = Date.now();
      if (now - lastSent < 15000) return; // throttle: at most every 15s
      lastSent = now;
      GroupBackend.updateMyLocation(pos.coords.latitude, pos.coords.longitude).catch((err) => {
        console.warn("Location broadcast failed:", err);
        if (!errorShown) {
          errorShown = true;
          alert("Couldn't share your location with the crew: " + err.message);
        }
      });
    },
    (err) => console.warn("Location broadcast GPS error:", err.message),
    { enableHighAccuracy: false, maximumAge: 10000 }
  );
}

function stopLocationBroadcast() {
  if (locationBroadcastWatchId !== null) {
    navigator.geolocation.clearWatch(locationBroadcastWatchId);
    locationBroadcastWatchId = null;
  }
}

// ---------- Init ----------
if (usingOnlineBasemap) {
  document.getElementById("map-hint").classList.add("hidden");
}
map.on("load", async () => {
  await refreshWaypointMarkers();
  await refreshPhotoMarkers();
  await initBreadcrumbTrail();
  checkMaintenanceReminders().catch((err) => console.warn("Maintenance reminder check failed:", err.message));
});

// ---------- Update detection ----------
// Deliberately not a silent auto-reload: swapping app code out from under
// an in-progress, unsaved trail ride recording would be worse than making
// the user tap a banner. sw.js holds a new worker in "waiting" until this
// tells it to take over (SKIP_WAITING), which is what makes a fresh push
// show up here without a hard refresh.
const updateBanner = document.getElementById("update-banner");
let waitingWorker = null;

function showUpdateBanner(worker) {
  waitingWorker = worker;
  // Auto-apply immediately when nothing's actually at risk — most opens
  // aren't mid-recording, and requiring a manual tap every single time
  // just to see the current version is the "why do I have to hard
  // refresh" problem this exists to avoid. Only fall back to the banner
  // (a deliberate, user-initiated update) when a GPS recording or
  // route-planning session is actually in progress and could be lost.
  if (!GpsRecorder.isRecording() && !planningRoute) {
    worker.postMessage({ type: "SKIP_WAITING" });
    return;
  }
  updateBanner.classList.remove("hidden");
}

updateBanner.addEventListener("click", () => {
  if (waitingWorker) {
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  } else {
    location.reload();
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    // GitHub Pages serves sw.js with `cache-control: max-age=600` (it
    // doesn't support per-file cache headers, so there's no way to ask
    // it not to) and won't let a browser bypass that for as long as 10
    // minutes — worse on iOS Safari, which is less reliable than Chrome
    // about forcing a real network check for service worker updates,
    // and worse still for a home-screen-installed PWA, which has no
    // reload button to force one with at all. Registering under a URL
    // that changes with the deployed version (not on every load — only
    // when version.json's `current` actually changes) sidesteps the
    // whole problem: a new deploy is a URL this device has never cached
    // before, so the browser has no choice but to fetch it fresh.
    let swUrl = "sw.js";
    try {
      const res = await fetch("version.json", { cache: "no-store" });
      const data = await res.json();
      if (data.current) swUrl = `sw.js?v=${encodeURIComponent(data.current)}`;
    } catch {
      // Offline or version.json unreachable — register the plain URL;
      // whatever's already cached/controlling still works either way.
    }
    navigator.serviceWorker
      .register(swUrl)
      .then((registration) => {
        if (registration.waiting && navigator.serviceWorker.controller) {
          showUpdateBanner(registration.waiting);
        }
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              showUpdateBanner(installing);
            }
          });
        });
        // Catches updates that land during a long-lived single-page
        // session (no navigation to trigger the browser's own check).
        setInterval(() => registration.update().catch(() => {}), 30 * 60 * 1000);
      })
      .catch((err) => {
        console.warn("Service worker registration failed:", err);
      });
  });

  // A brand-new install (no previous service worker for this origin) also
  // fires "controllerchange" the moment the very first worker calls
  // clients.claim() — that's not an update, there's nothing to reload
  // for, and reloading anyway defeats the whole point of this being a
  // deliberate, user-initiated action rather than a silent auto-reload.
  // Only genuinely reload when we're moving from an already-active
  // controller to a new one.
  let hadController = !!navigator.serviceWorker.controller;
  let reloadedForUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) {
      hadController = true;
      return;
    }
    if (reloadedForUpdate) return;
    reloadedForUpdate = true;
    location.reload();
  });
}

// ---------- Error reporting ----------
// A "tap to report" prompt on real uncaught errors, rather than relying
// on someone remembering to mention a bug after the fact. Anonymous-
// friendly (see sql/schema.sql) since plenty of the app works without an
// account at all. Deduped per unique message so one error thrown
// repeatedly (e.g. inside a GPS watch callback) doesn't spam the banner.
const errorBanner = document.getElementById("error-banner");
const reportedErrorMessages = new Set();
let pendingErrorReport = null;

function offerErrorReport(message, stack) {
  if (!message || reportedErrorMessages.has(message)) return;
  reportedErrorMessages.add(message);
  pendingErrorReport = { message, stack: stack || "" };
  errorBanner.classList.remove("hidden");
}

window.addEventListener("error", (event) => {
  offerErrorReport(event.error?.message || event.message, event.error?.stack);
});
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  offerErrorReport(reason?.message || String(reason), reason?.stack);
});

errorBanner.addEventListener("click", async () => {
  if (!pendingErrorReport) return;
  const report = pendingErrorReport;
  errorBanner.classList.add("hidden");
  pendingErrorReport = null;
  try {
    await GroupBackend.reportError({
      message: report.message,
      stack: report.stack,
      url: location.href,
      userAgent: navigator.userAgent,
      appVersion: btnVersion.textContent,
    });
    alert("Thanks — that's been reported.");
  } catch (err) {
    alert("Couldn't send the report: " + err.message);
  }
});
