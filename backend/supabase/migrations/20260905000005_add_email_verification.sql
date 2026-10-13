alter table public.users
  add column email_verified boolean not null default false;

-- Pre-existing accounts (including the admin account requireAdmin.js relies
-- on) predate this feature -- treat them as already-verified so this
-- migration can't lock anyone out. New signups still default to false via
-- the column default (handle_new_user() doesn't set this column).
update public.users set email_verified = true;

create table public.email_verification_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  -- The refresh_token from the session signUp() already returned (Supabase
  -- auto-confirms since enable_confirmations is off) -- stashed here so
  -- /confirm can mint a real session without ever touching the user's
  -- password.
  refresh_token text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.email_verification_tokens enable row level security;
-- No policies: only the backend's service-role client (which bypasses RLS)
-- ever touches this table -- anon/authenticated get zero access.
