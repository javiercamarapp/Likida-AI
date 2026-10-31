-- REVERSA: reponer `rentabilidad_tenant` con el cuerpo de la 0928 (`create or replace function public.rentabilidad_tenant(p_tenant uuid, p_desde timestamptz default null) returns jsonb language sql stable parallel safe set search_path = public, pg_catalog as $$ with costo_por_viaje as (select l.viaje_id, sum(l.total_comprobado) as costo from liquidacion l where l.tenant_id = p_tenant and l.revision <> 'rechazada' group by l.viaje_id), medidos as (select v.ingreso_flete, c.costo from viaje v join costo_por_viaje c on c.viaje_id = v.id where v.tenant_id = p_tenant and (p_desde is null or v.created_at >= p_desde)), agregado as (select count(*) filter (where ingreso_flete is not null) as con_ingreso, count(*) filter (where ingreso_flete is null) as sin_ingreso, coalesce(sum(ingreso_flete), 0) as ingreso, coalesce(sum(costo), 0) as costo from medidos), sin_liquidar as (select count(*) as n from viaje v where v.tenant_id = p_tenant and (p_desde is null or v.created_at >= p_desde) and not exists (select 1 from costo_por_viaje c where c.viaje_id = v.id)) select jsonb_build_object('ingreso', a.ingreso, 'viajesConIngreso', a.con_ingreso, 'viajesSinIngreso', a.sin_ingreso, 'costoComprobado', a.costo, 'viajesSinLiquidar', s.n) from agregado a, sin_liquidar s; $$;` y repetir `revoke all ... from public, anon, authenticated; grant execute ... to service_role`). Sin datos que reponer; solo cambia el universo del costo.
-- ═══════════════════════════════════════════════════════════════════════════
-- 0931 — AUDITORÍA 39, OLA 9 (residuo de la 0928).
--
-- A39-S20-01 (residuo, MEDIO): la 0928 midió el universo «viajes con liquidación
-- vigente», pero el COSTO sumaba también las liquidaciones de los viajes SIN
-- `ingreso_flete`, cuyo ingreso (NULL) no suma: el margen quedaba subestimado
-- (costo sin ingreso). Ahora el costo sale solo de los viajes que tienen
-- ingreso_flete: el MISMO universo que el ingreso. Los viajes con liquidación
-- vigente pero sin ingreso se siguen contando en `viajesSinIngreso` (la pantalla
-- dice que «quedan fuera de esta medición»; ahora es literalmente cierto) y su
-- costo no entra al margen. Mismas claves de siempre; idempotente (create or
-- replace); security invoker, search_path fijo y permisos como la 0928.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.rentabilidad_tenant(
  p_tenant uuid,
  p_desde timestamptz default null
)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  with costo_por_viaje as (
    -- Lo comprobado por viaje, solo de liquidaciones NO rechazadas (0348).
    select l.viaje_id, sum(l.total_comprobado) as costo
      from liquidacion l
     where l.tenant_id = p_tenant
       and l.revision <> 'rechazada'
     group by l.viaje_id
  ),
  medidos as (
    -- El universo: viajes del periodo CON liquidación vigente. El costo solo cuenta si el viaje trae ingreso_flete
    -- (A39-S20-01, 0931): un costo sin su ingreso subestimaría el margen.
    select v.ingreso_flete,
           case when v.ingreso_flete is not null then c.costo else 0 end as costo
      from viaje v
      join costo_por_viaje c on c.viaje_id = v.id
     where v.tenant_id = p_tenant
       and (p_desde is null or v.created_at >= p_desde)
  ),
  agregado as (
    select count(*) filter (where ingreso_flete is not null) as con_ingreso,
           count(*) filter (where ingreso_flete is null)     as sin_ingreso,
           coalesce(sum(ingreso_flete), 0)                   as ingreso,
           coalesce(sum(costo), 0)                           as costo
      from medidos
  ),
  sin_liquidar as (
    select count(*) as n
      from viaje v
     where v.tenant_id = p_tenant
       and (p_desde is null or v.created_at >= p_desde)
       and not exists (select 1 from costo_por_viaje c where c.viaje_id = v.id)
  )
  select jsonb_build_object(
    'ingreso',           a.ingreso,
    'viajesConIngreso',  a.con_ingreso,
    'viajesSinIngreso',  a.sin_ingreso,
    'costoComprobado',   a.costo,
    'viajesSinLiquidar', s.n
  )
  from agregado a, sin_liquidar s;
$$;

comment on function public.rentabilidad_tenant(uuid, timestamptz) is
  'Rentabilidad agregada de UNA flota en jsonb (A39-S20-01, 0928+0931): ingreso, viajesConIngreso, viajesSinIngreso (NULL no es 0) y costoComprobado salen del MISMO universo: los viajes del periodo (viaje.created_at) con al menos una liquidación no rechazada Y con ingreso_flete; el costo de un viaje sin ingreso no entra al margen (se cuenta en viajesSinIngreso). viajesSinLiquidar cuenta los viajes del periodo sin liquidación vigente. p_desde null = histórico. SECURITY INVOKER; p_tenant sin default.';

revoke all on function public.rentabilidad_tenant(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.rentabilidad_tenant(uuid, timestamptz) to service_role;
