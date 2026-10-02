-- ═══════════════════════════════════════════════════════════════════════════
-- 0531 · BUZÓN DE FACTURAS (Agente 9): ENTREGA AL CONTADOR.
--
-- Auditoría §3: «no hay entrega automática a contabilidad: la factura entra a una
-- bandeja de aprobación humana y de ahí un export CSV con descarga manual».
-- La aprobación humana SE CONSERVA (LFPDPPP 26-II: el agente prepara, la persona
-- decide); lo que se agrega es el ENVÍO: lo aprobado sale al contador por correo
-- —lote CSV (genérico, SAP B1 o CONTPAQi) más un ZIP con XML y PDF— configurable
-- por flota, con bitácora, reintentos con backoff y confirmación (webhook de
-- Resend: entregada / rebotada).
--
--   · `buzon_entrega_config`: por flota (apagada por omisión).
--   · `buzon_entrega`: un LOTE. Las facturas se RESERVAN con un UPDATE condicional
--     (`factura_proveedor.entrega_id`): de dos corridas solapadas gana una y una
--     factura nunca viaja en dos lotes. El envío usa claim con lease.
--   · `buzon_entrega_evento`: bitácora de cada paso del lote.
--
-- Agrega el id 'buzon-entrega' al CHECK de cron_latido y lo reescribe ENTERO a
-- partir de la lista vigente tras la 0401 (que ya trae conductor-hitos y vigia).
-- RLS deny-all con service_role.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.buzon_entrega_config (
  tenant_id     uuid primary key references public.tenant(id) on delete cascade,
  activo        boolean not null default false,
  destinatarios text[] not null default '{}',
  formato       text not null default 'generico',
  incluir_zip   boolean not null default true,
  -- Automática: el cron arma y manda un lote al día a `hora_envio` (hora de México).
  automatica    boolean not null default false,
  hora_envio    smallint not null default 8,
  -- No se manda un lote con menos facturas que esto (evita un correo por factura).
  min_facturas  smallint not null default 1,
  updated_at    timestamptz not null default now(),
  constraint buzon_entrega_config_formato_dominio check (formato in ('generico', 'sap_b1', 'contpaqi')),
  constraint buzon_entrega_config_destinatarios_max check (cardinality(destinatarios) <= 5),
  constraint buzon_entrega_config_hora_rango check (hora_envio between 0 and 23),
  constraint buzon_entrega_config_min_rango check (min_facturas between 1 and 100),
  -- Una entrega ACTIVA sin a quién mandarla no es una configuración.
  constraint buzon_entrega_config_activo_con_destino check (not activo or cardinality(destinatarios) >= 1)
);

comment on table public.buzon_entrega_config is
  'Entrega de facturas aprobadas al contador (0531), por flota. Nace apagada. Los destinatarios los captura la flota: no hay un contador real preconfigurado.';

create table if not exists public.buzon_entrega (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  creado_en     timestamptz not null default now(),
  creado_por    text,
  disparo       text not null,
  estado        text not null default 'pendiente',
  formato       text not null,
  incluye_zip   boolean not null,
  -- Los destinatarios al momento de crear el lote (un cambio de config posterior no reescribe la historia).
  destinatarios text[] not null,
  n_facturas    integer not null,
  total         numeric(14,2) not null,
  intentos      smallint not null default 0,
  proximo_intento_en timestamptz not null default now(),
  lease_hasta   timestamptz,
  resend_id     text,
  enviada_en    timestamptz,
  entregada_en  timestamptz,
  error         text,

  constraint buzon_entrega_id_tenant_key unique (id, tenant_id),
  constraint buzon_entrega_disparo_dominio check (disparo in ('manual', 'automatica')),
  constraint buzon_entrega_estado_dominio
    check (estado in ('pendiente', 'enviando', 'enviada', 'entregada', 'rebotada', 'fallida', 'cancelada')),
  constraint buzon_entrega_formato_dominio check (formato in ('generico', 'sap_b1', 'contpaqi')),
  constraint buzon_entrega_destinatarios_rango check (cardinality(destinatarios) between 1 and 5),
  constraint buzon_entrega_n_sano check (n_facturas >= 1 and n_facturas <= 500),
  constraint buzon_entrega_intentos_sano check (intentos >= 0 and intentos <= 20),
  constraint buzon_entrega_error_acotado check (error is null or char_length(error) <= 300),
  -- Lo enviado/entregado/rebotado trae el id con el que se confirma.
  constraint buzon_entrega_resend_coherente
    check (estado not in ('enviada', 'entregada', 'rebotada') or resend_id is not null)
);

comment on table public.buzon_entrega is
  'Un LOTE de facturas aprobadas enviado al contador (0531). pendiente → enviando (claim con lease) → enviada (Resend aceptó) → entregada | rebotada (webhook de Resend); fallida tras 5 intentos (una persona reintenta o cancela); cancelada libera las facturas.';

create index if not exists buzon_entrega_pendientes_idx
  on public.buzon_entrega (proximo_intento_en, id) where estado in ('pendiente', 'enviando');
create index if not exists buzon_entrega_por_flota_idx
  on public.buzon_entrega (tenant_id, creado_en desc, id);
create unique index if not exists buzon_entrega_resend_idx
  on public.buzon_entrega (resend_id) where resend_id is not null;

create table if not exists public.buzon_entrega_evento (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  entrega_id uuid not null,
  en         timestamptz not null default now(),
  evento     text not null,
  detalle    text,
  constraint buzon_entrega_evento_entrega_fkey
    foreign key (entrega_id, tenant_id) references public.buzon_entrega (id, tenant_id) on delete cascade,
  constraint buzon_entrega_evento_dominio check (evento in (
    'creada', 'intento', 'enviada', 'fallo', 'reintento_programado', 'retraso', 'entregada', 'rebotada',
    'reintento_manual', 'cancelada', 'liberada'
  )),
  constraint buzon_entrega_evento_detalle_acotado check (detalle is null or char_length(detalle) <= 300)
);

create index if not exists buzon_entrega_evento_idx on public.buzon_entrega_evento (tenant_id, entrega_id, en desc, id);

-- ── El vínculo factura → lote ───────────────────────────────────────────────
alter table public.factura_proveedor
  add column if not exists entrega_id uuid,
  add column if not exists entregada_en timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'factura_proveedor_entrega_fkey') then
    alter table public.factura_proveedor
      add constraint factura_proveedor_entrega_fkey
      foreign key (entrega_id, tenant_id) references public.buzon_entrega (id, tenant_id);
  end if;
  -- Solo lo APROBADO se entrega (misma regla que exportada_en).
  if not exists (select 1 from pg_constraint where conname = 'factura_proveedor_entrega_solo_aprobada') then
    alter table public.factura_proveedor
      add constraint factura_proveedor_entrega_solo_aprobada check (entrega_id is null or estado = 'aprobada');
  end if;
end $$;

create index if not exists factura_proveedor_por_entregar_idx
  on public.factura_proveedor (tenant_id, created_at, id) where estado = 'aprobada' and entrega_id is null;

comment on column public.factura_proveedor.entrega_id is
  'Lote de entrega al contador que reservó esta factura (0531). NULL = aún sin reservar. El UPDATE condicional que la reserva es el claim: una factura nunca viaja en dos lotes.';
comment on column public.factura_proveedor.entregada_en is
  'Cuándo Resend aceptó el lote que la lleva. NULL = aún no se ha enviado.';

alter table public.buzon_entrega_config enable row level security;
alter table public.buzon_entrega enable row level security;
alter table public.buzon_entrega_evento enable row level security;
revoke all on table public.buzon_entrega_config, public.buzon_entrega, public.buzon_entrega_evento from public, anon, authenticated;
grant select, insert, update, delete on table public.buzon_entrega_config, public.buzon_entrega, public.buzon_entrega_evento to service_role;

-- ── cron_latido: la lista COMPLETA (0401) + buzon-entrega ──────────────────
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'cron_latido_id_dominio' and conrelid = 'public.cron_latido'::regclass) then
    alter table public.cron_latido drop constraint cron_latido_id_dominio;
  end if;
  alter table public.cron_latido
    add constraint cron_latido_id_dominio
    check (id in (
      'wa-pendientes', 'wa-outbox', 'escalar', 'facturar', 'purgar', 'runner', 'gps', 'asistencia',
      'descarga-sat', 'jornada', 'portales-vivos', 'liquidaciones-externas', 'peajes', 'conductor-hitos',
      'vigia', 'buzon-entrega'
    ));
end $$;

comment on constraint cron_latido_id_dominio on public.cron_latido is
  'El catálogo COMPLETO de ids de cron, espejo de CRONS en lib/admin/salud.ts. Se enumera entero al tocarlo. La 0531 añade buzon-entrega sobre la lista de la 0401 (que añadió vigia sobre la de la 0380).';
