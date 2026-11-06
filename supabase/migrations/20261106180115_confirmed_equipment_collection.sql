-- Explicit confirmation prevents counting visits as collections.
ALTER TABLE public.onu_withdrawal_visits DROP CONSTRAINT onu_withdrawal_visits_result_check;
ALTER TABLE public.onu_withdrawal_visits ADD CONSTRAINT onu_withdrawal_visits_result_check CHECK (result IN ('pending', 'visited', 'no_answer', 'collected'));

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
    where p_result in ('pending', 'visited', 'no_answer', 'collected')
      and (p_result = 'pending' or length(trim(coalesce(p_observation, ''))) > 0)
      and exists (select 1 from public.onu_withdrawals w where w.id = p_withdrawal_id)
    returning id
  )
  select id from inserted;
$$;
revoke all on function public.record_onu_withdrawal_visit(uuid, text, text) from public;
grant execute on function public.record_onu_withdrawal_visit(uuid, text, text) to authenticated;

