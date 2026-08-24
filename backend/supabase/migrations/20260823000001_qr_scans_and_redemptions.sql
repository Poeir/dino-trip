-- Real QR-scan-to-points persistence, replacing the frontend mock that used
-- to fabricate a random place + increment local-only state (see AppContext.jsx
-- startScan/redeemReward before this migration). Points now live on
-- users.points_balance (added in 20260821000001_add_users.sql but never
-- written to until now).

-- One row per successful claim. The unique constraint is what actually
-- enforces "a tourist can claim each QR's points once, ever" -- see
-- claim_qr_scan() below, which relies on a unique_violation to detect a
-- repeat scan instead of a separate SELECT-then-INSERT (which would race
-- under concurrent requests for the same user+QR).
create table if not exists qr_scans (
  id uuid primary key default gen_random_uuid(),
  qr_id uuid not null references qrs (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  points_awarded integer not null,
  scanned_at timestamptz not null default now(),
  unique (qr_id, user_id)
);

create index if not exists qr_scans_user_id_idx on qr_scans (user_id);

-- One row per reward redemption, for audit/history purposes -- cost is
-- captured at redemption time so a later admin price change doesn't rewrite
-- history.
create table if not exists redemptions (
  id uuid primary key default gen_random_uuid(),
  reward_id uuid not null references rewards (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  cost integer not null,
  redeemed_at timestamptz not null default now()
);

create index if not exists redemptions_user_id_idx on redemptions (user_id);

-- RLS enabled with *no* policies on either table (unlike qrs/rewards' public
-- read): there's no legitimate reason for a browser client to read or write
-- these directly. Every access goes through the backend's service-role
-- client, either straight (points.routes.js's GET /me) or via the two
-- security-definer functions below.
alter table qr_scans enable row level security;
alter table redemptions enable row level security;

-- Explicit, unlike every earlier migration in this project: newer Supabase
-- projects no longer auto-expose freshly created tables/functions to *any*
-- Data API role -- not even service_role (see supabase/config.toml's
-- auto_expose_new_tables comment). The older tables here (places, qrs, ...)
-- still work without this because they predate that default and already
-- carry the legacy blanket grant; anything created from here on needs it
-- spelled out or the backend's service-role client gets a bare permission
-- error against a table that very much exists.
grant select, insert, update, delete on qr_scans to service_role;
grant select, insert, update, delete on redemptions to service_role;

-- Atomically claims a QR's points for a tourist: looks the QR's points and
-- place name up server-side from qr_id (the frontend/QR content never
-- carries a points value to trust), inserts the qr_scans row, and credits
-- users.points_balance in the same transaction. Raises a distinct error
-- code per failure so the API layer (qrs.routes.js) can map them to the
-- right HTTP status instead of a generic 500.
create or replace function claim_qr_scan(p_user_id uuid, p_qr_id uuid)
returns table (points_awarded integer, new_balance integer, place_name text)
language plpgsql
security definer set search_path = public
as $$
declare
  v_points integer;
  v_place_name text;
  v_balance integer;
begin
  select q.points, p.name into v_points, v_place_name
  from qrs q join places p on p.id = q.place_id
  where q.id = p_qr_id;

  if v_points is null then
    raise exception 'qr_not_found' using errcode = 'QR404';
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

-- Atomically redeems a reward if the tourist has enough points: the
-- `where ... and points_balance >= v_cost` on the update is what makes the
-- balance check and the debit race-free (two concurrent redeem calls can't
-- both pass a separate "is balance enough" check and then both debit).
create or replace function redeem_reward(p_user_id uuid, p_reward_id uuid)
returns table (new_balance integer)
language plpgsql
security definer set search_path = public
as $$
declare
  v_cost integer;
  v_balance integer;
begin
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

-- Both functions take a plain uuid p_user_id rather than deriving it from
-- auth.uid(), because the backend (not the DB) is what authenticates the
-- tourist via the session cookie -- see requireAuth middleware. That means
-- anyone able to call these as RPCs directly (PostgREST exposes every
-- public-schema function that way) could pass an arbitrary p_user_id and
-- credit/debit someone else's points. security definer alone doesn't stop
-- that -- it only controls what the function's *body* can touch, not who's
-- allowed to invoke it. Revoking the default PUBLIC execute grant closes
-- that off: only the backend's service-role client (which already has
-- broad access to this schema, same as every other table here) can call
-- them, the same "backend is the trusted boundary" assumption everything
-- else in this schema relies on.
revoke execute on function claim_qr_scan(uuid, uuid) from public;
revoke execute on function redeem_reward(uuid, uuid) from public;

-- ...then grant it back to just service_role (see the table grants above
-- for why this can't be left to the default).
grant execute on function claim_qr_scan(uuid, uuid) to service_role;
grant execute on function redeem_reward(uuid, uuid) to service_role;
