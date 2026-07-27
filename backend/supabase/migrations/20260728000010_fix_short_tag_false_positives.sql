-- word_similarity() on short tag fragments (<=4 chars, e.g. "ก้อย", "ลาบ")
-- turned out to be unreliable -- measured directly via debug_word_similarity:
-- 'ก้อย' vs the totally unrelated 'อยากกินซูชิ' scored 0.4, higher than our
-- 0.3 threshold, causing laab restaurants to surface for sushi/BBQ queries.
-- Longer strings (place `name`) don't show this problem (verified 0 score
-- against unrelated queries), so only the tag-matching path needs to change:
-- rely purely on exact substring containment (ILIKE) for tags, which is
-- deterministic and doesn't have this short-string trigram noise issue.
create or replace function match_places_hybrid(
  query_embedding vector(384),
  query_text text,
  match_count int,
  match_threshold float default 0.3,
  keyword_threshold float default 0.3
)
returns setof places language sql stable as $$
  select p.*
  from places p
  where (1 - (p.embedding <=> query_embedding)) > match_threshold
     or word_similarity(p.name, query_text) > keyword_threshold
     or exists (
          select 1
          from unnest(p.tags) raw_tag, unnest(string_to_array(raw_tag, '/')) tag_part
          where query_text ilike '%' || tag_part || '%'
        )
  order by
    greatest(
      1 - (p.embedding <=> query_embedding),
      word_similarity(p.name, query_text),
      case when exists (
        select 1
        from unnest(p.tags) raw_tag, unnest(string_to_array(raw_tag, '/')) tag_part
        where query_text ilike '%' || tag_part || '%'
      ) then 1.0 else 0 end
    ) desc
  limit match_count
$$;

drop function if exists debug_word_similarity(text, text);
