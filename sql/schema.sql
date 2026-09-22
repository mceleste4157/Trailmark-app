-- Trailmark shared-crew schema (Supabase / Postgres)
--
-- Run this once in your Supabase project's SQL Editor (Dashboard -> SQL
-- Editor -> New query -> paste -> Run). Safe to re-run: it drops and
-- recreates everything below `profiles`, so re-running just resets it.
--
-- Design: there is no "group" concept. Every signed-in user shares one
-- space — anyone who creates an account sees everyone else's live
-- location, chat, and shared waypoints/trails/photos.
-- Local-only features (map, GPS recording, offline maps, local waypoints
-- and photos) never need an account at all; RLS below only gates the
-- shared/social tables, restricted to authenticated users in general and
-- to each user's own rows for writes.
--
-- If you previously ran an earlier version of this schema with a
-- "groups" concept, this drops those tables (group_waypoints,
-- group_trails, group_locations, group_messages, group_emergency_alerts,
-- group_photos, group_trip_folders, group_members, groups) along with
-- is_group_member() — safe since none of that ever held real data if you
-- were hitting the RLS error that prompted this reset.

create extension if not exists "uuid-ossp";

-- ---------- Drop the old per-group schema, if present ----------
drop table if exists group_photos cascade;
drop table if exists group_trip_folders cascade;
drop table if exists group_waypoints cascade;
drop table if exists group_trails cascade;
drop table if exists group_locations cascade;
drop table if exists group_emergency_alerts cascade;
drop table if exists group_messages cascade;
drop table if exists group_members cascade;
drop table if exists groups cascade;
-- cascade: the old group-scoped storage.objects policies ("members can
-- read/upload their groups' trail photos") reference this function and
-- aren't dropped until the Storage section further down — without
-- cascade here, that ordering makes Postgres refuse this drop outright
-- and abort the whole script before anything below it ever runs.
drop function if exists is_group_member(uuid) cascade;

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

-- ---------- Trip folders ----------
-- Groups waypoints + trails into a named trip (e.g. "Saturday Windrock
-- run"). Shared globally, same as everything else here.
create table if not exists folders (
  id uuid primary key default uuid_generate_v4(),
  created_by uuid not null references auth.users(id),
  name text not null,
  description text default '',
  created_at timestamptz not null default now()
);

alter table folders enable row level security;

drop policy if exists "authenticated users can read folders" on folders;
create policy "authenticated users can read folders"
  on folders for select
  using (auth.role() = 'authenticated');

drop policy if exists "authenticated users can create folders" on folders;
create policy "authenticated users can create folders"
  on folders for insert
  with check (auth.role() = 'authenticated' and auth.uid() = created_by);

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
  created_by uuid not null references profiles(id),
  name text not null,
  note text default '',
  lat double precision not null,
  lng double precision not null,
  category text not null default 'other', -- trailhead | campsite | fuel | water_crossing | obstacle | hazard | other (enforced client-side)
  severity smallint check (severity is null or severity between 1 and 3), -- 1 (minor) - 3 (major); only meaningful for water_crossing/obstacle/hazard (enforced client-side)
  folder_id uuid references folders(id) on delete set null,
  photo_path text, -- path within the 'trail-photos' storage bucket, if any
  created_at timestamptz not null default now()
);

-- create table is a no-op on a database where this table already
-- existed before the severity column above was added, so add it
-- explicitly too — idempotent, safe to re-run.
alter table shared_waypoints add column if not exists severity smallint check (severity is null or severity between 1 and 3);

alter table shared_waypoints enable row level security;

drop policy if exists "authenticated users can read shared waypoints" on shared_waypoints;
create policy "authenticated users can read shared waypoints"
  on shared_waypoints for select
  using (auth.role() = 'authenticated');

drop policy if exists "authenticated users can add shared waypoints" on shared_waypoints;
create policy "authenticated users can add shared waypoints"
  on shared_waypoints for insert
  with check (auth.role() = 'authenticated' and auth.uid() = created_by);

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
  created_by uuid not null references profiles(id),
  name text not null,
  kind text not null default 'recorded', -- 'recorded' | 'planned'
  rating text, -- 'favorite' | 'bad' | null
  points jsonb not null, -- [{lat, lng, ele, t}, ...]
  distance_meters double precision,
  difficulty smallint check (difficulty is null or (difficulty between 1 and 10)),
  folder_id uuid references folders(id) on delete set null,
  photo_path text,
  created_at timestamptz not null default now()
);

alter table shared_trails enable row level security;

drop policy if exists "authenticated users can read shared trails" on shared_trails;
create policy "authenticated users can read shared trails"
  on shared_trails for select
  using (auth.role() = 'authenticated');

drop policy if exists "authenticated users can add shared trails" on shared_trails;
create policy "authenticated users can add shared trails"
  on shared_trails for insert
  with check (auth.role() = 'authenticated' and auth.uid() = created_by);

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
  created_by uuid not null references profiles(id), -- see the profiles(id) note on shared_waypoints above
  lat double precision not null,
  lng double precision not null,
  note text default '',
  photo_path text not null,
  created_at timestamptz not null default now()
);

alter table shared_photos enable row level security;

drop policy if exists "authenticated users can read shared photos" on shared_photos;
create policy "authenticated users can read shared photos"
  on shared_photos for select
  using (auth.role() = 'authenticated');

drop policy if exists "authenticated users can add shared photos" on shared_photos;
create policy "authenticated users can add shared photos"
  on shared_photos for insert
  with check (auth.role() = 'authenticated' and auth.uid() = created_by);

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
  updated_at timestamptz not null default now()
);

alter table locations enable row level security;

drop policy if exists "authenticated users can read locations" on locations;
create policy "authenticated users can read locations"
  on locations for select
  using (auth.role() = 'authenticated');

drop policy if exists "users can upsert their own location" on locations;
create policy "users can upsert their own location"
  on locations for insert
  with check (auth.role() = 'authenticated' and auth.uid() = user_id);

drop policy if exists "users can update their own location" on locations;
create policy "users can update their own location"
  on locations for update
  using (auth.uid() = user_id);

-- ---------- Chat ----------
create table if not exists messages (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id), -- see the profiles(id) note on shared_waypoints above
  body text not null,
  created_at timestamptz not null default now()
);

alter table messages enable row level security;

drop policy if exists "authenticated users can read messages" on messages;
create policy "authenticated users can read messages"
  on messages for select
  using (auth.role() = 'authenticated');

drop policy if exists "authenticated users can send messages" on messages;
create policy "authenticated users can send messages"
  on messages for insert
  with check (auth.role() = 'authenticated' and auth.uid() = user_id);

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
  reported_by uuid references profiles(id), -- null if not signed in
  created_at timestamptz not null default now()
);

alter table error_reports enable row level security;

drop policy if exists "anyone can report an error" on error_reports;
create policy "anyone can report an error"
  on error_reports for insert
  with check (true);

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
-- user can read or upload (no group-folder scoping needed anymore).
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
