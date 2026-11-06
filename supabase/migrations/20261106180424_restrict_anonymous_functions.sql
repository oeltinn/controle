-- Remove explicit default anon grants; public revocation alone is insufficient.
revoke execute on function public.admin_update_profile_role(uuid,text) from anon;
revoke execute on function public.can_access_clients() from anon;
revoke execute on function public.can_use_withdrawals() from anon;
revoke execute on function public.is_admin() from anon;
revoke execute on function public.record_onu_withdrawal_visit(uuid,text,text) from anon;
-- Trigger functions run through the trigger, never through the browser API.
revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;
