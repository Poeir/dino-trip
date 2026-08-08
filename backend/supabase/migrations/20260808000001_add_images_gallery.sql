-- Places can have several Google photos; `img` only ever held one. Add a
-- gallery column and backfill it from the existing single `img` so nothing
-- regresses for places that haven't been re-fetched with the new
-- multi-photo pipeline yet.
alter table places add column if not exists images text[] not null default '{}';

update places
set images = array[img]
where images = '{}' and img is not null and img <> '';
