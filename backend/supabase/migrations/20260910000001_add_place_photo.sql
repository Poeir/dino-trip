-- Admin-uploaded place photo, stored the same way as user avatars
-- (avatar_data/avatar_mime on `users`, see 20260905000007) rather than
-- Supabase Storage -- served back via GET /api/places/:id/photo.
alter table places add column if not exists img_data bytea;
alter table places add column if not exists img_mime text;
