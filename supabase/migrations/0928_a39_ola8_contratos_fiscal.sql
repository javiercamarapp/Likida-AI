-- REVERSA: `drop table if exists public.sat_paquete_xml;` y reponer `rentabilidad_tenant` con el cuerpo de la 0348 (`create or replace function public.rentabilidad_tenant(p_tenant uuid, p_desde timestamptz default null) returns jsonb language sql stable parallel safe set search_path = public, pg_catalog as $$ with v as (select count(*) filter (where ingreso_flete is not null) as con_ingreso, count(*) filter (where ingreso_flete is null) as sin_ingreso, coalesce(sum(ingreso_flete), 0) as ingreso from viaje where tenant_id = p_tenant and (p_desde is null or created_at >= p_desde)), l as (select coalesce(sum(total_comprobado), 0) as costo from liquidacion where tenant_id = p_tenant and (p_desde is null or created_at >= p_desde) and revision <> 'rechazada') select jsonb_build_object('ingreso', v.ingreso, 'viajesConIngreso', v.con_ingreso, 'viajesSinIngreso', v.sin_ingreso, 'costoComprobado', l.costo) from v, l; $$;`). La tabla solo guarda copias temporales de XML que el SAT dejó bajar; sin ella el ciclo vuelve a pedir el paquete al proveedor (como antes).
-- ═══════════════════════════════════════════════════════════════════════════
-- 0928 — AUDITORÍA 39, OLA 8, lote O8-4-contratos-fiscal.
--
-- A39-S57-03 (ALTO): el paquete del SAT se puede bajar DOS veces y a la tercera
-- el proveedor lo RECHAZA. Un paquete con miles de CFDI no cabe en una pasada
-- del cron (≈311 CFDI en los 280 s), así que la corrida siguiente lo re-descargaba
-- y la tercera ya no podía: el paquete (y su rango) quedaban sin terminar para
-- siempre. `sat_paquete_xml` guarda los XML del paquete cuando una pasada NO
-- alcanzó a ingerirlo entero (los paquetes que sí caben no escriben nada), y
-- las pasadas siguientes los leen de aquí SIN volver a llamar al proveedor; al
-- terminar de ingerirlo se borran. Es un cache de trabajo: aditiva, sin datos
-- que reponer.
--
-- A39-S20-01 (ALTO): `rentabilidad_tenant` sumaba el ingreso de TODOS los viajes
-- del periodo contra el costo de las liquidaciones (otro universo, y otro
-- filtro de fecha): los viajes abiertos o sin liquidación vigente inflaban el
-- margen. Ahora ingreso y costo salen del MISMO universo: los viajes del
-- periodo (por `viaje.created_at`) que tienen al menos una liquidación no
-- rechazada, y el costo es el de ESAS liquidaciones. Los viajes sin
-- liquidación vigente se cuentan aparte (`viajesSinLiquidar`, clave nueva y
-- opcional: el código la tolera ausente). Mismas claves de siempre; compatible
-- hacia atrás. Idempotente (create or replace / if not exists).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. A39-S57-03 · los XML de un paquete grande, para no re-descargarlo ───
create table if not exists public.sat_paquete_xml (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  solicitud_id uuid not null,
  paquete      text not null,
  indice       integer not null,
  -- Cuántos XML tiene el paquete COMPLETO: una copia a medias (la escritura se cortó) se descarta al leerla.
  total        integer not null,
  xml          text not null,
  creado_en    timestamptz not null default now(),
  constraint sat_paquete_xml_indice_sano check (indice >= 0 and total > indice),
  constraint sat_paquete_xml_posicion_key unique (solicitud_id, paquete, indice),
  -- Misma llave compuesta que `sat_cfdi_descargado` (0231): el paquete es de la
  -- flota de su solicitud. `cascade`: si se borra la solicitud, su cache sobra.
  constraint sat_paquete_xml_solicitud_tenant_fkey
    foreign key (solicitud_id, tenant_id)
    references public.sat_descarga_solicitud (id, tenant_id) on delete cascade
);

comment on table public.sat_paquete_xml is
  'Cache de trabajo (A39-S57-03): los XML de un paquete grande del SAT, guardados al bajarlo para que las pasadas siguientes del cron lo ingieran SIN volver a llamar al proveedor (el SAT deja bajar un paquete 2 veces y a la tercera lo rechaza). Se borra al terminar de ingerir el paquete. No es fuente de nada: el comprobante vive en cfdi_xml/sat_cfdi_descargado.';

alter table public.sat_paquete_xml enable row level security;
revoke all on table public.sat_paquete_xml from public, anon, authenticated;
grant select, insert, update, delete on table public.sat_paquete_xml to service_role;

-- ── 2. A39-S20-01 · ingreso y costo del MISMO universo ─────────────────────
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
    -- El universo: viajes del periodo CON liquidación vigente. Ingreso y costo salen de aquí.
    select v.ingreso_flete, c.costo
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
  'Rentabilidad agregada de UNA flota en jsonb (A39-S20-01): ingreso, viajesConIngreso, viajesSinIngreso (NULL no es 0) y costoComprobado salen del MISMO universo: los viajes del periodo (viaje.created_at) con al menos una liquidación no rechazada, y el costo es el de esas liquidaciones. viajesSinLiquidar cuenta los viajes del periodo que quedan fuera por no tener liquidación vigente. p_desde null = histórico. SECURITY INVOKER; p_tenant sin default.';

revoke all on function public.rentabilidad_tenant(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.rentabilidad_tenant(uuid, timestamptz) to service_role;
