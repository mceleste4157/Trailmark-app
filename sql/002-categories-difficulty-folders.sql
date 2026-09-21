-- Trailmark migration 002: waypoint categories, trail difficulty, trip folders.
-- Run in the Supabase SQL Editor after sql/schema.sql. Additive/idempotent —
-- safe to re-run.

-- ---------- Trip folders ----------
-- Groups waypoints + trails into a named trip (e.g. "Saturday Windrock run").
create table if not exists group_trip_folders (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references groups(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  name text not null,
  description text default '',
  created_at timestamptz not null default now()
);

alter table group_trip_folders enable row level security;

drop policy if exists "members can read group trip folders" on group_trip_folders;
create policy "members can read group trip folders"
  on group_trip_folders for select
  using (is_group_member(group_id));

drop policy if exists "members can create group trip folders" on group_trip_folders;
create policy "members can create group trip folders"
  on group_trip_folders for insert
  with check (is_group_member(group_id) and auth.uid() = created_by);

drop policy if exists "creators can update their own trip folders" on group_trip_folders;
create policy "creators can update their own trip folders"
  on group_trip_folders for update
  using (auth.uid() = created_by);

drop policy if exists "creators can delete their own trip folders" on group_trip_folders;
create policy "creators can delete their own trip folders"
  on group_trip_folders for delete
  using (auth.uid() = created_by);

-- ---------- Waypoint categories ----------
alter table group_waypoints add column if not exists category text not null default 'other';
-- Expected values (enforced client-side, not a DB check constraint, so new
-- categories can be added without a migration): trailhead, campsite, fuel,
-- water_crossing, obstacle, hazard, other.
alter table group_waypoints add column if not exists folder_id uuid references group_trip_folders(id) on delete set null;

-- ---------- Trail difficulty ----------
alter table group_trails add column if not exists difficulty smallint;
-- 1-10 scale, nullable (not every trail has been rated). Enforced client-side
-- for the same reason as above, plus a basic sanity check here:
alter table group_trails drop constraint if exists group_trails_difficulty_check;
alter table group_trails add constraint group_trails_difficulty_check check (difficulty is null or (difficulty between 1 and 10));
alter table group_trails add column if not exists folder_id uuid references group_trip_folders(id) on delete set null;
