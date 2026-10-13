-- Phone number, collected at signup: unlike email, it's the field TAT
-- Khon Kaen staff can realistically look a tourist's account up by at the
-- redemption counter (UC-08), where the browser isn't in the loop at all.
alter table users add column if not exists phone text;

-- Re-create the signup trigger to also copy phone from the auth metadata
-- the backend's signUp call sets (see auth.routes.js). CREATE OR REPLACE
-- keeps the same security definer/search_path as the original definition
-- in 20260821000001_add_users.sql.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, role, display_name, phone)
  values (
    new.id,
    'tourist',
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'phone'
  );
  return new;
end;
$$;

-- Extend the same "own row, this column only" pattern used for
-- display_name (see 20260821000001_add_users.sql) to phone.
grant update (display_name, phone) on users to authenticated;
