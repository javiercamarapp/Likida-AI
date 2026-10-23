-- ═══════════════════════════════════════════════════════════════════════════
-- 0856 — PEAJES: un archivo que nunca termina deja de atascar la cola
-- (auditoría 35, hallazgo A35-R12-rendimiento-01, ALTO, confirmado).
--
-- EL DEFECTO. `peaje_archivo_reclamar` (0376) re-reclamaba sin límite todo
-- archivo `procesando` con el lease vencido y sumaba `intentos = intentos + 1`
-- sin tope. El tope MAX_INTENTOS vive solo en el `catch` de `procesarColaPeajes`,
-- que NO corre cuando Vercel mata la función a los 120 s (el cruce de un
-- desglose de decenas de miles de líneas puede tardar más). Resultado: el mismo
-- archivo se reclamaba cada 5 min para siempre, iba siempre primero en el lote
-- (orden por proximo_intento_en, recibida_en) y consumía la ventana de la
-- corrida; la purga de 30 días (0562) solo vacía `fallida`, nunca lo cerraba.
--
-- EL ARREGLO (aditivo, sin cambiar ninguna firma que el código desplegado llama).
--   (a) `peaje_archivo_reclamar(int, int)` conserva firma y columnas. Cambia solo
--       su comportamiento seguro: la rama «procesando con lease vencido» exige
--       `intentos < 3`. Un archivo que ya murió 3 veces a mitad de proceso NO se
--       vuelve a entregar. La rama «pendiente» (reintento con backoff por fallo
--       de infraestructura, tope MAX_INTENTOS=5 en el código) no se toca.
--   (b) `peaje_archivo_barrer_vencidos(p_max_intentos, p_gracia_minutos)` (NUEVA)
--       manda a `fallida`, con motivo legible en `ultimo_error`, los `procesando`
--       con lease vencido que (i) ya llegaron al tope de intentos o (ii) llevan
--       más de `p_gracia_minutos` vencidos (red de seguridad: nadie los tomó).
--       Conserva `contenido` para reprocesar desde el panel. DEVUELVE las filas
--       barridas para que el cron avise (bitácora del agente) — no es silencioso.
--
-- COMPATIBILIDAD. Código viejo + migración: el claim sigue devolviendo las
-- mismas columnas; solo deja de entregar archivos agotados. Código nuevo sin
-- migración: la RPC de barrido no existe y el cron lo dice (log + latido
-- `parcial`) en vez de caerse.
--
-- REVERSA (SQL exacto; vuelve al claim de la 0376 y quita el barrido):
--   drop function if exists public.peaje_archivo_barrer_vencidos(int, int);
--   create or replace function public.peaje_archivo_reclamar(p_limite int default 5, p_lease_segundos int default 300)
--   returns table (id uuid, tenant_id uuid, nombre text, proveedor text, intentos int, reclamo uuid, desglose_id uuid)
--   language plpgsql security invoker set search_path = public, pg_temp
--   as $f$
--   declare v_reclamo uuid := gen_random_uuid();
--   begin
--     if p_limite is null or p_limite < 1 or p_limite > 50 then
--       raise exception 'peaje_archivo_reclamar: p_limite fuera de rango (1-50)';
--     end if;
--     if p_lease_segundos is null or p_lease_segundos < 30 or p_lease_segundos > 3600 then
--       raise exception 'peaje_archivo_reclamar: p_lease_segundos fuera de rango (30-3600)';
--     end if;
--     return query
--     with elegibles as (
--       select a.id from public.peaje_ingesta_archivo a
--        where a.contenido is not null
--          and ((a.estado = 'pendiente' and a.proximo_intento_en <= now())
--            or (a.estado = 'procesando' and a.reclamado_hasta is not null and a.reclamado_hasta < now()))
--        order by a.proximo_intento_en, a.recibida_en limit p_limite for update skip locked)
--     update public.peaje_ingesta_archivo a
--        set estado = 'procesando', reclamo = v_reclamo,
--            reclamado_hasta = now() + make_interval(secs => p_lease_segundos), intentos = a.intentos + 1
--       from elegibles e where a.id = e.id
--     returning a.id, a.tenant_id, a.nombre, a.proveedor, a.intentos, a.reclamo, a.desglose_id;
--   end;
--   $f$;
--   (los archivos ya mandados a `fallida` por el barrido se quedan así: se
--    reprocesan con reintentarArchivoPeaje; la reversa no los resucita.)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── (a) El claim: mismo contrato, con tope para los lease vencidos ──────────
create or replace function public.peaje_archivo_reclamar(p_limite int default 5, p_lease_segundos int default 300)
returns table (id uuid, tenant_id uuid, nombre text, proveedor text, intentos int, reclamo uuid, desglose_id uuid)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_reclamo uuid := gen_random_uuid();
  -- Veces que un archivo puede morir a mitad de proceso (lease vencido) antes
  -- de dejar de entregarse. Mismo número que el default de
  -- peaje_archivo_barrer_vencidos: si cambia, cambia en ambos.
  c_max_vencidos constant int := 3;
begin
  if p_limite is null or p_limite < 1 or p_limite > 50 then
    raise exception 'peaje_archivo_reclamar: p_limite fuera de rango (1-50)';
  end if;
  if p_lease_segundos is null or p_lease_segundos < 30 or p_lease_segundos > 3600 then
    raise exception 'peaje_archivo_reclamar: p_lease_segundos fuera de rango (30-3600)';
  end if;

  return query
  with elegibles as (
    select a.id
      from public.peaje_ingesta_archivo a
     where a.contenido is not null
       and (
         -- Pendiente y ya le toca…
         (a.estado = 'pendiente' and a.proximo_intento_en <= now())
         -- …o un worker lo tomó y murió (lease vencido), pero NO si ya murió
         -- c_max_vencidos veces: ese lo cierra el barrido como `fallida`.
         or (a.estado = 'procesando' and a.reclamado_hasta is not null and a.reclamado_hasta < now()
             and a.intentos < c_max_vencidos)
       )
     order by a.proximo_intento_en, a.recibida_en
     limit p_limite
       for update skip locked
  )
  update public.peaje_ingesta_archivo a
     set estado = 'procesando',
         reclamo = v_reclamo,
         reclamado_hasta = now() + make_interval(secs => p_lease_segundos),
         intentos = a.intentos + 1
    from elegibles e
   where a.id = e.id
  returning a.id, a.tenant_id, a.nombre, a.proveedor, a.intentos, a.reclamo, a.desglose_id;
end;
$$;
comment on function public.peaje_archivo_reclamar(int, int) is
  'Claim anti-duplicado del cron de peajes (0376, tope 0856): toma hasta p_limite archivos pendientes (o con lease vencido y menos de 3 intentos) con FOR UPDATE SKIP LOCKED y los marca procesando con un token. SECURITY INVOKER: solo service_role.';
revoke all on function public.peaje_archivo_reclamar(int, int) from public, anon, authenticated;
grant execute on function public.peaje_archivo_reclamar(int, int) to service_role;

-- ── (b) El barrido de procesando vencidos ───────────────────────────────────
create or replace function public.peaje_archivo_barrer_vencidos(p_max_intentos int default 3, p_gracia_minutos int default 60)
returns table (id uuid, tenant_id uuid, nombre text, intentos int, motivo text)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_max_intentos is null or p_max_intentos < 1 or p_max_intentos > 20 then
    raise exception 'peaje_archivo_barrer_vencidos: p_max_intentos fuera de rango (1-20)';
  end if;
  if p_gracia_minutos is null or p_gracia_minutos < 5 or p_gracia_minutos > 1440 then
    raise exception 'peaje_archivo_barrer_vencidos: p_gracia_minutos fuera de rango (5-1440)';
  end if;

  return query
  with vencidos as (
    select a.id
      from public.peaje_ingesta_archivo a
     where a.estado = 'procesando'
       and a.reclamado_hasta is not null
       and a.reclamado_hasta < now()
       and (a.intentos >= p_max_intentos
            or a.reclamado_hasta < now() - make_interval(mins => p_gracia_minutos))
     order by a.recibida_en
       for update skip locked
  )
  update public.peaje_ingesta_archivo a
     set estado = 'fallida',
         reclamo = null,
         reclamado_hasta = null,
         ultimo_error = left(
           case when a.intentos >= p_max_intentos
             then 'El proceso se interrumpió ' || a.intentos || ' veces sin terminar (probablemente el archivo es demasiado grande para la ventana de ejecución). Se detuvo para no atascar la cola; el contenido se conserva: reprocésalo desde el panel o divídelo en archivos más chicos.'
             else 'Quedó «procesando» más de ' || p_gracia_minutos || ' minutos sin latido y nadie lo retomó. Se detuvo para no atascar la cola; el contenido se conserva: reprocésalo desde el panel.'
           end, 1000)
    from vencidos v
   where a.id = v.id
  returning a.id, a.tenant_id, a.nombre, a.intentos, a.ultimo_error;
end;
$$;
comment on function public.peaje_archivo_barrer_vencidos(int, int) is
  'Barrido de la cola de peajes (0856): manda a fallida (con motivo legible, conservando el contenido) los archivos procesando con lease vencido que agotaron p_max_intentos o llevan más de p_gracia_minutos vencidos. Devuelve lo barrido para que el cron avise. SECURITY INVOKER: solo service_role.';
revoke all on function public.peaje_archivo_barrer_vencidos(int, int) from public, anon, authenticated;
grant execute on function public.peaje_archivo_barrer_vencidos(int, int) to service_role;
