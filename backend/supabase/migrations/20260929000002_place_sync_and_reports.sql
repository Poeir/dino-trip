-- Google sync + user reports without the two overwriting each other.
--
-- Ownership model: every Google-syncable field on places can be "locked" by
-- an admin edit. The sync service (backend) never overwrites a locked field;
-- when Google's value differs it parks it in places.google_diff so an admin
-- can accept or ignore it. User reports never write to places -- they only
-- point at a field, and an admin resolves them (edit / sync / no change).
--
-- Lock keys map to columns as: name, address, location (lat + lng),
-- hours (hours + hours_periods), phone, website, business_status.

-- ---------------------------------------------------------------------------
-- 1. places: lock + sync bookkeeping
-- ---------------------------------------------------------------------------
alter table places
  add column if not exists locked_fields text[] not null default '{}',
  add column if not exists last_synced_at timestamptz,
  add column if not exists google_diff jsonb not null default '{}'::jsonb;

alter table places drop constraint if exists places_locked_fields_valid;
alter table places add constraint places_locked_fields_valid
  check (locked_fields <@ array['name', 'address', 'location', 'hours', 'phone', 'website', 'business_status']::text[]);

-- Drives "oldest first" job selection and the stale filter.
create index if not exists places_last_synced_idx on places (last_synced_at nulls first)
  where google_place_id is not null;

-- ---------------------------------------------------------------------------
-- 2. place_reports: a user points at the field that looks wrong
-- ---------------------------------------------------------------------------
create table if not exists place_reports (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references places (id) on delete cascade,
  user_id uuid references users (id) on delete set null,
  field text not null check (field in (
    'name', 'address', 'location', 'hours', 'phone', 'website', 'closed', 'photos', 'other'
  )),
  note text check (note is null or length(note) <= 500),
  status text not null default 'pending'
    check (status in ('pending', 'resolved', 'rejected', 'superseded')),
  resolution text check (resolution in ('edited', 'synced', 'no_change')),
  resolved_by uuid references users (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  -- 'other' has no field to point at, so it needs a description.
  constraint place_reports_other_needs_note
    check (field <> 'other' or length(btrim(coalesce(note, ''))) > 0),
  constraint place_reports_resolution_only_when_resolved
    check (resolution is null or status = 'resolved')
);

-- One open report per user/place/field: stops a single account inflating the
-- "hours x N" count the admin queue ranks by.
create unique index if not exists place_reports_one_pending_idx
  on place_reports (place_id, user_id, field) where status = 'pending';
create index if not exists place_reports_queue_idx
  on place_reports (status, place_id, field);

-- ---------------------------------------------------------------------------
-- 3. Sync jobs (admin picks scope; backend processes in batches)
-- ---------------------------------------------------------------------------
create table if not exists place_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references users (id) on delete set null,
  scope text not null check (scope in ('single', 'selected', 'filter', 'all')),
  filters jsonb not null default '{}'::jsonb,
  fields text[] not null default array['name', 'address', 'location', 'hours', 'phone', 'website', 'business_status']::text[],
  dry_run boolean not null default false,
  max_items integer check (max_items is null or max_items > 0),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'cancelled', 'failed')),
  total integer not null default 0,
  done integer not null default 0,
  failed integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  constraint place_sync_jobs_fields_valid
    check (fields <@ array['name', 'address', 'location', 'hours', 'phone', 'website', 'business_status']::text[])
);
create index if not exists place_sync_jobs_created_idx on place_sync_jobs (created_at desc);

create table if not exists place_sync_results (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references place_sync_jobs (id) on delete cascade,
  place_id uuid not null references places (id) on delete cascade,
  status text not null check (status in ('updated', 'unchanged', 'skipped', 'failed')),
  changed_fields text[] not null default '{}',
  skipped_locked text[] not null default '{}',
  diff jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  unique (job_id, place_id)
);
create index if not exists place_sync_results_place_idx on place_sync_results (place_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. Lock the new tables away from the public Data API (same as trips):
--    the browser never touches them, every access goes through the backend.
-- ---------------------------------------------------------------------------
alter table place_reports enable row level security;
alter table place_sync_jobs enable row level security;
alter table place_sync_results enable row level security;

revoke all on place_reports, place_sync_jobs, place_sync_results from anon, authenticated;
grant select, insert, update, delete on place_reports, place_sync_jobs, place_sync_results to service_role;
