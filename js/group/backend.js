// Thin wrapper around the Supabase client for every group feature: auth,
// groups, shared waypoints/trails (with photos + ratings), live location,
// chat, and emergency alerts. See sql/schema.sql for the tables/policies
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
      myGroups: disabled,
      createGroup: disabled,
      joinGroup: disabled,
      addWaypoint: disabled,
      listWaypoints: disabled,
      addTrail: disabled,
      setTrailRating: disabled,
      listTrails: disabled,
      uploadPhoto: disabled,
      photoUrl: disabled,
      updateMyLocation: disabled,
      subscribeLocations: disabled,
      sendMessage: disabled,
      subscribeMessages: disabled,
      raiseEmergency: disabled,
      resolveEmergency: disabled,
      subscribeEmergency: disabled,
    };
  }

  const client = supabase.createClient(GroupConfig.url, GroupConfig.anonKey);

  function inviteCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I ambiguity
    let code = "";
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

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

  // ---------- Groups ----------
  async function createGroup(name) {
    const uid = await currentUserId();
    if (!uid) throw new Error("Sign in first.");
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = inviteCode();
      const { data, error } = await client
        .from("groups")
        .insert({ name, invite_code: code, created_by: uid })
        .select()
        .single();
      if (!error) {
        await client.from("group_members").insert({ group_id: data.id, user_id: uid, role: "owner" });
        return data;
      }
      if (error.code !== "23505") throw error; // 23505 = unique_violation on invite_code, retry
    }
    throw new Error("Could not generate a unique invite code — try again.");
  }

  async function joinGroup(code) {
    const uid = await currentUserId();
    if (!uid) throw new Error("Sign in first.");
    const { data: group, error: findError } = await client
      .from("groups")
      .select()
      .eq("invite_code", code.trim().toUpperCase())
      .single();
    if (findError || !group) throw new Error("No group found with that invite code.");
    const { error } = await client.from("group_members").insert({ group_id: group.id, user_id: uid });
    if (error && error.code !== "23505") throw error; // already a member is fine
    return group;
  }

  async function myGroups() {
    const { data, error } = await client.from("groups").select("*, group_members!inner(role)").order("created_at");
    if (error) throw error;
    return data;
  }

  // ---------- Shared waypoints ----------
  async function addWaypoint(groupId, { name, note, lat, lng, photoFile }) {
    const uid = await currentUserId();
    let photo_path = null;
    if (photoFile) photo_path = await uploadPhoto(groupId, photoFile);
    const { data, error } = await client
      .from("group_waypoints")
      .insert({ group_id: groupId, created_by: uid, name, note: note || "", lat, lng, photo_path })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function listWaypoints(groupId) {
    const { data, error } = await client
      .from("group_waypoints")
      .select()
      .eq("group_id", groupId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }

  // ---------- Shared trails ----------
  async function addTrail(groupId, { name, kind, points, distanceMeters, photoFile }) {
    const uid = await currentUserId();
    let photo_path = null;
    if (photoFile) photo_path = await uploadPhoto(groupId, photoFile);
    const { data, error } = await client
      .from("group_trails")
      .insert({
        group_id: groupId,
        created_by: uid,
        name,
        kind: kind || "recorded",
        points,
        distance_meters: distanceMeters,
        photo_path,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function setTrailRating(trailId, rating) {
    // rating: 'favorite' | 'bad' | null
    const { error } = await client.from("group_trails").update({ rating }).eq("id", trailId);
    if (error) throw error;
  }

  async function listTrails(groupId) {
    const { data, error } = await client
      .from("group_trails")
      .select()
      .eq("group_id", groupId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }

  // ---------- Photos ----------
  async function uploadPhoto(groupId, file) {
    const uid = await currentUserId();
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${groupId}/${uid}-${Date.now()}.${ext}`;
    const { error } = await client.storage.from("trail-photos").upload(path, file);
    if (error) throw error;
    return path;
  }

  async function photoUrl(path) {
    const { data, error } = await client.storage.from("trail-photos").createSignedUrl(path, 3600);
    if (error) throw error;
    return data.signedUrl;
  }

  // ---------- Live location ----------
  async function updateMyLocation(groupId, lat, lng) {
    const uid = await currentUserId();
    const { error } = await client
      .from("group_locations")
      .upsert({ group_id: groupId, user_id: uid, lat, lng, updated_at: new Date().toISOString() });
    if (error) throw error;
  }

  function subscribeLocations(groupId, onUpdate) {
    client
      .from("group_locations")
      .select("*, profiles(display_name)")
      .eq("group_id", groupId)
      .then(({ data }) => data && onUpdate(data));

    return client
      .channel(`locations-${groupId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "group_locations", filter: `group_id=eq.${groupId}` },
        () => {
          client
            .from("group_locations")
            .select("*, profiles(display_name)")
            .eq("group_id", groupId)
            .then(({ data }) => data && onUpdate(data));
        }
      )
      .subscribe();
  }

  // ---------- Chat ----------
  async function sendMessage(groupId, body) {
    const uid = await currentUserId();
    const { error } = await client.from("group_messages").insert({ group_id: groupId, user_id: uid, body });
    if (error) throw error;
  }

  function subscribeMessages(groupId, onMessage) {
    client
      .from("group_messages")
      .select("*, profiles(display_name)")
      .eq("group_id", groupId)
      .order("created_at", { ascending: true })
      .limit(100)
      .then(({ data }) => data && data.forEach(onMessage));

    return client
      .channel(`messages-${groupId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "group_messages", filter: `group_id=eq.${groupId}` },
        (payload) => {
          client
            .from("profiles")
            .select("display_name")
            .eq("id", payload.new.user_id)
            .single()
            .then(({ data }) => onMessage({ ...payload.new, profiles: data }));
        }
      )
      .subscribe();
  }

  // ---------- Emergency ----------
  async function raiseEmergency(groupId, { lat, lng, message }) {
    const uid = await currentUserId();
    const { data, error } = await client
      .from("group_emergency_alerts")
      .insert({ group_id: groupId, raised_by: uid, lat, lng, message: message || "" })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function resolveEmergency(alertId) {
    const { error } = await client
      .from("group_emergency_alerts")
      .update({ resolved_at: new Date().toISOString() })
      .eq("id", alertId);
    if (error) throw error;
  }

  function subscribeEmergency(groupId, onAlert) {
    return client
      .channel(`emergency-${groupId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "group_emergency_alerts", filter: `group_id=eq.${groupId}` },
        (payload) => onAlert(payload.new)
      )
      .subscribe();
  }

  return {
    enabled: true,
    onAuthChange,
    getSession,
    signUp,
    signIn,
    signOut,
    myGroups,
    createGroup,
    joinGroup,
    addWaypoint,
    listWaypoints,
    addTrail,
    setTrailRating,
    listTrails,
    uploadPhoto,
    photoUrl,
    updateMyLocation,
    subscribeLocations,
    sendMessage,
    subscribeMessages,
    raiseEmergency,
    resolveEmergency,
    subscribeEmergency,
  };
})();
