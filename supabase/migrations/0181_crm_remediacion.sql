-- 0181 · CRM REMEDIACIÓN
-- Durable public lead keys and a unified commercial event ledger.
alter table public.prospecto add column if not exists lead_clave text;
comment on column public.prospecto.lead_clave is
  'Clave natural normalizada para entradas públicas del CRM (correo o empresa). NULL en filas históricas/censo. Índice único parcial para dedupe durable entre instancias.';
create unique index if not exists prospecto_lead_clave_unica on public.prospecto (lead_clave) where lead_clave is not null;
create index if not exists prospecto_vivos_fuente_fecha on public.prospecto (fuente, created_at desc) where duplicado_de is null;

alter table public.prospecto drop constraint if exists prospecto_estado_dominio;
alter table public.prospecto add constraint prospecto_estado_dominio check (
  estado in ('nuevo', 'contactado', 'appointment', 'rescheduled', 'cancelled', 'no-show', 'demo', 'proposal', 'pilot', 'won', 'lost', 'negociacion', 'cerrado', 'perdido')
);
alter table public.prospecto drop constraint if exists prospecto_cerrado_coherente;
alter table public.prospecto add constraint prospecto_cerrado_coherente check (((estado in ('cerrado', 'won')) = (cerrado_en is not null)));
alter table public.prospecto drop constraint if exists prospecto_tenant_solo_cerrado;
alter table public.prospecto add constraint prospecto_tenant_solo_cerrado check (tenant_id is null or estado in ('cerrado', 'won'));

create table if not exists public.comercial_evento (
  id uuid primary key default gen_random_uuid(),
  clave_idempotencia text not null,
  fuente text not null,
  tipo text not null,
  prospecto_id uuid references public.prospecto(id) on delete set null,
  externo_id text,
  payload jsonb not null default '{}'::jsonb,
  ocurrido_en timestamptz not null default now(),
  procesado_en timestamptz,
  error text,
  creado_en timestamptz not null default now(),
  constraint comercial_evento_clave_no_vacia check (length(btrim(clave_idempotencia)) > 0),
  constraint comercial_evento_fuente_no_vacia check (length(btrim(fuente)) > 0),
  constraint comercial_evento_tipo_no_vacio check (length(btrim(tipo)) > 0)
);
create unique index if not exists comercial_evento_clave_unica on public.comercial_evento (clave_idempotencia);
create index if not exists comercial_evento_prospecto_fecha on public.comercial_evento (prospecto_id, ocurrido_en desc);
create index if not exists comercial_evento_fuente_fecha on public.comercial_evento (fuente, ocurrido_en desc);
comment on table public.comercial_evento is
  'Ledger append-only del CRM: lead, cita, reprogramación, cancelación, demo, propuesta, piloto y cierre. La clave única vuelve idempotentes webhooks y reconciliaciones.';
alter table public.comercial_evento enable row level security;
