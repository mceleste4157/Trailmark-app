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

db.version(6).stores({
  trails: "++id, name, createdAt",
  waypoints: "++id, name, createdAt",
  regions: null,
  breadcrumbs: "++id, t",
  customAreas: "++id, &name, downloadedAt",
  photos: "++id, createdAt",
  // Personal trip folders ("Windrock weekend") — local-only, not synced
  // to Supabase (unlike the trails/waypoints they group), since they're
  // purely an on-device organizing tool. See TripFolderStore below.
  tripFolders: "++id, name, createdAt",
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
      folderId: null, // local-only trip folder — see TripFolderStore
    });
  },
  async setDifficulty(id, difficulty) {
    return db.trails.update(id, { difficulty });
  },
  async renameTrail(id, name) {
    return db.trails.update(id, { name });
  },
  async assignFolder(id, folderId) {
    return db.trails.update(id, { folderId: folderId || null });
  },
  // Overwrites a trail's points in place (id, name, etc. untouched) — used
  // to backfill real elevation from USGS after the fact. See
  // backfillTrailElevation() in js/app.js.
  async updateTrailPoints(id, points) {
    return db.trails.update(id, { points });
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
  // severity: 1 (minor) - 3 (major) — only meaningful for the
  // water_crossing/obstacle/hazard categories (enforced client-side, see
  // WAYPOINT_SEVERITY_CATEGORIES in js/app.js); null/omitted otherwise.
  async saveWaypoint({ name, lat, lng, note, category, severity }) {
    return db.waypoints.add({
      name,
      lat,
      lng,
      note: note || "",
      category: category || "other",
      severity: severity || null,
      createdAt: Date.now(),
      remoteId: null, // set once this waypoint has been pushed to personal_waypoints — see syncPersonalData() in js/app.js
      folderId: null, // local-only trip folder — see TripFolderStore
    });
  },
  async listWaypoints() {
    return db.waypoints.orderBy("createdAt").reverse().toArray();
  },
  async getWaypoint(id) {
    return db.waypoints.get(id);
  },
  async updateWaypoint(id, { name, note, category, severity }) {
    return db.waypoints.update(id, { name, note, category, severity: severity || null });
  },
  async moveWaypoint(id, lat, lng) {
    return db.waypoints.update(id, { lat, lng });
  },
  async assignFolder(id, folderId) {
    return db.waypoints.update(id, { folderId: folderId || null });
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

// Local-only grouping of personal trails/waypoints into a named trip
// ("Windrock weekend") — deliberately not synced to Supabase, unlike the
// trails/waypoints themselves, since it's just an on-device organizing
// tool rather than data worth backing up. See openPersonalFoldersPanel
// in js/app.js.
const TripFolderStore = {
  async createFolder(name) {
    return db.tripFolders.add({ name, createdAt: Date.now() });
  },
  async listFolders() {
    return db.tripFolders.orderBy("createdAt").reverse().toArray();
  },
  async renameFolder(id, name) {
    return db.tripFolders.update(id, { name });
  },
  // Un-assigns this folder from every trail/waypoint that had it before
  // deleting it, so nothing is left pointing at a folderId that no
  // longer exists. filter() rather than where(), since folderId isn't
  // (and doesn't need to be) an indexed field — these tables are small.
  async deleteFolder(id) {
    await db.trails.filter((t) => t.folderId === id).modify({ folderId: null });
    await db.waypoints.filter((w) => w.folderId === id).modify({ folderId: null });
    return db.tripFolders.delete(id);
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
  // Stores the photo's raw bytes (data) + mime type (type) rather than
  // the Blob/File object itself — some WebKit versions (notably Safari,
  // including recent iOS releases) fail to structured-clone a Blob/File
  // into IndexedDB at all ("UnknownError: Error preparing Blob/File data
  // to be stored in object store"), even though an ArrayBuffer of the
  // exact same bytes stores fine. Reconstruct a Blob from these on read
  // (see refreshPhotoMarkers in js/app.js) — object URLs need one.
  async savePhoto({ lat, lng, note, blob }) {
    const data = await blob.arrayBuffer();
    return db.photos.add({ lat, lng, note: note || "", data, type: blob.type, createdAt: Date.now() });
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
