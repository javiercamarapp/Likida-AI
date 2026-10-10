-- ═══════════════════════════════════════════════════════════════════════════
-- 0676 — Carta Porte: los documentos `procesando` zombi (M3, ronda 15).
--
-- Un documento `procesando` con `intentos = 5` y el lease vencido quedaba zombi para siempre: ni `cp_documento_reclamar` (0420:
-- `intentos < 5`) ni `cp_documentos_pendientes` (0641) lo toman, y `cp_documentos_agotados` solo mira `fallido`. Cinco leases
-- perdidos (timeout de la función, caída del proceso) lo dejaban sin reintento y sin aviso a la oficina.
--
-- `cp_documentos_cerrar_zombis` lo pasa a `fallido` terminal (con la retención de «cerrado» que le da el llamador, versión +1,
-- sin lease, `ultimo_error` explicativo y un evento «extraccion_fallida»); desde ahí `cp_documentos_agotados` lo ve y la
-- oficina se entera UNA vez, igual que con cualquier documento agotado. El worker la corre antes de avisar.
--
-- Solo service_role. security invoker. Idempotente (create or replace).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.cp_documentos_cerrar_zombis(
  p_limite int default 50, p_max_intentos int default 5, p_retener_hasta timestamptz default null
) returns table (tenant_id uuid, id uuid)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_limite is null or p_limite < 1 or p_limite > 200 then
    raise exception 'cp_documentos_cerrar_zombis: p_limite fuera de rango (1-200)';
  end if;
  if p_max_intentos is null or p_max_intentos < 1 or p_max_intentos > 20 then
    raise exception 'cp_documentos_cerrar_zombis: p_max_intentos fuera de rango (1-20)';
  end if;
  return query
  with zombis as (
    select d.id as zid from public.cp_documento d
     where d.estado = 'procesando' and d.purgado_en is null
       and d.intentos >= p_max_intentos
       and d.procesando_hasta is not null and d.procesando_hasta < now()
     order by d.procesando_hasta, d.id
     limit p_limite
     for update skip locked
  ), cerrados as (
    update public.cp_documento d
       set estado = 'fallido', version = d.version + 1, procesando_hasta = null, updated_at = now(),
           ultimo_error = 'La lectura se interrumpió en cada intento (la función se cortó o se cayó) y se agotaron los intentos. Pide el archivo de nuevo o captura el viaje a mano.',
           retener_hasta = coalesce(p_retener_hasta, d.retener_hasta)
      from zombis z
     where d.id = z.zid
    returning d.tenant_id as tid, d.id as did, d.intentos as intentos
  ), eventos as (
    insert into public.cp_documento_evento (documento_id, tenant_id, tipo, detalle)
    select c.did, c.tid, 'extraccion_fallida', jsonb_build_object('motivo', 'lease_vencido_sin_intentos', 'permanente', true, 'intento', c.intentos)
      from cerrados c
    returning documento_id
  )
  select c.tid, c.did from cerrados c;
end;
$$;
revoke all on function public.cp_documentos_cerrar_zombis(int, int, timestamptz) from public, anon, authenticated;
grant execute on function public.cp_documentos_cerrar_zombis(int, int, timestamptz) to service_role;
