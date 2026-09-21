// Group features (accounts, shared waypoints/trails, live location, chat)
// need a Supabase project — Trailmark can't create one
// for you, but it's free and takes a few minutes:
//
// 1. Go to https://supabase.com, sign up, "New project" (free tier).
// 2. Once it's created: Project Settings -> API. Copy the "Project URL"
//    and the "anon public" key (NOT the service_role key — that one must
//    never appear in client code) into the two constants below.
// 3. Project Settings -> SQL Editor -> New query -> paste the contents of
//    sql/schema.sql from this repo -> Run. This creates every table,
//    security policy, and storage bucket the group features use.
// 4. Authentication -> Providers: Email is on by default, which is enough
//    to get started. Redeploy the app (push to main) and group features
//    go live automatically — everything below checks for this config and
//    simply stays hidden/disabled until it's filled in.
const SUPABASE_URL = "https://nvbtwgigniodfumjukdo.supabase.co";
// This is the "publishable" key (new sb_publishable_... format, the
// equivalent of the old "anon" key) — safe to ship in client code. Never
// put a "secret"/service_role key here.
const SUPABASE_ANON_KEY = "sb_publishable_6F7NiQxUXnMJXNCh8YL7kA_R97zntAB";

const GroupConfig = {
  isConfigured: Boolean(SUPABASE_URL && SUPABASE_ANON_KEY),
  url: SUPABASE_URL,
  anonKey: SUPABASE_ANON_KEY,
};
