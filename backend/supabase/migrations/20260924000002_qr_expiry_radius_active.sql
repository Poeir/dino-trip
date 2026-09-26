-- QR management: expiry, on/off switch, per-QR radius, one QR per place, and
-- a location check on scan.

alter table qrs add column if not exists expires_at timestamptz;
alter table qrs add column if not exists is_active boolean not null default true;
alter table qrs add column if not exists radius_m integer not null default 200 check (radius_m > 0);

create unique index if not exists qrs_place_id_unique on qrs (place_id);

-- The old 2-argument version is dropped rather than overloaded: with default
-- args on the new one, both would match a 2-argument call and be ambiguous.
drop function if exists claim_qr_scan(uuid, uuid);

-- p_lat/p_lng are the tourist's position as reported by their browser. When
-- the QR's place has coordinates they are required and must fall within the
-- QR's radius; a place without coordinates skips the location check.
--
-- Error codes (mapped to HTTP statuses in qrs.routes.js):
--   QR404 not found, QR403 inactive, QR410 expired, QR409 already scanned,
--   QR422 location required, QR451 too far (detail = "<metres>|<radius>").
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

  -- Checked before the location so someone who already claimed this QR is told
  -- so, rather than "too far" from wherever they happen to be now. The unique
  -- constraint below still catches two concurrent claims.
  if exists (select 1 from qr_scans where qr_id = p_qr_id and user_id = p_user_id) then
    raise exception 'already_scanned' using errcode = 'QR409';
  end if;

  if v_place_lat is not null and v_place_lng is not null then
    if p_lat is null or p_lng is null then
      raise exception 'location_required' using errcode = 'QR422';
    end if;
    -- Haversine great-circle distance in metres.
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

-- Same lock-down as the original (see 20260823000001): only the backend's
-- service-role client may call it, never an anon PostgREST RPC.
revoke execute on function claim_qr_scan(uuid, uuid, double precision, double precision) from public;
grant execute on function claim_qr_scan(uuid, uuid, double precision, double precision) to service_role;
