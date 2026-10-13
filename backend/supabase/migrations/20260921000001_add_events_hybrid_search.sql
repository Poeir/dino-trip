-- Wires events into hybrid search the same way places/knowledge_base already
-- work (see 20260728000007_add_hybrid_search.sql). The embedding column and
-- pending/expiry logic already existed (20260914000003_events_dates_and_embedding.sql)
-- but nothing ever queried it -- this is the "add one if/when events are
-- wired into retrieval" follow-up that migration's comment called out.

create index if not exists events_embedding_idx on events using hnsw (embedding vector_cosine_ops);
create index if not exists events_name_trgm_idx on events using gin (name gin_trgm_ops);
-- tags_to_text() (from 20260728000007_add_hybrid_search.sql) is generic over
-- any text[] column, not places-specific -- reused here for suitable_for.
create index if not exists events_suitable_for_trgm_idx on events using gin (tags_to_text(suitable_for) gin_trgm_ops);

-- Cancelled events are excluded outright (not just left to fall out via
-- low similarity) -- a cancelled event scoring a high match would otherwise
-- get recommended to a user as if it were still happening. Expired events
-- don't need the same guard here: embedder.py's expire_events() already
-- clears their embedding, so `e.embedding is not null` on its own already
-- keeps them out.
create or replace function match_events_hybrid(
  query_embedding vector(384),
  query_text text,
  match_count int,
  match_threshold float default 0.3,
  keyword_threshold float default 0.3
)
returns setof events language sql stable as $$
  select e.*
  from events e
  where e.embedding is not null
    and e.status <> 'cancelled'
    and (
      (1 - (e.embedding <=> query_embedding)) > match_threshold
      or word_similarity(e.name, query_text) > keyword_threshold
      or exists (
           select 1 from unnest(e.suitable_for) t
           where word_similarity(t, query_text) > keyword_threshold
         )
    )
  order by
    greatest(
      1 - (e.embedding <=> query_embedding),
      word_similarity(e.name, query_text),
      coalesce((select max(word_similarity(t, query_text)) from unnest(e.suitable_for) t), 0)
    ) desc
  limit match_count
$$;
