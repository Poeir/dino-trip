-- Google fallback for the chatbot + "places users asked for" queue.
--
-- When a "แถว X" chat question finds fewer than 3 places in X, chatbot-service
-- tops the answer up with a live Google Places search (marked unverified). Every
-- Google place it shows is recorded in place_candidates so admins can see which
-- places users want that the DB lacks, and import them (backend
-- adminPlaceCandidates.routes.js). google_fallback_usage caps the paid searches
-- per day (Asia/Bangkok).
--
-- Apply on its own (the live DB has no supabase_migrations history): one
-- transaction, then re-check grants on the new tables and functions.

create table if not exists place_candidates (
  google_place_id text primary key,
  name text not null,
  address text,
  -- The area the user asked about ("พระยืน"), as typed.
  area_query text,
  category text,
  rating numeric,
  review_count integer,
  maps_url text,
  -- Times it was shown in an answer, at most once per hour per place, so one
  -- conversation repeating a question doesn't inflate it.
  ask_count integer not null default 1,
  first_asked_at timestamptz not null default now(),
  last_asked_at timestamptz not null default now(),
  last_counted_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'imported', 'dismissed')),
  place_id uuid references places (id) on delete set null,
  decided_at timestamptz,
  decided_by uuid references users (id) on delete set null
);

create index if not exists place_candidates_status_idx on place_candidates (status, ask_count desc);

create table if not exists google_fallback_usage (
  day date primary key,
  calls integer not null default 0 check (calls >= 0)
);

-- One paid search, if today's count is still under p_cap. Atomic, so parallel
-- chat requests can't overshoot the cap.
create or replace function claim_google_fallback_call(p_cap integer)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_day date := (now() at time zone 'Asia/Bangkok')::date;
begin
  insert into google_fallback_usage (day, calls) values (v_day, 0) on conflict (day) do nothing;
  update google_fallback_usage set calls = calls + 1 where day = v_day and calls < p_cap;
  return found;
end;
$$;

-- p_items: [{google_place_id, name, address, category, rating, review_count, maps_url}]
create or replace function record_place_candidates(p_items jsonb, p_area text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  insert into place_candidates (google_place_id, name, address, area_query, category, rating, review_count, maps_url)
  select x->>'google_place_id', x->>'name', x->>'address', p_area, x->>'category',
         nullif(x->>'rating', '')::numeric, nullif(x->>'review_count', '')::integer, x->>'maps_url'
  from jsonb_array_elements(p_items) as x
  where coalesce(x->>'google_place_id', '') <> '' and coalesce(x->>'name', '') <> ''
  on conflict (google_place_id) do update set
    name = excluded.name,
    address = excluded.address,
    area_query = excluded.area_query,
    category = excluded.category,
    rating = excluded.rating,
    review_count = excluded.review_count,
    maps_url = excluded.maps_url,
    last_asked_at = now(),
    ask_count = place_candidates.ask_count
      + case when place_candidates.last_counted_at < now() - interval '1 hour' then 1 else 0 end,
    last_counted_at = case when place_candidates.last_counted_at < now() - interval '1 hour'
      then now() else place_candidates.last_counted_at end;
end;
$$;

-- Same lock-down as the other backend-only tables: no anon/authenticated access.
alter table place_candidates enable row level security;
alter table google_fallback_usage enable row level security;
revoke all on place_candidates, google_fallback_usage from anon, authenticated;
grant select, insert, update, delete on place_candidates, google_fallback_usage to service_role;

-- Supabase's default privileges grant EXECUTE on new public functions to anon
-- and authenticated directly, so revoking from public alone leaves them
-- callable with the anon key (checked live after the first apply).
revoke execute on function claim_google_fallback_call(integer) from public, anon, authenticated;
revoke execute on function record_place_candidates(jsonb, text) from public, anon, authenticated;
grant execute on function claim_google_fallback_call(integer) to service_role;
grant execute on function record_place_candidates(jsonb, text) to service_role;
