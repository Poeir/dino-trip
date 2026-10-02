-- match_knowledge_base_hybrid (chatbot RAG) ignored knowledge_base.is_active
-- and is_pinned, so an entry an admin switched off in the dashboard was still
-- retrieved and used to answer, and "pinned" had no effect at all.
--   * is_active: inactive rows are never returned.
--   * is_pinned: a pinned row gets a ranking boost, so it wins over an
--     unpinned row of similar relevance. It still has to clear the similarity
--     /keyword threshold -- pinning must not inject unrelated text into every
--     answer.
-- Same body as 20260728000007 otherwise; signature and return type unchanged.
create or replace function match_knowledge_base_hybrid(
  query_embedding vector(384),
  query_text text,
  match_count int,
  match_threshold float default 0.3,
  keyword_threshold float default 0.3
)
returns setof knowledge_base language sql stable as $$
  select k.*
  from knowledge_base k
  where k.is_active
    and (
      (1 - (k.embedding <=> query_embedding)) > match_threshold
      or word_similarity(k.title, query_text) > keyword_threshold
    )
  order by
    greatest(
      1 - (k.embedding <=> query_embedding),
      word_similarity(k.title, query_text)
    ) + case when k.is_pinned then 0.15 else 0 end desc
  limit match_count
$$;
