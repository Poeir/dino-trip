-- Splits the single "name" field into first/last name, and adds gender +
-- current address (province/district/subdistrict) collected at signup so
-- the app can see who its users are (UC: user demographics), same rationale
-- as phone in 20260821000003_add_users_phone.sql.
alter table users add column if not exists first_name text;
alter table users add column if not exists last_name text;
alter table users add column if not exists gender text check (gender in ('male', 'female', 'unspecified'));
alter table users add column if not exists province text;
alter table users add column if not exists district text;
alter table users add column if not exists subdistrict text;

-- Re-create the signup trigger to also copy the new fields from the auth
-- metadata the backend's signUp call sets (see auth.routes.js). CREATE OR
-- REPLACE keeps the same security definer/search_path as the original
-- definition in 20260821000001_add_users.sql.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, role, display_name, phone, first_name, last_name, gender, province, district, subdistrict)
  values (
    new.id,
    'tourist',
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'phone',
    new.raw_user_meta_data->>'first_name',
    new.raw_user_meta_data->>'last_name',
    new.raw_user_meta_data->>'gender',
    new.raw_user_meta_data->>'province',
    new.raw_user_meta_data->>'district',
    new.raw_user_meta_data->>'subdistrict'
  );
  return new;
end;
$$;

-- Extend the same "own row, this column only" pattern used for
-- display_name/phone (see prior migrations) to the new profile fields.
grant update (first_name, last_name, gender, province, district, subdistrict) on users to authenticated;
