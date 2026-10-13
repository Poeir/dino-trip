-- Finishes the lock-down started in 20260821000002. That migration revoked
-- INSERT/UPDATE/DELETE from anon/authenticated on the content tables but left
-- the permissive "using (true)" write RLS policies in place, so the
-- protection rested on the grant alone (and the security checklist recorded
-- that the revoke "did not stick" on the live project). Dropping the policies
-- makes RLS deny anon/authenticated writes even if a grant is ever restored.
--
-- The backend connects as postgres / service_role, which bypasses RLS, so
-- nothing the app does changes. Public read (select) policies are untouched:
-- the site still reads these tables directly by design.
drop policy if exists "public write places" on places;
drop policy if exists "public update places" on places;
drop policy if exists "public delete places" on places;

drop policy if exists "public write place_photos" on place_photos;
drop policy if exists "public update place_photos" on place_photos;
drop policy if exists "public delete place_photos" on place_photos;

drop policy if exists "public write events" on events;
drop policy if exists "public update events" on events;
drop policy if exists "public delete events" on events;

drop policy if exists "public write event_photos" on event_photos;
drop policy if exists "public update event_photos" on event_photos;
drop policy if exists "public delete event_photos" on event_photos;

drop policy if exists "public write knowledge_base" on knowledge_base;
drop policy if exists "public update knowledge_base" on knowledge_base;
drop policy if exists "public delete knowledge_base" on knowledge_base;

drop policy if exists "public write rewards" on rewards;
drop policy if exists "public update rewards" on rewards;
drop policy if exists "public delete rewards" on rewards;

drop policy if exists "public write qrs" on qrs;
drop policy if exists "public update qrs" on qrs;
drop policy if exists "public delete qrs" on qrs;

-- Re-assert the grant-level revoke (idempotent) including the two photo
-- tables the earlier migration missed.
revoke insert, update, delete on places, place_photos, events, event_photos,
  knowledge_base, rewards, qrs from anon, authenticated;
