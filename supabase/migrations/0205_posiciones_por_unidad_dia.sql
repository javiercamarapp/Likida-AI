-- ═══════════════════════════════════════════════════════════════════════════
-- 0205 — EL AGREGADO QUE ALIMENTA LA EVIDENCIA GPS DE LOS CRUCES DE PEAJE
-- (orden post-plan-maestro #1: el "martirio" de Innovativos, conciliar
-- peajes contra GPS cada 10 días).
--
-- El cruce de evidencia pregunta, por cada línea del desglose del proveedor:
-- ¿la unidad de ese viaje TUVO posiciones GPS el día del cruce? Contar eso
-- desde la app significaría traer las posiciones crudas (un poller de 5 min ×
-- unidades × 10 días del corte son decenas de miles de filas por desglose):
-- se agrega en SQL, como los demás agregados del repo (0150/0151/0190).
--
-- EL DÍA ES EL DE MÉXICO, NO EL DE UTC — la misma lección de la 0193 y de
-- `hoyMx()`: `medida_en` es timestamptz, y una posición de las 19:30 de
-- Mérida ya es "mañana" en UTC. La fecha del cruce en el desglose del
-- proveedor es fecha local; compararla contra el día UTC desplazaría la
-- evidencia de los cruces nocturnos al día equivocado.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.posiciones_por_unidad_dia(
  p_tenant   uuid,
  p_unidades uuid[],
  p_desde    date,
  p_hasta    date
) returns table (unidad_id uuid, dia date, n bigint)
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  select s.unidad_id, s.dia, count(*) as n
  from (
    select
      p.unidad_id,
      (p.medida_en at time zone 'America/Mexico_City')::date as dia
    from posicion p
    where p.tenant_id = p_tenant
      and p.unidad_id = any (p_unidades)
      -- El filtro grueso va en timestamptz para que el índice
      -- (tenant, unidad, medida_en) trabaje; el margen de un día por lado
      -- absorbe el corrimiento de huso antes del corte fino por día MX.
      and p.medida_en >= (p_desde - 1)::timestamptz
      and p.medida_en <  (p_hasta + 2)::timestamptz
  ) s
  where s.dia between p_desde and p_hasta
  group by s.unidad_id, s.dia
$$;

comment on function public.posiciones_por_unidad_dia(uuid, uuid[], date, date) is
  'Conteo de posiciones GPS por unidad y DÍA DE MÉXICO dentro de un rango, para la evidencia GPS del conciliador de peajes (0205). Solo cuenta — la clasificación (con evidencia / sin evidencia, y sus motivos) vive en el motor puro de la app (peajes/evidencia_gps.ts). SECURITY INVOKER; p_tenant sin default.';

revoke all on function public.posiciones_por_unidad_dia(uuid, uuid[], date, date) from public, anon, authenticated;
grant execute on function public.posiciones_por_unidad_dia(uuid, uuid[], date, date) to service_role;
