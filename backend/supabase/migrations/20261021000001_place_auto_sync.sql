-- Scheduled Google sync, configurable from the admin UI.
--
-- One settings row (singleton) drives a backend scheduler that picks the places
-- whose data is older than their interval and syncs them through the same job
-- runner the manual "ซิงก์จาก Google" dialog uses (locked fields still only park
-- a diff). The monthly call cap is the cost guard: every sync is one billable
-- Places API request, and the scheduler stops when the cap is reached.
--
-- Apply on its own (the live DB has no supabase_migrations history): one
-- transaction, then re-check grants on the new table.

create table if not exists place_auto_sync_settings (
  -- Singleton: the check + primary key allow exactly one row.
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  -- Hour of day (Asia/Bangkok) after which the day's run may start.
  run_hour smallint not null default 3 check (run_hour between 0 and 23),
  normal_interval_days integer not null default 30 check (normal_interval_days between 1 and 365),
  priority_interval_days integer not null default 7 check (priority_interval_days between 1 and 365),
  -- Which places count as "priority" (synced at priority_interval_days).
  priority_featured boolean not null default true,
  priority_qr boolean not null default true,
  priority_with_reports boolean not null default true,
  -- Syncs per calendar month (Asia/Bangkok), manual and automatic together.
  monthly_call_cap integer not null default 900 check (monthly_call_cap between 0 and 100000),
  daily_max_items integer not null default 100 check (daily_max_items between 1 and 500),
  -- A place Google reports as permanently closed is hidden (is_active = false), never deleted.
  auto_hide_closed boolean not null default true,
  include_inactive boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references users (id) on delete set null
);

insert into place_auto_sync_settings (id) values (true) on conflict (id) do nothing;

-- Which runs were the scheduler's, and how many places it hid as closed.
alter table place_sync_jobs
  add column if not exists triggered_by text not null default 'manual'
    check (triggered_by in ('manual', 'auto')),
  add column if not exists auto_hidden integer not null default 0;

-- Monthly usage = results created since the start of the month.
create index if not exists place_sync_results_created_idx on place_sync_results (created_at);

-- Same lock-down as the other sync tables: only the backend (service_role) touches it.
alter table place_auto_sync_settings enable row level security;
revoke all on place_auto_sync_settings from anon, authenticated;
grant select, insert, update, delete on place_auto_sync_settings to service_role;
