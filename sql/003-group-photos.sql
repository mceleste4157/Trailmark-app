-- Trailmark migration 003: shared geotagged photos (snap-and-tag, not tied
-- to a waypoint or trail — see the toolbar's Photo button). Run in the
-- Supabase SQL Editor after sql/schema.sql and sql/002-*.sql.
-- Additive/idempotent — safe to re-run.

create table if not exists group_photos (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references groups(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  lat double precision not null,
  lng double precision not null,
  note text default '',
  photo_path text not null, -- path within the existing 'trail-photos' storage bucket
  created_at timestamptz not null default now()
);

alter table group_photos enable row level security;

drop policy if exists "members can read group photos" on group_photos;
create policy "members can read group photos"
  on group_photos for select
  using (is_group_member(group_id));

drop policy if exists "members can add group photos" on group_photos;
create policy "members can add group photos"
  on group_photos for insert
  with check (is_group_member(group_id) and auth.uid() = created_by);

drop policy if exists "creators can delete their own photos" on group_photos;
create policy "creators can delete their own photos"
  on group_photos for delete
  using (auth.uid() = created_by);

-- Realtime push so a photo shows up on everyone else's map live, not just
-- after their next reload.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'group_photos') then
    alter publication supabase_realtime add table group_photos;
  end if;
end $$;
