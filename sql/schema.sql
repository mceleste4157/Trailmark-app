-- Trailmark shared-crew schema (Supabase / Postgres)
--
-- Run this once in your Supabase project's SQL Editor (Dashboard -> SQL
-- Editor -> New query -> paste -> Run). Safe to re-run: it drops and
-- recreates everything below `profiles`, so re-running just resets it —
-- EXCEPT the `groups`/`group_members` tables further down, which use
-- `create table if not exists` specifically so a re-run never wipes real
-- crew-group membership/data (see the "Crew groups" section below).
--
-- Design: every signed-in user can create or join a named, password-
-- protected group (see "Crew groups" below); shared waypoints/trails/
-- photos, live location, and chat are all scoped to your current group,
-- plus your own rows are always visible to you even if ungrouped.
-- Local-only features (map, GPS recording, offline maps, local waypoints
-- and photos) never need an account at all.
--
-- An EARLIER version of this schema tried a "groups" concept, hit an RLS
-- policy recursion bug, and reverted to one flat shared space for everyone
-- — the "groups" section below is a second attempt, structured
-- specifically to avoid that bug (see the comment there for how).

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ---------- Drop the old per-group schema, if present ----------
-- These specific table names (group_waypoints, group_trails, etc.) are
-- one-time historical cleanup from the earlier reverted attempt and are
-- NOT reused by the new "Crew groups" section below — `groups` and
-- `group_members` are deliberately NOT dropped here anymore (they used
-- to be), since this script is re-run periodically and dropping them on
-- every re-run would destroy real group membership data going forward.
drop table if exists group_photos cascade;
drop table if exists group_trip_folders cascade;
drop table if exists group_waypoints cascade;
drop table if exists group_trails cascade;
drop table if exists group_locations cascade;
drop table if exists group_emergency_alerts cascade;
drop table if exists group_messages cascade;

-- ---------- Drop emergency alerts (SOS feature removed) ----------
drop table if exists emergency_alerts cascade;

-- ---------- Profiles ----------
-- Supabase Auth already has auth.users; this adds the display name field
-- the app needs, 1:1 with an auth user.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

drop policy if exists "profiles are readable by anyone authenticated" on profiles;
create policy "profiles are readable by anyone authenticated"
  on profiles for select
  using (auth.role() = 'authenticated');

drop policy if exists "users can update their own profile" on profiles;
create policy "users can update their own profile"
  on profiles for update
  using (auth.uid() = id);

drop policy if exists "users can insert their own profile" on profiles;
create policy "users can insert their own profile"
  on profiles for insert
  with check (auth.uid() = id);

-- ---------- Crew groups ----------
-- A named, password-protected group — create one and share the name +
-- password with your crew so you can all join it and see each other.
-- Each user belongs to at most one group at a time (group_members.user_id
-- is its own primary key, not part of a composite key) — joining or
-- creating a different group just replaces your membership row.
--
-- Every operation on these two tables goes through the SECURITY DEFINER
-- functions below instead of direct table access (both tables have RLS
-- enabled with zero policies, so direct access is refused outright, even
-- to a row's own owner). That's not just to keep the password hash out of
-- reach — the earlier "groups" attempt referenced at the top of this file
-- was reverted specifically because an RLS policy that queries
-- group_members (directly, or transitively through another table's own
-- policy) can trigger "infinite recursion detected in policy for relation
-- group_members". A SECURITY DEFINER function's internal queries run with
-- the function owner's privileges and bypass RLS entirely, so they don't
-- have that problem — is_group_member() below is what every other
-- group-scoped table's RLS policy calls instead of querying
-- group_members directly.
create table if not exists groups (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  password_hash text not null,
  -- Nullable + set null on delete (not "not null" like when this table
  -- was first written): deleting the creator's account must not destroy
  -- the group out from under its other members — see delete_my_account()
  -- near the end of this file.
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table groups alter column created_by drop not null;
alter table groups drop constraint if exists groups_created_by_fkey;
alter table groups add constraint groups_created_by_fkey foreign key (created_by) references profiles(id) on delete set null;

create table if not exists group_members (
  user_id uuid primary key references profiles(id) on delete cascade,
  group_id uuid not null references groups(id) on delete cascade,
  joined_at timestamptz not null default now()
);

alter table groups enable row level security;
alter table group_members enable row level security;

create or replace function is_group_member(check_group_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from group_members
    where user_id = auth.uid() and group_id = check_group_id
  );
$$;

-- What group (if any) the signed-in user is currently in — the client
-- calls this once after sign-in / on load to know whether to show "join
-- or create a group" or the normal crew UI.
create or replace function my_group()
returns table(group_id uuid, group_name text)
language sql
security definer
stable
set search_path = public
as $$
  select g.id, g.name
  from group_members gm
  join groups g on g.id = gm.group_id
  where gm.user_id = auth.uid();
$$;

create or replace function create_group(p_name text, p_password text)
returns table(group_id uuid, group_name text)
language plpgsql
security definer
-- crypt()/gen_salt() (pgcrypto) live in the `extensions` schema on
-- Supabase, not `public` — needs to be on the search path explicitly,
-- since `set search_path` here replaces the caller's path rather than
-- adding to it (that's also why it's pinned to just these two schemas
-- instead of left to inherit whatever the caller's path happens to be).
set search_path = public, extensions
as $$
declare
  new_id uuid;
  clean_name text := trim(p_name);
begin
  if clean_name = '' then
    raise exception 'Group name is required';
  end if;
  if p_password is null or length(p_password) < 4 then
    raise exception 'Group password must be at least 4 characters';
  end if;

  insert into groups (name, password_hash, created_by)
  values (clean_name, crypt(p_password, gen_salt('bf')), auth.uid())
  returning id into new_id;

  insert into group_members (user_id, group_id)
  values (auth.uid(), new_id)
  on conflict (user_id) do update set group_id = excluded.group_id, joined_at = now();

  return query select new_id, clean_name;
end;
$$;

create or replace function join_group(p_name text, p_password text)
returns table(group_id uuid, group_name text)
language plpgsql
security definer
set search_path = public, extensions -- crypt() lives in extensions on Supabase — see create_group's comment above
as $$
declare
  found_id uuid;
  found_name text;
  found_hash text;
begin
  select id, name, password_hash into found_id, found_name, found_hash
  from groups
  where lower(name) = lower(trim(p_name));

  if found_id is null then
    raise exception 'No group found with that name';
  end if;

  if crypt(p_password, found_hash) <> found_hash then
    raise exception 'Incorrect group password';
  end if;

  insert into group_members (user_id, group_id)
  values (auth.uid(), found_id)
  on conflict (user_id) do update set group_id = excluded.group_id, joined_at = now();

  return query select found_id, found_name;
end;
$$;

create or replace function leave_group()
returns void
language sql
security definer
set search_path = public
as $$
  delete from group_members where user_id = auth.uid();
$$;

-- ---------- Trip folders ----------
-- Groups waypoints + trails into a named trip (e.g. "Saturday Windrock
-- run"). Shared with your crew group, same as everything else here.
create table if not exists folders (
  id uuid primary key default uuid_generate_v4(),
  -- Nullable + set null on delete, same reasoning as groups.created_by
  -- above: deleting the creator's account shouldn't take the folder (and
  -- everything filed in it) down with them.
  created_by uuid references auth.users(id) on delete set null,
  name text not null,
  description text default '',
  group_id uuid references groups(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table folders alter column created_by drop not null;
alter table folders drop constraint if exists folders_created_by_fkey;
alter table folders add constraint folders_created_by_fkey foreign key (created_by) references profiles(id) on delete set null;

alter table folders add column if not exists group_id uuid references groups(id) on delete cascade;

alter table folders enable row level security;

drop policy if exists "authenticated users can read folders" on folders;
drop policy if exists "creator or group members can read folders" on folders;
create policy "creator or group members can read folders"
  on folders for select
  using (auth.uid() = created_by or (group_id is not null and is_group_member(group_id)));

drop policy if exists "authenticated users can create folders" on folders;
drop policy if exists "group members can create folders" on folders;
create policy "group members can create folders"
  on folders for insert
  with check (auth.role() = 'authenticated' and auth.uid() = created_by and (group_id is null or is_group_member(group_id)));

drop policy if exists "creators can update their own folders" on folders;
create policy "creators can update their own folders"
  on folders for update
  using (auth.uid() = created_by);

drop policy if exists "creators can delete their own folders" on folders;
create policy "creators can delete their own folders"
  on folders for delete
  using (auth.uid() = created_by);

-- ---------- Shared waypoints (markers with descriptions + optional photo) ----------
create table if not exists shared_waypoints (
  id uuid primary key default uuid_generate_v4(),
  -- References profiles(id), not auth.users(id) directly — PostgREST can
  -- only embed `profiles(display_name)` in a select (as the app does to
  -- show who dropped something) across an actual foreign key, and it
  -- won't infer one transitively through a third table both merely
  -- reference. See the migration block below for existing databases.
  -- Nullable + set null on delete: deleting the creator's account
  -- anonymizes their shared waypoints rather than deleting the crew's
  -- shared history out from under everyone else — see delete_my_account().
  created_by uuid references profiles(id) on delete set null,
  name text not null,
  note text default '',
  lat double precision not null,
  lng double precision not null,
  category text not null default 'other', -- trailhead | campsite | fuel | water_crossing | obstacle | hazard | other (enforced client-side)
  severity smallint check (severity is null or severity between 1 and 3), -- 1 (minor) - 3 (major); only meaningful for water_crossing/obstacle/hazard (enforced client-side)
  folder_id uuid references folders(id) on delete set null,
  photo_path text, -- path within the 'trail-photos' storage bucket, if any
  group_id uuid references groups(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- create table is a no-op on a database where this table already
-- existed before the severity/group_id columns above were added, so add
-- them explicitly too — idempotent, safe to re-run.
alter table shared_waypoints add column if not exists severity smallint check (severity is null or severity between 1 and 3);
alter table shared_waypoints add column if not exists group_id uuid references groups(id) on delete cascade;
alter table shared_waypoints alter column created_by drop not null;
alter table shared_waypoints drop constraint if exists shared_waypoints_created_by_fkey;
alter table shared_waypoints add constraint shared_waypoints_created_by_fkey foreign key (created_by) references profiles(id) on delete set null;

alter table shared_waypoints enable row level security;

drop policy if exists "authenticated users can read shared waypoints" on shared_waypoints;
drop policy if exists "creator or group members can read shared waypoints" on shared_waypoints;
create policy "creator or group members can read shared waypoints"
  on shared_waypoints for select
  using (auth.uid() = created_by or (group_id is not null and is_group_member(group_id)));

drop policy if exists "authenticated users can add shared waypoints" on shared_waypoints;
drop policy if exists "group members can add shared waypoints" on shared_waypoints;
create policy "group members can add shared waypoints"
  on shared_waypoints for insert
  with check (auth.role() = 'authenticated' and auth.uid() = created_by and (group_id is null or is_group_member(group_id)));

drop policy if exists "creators can update their own shared waypoints" on shared_waypoints;
create policy "creators can update their own shared waypoints"
  on shared_waypoints for update
  using (auth.uid() = created_by);

drop policy if exists "creators can delete their own shared waypoints" on shared_waypoints;
create policy "creators can delete their own shared waypoints"
  on shared_waypoints for delete
  using (auth.uid() = created_by);

-- ---------- Shared trails (recorded rides + planned routes, with rating) ----------
create table if not exists shared_trails (
  id uuid primary key default uuid_generate_v4(),
  -- References profiles(id), not auth.users(id) directly — see the note
  -- on shared_waypoints above. (This table was missed when the others
  -- were migrated; fixed here so a future "by <rider>" on shared trails,
  -- same as waypoints/photos already have, doesn't quietly fail RLS/
  -- PostgREST embedding the way theirs did.)
  -- Nullable + set null on delete, same reasoning as shared_waypoints above.
  created_by uuid references profiles(id) on delete set null,
  name text not null,
  kind text not null default 'recorded', -- 'recorded' | 'planned'
  rating text, -- 'favorite' | 'bad' | null
  points jsonb not null, -- [{lat, lng, ele, t}, ...]
  distance_meters double precision,
  difficulty smallint check (difficulty is null or (difficulty between 1 and 10)),
  folder_id uuid references folders(id) on delete set null,
  photo_path text,
  group_id uuid references groups(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table shared_trails add column if not exists group_id uuid references groups(id) on delete cascade;
alter table shared_trails alter column created_by drop not null;
alter table shared_trails drop constraint if exists shared_trails_created_by_fkey;
alter table shared_trails add constraint shared_trails_created_by_fkey foreign key (created_by) references profiles(id) on delete set null;

alter table shared_trails enable row level security;

drop policy if exists "authenticated users can read shared trails" on shared_trails;
drop policy if exists "creator or group members can read shared trails" on shared_trails;
create policy "creator or group members can read shared trails"
  on shared_trails for select
  using (auth.uid() = created_by or (group_id is not null and is_group_member(group_id)));

drop policy if exists "authenticated users can add shared trails" on shared_trails;
drop policy if exists "group members can add shared trails" on shared_trails;
create policy "group members can add shared trails"
  on shared_trails for insert
  with check (auth.role() = 'authenticated' and auth.uid() = created_by and (group_id is null or is_group_member(group_id)));

drop policy if exists "creators can update their own shared trails" on shared_trails;
create policy "creators can update their own shared trails"
  on shared_trails for update
  using (auth.uid() = created_by);

drop policy if exists "creators can delete their own shared trails" on shared_trails;
create policy "creators can delete their own shared trails"
  on shared_trails for delete
  using (auth.uid() = created_by);

-- ---------- Shared photos (snap-and-tag, standalone) ----------
create table if not exists shared_photos (
  id uuid primary key default uuid_generate_v4(),
  -- Nullable + set null on delete, same reasoning as shared_waypoints above.
  created_by uuid references profiles(id) on delete set null, -- see the profiles(id) note on shared_waypoints above
  lat double precision not null,
  lng double precision not null,
  note text default '',
  photo_path text not null,
  group_id uuid references groups(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table shared_photos add column if not exists group_id uuid references groups(id) on delete cascade;
alter table shared_photos alter column created_by drop not null;
alter table shared_photos drop constraint if exists shared_photos_created_by_fkey;
alter table shared_photos add constraint shared_photos_created_by_fkey foreign key (created_by) references profiles(id) on delete set null;

alter table shared_photos enable row level security;

drop policy if exists "authenticated users can read shared photos" on shared_photos;
drop policy if exists "creator or group members can read shared photos" on shared_photos;
create policy "creator or group members can read shared photos"
  on shared_photos for select
  using (auth.uid() = created_by or (group_id is not null and is_group_member(group_id)));

drop policy if exists "authenticated users can add shared photos" on shared_photos;
drop policy if exists "group members can add shared photos" on shared_photos;
create policy "group members can add shared photos"
  on shared_photos for insert
  with check (auth.role() = 'authenticated' and auth.uid() = created_by and (group_id is null or is_group_member(group_id)));

drop policy if exists "creators can delete their own shared photos" on shared_photos;
create policy "creators can delete their own shared photos"
  on shared_photos for delete
  using (auth.uid() = created_by);

-- ---------- Live locations (presence while riding) ----------
-- One row per user, upserted repeatedly — not a history log.
create table if not exists locations (
  user_id uuid primary key references profiles(id) on delete cascade, -- see the profiles(id) note on shared_waypoints above
  lat double precision not null,
  lng double precision not null,
  group_id uuid references groups(id) on delete cascade,
  updated_at timestamptz not null default now()
);

alter table locations add column if not exists group_id uuid references groups(id) on delete cascade;

alter table locations enable row level security;

drop policy if exists "authenticated users can read locations" on locations;
drop policy if exists "self or group members can read locations" on locations;
create policy "self or group members can read locations"
  on locations for select
  using (auth.uid() = user_id or (group_id is not null and is_group_member(group_id)));

drop policy if exists "users can upsert their own location" on locations;
create policy "users can upsert their own location"
  on locations for insert
  with check (auth.role() = 'authenticated' and auth.uid() = user_id and (group_id is null or is_group_member(group_id)));

drop policy if exists "users can update their own location" on locations;
create policy "users can update their own location"
  on locations for update
  using (auth.uid() = user_id)
  with check (group_id is null or is_group_member(group_id));

-- ---------- Chat ----------
create table if not exists messages (
  id uuid primary key default uuid_generate_v4(),
  -- Nullable + set null on delete: deleting the sender's account
  -- anonymizes their chat history rather than deleting other members'
  -- conversation out from under them.
  user_id uuid references profiles(id) on delete set null, -- see the profiles(id) note on shared_waypoints above
  body text not null,
  group_id uuid references groups(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table messages add column if not exists group_id uuid references groups(id) on delete cascade;
alter table messages alter column user_id drop not null;
alter table messages drop constraint if exists messages_user_id_fkey;
alter table messages add constraint messages_user_id_fkey foreign key (user_id) references profiles(id) on delete set null;

alter table messages enable row level security;

drop policy if exists "authenticated users can read messages" on messages;
drop policy if exists "self or group members can read messages" on messages;
create policy "self or group members can read messages"
  on messages for select
  using (auth.uid() = user_id or (group_id is not null and is_group_member(group_id)));

drop policy if exists "authenticated users can send messages" on messages;
drop policy if exists "group members can send messages" on messages;
create policy "group members can send messages"
  on messages for insert
  with check (auth.role() = 'authenticated' and auth.uid() = user_id and (group_id is null or is_group_member(group_id)));

-- ---------- Personal trails & waypoints (private per-user backup) ----------
-- Unlike shared_trails/shared_waypoints above (visible to every signed-in
-- user via the "Share" button), these mirror a user's own local My
-- Content data — every recorded/planned/imported trail and every
-- standalone waypoint, pushed here once they're signed in so the app can
-- restore them after a reinstall or on a new device. RLS restricts every
-- operation, including select, to the owning row's user_id — nobody else
-- can ever read these, unlike the shared_* tables' "any authenticated
-- user" read policy. created_at/started_at/ended_at are epoch
-- milliseconds (not timestamptz) to match Dexie's Date.now() values on
-- the client, so a synced row round-trips without a timezone/format
-- conversion. See js/group/backend.js's upsertPersonalTrail/Waypoint and
-- js/app.js's syncPersonalData() for the client side of this.
create table if not exists personal_trails (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  kind text not null default 'recorded', -- 'recorded' | 'planned' | 'imported'
  points jsonb not null,
  distance_meters double precision,
  started_at bigint,
  ended_at bigint,
  difficulty smallint check (difficulty is null or (difficulty between 1 and 10)),
  created_at bigint not null
);

alter table personal_trails enable row level security;

drop policy if exists "users can read their own personal trails" on personal_trails;
create policy "users can read their own personal trails"
  on personal_trails for select
  using (auth.uid() = user_id);

drop policy if exists "users can insert their own personal trails" on personal_trails;
create policy "users can insert their own personal trails"
  on personal_trails for insert
  with check (auth.uid() = user_id);

drop policy if exists "users can update their own personal trails" on personal_trails;
create policy "users can update their own personal trails"
  on personal_trails for update
  using (auth.uid() = user_id);

drop policy if exists "users can delete their own personal trails" on personal_trails;
create policy "users can delete their own personal trails"
  on personal_trails for delete
  using (auth.uid() = user_id);

create table if not exists personal_waypoints (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  lat double precision not null,
  lng double precision not null,
  note text default '',
  category text not null default 'other',
  severity smallint check (severity is null or severity between 1 and 3), -- see the note on shared_waypoints.severity above
  created_at bigint not null
);

alter table personal_waypoints add column if not exists severity smallint check (severity is null or severity between 1 and 3);

alter table personal_waypoints enable row level security;

drop policy if exists "users can read their own personal waypoints" on personal_waypoints;
create policy "users can read their own personal waypoints"
  on personal_waypoints for select
  using (auth.uid() = user_id);

drop policy if exists "users can insert their own personal waypoints" on personal_waypoints;
create policy "users can insert their own personal waypoints"
  on personal_waypoints for insert
  with check (auth.uid() = user_id);

drop policy if exists "users can update their own personal waypoints" on personal_waypoints;
create policy "users can update their own personal waypoints"
  on personal_waypoints for update
  using (auth.uid() = user_id);

drop policy if exists "users can delete their own personal waypoints" on personal_waypoints;
create policy "users can delete their own personal waypoints"
  on personal_waypoints for delete
  using (auth.uid() = user_id);

-- ---------- Vehicle maintenance (private — no shared/crew variant at all) ----------
-- Unlike everything else above, there is no "shared_" counterpart to
-- these two tables — vehicle/maintenance data is never visible to anyone
-- but its owner, full stop. RLS restricts every operation to auth.uid()
-- = user_id, same as the personal_* tables. date/created_at are epoch
-- milliseconds, matching the client's Date.now() values (see the note on
-- personal_trails above for why).
create table if not exists personal_vehicles (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  year smallint,
  make text default '',
  model text default '',
  odometer integer,
  created_at bigint not null
);

alter table personal_vehicles enable row level security;

drop policy if exists "users can read their own vehicles" on personal_vehicles;
create policy "users can read their own vehicles"
  on personal_vehicles for select
  using (auth.uid() = user_id);

drop policy if exists "users can insert their own vehicles" on personal_vehicles;
create policy "users can insert their own vehicles"
  on personal_vehicles for insert
  with check (auth.uid() = user_id);

drop policy if exists "users can update their own vehicles" on personal_vehicles;
create policy "users can update their own vehicles"
  on personal_vehicles for update
  using (auth.uid() = user_id);

drop policy if exists "users can delete their own vehicles" on personal_vehicles;
create policy "users can delete their own vehicles"
  on personal_vehicles for delete
  using (auth.uid() = user_id);

create table if not exists personal_maintenance_records (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  vehicle_id uuid not null references personal_vehicles(id) on delete cascade,
  type text not null default 'other', -- oil_change | tire_rotation | brakes | fluids | battery | filters | inspection | repair | other (enforced client-side)
  date bigint not null,
  miles integer,
  cost numeric(10, 2),
  note text default '',
  receipt_path text, -- path within the private 'maintenance-receipts' storage bucket, if any
  reminder_date bigint, -- optional "next due" date (e.g. "oil change in 6 months") — see checkMaintenanceReminders in js/app.js
  created_at bigint not null
);

-- create table is a no-op on a database where this table already existed
-- before reminder_date was added — add it explicitly too, idempotent.
alter table personal_maintenance_records add column if not exists reminder_date bigint;

alter table personal_maintenance_records enable row level security;

drop policy if exists "users can read their own maintenance records" on personal_maintenance_records;
create policy "users can read their own maintenance records"
  on personal_maintenance_records for select
  using (auth.uid() = user_id);

drop policy if exists "users can insert their own maintenance records" on personal_maintenance_records;
create policy "users can insert their own maintenance records"
  on personal_maintenance_records for insert
  with check (auth.uid() = user_id);

drop policy if exists "users can update their own maintenance records" on personal_maintenance_records;
create policy "users can update their own maintenance records"
  on personal_maintenance_records for update
  using (auth.uid() = user_id);

drop policy if exists "users can delete their own maintenance records" on personal_maintenance_records;
create policy "users can delete their own maintenance records"
  on personal_maintenance_records for delete
  using (auth.uid() = user_id);

-- ---------- Error reports ----------
-- User-triggered ("tap to report") client error reports — a lightweight
-- way to actually hear about bugs instead of relying on word-of-mouth.
-- Open to anonymous writes on purpose: plenty of the app (map, GPS
-- recording, offline maps, local waypoints/photos) works without an
-- account at all, and errors there matter just as much. No select
-- policy is defined — reports are only ever read via the Supabase SQL
-- Editor (which runs as an admin and bypasses RLS), not through the app.
create table if not exists error_reports (
  id uuid primary key default uuid_generate_v4(),
  message text not null,
  stack text,
  url text,
  user_agent text,
  app_version text,
  reported_by uuid references profiles(id) on delete set null, -- null if not signed in, or if that account was since deleted
  created_at timestamptz not null default now()
);
alter table error_reports drop constraint if exists error_reports_reported_by_fkey;
alter table error_reports add constraint error_reports_reported_by_fkey foreign key (reported_by) references profiles(id) on delete set null;

alter table error_reports enable row level security;

drop policy if exists "anyone can report an error" on error_reports;
create policy "anyone can report an error"
  on error_reports for insert
  with check (true);

-- ---------- Global community trails (anonymous, app-wide) ----------
-- Every trail you actually record (GPS "Go & Track", not a tapped-out
-- planned route — see js/app.js's stop-recording handler) is contributed
-- here automatically, building out real trail coverage across the whole
-- app over time as more people drive. Unlike shared_trails (crew-only,
-- attributed to whoever created it), this has NO user/creator column at
-- all — not hidden, not nullable, just never collected — so there's
-- nothing to deanonymize even by an admin query. Readable by everyone,
-- signed in or not, since the point is for this to actually build out
-- coverage app-wide rather than stay locked behind an account.
-- Writes still require being signed in (not a specific crew group, any
-- account) — a mild deterrent against drive-by spam given the anon key
-- is public, since the data itself carries no identity to punish.
-- No delete policy for anyone, including the row's own contributor —
-- there's no owner to check. Remove a bad entry directly from the
-- Supabase Table Editor (bypasses RLS as the project owner), same as
-- error_reports above.
create table if not exists global_trails (
  id uuid primary key default uuid_generate_v4(),
  points jsonb not null, -- [{lat, lng, ele, t}, ...] — same shape as shared_trails.points
  distance_meters double precision,
  created_at timestamptz not null default now()
);

alter table global_trails enable row level security;

drop policy if exists "anyone can read global trails" on global_trails;
create policy "anyone can read global trails"
  on global_trails for select
  using (true);

drop policy if exists "authenticated users can contribute global trails" on global_trails;
create policy "authenticated users can contribute global trails"
  on global_trails for insert
  with check (auth.role() = 'authenticated');

-- ---------- Migrate existing FKs to reference profiles(id) ----------
-- If these tables already existed (created before the `references
-- profiles(id)` change above), their user/creator column still points at
-- auth.users(id) — the CREATE TABLE statements above are no-ops for a
-- table that already exists, so this needs an explicit migration.
-- Without it, PostgREST can't resolve the `profiles(display_name)` embed
-- these queries use, and fails outright even though the base rows exist
-- (symptom: live locations/messages/shared photos/shared waypoints exist
-- in the table but never render — the whole query silently errors).
-- Guarded to be safe to re-run, and a no-op once already migrated.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'locations_user_id_fkey' and confrelid = 'auth.users'::regclass) then
    alter table locations drop constraint locations_user_id_fkey;
    alter table locations add constraint locations_user_id_fkey foreign key (user_id) references profiles(id) on delete cascade;
  end if;
  if exists (select 1 from pg_constraint where conname = 'messages_user_id_fkey' and confrelid = 'auth.users'::regclass) then
    alter table messages drop constraint messages_user_id_fkey;
    alter table messages add constraint messages_user_id_fkey foreign key (user_id) references profiles(id);
  end if;
  if exists (select 1 from pg_constraint where conname = 'shared_photos_created_by_fkey' and confrelid = 'auth.users'::regclass) then
    alter table shared_photos drop constraint shared_photos_created_by_fkey;
    alter table shared_photos add constraint shared_photos_created_by_fkey foreign key (created_by) references profiles(id);
  end if;
  if exists (select 1 from pg_constraint where conname = 'shared_waypoints_created_by_fkey' and confrelid = 'auth.users'::regclass) then
    alter table shared_waypoints drop constraint shared_waypoints_created_by_fkey;
    alter table shared_waypoints add constraint shared_waypoints_created_by_fkey foreign key (created_by) references profiles(id);
  end if;
  if exists (select 1 from pg_constraint where conname = 'shared_trails_created_by_fkey' and confrelid = 'auth.users'::regclass) then
    alter table shared_trails drop constraint shared_trails_created_by_fkey;
    alter table shared_trails add constraint shared_trails_created_by_fkey foreign key (created_by) references profiles(id);
  end if;
end $$;

-- ---------- Realtime ----------
-- Enable realtime (live push on insert/update) for the tables that need
-- it. Guarded so re-running this script doesn't error on "table already
-- a member of publication".
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'locations') then
    alter publication supabase_realtime add table locations;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'messages') then
    alter publication supabase_realtime add table messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'shared_photos') then
    alter publication supabase_realtime add table shared_photos;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'shared_waypoints') then
    alter publication supabase_realtime add table shared_waypoints;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'shared_trails') then
    alter publication supabase_realtime add table shared_trails;
  end if;
end $$;

-- ---------- Storage ----------
-- Trail/waypoint/standalone photos — one shared bucket, any authenticated
-- user can read or upload. NOT group-scoped: unlike the tables above, a
-- photo's storage path (`${uid}/${timestamp}.ext`) carries no group_id,
-- so this relies on that path being unguessable rather than on RLS to
-- keep it out of other groups' hands. Tightening this to match the
-- tables' group scoping would need the object's group recorded
-- somewhere queryable (there's no join target on storage.objects today)
-- — left as a known gap for now.
insert into storage.buckets (id, name, public)
values ('trail-photos', 'trail-photos', false)
on conflict (id) do nothing;

drop policy if exists "members can read their groups' trail photos" on storage.objects;
drop policy if exists "members can upload trail photos to their groups" on storage.objects;

drop policy if exists "authenticated users can read trail photos" on storage.objects;
create policy "authenticated users can read trail photos"
  on storage.objects for select
  using (bucket_id = 'trail-photos' and auth.role() = 'authenticated');

drop policy if exists "authenticated users can upload trail photos" on storage.objects;
create policy "authenticated users can upload trail photos"
  on storage.objects for insert
  with check (bucket_id = 'trail-photos' and auth.role() = 'authenticated');

-- Maintenance receipts — a separate, genuinely private bucket (unlike
-- trail-photos above, which any authenticated user can read). Objects
-- are uploaded to `${uid}/...`, and storage.foldername(name)[1] is that
-- first path segment, so this only ever matches the uploader's own
-- folder — nobody else, even signed in, can read or write another
-- user's receipts.
insert into storage.buckets (id, name, public)
values ('maintenance-receipts', 'maintenance-receipts', false)
on conflict (id) do nothing;

drop policy if exists "users can read their own maintenance receipts" on storage.objects;
create policy "users can read their own maintenance receipts"
  on storage.objects for select
  using (bucket_id = 'maintenance-receipts' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "users can upload their own maintenance receipts" on storage.objects;
create policy "users can upload their own maintenance receipts"
  on storage.objects for insert
  with check (bucket_id = 'maintenance-receipts' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "users can delete their own maintenance receipts" on storage.objects;
create policy "users can delete their own maintenance receipts"
  on storage.objects for delete
  using (bucket_id = 'maintenance-receipts' and auth.uid()::text = (storage.foldername(name))[1]);

-- ---------- Account deletion ----------
-- Lets a signed-in user permanently delete their own account and
-- personal data in one call — see delete-account.html (published
-- alongside the app) for the user-facing page, and js/app.js's Settings
-- panel for the in-app "Delete Account" button. Both just call this RPC.
--
-- What this actually does, in order:
-- 1. Deletes this user's own photo/receipt uploads from Storage (paths
--    are `${uid}/...`, so this only ever touches their own files).
-- 2. Deletes `auth.users` for this uid. Every table below that stores
--    genuinely private, personal data (personal_trails,
--    personal_waypoints, personal_vehicles,
--    personal_maintenance_records, locations, group_members) cascades
--    automatically via its own `on delete cascade` foreign key, so
--    there's nothing else to do for those. Tables holding data this
--    user chose to SHARE with their crew (shared_waypoints,
--    shared_trails, shared_photos, messages, folders, groups) do NOT
--    cascade — see the `on delete set null` foreign keys added earlier
--    in this file — so that content anonymizes (creator/sender becomes
--    null) instead of vanishing out from under everyone else who could
--    already see it.
--
-- A SECURITY DEFINER function can DELETE from auth.users directly
-- (it's an ordinary table the function owner — the project's postgres
-- role, since this runs via the SQL Editor — has full rights to); this
-- is the standard self-service account-deletion pattern on Supabase.
-- No confirmation step here — the caller (the web page / in-app button)
-- is responsible for confirming with the user before calling this, since
-- once it runs there's no undo.
create or replace function delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;

  delete from storage.objects
  where bucket_id in ('trail-photos', 'maintenance-receipts')
    and (storage.foldername(name))[1] = uid::text;

  delete from auth.users where id = uid;
end;
$$;
