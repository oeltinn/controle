create table public.sgp_contract_equipment (
  contract_id text primary key check (contract_id ~ '^[0-9]+$'),
  equipment text not null check (length(btrim(equipment)) > 0),
  imported_at timestamptz not null default now()
);

alter table public.sgp_contract_equipment enable row level security;
revoke all on public.sgp_contract_equipment from anon, authenticated;
grant select, insert, update on public.sgp_contract_equipment to authenticated;

create policy "Withdrawal staff read SGP equipment"
  on public.sgp_contract_equipment for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin','operator','attendant')));

create policy "Admins import SGP equipment"
  on public.sgp_contract_equipment for insert to authenticated
  with check ((select public.is_admin()));

create policy "Admins update SGP equipment"
  on public.sgp_contract_equipment for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

alter table public.onu_withdrawals add column contract_id text unique
  check (contract_id is null or contract_id ~ '^[0-9]+$');

create function public.resolve_sgp_withdrawal_equipment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.contract_id is not null and new.equipment = 'A identificar' then
    select catalog.equipment into new.equipment
      from public.sgp_contract_equipment catalog where catalog.contract_id = new.contract_id;
    if new.equipment is null then
      new.equipment := 'A identificar';
      if tg_op = 'UPDATE' and old.contract_id = new.contract_id then
        new.equipment := old.equipment;
      end if;
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.phone := coalesce(new.phone, old.phone);
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

revoke all on function public.resolve_sgp_withdrawal_equipment() from public, anon, authenticated;

create trigger resolve_sgp_equipment_before_write
  before insert or update on public.onu_withdrawals
  for each row execute function public.resolve_sgp_withdrawal_equipment();

create function public.fill_pending_sgp_withdrawal_equipment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.onu_withdrawals set equipment = new.equipment
    where contract_id = new.contract_id and equipment = 'A identificar';
  return new;
end;
$$;

revoke all on function public.fill_pending_sgp_withdrawal_equipment() from public, anon, authenticated;

create trigger fill_pending_sgp_equipment_after_catalog_write
  after insert or update of equipment on public.sgp_contract_equipment
  for each row execute function public.fill_pending_sgp_withdrawal_equipment();
