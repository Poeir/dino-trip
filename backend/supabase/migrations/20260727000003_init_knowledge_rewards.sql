-- Chatbot knowledge base articles (admin-managed).
create table if not exists knowledge_base (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text,
  content text,
  is_pinned boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger knowledge_base_set_updated_at
  before update on knowledge_base
  for each row execute function set_updated_at();

alter table knowledge_base enable row level security;

create policy "public read knowledge_base" on knowledge_base for select using (true);
create policy "public write knowledge_base" on knowledge_base for insert with check (true);
create policy "public update knowledge_base" on knowledge_base for update using (true);
create policy "public delete knowledge_base" on knowledge_base for delete using (true);

-- Points-redemption rewards (admin-managed).
create table if not exists rewards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cost integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger rewards_set_updated_at
  before update on rewards
  for each row execute function set_updated_at();

alter table rewards enable row level security;

create policy "public read rewards" on rewards for select using (true);
create policy "public write rewards" on rewards for insert with check (true);
create policy "public update rewards" on rewards for update using (true);
create policy "public delete rewards" on rewards for delete using (true);
