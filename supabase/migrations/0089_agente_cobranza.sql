-- ═══════════════════════════════════════════════════════════════════════════
-- 0089 — El Agente de Cobranza de comprobantes, productizado (13-ago-2026).
--
-- El recordatorio de comprobación (0087) corre solo pero es UNO por viaje y
-- con umbral fijo en código. La prioridad 1 del blueprint de Handle
-- (docs/conocimiento/handle-el-mapa-completo-para-likida.md) es volverlo un
-- agente que el CLIENTE configura: tiers de seguimiento, horario y ventana
-- hábil, instrucciones y firma — y con bitácora de cada contacto.
--
-- Dos tablas:
-- · `agente_cobranza_config` — la configuración por flota. Una fila por
--   tenant; sin fila = defaults del código (el agente nace activo con la
--   conducta del 0087: no se le cambia el comportamiento a nadie en silencio).
-- · `cobranza_contacto` — la bitácora: UN intento por (viaje, tier), y esa
--   unicidad ES el candado anti-doble-envío (mismo patrón que los sellos
--   0058/0087: se RECLAMA insertando antes de mandar; el perdedor del insert
--   no manda nada).
--
-- El sello 0087 (`recordatorio_comprobacion_en`) SE CONSERVA y se sigue
-- escribiendo en el primer contacto: es lo que pinta "lo que hizo solo" y lo
-- que protege a los viajes ya recordados de un re-envío al estrenar tiers.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.agente_cobranza_config (
  tenant_id uuid primary key references public.tenant(id) on delete cascade,
  activo boolean not null default true,
  -- Días sin comprobar a los que se insiste, ascendentes. El primero es el
  -- equivalente del viejo DIAS_PARA_RECORDAR.
  tiers jsonb not null default '[3, 7, 14]'::jsonb,
  hora_inicio smallint not null default 9 check (hora_inicio between 0 and 23),
  hora_fin smallint not null default 18 check (hora_fin between 1 and 24),
  -- Días permitidos, ISO (1 = lunes … 7 = domingo).
  dias_semana jsonb not null default '[1,2,3,4,5,6]'::jsonb,
  -- La "estrategia" del cliente: una línea extra que viaja en el mensaje.
  instrucciones text not null default '' check (char_length(instrucciones) <= 300),
  -- Cómo firma el agente (nombre del despacho o del ejecutivo).
  firma text not null default '' check (char_length(firma) <= 80),
  updated_at timestamptz not null default now(),
  check (hora_fin > hora_inicio)
);

comment on table public.agente_cobranza_config is
  'Configuración por flota del Agente de Cobranza de comprobantes (0089). Sin fila = defaults del código.';

create table public.cobranza_contacto (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant(id),
  viaje_id uuid not null references public.viaje(id) on delete cascade,
  -- El tier (en días) que disparó este contacto.
  tier smallint not null check (tier > 0),
  enviado boolean not null default false,
  -- Por qué no salió, cuando no salió (sin teléfono, Meta rechazó…).
  detalle text,
  created_at timestamptz not null default now(),
  -- EL CANDADO: un contacto por tier por viaje. Reclamar = insertar; el
  -- perdedor choca aquí y no manda nada.
  unique (viaje_id, tier)
);

comment on table public.cobranza_contacto is
  'Bitácora del Agente de Cobranza (0089): un intento por (viaje, tier). El insert ES el claim anti-doble-envío.';

create index idx_cobranza_contacto_tenant
  on public.cobranza_contacto (tenant_id, created_at desc);

alter table public.agente_cobranza_config enable row level security;
alter table public.cobranza_contacto enable row level security;
