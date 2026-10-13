-- Avatar picture for the persona card shown at signup -- either a preset
-- key ("preset:<name>") the frontend renders locally, or a public Storage
-- URL for an uploaded photo (see POST /api/auth/avatar-upload). Kept as a
-- short string in both cases so it's cheap to carry through the signUp
-- metadata like the other profile fields, unlike embedding image bytes
-- directly which would bloat the session JWT/cookie.
alter table users add column if not exists avatar_url text;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, role, display_name, phone, first_name, last_name, gender, province, district, subdistrict, birthdate, occupation, avatar_url)
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
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;

grant update (avatar_url) on users to authenticated;

-- Public bucket for uploaded avatar photos: only the backend (service role,
-- via POST /api/auth/avatar-upload) ever writes to it, bypassing RLS, so no
-- insert/update policy is needed -- "public" just means reads don't need
-- one either, since a profile picture isn't sensitive.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;
