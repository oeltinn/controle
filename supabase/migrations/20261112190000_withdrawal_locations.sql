create table public.sgp_contract_locations (
  contract_id text primary key check (contract_id ~ '^[0-9]+$'),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  check (latitude <> 0 or longitude <> 0)
);

alter table public.sgp_contract_locations enable row level security;
revoke all on public.sgp_contract_locations from anon, authenticated;
grant select, insert, update on public.sgp_contract_locations to authenticated;

create policy "Read locations for accessible withdrawals"
on public.sgp_contract_locations for select to authenticated using (
  (select public.is_admin()) or exists (
    select 1 from public.onu_withdrawals w
    where w.contract_id = sgp_contract_locations.contract_id
  )
);

create policy "Administrators import locations"
on public.sgp_contract_locations for insert to authenticated
with check ((select public.is_admin()));

create policy "Administrators update locations"
on public.sgp_contract_locations for update to authenticated
using ((select public.is_admin())) with check ((select public.is_admin()));
