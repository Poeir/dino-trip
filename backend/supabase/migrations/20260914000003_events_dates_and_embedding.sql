-- Structured start/end dates for events, plus RAG embedding support (see
-- 20260728000001_add_rag.sql for the places/knowledge_base equivalent).
--
-- `date_range` stays as the free-form display text an admin can hand-edit
-- (e.g. "ทุกวันเสาร์-อาทิตย์เดือน ธ.ค."), so it can't be trusted to tell
-- whether a festival has already ended. event_start_date/event_end_date are
-- the ISO dates the admin form's date pickers already compute before
-- formatting `date_range` -- now actually persisted, so
-- chatbot-service/src/services/rag/embedder.py can tell a past event apart
-- from an upcoming one and drop its embedding once it's over.
--
-- No HNSW index here (unlike places/knowledge_base): nothing queries
-- events.embedding via similarity search yet, so an index would just be
-- upkeep with no reader. Add one if/when events are wired into retrieval.
alter table events add column if not exists event_start_date date;
alter table events add column if not exists event_end_date date;
alter table events add column if not exists embedding vector(384);
