-- User account management: suspend / soft delete, points ledger, admin audit
-- log, and the checks that make a suspended or deleted account actually stop
-- working.

-- ---------------------------------------------------------------------------
-- 1. Account lifecycle columns
-- ---------------------------------------------------------------------------
-- status: reversible suspension. deleted_at: soft delete (row + history kept,
-- hidden from the default admin list, cannot log in, restorable).
alter table users add column if not exists status text not null default 'active'
  check (status in ('active', 'suspended'));
alter table users add column if not exists status_reason text;
alter table users add column if not exists status_changed_at timestamptz;
alter table users add column if not exists status_changed_by uuid references users (id) on delete set null;
alter table users add column if not exists deleted_at timestamptz;
alter table users add column if not exists deleted_by uuid references users (id) on delete set null;
alter table users add column if not exists last_login_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. Email: one account per address, case-insensitively, deleted included
-- ---------------------------------------------------------------------------
-- The address of a soft-deleted account stays reserved (restore it instead of
-- registering again). users_email_key stays as the plain unique constraint;
-- storing every address lower-cased makes it case-insensitive, and the check
-- below stops anything else from writing a mixed-case one.
update users set email = lower(btrim(email)) where email <> lower(btrim(email));
alter table users add constraint users_email_normalized_check check (email = lower(btrim(email)));

-- ---------------------------------------------------------------------------
-- 3. History must survive: no hard-delete cascade into scans / redemptions
-- ---------------------------------------------------------------------------
alter table qr_scans drop constraint qr_scans_user_id_fkey;
alter table qr_scans add constraint qr_scans_user_id_fkey
  foreign key (user_id) references users (id) on delete restrict;
alter table redemptions drop constraint redemptions_user_id_fkey;
alter table redemptions add constraint redemptions_user_id_fkey
  foreign key (user_id) references users (id) on delete restrict;

-- ---------------------------------------------------------------------------
-- 4. Points ledger for manual adjustments + admin audit log
-- ---------------------------------------------------------------------------
create table if not exists points_adjustments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete restrict,
  admin_id uuid references users (id) on delete set null,
  delta integer not null check (delta <> 0),
  balance_after integer not null,
  reason text not null check (length(btrim(reason)) > 0),
  created_at timestamptz not null default now()
);
create index if not exists points_adjustments_user_idx on points_adjustments (user_id, created_at desc);

create table if not exists admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references users (id) on delete set null,
  action text not null,
  target_user_id uuid references users (id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_log_target_idx on admin_audit_log (target_user_id, created_at desc);
create index if not exists admin_audit_log_created_idx on admin_audit_log (created_at desc);

-- ---------------------------------------------------------------------------
-- 5. Lock the account tables away from the public Data API
-- ---------------------------------------------------------------------------
-- users (password hashes), sessions and both token tables had RLS off and
-- SELECT/INSERT granted to anon: anyone holding the project's anon key could
-- read them over PostgREST. The backend connects as postgres directly and is
-- unaffected; RLS with no policies + no anon/authenticated grants closes it.
alter table users enable row level security;
alter table sessions enable row level security;
alter table email_verification_tokens enable row level security;
alter table password_reset_tokens enable row level security;
alter table points_adjustments enable row level security;
alter table admin_audit_log enable row level security;

revoke all on users, sessions, email_verification_tokens, password_reset_tokens,
  points_adjustments, admin_audit_log from anon, authenticated;

grant select, insert, update, delete on users, sessions, email_verification_tokens,
  password_reset_tokens, points_adjustments, admin_audit_log to service_role;

-- ---------------------------------------------------------------------------
-- 6. Scan / redeem refuse inactive accounts (defence in depth: the API layer
--    already rejects them, this keeps the DB functions safe on their own)
-- ---------------------------------------------------------------------------
create or replace function claim_qr_scan(
  p_user_id uuid,
  p_qr_id uuid,
  p_lat double precision default null,
  p_lng double precision default null
)
returns table (points_awarded integer, new_balance integer, place_name text)
language plpgsql
security definer set search_path = public
as $$
declare
  v_points integer;
  v_place_name text;
  v_active boolean;
  v_expires_at timestamptz;
  v_radius integer;
  v_place_lat double precision;
  v_place_lng double precision;
  v_dist double precision;
  v_balance integer;
begin
  if not exists (select 1 from users where id = p_user_id and status = 'active' and deleted_at is null) then
    raise exception 'account_inactive' using errcode = 'US403';
  end if;

  select q.points, p.name, q.is_active, q.expires_at, q.radius_m, p.lat, p.lng
    into v_points, v_place_name, v_active, v_expires_at, v_radius, v_place_lat, v_place_lng
  from qrs q join places p on p.id = q.place_id
  where q.id = p_qr_id;

  if v_points is null then
    raise exception 'qr_not_found' using errcode = 'QR404';
  end if;

  if not v_active then
    raise exception 'qr_inactive' using errcode = 'QR403';
  end if;

  if v_expires_at is not null and v_expires_at <= now() then
    raise exception 'qr_expired' using errcode = 'QR410';
  end if;

  if exists (select 1 from qr_scans where qr_id = p_qr_id and user_id = p_user_id) then
    raise exception 'already_scanned' using errcode = 'QR409';
  end if;

  if v_place_lat is not null and v_place_lng is not null then
    if p_lat is null or p_lng is null then
      raise exception 'location_required' using errcode = 'QR422';
    end if;
    v_dist := 2 * 6371000 * asin(least(1, sqrt(
      power(sin(radians(p_lat - v_place_lat) / 2), 2)
      + cos(radians(v_place_lat)) * cos(radians(p_lat)) * power(sin(radians(p_lng - v_place_lng) / 2), 2)
    )));
    if v_dist > v_radius then
      raise exception 'too_far' using errcode = 'QR451', detail = round(v_dist)::text || '|' || v_radius::text;
    end if;
  end if;

  begin
    insert into qr_scans (qr_id, user_id, points_awarded) values (p_qr_id, p_user_id, v_points);
  exception when unique_violation then
    raise exception 'already_scanned' using errcode = 'QR409';
  end;

  update users set points_balance = points_balance + v_points
  where id = p_user_id
  returning points_balance into v_balance;

  return query select v_points, v_balance, v_place_name;
end;
$$;

create or replace function redeem_reward(p_user_id uuid, p_reward_id uuid)
returns table (new_balance integer)
language plpgsql
security definer set search_path = public
as $$
declare
  v_cost integer;
  v_balance integer;
begin
  if not exists (select 1 from users where id = p_user_id and status = 'active' and deleted_at is null) then
    raise exception 'account_inactive' using errcode = 'US403';
  end if;

  select cost into v_cost from rewards where id = p_reward_id;
  if v_cost is null then
    raise exception 'reward_not_found' using errcode = 'RW404';
  end if;

  update users set points_balance = points_balance - v_cost
  where id = p_user_id and points_balance >= v_cost
  returning points_balance into v_balance;

  if v_balance is null then
    raise exception 'insufficient_points' using errcode = 'PT402';
  end if;

  insert into redemptions (reward_id, user_id, cost) values (p_reward_id, p_user_id, v_cost);

  return query select v_balance;
end;
$$;

-- Manual points change by an admin: balance and ledger row in one statement
-- so they can't drift apart, and a debit can never take the balance negative.
create or replace function adjust_points(p_user_id uuid, p_delta integer, p_reason text, p_admin_id uuid)
returns table (new_balance integer)
language plpgsql
security definer set search_path = public
as $$
declare
  v_balance integer;
begin
  update users set points_balance = points_balance + p_delta
  where id = p_user_id and deleted_at is null and points_balance + p_delta >= 0
  returning points_balance into v_balance;

  if v_balance is null then
    if exists (select 1 from users where id = p_user_id and deleted_at is null) then
      raise exception 'insufficient_points' using errcode = 'PT402';
    end if;
    raise exception 'user_not_found' using errcode = 'US404';
  end if;

  insert into points_adjustments (user_id, admin_id, delta, balance_after, reason)
  values (p_user_id, p_admin_id, p_delta, v_balance, p_reason);

  return query select v_balance;
end;
$$;

revoke execute on function adjust_points(uuid, integer, text, uuid) from public;
grant execute on function adjust_points(uuid, integer, text, uuid) to service_role;
