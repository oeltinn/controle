create table public.android_push_tokens (
  token text primary key check (length(token) between 20 and 4096),
  user_id uuid not null references public.profiles(id) on delete cascade,
  updated_at timestamptz not null default now()
);
create index android_push_tokens_user_idx on public.android_push_tokens(user_id);
alter table public.android_push_tokens enable row level security;
revoke all on public.android_push_tokens from public, anon, authenticated;
grant select, delete on public.android_push_tokens to service_role;
comment on table public.android_push_tokens is 'FCM registration tokens; access only through owner-scoped RPCs and the server service role.';

create or replace function public.register_android_push_token(p_token text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role in ('admin','operator','technician','attendant')
  ) then raise exception 'Acesso não autorizado'; end if;
  if p_token is null or length(p_token) not between 20 and 4096 then
    raise exception 'Token inválido'; end if;
  insert into public.android_push_tokens(token,user_id)
  values (p_token,(select auth.uid()))
  on conflict(token) do update set
    user_id=excluded.user_id, updated_at=now();
end;
$$;

create or replace function public.unregister_android_push_token(p_token text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.android_push_tokens
  where token=p_token and user_id=(select auth.uid());
end;
$$;
revoke all on function public.register_android_push_token(text),
  public.unregister_android_push_token(text) from public, anon;
grant execute on function public.register_android_push_token(text),
  public.unregister_android_push_token(text) to authenticated;
