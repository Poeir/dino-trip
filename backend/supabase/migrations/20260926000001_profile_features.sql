-- Self-service profile: avatar cache-busting, password-change stamp, pending
-- email changes, and indexes for the per-user history list.

alter table users add column if not exists avatar_updated_at timestamptz;
alter table users add column if not exists password_changed_at timestamptz;

-- A requested email change. The address on users only switches once the link
-- sent to the NEW address is opened, so a typo or someone else's address can
-- never lock the owner out. One pending request per user (a new request
-- replaces the old one).
create table if not exists email_change_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references users (id) on delete cascade,
  new_email text not null check (new_email = lower(btrim(new_email))),
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table email_change_tokens enable row level security;
revoke all on email_change_tokens from anon, authenticated;
grant select, insert, update, delete on email_change_tokens to service_role;

-- History pages read "this user's rows, newest first".
create index if not exists qr_scans_user_scanned_idx on qr_scans (user_id, scanned_at desc);
create index if not exists redemptions_user_redeemed_idx on redemptions (user_id, redeemed_at desc);
