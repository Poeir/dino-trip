-- word_similarity on `tags` alone missed short compound tag values like
-- "ลาบ/ก้อย" against a query like "อยากกินลาบ" -- pg_trgm's trigram scoring
-- is inherently weak on very short strings (few trigrams to compare), and
-- "ลาบ" is only 3 characters. Since `tags` is a small curated vocabulary
-- (see backend/scripts/import-places*.js FOOD_TYPE_TAGS/NAME_KEYWORD_TAGS),
-- a plain substring check on each '/'-separated component is a more
-- reliable signal than fuzzy similarity for this specific field -- keep
-- word_similarity too since it still helps with typos/partial overlaps.
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
             or word_similarity(tag_part, query_text) > keyword_threshold
        )
  order by
    greatest(
      1 - (p.embedding <=> query_embedding),
      word_similarity(p.name, query_text),
      coalesce(
        (
          select max(word_similarity(tag_part, query_text))
          from unnest(p.tags) raw_tag, unnest(string_to_array(raw_tag, '/')) tag_part
        ),
        0
      )
    ) desc
  limit match_count
$$;
