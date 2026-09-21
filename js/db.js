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

const TrailStore = {
  async saveTrail({ name, kind, points, distanceMeters, startedAt, endedAt }) {
    return db.trails.add({
      name,
      kind: kind || "recorded", // 'recorded' (GPS-tracked) | 'planned' (drawn on the map ahead of time)
      points, // [{ lat, lng, ele, t }]
      distanceMeters,
      startedAt,
      endedAt,
      createdAt: Date.now(),
    });
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

const WaypointStore = {
  async saveWaypoint({ name, lat, lng, note }) {
    return db.waypoints.add({ name, lat, lng, note: note || "", createdAt: Date.now() });
  },
  async listWaypoints() {
    return db.waypoints.orderBy("createdAt").reverse().toArray();
  },
  async deleteWaypoint(id) {
    return db.waypoints.delete(id);
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
