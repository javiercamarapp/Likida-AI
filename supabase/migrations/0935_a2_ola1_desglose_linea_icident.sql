-- ═══════════════════════════════════════════════════════════════════════════
-- 0935 — PEAJES (A2, ola 1): el `Icident` (número de despacho del TMS) del cobro.
--
-- El API del TMS del cliente entrega los peajes con una columna `Icident` (el
-- número de despacho que identifica el viaje). El parser del desglose la
-- descartaba al importar; con esta columna se guarda en cada línea para que el
-- cruce cobro → viaje pueda ligar por `Icident` exacto en vez de solo por
-- unidad + ventana de días. NULL = el archivo no la traía (el caso de hoy: el
-- Excel decenal del proveedor no la trae).
--
-- ADITIVA e IDEMPOTENTE: una columna nullable sin default (solo metadatos), un
-- CHECK de largo y un índice parcial. La tabla ya tiene RLS prendida sin
-- políticas (deny-all) y sus grants (0775): no crea tablas, no abre nada.
-- Rango asignado a A2 ola 1: 0935–0937.
--
-- REVERSA (documentada, NO ejecutada):
--   drop index if exists public.desglose_peaje_linea_icident_idx;
--   alter table public.desglose_peaje_linea
--     drop constraint if exists desglose_peaje_linea_icident_largo;
--   alter table public.desglose_peaje_linea drop column if exists icident;
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.desglose_peaje_linea
  add column if not exists icident text;

comment on column public.desglose_peaje_linea.icident is
  'Icident (número de despacho del TMS del cliente) que acompaña el cobro, si el archivo lo trae (0935). NULL = el archivo no traía la columna o la celda venía vacía. Liga el cobro con viaje.despacho_ref sin depender de unidad + ventana.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'desglose_peaje_linea_icident_largo') then
    alter table public.desglose_peaje_linea
      add constraint desglose_peaje_linea_icident_largo
      check (icident is null or char_length(icident) between 1 and 80);
  end if;
end $$;

-- Parcial: la mayoría de las líneas (todo archivo sin API) tienen null y no ocupan espacio.
create index if not exists desglose_peaje_linea_icident_idx
  on public.desglose_peaje_linea (tenant_id, icident)
  where icident is not null;
