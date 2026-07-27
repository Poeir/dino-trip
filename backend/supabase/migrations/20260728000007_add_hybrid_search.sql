-- Hybrid search: combine pgvector cosine similarity with pg_trgm keyword
-- matching. Vector search alone misses rows that genuinely answer a query
-- but sit just outside the embedding model's notion of "close enough" --
-- confirmed by testing: cuisine-specific queries like "ลาบ"/"ซูชิ" didn't
-- surface the correctly-tagged restaurants even after tags were added
-- (20260728... food-tag work in the app layer). Thai doesn't tokenize on
-- whitespace, so Postgres's built-in to_tsvector/full-text search isn't a
-- good fit here -- pg_trgm's character-trigram similarity works regardless
-- of word boundaries, so it's a much better match for Thai keyword search.
--
-- New function names rather than new overloads of match_places/
-- match_knowledge_base, to avoid the exact PostgREST overload-ambiguity
-- problem already hit once in 20260728000004_drop_old_match_overloads.sql.
create extension if not exists pg_trgm;

-- Postgres's planner won't accept the built-in array_to_string() directly in
-- a GIN index expression ("functions in index expression must be marked
-- IMMUTABLE", SQLSTATE 42P17) even though it behaves immutably -- wrapping it
-- in an explicit `language sql immutable` function is the standard fix.
create or replace function tags_to_text(text[])
returns text language sql immutable as $$
  select array_to_string($1, ' ')
$$;

create index if not exists places_name_trgm_idx on places using gin (name gin_trgm_ops);
create index if not exists places_tags_trgm_idx on places using gin (tags_to_text(tags) gin_trgm_ops);
create index if not exists knowledge_base_title_trgm_idx on knowledge_base using gin (title gin_trgm_ops);

-- word_similarity (not plain similarity) because query_text is typically a
-- full sentence (or an LLM-rewritten standalone query) while `name`/tags are
-- short -- word_similarity finds the best-matching *substring* of the longer
-- text instead of requiring the whole strings to be alike.
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
          select 1 from unnest(p.tags) t
          where word_similarity(t, query_text) > keyword_threshold
        )
  order by
    greatest(
      1 - (p.embedding <=> query_embedding),
      word_similarity(p.name, query_text),
      coalesce((select max(word_similarity(t, query_text)) from unnest(p.tags) t), 0)
    ) desc
  limit match_count
$$;

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
  where (1 - (k.embedding <=> query_embedding)) > match_threshold
     or word_similarity(k.title, query_text) > keyword_threshold
  order by
    greatest(
      1 - (k.embedding <=> query_embedding),
      word_similarity(k.title, query_text)
    ) desc
  limit match_count
$$;
