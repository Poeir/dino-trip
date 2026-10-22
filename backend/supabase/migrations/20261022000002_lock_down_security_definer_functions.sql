-- Re-lock every security definer function to service_role only.
--
-- Checked live on 2026-10-22: anon and authenticated could EXECUTE all six
-- below. 20260823000002 revoked an older claim_qr_scan/redeem_reward, but later
-- migrations recreated these with new signatures, and Supabase's default
-- privileges grant EXECUTE on new public functions to anon/authenticated
-- directly (revoking from public alone doesn't remove that). Through PostgREST
-- that meant anyone holding the project's anon key could, e.g., call
-- adjust_points. The backend connects as postgres and chatbot-service uses
-- service_role, so neither is affected.
--
-- Apply on its own, then re-run the check:
--   select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');
-- (expect no rows)

revoke execute on function adjust_points(uuid, integer, text, uuid) from public, anon, authenticated;
revoke execute on function admin_cancel_redemption(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function admin_redeem_reward(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function claim_qr_scan(uuid, uuid, double precision, double precision) from public, anon, authenticated;
revoke execute on function claim_google_fallback_call(integer) from public, anon, authenticated;
revoke execute on function record_place_candidates(jsonb, text) from public, anon, authenticated;

grant execute on function adjust_points(uuid, integer, text, uuid) to service_role;
grant execute on function admin_cancel_redemption(uuid, uuid, text) to service_role;
grant execute on function admin_redeem_reward(uuid, uuid, uuid) to service_role;
grant execute on function claim_qr_scan(uuid, uuid, double precision, double precision) to service_role;
grant execute on function claim_google_fallback_call(integer) to service_role;
grant execute on function record_place_candidates(jsonb, text) to service_role;

-- Functions created from now on: no automatic EXECUTE for anon/authenticated.
alter default privileges in schema public revoke execute on functions from anon, authenticated;
