-- match_places/match_knowledge_base previously returned the top-N nearest
-- neighbours unconditionally, even when nothing in the table was actually
-- close to the query (e.g. a totally unrelated question) -- the chatbot then
-- had to rely on the LLM alone to notice the retrieved context was garbage.
-- Add a cosine-similarity floor so unrelated queries get an empty result set
-- instead of "closest of what we have". Old 2-arg calls keep working via the
-- default.
create or replace function match_places(query_embedding vector(384), match_count int, match_threshold float default 0.3)
returns setof places language sql stable as $$
  select * from places
  where 1 - (embedding <=> query_embedding) > match_threshold
  order by embedding <=> query_embedding
  limit match_count
$$;

create or replace function match_knowledge_base(query_embedding vector(384), match_count int, match_threshold float default 0.3)
returns setof knowledge_base language sql stable as $$
  select * from knowledge_base
  where 1 - (embedding <=> query_embedding) > match_threshold
  order by embedding <=> query_embedding
  limit match_count
$$;
