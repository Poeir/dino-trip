-- Slimmer, better-ordered replacement for match_places_hybrid, used by the
-- chatbot and the trip planner (chatbot-service retriever.search_and_expand).
--
-- 1. Size. match_places_hybrid returns `setof places`, i.e. every column. Measured
--    on 2026-10-21: a 3-day trip's searches pulled ~10 MB, about 70% of it
--    `raw_data` (the Google dump) plus `embedding`, `reviews` and `images`,
--    none of which the callers read. This returns each row as jsonb without
--    those four columns. Dropping columns by name (instead of listing the ones
--    to keep) keeps the function valid whichever hand-applied column migrations
--    (market_time, subdistrict, ...) a database already has.
--
-- 2. Order. Every place whose tag matches the query scores exactly 1.0, so for
--    a query like "คาเฟ่" all ~150 matches tied and the database returned them
--    in no particular order. Ties are now broken by popularity: the rating
--    pulled toward 4.3 by 50 virtual reviews, so a 5.0 with 3 reviews doesn't
--    outrank a 4.6 with 2,000. Then by id, so results are stable.
--
-- Each row also carries `match_score` (the relevance used for ordering) so the
-- trip planner can re-rank within a relevance tier.
--
-- match_places_hybrid is left in place: the retriever falls back to it until
-- this migration is applied, and it can be dropped in a later migration.

create or replace function match_places_ranked(
  query_embedding vector(384),
  query_text text,
  match_count int,
  match_threshold float default 0.3,
  keyword_threshold float default 0.3
)
returns setof jsonb language sql stable as $$
  with scored as (
    select
      p,
      greatest(
        1 - (p.embedding <=> query_embedding),
        word_similarity(p.name, query_text),
        case when exists (
          select 1
          from unnest(p.tags) raw_tag, unnest(string_to_array(raw_tag, '/')) tag_part
          where query_text ilike '%' || tag_part || '%'
        ) then 1.0 else 0 end
      ) as score,
      (coalesce(p.rating, 0) * coalesce(p.review_count, 0) + 4.3 * 50)
        / (coalesce(p.review_count, 0) + 50) as popularity
    from places p
    where p.is_active
  )
  select (to_jsonb(s.p) - array['raw_data', 'embedding', 'reviews', 'images'])
         || jsonb_build_object('match_score', round(s.score::numeric, 4))
  from scored s
  -- Same filter as match_places_hybrid; a score of 1.0 covers the tag match.
  where (1 - ((s.p).embedding <=> query_embedding)) > match_threshold
     or word_similarity((s.p).name, query_text) > keyword_threshold
     or s.score = 1.0
  order by s.score desc, s.popularity desc, (s.p).id
  limit match_count
$$;

revoke execute on function match_places_ranked(vector, text, int, float, float) from public;
grant execute on function match_places_ranked(vector, text, int, float, float) to service_role;
