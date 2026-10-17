-- ═══════════════════════════════════════════════════════════════════════════
-- 0812 — PEAJES: TIPO DE UNIDAD del TAG (tracto / utilitario) (T-A2-39).
--
-- (La ficha lo nombraba «0813»; la numeración se renumera en orden de creación dentro
-- del bloque 0810–0819 asignado a A2: después de la 0811 sigue la 0812.)
--
-- La clase de cobro esperada depende del tipo de vehículo: el tracto cruza con clase
-- 3 o 5; una camioneta utilitaria cruza «con tarifa de coche» y se revisa con otro
-- criterio. Esta migración agrega a `peaje_tag` la columna `tipo_unidad`:
--
--   · NULL  = sin tipo de unidad (el maestro TAG→unidad con tipo todavía no existe o
--             no trae ese TAG). Es el estado de TODAS las filas existentes: no se
--             inventa un tipo.
--   · 'tracto' | 'utilitario' = lo declaró la flota (CSV de TAGs, columna `tipo`).
--
-- Aditiva e idempotente: no siembra datos, no toca RLS (la tabla ya es deny-all, 0375)
-- y no cambia ninguna fila existente.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.peaje_tag add column if not exists tipo_unidad text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'peaje_tag_tipo_unidad_dominio') then
    alter table public.peaje_tag
      add constraint peaje_tag_tipo_unidad_dominio
      check (tipo_unidad is null or tipo_unidad in ('tracto', 'utilitario'));
  end if;
end $$;

comment on column public.peaje_tag.tipo_unidad is
  '0812: tipo de la unidad del TAG (tracto | utilitario). NULL = sin tipo de unidad (no se adivina). La regla de clase esperada lo usa: tracto y sin tipo se evalúan contra 3 y 5; utilitario contra la lista que declare la flota.';
