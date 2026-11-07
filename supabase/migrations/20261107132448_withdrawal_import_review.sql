create table public.onu_withdrawal_imports (
  id uuid primary key default gen_random_uuid(),
  filename text not null check (length(btrim(filename)) between 1 and 255),
  created_at timestamptz not null default now(),
  imported_count integer not null default 0 check (imported_count >= 0)
);

alter table public.onu_withdrawals
  add column import_id uuid references public.onu_withdrawal_imports(id) on delete cascade,
  add column city text,
  add column district text,
  add column include_without_equipment boolean not null default false;
create index onu_withdrawals_import_id_idx on public.onu_withdrawals(import_id);

-- The original importer stored the location in the final address segments.
with legacy_import as (
  insert into public.onu_withdrawal_imports(filename, created_at, imported_count)
  select 'CSV anterior à identificação de arquivos', min(created_at), count(*)
  from public.onu_withdrawals where legacy_id like 'csv-retirada-%'
  having count(*) > 0
  returning id
)
update public.onu_withdrawals w set
  import_id = legacy_import.id,
  city = case when address ~ ' · [A-Z]{2} · [0-9.-]+$' then reverse(split_part(reverse(address), ' · ', 3)) end,
  district = case when address ~ ' · [A-Z]{2} · [0-9.-]+$' then reverse(split_part(reverse(address), ' · ', 4)) end
from legacy_import where w.legacy_id like 'csv-retirada-%';

alter table public.onu_withdrawal_imports enable row level security;
revoke all on public.onu_withdrawal_imports from public, anon, authenticated;
grant select, insert, update, delete on public.onu_withdrawal_imports to authenticated;
create policy "Managers manage withdrawal imports" on public.onu_withdrawal_imports
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin','operator')))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin','operator')));

alter policy "Authorized users view ONU withdrawal records" on public.onu_withdrawals
  using ((select public.can_use_withdrawals()) and (
    equipment <> 'A identificar' or include_without_equipment or
    exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin','operator'))
  ));
create policy "New withdrawals require review for unidentified equipment" on public.onu_withdrawals
  as restrictive for insert to authenticated with check (not include_without_equipment);
alter policy "Authorized users view ONU visit activity" on public.onu_withdrawal_visits
  using (exists (select 1 from public.onu_withdrawals w where w.id = withdrawal_id));
grant delete on public.onu_withdrawals to authenticated;
create policy "Managers delete withdrawals" on public.onu_withdrawals
  for delete to authenticated using (exists (
    select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin','operator')
  ));

create function public.import_onu_withdrawal_batch(p_filename text, p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  batch_id uuid;
  added integer;
begin
  insert into public.onu_withdrawal_imports(filename)
    values (p_filename) returning id into batch_id;
  insert into public.onu_withdrawals(legacy_id,contract_id,name,address,phone,equipment,city,district,import_id,created_by)
  select 'csv-retirada-sgp-' || entry.contract_id,entry.contract_id,entry.name,entry.address,entry.phone,
    'A identificar',entry.city,entry.district,batch_id,(select auth.uid())
  from jsonb_to_recordset(p_rows) as entry(contract_id text,name text,address text,phone text,city text,district text)
  where entry.contract_id ~ '^[0-9]+$'
  on conflict (contract_id) do nothing;
  get diagnostics added = row_count;
  if added = 0 then
    delete from public.onu_withdrawal_imports where id = batch_id;
  else
    update public.onu_withdrawal_imports set imported_count = added where id = batch_id;
  end if;
  return jsonb_build_object('imported',added,'duplicates',jsonb_array_length(p_rows)-added);
end;
$$;
revoke all on function public.import_onu_withdrawal_batch(text,jsonb) from public, anon, authenticated;
grant execute on function public.import_onu_withdrawal_batch(text,jsonb) to authenticated;

alter table public.onu_withdrawal_visits drop constraint onu_withdrawal_visits_result_check;
alter table public.onu_withdrawal_visits add constraint onu_withdrawal_visits_result_check
  check (result in ('pending','visited','no_answer','collected','equipment_not_found'));

create or replace function public.record_onu_withdrawal_visit(p_withdrawal_id uuid,p_result text,p_observation text)
returns uuid language sql security definer set search_path = ''
as $$
  insert into public.onu_withdrawal_visits(withdrawal_id,technician_id,technician_name,result,observation)
  select w.id,p.id,p.display_name,p_result,btrim(coalesce(p_observation,''))
  from public.profiles p cross join public.onu_withdrawals w
  where p.id = (select auth.uid()) and p.role in ('admin','operator','technician')
    and w.id = p_withdrawal_id and (w.equipment <> 'A identificar' or w.include_without_equipment)
    and p_result in ('collected','equipment_not_found') and length(btrim(coalesce(p_observation,''))) between 1 and 1000
  returning id;
$$;
revoke all on function public.record_onu_withdrawal_visit(uuid,text,text) from public, anon, authenticated;
grant execute on function public.record_onu_withdrawal_visit(uuid,text,text) to authenticated;
