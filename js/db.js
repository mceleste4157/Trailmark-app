// Local-first storage. Everything the app needs to function offline lives
// here in IndexedDB — no network round-trip required to read or write.
const db = new Dexie("trailmark");

db.version(1).stores({
  // Recorded trails: a GPX-like track of GPS points recorded over time.
  trails: "++id, name, createdAt",
  // Standalone waypoints (pins) not tied to a recorded trail.
  waypoints: "++id, name, createdAt",
  // Metadata for downloaded offline map regions (the .pmtiles files
  // themselves live in data/regions/, this just tracks what's available).
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
    });
  },
  async setDifficulty(id, difficulty) {
    return db.trails.update(id, { difficulty });
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
    });
  },
  async listWaypoints() {
    return db.waypoints.orderBy("createdAt").reverse().toArray();
  },
  async deleteWaypoint(id) {
    return db.waypoints.delete(id);
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

const RegionStore = {
  async registerRegion(name) {
    return db.regions.put({ name, downloadedAt: Date.now() });
  },
  async listRegions() {
    return db.regions.toArray();
  },
  async removeRegion(name) {
    return db.regions.where("name").equals(name).delete();
  },
};
