-- One optional image per reward. image_public_id is kept alongside the URL so
-- the backend can delete the old Cloudinary asset when it's replaced/removed.
alter table rewards add column if not exists image_url text;
alter table rewards add column if not exists image_public_id text;
