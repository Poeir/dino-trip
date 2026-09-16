-- Additive step of moving place_photos off Postgres-stored bytea and onto
-- Cloudinary (see 20260914000002 for the follow-up drop, once
-- scripts/migrate-existing-place-photos.js has backfilled these for every
-- existing row). Nullable for now so existing bytea-only rows stay valid
-- until the backfill runs.
alter table place_photos add column if not exists url text;
alter table place_photos add column if not exists public_id text;
