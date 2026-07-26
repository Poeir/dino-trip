-- Events: always admin-managed (no Google source for this entity).
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  date_range text,
  venue_name text,
  admission text,
  organizer text,
  suitable_for text[] not null default '{}',
  description text,
  status text not null default 'upcoming' check (status in ('upcoming', 'published', 'cancelled')),
  img text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger events_set_updated_at
  before update on events
  for each row execute function set_updated_at();

alter table events enable row level security;

create policy "public read events" on events for select using (true);
create policy "public write events" on events for insert with check (true);
create policy "public update events" on events for update using (true);
create policy "public delete events" on events for delete using (true);
