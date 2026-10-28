-- ═══════════════════════════════════════════════════════════════════════════
-- 0936 — PEAJES (A2, ola 1): las REGLAS DE CLASE POR FLOTA.
--
-- Dos decisiones de la flota que la revisión de cobros no puede adivinar y que
-- hasta hoy no se podían guardar en ningún lado:
--   · `clases_utilitario`: qué clases de cobro son normales para una unidad
--     UTILITARIO (camioneta, no tracto). Vacío = no se les evalúa la clase y la
--     revisión lo dice (no se inventa una tarifa de coche).
--   · `clase_uno`: qué hacer con la clase 1. El cliente indicó que la clase 1 es
--     la tarifa POR PASADA, no una clase de ejes:
--       'todas'      (default) → la clase 1 no se marca en ninguna caseta;
--       'declaradas'           → solo es normal en las casetas declaradas por
--                                pasada; en las demás se marca como candidato.
--
-- Una fila por flota; sin fila = los defaults (utilitarios sin evaluar, clase 1
-- como pasada). Tabla nueva: RLS prendida SIN políticas (deny-all), acceso directo
-- revocado a anon/authenticated y grant EXPLÍCITO a service_role (Supabase ya no
-- otorga permisos solo a las tablas nuevas). ADITIVA e IDEMPOTENTE; nace vacía.
-- Rango asignado a A2 ola 1: 0935–0937.
--
-- REVERSA (documentada, NO ejecutada):
--   drop table if exists public.peaje_regla_flota;
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.peaje_regla_flota (
  tenant_id          uuid primary key references public.tenant(id) on delete cascade,
  clases_utilitario  smallint[] not null default '{}',
  clase_uno          text not null default 'todas',
  actualizado_en     timestamptz not null default now(),
  constraint peaje_regla_flota_clase_uno_valida check (clase_uno in ('todas', 'declaradas')),
  constraint peaje_regla_flota_clases_sanas
    check (cardinality(clases_utilitario) <= 12 and clases_utilitario <@ array[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[])
);

comment on table public.peaje_regla_flota is
  '0936: reglas de clase por flota — clases válidas de las unidades utilitario y qué hacer con la clase 1 (tarifa por pasada). Sin fila = defaults.';
comment on column public.peaje_regla_flota.clases_utilitario is
  'Clases de cobro (1..12) normales para un utilitario. Vacío = no se evalúa su clase (y se dice).';
comment on column public.peaje_regla_flota.clase_uno is
  'todas (default): la clase 1 no se marca en ninguna caseta. declaradas: solo es normal en las casetas declaradas por pasada.';

alter table public.peaje_regla_flota enable row level security;
revoke all on table public.peaje_regla_flota from public, anon, authenticated;
grant select, insert, update, delete on table public.peaje_regla_flota to service_role;
