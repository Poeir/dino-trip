-- Supersedes 20260910000001_add_place_photo.sql's single img_data/img_mime
-- columns -- the system's existing convention (see fetch-places.js's
-- MAX_PHOTOS_PER_PLACE = 5, and how 424/447 Google-imported places already
-- carry a 5-photo `images[]` gallery) is a gallery per place, not one hero
-- image. Nothing depended on the single-photo columns yet, so dropping them
-- outright is safe.
alter table places drop column if exists img_data;
alter table places drop column if exists img_mime;

create table if not exists place_photos (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references places(id) on delete cascade,
  data bytea not null,
  mime text not null,
  position smallint not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists place_photos_place_id_idx on place_photos (place_id, position);

alter table place_photos enable row level security;
create policy "public read place_photos" on place_photos for select using (true);
create policy "public write place_photos" on place_photos for insert with check (true);
create policy "public update place_photos" on place_photos for update using (true);
create policy "public delete place_photos" on place_photos for delete using (true);
