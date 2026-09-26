-- A generated itinerary is not only rows of `places`: chatbot-service also
-- emits a "return to the hotel" slot (the tourist's own accommodation, often
-- just coordinates) and "Free Time" filler blocks. Neither has a places row,
-- so trip_items needs to say what kind of slot it is and keep its own name
-- and coordinates for the ones with no place to join against.
alter table trip_items add column if not exists kind text not null default 'place'
  check (kind in ('place', 'hotel', 'free_time'));
alter table trip_items add column if not exists snapshot_lat double precision;
alter table trip_items add column if not exists snapshot_lng double precision;
