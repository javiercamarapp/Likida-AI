-- ═══════════════════════════════════════════════════════════════════════════
-- 0174 — el umbral de "diferencia real" no excluía ningún centavo
--
-- `stats_operador_tenant` (0150) cuenta las liquidaciones con diferencia real
-- por operador, y su propio comentario declara la intención: «centavos de
-- redondeo no son una conversación». El filtro que escribió era
-- `abs(diferencia) >= 0.01`.
--
-- POR QUÉ NO EXCLUÍA NADA: `liquidacion.diferencia` es `numeric(12,2)`. La
-- columna solo guarda centavos, así que CUALQUIER valor distinto de cero que
-- llegue ahí ya es ≥ 0.01 — medio centavo (0.005) se redondea a 0.01 AL
-- GUARDARSE y cruza el umbral. El filtro coincidía exactamente con la
-- resolución de la columna, así que equivalía a `<> 0`.
--
-- Efecto real: un operador cuya liquidación cuadró salvo por el redondeo del
-- IVA aparecía en las estadísticas con una diferencia a su nombre. Poca plata
-- y mucha injusticia: es su historial.
--
-- EL ARREGLO es que el umbral sea MAYOR que la resolución: más de un centavo.
-- Se deja `> 0.01` y no un número mayor porque el que decide qué es "material"
-- es la flota con su política, no esta función — lo que aquí se corrige es solo
-- que el redondeo deje de contar, que es lo que la 0150 quiso decir.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.stats_operador_tenant(p_tenant uuid)
returns jsonb
language sql
stable parallel safe
set search_path = public, pg_catalog
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'operadorId', o.id,
    'nombre', o.nombre,
    'viajes', coalesce(d.viajes, 0),
    'dieselTotal', coalesce(d.diesel, 0),
    'diferencias', coalesce(l.n, 0)
  ) order by o.id), '[]'::jsonb)
  from operador o
  left join (
    select v.operador_id, count(distinct g.viaje_id) as viajes, sum(g.monto) as diesel
      from gasto g join viaje v on v.id = g.viaje_id
     where g.tenant_id = p_tenant and g.concepto = 'diesel'
     group by v.operador_id
  ) d on d.operador_id = o.id
  left join (
    select v.operador_id, count(*) as n
      from liquidacion l join viaje v on v.id = l.viaje_id
     where l.tenant_id = p_tenant and abs(coalesce(l.diferencia, 0)) > 0.01
     group by v.operador_id
  ) l on l.operador_id = o.id
 where o.tenant_id = p_tenant and o.oposicion_automatizada is null;
$$;

revoke all on function public.stats_operador_tenant(uuid) from public, anon, authenticated;
grant execute on function public.stats_operador_tenant(uuid) to service_role;
