-- ═══════════════════════════════════════════════════════════════════════════
-- 0789 — LIQUIDACIÓN POR CORREO: número de liquidación, número de pago y varias
--        bitácoras de la misma unidad (Agente 1, T-A1-41).
--
-- El encabezado real del desglose trae, además de la unidad y el periodo, el
-- NÚMERO DE LIQUIDACIÓN (un consecutivo que arroja el sistema de origen) y el
-- NÚMERO DE PAGO. La liquidación es por unidad: si con una unidad se hicieron
-- dos viajes, se liquidan juntos y salen en UN solo desglose con varias
-- bitácoras. Hasta ahora `liquidacion_desglose` guardaba una sola bitácora y
-- ningún número. Esta migración pone SOLO los datos que lo sostienen.
--
-- ── QUÉ AÑADE ───────────────────────────────────────────────────────────────
--
--   1. `liquidacion_desglose.numero_liquidacion` (text, nulo).
--   2. `liquidacion_desglose.numero_pago` (text, nulo).
--   3. `liquidacion_desglose.bitacoras` (text[], nulo): todas las bitácoras que
--      la liquidación junta; `bitacora` sigue siendo la principal.
--   4. Índice ÚNICO PARCIAL (tenant, terminal, numero_liquidacion) cuando el
--      número no es nulo: el mismo número no se registra dos veces en la misma
--      flota y terminal.
--   5. `liquidacion_excepcion.tipo` admite `unidades_mezcladas` (un desglose con
--      bitácoras de unidades distintas se rechaza y deja esta excepción).
--
-- ── POR QUÉ NO ROMPE A NADIE ────────────────────────────────────────────────
--
-- Solo es aditiva: tres columnas nulas y un índice parcial que no cubre las
-- filas sin número. Sin los campos, todo se comporta como hoy (una bitácora =
-- un desglose, índice único de 0786 intacto). El constraint de tipos de
-- excepción solo AMPLÍA el dominio: toda fila que cumplía el anterior cumple
-- el nuevo. Likida no recalcula nada: los renglones ya vienen agregados de la
-- fuente.
--
-- ── IDEMPOTENCIA ────────────────────────────────────────────────────────────
--
-- `add column if not exists`, `create unique index if not exists` y
-- `drop constraint if exists` + `add constraint`. Aplicarla dos veces no
-- cambia nada la segunda vez.
--
-- ── CÓMO SE REVIERTE (documentado, no automático) ───────────────────────────
--
--   drop index if exists public.liquidacion_desglose_numero_liquidacion_unico;
--   alter table public.liquidacion_desglose
--     drop column if exists bitacoras,
--     drop column if exists numero_pago,
--     drop column if exists numero_liquidacion;
--   -- y, solo si no hay filas `unidades_mezcladas`, volver el constraint de tipos
--   -- de `liquidacion_excepcion` a la lista de 0786.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.liquidacion_desglose
  add column if not exists numero_liquidacion text,
  add column if not exists numero_pago        text,
  add column if not exists bitacoras          text[];

alter table public.liquidacion_desglose
  drop constraint if exists liquidacion_desglose_numero_liquidacion_forma;
alter table public.liquidacion_desglose
  add constraint liquidacion_desglose_numero_liquidacion_forma check (
    numero_liquidacion is null or char_length(numero_liquidacion) between 1 and 40
  );

alter table public.liquidacion_desglose
  drop constraint if exists liquidacion_desglose_numero_pago_forma;
alter table public.liquidacion_desglose
  add constraint liquidacion_desglose_numero_pago_forma check (
    numero_pago is null or char_length(numero_pago) between 1 and 40
  );

alter table public.liquidacion_desglose
  drop constraint if exists liquidacion_desglose_bitacoras_forma;
alter table public.liquidacion_desglose
  add constraint liquidacion_desglose_bitacoras_forma check (
    bitacoras is null or (cardinality(bitacoras) between 1 and 100 and array_ndims(bitacoras) = 1)
  );

comment on column public.liquidacion_desglose.numero_liquidacion is
  '0789: consecutivo de liquidación que arroja el sistema de origen. NULL = el origen no lo mandó (modo una bitácora = un desglose). Único por flota+terminal cuando existe.';
comment on column public.liquidacion_desglose.numero_pago is
  '0789: número de pago del encabezado de la liquidación. NULL = el origen no lo mandó.';
comment on column public.liquidacion_desglose.bitacoras is
  '0789: todas las bitácoras que la liquidación junta (una unidad con dos viajes se liquida junta). La principal sigue en `bitacora`. NULL = solo esa.';

-- Único parcial: el mismo número de liquidación no se repite en la misma flota y terminal. `coalesce` hace que dos
-- terminales nulas cuenten como la misma, igual que el índice de bitácora (0786).
create unique index if not exists liquidacion_desglose_numero_liquidacion_unico
  on public.liquidacion_desglose (tenant_id, coalesce(terminal, ''), numero_liquidacion)
  where numero_liquidacion is not null;

-- Excepción nueva: unidades distintas en un mismo desglose. Solo amplía el dominio de 0786.
alter table public.liquidacion_excepcion
  drop constraint if exists liquidacion_excepcion_tipo_dominio;
alter table public.liquidacion_excepcion
  add constraint liquidacion_excepcion_tipo_dominio check (
    tipo in (
      'sin_poliza', 'operador_no_encontrado', 'operador_sin_correo',
      'coordinador_sin_correo', 'total_no_cuadra', 'concepto_prohibido',
      'neto_negativo', 'tipo_sin_regla', 'correccion_pendiente', 'mapeo_invalido',
      'unidades_mezcladas'
    )
  );
