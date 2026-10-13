-- Supabase-Auth-coupled trigger/function -- no longer relevant, inserts
-- into users now happen directly from the backend's own signup code.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

-- qr_scans/redemptions FK to users(id) -- their rows all belong to the
-- tourist accounts being wiped below anyway, so clear them rather than
-- leave orphaned history pointing at ids that are about to stop existing.
truncate table public.qr_scans, public.redemptions;

drop table if exists public.email_verification_tokens;
-- cascade: drops qr_scans_user_id_fkey/redemptions_user_id_fkey along with
-- the table -- re-added below once the new users table exists.
drop table if exists public.users cascade;

create table public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  role text not null default 'tourist' check (role in ('tourist','admin')),
  display_name text,
  phone text,
  first_name text,
  last_name text,
  gender text check (gender in ('male','female','unspecified')),
  province text,
  district text,
  subdistrict text,
  birthdate date,
  occupation text,
  avatar_preset text,
  avatar_data bytea,
  avatar_mime text,
  avatar_position text,
  avatar_scale numeric,
  email_verified boolean not null default false,
  points_balance integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.email_verification_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
-- No RLS: the backend now connects as a trusted Postgres role directly
-- (not through PostgREST), so authorization lives entirely in Express
-- middleware (requireAuth/requireAdmin) from here on.

-- Restore the FKs dropped via cascade above, against the new users table.
alter table public.qr_scans add constraint qr_scans_user_id_fkey foreign key (user_id) references public.users(id) on delete cascade;
alter table public.redemptions add constraint redemptions_user_id_fkey foreign key (user_id) references public.users(id) on delete cascade;
