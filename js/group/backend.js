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
    if (data.user) {
      await client.from("profiles").upsert({ id: data.user.id, display_name: displayName });
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
  async function addWaypoint({ name, note, lat, lng, category, folderId, photoFile }) {
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
  // toolbar Photo button) ----------
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
  };
})();
