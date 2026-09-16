-- Optional link from an event to an existing place (e.g. the venue is
-- already in the places table). Nullable and purely additive: venue_name
-- stays the free-text display value, so events at venues that aren't
-- registered places (or predate this column) work exactly as before.
alter table events add column if not exists place_id uuid references places(id) on delete set null;

-- Tracks the Cloudinary public_id behind events.img so a replaced/removed
-- image can be deleted from Cloudinary too, instead of leaking orphaned
-- assets. Events only ever have one image (unlike places' multi-photo
-- gallery), so a single column is enough -- no junction table needed.
alter table events add column if not exists img_public_id text;
