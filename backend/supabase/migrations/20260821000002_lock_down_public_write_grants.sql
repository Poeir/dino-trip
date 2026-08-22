-- Closes a real, verified hole: places/events/knowledge_base/rewards/qrs
-- were created with permissive "using (true)" RLS policies on the
-- assumption that nobody outside the trusted backend (service_role,
-- bypasses RLS) would ever hold a key that reaches them directly. Tourist
-- auth briefly shipped the anon key to the browser to talk to Supabase
-- Auth directly, which would have made that assumption false -- verified
-- live: an anon-key client with no session could UPDATE places and INSERT
-- into rewards. Auth has since moved fully behind the backend (see
-- auth.routes.js) so the anon key never ships to the browser at all
-- anymore, but this table-level revoke is cheap defense-in-depth so
-- correctness here never again depends on "nobody has the key" alone.
--
-- select stays granted (public read was always the intent -- see the
-- comment in 20260727000001_init_places.sql); only writes are revoked.
revoke insert, update, delete on places from anon, authenticated;
revoke insert, update, delete on events from anon, authenticated;
revoke insert, update, delete on knowledge_base from anon, authenticated;
revoke insert, update, delete on rewards from anon, authenticated;
revoke insert, update, delete on qrs from anon, authenticated;
