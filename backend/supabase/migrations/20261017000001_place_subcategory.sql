-- Finer type within a category (e.g. a ร้านอาหาร that is ก๋วยเตี๋ยว vs ปิ้งย่าง/ชาบู),
-- used by the public place list's second chip row. Values are fixed per category
-- (see backend/src/lib/placeSubcategory.js). Not a Google-sync field, so syncing
-- never touches it; null = not classified yet.
alter table public.places
  add column if not exists subcategory text;

create index if not exists places_category_subcategory_idx
  on public.places (category, subcategory);
