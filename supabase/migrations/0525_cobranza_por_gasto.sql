-- ═══════════════════════════════════════════════════════════════════════════
-- 0525 · COBRANZA DE COMPROBANTES POR GASTO INDIVIDUAL (Agente 7, loop punta a
--       punta, ola 3).
--
-- La 0089 cobra por VIAJE: «llevas N días con el viaje F-1042 sin mandarme
-- comprobantes». La auditoría (6-7-9-10-12-13, §2) lo marcó: la promesa de la
-- propuesta es «falta comprobar un gasto». Esta migración pone el esquema de la
-- cobranza por GASTO:
--
--   1. CONFIG por flota (en `agente_cobranza_config`): encendido (nace APAGADO:
--      es opt-in, la conducta por viaje no cambia para nadie sin que lo pidan),
--      la cadencia escalonada por gasto, el tope de mensajes por chofer y día,
--      los conceptos que exigen CFDI y el umbral de lectura de la foto.
--
--   2. `cobranza_gasto_contacto`: UNA fila por (gasto, tier). El INSERT ES EL
--      CLAIM anti-duplicado (unique): de dos corridas solapadas gana una. Los
--      gastos de un mismo chofer se FUSIONAN en un solo mensaje y comparten
--      `lote_id`. Guarda el motivo (qué comprobante falta de ese gasto) y, para
--      medir efectividad, cuándo y cómo se resolvió (`resuelto_en/por`).
--
-- NO reescribe ningún CHECK existente (solo agrega los suyos): no pisa valores de
-- otras ramas (cron_latido, modelo_rol). RLS deny-all con service_role, igual que
-- la 0089. Retención: la corrida de cobranza borra por flota lo de más de 180 días
-- (mismo plazo que `cobranza_contacto`, 0332).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Configuración por flota ─────────────────────────────────────────────
alter table public.agente_cobranza_config
  add column if not exists por_gasto boolean not null default false,
  add column if not exists tiers_gasto jsonb not null default '[1, 3, 7]'::jsonb,
  add column if not exists max_mensajes_dia smallint not null default 1,
  add column if not exists conceptos_cfdi jsonb not null default '["diesel", "caseta"]'::jsonb,
  add column if not exists umbral_foto numeric(3,2) not null default 0.50;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agente_cobranza_config_max_mensajes_dia_rango') then
    alter table public.agente_cobranza_config
      add constraint agente_cobranza_config_max_mensajes_dia_rango check (max_mensajes_dia between 1 and 3);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'agente_cobranza_config_umbral_foto_rango') then
    alter table public.agente_cobranza_config
      add constraint agente_cobranza_config_umbral_foto_rango check (umbral_foto between 0.10 and 0.95);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'agente_cobranza_config_tiers_gasto_forma') then
    alter table public.agente_cobranza_config
      add constraint agente_cobranza_config_tiers_gasto_forma
      check (jsonb_typeof(tiers_gasto) = 'array' and jsonb_array_length(tiers_gasto) between 1 and 5);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'agente_cobranza_config_conceptos_cfdi_forma') then
    alter table public.agente_cobranza_config
      add constraint agente_cobranza_config_conceptos_cfdi_forma
      check (jsonb_typeof(conceptos_cfdi) = 'array' and jsonb_array_length(conceptos_cfdi) <= 8);
  end if;
end $$;

comment on column public.agente_cobranza_config.por_gasto is
  'Cobranza por GASTO individual (0525). Nace apagada: la cobranza por viaje (0089) sigue igual hasta que la flota la enciende. Encendida, los viajes con gastos sin comprobante se cobran por gasto y la cobranza por viaje solo atiende a los viajes sin ningún gasto.';
comment on column public.agente_cobranza_config.tiers_gasto is
  'Cadencia escalonada por gasto: días desde que el gasto se capturó a los que se insiste (1 a 5 valores ascendentes). A cada tier se insiste UNA vez por gasto.';
comment on column public.agente_cobranza_config.max_mensajes_dia is
  'Tope de MENSAJES por chofer y día (1 a 3). Los gastos pendientes de un mismo chofer se fusionan en un solo mensaje; si el tope se alcanzó, el resto espera al día siguiente sin consumir tier.';
comment on column public.agente_cobranza_config.conceptos_cfdi is
  'Conceptos de gasto cuyo comprobante DEBE ser factura (CFDI). Un gasto de otro concepto con ticket legible no se cobra por falta de CFDI.';
comment on column public.agente_cobranza_config.umbral_foto is
  'Confianza OCR (0.10–0.95) por debajo de la cual la foto del ticket se considera ilegible y se pide otra.';

-- ── 2. Un contacto por (gasto, tier) ───────────────────────────────────────
create table if not exists public.cobranza_gasto_contacto (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  gasto_id    uuid not null,
  -- El chofer al que se le cobró (para el tope diario y la fusión por chofer).
  operador_id uuid references public.operador(id) on delete set null,
  -- El tier (días desde que se capturó el gasto) que disparó este contacto.
  tier        smallint not null,
  -- QUÉ comprobante falta de ESE gasto.
  motivo      text not null,
  -- Los gastos fusionados en un solo mensaje comparten lote.
  lote_id     uuid not null,
  enviado     boolean not null default false,
  -- Por dónde salió: texto (ventana de 24 h abierta) o la plantilla de respaldo.
  via         text,
  -- Por qué no salió, cuando no salió (sin teléfono, Meta rechazó…).
  detalle     text,
  created_at  timestamptz not null default now(),
  -- Efectividad: cuándo dejó de faltar el comprobante y por qué.
  resuelto_en  timestamptz,
  resuelto_por text,

  -- EL CANDADO: un contacto por tier por gasto. Reclamar = insertar; el
  -- perdedor choca aquí y no manda nada.
  constraint cobranza_gasto_contacto_gasto_tier_key unique (gasto_id, tier),
  -- FK COMPUESTA de la casa (0028/0145): el contacto de una flota no cuelga de un
  -- gasto de otra. Si el gasto se borra, su historial de cobranza se va con él.
  constraint cobranza_gasto_contacto_gasto_tenant_fkey
    foreign key (gasto_id, tenant_id) references public.gasto (id, tenant_id) on delete cascade,
  constraint cobranza_gasto_contacto_tier_sano check (tier > 0 and tier <= 60),
  constraint cobranza_gasto_contacto_motivo_dominio
    check (motivo in ('sin_foto', 'foto_ilegible', 'sin_cfdi', 'cfdi_cancelado')),
  constraint cobranza_gasto_contacto_via_dominio check (via is null or via in ('texto', 'plantilla')),
  constraint cobranza_gasto_contacto_resuelto_por_dominio
    check (resuelto_por is null or resuelto_por in ('chofer', 'cierre')),
  -- Resuelto o no: las dos columnas van juntas.
  constraint cobranza_gasto_contacto_resuelto_coherente
    check ((resuelto_en is null) = (resuelto_por is null)),
  -- Solo un contacto que SALIÓ puede resolverse (medir efectividad de lo no enviado sería mentir).
  constraint cobranza_gasto_contacto_resuelto_solo_enviado
    check (resuelto_en is null or enviado),
  constraint cobranza_gasto_contacto_detalle_acotado check (detalle is null or char_length(detalle) <= 300)
);

comment on table public.cobranza_gasto_contacto is
  'Bitácora de la cobranza por GASTO (0525): un intento por (gasto, tier) con el motivo (qué comprobante falta). El insert ES el claim anti-doble-envío; los gastos de un chofer comparten lote_id (un solo mensaje). resuelto_en/por miden la efectividad del aviso.';

create index if not exists cobranza_gasto_contacto_tenant_idx
  on public.cobranza_gasto_contacto (tenant_id, created_at desc, id);
create index if not exists cobranza_gasto_contacto_lote_idx
  on public.cobranza_gasto_contacto (tenant_id, lote_id);
-- El tope diario cuenta mensajes (lotes) enviados hoy por chofer.
create index if not exists cobranza_gasto_contacto_operador_idx
  on public.cobranza_gasto_contacto (tenant_id, operador_id, created_at desc)
  where enviado;
-- El barrido de resolución recorre solo lo enviado y aún sin resolver.
create index if not exists cobranza_gasto_contacto_abiertos_idx
  on public.cobranza_gasto_contacto (tenant_id, created_at)
  where enviado and resuelto_en is null;

alter table public.cobranza_gasto_contacto enable row level security;
revoke all on table public.cobranza_gasto_contacto from public, anon, authenticated;
grant select, insert, update, delete on table public.cobranza_gasto_contacto to service_role;
