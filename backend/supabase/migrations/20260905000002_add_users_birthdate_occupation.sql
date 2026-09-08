-- Birthdate (so the app can compute current age) and a coarse occupation
-- category, collected at signup for the same demographics reason as
-- gender/province/district/subdistrict in the prior migration.
alter table users add column if not exists birthdate date;
alter table users add column if not exists occupation text;

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
  insert into public.users (id, role, display_name, phone, first_name, last_name, gender, province, district, subdistrict, birthdate, occupation)
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
    new.raw_user_meta_data->>'subdistrict',
    (new.raw_user_meta_data->>'birthdate')::date,
    new.raw_user_meta_data->>'occupation'
  );
  return new;
end;
$$;

-- Extend the same "own row, this column only" pattern used for the other
-- profile fields (see prior migrations) to birthdate/occupation.
grant update (birthdate, occupation) on users to authenticated;
