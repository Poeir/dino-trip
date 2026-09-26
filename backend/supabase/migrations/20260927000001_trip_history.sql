-- Trip-plan history: saved itineraries for logged-in tourists and guests.
--
-- Normalized as trips -> trip_days -> trip_items so admin stats ("most-planned
-- places", trips per day, ...) are plain SQL instead of jsonb digging.
--
-- Ownership: a trip belongs to either a user (user_id) or an anonymous guest
-- (guest_token_hash, the sha256 of a random token held in an httpOnly cookie
-- -- same idea as sessions.token_hash). On login the guest's trips are
-- claimed into the account: user_id is set and guest_token_hash cleared.

create table if not exists trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users (id) on delete cascade,
  guest_token_hash text,
  title text not null check (length(btrim(title)) > 0),
  -- The TripInput the tourist filled in (dates, interests, budget, pace,
  -- accommodation, must_go, ...). Kept as jsonb on purpose: it is only ever
  -- read back whole, to recap the conditions or to regenerate with them.
  input jsonb not null default '{}'::jsonb,
  note text not null default '',
  planning_rationale text not null default '',
  total_distance_km numeric(10, 2) not null default 0,
  total_cost_estimate numeric(12, 2) not null default 0,
  start_date date not null,
  days integer not null check (days > 0),
  is_favorite boolean not null default false,
  -- Bumped when the itinerary shape changes so old rows stay readable.
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trips_has_owner check (user_id is not null or guest_token_hash is not null)
);

create index if not exists trips_user_idx on trips (user_id, created_at desc) where user_id is not null;
create index if not exists trips_guest_idx on trips (guest_token_hash) where guest_token_hash is not null;
create index if not exists trips_created_idx on trips (created_at desc);

create table if not exists trip_days (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips (id) on delete cascade,
  day_no integer not null check (day_no > 0),
  date date not null,
  day_cost_estimate numeric(12, 2) not null default 0,
  day_travel_time_total integer not null default 0,
  unique (trip_id, day_no)
);

create table if not exists trip_items (
  id uuid primary key default gen_random_uuid(),
  day_id uuid not null references trip_days (id) on delete cascade,
  position integer not null check (position >= 0),
  -- The place may later be deactivated (places.is_active) or removed: keep
  -- the row and a name snapshot rather than losing the tourist's plan.
  place_id uuid references places (id) on delete set null,
  place_name text not null,
  arrival_time text not null,     -- "HH:MM", same as chatbot-service's TimeSlot
  departure_time text not null,
  travel_time_min integer not null default 0,
  distance_km numeric(10, 2) not null default 0,
  status text not null default 'Open',
  wait_time_min integer not null default 0,
  is_anchor boolean not null default false,
  meal_role text check (meal_role in ('lunch', 'dinner')),
  liked boolean,                  -- true = liked, false = disliked, null = no vote
  unique (day_id, position)
);

create index if not exists trip_items_day_idx on trip_items (day_id);
create index if not exists trip_items_place_idx on trip_items (place_id) where place_id is not null;

-- Same lock-down as qr_scans/redemptions: the browser never talks to these
-- directly, every access goes through the backend (which authenticates the
-- session or guest cookie and scopes queries to the owner).
alter table trips enable row level security;
alter table trip_days enable row level security;
alter table trip_items enable row level security;

revoke all on trips, trip_days, trip_items from anon, authenticated;
grant select, insert, update, delete on trips, trip_days, trip_items to service_role;
