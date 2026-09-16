-- Multi-photo gallery for events, mirroring places' place_photos (see
-- 20260910000002_place_photo_gallery.sql and its Cloudinary follow-ups) --
-- a single admin-uploaded image per event turned out to be too limiting for
-- a real festival/event listing. Cloudinary-hosted from the start (no bytea
-- detour place_photos went through, since Cloudinary was already in use by
-- the time this table was added).
create table if not exists event_photos (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  url text not null,
  public_id text not null,
  position smallint not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists event_photos_event_id_idx on event_photos (event_id, position);

alter table event_photos enable row level security;
create policy "public read event_photos" on event_photos for select using (true);
create policy "public write event_photos" on event_photos for insert with check (true);
create policy "public update event_photos" on event_photos for update using (true);
create policy "public delete event_photos" on event_photos for delete using (true);

-- Superseded by event_photos.public_id -- an event now has a gallery table
-- tracking one public_id per photo, not one hero image with its own.
alter table events drop column if exists img_public_id;
