alter table public.clients add column created_by_name text;
alter table public.onu_withdrawals add column created_by_name text;
update public.clients c set created_by_name = nullif(trim(p.display_name),'') from public.profiles p where p.id=c.created_by;
update public.onu_withdrawals c set created_by_name = nullif(trim(p.display_name),'') from public.profiles p where p.id=c.created_by;
create or replace function public.capture_record_creator() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='UPDATE' then
   new.created_by_name := old.created_by_name;
 else
   select nullif(trim(display_name),'') into new.created_by_name from public.profiles where id=new.created_by;
 end if;
 return new;
end;
$$;
revoke all on function public.capture_record_creator() from public,anon,authenticated;
create trigger zz_capture_creator before insert or update on public.clients for each row execute function public.capture_record_creator();
create trigger zz_capture_creator before insert or update on public.onu_withdrawals for each row execute function public.capture_record_creator();