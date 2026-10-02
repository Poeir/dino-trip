-- Photo gallery for event requests (mirrors event_photos). On approval the rows
-- are copied into event_photos and removed from here; the Cloudinary assets
-- are shared, so only a cancelled/rejected request deletes them.
create table if not exists event_request_photos (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references event_requests (id) on delete cascade,
  url text not null,
  public_id text not null,
  position smallint not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists event_request_photos_request_idx on event_request_photos (request_id, position);

alter table event_request_photos enable row level security;
revoke all on event_request_photos from anon, authenticated;
grant select, insert, update, delete on event_request_photos to service_role;
