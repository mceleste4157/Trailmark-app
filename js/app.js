import * as maplibregl from "../vendor/maplibre-gl/maplibre-gl.mjs";

// Register PMTiles as a MapLibre protocol so `pmtiles://...` sources work.
const pmtilesProtocol = new pmtiles.Protocol();
maplibregl.addProtocol("pmtiles", pmtilesProtocol.tile);

const DEFAULT_STYLE = {
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

const map = new maplibregl.Map({
  container: "map",
  style: DEFAULT_STYLE,
  center: [-84.39, 33.75], // roughly central southeast (Atlanta area)
  zoom: 6,
  attributionControl: true,
});
map.addControl(new maplibregl.NavigationControl(), "bottom-right");
map.addControl(
  new maplibregl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true },
    trackUserLocation: true,
    showUserHeading: true,
  }),
  "bottom-right"
);

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
  });
});

// ---------- Waypoints ----------
async function refreshWaypointMarkers() {
  activeWaypointMarkers.forEach((m) => m.remove());
  activeWaypointMarkers = [];
  const waypoints = await WaypointStore.listWaypoints();
  waypoints.forEach((wp) => {
    const marker = new maplibregl.Marker({ color: "#facc15" })
      .setLngLat([wp.lng, wp.lat])
      .setPopup(new maplibregl.Popup().setHTML(`<strong>${escHtml(wp.name)}</strong><br>${escHtml(wp.note || "")}`))
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
    <input id="wp-name" placeholder="e.g. Trailhead, Water source" />
    <label>Note (optional)</label>
    <textarea id="wp-note" rows="2" placeholder="Notes..."></textarea>
    <button class="primary" id="wp-save">Save Waypoint Here</button>
    `
  );
  document.getElementById("wp-save").addEventListener("click", async () => {
    const name = document.getElementById("wp-name").value.trim() || "Unnamed waypoint";
    const note = document.getElementById("wp-note").value.trim();
    const center = map.getCenter();
    await WaypointStore.saveWaypoint({ name, lat: center.lat, lng: center.lng, note });
    await refreshWaypointMarkers();
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
    openPanel("Recording in progress", `<p>A trail is already being recorded. Use the Stop &amp; Save button on the map.</p>`);
    return;
  }
  openPanel(
    "Record a Trail",
    `
    <p style="color:var(--text-dim);font-size:13px;">Tracks your GPS position as you move. Works fully offline — recording only needs the device's GPS, not the network.</p>
    <label>Trail name</label>
    <input id="rec-name" placeholder="e.g. Blood Mountain Loop" />
    <button class="primary" id="rec-start">Start Recording</button>
    `
  );
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
  const sourceId = `region-${region.name}`;
  if (map.getSource(sourceId)) return;

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
  // Foot/cycle paths and tracks — the closest thing to "trails" in this
  // schema — pulled out of the transportation layer and drawn in
  // trail-green. OpenMapTiles' "class" values for these are "path" and
  // "track"; "subclass" narrows further (footway, cycleway, bridleway,
  // steps, path).
  map.addLayer({
    id: `${sourceId}-trails`,
    type: "line",
    source: sourceId,
    "source-layer": "transportation",
    filter: ["in", ["get", "class"], ["literal", ["path", "track"]]],
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#22c55e", "line-width": 1.5, "line-dasharray": [2, 1.5] },
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
async function openTrailsPanel() {
  const trails = await TrailStore.listTrails();
  const rows = trails
    .map(
      (t) => `
      <div class="trail-item" data-id="${t.id}">
        <div>
          <div>${escHtml(t.name)}</div>
          <small>${metersToMiles(t.distanceMeters).toFixed(2)} mi · ${new Date(t.createdAt).toLocaleDateString()}</small>
        </div>
        <div>
          <button class="pill-btn" data-action="show">Show</button>
          <button class="pill-btn danger" data-action="delete">Delete</button>
        </div>
      </div>`
    )
    .join("");

  openPanel("My Trails", rows || "<p>No saved trails yet. Tap Record to track one.</p>");

  panelBody.querySelectorAll(".trail-item button").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const id = Number(e.target.closest(".trail-item").dataset.id);
      if (e.target.dataset.action === "delete") {
        await TrailStore.deleteTrail(id);
        openTrailsPanel();
      } else {
        const trail = await TrailStore.getTrail(id);
        showTrailOnMap(trail);
        closePanel();
      }
    });
  });
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

// ---------- Init ----------
map.on("load", async () => {
  await refreshWaypointMarkers();
  await restoreDownloadedRegions();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  });
}
