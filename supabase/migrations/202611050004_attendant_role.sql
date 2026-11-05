-- Adds the restricted attendant role for client and ONU withdrawal workflows.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'operator', 'technician', 'attendant', 'pending'));

create or replace function public.admin_update_profile_role(p_user_id uuid, p_role text)
returns jsonb language sql security definer set search_path = ''
as $$
  update public.profiles p
  set role = p_role
  where p.id = p_user_id
    and p_role in ('pending', 'technician', 'attendant', 'operator', 'admin')
    and (select public.is_admin())
  returning to_jsonb(p);
$$;
revoke all on function public.admin_update_profile_role(uuid, text) from public;
grant execute on function public.admin_update_profile_role(uuid, text) to authenticated;

create or replace function public.can_access_clients()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('admin', 'operator', 'attendant')
  );
$$;
revoke all on function public.can_access_clients() from public;
grant execute on function public.can_access_clients() to authenticated;

create or replace function public.can_use_withdrawals()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('admin', 'operator', 'technician', 'attendant')
  );
$$;
revoke all on function public.can_use_withdrawals() from public;
grant execute on function public.can_use_withdrawals() to authenticated;

create or replace function public.record_onu_withdrawal_visit(p_withdrawal_id uuid, p_result text, p_observation text)
returns uuid language sql security definer set search_path = ''
as $$
  with allowed_staff as (
    select p.id, p.display_name from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('admin', 'operator', 'technician', 'attendant')
  ), inserted as (
    insert into public.onu_withdrawal_visits(withdrawal_id, technician_id, technician_name, result, observation)
    select p_withdrawal_id, s.id, s.display_name, p_result, trim(coalesce(p_observation, ''))
    from allowed_staff s
    where p_result in ('pending', 'visited', 'no_answer')
      and (p_result = 'pending' or length(trim(coalesce(p_observation, ''))) > 0)
      and exists (select 1 from public.onu_withdrawals w where w.id = p_withdrawal_id)
    returning id
  )
  select id from inserted;
$$;
revoke all on function public.record_onu_withdrawal_visit(uuid, text, text) from public;
grant execute on function public.record_onu_withdrawal_visit(uuid, text, text) to authenticated;
