-- match_places_hybrid (chatbot RAG) never filtered on places.is_active, so a
-- place an admin hid from the site -- or a venue pin quick-added from Google
-- while creating an event (inserted with is_active = false, see
-- 20260917000001) -- could still be recommended by the chatbot. Same body as
-- 20260728000010, with the is_active guard wrapped around the existing OR
-- group. Signature and return type are unchanged.
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
  where p.is_active
    and (
      (1 - (p.embedding <=> query_embedding)) > match_threshold
      or word_similarity(p.name, query_text) > keyword_threshold
      or exists (
           select 1
           from unnest(p.tags) raw_tag, unnest(string_to_array(raw_tag, '/')) tag_part
           where query_text ilike '%' || tag_part || '%'
         )
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
