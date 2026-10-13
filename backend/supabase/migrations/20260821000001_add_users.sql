-- Tourist/admin account profiles, keyed 1:1 with Supabase Auth's auth.users.
-- auth.users itself holds the credential (email/password) -- this table only
-- adds the app-specific fields (role, display name, points balance).
create table if not exists users (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'tourist' check (role in ('tourist', 'admin')),
  display_name text,
  points_balance integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Auto-create the profile row on signup so the client never has to (and
-- never gets a chance to set its own role/points_balance). security definer
-- lets this run with the privileges needed to insert past RLS below.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, role, display_name)
  values (new.id, 'tourist', coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Unlike the other tables' permissive "allow all" RLS (fine there because
-- only the trusted backend, via service_role, ever touches them) this table
-- is reached directly from the browser via the anon/authenticated key for
-- Supabase Auth, so it needs real per-row + per-column restriction: a
-- tourist must not be able to read another user's row, or write their own
-- role/points_balance to escalate privilege or grant themselves points.
alter table users enable row level security;

create policy "users can view their own profile"
  on users for select
  using (auth.uid() = id);

create policy "users can update their own profile"
  on users for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- No insert/delete policy: rows are only ever created by the trigger above
-- (security definer, bypasses RLS) and deleted via auth.users cascade.

-- Column-level grant on top of the row-level policy: even on their own row,
-- a tourist can only change display_name -- not role or points_balance.
revoke update on users from authenticated;
grant update (display_name) on users to authenticated;
