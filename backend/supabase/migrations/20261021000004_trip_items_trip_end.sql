-- The trip planner can end the last day somewhere other than the hotel (an
-- airport, bus terminal, railway station, district or pin: chatbot-service
-- trip_ends.py). That final slot is saved as kind 'trip_end', with its own
-- name and coordinates like the hotel slot. The original inline check
-- (20260927000002) got Postgres's default name, trip_items_kind_check.
alter table trip_items drop constraint if exists trip_items_kind_check;
alter table trip_items add constraint trip_items_kind_check
  check (kind in ('place', 'hotel', 'free_time', 'trip_end'));
