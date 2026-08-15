-- ═══════════════════════════════════════════════════════════════════════════
-- 0106 — EL DESGLOSE DEL PROVEEDOR DE PEAJE (FASE 5, PoC del Plaud #2).
--
-- "El martirio" de Transportes Innovativos: el proveedor del TAG (IAVE, PASE,
-- TeleVía o el convenio directo) manda cada corte un desglose de cruces en
-- Excel/CSV/PDF, y hoy alguien lo coteja a mano contra los viajes. El CFDI
-- consolidado ya tiene su camino (`cfdi_consolidado_linea`, 0065/0077), pero
-- el DESGLOSE NO ES UN CFDI: es una tabla de cruces (fecha, caseta, importe,
-- TAG) sin folio fiscal, sin XML y sin UUID — no cabe en esa tabla sin
-- mentirle a su llave (`cfdi_xml_id` not null).
--
-- Estas dos tablas son el aterrizaje de ese archivo: una fila por desglose
-- recibido y una por línea de cruce. El cruce contra los gastos de caseta de
-- los viajes (fecha ±1 día, monto exacto primero y después tolerancia de
-- rondeo) lo corre `intake/desglose_peaje.ts`, y deja TRES cubetas honestas:
--   cuadra          = hay UN gasto de caseta que la respalda (viaje_id se llena)
--   no_cuadra       = hay contraparte pero el cruce no puede afirmar el cuadre
--                     (monto distinto — `diferencia` en pesos — o ambigüedad;
--                     el porqué exacto va en `detalle`)
--   sin_contraparte = cero gastos de caseta en la ventana (el default: toda
--                     línea nace así, sin conciliar no se afirma nada)
--
-- QUÉ NO HACE: no escribe en `gasto` ni en nada fiscal. El sello fiscal
-- (cfdi_uuid/cfdi_orden) es del camino del CFDI consolidado; esto es una
-- ANOTACIÓN sobre el archivo del proveedor, recalculable con re-correr el
-- cruce. Por eso re-conciliar es idempotente y no necesita guardias de
-- carrera como las del consolidado.
--
-- De lo conciliado sale la bitácora de la RMF 2026 regla 9.1.8, fr. II
-- (ficha `normas/rmf-2026-9.1.8.yaml`): viaje, origen/destino, caseta y monto
-- que COINCIDEN con el estado de cuenta del sistema electrónico de pago.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.desglose_peaje (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id) on delete cascade,
  -- Texto libre a propósito: no hay catálogo verificado de proveedores de
  -- telepeaje, y un CHECK inventado rebotaría al primero real que no anticipamos.
  proveedor      text,
  -- El periodo MEDIDO del archivo (min/max de las fechas de sus líneas).
  -- NULL cuando ninguna línea trajo fecha legible — no se inventa un rango.
  periodo_desde  date,
  periodo_hasta  date,
  archivo_nombre text,
  creado_en      timestamptz not null default now(),
  constraint desglose_peaje_periodo_sano
    check (periodo_desde is null or periodo_hasta is null or periodo_hasta >= periodo_desde)
);

comment on table public.desglose_peaje is
  'Un archivo de desglose del proveedor de peaje (Excel/CSV/PDF — NO el CFDI consolidado, ese vive en cfdi_xml). El periodo es el medido de sus líneas, nunca inventado.';
comment on column public.desglose_peaje.proveedor is
  'IAVE / PASE / TeleVía / convenio directo — texto libre, sin catálogo porque no hay uno verificado.';

create table if not exists public.desglose_peaje_linea (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  desglose_id uuid not null references public.desglose_peaje(id) on delete cascade,
  -- El renglón del archivo (0-based tras el encabezado): da orden estable al
  -- cruce (dos líneas idénticas: la primera del archivo gana el candidato) y
  -- ancla el UNIQUE de abajo.
  indice      int not null,
  -- date y no timestamptz: el cruce es por DÍA (±1) contra `gasto.fecha`, que
  -- es date. La hora del cruce, si el archivo la trae, se descarta al parsear
  -- — guardarla aparentaría una precisión que el cruce no usa.
  fecha       date,
  caseta      text,
  monto       numeric(12,2) not null,
  tag         text,
  -- Se llena SOLO cuando la línea cuadra contra un gasto de ese viaje.
  -- on delete set null: la línea es un hecho del archivo del proveedor y no
  -- muere con el viaje; el siguiente re-cruce la recalcula.
  viaje_id    uuid references public.viaje(id) on delete set null,
  estatus     text not null default 'sin_contraparte',
  -- Pesos de discrepancia MEDIDOS: en cuadra, los centavos de rondeo admitidos
  -- (0 si el monto fue exacto — un cero medido); en no_cuadra por monto, la
  -- diferencia contra el candidato más cercano. NULL cuando no hay contraparte
  -- única contra quién medir (sin_contraparte, ambigua): NULL ≠ 0.
  diferencia  numeric(12,2),
  -- El porqué del estatus, para un humano: motivo, gasto/candidatos evaluados.
  -- Sin datos personales.
  detalle     jsonb,
  constraint desglose_peaje_linea_estatus_dominio
    check (estatus in ('cuadra', 'no_cuadra', 'sin_contraparte')),
  constraint desglose_peaje_linea_unica unique (desglose_id, indice)
);

comment on table public.desglose_peaje_linea is
  'Una línea de cruce del desglose del proveedor. Tres cubetas honestas: cuadra / no_cuadra / sin_contraparte. No escribe en gasto: es anotación recalculable, no sello fiscal.';
comment on column public.desglose_peaje_linea.diferencia is
  'Pesos medidos contra la contraparte (0 = exacto medido). NULL = no hay contraparte única contra quién medir — NULL nunca significa cero.';

-- La consulta de la pantalla: las líneas de un desglose, por flota.
create index if not exists desglose_peaje_linea_por_desglose
  on public.desglose_peaje_linea (tenant_id, desglose_id);
-- La cola de discrepancias del agente: cuántas no cuadran, por flota.
create index if not exists desglose_peaje_linea_por_estatus
  on public.desglose_peaje_linea (tenant_id, estatus);
-- La bitácora de desgloses recibidos, del más nuevo al más viejo.
create index if not exists desglose_peaje_por_flota
  on public.desglose_peaje (tenant_id, creado_en desc);

-- RLS prendida SIN políticas (deny-all, el patrón de `prospecto` en 0105):
-- todo acceso pasa por service_role desde el servidor (`supabaseAdmin`), que
-- filtra por tenant en cada consulta. Ninguna policy permisiva que un cliente
-- de navegador pueda alcanzar.
alter table public.desglose_peaje enable row level security;
alter table public.desglose_peaje_linea enable row level security;
