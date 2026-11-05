-- Shared client records and user roles for Controle FibraCenter.
-- Run this migration using the Supabase SQL Editor or `supabase db push`.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'pending' check (role in ('admin', 'operator', 'pending')),
  created_at timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  name text not null check (length(trim(name)) > 0),
  contract text not null check (length(trim(contract)) > 0),
  street text not null check (length(trim(street)) > 0),
  neighborhood text not null check (length(trim(neighborhood)) > 0),
  city text not null check (length(trim(city)) > 0),
  equipment text,
  onu text,
  router text,
  status text not null default 'NEGATIVADO' check (status in ('NEGATIVADO', 'REGULARIZADO')),
  negative_date date not null default current_date,
  resolution text,
  regularized_date date,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clients_status_details_check check (
    (status = 'NEGATIVADO' and regularized_date is null and resolution is null)
    or
    (status = 'REGULARIZADO' and regularized_date is not null and length(trim(coalesce(resolution, ''))) > 0)
  )
);

create index if not exists clients_name_idx on public.clients (lower(name));
create index if not exists clients_status_idx on public.clients (status);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create or replace function public.can_access_clients()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles as p
    where p.id = (select auth.uid())
      and p.role in ('admin', 'operator')
  );
$$;
revoke all on function public.can_access_clients() from public;
grant execute on function public.can_access_clients() to authenticated;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, coalesce(new.email, ''), 'pending')
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_auth_user();

create or replace function public.set_client_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at
  before update on public.clients
  for each row execute procedure public.set_client_updated_at();

alter table public.profiles enable row level security;
alter table public.clients enable row level security;

revoke all on table public.profiles, public.clients from anon;
grant select, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.clients to authenticated;

drop policy if exists "Users read own profile or admins read all" on public.profiles;
create policy "Users read own profile or admins read all"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id or (select public.is_admin()));

drop policy if exists "Admins update profiles" on public.profiles;
create policy "Admins update profiles"
  on public.profiles for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "Authenticated users read shared clients" on public.clients;
create policy "Authenticated users read shared clients"
  on public.clients for select to authenticated
  using ((select public.can_access_clients()));

drop policy if exists "Authenticated users add shared clients" on public.clients;
create policy "Authenticated users add shared clients"
  on public.clients for insert to authenticated
  with check ((select public.can_access_clients()) and created_by = (select auth.uid()));

drop policy if exists "Authenticated users update shared clients" on public.clients;
create policy "Authenticated users update shared clients"
  on public.clients for update to authenticated
  using ((select public.can_access_clients()))
  with check ((select public.can_access_clients()));

drop policy if exists "Admins delete shared clients" on public.clients;
create policy "Admins delete shared clients"
  on public.clients for delete to authenticated
  using ((select public.is_admin()));

-- New Auth users start pending. Promote trusted accounts from the SQL Editor:
-- update public.profiles set role = 'admin' where lower(email) = lower('admin@example.com');




