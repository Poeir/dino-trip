-- Google's operating status (OPERATIONAL / CLOSED_TEMPORARILY / CLOSED_PERMANENTLY)
-- surfaced as its own column so the frontend can warn users before they visit
-- a place that's closed, instead of it sitting unused inside raw_data.
alter table places add column if not exists business_status text;

-- Backfill from the raw_data already stored (see 20260728000005) rather than
-- re-reading the source JSON files -- covers both importers' shapes:
-- import-places.js's flat `businessStatus` and import-places-multi.js's
-- nested `core.businessStatus`.
update places
set business_status = coalesce(raw_data->>'businessStatus', raw_data->'core'->>'businessStatus')
where raw_data is not null;
