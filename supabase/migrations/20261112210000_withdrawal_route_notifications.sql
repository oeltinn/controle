create function public.notify_withdrawal_route(p_withdrawal_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  technician text;
  customer text;
  message_id uuid;
begin
  select coalesce(nullif(btrim(display_name), ''), 'Um técnico') into technician
  from public.profiles where id = actor and role = 'technician';
  if not found then raise exception 'Acesso restrito a técnicos'; end if;

  select name into customer from public.onu_withdrawals
  where id = p_withdrawal_id and (equipment <> 'A identificar' or include_without_equipment);
  if not found then raise exception 'Retirada indisponível'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 0));
  if exists (
    select 1 from public.app_notifications
    where created_by = actor and title = 'Rota de retirada aberta'
      and created_at > now() - interval '1 minute'
      and body = left(technician || ' abriu a rota para a retirada de ' || customer || '.', 500)
  ) or not exists (select 1 from public.profiles where role = 'attendant') then
    return null;
  end if;

  insert into public.app_notifications(title, body, created_by)
  values ('Rota de retirada aberta', left(technician || ' abriu a rota para a retirada de ' || customer || '.', 500), actor)
  returning id into message_id;
  insert into public.app_notification_recipients(notification_id, user_id)
  select message_id, id from public.profiles where role = 'attendant';
  return message_id;
end;
$$;

revoke all on function public.notify_withdrawal_route(uuid) from public, anon;
grant execute on function public.notify_withdrawal_route(uuid) to authenticated;
