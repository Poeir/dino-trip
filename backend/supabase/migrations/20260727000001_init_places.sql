-- Places: sourced from Google Places API (source='google', google_place_id set)
-- or added directly by an admin (source='admin', google_place_id null).
create extension if not exists pgcrypto;

create table if not exists places (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'admin' check (source in ('google', 'admin')),
  google_place_id text unique,
  name text not null,
  category text,
  rating numeric(2,1),
  review_count integer not null default 0,
  price text,
  address text,
  hours text,
  phone text,
  website text,
  maps_url text,
  lat double precision,
  lng double precision,
  description text,
  amenities text[] not null default '{}',
  tags text[] not null default '{}',
  has_qr boolean not null default false,
  qr_points integer not null default 0,
  img text,
  reviews jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists places_category_idx on places (category);
create index if not exists places_source_idx on places (source);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger places_set_updated_at
  before update on places
  for each row execute function set_updated_at();

-- RLS is enabled with a permissive "allow all" policy for now because the app
-- has no real auth yet (see AppContext.jsx mock login/adminLogin). Tighten this
-- when real auth is wired up: restrict writes to authenticated admins only.
alter table places enable row level security;

create policy "public read places" on places for select using (true);
create policy "public write places" on places for insert with check (true);
create policy "public update places" on places for update using (true);
create policy "public delete places" on places for delete using (true);
