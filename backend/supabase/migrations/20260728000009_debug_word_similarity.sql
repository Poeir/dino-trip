-- Temporary: inspect real word_similarity() scores to diagnose why short
-- Thai tag fragments are over-matching unrelated queries. Will be dropped
-- once the real match_places_hybrid threshold/logic is fixed.
create or replace function debug_word_similarity(a text, b text)
returns float language sql stable as $$
  select word_similarity(a, b)
$$;
