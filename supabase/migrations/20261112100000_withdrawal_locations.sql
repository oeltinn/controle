alter table public.onu_withdrawals
  add column latitude double precision,
  add column longitude double precision,
  add constraint withdrawal_coordinates_pair check ((latitude is null) = (longitude is null)),
  add constraint withdrawal_latitude_range check (latitude is null or latitude between -90 and 90),
  add constraint withdrawal_longitude_range check (longitude is null or longitude between -180 and 180);

create table public.sgp_contract_locations (
  contract_id text primary key check (contract_id ~ '^[0-9]+$'),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  imported_at timestamptz not null default now()
);

alter table public.sgp_contract_locations enable row level security;
revoke all on public.sgp_contract_locations from anon, authenticated;
grant select, insert, update on public.sgp_contract_locations to authenticated;

create policy "Administrators read contract locations" on public.sgp_contract_locations
  for select to authenticated using ((select public.is_admin()));
create policy "Administrators insert contract locations" on public.sgp_contract_locations
  for insert to authenticated with check ((select public.is_admin()));
create policy "Administrators update contract locations" on public.sgp_contract_locations
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create function public.resolve_withdrawal_location() returns trigger
language plpgsql security definer set search_path = '' as $$
declare found_lat double precision; found_lon double precision;
begin
  if new.contract_id is not null and new.latitude is null and new.longitude is null then
    select c.latitude, c.longitude into found_lat, found_lon
      from public.sgp_contract_locations c where c.contract_id = new.contract_id;
    new.latitude := found_lat;
    new.longitude := found_lon;
  end if;
  return new;
end;
$$;
revoke all on function public.resolve_withdrawal_location() from public, anon, authenticated;
create trigger resolve_withdrawal_location_before_write before insert or update of contract_id, latitude, longitude
  on public.onu_withdrawals for each row execute function public.resolve_withdrawal_location();

create function public.propagate_contract_location() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.onu_withdrawals
    set latitude = new.latitude, longitude = new.longitude
    where contract_id = new.contract_id
      and (latitude is distinct from new.latitude or longitude is distinct from new.longitude);
  return new;
end;
$$;
revoke all on function public.propagate_contract_location() from public, anon, authenticated;
create trigger propagate_contract_location_after_write after insert or update of latitude, longitude
  on public.sgp_contract_locations for each row execute function public.propagate_contract_location();
