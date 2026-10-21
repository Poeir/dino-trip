-- The trip planner can now plan a breakfast (when the traveller picks the
-- "อาหารเช้า" food choice), so a saved trip item's meal_role may be
-- 'breakfast' too. The original inline check (20260927000001) got Postgres's
-- default name, trip_items_meal_role_check.
alter table trip_items drop constraint if exists trip_items_meal_role_check;
alter table trip_items add constraint trip_items_meal_role_check
  check (meal_role in ('breakfast', 'lunch', 'dinner'));
