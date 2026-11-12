alter table public.sgp_contract_locations
  add column source_changed_at timestamptz,
  alter column latitude drop not null,
  alter column longitude drop not null,
  add constraint sgp_location_pair check ((latitude is null) = (longitude is null));

create function public.keep_latest_sgp_location()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.source_changed_at is not null and old.source_changed_at > new.source_changed_at then
    return null;
  end if;
  new.source_changed_at := coalesce(new.source_changed_at, old.source_changed_at);
  return new;
end;
$$;

create trigger keep_latest_sgp_location before update on public.sgp_contract_locations
for each row execute function public.keep_latest_sgp_location();
