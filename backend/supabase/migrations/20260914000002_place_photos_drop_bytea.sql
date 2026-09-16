-- Run only after scripts/migrate-existing-place-photos.js has backfilled
-- url/public_id for every row (20260914000001 added those columns).
alter table place_photos alter column url set not null;
alter table place_photos alter column public_id set not null;
alter table place_photos drop column if exists data;
alter table place_photos drop column if exists mime;
