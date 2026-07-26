-- llm_extractor.py's check_is_open() needs Google's raw structured opening-hours
-- periods (day/hour/minute) to compute wait times and open/closed status --
-- `places.hours` is only a formatted display string, not usable for that math.
alter table places add column if not exists hours_periods jsonb;
