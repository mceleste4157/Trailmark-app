// Local-first storage. Everything the app needs to function offline lives
// here in IndexedDB — no network round-trip required to read or write.
const db = new Dexie("trailmark");

db.version(1).stores({
  // Recorded trails: a GPX-like track of GPS points recorded over time.
  trails: "++id, name, createdAt",
  // Standalone waypoints (pins) not tied to a recorded trail.
  waypoints: "++id, name, createdAt",
  // Metadata for downloaded offline map regions (dropped in v5 — see
  // below — in favor of the user-drawn CustomAreaStore).
  regions: "++id, &name, downloadedAt",
});

db.version(2).stores({
  trails: "++id, name, createdAt",
  waypoints: "++id, name, createdAt",
  regions: "++id, &name, downloadedAt",
  // Passive "everywhere I've been" trail — separate from an explicit
  // Record session. Always accumulates in the background (throttled)
  // whenever the app is open and location is available, so you can see
  // at a glance which trails/routes you've already driven, across every
  // visit, not just one recorded session.
  breadcrumbs: "++id, t",
});

db.version(3).stores({
  trails: "++id, name, createdAt",
  waypoints: "++id, name, createdAt",
  regions: "++id, &name, downloadedAt",
  breadcrumbs: "++id, t",
  // User-drawn offline downloads of the online basemap — pan/zoom
  // anywhere, download that exact view, not limited to a fixed set of
  // curated regions. The actual tiles live in the browser's Cache
  // Storage (see sw.js's ONLINE_TILES_CACHE); this just tracks what's
  // been downloaded so it can be listed/removed.
  customAreas: "++id, &name, downloadedAt",
});

db.version(4).stores({
  trails: "++id, name, createdAt",
  waypoints: "++id, name, createdAt",
  regions: "++id, &name, downloadedAt",
  breadcrumbs: "++id, t",
  customAreas: "++id, &name, downloadedAt",
  // Geotagged photos — snapped via the toolbar's Photo button. The image
  // itself is stored as a Blob (IndexedDB stores these natively, no
  // base64 encoding needed) alongside the GPS fix taken at the same time.
  photos: "++id, createdAt",
});

db.version(5).stores({
  trails: "++id, name, createdAt",
  waypoints: "++id, name, createdAt",
  // Prebuilt offline regions (curated .pmtiles archives) were removed in
  // favor of "Download This Area" (CustomAreaStore below) — drop the now
  // unused table.
  regions: null,
  breadcrumbs: "++id, t",
  customAreas: "++id, &name, downloadedAt",
  photos: "++id, createdAt",
});

const TrailStore = {
  async saveTrail({ name, kind, points, distanceMeters, startedAt, endedAt, difficulty }) {
    return db.trails.add({
      name,
      kind: kind || "recorded", // 'recorded' (GPS-tracked) | 'planned' (drawn on the map ahead of time)
      points, // [{ lat, lng, ele, t }]
      distanceMeters,
      startedAt,
      endedAt,
      difficulty: difficulty || null, // 1-10, onX-style technical difficulty rating
      createdAt: Date.now(),
      remoteId: null, // set once this trail has been pushed to personal_trails — see syncPersonalData() in js/app.js
    });
  },
  async setDifficulty(id, difficulty) {
    return db.trails.update(id, { difficulty });
  },
  async renameTrail(id, name) {
    return db.trails.update(id, { name });
  },
  async listTrails() {
    return db.trails.orderBy("createdAt").reverse().toArray();
  },
  async deleteTrail(id) {
    return db.trails.delete(id);
  },
  async getTrail(id) {
    return db.trails.get(id);
  },
  // Re-inserts a full trail record (including its original id) for the
  // "Undo" toast right after a delete — a plain add() would hand it a new
  // id and silently orphan anything that still referenced the old one.
  async restoreTrail(trail) {
    return db.trails.put(trail);
  },
  async setRemoteId(id, remoteId) {
    return db.trails.update(id, { remoteId });
  },
  // Inserts a trail pulled down from personal_trails on another device —
  // a plain saveTrail() would stamp createdAt as "now" and leave
  // remoteId unset, which would make the very next sync push it right
  // back up as if it were a brand new local trail.
  async importSynced(trail) {
    return db.trails.add(trail);
  },
};

// trailhead | campsite | fuel | water_crossing | obstacle | hazard | other
const WAYPOINT_CATEGORIES = ["trailhead", "campsite", "fuel", "water_crossing", "obstacle", "hazard", "other"];

const WaypointStore = {
  async saveWaypoint({ name, lat, lng, note, category }) {
    return db.waypoints.add({
      name,
      lat,
      lng,
      note: note || "",
      category: category || "other",
      createdAt: Date.now(),
      remoteId: null, // set once this waypoint has been pushed to personal_waypoints — see syncPersonalData() in js/app.js
    });
  },
  async listWaypoints() {
    return db.waypoints.orderBy("createdAt").reverse().toArray();
  },
  async getWaypoint(id) {
    return db.waypoints.get(id);
  },
  async updateWaypoint(id, { name, note, category }) {
    return db.waypoints.update(id, { name, note, category });
  },
  async moveWaypoint(id, lat, lng) {
    return db.waypoints.update(id, { lat, lng });
  },
  async deleteWaypoint(id) {
    return db.waypoints.delete(id);
  },
  // Re-inserts a full waypoint record (including its original id) for the
  // "Undo" toast right after a delete.
  async restoreWaypoint(wp) {
    return db.waypoints.put(wp);
  },
  async setRemoteId(id, remoteId) {
    return db.waypoints.update(id, { remoteId });
  },
  // Inserts a waypoint pulled down from personal_waypoints on another
  // device — see TrailStore.importSynced's comment for why this can't
  // just be saveWaypoint().
  async importSynced(wp) {
    return db.waypoints.add(wp);
  },
};

const BreadcrumbStore = {
  async addPoint(lat, lng) {
    return db.breadcrumbs.add({ lat, lng, t: Date.now() });
  },
  async allPoints() {
    return db.breadcrumbs.orderBy("t").toArray();
  },
  async count() {
    return db.breadcrumbs.count();
  },
  async clear() {
    return db.breadcrumbs.clear();
  },
};

const CustomAreaStore = {
  async save({ name, bounds, minZoom, maxZoom, tileCount }) {
    return db.customAreas.put({ name, bounds, minZoom, maxZoom, tileCount, downloadedAt: Date.now() });
  },
  async list() {
    return db.customAreas.orderBy("downloadedAt").reverse().toArray();
  },
  async remove(name) {
    return db.customAreas.where("name").equals(name).delete();
  },
};

const PhotoStore = {
  async savePhoto({ lat, lng, note, blob }) {
    return db.photos.add({ lat, lng, note: note || "", blob, createdAt: Date.now() });
  },
  async listPhotos() {
    return db.photos.orderBy("createdAt").reverse().toArray();
  },
  async getPhoto(id) {
    return db.photos.get(id);
  },
  async deletePhoto(id) {
    return db.photos.delete(id);
  },
};
