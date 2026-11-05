-- Extend shared client records for the source CSV and monthly reporting.
alter table public.clients
  add column if not exists occurrence_id text,
  add column if not exists negativado_status text not null default 'SIM',
  add column if not exists negativation_date date,
  add column if not exists regularization_date date,
  add column if not exists source_data jsonb;

update public.clients
set negativado_status = case when status = 'REGULARIZADO' then 'REGULARIZADO' else 'SIM' end,
    negativation_date = coalesce(negativation_date, negative_date),
    regularization_date = coalesce(regularization_date, regularized_date)
where negativado_status is null or negativado_status = 'SIM';

alter table public.clients drop constraint if exists clients_negativado_status_check;
alter table public.clients add constraint clients_negativado_status_check
  check (negativado_status in ('REGULARIZADO', 'SIM', 'NÃO', 'EM CONTATO'));
create index if not exists clients_negativado_status_idx on public.clients (negativado_status);
create index if not exists clients_negativation_date_idx on public.clients (negativation_date);
create index if not exists clients_regularization_date_idx on public.clients (regularization_date);
create unique index if not exists clients_occurrence_id_uidx on public.clients (occurrence_id) where occurrence_id is not null;
