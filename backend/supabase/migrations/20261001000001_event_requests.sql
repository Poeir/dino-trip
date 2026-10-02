-- Event requests: a signed-in user (entrepreneur) asks for their own event to be
-- shown on the platform. An admin approves it (the event is copied into
-- `events`, so it appears user-side straight away) or rejects it with a reason
-- the requester can read. Columns mirror the editable `events` columns so
-- approval is a plain copy.
create table if not exists event_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  category text,
  date_range text,
  venue_name text,
  admission text,
  organizer text,
  suitable_for text[] not null default '{}',
  description text,
  event_start_date date,
  event_end_date date,
  place_id uuid references places (id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  reject_reason text check (reject_reason is null or length(reject_reason) <= 500),
  reviewed_by uuid references users (id) on delete set null,
  reviewed_at timestamptz,
  -- The events row created on approval (set null if the admin later deletes it).
  event_id uuid references events (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_requests_reject_needs_reason
    check (status <> 'rejected' or length(btrim(coalesce(reject_reason, ''))) > 0),
  constraint event_requests_reason_only_when_rejected
    check (reject_reason is null or status = 'rejected')
);

create trigger event_requests_set_updated_at
  before update on event_requests
  for each row execute function set_updated_at();

create index if not exists event_requests_queue_idx on event_requests (status, created_at);
create index if not exists event_requests_user_idx on event_requests (user_id, created_at desc);

-- Same lock-down as event_reports/trips: only the backend touches this table.
alter table event_requests enable row level security;
revoke all on event_requests from anon, authenticated;
grant select, insert, update, delete on event_requests to service_role;
