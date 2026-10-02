-- User reports for events: a tourist points at which event field looks wrong
-- (name, date, venue, ...) and an admin resolves it. Unlike places there is
-- no external source (no Google sync), so there is no field locking and no
-- 'superseded' state -- just pending -> resolved | rejected.
create table if not exists event_reports (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  user_id uuid references users (id) on delete set null,
  field text not null check (field in (
    'name', 'date', 'venue', 'admission', 'status', 'organizer', 'photos', 'other'
  )),
  note text check (note is null or length(note) <= 500),
  status text not null default 'pending'
    check (status in ('pending', 'resolved', 'rejected')),
  resolution text check (resolution in ('edited', 'no_change')),
  resolved_by uuid references users (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  -- 'other' has no field to point at, so it needs a description.
  constraint event_reports_other_needs_note
    check (field <> 'other' or length(btrim(coalesce(note, ''))) > 0),
  constraint event_reports_resolution_only_when_resolved
    check (resolution is null or status = 'resolved')
);

-- One open report per user/event/field (stops one account inflating the count).
create unique index if not exists event_reports_one_pending_idx
  on event_reports (event_id, user_id, field) where status = 'pending';
create index if not exists event_reports_queue_idx
  on event_reports (status, event_id, field);

-- Same lock-down as place_reports/trips: only the backend touches this table.
alter table event_reports enable row level security;
revoke all on event_reports from anon, authenticated;
grant select, insert, update, delete on event_reports to service_role;
