// Thin wrapper around the Supabase client for every shared/social feature:
// auth, shared waypoints/trails (with photos + ratings), live location, and
// chat. There's no "group" concept — every signed-in
// user shares one space, scoped only by auth.uid() for writes and
// "authenticated" for reads. See sql/schema.sql for the tables/policies
// this talks to, and js/group/config.js for how to activate it.
//
// If Supabase isn't configured, `GroupBackend.enabled` is false and every
// method rejects with a clear error — callers check `.enabled` first
// (see js/app.js's group UI) so the app's local-only features are
// completely unaffected either way.
const GroupBackend = (() => {
  if (!GroupConfig.isConfigured) {
    const disabled = () => Promise.reject(new Error("Group features aren't configured yet (see js/group/config.js)."));
    return {
      enabled: false,
      onAuthChange: () => {},
      getSession: disabled,
      signUp: disabled,
      signIn: disabled,
      signOut: disabled,
      createFolder: disabled,
      listFolders: disabled,
      addWaypoint: disabled,
      listWaypoints: disabled,
      subscribeWaypoints: disabled,
      addTrail: disabled,
      setTrailRating: disabled,
      setTrailDifficulty: disabled,
      listTrails: disabled,
      assignWaypointFolder: disabled,
      assignTrailFolder: disabled,
      uploadPhoto: disabled,
      photoUrl: disabled,
      addPhoto: disabled,
      listPhotos: disabled,
      subscribePhotos: disabled,
      deletePhoto: disabled,
      updateMyLocation: disabled,
      subscribeLocations: disabled,
      sendMessage: disabled,
      subscribeMessages: disabled,
      reportError: disabled,
      upsertPersonalTrail: disabled,
      listPersonalTrails: disabled,
      deletePersonalTrail: disabled,
      upsertPersonalWaypoint: disabled,
      listPersonalWaypoints: disabled,
      deletePersonalWaypoint: disabled,
      upsertPersonalVehicle: disabled,
      listPersonalVehicles: disabled,
      deletePersonalVehicle: disabled,
      uploadMaintenanceReceipt: disabled,
      maintenanceReceiptUrl: disabled,
      upsertPersonalMaintenanceRecord: disabled,
      listPersonalMaintenanceRecords: disabled,
      deletePersonalMaintenanceRecord: disabled,
    };
  }

  const client = supabase.createClient(GroupConfig.url, GroupConfig.anonKey);

  function currentUserId() {
    return client.auth.getUser().then(({ data }) => data.user?.id);
  }

  // ---------- Auth ----------
  async function signUp(email, password, displayName) {
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) throw error;
    // If the project requires email confirmation, signUp() succeeds but
    // data.session is null until the user clicks the confirmation link —
    // there's no authenticated request possible yet, so skip the profile
    // write rather than let it fail RLS silently (the caller checks
    // data.session itself to tell the user what's going on).
    if (data.user && data.session) {
      const { error: profileError } = await client.from("profiles").upsert({ id: data.user.id, display_name: displayName });
      if (profileError) throw profileError;
    }
    return data;
  }

  async function signIn(email, password) {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    const { error } = await client.auth.signOut();
    if (error) throw error;
  }

  async function getSession() {
    const { data } = await client.auth.getSession();
    return data.session;
  }

  function onAuthChange(callback) {
    client.auth.onAuthStateChange((_event, session) => callback(session));
  }

  // ---------- Trip folders ----------
  async function createFolder(name, description) {
    const uid = await currentUserId();
    const { data, error } = await client
      .from("folders")
      .insert({ created_by: uid, name, description: description || "" })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function listFolders() {
    const { data, error } = await client.from("folders").select().order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }

  // ---------- Shared waypoints ----------
  // category: 'trailhead' | 'campsite' | 'fuel' | 'water_crossing' | 'obstacle' | 'hazard' | 'other'
  async function addWaypoint({ name, note, lat, lng, category, severity, folderId, photoFile }) {
    const uid = await currentUserId();
    let photo_path = null;
    if (photoFile) photo_path = await uploadPhoto(photoFile);
    const { data, error } = await client
      .from("shared_waypoints")
      .insert({
        created_by: uid,
        name,
        note: note || "",
        lat,
        lng,
        category: category || "other",
        severity: severity || null,
        folder_id: folderId || null,
        photo_path,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function listWaypoints() {
    const { data, error } = await client
      .from("shared_waypoints")
      .select("*, profiles(display_name)")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }

  function subscribeWaypoints(onUpdate) {
    listWaypoints().then((data) => data && onUpdate(data));
    return client
      .channel("shared-waypoints")
      .on("postgres_changes", { event: "*", schema: "public", table: "shared_waypoints" }, () =>
        listWaypoints().then((data) => data && onUpdate(data))
      )
      .subscribe();
  }

  // ---------- Shared trails ----------
  async function addTrail({ name, kind, points, distanceMeters, difficulty, folderId, photoFile }) {
    const uid = await currentUserId();
    let photo_path = null;
    if (photoFile) photo_path = await uploadPhoto(photoFile);
    const { data, error } = await client
      .from("shared_trails")
      .insert({
        created_by: uid,
        name,
        kind: kind || "recorded",
        points,
        distance_meters: distanceMeters,
        difficulty: difficulty || null,
        folder_id: folderId || null,
        photo_path,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function setTrailRating(trailId, rating) {
    // rating: 'favorite' | 'bad' | null
    const { error } = await client.from("shared_trails").update({ rating }).eq("id", trailId);
    if (error) throw error;
  }

  async function setTrailDifficulty(trailId, difficulty) {
    // difficulty: 1-10 or null
    const { error } = await client.from("shared_trails").update({ difficulty }).eq("id", trailId);
    if (error) throw error;
  }

  async function listTrails() {
    const { data, error } = await client.from("shared_trails").select().order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }

  async function assignWaypointFolder(waypointId, folderId) {
    const { error } = await client.from("shared_waypoints").update({ folder_id: folderId }).eq("id", waypointId);
    if (error) throw error;
  }

  async function assignTrailFolder(trailId, folderId) {
    const { error } = await client.from("shared_trails").update({ folder_id: folderId }).eq("id", trailId);
    if (error) throw error;
  }

  // ---------- Photos ----------
  async function uploadPhoto(file) {
    const uid = await currentUserId();
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${uid}/${Date.now()}.${ext}`;
    const { error } = await client.storage.from("trail-photos").upload(path, file);
    if (error) throw error;
    return path;
  }

  async function photoUrl(path) {
    const { data, error } = await client.storage.from("trail-photos").createSignedUrl(path, 3600);
    if (error) throw error;
    return data.signedUrl;
  }

  // ---------- Shared photos (snap-and-tag, standalone — see js/app.js's
  // Tools panel Photo row) ----------
  async function addPhoto({ lat, lng, note, photoFile }) {
    const uid = await currentUserId();
    const photo_path = await uploadPhoto(photoFile);
    const { data, error } = await client
      .from("shared_photos")
      .insert({ created_by: uid, lat, lng, note: note || "", photo_path })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function listPhotos() {
    const { data, error } = await client
      .from("shared_photos")
      .select("*, profiles(display_name)")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }

  function subscribePhotos(onUpdate) {
    listPhotos().then((data) => data && onUpdate(data));
    return client
      .channel("shared-photos")
      .on("postgres_changes", { event: "*", schema: "public", table: "shared_photos" }, () =>
        listPhotos().then((data) => data && onUpdate(data))
      )
      .subscribe();
  }

  async function deletePhoto(photoId) {
    const { error } = await client.from("shared_photos").delete().eq("id", photoId);
    if (error) throw error;
  }

  // ---------- Live location ----------
  async function updateMyLocation(lat, lng) {
    const uid = await currentUserId();
    const { error } = await client
      .from("locations")
      .upsert({ user_id: uid, lat, lng, updated_at: new Date().toISOString() });
    if (error) throw error;
  }

  function subscribeLocations(onUpdate) {
    client
      .from("locations")
      .select("*, profiles(display_name)")
      .then(({ data }) => data && onUpdate(data));

    return client
      .channel("locations")
      .on("postgres_changes", { event: "*", schema: "public", table: "locations" }, () => {
        client
          .from("locations")
          .select("*, profiles(display_name)")
          .then(({ data }) => data && onUpdate(data));
      })
      .subscribe();
  }

  // ---------- Chat ----------
  async function sendMessage(body) {
    const uid = await currentUserId();
    const { error } = await client.from("messages").insert({ user_id: uid, body });
    if (error) throw error;
  }

  function subscribeMessages(onMessage) {
    client
      .from("messages")
      .select("*, profiles(display_name)")
      .order("created_at", { ascending: true })
      .limit(100)
      .then(({ data }) => data && data.forEach(onMessage));

    return client
      .channel("messages")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        client
          .from("profiles")
          .select("display_name")
          .eq("id", payload.new.user_id)
          .single()
          .then(({ data }) => onMessage({ ...payload.new, profiles: data }));
      })
      .subscribe();
  }

  // ---------- Error reports ----------
  // Anonymous-friendly on purpose (see the RLS policy in sql/schema.sql):
  // most of the app works without an account, and bugs hit there matter
  // just as much. reported_by is best-effort — a failed lookup shouldn't
  // block the report itself.
  async function reportError({ message, stack, url, userAgent, appVersion }) {
    let uid = null;
    try {
      uid = await currentUserId();
    } catch {
      // Not signed in, or no session — report anonymously.
    }
    const { error } = await client.from("error_reports").insert({
      message,
      stack: stack || null,
      url: url || null,
      user_agent: userAgent || null,
      app_version: appVersion || null,
      reported_by: uid || null,
    });
    if (error) throw error;
  }

  // ---------- Personal sync (private backup of My Content) ----------
  // Unlike everything above — which is deliberately shared with every
  // signed-in user — these mirror a user's own local trails/waypoints
  // (js/db.js's TrailStore/WaypointStore) so they survive a lost phone or
  // carry over to a new device. RLS on personal_trails/personal_waypoints
  // (see sql/schema.sql) restricts every operation, including select, to
  // auth.uid() = user_id: nobody else can ever read these, unlike the
  // shared_* tables' "any authenticated user" read policy. The actual
  // push/pull merge logic lives in js/app.js's syncPersonalData(), which
  // matches local <-> remote rows by the remoteId this module hands back.
  async function upsertPersonalTrail(trail) {
    const uid = await currentUserId();
    const row = {
      user_id: uid,
      name: trail.name,
      kind: trail.kind,
      points: trail.points,
      distance_meters: trail.distanceMeters,
      started_at: trail.startedAt,
      ended_at: trail.endedAt,
      difficulty: trail.difficulty,
      created_at: trail.createdAt,
    };
    if (trail.remoteId) row.id = trail.remoteId; // update in place; omitted on first push so Postgres assigns a fresh uuid
    const { data, error } = await client.from("personal_trails").upsert(row).select().single();
    if (error) throw error;
    return data;
  }

  async function listPersonalTrails() {
    const { data, error } = await client.from("personal_trails").select("*");
    if (error) throw error;
    return data;
  }

  async function deletePersonalTrail(remoteId) {
    const { error } = await client.from("personal_trails").delete().eq("id", remoteId);
    if (error) throw error;
  }

  async function upsertPersonalWaypoint(wp) {
    const uid = await currentUserId();
    const row = {
      user_id: uid,
      name: wp.name,
      lat: wp.lat,
      lng: wp.lng,
      note: wp.note || "",
      category: wp.category || "other",
      severity: wp.severity || null,
      created_at: wp.createdAt,
    };
    if (wp.remoteId) row.id = wp.remoteId;
    const { data, error } = await client.from("personal_waypoints").upsert(row).select().single();
    if (error) throw error;
    return data;
  }

  async function listPersonalWaypoints() {
    const { data, error } = await client.from("personal_waypoints").select("*");
    if (error) throw error;
    return data;
  }

  async function deletePersonalWaypoint(remoteId) {
    const { error } = await client.from("personal_waypoints").delete().eq("id", remoteId);
    if (error) throw error;
  }

  // ---------- Vehicle maintenance (private — no shared/crew variant) ----------
  async function upsertPersonalVehicle(vehicle) {
    const uid = await currentUserId();
    const row = {
      user_id: uid,
      name: vehicle.name,
      year: vehicle.year,
      make: vehicle.make || "",
      model: vehicle.model || "",
      odometer: vehicle.odometer,
      created_at: vehicle.createdAt,
    };
    if (vehicle.remoteId) row.id = vehicle.remoteId;
    const { data, error } = await client.from("personal_vehicles").upsert(row).select().single();
    if (error) throw error;
    return data;
  }

  async function listPersonalVehicles() {
    const { data, error } = await client.from("personal_vehicles").select("*");
    if (error) throw error;
    return data;
  }

  async function deletePersonalVehicle(remoteId) {
    const { error } = await client.from("personal_vehicles").delete().eq("id", remoteId);
    if (error) throw error;
  }

  // A private bucket, unlike uploadPhoto's trail-photos (any authenticated
  // user can read that one) — see the storage.foldername RLS policies in
  // sql/schema.sql. record.receiptData is an ArrayBuffer (see
  // MaintenanceStore.saveRecord's comment on why it's not a Blob).
  async function uploadMaintenanceReceipt(receiptData, receiptType) {
    const uid = await currentUserId();
    const ext = (receiptType || "image/jpeg").split("/").pop() || "jpg";
    const path = `${uid}/${Date.now()}.${ext}`;
    const blob = new Blob([receiptData], { type: receiptType || "image/jpeg" });
    const { error } = await client.storage.from("maintenance-receipts").upload(path, blob);
    if (error) throw error;
    return path;
  }

  async function maintenanceReceiptUrl(path) {
    const { data, error } = await client.storage.from("maintenance-receipts").createSignedUrl(path, 3600);
    if (error) throw error;
    return data.signedUrl;
  }

  // record is the local record (see MaintenanceStore) — its vehicleId is
  // a local Dexie id, meaningless remotely, so the caller passes the
  // vehicle's own already-synced remoteId separately. Uploads the
  // receipt on first sync only (record.receiptRemotePath set after that,
  // same remoteId pattern as everything else).
  async function upsertPersonalMaintenanceRecord(record, vehicleRemoteId) {
    const uid = await currentUserId();
    let receipt_path = record.receiptRemotePath || null;
    if (!receipt_path && record.receiptData) {
      receipt_path = await uploadMaintenanceReceipt(record.receiptData, record.receiptType);
    }
    const row = {
      user_id: uid,
      vehicle_id: vehicleRemoteId,
      type: record.type,
      date: record.date,
      miles: record.miles,
      cost: record.cost,
      note: record.note || "",
      receipt_path,
      reminder_date: record.reminderDate || null,
      created_at: record.createdAt,
    };
    if (record.remoteId) row.id = record.remoteId;
    const { data, error } = await client.from("personal_maintenance_records").upsert(row).select().single();
    if (error) throw error;
    return data;
  }

  async function listPersonalMaintenanceRecords() {
    const { data, error } = await client.from("personal_maintenance_records").select("*");
    if (error) throw error;
    return data;
  }

  async function deletePersonalMaintenanceRecord(remoteId) {
    const { error } = await client.from("personal_maintenance_records").delete().eq("id", remoteId);
    if (error) throw error;
  }

  return {
    enabled: true,
    onAuthChange,
    getSession,
    signUp,
    signIn,
    signOut,
    createFolder,
    listFolders,
    addWaypoint,
    listWaypoints,
    subscribeWaypoints,
    addTrail,
    setTrailRating,
    setTrailDifficulty,
    listTrails,
    assignWaypointFolder,
    assignTrailFolder,
    uploadPhoto,
    photoUrl,
    addPhoto,
    listPhotos,
    subscribePhotos,
    deletePhoto,
    updateMyLocation,
    subscribeLocations,
    sendMessage,
    subscribeMessages,
    reportError,
    upsertPersonalTrail,
    listPersonalTrails,
    deletePersonalTrail,
    upsertPersonalWaypoint,
    listPersonalWaypoints,
    deletePersonalWaypoint,
    upsertPersonalVehicle,
    listPersonalVehicles,
    deletePersonalVehicle,
    uploadMaintenanceReceipt,
    maintenanceReceiptUrl,
    upsertPersonalMaintenanceRecord,
    listPersonalMaintenanceRecords,
    deletePersonalMaintenanceRecord,
  };
})();
