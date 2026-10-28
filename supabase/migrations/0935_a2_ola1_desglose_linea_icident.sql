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
-- También amplía el dominio de `desglose_peaje.periodo_origen` (0775: 'declarado' | 'nombre_archivo') con los dos
-- orígenes que el importador ahora INFIERE cuando el nombre del archivo no dice su periodo: 'no_periodo' (contando
-- decenas desde otro archivo de la flota) y 'decena_dominante' (la decena donde cae casi todo el archivo). Los valores
-- viejos siguen valiendo. Es un DROP + ADD de un CHECK (se valida contra las filas existentes: solo traen los dos valores viejos).
--
-- Y agrega `peaje_caseta.carretera` (texto libre, opcional): la columna «carretera o tramo» de la plantilla del catálogo de
-- casetas que se le manda al cliente; el importador la guarda y la pantalla la muestra.
--
-- ADITIVA e IDEMPOTENTE: una columna nullable sin default (solo metadatos), un
-- CHECK de largo y un índice parcial. La tabla ya tiene RLS prendida sin
-- políticas (deny-all) y sus grants (0775): no crea tablas, no abre nada.
-- Rango asignado a A2 ola 1: 0935–0937.
--
-- REVERSA (documentada, NO ejecutada):
--   alter table public.peaje_caseta drop constraint if exists peaje_caseta_carretera_larga;
--   alter table public.peaje_caseta drop column if exists carretera;
-- (y, antes de volver al CHECK viejo hay que pasar a NULL los orígenes inferidos):
--   update public.desglose_peaje set periodo_origen = null, periodo_oficial_desde = null, periodo_oficial_hasta = null
--    where periodo_origen in ('no_periodo', 'decena_dominante');
--   alter table public.desglose_peaje drop constraint if exists desglose_peaje_periodo_origen_dominio;
--   alter table public.desglose_peaje add constraint desglose_peaje_periodo_origen_dominio
--     check (periodo_origen is null or periodo_origen in ('declarado', 'nombre_archivo'));
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

-- El dominio del origen del periodo: los dos viejos + los dos que el sistema infiere. Idempotente: si el CHECK ya es el nuevo no se toca.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'desglose_peaje_periodo_origen_dominio'
               and conrelid = 'public.desglose_peaje'::regclass
               and pg_get_constraintdef(oid) not like '%decena_dominante%') then
    alter table public.desglose_peaje drop constraint desglose_peaje_periodo_origen_dominio;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'desglose_peaje_periodo_origen_dominio'
                   and conrelid = 'public.desglose_peaje'::regclass) then
    alter table public.desglose_peaje
      add constraint desglose_peaje_periodo_origen_dominio
      check (periodo_origen is null or periodo_origen in ('declarado', 'nombre_archivo', 'no_periodo', 'decena_dominante'));
  end if;
end $$;

comment on column public.desglose_peaje.periodo_origen is
  'De dónde salió el periodo oficial: declarado (la persona), nombre_archivo, o INFERIDO por el sistema: no_periodo (contando decenas desde otro archivo de la flota) o decena_dominante (la decena donde cae casi todo el archivo). Los inferidos se rotulan y se pueden corregir declarando el periodo.';

-- La carretera o tramo de la caseta (texto libre, hasta 120 caracteres, como el nombre).
alter table public.peaje_caseta
  add column if not exists carretera text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'peaje_caseta_carretera_larga' and conrelid = 'public.peaje_caseta'::regclass) then
    alter table public.peaje_caseta
      add constraint peaje_caseta_carretera_larga check (carretera is null or char_length(carretera) <= 120);
  end if;
end $$;

comment on column public.peaje_caseta.carretera is
  'Carretera o tramo donde está la caseta (texto libre, opcional): la columna «carretera o tramo» de la plantilla del catálogo (0935). NULL = sin dato.';
