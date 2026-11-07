alter table public.clients add column phone text
  check (phone is null or phone ~ '^\+[1-9][0-9]{1,14}$');

create policy "Attendants insert manual client records only"
  on public.clients as restrictive for insert to authenticated
  with check (
    not exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'attendant')
    or legacy_id ~ '^web-[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  );
