-- Trailmark shared-crew schema (Supabase / Postgres)
--
-- Run this once in your Supabase project's SQL Editor (Dashboard -> SQL
-- Editor -> New query -> paste -> Run). Safe to re-run: it drops and
-- recreates everything below `profiles`, so re-running just resets it.
--
-- Design: there is no "group" concept. Every signed-in user shares one
-- space — anyone who creates an account sees everyone else's live
-- location, chat, shared waypoints/trails/photos, and emergency alerts.
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
drop function if exists is_group_member(uuid);

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
  created_by uuid not null references auth.users(id),
  name text not null,
  note text default '',
  lat double precision not null,
  lng double precision not null,
  category text not null default 'other', -- trailhead | campsite | fuel | water_crossing | obstacle | hazard | other (enforced client-side)
  folder_id uuid references folders(id) on delete set null,
  photo_path text, -- path within the 'trail-photos' storage bucket, if any
  created_at timestamptz not null default now()
);

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
  created_by uuid not null references auth.users(id),
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
  created_by uuid not null references auth.users(id),
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
  user_id uuid primary key references auth.users(id) on delete cascade,
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

-- ---------- Emergency alerts ----------
create table if not exists emergency_alerts (
  id uuid primary key default uuid_generate_v4(),
  raised_by uuid not null references auth.users(id),
  lat double precision,
  lng double precision,
  message text default '',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table emergency_alerts enable row level security;

drop policy if exists "authenticated users can read emergency alerts" on emergency_alerts;
create policy "authenticated users can read emergency alerts"
  on emergency_alerts for select
  using (auth.role() = 'authenticated');

drop policy if exists "authenticated users can raise an emergency alert" on emergency_alerts;
create policy "authenticated users can raise an emergency alert"
  on emergency_alerts for insert
  with check (auth.role() = 'authenticated' and auth.uid() = raised_by);

drop policy if exists "raiser can mark their alert resolved" on emergency_alerts;
create policy "raiser can mark their alert resolved"
  on emergency_alerts for update
  using (auth.uid() = raised_by);

-- ---------- Chat ----------
create table if not exists messages (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id),
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
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'emergency_alerts') then
    alter publication supabase_realtime add table emergency_alerts;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'shared_photos') then
    alter publication supabase_realtime add table shared_photos;
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
