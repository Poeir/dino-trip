-- QR codes: each one is tied to a place and awards points on scan.
create table if not exists qrs (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references places (id) on delete cascade,
  points integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists qrs_place_id_idx on qrs (place_id);

alter table qrs enable row level security;

create policy "public read qrs" on qrs for select using (true);
create policy "public write qrs" on qrs for insert with check (true);
create policy "public update qrs" on qrs for update using (true);
create policy "public delete qrs" on qrs for delete using (true);
