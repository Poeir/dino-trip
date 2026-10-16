-- Admin-pinned "featured" places: shown first in the public list's default
-- (recommended) ordering, so landmark places aren't buried under restaurants.
alter table public.places
  add column if not exists is_featured boolean not null default false;

-- Starter set of well-known Khon Kaen landmarks (exact names as imported from
-- Google); admins can change this from the place edit form afterwards.
update public.places set is_featured = true
where is_active
  and name in (
    'พระมหาธาตุแก่นนคร',
    'พระธาตุขามแก่น จังหวัดขอนแก่น',
    'สวนสัตว์ขอนแก่น',
    'ตลาดต้นตาล',
    'วัดทุ่งเศรษฐี',
    'ถนนคนเดินขอนแก่น',
    'เมืองโบราณโนนเมือง',
    'Blue Lagoon ภูผาม่าน',
    'ศูนย์ศึกษาวิจัยและพิพิธภัณฑ์ไดโนเสาร์ (พิพิธภัณฑ์ไดโนเสาร์ภูเวียง)'
  );
