-- Zoom level (1-3) chosen alongside avatar_position when cropping an
-- uploaded photo -- object-position alone can't express "zoomed in 1.5x
-- centered here", so the persona card/avatar display applies both together
-- (see personaAvatarContent in SignupPage.jsx: object-position + transform: scale()).
alter table users add column if not exists avatar_scale numeric;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, role, display_name, phone, first_name, last_name, gender, province, district, subdistrict, birthdate, occupation, avatar_url, avatar_position, avatar_scale)
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
    new.raw_user_meta_data->>'avatar_position',
    (new.raw_user_meta_data->>'avatar_scale')::numeric
  );
  return new;
end;
$$;

grant update (avatar_scale) on users to authenticated;
