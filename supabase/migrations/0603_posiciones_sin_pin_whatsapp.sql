-- ═══════════════════════════════════════════════════════════════════════════
-- 0603 — `ultimas_posiciones_tenant` y `peaje_posiciones_ventana` NO cuentan el pin de WhatsApp.
--
-- ── EL PROBLEMA ────────────────────────────────────────────────────────────
-- `posicion` tiene dos escritores (0269): el poller del conector GPS y el pin que el chofer comparte
-- por WhatsApp (`proveedor = 'whatsapp'`). Dos lectores trataban las dos fuentes como una sola:
--
--   · `ultimas_posiciones_tenant` devolvía solo la ÚLTIMA fila de cada unidad. Con un pin más
--     reciente que el último punto del GPS, el tractor salía en el pin: el tablero en vivo lo
--     descartaba en TS (`posicionesDeGps`) y la unidad quedaba «sin posición» aunque el GPS sí la
--     tuviera. Descartar en la aplicación no puede recuperar la fila que la base ya no devolvió.
--   · `peaje_posiciones_ventana` mezclaba pins de WhatsApp con puntos de GPS en la evidencia de la
--     reclamación al proveedor de peaje: un pin mandado a mano desde la caseta contaba como
--     «el tractor estaba ahí».
--
-- ── EL ARREGLO ─────────────────────────────────────────────────────────────
-- La MISMA firma, el MISMO grant y la MISMA forma (sonda lateral de la 0287); solo se agrega
-- `proveedor <> 'whatsapp'` donde se elige la posición. El pin sigue guardándose y lo siguen leyendo
-- quienes lo piden por nombre (la validación de llegadas del Conductor compara contra pin y GPS por
-- separado). Código seguro contra la base sin migrar: la aplicación ya descarta `whatsapp` en TS.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.ultimas_posiciones_tenant(p_tenant uuid)
returns table (
  unidad_id        uuid,
  numero_economico text,
  placas           text,
  estado           text,
  lat              double precision,
  lng              double precision,
  velocidad        double precision,
  medida_en        timestamptz,
  proveedor        text
)
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  select
    u.id,
    u.numero_economico,
    u.placas,
    u.estado,
    p.lat,
    p.lng,
    p.velocidad,
    p.medida_en,
    p.proveedor
  from unidad u
  cross join lateral (
    select p.lat, p.lng, p.velocidad, p.medida_en, p.proveedor
    from posicion p
    where p.tenant_id = u.tenant_id
      and p.unidad_id = u.id
      and p.proveedor <> 'whatsapp'
    order by p.medida_en desc
    limit 1
  ) p
  where u.tenant_id = p_tenant
    and u.activo;
$$;

comment on function public.ultimas_posiciones_tenant(uuid) is
  'La ÚLTIMA posición de GPS de cada unidad ACTIVA de una flota. 0603: excluye proveedor = whatsapp (el pin del chofer no es la ubicación del tractor y, siendo más reciente, tapaba la última posición real). Misma firma y forma que la 0287 (sonda lateral por unidad sobre uq_posicion_lectura). No filtra antigüedad. SECURITY INVOKER; p_tenant sin default (molde 0112).';

revoke all on function public.ultimas_posiciones_tenant(uuid) from public, anon, authenticated;
grant execute on function public.ultimas_posiciones_tenant(uuid) to service_role;

create or replace function public.peaje_posiciones_ventana(p_tenant uuid, p_ventanas jsonb)
returns table (linea_id uuid, lat double precision, lng double precision, medida_en timestamptz)
language sql
stable
set search_path = public, pg_catalog
as $$
  select v.linea_id, p.lat, p.lng, p.medida_en
    from jsonb_to_recordset(p_ventanas) as v(linea_id uuid, unidad_id uuid, desde timestamptz, hasta timestamptz)
    join public.posicion p
      on p.tenant_id = p_tenant
     and p.unidad_id = v.unidad_id
     and p.medida_en between v.desde and v.hasta
     and p.proveedor <> 'whatsapp'
   where jsonb_typeof(p_ventanas) = 'array'
$$;

comment on function public.peaje_posiciones_ventana(uuid, jsonb) is
  'Posiciones de GPS de cada {linea_id, unidad_id, desde, hasta} para el cruce por caseta (0376). 0603: excluye proveedor = whatsapp, para que un pin del chofer no cuente como evidencia de que el tractor cruzó la caseta. Solo devuelve filas; la clasificación vive en el motor puro de la app. SECURITY INVOKER; p_tenant sin default.';

revoke all on function public.peaje_posiciones_ventana(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.peaje_posiciones_ventana(uuid, jsonb) to service_role;
