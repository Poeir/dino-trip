-- Admin control for the "ยอดนิยม" badge on place cards.
-- null = automatic (shown when the place has >= 1500 reviews), 'show' = always, 'hide' = never.
alter table public.places
  add column if not exists popular_badge text
  check (popular_badge in ('show', 'hide'));
