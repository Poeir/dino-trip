-- Where within an uploaded avatar photo to crop for the circular display
-- (CSS object-position, e.g. "62% 40%") -- the visitor drags the photo to
-- pick this on the signup persona card since object-fit: cover alone often
-- crops out the part of the photo that actually matters (see SignupPage.jsx).
-- Meaningless for a preset emoji avatar, so left null there.
alter table users add column if not exists avatar_position text;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, role, display_name, phone, first_name, last_name, gender, province, district, subdistrict, birthdate, occupation, avatar_url, avatar_position)
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
    new.raw_user_meta_data->>'occupation',
    new.raw_user_meta_data->>'avatar_url',
    new.raw_user_meta_data->>'avatar_position'
  );
  return new;
end;
$$;

grant update (avatar_position) on users to authenticated;
