-- ═══════════════════════════════════════════════════════════════════════════
-- 0780 — `despacho_ref`: referencia de despacho del sistema de gestión de
--        transporte (TMS) del cliente, guardada en `viaje` y en `posicion`.
--
-- Para qué: hoy un cruce o una posición se liga a un viaje por unidad+ventana
-- de tiempo (heurística). El TMS del cliente trae en sus posiciones un campo
-- de despacho que identifica el viaje de origen; guardarlo permite PREFERIR
-- esa referencia exacta sobre la heurística (requisito 12 §F2).
--
-- DECISIÓN ABIERTA (bloqueo externo): no se sabe aún si la referencia es única
-- por tracto-día o por tramo. Por eso la columna NO es única: solo un índice
-- parcial NO único para buscar. El índice único `(tenant, despacho_ref,
-- unidad_id)` se decidirá cuando llegue el dato real.
--
-- ADITIVA: dos columnas nullable sin default (operación de metadatos, sin
-- reescribir la tabla) y un índice parcial. NO toca `viaje_folio_unico` (0092)
-- ni la deduplicación por folio. Sin funciones nuevas.
--
-- REVERSA (documentada, NO ejecutada):
--   drop index if exists public.viaje_despacho_ref_idx;
--   alter table public.posicion drop column if exists despacho_ref;
--   alter table public.viaje    drop column if exists despacho_ref;
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.viaje
  add column if not exists despacho_ref text;

alter table public.posicion
  add column if not exists despacho_ref text;

-- Parcial y NO único: la mayoría de los viajes (y todos los de flotas sin
-- conector) tienen null y no ocupan espacio en el índice.
create index if not exists viaje_despacho_ref_idx
  on public.viaje (tenant_id, despacho_ref)
  where despacho_ref is not null;

comment on column public.viaje.despacho_ref is
  'Referencia de despacho del sistema de gestión de transporte del cliente (0780). Null = el viaje no vino de ahí. NO es única: se desconoce si lo es por tracto-día o por tramo. Se prefiere sobre unidad+ventana al cruzar.';
comment on column public.posicion.despacho_ref is
  'Referencia de despacho que acompaña la posición en el sistema de gestión de transporte del cliente (0780). Nullable; liga la posición a un viaje sin depender de unidad+ventana.';
