alter policy "Authorized users add ONU withdrawal records" on public.onu_withdrawals
  with check (
    created_by = (select auth.uid())
    and exists (select 1 from public.profiles p where p.id = (select auth.uid())
      and (p.role in ('admin','operator')
        or (p.role = 'attendant' and legacy_id ~ '^retirada-[0-9a-f-]{36}$')))
  );

alter policy "Authorized users update ONU withdrawal records" on public.onu_withdrawals
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin','operator')))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin','operator')));
