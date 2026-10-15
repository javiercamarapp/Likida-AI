-- ═══════════════════════════════════════════════════════════════════════════
-- 0786 — LIQUIDACIÓN POR CORREO: encabezado del desglose, excepciones y
--        estado del pull (Agente 1, rango A1 del programa de cinco agentes).
--
-- El desglose que el cliente recibe de su sistema de origen trae un encabezado
-- (unidad, bitácora, tipo de operador, póliza) que el esquema de
-- `liquidacion_externa` (0370) no admite, y hay bitácoras que llegan sin póliza
-- o con errores que alguien tiene que ver. Esta migración pone SOLO los datos
-- que lo sostienen; ninguna lógica de lectura ni de envío vive aquí.
--
-- ── QUÉ AÑADE ───────────────────────────────────────────────────────────────
--
--   1. `liquidacion_desglose`: el encabezado de la liquidación, una fila por
--      liquidación externa (tabla satélite; `liquidacion_externa` no se toca).
--   2. `liquidacion_excepcion`: lo que no se pudo importar o entregar y debe
--      verse (bitácora sin póliza, operador sin correo, total que no cuadra…).
--      Una sola excepción ABIERTA por flota + clave + tipo: si reaparece solo
--      se actualiza `ultima_vez`.
--   3. `liquidacion_pull_estado`: el cursor y el resultado de la última
--      corrida del pull, una fila por flota.
--   4. RLS: lectura de dinero (`ve_finanzas()`, como 0370/0785); escribe solo
--      service_role.
--
-- ── POR QUÉ NO ROMPE A NADIE ────────────────────────────────────────────────
--
-- Son tres tablas nuevas y vacías; ninguna tabla existente se altera
-- (`liquidacion_externa` queda sin ALTER). Nada las lee todavía.
--
-- ── IDEMPOTENCIA ────────────────────────────────────────────────────────────
--
-- Todo es `if not exists` o `drop policy if exists` + `create policy`. Aplicarla
-- dos veces no cambia nada la segunda vez.
--
-- ── CÓMO SE REVIERTE (documentado, no automático) ───────────────────────────
--
--   drop table if exists public.liquidacion_pull_estado;
--   drop table if exists public.liquidacion_excepcion;
--   drop table if exists public.liquidacion_desglose;
--
-- (Las tres tablas son nuevas: nada previo depende de ellas.)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. liquidacion_desglose: encabezado por liquidación ─────────────────────
-- FK compuesta (liquidacion_externa_id, tenant_id) → liquidacion_externa(id,
-- tenant_id) (destino: `liquidacion_externa_id_tenant_key`, 0370; regla de la
-- 0028/0145): un encabezado de la flota B no puede colgarse de una liquidación
-- de la flota A. Al purgar la liquidación (retención, 0562) el encabezado se va
-- con ella: ON DELETE CASCADE.
create table if not exists public.liquidacion_desglose (
  liquidacion_externa_id uuid primary key,
  tenant_id              uuid not null references public.tenant(id) on delete cascade,
  bitacora               text not null,
  terminal               text,
  poliza                 text,
  unidad                 text,
  tipo_operador          text,
  dias                   smallint,
  total_origen           text not null,
  enviado_origen_en      timestamptz,
  retenida_motivo        text,
  created_at             timestamptz not null default now(),
  constraint liquidacion_desglose_liquidacion_tenant_fkey
    foreign key (liquidacion_externa_id, tenant_id)
    references public.liquidacion_externa (id, tenant_id) on delete cascade,
  constraint liquidacion_desglose_bitacora_largo check (char_length(bitacora) between 1 and 60),
  constraint liquidacion_desglose_terminal_largo check (terminal is null or char_length(terminal) between 1 and 60),
  constraint liquidacion_desglose_poliza_largo check (poliza is null or char_length(poliza) between 1 and 60),
  constraint liquidacion_desglose_unidad_largo check (unidad is null or char_length(unidad) between 1 and 60),
  constraint liquidacion_desglose_tipo_operador_dominio check (
    tipo_operador is null or tipo_operador in ('foraneo', 'local', 'permisionario')
  ),
  constraint liquidacion_desglose_dias_rango check (dias is null or dias between 0 and 366),
  constraint liquidacion_desglose_total_origen_dominio check (total_origen in ('tms', 'calculado')),
  constraint liquidacion_desglose_retenida_motivo_largo check (
    retenida_motivo is null or char_length(retenida_motivo) <= 500
  )
);

comment on table public.liquidacion_desglose is
  '0786: encabezado del desglose (bitácora, terminal, póliza, unidad, tipo de operador) que el esquema de liquidacion_externa no admite. Una fila por liquidación; se va con ella al purgarla. Escribe solo service_role.';
comment on column public.liquidacion_desglose.poliza is
  'Póliza contable de la bitácora. NULL = el origen no la entregó (hay bitácoras sin póliza); se registra además una excepción sin_poliza.';
comment on column public.liquidacion_desglose.total_origen is
  'De dónde sale el total mostrado: tms (lo entregó el origen) o calculado (lo sumó Likida de los renglones).';
comment on column public.liquidacion_desglose.enviado_origen_en is
  'Cuándo se avisó al origen que la bitácora ya se consumió. NULL = todavía no.';
comment on column public.liquidacion_desglose.retenida_motivo is
  'Por qué el desglose no se envió (p. ej. neto negativo, tipo sin regla). NULL = no está retenido.';

-- Una bitácora es única por flota y terminal. `terminal` puede ser nulo (hay
-- orígenes de una sola terminal): `coalesce` evita que dos NULL cuenten como
-- distintos y dejen duplicar la misma bitácora.
create unique index if not exists liquidacion_desglose_bitacora_unica
  on public.liquidacion_desglose (tenant_id, coalesce(terminal, ''), bitacora);

create index if not exists liquidacion_desglose_tenant_idx
  on public.liquidacion_desglose (tenant_id, created_at desc);

-- ── 2. liquidacion_excepcion: lo que alguien tiene que ver ──────────────────
-- `clave_externa` no es FK a `liquidacion_externa`: una bitácora sin póliza o
-- un operador no encontrado fallan ANTES de existir como liquidación, y la
-- excepción tiene que poder registrarse igual. Se resuelve (resuelta_en) cuando
-- el problema desaparece; una nueva aparición abre otra fila.
create table if not exists public.liquidacion_excepcion (
  id            bigint generated always as identity primary key,
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  clave_externa text not null,
  tipo          text not null,
  detalle       jsonb not null default '{}'::jsonb,
  primera_vez   timestamptz not null default now(),
  ultima_vez    timestamptz not null default now(),
  resuelta_en   timestamptz,
  constraint liquidacion_excepcion_clave_larga check (char_length(clave_externa) between 1 and 120),
  constraint liquidacion_excepcion_tipo_dominio check (
    tipo in (
      'sin_poliza', 'operador_no_encontrado', 'operador_sin_correo',
      'coordinador_sin_correo', 'total_no_cuadra', 'concepto_prohibido',
      'neto_negativo', 'tipo_sin_regla', 'correccion_pendiente', 'mapeo_invalido'
    )
  ),
  constraint liquidacion_excepcion_detalle_forma check (
    jsonb_typeof(detalle) = 'object' and pg_column_size(detalle) <= 8192
  ),
  constraint liquidacion_excepcion_orden check (ultima_vez >= primera_vez)
);

comment on table public.liquidacion_excepcion is
  '0786: excepciones del desglose por correo (bitácora sin póliza, operador sin correo, total que no cuadra…). Una abierta por flota+clave+tipo; si reaparece solo se actualiza ultima_vez. Escribe solo service_role.';
comment on column public.liquidacion_excepcion.detalle is
  'Datos para entender la excepción, sin contenido personal del desglose (ids y motivos, no importes ni nombres).';

-- Una excepción ABIERTA por (flota, clave, tipo). Las resueltas se acumulan
-- como historia y no estorban a una nueva apertura.
create unique index if not exists liquidacion_excepcion_abierta_unica
  on public.liquidacion_excepcion (tenant_id, clave_externa, tipo)
  where resuelta_en is null;

create index if not exists liquidacion_excepcion_tenant_idx
  on public.liquidacion_excepcion (tenant_id, ultima_vez desc);

-- ── 3. liquidacion_pull_estado: cursor y resultado del pull ─────────────────
create table if not exists public.liquidacion_pull_estado (
  tenant_id      uuid primary key references public.tenant(id) on delete cascade,
  cursor         jsonb,
  ultima_corrida timestamptz,
  ultimo_exito   timestamptz,
  ultimo_error   text,
  leidas         integer not null default 0,
  importadas     integer not null default 0,
  excepciones    integer not null default 0,
  constraint liquidacion_pull_estado_cursor_forma check (
    cursor is null or (jsonb_typeof(cursor) = 'object' and pg_column_size(cursor) <= 4096)
  ),
  constraint liquidacion_pull_estado_error_largo check (ultimo_error is null or char_length(ultimo_error) <= 1000),
  constraint liquidacion_pull_estado_contadores check (leidas >= 0 and importadas >= 0 and excepciones >= 0)
);

comment on table public.liquidacion_pull_estado is
  '0786: estado del pull de desgloses desde el origen, una fila por flota (cursor y contadores de la última corrida). Escribe solo service_role.';

-- ── 4. RLS ──────────────────────────────────────────────────────────────────
-- Tabla nueva sin RLS = agujero para quien le pregunta a PostgREST con la anon
-- key. Lectura: dinero (el encargado no entra). Escritura: ninguna política,
-- solo service_role.
alter table public.liquidacion_desglose enable row level security;
alter table public.liquidacion_excepcion enable row level security;
alter table public.liquidacion_pull_estado enable row level security;

drop policy if exists tenant_lee on public.liquidacion_desglose;
create policy tenant_lee on public.liquidacion_desglose for select
  using ((tenant_id = any(get_user_tenant_ids()) and ve_finanzas()) or is_superadmin());

drop policy if exists tenant_lee on public.liquidacion_excepcion;
create policy tenant_lee on public.liquidacion_excepcion for select
  using ((tenant_id = any(get_user_tenant_ids()) and ve_finanzas()) or is_superadmin());

drop policy if exists tenant_lee on public.liquidacion_pull_estado;
create policy tenant_lee on public.liquidacion_pull_estado for select
  using ((tenant_id = any(get_user_tenant_ids()) and ve_finanzas()) or is_superadmin());
