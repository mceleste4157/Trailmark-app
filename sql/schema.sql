-- Trailmark group backend schema (Supabase / Postgres + PostGIS)
--
-- Run this once in your Supabase project's SQL Editor (Dashboard -> SQL
-- Editor -> New query -> paste -> Run). Safe to re-run: tables use
-- `create table if not exists`, policies are dropped and recreated, and
-- the realtime/storage sections check before inserting.
--
-- Design: everything is scoped to a "group" (a riding group). A user must
-- be a member of a group to read/write that group's data — enforced with
-- Row Level Security (RLS), not just client-side checks, so this is safe
-- even though the anon key is public in the client bundle.

create extension if not exists "uuid-ossp";

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

-- ---------- Groups ----------
create table if not exists groups (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  invite_code text not null unique, -- short code others use to join
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists group_members (
  group_id uuid not null references groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member', -- 'owner' | 'member'
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

alter table groups enable row level security;
alter table group_members enable row level security;

-- Helper: is the current user a member of a given group?
create or replace function is_group_member(gid uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from group_members
    where group_id = gid and user_id = auth.uid()
  );
$$;

drop policy if exists "members can see their groups" on groups;
create policy "members can see their groups"
  on groups for select
  using (is_group_member(id));

drop policy if exists "authenticated users can create a group" on groups;
create policy "authenticated users can create a group"
  on groups for insert
  with check (auth.uid() = created_by);

drop policy if exists "members can see their group's membership list" on group_members;
create policy "members can see their group's membership list"
  on group_members for select
  using (is_group_member(group_id));

drop policy if exists "users can join a group (insert their own membership)" on group_members;
create policy "users can join a group (insert their own membership)"
  on group_members for insert
  with check (auth.uid() = user_id);

drop policy if exists "users can leave a group (delete their own membership)" on group_members;
create policy "users can leave a group (delete their own membership)"
  on group_members for delete
  using (auth.uid() = user_id);

-- ---------- Shared waypoints (markers with descriptions + optional photo) ----------
create table if not exists group_waypoints (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references groups(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  name text not null,
  note text default '',
  lat double precision not null,
  lng double precision not null,
  photo_path text, -- path within the 'trail-photos' storage bucket, if any
  created_at timestamptz not null default now()
);

alter table group_waypoints enable row level security;

drop policy if exists "members can read group waypoints" on group_waypoints;
create policy "members can read group waypoints"
  on group_waypoints for select
  using (is_group_member(group_id));

drop policy if exists "members can add group waypoints" on group_waypoints;
create policy "members can add group waypoints"
  on group_waypoints for insert
  with check (is_group_member(group_id) and auth.uid() = created_by);

drop policy if exists "creators can delete their own waypoints" on group_waypoints;
create policy "creators can delete their own waypoints"
  on group_waypoints for delete
  using (auth.uid() = created_by);

-- ---------- Shared trails (recorded rides + planned routes, with rating) ----------
create table if not exists group_trails (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references groups(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  name text not null,
  kind text not null default 'recorded', -- 'recorded' | 'planned'
  rating text, -- 'favorite' | 'bad' | null
  points jsonb not null, -- [{lat, lng, ele, t}, ...]
  distance_meters double precision,
  photo_path text,
  created_at timestamptz not null default now()
);

alter table group_trails enable row level security;

drop policy if exists "members can read group trails" on group_trails;
create policy "members can read group trails"
  on group_trails for select
  using (is_group_member(group_id));

drop policy if exists "members can add group trails" on group_trails;
create policy "members can add group trails"
  on group_trails for insert
  with check (is_group_member(group_id) and auth.uid() = created_by);

drop policy if exists "creators can update their own trails" on group_trails;
create policy "creators can update their own trails"
  on group_trails for update
  using (auth.uid() = created_by);

drop policy if exists "creators can delete their own trails" on group_trails;
create policy "creators can delete their own trails"
  on group_trails for delete
  using (auth.uid() = created_by);

-- ---------- Live locations (presence while riding) ----------
-- One row per user per group, upserted repeatedly — not a history log.
-- Stale rows (no update in 15+ min) should be treated as "offline" by the
-- client rather than deleted, so a brief connectivity drop doesn't erase
-- someone's last-known position.
create table if not exists group_locations (
  group_id uuid not null references groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  updated_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

alter table group_locations enable row level security;

drop policy if exists "members can read group locations" on group_locations;
create policy "members can read group locations"
  on group_locations for select
  using (is_group_member(group_id));

drop policy if exists "members can upsert their own location" on group_locations;
create policy "members can upsert their own location"
  on group_locations for insert
  with check (is_group_member(group_id) and auth.uid() = user_id);

drop policy if exists "members can update their own location" on group_locations;
create policy "members can update their own location"
  on group_locations for update
  using (auth.uid() = user_id);

-- ---------- Emergency alerts ----------
create table if not exists group_emergency_alerts (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references groups(id) on delete cascade,
  raised_by uuid not null references auth.users(id),
  lat double precision,
  lng double precision,
  message text default '',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table group_emergency_alerts enable row level security;

drop policy if exists "members can read group emergency alerts" on group_emergency_alerts;
create policy "members can read group emergency alerts"
  on group_emergency_alerts for select
  using (is_group_member(group_id));

drop policy if exists "members can raise an emergency alert" on group_emergency_alerts;
create policy "members can raise an emergency alert"
  on group_emergency_alerts for insert
  with check (is_group_member(group_id) and auth.uid() = raised_by);

drop policy if exists "raiser can mark their alert resolved" on group_emergency_alerts;
create policy "raiser can mark their alert resolved"
  on group_emergency_alerts for update
  using (auth.uid() = raised_by);

-- ---------- Group chat ----------
create table if not exists group_messages (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references groups(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  body text not null,
  created_at timestamptz not null default now()
);

alter table group_messages enable row level security;

drop policy if exists "members can read group messages" on group_messages;
create policy "members can read group messages"
  on group_messages for select
  using (is_group_member(group_id));

drop policy if exists "members can send group messages" on group_messages;
create policy "members can send group messages"
  on group_messages for insert
  with check (is_group_member(group_id) and auth.uid() = user_id);

-- ---------- Realtime ----------
-- Enable realtime (live push on insert/update) for the tables that need
-- it. Guarded so re-running this script doesn't error on "table already
-- a member of publication".
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'group_locations') then
    alter publication supabase_realtime add table group_locations;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'group_messages') then
    alter publication supabase_realtime add table group_messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'group_emergency_alerts') then
    alter publication supabase_realtime add table group_emergency_alerts;
  end if;
end $$;

-- ---------- Storage ----------
-- Trail/waypoint photos.
insert into storage.buckets (id, name, public)
values ('trail-photos', 'trail-photos', false)
on conflict (id) do nothing;

drop policy if exists "members can read their groups' trail photos" on storage.objects;
create policy "members can read their groups' trail photos"
  on storage.objects for select
  using (
    bucket_id = 'trail-photos'
    and is_group_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "members can upload trail photos to their groups" on storage.objects;
create policy "members can upload trail photos to their groups"
  on storage.objects for insert
  with check (
    bucket_id = 'trail-photos'
    and is_group_member((storage.foldername(name))[1]::uuid)
  );
-- Photos are uploaded under a path like "<group_id>/<uuid>.jpg" so the
-- foldername()[1] segment is the group id these policies check against.
