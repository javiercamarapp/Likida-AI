-- ═══════════════════════════════════════════════════════════════════════════
-- 0685 — anomalias_gasto_tenant sin leer ni ordenar TODO el historial dos veces.
--
-- Medido (ronda 16, 240,000 gastos de una flota de 250 camiones): 3.4 s p50 /
-- 5.9 s p95 por carga del Resumen. El plan materializaba `filas` (240k filas
-- con 6 expresiones) y la ordenaba dos veces en disco (external merge) para
-- agrupar. Misma regla, mismo jsonb de salida, otra forma:
--
--   · rama cfdi_duplicado: ELIMINADA por imposible. `uq_gasto_cfdi_uuid`
--     (tenant_id, cfdi_uuid, cfdi_orden) es UNIQUE y la CHECK de minúsculas
--     garantiza que `nullif(lower(uuid),'')` no cambia nada, así que un mismo
--     (uuid, orden) NO puede estar en dos viajes de la misma flota: la rama
--     devolvía siempre vacío y costaba 120k lecturas con ordenamiento.
--   · rama folio_duplicado: lee solo `gasto_folio_sin_cfdi_idx` (0684), un
--     índice parcial que trae el folio/concepto/monto ya ordenados.
--
-- Firma, SECURITY INVOKER, revoke/grant: iguales a la 0244.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.anomalias_gasto_tenant(p_tenant uuid)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  with folio_repetidos as (
    select concepto, folio, monto
      from gasto
     where tenant_id = p_tenant and folio is not null and folio <> '' and (cfdi_uuid is null or cfdi_uuid = '')
     group by concepto, folio, monto
    having min(viaje_id::text) <> max(viaje_id::text)
  ),
  folio_grupos as (
    select lower(coalesce(r.concepto, 'otro')) as concepto, r.folio, r.monto as monto_llave,
      count(distinct g.viaje_id) as n_viajes,
      (array_agg(g.monto order by g.id))[1] as monto,
      (array_agg(g.id order by g.id))[1] as primer_id
    from folio_repetidos r
    join gasto g on g.tenant_id = p_tenant and g.concepto = r.concepto and g.folio = r.folio and g.monto = r.monto
                and (g.cfdi_uuid is null or g.cfdi_uuid = '')
    group by r.concepto, r.folio, r.monto
  ),
  folio_anomalias as (
    select g.primer_id,
      jsonb_build_object(
        'tipo', 'folio_duplicado',
        'detalle', 'Folio ' || g.folio || ' (' || g.concepto || ') liquidado en ' || g.n_viajes || ' viajes',
        'monto', g.monto,
        'viajes', (
          select jsonb_agg(v.viaje_id order by v.primer)
          from (
            select f.viaje_id, min(f.id::text) as primer
            from gasto f
            where f.tenant_id = p_tenant and f.folio = g.folio and f.concepto = g.concepto
              and f.monto = g.monto_llave and (f.cfdi_uuid is null or f.cfdi_uuid = '')
            group by f.viaje_id
          ) v
        )
      ) as anomalia
    from folio_grupos g
    where not exists (
      select 1 from gasto u where u.tenant_id = p_tenant and u.cfdi_uuid = lower(g.folio)
    )
  )
  select coalesce(jsonb_agg(anomalia order by primer_id), '[]'::jsonb) from folio_anomalias;
$$;

comment on function public.anomalias_gasto_tenant(uuid) is
  'Comprobantes repetidos ENTRE viajes de UNA flota (cfdi_duplicado por (uuid, orden); folio_duplicado por (concepto, folio, monto) sin uuid), jsonb array [{tipo, detalle, monto, viajes}]. 0244: descarte de folio que es UUID conocido por igualdad contra uq_gasto_cfdi_uuid. 0685: sin materializar ni ordenar el historial (rama cfdi_duplicado retirada por imposible bajo uq_gasto_cfdi_uuid; folio_duplicado sobre gasto_folio_sin_cfdi_idx). SECURITY INVOKER; p_tenant sin default.';

revoke all on function public.anomalias_gasto_tenant(uuid) from public, anon, authenticated;
grant execute on function public.anomalias_gasto_tenant(uuid) to service_role;
