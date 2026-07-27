-- The previous migration's `create or replace function match_places(..., match_count int, match_threshold float default 0.3)`
-- did NOT replace the old 2-arg match_places(query_embedding, match_count) --
-- Postgres identifies functions by name+parameter-types, so it created a
-- second overload instead. Because the new function's threshold has a
-- default, both overloads are callable with just 2 positional args, so
-- PostgREST can no longer tell them apart (PGRST203: "Could not choose the
-- best candidate function"). Drop the old 2-arg signatures explicitly so only
-- the 3-arg (with default) versions remain.
drop function if exists match_places(vector(384), int);
drop function if exists match_knowledge_base(vector(384), int);
