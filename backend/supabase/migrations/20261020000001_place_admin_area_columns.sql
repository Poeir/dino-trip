-- Split a place's administrative area into queryable columns so admins can see
-- places per อำเภอ / ตำบล. `district` already existed but held Google's raw
-- spelling ("อำเภอเมืองขอนแก่น", "เมือง", "อ.เมือง", "Muang", "อำเภอ ภูผาม่าน"),
-- so `group by district` split one district into several buckets.
--
-- Values are stored bare (no อำเภอ/ตำบล/จังหวัด prefix) and use the same
-- spelling as frontend/src/data/thaiAddress.json -- the list `users.district`
-- / `users.subdistrict` come from -- so places and users can be compared
-- directly. Mueang is therefore "เมืองขอนแก่น", not "เมือง".
--
-- Source order for ตำบล/อำเภอ/จังหวัด: Google addressComponents in raw_data,
-- then the Thai address text. Rows with neither stay null.

alter table public.places
  add column if not exists province text,
  add column if not exists subdistrict text;

with src as (
  select
    id,
    address,
    nullif(btrim(regexp_replace(coalesce(district, ''), '[​-‍﻿]', '', 'g')), '') as d_old,
    (select x->>'longText' from jsonb_array_elements(coalesce(raw_data->'addressComponents', '[]'::jsonb)) x
      where x->'types' ? 'sublocality_level_1' limit 1) as sub_c,
    (select x->>'longText' from jsonb_array_elements(coalesce(raw_data->'addressComponents', '[]'::jsonb)) x
      where x->'types' ? 'administrative_area_level_1' limit 1) as prov_c
  from public.places
),
clean as (
  select
    id,
    btrim(regexp_replace(coalesce(d_old, substring(address from 'อำเภอ\s*([ก-๛]+)'), ''),
                         '^(อำเภอ|อ\.|amphur|amphoe)\s*', '', 'i')) as d1,
    btrim(regexp_replace(coalesce(sub_c, ''), '^(ตำบล|ต\.|tumbon|tambon)\s*', '', 'i')) as s1,
    substring(address from 'ตำบล\s*([ก-๛]+)') as s_addr,
    btrim(regexp_replace(coalesce(prov_c, ''), '^(จังหวัด)\s*', '')) as p1,
    address
  from src
)
update public.places p
set
  district = case
      when c.d1 = '' then null
      when c.d1 in ('เมือง', 'เมืองขอนแก่น') or lower(c.d1) in ('muang', 'mueang') then 'เมืองขอนแก่น'
      else c.d1
    end,
  subdistrict = case
      when c.s1 ~ '[ก-๛]' then c.s1
      else c.s_addr
    end,
  province = case
      when c.p1 = 'ขอนแก่น' or lower(c.p1) = 'khon kaen' then 'ขอนแก่น'
      when c.address ~ 'ขอนแก่น' or c.address ilike '%khon kaen%' then 'ขอนแก่น'
      else null
    end
from clean c
where c.id = p.id;

create index if not exists places_district_subdistrict_idx on public.places (district, subdistrict);
