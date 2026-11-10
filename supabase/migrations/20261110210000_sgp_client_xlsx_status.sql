alter table public.sgp_client_catalog add column status text;

create or replace function public.replace_sgp_client_catalog(p_filename text,p_rows jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer; v_now timestamptz:=now(); v_total integer;
begin
 if not public.is_admin() then raise exception 'Somente administradores podem importar o catálogo'; end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 or jsonb_array_length(p_rows)>20000 then
   raise exception 'O catálogo precisa conter de 1 a 20000 contratos'; end if;
 create temp table if not exists pg_temp.sgp_client_catalog_stage
 (contract_id text primary key,name text,phone text,street text,neighborhood text,city text,equipment text,status text) on commit drop;
 truncate pg_temp.sgp_client_catalog_stage;
 insert into pg_temp.sgp_client_catalog_stage
 select btrim(contract_id),btrim(name),nullif(btrim(phone),''),btrim(street),btrim(neighborhood),btrim(city),nullif(btrim(equipment),''),nullif(btrim(status),'')
 from jsonb_to_recordset(p_rows) as x(contract_id text,name text,phone text,street text,neighborhood text,city text,equipment text,status text);
 if exists(select 1 from pg_temp.sgp_client_catalog_stage where contract_id !~ '^[0-9]+$' or
   name is null or name='' or street is null or street='' or neighborhood is null or neighborhood='' or city is null or city='')
 then raise exception 'Há contratos com dados obrigatórios inválidos'; end if;
 select count(*) into v_count from pg_temp.sgp_client_catalog_stage;
 insert into public.sgp_client_catalog(contract_id,name,phone,street,neighborhood,city,equipment,status,imported_at)
 select contract_id,name,phone,street,neighborhood,city,equipment,status,v_now from pg_temp.sgp_client_catalog_stage
 on conflict(contract_id) do update set
 name=excluded.name,phone=coalesce(excluded.phone,public.sgp_client_catalog.phone),street=excluded.street,
 neighborhood=excluded.neighborhood,city=excluded.city,
 equipment=coalesce(excluded.equipment,public.sgp_client_catalog.equipment),
 status=coalesce(excluded.status,public.sgp_client_catalog.status),imported_at=excluded.imported_at;
 select count(*) into v_total from public.sgp_client_catalog;
 insert into public.sgp_client_catalog_state(id,imported_at,filename,row_count)
 values(true,v_now,left(p_filename,255),v_total)
 on conflict(id) do update set imported_at=excluded.imported_at,filename=excluded.filename,row_count=excluded.row_count;
 return v_count;
end $$;
revoke all on function public.replace_sgp_client_catalog(text,jsonb) from public,anon;
grant execute on function public.replace_sgp_client_catalog(text,jsonb) to authenticated;
