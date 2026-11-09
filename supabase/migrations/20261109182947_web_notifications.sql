-- In-app notifications and opt-in browser push subscriptions.
create table public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 100),
  body text not null check (length(btrim(body)) between 1 and 500),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.app_notification_recipients (
  notification_id uuid not null references public.app_notifications(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz,
  primary key (notification_id, user_id)
);
create index app_notification_recipients_user_idx on public.app_notification_recipients (user_id, notification_id);
create index app_notifications_created_at_idx on public.app_notifications (created_at desc);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique check (length(endpoint) between 20 and 2048 and endpoint like 'https://%'),
  p256dh text not null check (length(p256dh) between 20 and 512),
  auth_secret text not null check (length(auth_secret) between 10 and 512),
  updated_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.app_notifications enable row level security;
alter table public.app_notification_recipients enable row level security;
alter table public.push_subscriptions enable row level security;

revoke all on public.app_notifications, public.app_notification_recipients, public.push_subscriptions from anon;
grant select on public.app_notifications, public.app_notification_recipients to authenticated;

create policy "Recipients read notification messages" on public.app_notifications
  for select to authenticated using (
    exists (select 1 from public.app_notification_recipients r
      where r.notification_id = id and r.user_id = (select auth.uid()))
  );
create policy "Users read own notification inbox" on public.app_notification_recipients
  for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.profiles where id = (select auth.uid())
    and role in ('admin', 'operator', 'technician', 'attendant')
  ) then raise exception 'Acesso não autorizado'; end if;
  if length(p_endpoint) not between 20 and 2048 or p_endpoint not like 'https://%'
    or length(p_p256dh) not between 20 and 512 or length(p_auth) not between 10 and 512 then
    raise exception 'Inscrição de notificações inválida';
  end if;
  insert into public.push_subscriptions(user_id,endpoint,p256dh,auth_secret)
  values ((select auth.uid()),p_endpoint,p_p256dh,p_auth)
  on conflict (endpoint) do update set
    user_id = excluded.user_id, p256dh = excluded.p256dh,
    auth_secret = excluded.auth_secret, updated_at = now();
end;
$$;

create or replace function public.unregister_push_subscription(p_endpoint text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.push_subscriptions
  where endpoint = p_endpoint and user_id = (select auth.uid());
end;
$$;

create or replace function public.mark_app_notification_read(p_notification_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.app_notification_recipients
    set read_at = coalesce(read_at, now())
    where notification_id = p_notification_id and user_id = (select auth.uid());
end;
$$;

create or replace function public.create_app_notification(
  p_title text, p_body text, p_target_role text default null, p_target_user uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_count integer;
begin
  if not (select public.is_admin()) then raise exception 'Somente administradores podem enviar notificações'; end if;
  if length(btrim(coalesce(p_title,''))) not between 1 and 100
    or length(btrim(coalesce(p_body,''))) not between 1 and 500 then
    raise exception 'Título ou mensagem inválidos';
  end if;
  if (p_target_user is null) = (p_target_role is null) then
    raise exception 'Selecione uma função ou um usuário';
  end if;
  if p_target_role is not null and p_target_role not in ('all','admin','operator','technician','attendant') then
    raise exception 'Função inválida';
  end if;
  if (select count(*) from public.app_notifications
      where created_by = (select auth.uid()) and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Limite de 20 notificações por hora atingido';
  end if;
  select count(*) into v_count from public.profiles
    where role in ('admin','operator','technician','attendant')
      and ((p_target_user is not null and id = p_target_user)
        or (p_target_role is not null and (p_target_role = 'all' or role = p_target_role)));
  if v_count = 0 then raise exception 'Nenhum destinatário autorizado encontrado'; end if;
  insert into public.app_notifications(title,body,created_by)
    values (btrim(p_title),btrim(p_body),(select auth.uid())) returning id into v_id;
  insert into public.app_notification_recipients(notification_id,user_id)
    select v_id,id from public.profiles
    where role in ('admin','operator','technician','attendant')
      and ((p_target_user is not null and id = p_target_user)
        or (p_target_role is not null and (p_target_role = 'all' or role = p_target_role)));
  return v_id;
end;
$$;

revoke all on function public.register_push_subscription(text,text,text),
  public.unregister_push_subscription(text), public.mark_app_notification_read(uuid),
  public.create_app_notification(text,text,text,uuid) from public, anon;
grant execute on function public.register_push_subscription(text,text,text),
  public.unregister_push_subscription(text), public.mark_app_notification_read(uuid),
  public.create_app_notification(text,text,text,uuid) to authenticated;
