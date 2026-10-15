-- ═══════════════════════════════════════════════════════════════════════════
-- 0775 — PEAJES: la CLASE, la unidad del archivo y el PERIODO oficial del desglose.
--
-- El archivo decenal del proveedor trae por cruce la CLASE de cobro (ejes), el
-- «No. economico» del vehículo y, a veces, un «Importe al 100%» distinto del
-- facturado. Hasta hoy el importador los tiraba. Esta migración los guarda para
-- poder VALIDAR el cobro (clase esperada 3 y 5) sin depender de que el TAG esté
-- dado de alta en `peaje_tag`.
--
-- Y guarda el PERIODO OFICIAL del archivo —el que declara la persona o el que dice
-- el nombre («01 A 10 DE SEPT»)—, aparte del periodo MEDIDO (min/max de fechas): un
-- cobro extemporáneo ensancha el medido, así que el medido no sirve para decidir qué
-- cruce llegó tarde. También el «No. de periodo» del proveedor y el REPORTE DE
-- CALIDAD del archivo (columnas reconocidas, líneas sin TAG/unidad/clase, columnas
-- sin encabezado): nada queda en null sin dejar rastro.
--
-- Idempotente (`if not exists`, guardas `pg_constraint`). RLS: las tablas ya la
-- tienen prendida sin políticas (deny-all); esta migración no abre nada.
-- Rango asignado al frente A2 Peajes: 0775–0779.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.desglose_peaje_linea
  add column if not exists clase          smallint,
  add column if not exists unidad_archivo text,
  add column if not exists importe_100    numeric(12,2);

comment on column public.desglose_peaje_linea.clase is
  'Clase de cobro (ejes) que declara el archivo del proveedor. NULL = el archivo no la traía o no era un entero 0–99 (el reporte de calidad lo cuenta). Esperadas: 3 (tracto) y 5 (tracto + caja); la clase 1 es tarifa por pasada en algunas casetas.';
comment on column public.desglose_peaje_linea.unidad_archivo is
  'La unidad tal como la escribe el proveedor («No. economico»: 101, TC0001, CAMIONETA). Texto libre: puede no coincidir con unidad.numero_economico. NULL = sin columna o celda vacía.';
comment on column public.desglose_peaje_linea.importe_100 is
  '«Importe al 100%» cuando difiere del importe facturado (monto). NULL = no difiere o no vino.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'desglose_peaje_linea_clase_sana') then
    alter table public.desglose_peaje_linea
      add constraint desglose_peaje_linea_clase_sana check (clase is null or clase between 0 and 99);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'desglose_peaje_linea_unidad_archivo_larga') then
    alter table public.desglose_peaje_linea
      add constraint desglose_peaje_linea_unidad_archivo_larga check (unidad_archivo is null or char_length(unidad_archivo) <= 40);
  end if;
end $$;

alter table public.desglose_peaje
  add column if not exists periodo_oficial_desde date,
  add column if not exists periodo_oficial_hasta date,
  add column if not exists periodo_origen        text,
  add column if not exists no_periodo            text,
  add column if not exists calidad               jsonb;

comment on column public.desglose_peaje.periodo_oficial_desde is
  'Inicio del periodo OFICIAL del archivo (declarado o del nombre). Un cruce con fecha anterior es extemporáneo. NULL = no se sabe: la regla no se aplica y se avisa. Distinto de periodo_desde (el MEDIDO, que se ensancha con los extemporáneos).';
comment on column public.desglose_peaje.periodo_origen is
  'De dónde salió el periodo oficial: declarado (la persona) o nombre_archivo. NULL si no hay.';
comment on column public.desglose_peaje.no_periodo is
  'El «No. de periodo» que declara el proveedor (consecutivo de su decena, p. ej. 745). Referencia: no es una fecha.';
comment on column public.desglose_peaje.calidad is
  'Reporte de calidad del archivo al importar: filas leídas, columnas reconocidas y no reconocidas, columnas sin encabezado con datos, líneas sin TAG/unidad/clase/hora, hoja leída y hojas ignoradas.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'desglose_peaje_periodo_oficial_sano') then
    alter table public.desglose_peaje
      add constraint desglose_peaje_periodo_oficial_sano
      check (
        (periodo_oficial_desde is null) = (periodo_oficial_hasta is null)
        and (periodo_oficial_desde is null or periodo_oficial_hasta >= periodo_oficial_desde)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'desglose_peaje_periodo_origen_dominio') then
    alter table public.desglose_peaje
      add constraint desglose_peaje_periodo_origen_dominio
      check (periodo_origen is null or periodo_origen in ('declarado', 'nombre_archivo'));
  end if;
end $$;

-- Para el cierre mensual: los desgloses de un tenant por periodo oficial.
create index if not exists desglose_peaje_periodo_oficial_idx
  on public.desglose_peaje (tenant_id, periodo_oficial_hasta)
  where periodo_oficial_hasta is not null and anulado_en is null;
