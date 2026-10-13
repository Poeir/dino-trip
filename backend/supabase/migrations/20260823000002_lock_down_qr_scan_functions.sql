-- Closes a real, verified hole in the previous migration: `revoke execute
-- ... from public` did NOT stop anon/authenticated from calling
-- claim_qr_scan/redeem_reward directly via PostgREST RPC -- verified live,
-- an anon-key request successfully invoked claim_qr_scan with an arbitrary
-- p_user_id. This project's public schema has default privileges that
-- grant EXECUTE on new functions directly to anon/authenticated (not
-- routed through the PUBLIC pseudo-role), so revoking from PUBLIC alone
-- left those direct grants untouched. Revoking from the roles by name is
-- what actually removes them.
revoke execute on function claim_qr_scan(uuid, uuid) from anon, authenticated;
revoke execute on function redeem_reward(uuid, uuid) from anon, authenticated;
