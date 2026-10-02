-- ═══════════════════════════════════════════════════════════════════════════
-- 0605 — `presencia_en_sitios` y `posiciones_por_unidad_dia` NO cuentan el pin de WhatsApp.
--
-- Corrige lo que la 0603 dejó sin tocar (hallazgos de la revisión adversarial de la ronda 06).
-- `posicion` tiene dos escritores (0269): el poller del GPS y el pin que el chofer elige a mano por
-- WhatsApp (`proveedor = 'whatsapp'`, cualquier punto del mapa).
--
--   · `presencia_en_sitios` (0207) toma la PRIMERA y la ÚLTIMA posición dentro del radio del sitio; esas
--     dos marcas son la estadía medida que se le cobra al cliente. Un pin dentro del radio, mandado horas
--     después del último punto de GPS, alargaba la estadía sin que el tractor estuviera allí.
--   · `posiciones_por_unidad_dia` (0205) cuenta «posiciones GPS» por unidad y día como evidencia del
--     conciliador de peajes; con un solo pin, un día sin GPS salía «con evidencia».
--
-- Misma firma, mismo grant y misma forma; solo se agrega `proveedor <> 'whatsapp'`. El pin sigue
-- guardándose y lo siguen leyendo quienes lo piden por nombre.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.presencia_en_sitios(
  p_tenant uuid,
  p_items  jsonb
) returns table (viaje_id uuid, primera timestamptz, ultima timestamptz, n bigint)
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  select
    i.viaje_id,
    min(p.medida_en) as primera,
    max(p.medida_en) as ultima,
    count(*)         as n
  from jsonb_to_recordset(p_items) as i(
    viaje_id  uuid,
    unidad_id uuid,
    desde     timestamptz,
    hasta     timestamptz,
    lat       double precision,
    lng       double precision,
    radio_m   int
  )
  join posicion p
    on p.tenant_id = p_tenant
   and p.unidad_id = i.unidad_id
   and p.medida_en >= i.desde
   and p.medida_en <= i.hasta
   and p.proveedor <> 'whatsapp'
  where 2 * 6371000 * asin(sqrt(
          power(sin(radians(p.lat - i.lat) / 2), 2)
          + cos(radians(i.lat)) * cos(radians(p.lat))
            * power(sin(radians(p.lng - i.lng) / 2), 2)
        )) <= i.radio_m
  group by i.viaje_id
$$;

comment on function public.presencia_en_sitios(uuid, jsonb) is
  'Primera/última posición de GPS y conteo DENTRO del radio del sitio por episodio de estadía (0207). 0605: excluye proveedor = whatsapp (el pin del chofer no es la posición del tractor y alargaba la estadía cobrada). Solo mide — la clasificación vive en el motor puro (estadias/motor.ts). SECURITY INVOKER; p_tenant sin default.';

revoke all on function public.presencia_en_sitios(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.presencia_en_sitios(uuid, jsonb) to service_role;

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
      and p.proveedor <> 'whatsapp'
      and p.medida_en >= (p_desde - 1)::timestamptz
      and p.medida_en <  (p_hasta + 2)::timestamptz
  ) s
  where s.dia between p_desde and p_hasta
  group by s.unidad_id, s.dia
$$;

comment on function public.posiciones_por_unidad_dia(uuid, uuid[], date, date) is
  'Conteo de posiciones GPS por unidad y DÍA DE MÉXICO dentro de un rango, para la evidencia GPS del conciliador de peajes (0205). 0605: excluye proveedor = whatsapp (un pin del chofer no es evidencia GPS). Solo cuenta — la clasificación vive en el motor puro (peajes/evidencia_gps.ts). SECURITY INVOKER; p_tenant sin default.';

revoke all on function public.posiciones_por_unidad_dia(uuid, uuid[], date, date) from public, anon, authenticated;
grant execute on function public.posiciones_por_unidad_dia(uuid, uuid[], date, date) to service_role;
