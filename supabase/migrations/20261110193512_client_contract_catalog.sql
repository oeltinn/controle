create table public.sgp_client_catalog (
 contract_id text primary key check (contract_id ~ '^[0-9]+$'),
 name text not null, phone text, street text not null,
 neighborhood text not null, city text not null, equipment text,
 imported_at timestamptz not null
);
create table public.sgp_client_catalog_state (
 id boolean primary key default true check (id),
 imported_at timestamptz not null,
 filename text not null,
 row_count integer not null check (row_count > 0)
);
alter table public.sgp_client_catalog enable row level security;
alter table public.sgp_client_catalog_state enable row level security;
revoke all on public.sgp_client_catalog, public.sgp_client_catalog_state from anon, authenticated;
grant select on public.sgp_client_catalog, public.sgp_client_catalog_state to authenticated;
create policy "Authorized staff read client catalog" on public.sgp_client_catalog for select to authenticated
 using (exists(select 1 from public.profiles where id=(select auth.uid()) and role in ('admin','operator','attendant','technician')));
create policy "Authorized staff read client catalog state" on public.sgp_client_catalog_state for select to authenticated
 using (exists(select 1 from public.profiles where id=(select auth.uid()) and role in ('admin','operator','attendant','technician')));
create function public.replace_sgp_client_catalog(p_filename text,p_rows jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer; v_now timestamptz:=now();
begin
 if not public.is_admin() then raise exception 'Somente administradores podem importar o catálogo'; end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 or jsonb_array_length(p_rows)>20000 then
   raise exception 'O catálogo precisa conter de 1 a 20000 contratos'; end if;
 create temp table if not exists pg_temp.sgp_client_catalog_stage
 (contract_id text primary key,name text,phone text,street text,neighborhood text,city text,equipment text) on commit drop;
 truncate pg_temp.sgp_client_catalog_stage;
 insert into pg_temp.sgp_client_catalog_stage
 select btrim(contract_id),btrim(name),nullif(btrim(phone),''),btrim(street),btrim(neighborhood),btrim(city),nullif(btrim(equipment),'')
 from jsonb_to_recordset(p_rows) as x(contract_id text,name text,phone text,street text,neighborhood text,city text,equipment text);
 if exists(select 1 from pg_temp.sgp_client_catalog_stage where contract_id !~ '^[0-9]+$' or
   name is null or name='' or street is null or street='' or neighborhood is null or neighborhood='' or city is null or city='')
 then raise exception 'Há contratos com dados obrigatórios inválidos'; end if;
 select count(*) into v_count from pg_temp.sgp_client_catalog_stage;
 delete from public.sgp_client_catalog;
 insert into public.sgp_client_catalog(contract_id,name,phone,street,neighborhood,city,equipment,imported_at)
 select contract_id,name,phone,street,neighborhood,city,equipment,v_now from pg_temp.sgp_client_catalog_stage;
 insert into public.sgp_client_catalog_state(id,imported_at,filename,row_count)
 values(true,v_now,left(p_filename,255),v_count)
 on conflict(id) do update set imported_at=excluded.imported_at,filename=excluded.filename,row_count=excluded.row_count;
 return v_count;
end $$;
revoke all on function public.replace_sgp_client_catalog(text,jsonb) from public,anon;
grant execute on function public.replace_sgp_client_catalog(text,jsonb) to authenticated;
create function public.check_client_catalog_on_manual_insert()
returns trigger language plpgsql set search_path='' as $$
declare v_imported timestamptz;
begin
 if new.legacy_id like 'csv-%' and exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','operator')) then return new; end if;
 select imported_at into v_imported from public.sgp_client_catalog_state where id=true;
 if v_imported is not null and v_imported <= now()-interval '21 days' then
   raise exception 'Catálogo de clientes vencido. Peça ao administrador uma nova planilha antes de adicionar clientes manualmente.';
 end if;
 return new;
end $$;
create trigger check_manual_client before insert on public.clients
 for each row execute function public.check_client_catalog_on_manual_insert();
create trigger check_manual_withdrawal before insert on public.onu_withdrawals
 for each row execute function public.check_client_catalog_on_manual_insert();
