-- ═══════════════════════════════════════════════════════════════════════════
-- 0686 — serie_comparativa_tenant: la ventana de liquidacion por created_at sargable.
--
-- Medido (ronda 16, 60,000 liquidaciones en una flota): 420-500 ms p50 y 2.1 s
-- p95 en CADA carga del Resumen. El predicado
--   (created_at at time zone 'America/Mexico_City')::date between desde and hasta
-- aplica la función a la COLUMNA, así que idx_liq_tenant (tenant_id, created_at)
-- no podía acotar: cada uno de los 12 pasos releía las 60k liquidaciones de la
-- flota. Equivalente exacto y sargable: created_at >= medianoche MX de `desde`
-- y created_at < medianoche MX de `hasta + 1`. Firma, SECURITY INVOKER y
-- salida iguales; solo cambia el predicado.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.serie_comparativa_tenant(p_tenant uuid, p_ventana_dias integer, p_pasos integer, p_hoy date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE PARALLEL SAFE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  with limites as (
    select
      gs as paso,
      (p_hoy - (gs * p_ventana_dias))::date as hasta,
      (p_hoy - (gs * p_ventana_dias) - (p_ventana_dias - 1))::date as desde
    from generate_series(0, p_pasos - 1) as gs
  ),
  g as (
    select l.paso, round(sum(gasto.monto), 2) as gasto_total
    from limites l
    join gasto on gasto.tenant_id = p_tenant
      and gasto.fecha >= l.desde and gasto.fecha <= l.hasta
    group by l.paso
  ),
  v as (
    select l.paso,
      count(*) as n,
      count(*) filter (where viaje.estatus = 'liquidado') as liquidados
    from limites l
    join viaje on viaje.tenant_id = p_tenant
      and viaje.fecha_inicio >= l.desde and viaje.fecha_inicio <= l.hasta
    group by l.paso
  ),
  liq as (
    select l.paso, round(sum(liquidacion.total_comprobado), 2) as liquidado
    from limites l
    join liquidacion on liquidacion.tenant_id = p_tenant
      and liquidacion.created_at >= (l.desde::timestamp at time zone 'America/Mexico_City')
      and liquidacion.created_at <  ((l.hasta + 1)::timestamp at time zone 'America/Mexico_City')
      and liquidacion.revision <> 'rechazada'
    group by l.paso
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'desde', to_char(l.desde, 'YYYY-MM-DD'),
      'hasta', to_char(l.hasta, 'YYYY-MM-DD'),
      'gastoTotal', coalesce(g.gasto_total, 0),
      'totalViajes', coalesce(v.n, 0),
      'costoPorViaje', case when coalesce(v.n, 0) = 0 then null
        else round(coalesce(g.gasto_total, 0) / v.n, 2) end,
      'liquidado', coalesce(liq.liquidado, 0),
      'viajesLiquidados', coalesce(v.liquidados, 0)
    ) order by l.paso
  ), '[]'::jsonb)
  from limites l
  left join g on g.paso = l.paso
  left join v on v.paso = l.paso
  left join liq on liq.paso = l.paso;
$function$;

revoke all on function public.serie_comparativa_tenant(uuid, integer, integer, date) from public, anon, authenticated;
grant execute on function public.serie_comparativa_tenant(uuid, integer, integer, date) to service_role;
