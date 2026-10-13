-- Thai honorific title (คำนำหน้าชื่อ) -- a standard field on Thai forms
-- alongside first/last name, missed when the profile fields were first
-- added (see 20260905000001_add_users_profile_fields.sql).
alter table users add column if not exists title text check (title in ('mr', 'mrs', 'miss'));
