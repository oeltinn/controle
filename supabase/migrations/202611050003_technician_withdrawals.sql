-- Technician accounts, account profiles, and ONU recovery workflows.
alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists phone text;
update public.profiles
set display_name = coalesce(nullif(trim(display_name), ''), nullif(split_part(email, '@', 1), ''), 'Usuário')
where display_name is null or trim(display_name) = '';
alter table public.profiles alter column display_name set not null;
alter table public.profiles drop constraint if exists profiles_display_name_nonempty;
alter table public.profiles add constraint profiles_display_name_nonempty check (length(trim(display_name)) > 0);
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'operator', 'technician', 'pending'));

revoke update on public.profiles from authenticated;
grant update (display_name, phone) on public.profiles to authenticated;

drop policy if exists "Users update their own profile details" on public.profiles;
create policy "Users update their own profile details"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create or replace function public.admin_update_profile_role(p_user_id uuid, p_role text)
returns jsonb language sql security definer set search_path = ''
as $$
  update public.profiles p
  set role = p_role
  where p.id = p_user_id
    and p_role in ('pending', 'technician', 'operator', 'admin')
    and (select public.is_admin())
  returning to_jsonb(p);
$$;
revoke all on function public.admin_update_profile_role(uuid, text) from public;
grant execute on function public.admin_update_profile_role(uuid, text) to authenticated;

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '') is null then
    raise exception 'O nome completo é obrigatório para criar a conta.';
  end if;
  insert into public.profiles (id, email, role, display_name, phone)
  values (
    new.id,
    coalesce(new.email, ''),
    'pending',
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Usuário'),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'phone', '')), '')
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

create or replace function public.can_use_withdrawals()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role in ('admin', 'operator', 'technician')
  );
$$;
revoke all on function public.can_use_withdrawals() from public;
grant execute on function public.can_use_withdrawals() to authenticated;

create table if not exists public.onu_withdrawals (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  name text not null check (length(trim(name)) > 0),
  phone text,
  address text not null check (length(trim(address)) > 0),
  equipment text not null check (length(trim(equipment)) > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists onu_withdrawals_name_idx on public.onu_withdrawals(lower(name));
drop trigger if exists onu_withdrawals_set_updated_at on public.onu_withdrawals;
create trigger onu_withdrawals_set_updated_at
  before update on public.onu_withdrawals
  for each row execute procedure public.set_client_updated_at();

create table if not exists public.onu_withdrawal_visits (
  id uuid primary key default gen_random_uuid(),
  withdrawal_id uuid not null references public.onu_withdrawals(id) on delete cascade,
  technician_id uuid not null references auth.users(id) on delete restrict,
  technician_name text not null,
  result text not null check (result in ('pending', 'visited', 'no_answer')),
  observation text not null default '',
  created_at timestamptz not null default now(),
  constraint visit_observation_required check (result = 'pending' or length(trim(observation)) > 0)
);
create index if not exists onu_withdrawal_visits_recent_idx on public.onu_withdrawal_visits(created_at desc);
create index if not exists onu_withdrawal_visits_record_idx on public.onu_withdrawal_visits(withdrawal_id, created_at desc);

alter table public.onu_withdrawals enable row level security;
alter table public.onu_withdrawal_visits enable row level security;
revoke all on public.onu_withdrawals, public.onu_withdrawal_visits from anon;
grant select, insert, update on public.onu_withdrawals to authenticated;
grant select on public.onu_withdrawal_visits to authenticated;

drop policy if exists "Authorized users view ONU withdrawal records" on public.onu_withdrawals;
create policy "Authorized users view ONU withdrawal records"
  on public.onu_withdrawals for select to authenticated
  using ((select public.can_use_withdrawals()));
drop policy if exists "Authorized users add ONU withdrawal records" on public.onu_withdrawals;
create policy "Authorized users add ONU withdrawal records"
  on public.onu_withdrawals for insert to authenticated
  with check ((select public.can_use_withdrawals()) and created_by = (select auth.uid()));
drop policy if exists "Authorized users update ONU withdrawal records" on public.onu_withdrawals;
create policy "Authorized users update ONU withdrawal records"
  on public.onu_withdrawals for update to authenticated
  using ((select public.can_use_withdrawals()))
  with check ((select public.can_use_withdrawals()));

drop policy if exists "Authorized users view ONU visit activity" on public.onu_withdrawal_visits;
create policy "Authorized users view ONU visit activity"
  on public.onu_withdrawal_visits for select to authenticated
  using ((select public.can_use_withdrawals()));

create or replace function public.record_onu_withdrawal_visit(p_withdrawal_id uuid, p_result text, p_observation text)
returns uuid language sql security definer set search_path = ''
as $$
  with allowed_technicians as (
    select p.id, p.display_name from public.profiles p
    where p.id = (select auth.uid()) and p.role in ('admin', 'operator', 'technician')
  ), inserted as (
    insert into public.onu_withdrawal_visits(withdrawal_id, technician_id, technician_name, result, observation)
    select p_withdrawal_id, a.id, a.display_name, p_result, trim(coalesce(p_observation, ''))
    from allowed_technicians a
    where p_result in ('pending', 'visited', 'no_answer')
      and (p_result = 'pending' or length(trim(coalesce(p_observation, ''))) > 0)
      and exists (select 1 from public.onu_withdrawals w where w.id = p_withdrawal_id)
    returning id
  )
  select id from inserted;
$$;
revoke all on function public.record_onu_withdrawal_visit(uuid, text, text) from public;
grant execute on function public.record_onu_withdrawal_visit(uuid, text, text) to authenticated;
