import * as maplibregl from "../vendor/maplibre-gl/maplibre-gl.mjs";

// Register PMTiles as a MapLibre protocol so `pmtiles://...` sources work.
const pmtilesProtocol = new pmtiles.Protocol();
maplibregl.addProtocol("pmtiles", pmtilesProtocol.tile);

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
    },
  },
  layers: [{ id: "esri-satellite-layer", type: "raster", source: "esri-satellite" }],
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

const usingOnlineBasemap = navigator.onLine;

const map = new maplibregl.Map({
  container: "map",
  style: usingOnlineBasemap ? ONLINE_STYLE_URL : OFFLINE_FALLBACK_STYLE,
  center: [-84.39, 33.75], // roughly central southeast (Atlanta area)
  zoom: 6,
  attributionControl: true,
});
// If the online style URL itself fails to load (host down, no real
// connectivity despite navigator.onLine), fall back rather than leaving
// the map stuck mid-load with no explanation.
let onlineStyleFailed = false;
map.on("error", (e) => {
  const isStyleLoadError = usingOnlineBasemap && !onlineStyleFailed && !map.isStyleLoaded();
  if (isStyleLoadError) {
    onlineStyleFailed = true;
    console.warn("Online basemap failed to load, falling back to offline style:", e.error);
    map.setStyle(OFFLINE_FALLBACK_STYLE);
    document.getElementById("map-hint").classList.remove("hidden");
  }
});
map.addControl(new maplibregl.NavigationControl(), "bottom-right");
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
let currentBasemap = usingOnlineBasemap ? "streets" : "offline";
let activeRegionObjects = []; // regions currently activated, re-applied after every style switch

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

document.getElementById("btn-basemap")?.addEventListener("click", () => {
  switchBasemap(currentBasemap === "satellite" ? "streets" : "satellite");
});

// A style.load fires after every map.setStyle() call (including the
// first, initial one) — re-add whatever offline regions were active,
// since setStyle wipes all custom sources/layers.
map.on("style.load", () => {
  activeRegionObjects.forEach((region) => activateRegion(region));
  if (hillshadeOn) addHillshadeLayer();
  if (cellTowersOn) refreshCellTowerLayer().catch((err) => console.warn("Cell tower re-layer failed:", err));
  drawBreadcrumbLine();
});

// ---------- Breadcrumb trail (passive "everywhere I've been") ----------
// Distinct from Record: this runs continuously in the background whenever
// the app is open (throttled to conserve battery/storage), building up a
// permanent visual history across every visit — not one named session you
// start and stop. Local-only for now (not shared to the group).
const BREADCRUMB_SOURCE_ID = "breadcrumb-trail";
let breadcrumbPoints = [];
let breadcrumbWatchId = null;

function breadcrumbGeoJSON() {
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: breadcrumbPoints.map((p) => [p.lng, p.lat]) },
  };
}

function drawBreadcrumbLine() {
  if (breadcrumbPoints.length < 2) return;
  if (map.getSource(BREADCRUMB_SOURCE_ID)) {
    map.getSource(BREADCRUMB_SOURCE_ID).setData(breadcrumbGeoJSON());
    return;
  }
  map.addSource(BREADCRUMB_SOURCE_ID, { type: "geojson", data: breadcrumbGeoJSON() });
  // Insert below waypoint/trail markers but that's automatic (markers are
  // DOM elements, not style layers) — just add normally.
  // Bright pink/magenta at near-full opacity and a heavier width — the
  // previous pale gray at 50% opacity blended into the dark basemap and
  // was hard to spot. Not used by any other layer, so it reads clearly
  // as its own thing against the greens/blues/yellows everywhere else.
  map.addLayer({
    id: BREADCRUMB_SOURCE_ID,
    type: "line",
    source: BREADCRUMB_SOURCE_ID,
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#ec4899", "line-width": 3.5, "line-opacity": 0.9, "line-dasharray": [2, 1.5] },
  });
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
  if (map.getLayer(BREADCRUMB_SOURCE_ID)) map.removeLayer(BREADCRUMB_SOURCE_ID);
  if (map.getSource(BREADCRUMB_SOURCE_ID)) map.removeSource(BREADCRUMB_SOURCE_ID);
}

// ---------- Terrain hillshade (elevation relief) ----------
// AWS Terrain Tiles (free, public, no API key — a standard, widely-used
// source for exactly this) as a hillshade overlay, useful for spotting
// steep/technical terrain when planning a route. Online-only, like the
// satellite imagery — not cached for offline use.
let hillshadeOn = false;
const TERRAIN_SOURCE_ID = "aws-terrain-dem";

function addHillshadeLayer() {
  if (map.getSource(TERRAIN_SOURCE_ID)) return;
  map.addSource(TERRAIN_SOURCE_ID, {
    type: "raster-dem",
    tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
    tileSize: 256,
    encoding: "terrarium",
    attribution: "Terrain: AWS Terrain Tiles",
  });
  map.addLayer({
    id: "hillshade-layer",
    type: "hillshade",
    source: TERRAIN_SOURCE_ID,
    paint: { "hillshade-exaggeration": 0.6 },
  });
}

function removeHillshadeLayer() {
  if (map.getLayer("hillshade-layer")) map.removeLayer("hillshade-layer");
  if (map.getSource(TERRAIN_SOURCE_ID)) map.removeSource(TERRAIN_SOURCE_ID);
}

function toggleHillshade() {
  if (!navigator.onLine && !hillshadeOn) {
    alert("Terrain shading needs an internet connection — it isn't downloaded for offline use.");
    return;
  }
  hillshadeOn = !hillshadeOn;
  if (hillshadeOn) addHillshadeLayer();
  else removeHillshadeLayer();
  const btn = document.getElementById("btn-terrain");
  if (btn) btn.classList.toggle("active-pill", hillshadeOn);
}

document.getElementById("btn-terrain")?.addEventListener("click", toggleHillshade);

// ---------- Cell tower locations (rough coverage proxy) ----------
let cellTowersOn = false;
const CELL_SOURCE_ID = "cell-towers";

if (CellCoverage.enabled) {
  document.getElementById("btn-cell").classList.remove("hidden");
}

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
  const btn = document.getElementById("btn-cell");
  btn.classList.toggle("active-pill", cellTowersOn);
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
    btn.classList.remove("active-pill");
  }
}

document.getElementById("btn-cell")?.addEventListener("click", toggleCellTowers);

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

// Minimal escaping for any user-entered text we inject into innerHTML.
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------- Toolbar wiring ----------
const toolbarButtons = document.querySelectorAll("#toolbar button");
toolbarButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    toolbarButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const mode = btn.dataset.mode;
    if (mode === "record") openRecordPanel();
    if (mode === "waypoint") openWaypointPanel();
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

async function refreshWaypointMarkers() {
  activeWaypointMarkers.forEach((m) => m.remove());
  activeWaypointMarkers = [];
  const waypoints = await WaypointStore.listWaypoints();
  waypoints.forEach((wp) => {
    const color = CATEGORY_COLORS[wp.category] || CATEGORY_COLORS.other;
    const marker = new maplibregl.Marker({ color })
      .setLngLat([wp.lng, wp.lat])
      .setPopup(
        new maplibregl.Popup().setHTML(
          `<strong>${escHtml(wp.name)}</strong> <span style="color:#6b7280;">(${CATEGORY_LABELS[wp.category] || "Other"})</span><br>${escHtml(wp.note || "")}`
        )
      )
      .addTo(map);
    activeWaypointMarkers.push(marker);
  });
}

function openWaypointPanel() {
  openPanel(
    "Drop a Waypoint",
    `
    <p style="color:var(--text-dim);font-size:13px;">Uses your current map center. Pan the map first, then save.</p>
    <label>Name</label>
    <input id="wp-name" placeholder="e.g. Creek Crossing" />
    <label>Category</label>
    <select id="wp-category" style="width:100%;margin-top:6px;padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);">
      ${categoryOptionsHtml("other")}
    </select>
    <label>Note (optional)</label>
    <textarea id="wp-note" rows="2" placeholder="Notes..."></textarea>
    ${
      activeGroup
        ? `<label><input type="checkbox" id="wp-share" /> Share with ${escHtml(activeGroup.name)}</label>
           <label>Photo (optional, shared waypoints only)</label>
           <input type="file" id="wp-photo" accept="image/*" />`
        : ""
    }
    <button class="primary" id="wp-save">Save Waypoint Here</button>
    `
  );
  document.getElementById("wp-save").addEventListener("click", async () => {
    const name = document.getElementById("wp-name").value.trim() || "Unnamed waypoint";
    const category = document.getElementById("wp-category").value;
    const note = document.getElementById("wp-note").value.trim();
    const center = map.getCenter();
    await WaypointStore.saveWaypoint({ name, lat: center.lat, lng: center.lng, note, category });
    await refreshWaypointMarkers();

    const shareBox = document.getElementById("wp-share");
    if (shareBox && shareBox.checked && activeGroup) {
      const photoInput = document.getElementById("wp-photo");
      const photoFile = photoInput && photoInput.files[0] ? photoInput.files[0] : null;
      try {
        await GroupBackend.addWaypoint(activeGroup.id, {
          name,
          note,
          lat: center.lat,
          lng: center.lng,
          category,
          photoFile,
        });
      } catch (err) {
        alert("Saved locally, but could not share with group: " + err.message);
      }
    }
    closePanel();
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

function openRecordPanel() {
  if (GpsRecorder.isRecording()) {
    openPanel("Ride in progress", `<p>You're already tracking a ride. Use the Stop &amp; Save button on the map.</p>`);
    return;
  }
  if (planningRoute) {
    openPanel("Planning in progress", `<p>You're already planning a route. Use the Finish &amp; Save or Cancel button on the map.</p>`);
    return;
  }
  openPanel(
    "Start a Trail Ride",
    `
    <p style="color:var(--text-dim);font-size:13px;">Tracks your GPS position as you drive. Works fully offline — recording only needs the device's GPS, not the network.</p>
    <label>Trail name</label>
    <input id="rec-name" placeholder="e.g. Fire Road 42" />
    <button class="primary" id="rec-start">Start Trail Ride</button>
    <p style="color:var(--text-dim);font-size:13px;margin-top:14px;">Or lay out a route ahead of time by tapping points on the map — useful for planning before you head out.</p>
    <button class="primary" id="rec-plan" style="background:var(--panel);border:1px solid var(--accent-bright);">Plan a Route (tap map)</button>
    `
  );
  document.getElementById("rec-plan").addEventListener("click", () => {
    const name = document.getElementById("rec-name").value.trim() || "Unnamed route";
    startPlanningRoute(name);
    closePanel();
  });
  document.getElementById("rec-start").addEventListener("click", () => {
    const name = document.getElementById("rec-name").value.trim() || "Unnamed trail";
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
    window.__pendingTrailName = name;
    closePanel();
  });
}

document.getElementById("btn-stop-recording").addEventListener("click", async () => {
  const result = GpsRecorder.stop();
  clearInterval(recordingTimer);
  recordingHud.classList.add("hidden");
  recordingTime.textContent = "00:00";
  recordingDist.textContent = "0.00 mi";

  if (result.points.length < 2) {
    alert("Trail too short to save (need at least 2 GPS points).");
    return;
  }

  await TrailStore.saveTrail({
    name: window.__pendingTrailName || "Unnamed trail",
    kind: "recorded",
    points: result.points,
    distanceMeters: result.distanceMeters,
    startedAt: result.startedAt,
    endedAt: result.endedAt,
  });

  if (liveTrailSourceId) {
    map.removeLayer(liveTrailSourceId);
    map.removeSource(liveTrailSourceId);
    liveTrailSourceId = null;
  }
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
  await TrailStore.saveTrail({
    name,
    kind: "planned",
    points,
    distanceMeters: totalDistanceMeters(points),
    startedAt: null,
    endedAt: null,
  });
  alert(`Saved "${name}" — find it under My Trails.`);
});

// ---------- Offline regions ----------
async function openRegionsPanel() {
  const regions = await OfflineRegions.listWithStatus();
  const rows = regions
    .map(
      (r) => `
      <div class="region-item" data-name="${escHtml(r.name)}">
        <div>
          <div>${escHtml(r.label)}</div>
          <small>${r.downloaded ? "Downloaded — available offline" : "Not downloaded"}</small>
        </div>
        <button class="pill-btn ${r.downloaded ? "danger" : ""}" data-action="${r.downloaded ? "remove" : "download"}">
          ${r.downloaded ? "Remove" : "Download"}
        </button>
      </div>`
    )
    .join("");

  openPanel(
    "Offline Maps",
    `
    <p style="color:var(--text-dim);font-size:13px;">
      Download a region before you lose signal. See the README for how to generate
      a .pmtiles file for a new area.
    </p>
    ${rows || "<p>No regions declared in data/regions/regions-manifest.json yet.</p>"}
    `
  );

  panelBody.querySelectorAll(".region-item button").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const item = e.target.closest(".region-item");
      const name = item.dataset.name;
      const region = regions.find((r) => r.name === name);
      const action = e.target.dataset.action;
      if (action === "download") {
        e.target.textContent = "Downloading…";
        e.target.disabled = true;
        try {
          await OfflineRegions.download(region, (frac) => {
            e.target.textContent = `${Math.round(frac * 100)}%`;
          });
          activateRegion(region);
          openRegionsPanel();
        } catch (err) {
          alert(err.message);
          openRegionsPanel();
        }
      } else {
        await OfflineRegions.remove(region);
        openRegionsPanel();
      }
    });
  });
}

// Layer names below match the OpenMapTiles schema — what Planetiler's
// default profile outputs (the .github/workflows/build-region.yml CI job
// uses this to build real regions; confirmed against an actual built
// archive, not assumed). A Protomaps-basemap-schema archive (e.g. the
// bundled firenze-test.pmtiles fixture, or the README's "Option A") uses
// different layer names (earth/landuse/water/buildings/roads with a "kind"
// property) and won't render right here — regenerate it with the CI
// workflow to get this schema instead.
function activateRegion(region) {
  if (!activeRegionObjects.some((r) => r.name === region.name)) {
    activeRegionObjects.push(region);
  }
  const sourceId = `region-${region.name}`;
  if (map.getSource(sourceId)) return;
  document.getElementById("map-hint").classList.add("hidden");

  const cachedSource = OfflineRegions.getSource(region);
  pmtilesProtocol.add(new pmtiles.PMTiles(cachedSource));

  map.addSource(sourceId, {
    type: "vector",
    url: `pmtiles://${cachedSource.getKey()}`,
    attribution: region.attribution || "",
  });
  map.addLayer({
    id: `${sourceId}-landcover`,
    type: "fill",
    source: sourceId,
    "source-layer": "landcover",
    paint: { "fill-color": "#1e293b" },
  });
  map.addLayer({
    id: `${sourceId}-landuse`,
    type: "fill",
    source: sourceId,
    "source-layer": "landuse",
    paint: { "fill-color": "#243447", "fill-opacity": 0.6 },
  });
  map.addLayer({
    id: `${sourceId}-park`,
    type: "fill",
    source: sourceId,
    "source-layer": "park",
    paint: { "fill-color": "#14532d", "fill-opacity": 0.35 },
  });
  map.addLayer({
    id: `${sourceId}-water`,
    type: "fill",
    source: sourceId,
    "source-layer": "water",
    paint: { "fill-color": "#0c4a6e" },
  });
  map.addLayer({
    id: `${sourceId}-waterway`,
    type: "line",
    source: sourceId,
    "source-layer": "waterway",
    paint: { "line-color": "#0c4a6e", "line-width": 1 },
  });
  map.addLayer({
    id: `${sourceId}-buildings`,
    type: "fill",
    source: sourceId,
    "source-layer": "building",
    paint: { "fill-color": "#334155" },
  });
  map.addLayer({
    id: `${sourceId}-roads`,
    type: "line",
    source: sourceId,
    "source-layer": "transportation",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#94a3b8", "line-width": 1 },
  });
  // This app is for Jeep/OHV trail riding, not hiking — so unpaved
  // "track" ways (forest roads, 4x4 routes) get the prominent trail-green
  // highlight, while foot-only "path" ways (hiking singletrack) are drawn
  // thin and dim: still visible for context (e.g. knowing a route isn't
  // vehicle-passable) but not the primary highlight.
  map.addLayer({
    id: `${sourceId}-tracks`,
    type: "line",
    source: sourceId,
    "source-layer": "transportation",
    filter: ["==", ["get", "class"], "track"],
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#22c55e", "line-width": 2, "line-dasharray": [2, 1.5] },
  });
  map.addLayer({
    id: `${sourceId}-foot-paths`,
    type: "line",
    source: sourceId,
    "source-layer": "transportation",
    filter: ["==", ["get", "class"], "path"],
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#4d7c0f", "line-width": 1, "line-dasharray": [1, 2], "line-opacity": 0.6 },
  });
  map.addLayer({
    id: `${sourceId}-peaks`,
    type: "symbol",
    source: sourceId,
    "source-layer": "mountain_peak",
    layout: {
      "text-field": ["get", "name"],
      "text-size": 11,
      "text-offset": [0, 0.8],
      "text-anchor": "top",
    },
    paint: { "text-color": "#e2e8f0", "text-halo-color": "#0f172a", "text-halo-width": 1 },
  });
  // Points of interest relevant to trip planning (confirmed against the
  // actual poi layer classes in a real built region, not guessed): fuel,
  // campsite, parking, picnic_site, drinking_water, lodging, toilets.
  // Colored circle + short ASCII label instead of emoji: MapLibre's SDF
  // text rendering doesn't support color emoji without a sprite sheet —
  // tried that first, got "missing glyph" boxes in local testing, so
  // this renders as plain text instead, which is confirmed working (the
  // peak-name labels above use the same approach).
  map.addLayer({
    id: `${sourceId}-poi`,
    type: "circle",
    source: sourceId,
    "source-layer": "poi",
    minzoom: 12,
    filter: [
      "in",
      ["get", "class"],
      ["literal", ["fuel", "campsite", "parking", "picnic_site", "drinking_water", "lodging", "toilets"]],
    ],
    paint: {
      "circle-radius": 5,
      "circle-stroke-width": 1,
      "circle-stroke-color": "#0f172a",
      "circle-color": [
        "match",
        ["get", "class"],
        "fuel", "#f59e0b",
        "campsite", "#22c55e",
        "parking", "#60a5fa",
        "picnic_site", "#a78bfa",
        "drinking_water", "#38bdf8",
        "lodging", "#f472b6",
        "toilets", "#94a3b8",
        "#e2e8f0",
      ],
    },
  });
  map.addLayer({
    id: `${sourceId}-poi-label`,
    type: "symbol",
    source: sourceId,
    "source-layer": "poi",
    minzoom: 13,
    filter: [
      "in",
      ["get", "class"],
      ["literal", ["fuel", "campsite", "parking", "picnic_site", "drinking_water", "lodging", "toilets"]],
    ],
    layout: {
      "text-field": [
        "match",
        ["get", "class"],
        "fuel", "Fuel",
        "campsite", "Camp",
        "parking", "Parking",
        "picnic_site", "Picnic",
        "drinking_water", "Water",
        "lodging", "Lodging",
        "toilets", "Restroom",
        "POI",
      ],
      "text-size": 10,
      "text-offset": [0, 0.9],
      "text-anchor": "top",
    },
    paint: { "text-color": "#e2e8f0", "text-halo-color": "#0f172a", "text-halo-width": 1 },
  });
  if (region.bounds) {
    map.fitBounds(region.bounds, { padding: 20 });
  }
}

// Re-activate already-downloaded regions on load so offline maps show up
// immediately without re-fetching anything.
async function restoreDownloadedRegions() {
  const regions = await OfflineRegions.listWithStatus();
  regions.filter((r) => r.downloaded).forEach(activateRegion);
}

// ---------- Saved trails ----------
function difficultyLabel(d) {
  return d ? `Difficulty ${d}/10` : "Unrated";
}

async function openTrailsPanel() {
  const trails = await TrailStore.listTrails();
  const breadcrumbCount = await BreadcrumbStore.count();
  const rows = trails
    .map(
      (t) => `
      <div class="trail-item" data-id="${t.id}">
        <div>
          <div>${escHtml(t.name)} <small style="color:var(--text-dim);">${t.kind === "planned" ? "(planned)" : "(recorded)"}</small></div>
          <small>${metersToMiles(t.distanceMeters).toFixed(2)} mi · ${difficultyLabel(t.difficulty)} · ${new Date(t.createdAt).toLocaleDateString()}</small>
        </div>
        <div>
          <button class="pill-btn" data-action="show">Show</button>
          <button class="pill-btn" data-action="rate">Rate</button>
          <button class="pill-btn" data-action="export">GPX</button>
          ${activeGroup ? '<button class="pill-btn" data-action="share">Share</button>' : ""}
          <button class="pill-btn danger" data-action="delete">Delete</button>
        </div>
      </div>`
    )
    .join("");

  openPanel(
    "My Trails",
    `
    <div class="region-item">
      <div><div>Breadcrumb trail</div><small>${breadcrumbCount} points logged passively — everywhere you've been, not a named trail</small></div>
      <button class="pill-btn danger" id="clear-breadcrumb-btn">Clear</button>
    </div>
    ${rows || "<p>No saved trails yet. Tap Record to track one.</p>"}
    `
  );
  document.getElementById("clear-breadcrumb-btn").addEventListener("click", async () => {
    if (!confirm(`Clear all ${breadcrumbCount} breadcrumb points? This can't be undone.`)) return;
    await clearBreadcrumbTrail();
    openTrailsPanel();
  });

  panelBody.querySelectorAll(".trail-item button").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const id = Number(e.target.closest(".trail-item").dataset.id);
      const action = e.target.dataset.action;
      if (action === "delete") {
        await TrailStore.deleteTrail(id);
        openTrailsPanel();
      } else if (action === "rate") {
        const input = prompt("Technical difficulty, 1 (easy) to 10 (extreme). Leave blank to clear.");
        if (input === null) return;
        const value = input.trim() === "" ? null : Math.max(1, Math.min(10, parseInt(input, 10) || 0));
        await TrailStore.setDifficulty(id, value);
        openTrailsPanel();
      } else if (action === "export") {
        const trail = await TrailStore.getTrail(id);
        downloadFile(`${trail.name.replace(/[^a-z0-9]+/gi, "-")}.gpx`, trailToGpx(trail), "application/gpx+xml");
      } else if (action === "share") {
        const trail = await TrailStore.getTrail(id);
        try {
          await GroupBackend.addTrail(activeGroup.id, {
            name: trail.name,
            kind: trail.kind,
            points: trail.points,
            distanceMeters: trail.distanceMeters,
            difficulty: trail.difficulty,
          });
          alert(`Shared "${trail.name}" with ${activeGroup.name}.`);
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
}

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

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function showTrailOnMap(trail) {
  const sourceId = `saved-trail-${trail.id}`;
  const coords = trail.points.map((p) => [p.lng, p.lat]);
  const geojson = { type: "Feature", geometry: { type: "LineString", coordinates: coords } };

  if (map.getSource(sourceId)) {
    map.getSource(sourceId).setData(geojson);
  } else {
    map.addSource(sourceId, { type: "geojson", data: geojson });
    map.addLayer({
      id: sourceId,
      type: "line",
      source: sourceId,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#facc15", "line-width": 4 },
    });
  }

  const bounds = coords.reduce(
    (b, c) => b.extend(c),
    new maplibregl.LngLatBounds(coords[0], coords[0])
  );
  map.fitBounds(bounds, { padding: 40 });
}

// ---------- Group (accounts, chat, live locations, emergency) ----------
let session = null;
let activeGroup = null;
let memberLocationMarkers = {};
let locationBroadcastWatchId = null;
let chatChannel = null;
let locationChannel = null;
let emergencyChannel = null;

if (GroupBackend.enabled) {
  GroupBackend.getSession()
    .then((s) => {
      session = s;
    })
    .catch((err) => console.warn("Could not restore group session:", err));
  GroupBackend.onAuthChange((s) => {
    session = s;
    if (!s) leaveActiveGroup();
  });
}

async function openGroupPanel() {
  if (!GroupBackend.enabled) {
    openPanel(
      "Group",
      `<p style="color:var(--text-dim);font-size:13px;">Group features (chat, live locations, shared markers, emergency alerts) aren't set up yet — see js/group/config.js in the repo.</p>`
    );
    return;
  }
  if (!session) {
    renderAuthPanel();
    return;
  }
  if (!activeGroup) {
    await renderGroupsListPanel();
    return;
  }
  renderGroupDetailPanel();
}

function renderAuthPanel() {
  openPanel(
    "Sign In",
    `
    <label>Display name</label>
    <input id="auth-name" placeholder="What your group sees you as" />
    <label>Email</label>
    <input id="auth-email" type="email" placeholder="you@example.com" />
    <label>Password</label>
    <input id="auth-password" type="password" placeholder="At least 6 characters" />
    <button class="primary" id="auth-signin">Sign In</button>
    <button class="primary" id="auth-signup" style="background:var(--panel);border:1px solid var(--border);">Create Account</button>
    <p id="auth-error" style="color:var(--danger);font-size:13px;"></p>
    `
  );
  const showError = (err) => {
    document.getElementById("auth-error").textContent = err.message || String(err);
  };
  document.getElementById("auth-signin").addEventListener("click", async () => {
    try {
      const email = document.getElementById("auth-email").value.trim();
      const password = document.getElementById("auth-password").value;
      await GroupBackend.signIn(email, password);
      session = await GroupBackend.getSession();
      await renderGroupsListPanel();
    } catch (err) {
      showError(err);
    }
  });
  document.getElementById("auth-signup").addEventListener("click", async () => {
    try {
      const name = document.getElementById("auth-name").value.trim() || "Rider";
      const email = document.getElementById("auth-email").value.trim();
      const password = document.getElementById("auth-password").value;
      await GroupBackend.signUp(email, password, name);
      session = await GroupBackend.getSession();
      await renderGroupsListPanel();
    } catch (err) {
      showError(err);
    }
  });
}

async function renderGroupsListPanel() {
  let groups = [];
  try {
    groups = await GroupBackend.myGroups();
  } catch (err) {
    console.warn("Could not load groups:", err);
  }
  const rows = groups
    .map(
      (g) => `<div class="region-item" data-id="${g.id}">
        <div><div>${escHtml(g.name)}</div><small>Invite code: ${escHtml(g.invite_code)}</small></div>
        <button class="pill-btn" data-action="open">Open</button>
      </div>`
    )
    .join("");

  openPanel(
    "My Groups",
    `
    ${rows || '<p style="color:var(--text-dim);font-size:13px;">No groups yet.</p>'}
    <label>Create a new group</label>
    <input id="new-group-name" placeholder="e.g. Weekend Warriors" />
    <button class="primary" id="create-group-btn">Create Group</button>
    <label>Join a group</label>
    <input id="join-group-code" placeholder="6-character invite code" style="text-transform:uppercase;" />
    <button class="primary" id="join-group-btn">Join Group</button>
    <button class="primary" id="sign-out-btn" style="background:var(--panel);border:1px solid var(--border);margin-top:16px;">Sign Out</button>
    <p id="group-error" style="color:var(--danger);font-size:13px;"></p>
    `
  );
  const showError = (err) => {
    document.getElementById("group-error").textContent = err.message || String(err);
  };
  panelBody.querySelectorAll('.region-item button[data-action="open"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.closest(".region-item").dataset.id;
      const group = groups.find((g) => g.id === id);
      await selectGroup(group);
    });
  });
  document.getElementById("create-group-btn").addEventListener("click", async () => {
    try {
      const name = document.getElementById("new-group-name").value.trim();
      if (!name) return;
      const group = await GroupBackend.createGroup(name);
      await selectGroup(group);
    } catch (err) {
      showError(err);
    }
  });
  document.getElementById("join-group-btn").addEventListener("click", async () => {
    try {
      const code = document.getElementById("join-group-code").value.trim();
      if (!code) return;
      const group = await GroupBackend.joinGroup(code);
      await selectGroup(group);
    } catch (err) {
      showError(err);
    }
  });
  document.getElementById("sign-out-btn").addEventListener("click", async () => {
    await GroupBackend.signOut();
    session = null;
    leaveActiveGroup();
    closePanel();
  });
}

async function selectGroup(group) {
  activeGroup = group;
  document.getElementById("btn-emergency").classList.remove("hidden");
  startLocationBroadcast();
  locationChannel = GroupBackend.subscribeLocations(group.id, refreshMemberMarkers);
  chatMessages = [];
  chatChannel = GroupBackend.subscribeMessages(group.id, (msg) => {
    chatMessages.push(msg);
    appendChatMessageIfOpen(msg);
  });
  emergencyChannel = GroupBackend.subscribeEmergency(group.id, (emergencyAlert) => {
    if (emergencyAlert.raised_by === session.user.id) return; // don't alarm the person who raised it
    window.alert(`🆘 Emergency alert from your group!${emergencyAlert.message ? "\n" + emergencyAlert.message : ""}`);
  });
  renderGroupDetailPanel();
}

function leaveActiveGroup() {
  activeGroup = null;
  document.getElementById("btn-emergency").classList.add("hidden");
  stopLocationBroadcast();
  if (locationChannel) locationChannel.unsubscribe();
  if (chatChannel) chatChannel.unsubscribe();
  if (emergencyChannel) emergencyChannel.unsubscribe();
  locationChannel = chatChannel = emergencyChannel = null;
  Object.values(memberLocationMarkers).forEach((m) => m.remove());
  memberLocationMarkers = {};
}

let chatMessages = [];

function renderGroupDetailPanel() {
  openPanel(
    escHtml(activeGroup.name),
    `
    <p style="color:var(--text-dim);font-size:12px;">Invite code: <strong style="color:var(--text);">${escHtml(activeGroup.invite_code)}</strong> — share this so others can join.</p>
    <div id="chat-log" style="max-height:220px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:8px;margin:8px 0;"></div>
    <div style="display:flex;gap:6px;">
      <input id="chat-input" placeholder="Message the group..." style="margin-top:0;flex:1;" />
      <button class="pill-btn" id="chat-send">Send</button>
    </div>
    <button class="primary" id="open-folders-btn" style="background:var(--panel);border:1px solid var(--accent-bright);margin-top:12px;">Trip Folders</button>
    <button class="primary" id="back-to-groups-btn" style="background:var(--panel);border:1px solid var(--border);">Switch Group</button>
    `
  );
  const log = document.getElementById("chat-log");
  chatMessages.forEach((m) => log.appendChild(chatMessageEl(m)));
  log.scrollTop = log.scrollHeight;

  const send = async () => {
    const input = document.getElementById("chat-input");
    const body = input.value.trim();
    if (!body) return;
    input.value = "";
    try {
      await GroupBackend.sendMessage(activeGroup.id, body);
    } catch (err) {
      alert("Could not send message: " + err.message);
    }
  };
  document.getElementById("chat-send").addEventListener("click", send);
  document.getElementById("chat-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") send();
  });
  document.getElementById("open-folders-btn").addEventListener("click", openFoldersPanel);
  document.getElementById("back-to-groups-btn").addEventListener("click", () => {
    leaveActiveGroup();
    renderGroupsListPanel();
  });
}

// ---------- Trip folders ----------
async function openFoldersPanel() {
  let folders = [];
  try {
    folders = await GroupBackend.listFolders(activeGroup.id);
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
      await GroupBackend.createFolder(activeGroup.id, name, description);
      openFoldersPanel();
    } catch (err) {
      alert("Could not create folder: " + err.message);
    }
  });
  document.getElementById("back-to-group-btn").addEventListener("click", renderGroupDetailPanel);
}

async function openFolderDetailPanel(folder) {
  const [waypoints, trails] = await Promise.all([
    GroupBackend.listWaypoints(activeGroup.id),
    GroupBackend.listTrails(activeGroup.id),
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
  el.style.fontSize = "13px";
  el.style.marginBottom = "6px";
  const name = m.profiles?.display_name || "Rider";
  el.innerHTML = `<strong>${escHtml(name)}:</strong> ${escHtml(m.body)}`;
  return el;
}

function appendChatMessageIfOpen(msg) {
  const log = document.getElementById("chat-log");
  if (!log) return; // panel isn't showing chat right now
  log.appendChild(chatMessageEl(msg));
  log.scrollTop = log.scrollHeight;
}

function refreshMemberMarkers(rows) {
  const seen = new Set();
  rows.forEach((row) => {
    if (session && row.user_id === session.user.id) return; // don't show yourself
    seen.add(row.user_id);
    const name = row.profiles?.display_name || "Rider";
    if (memberLocationMarkers[row.user_id]) {
      memberLocationMarkers[row.user_id].setLngLat([row.lng, row.lat]);
    } else {
      const el = document.createElement("div");
      el.style.cssText =
        "width:14px;height:14px;border-radius:50%;background:#2563eb;border:2px solid white;box-shadow:0 0 0 2px rgba(37,99,235,0.4);";
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
}

function startLocationBroadcast() {
  if (!("geolocation" in navigator) || locationBroadcastWatchId !== null) return;
  let lastSent = 0;
  locationBroadcastWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const now = Date.now();
      if (now - lastSent < 15000) return; // throttle: at most every 15s
      lastSent = now;
      GroupBackend.updateMyLocation(activeGroup.id, pos.coords.latitude, pos.coords.longitude).catch((err) =>
        console.warn("Location broadcast failed:", err)
      );
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

document.getElementById("btn-emergency").addEventListener("click", async () => {
  if (!activeGroup) return;
  if (!confirm("Send an emergency alert to your whole group right now?")) return;
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      try {
        await GroupBackend.raiseEmergency(activeGroup.id, {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          message: "",
        });
        alert("Emergency alert sent to your group.");
      } catch (err) {
        alert("Could not send alert: " + err.message);
      }
    },
    async () => {
      try {
        await GroupBackend.raiseEmergency(activeGroup.id, { lat: null, lng: null, message: "" });
        alert("Emergency alert sent (location unavailable).");
      } catch (err) {
        alert("Could not send alert: " + err.message);
      }
    }
  );
});

// ---------- Init ----------
if (usingOnlineBasemap) {
  document.getElementById("map-hint").classList.add("hidden");
}
map.on("load", async () => {
  await refreshWaypointMarkers();
  await restoreDownloadedRegions();
  await initBreadcrumbTrail();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  });
}
