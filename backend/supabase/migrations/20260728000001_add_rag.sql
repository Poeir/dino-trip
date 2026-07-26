-- RAG support: pgvector embeddings for places + knowledge_base, plus the raw
-- numeric Google price_level (0-4) needed for trip-planner budget filtering
-- (places.price is a formatted display string, not usable for range filters).
create extension if not exists vector;

alter table places add column if not exists embedding vector(384);
alter table places add column if not exists price_level smallint;

alter table knowledge_base add column if not exists embedding vector(384);

create index if not exists places_embedding_idx on places using hnsw (embedding vector_cosine_ops);
create index if not exists knowledge_base_embedding_idx on knowledge_base using hnsw (embedding vector_cosine_ops);

-- <=> ordering isn't expressible through the supabase-js query builder, so the
-- Edge Functions call these via supabase.rpc(...) instead.
create or replace function match_places(query_embedding vector(384), match_count int)
returns setof places language sql stable as $$
  select * from places order by embedding <=> query_embedding limit match_count
$$;

create or replace function match_knowledge_base(query_embedding vector(384), match_count int)
returns setof knowledge_base language sql stable as $$
  select * from knowledge_base order by embedding <=> query_embedding limit match_count
$$;
