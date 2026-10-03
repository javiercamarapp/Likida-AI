-- ═══════════════════════════════════════════════════════════════════════════
-- 0687 — las casetas medidas de una ruta (cotizador) resueltas en la base.
--
-- `casetasMedidasPorRuta` (cotizador/lector.ts) leía las liquidaciones de los
-- últimos 366 días con `traerTodo` (offset, 60 páginas con 5,000 viajes al mes),
-- luego los viajes de ESOS ids en tandas de 100 (~600 consultas secuenciales) y
-- luego los gastos de caseta en más tandas: ~700 viajes de red por cotización
-- (ronda 16, carga de 250 camiones; auditoría de traerTodo). Ahora son dos RPC:
--
--   rutas_liquidadas_tenant(tenant, piso)   → los pares (origen, destino) DISTINTOS
--       de viajes liquidados con una liquidación desde `piso`. Pocos cientos de filas.
--       El lector elige en JS cuáles son «la misma ruta» con `normalizarPlaza` (la
--       regla de acentos/mayúsculas vive en un solo sitio) y pide…
--   casetas_medidas_ruta_tenant(tenant, piso, origenes, destinos) → (promedio, viajes):
--       el promedio POR VIAJE de la suma de sus gastos 'caseta', solo viajes con al
--       menos una caseta. Los textos que normalizan igual forman un producto
--       cartesiano cuyos pares también normalizan igual, así que filtrar por
--       origen = any(..) y destino = any(..) es exactamente «la misma ruta».
--
-- SECURITY INVOKER, search_path fijo, solo service_role: molde 0112.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.rutas_liquidadas_tenant(p_tenant uuid, p_piso timestamptz)
returns table (origen text, destino text)
language sql stable parallel safe
set search_path = public, pg_catalog
as $$
  select distinct v.origen, v.destino
    from public.viaje v
   where v.tenant_id = p_tenant and v.estatus = 'liquidado'
     and v.origen is not null and v.destino is not null
     and exists (select 1 from public.liquidacion l
                  where l.viaje_id = v.id and l.tenant_id = p_tenant and l.created_at >= p_piso);
$$;

create or replace function public.casetas_medidas_ruta_tenant(
  p_tenant uuid, p_piso timestamptz, p_origenes text[], p_destinos text[]
) returns table (promedio numeric, viajes bigint)
language sql stable parallel safe
set search_path = public, pg_catalog
as $$
  with v as (
    select v.id from public.viaje v
     where v.tenant_id = p_tenant and v.estatus = 'liquidado'
       and v.origen = any (p_origenes) and v.destino = any (p_destinos)
       and exists (select 1 from public.liquidacion l
                    where l.viaje_id = v.id and l.tenant_id = p_tenant and l.created_at >= p_piso)
  ),
  t as (
    select g.viaje_id, sum(g.monto) as total
      from public.gasto g
     where g.tenant_id = p_tenant and g.concepto = 'caseta' and g.viaje_id in (select id from v)
     group by g.viaje_id
  )
  select round(avg(total), 2), count(*) from t;
$$;

comment on function public.rutas_liquidadas_tenant(uuid, timestamptz) is
  '0687: pares (origen, destino) distintos de los viajes liquidados de UNA flota con liquidación desde p_piso. Alimenta casetasMedidasPorRuta. SECURITY INVOKER; p_tenant sin default.';
comment on function public.casetas_medidas_ruta_tenant(uuid, timestamptz, text[], text[]) is
  '0687: promedio por viaje (y cuántos viajes) de la suma de gastos caseta de los viajes liquidados desde p_piso cuyo origen/destino están en los arreglos. Solo viajes con al menos una caseta. SECURITY INVOKER; p_tenant sin default.';

revoke all on function public.rutas_liquidadas_tenant(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.rutas_liquidadas_tenant(uuid, timestamptz) to service_role;
revoke all on function public.casetas_medidas_ruta_tenant(uuid, timestamptz, text[], text[]) from public, anon, authenticated;
grant execute on function public.casetas_medidas_ruta_tenant(uuid, timestamptz, text[], text[]) to service_role;
