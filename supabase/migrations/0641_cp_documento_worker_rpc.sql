-- ═══════════════════════════════════════════════════════════════════════════
-- 0641 — Carta Porte: las RPC del worker (qué procesar, qué quedó agotado, a quién avisar).
--
-- Solo service_role (el cron). Ninguna reclama el documento: eso lo sigue haciendo `cp_documento_reclamar`
-- (0420) dentro de `procesarDocumento`, con lease y tope de intentos; aquí solo se ELIGE, así que dos
-- corridas solapadas pueden listar lo mismo y gana una al reclamar.
--
--   · cp_documentos_pendientes: recibidos (con una gracia, para no pelear con la petición que acaba de
--     recibirlos), con lease vencido, y fallidos con ESPERA creciente según los intentos (15, 30, 60, 120 min):
--     un 429 o un presupuesto agotado no se reintentan cada 5 minutos. Excluye lo agotado (intentos >= tope)
--     y lo ya purgado.
--   · cp_documentos_agotados: fallidos con los intentos agotados cuya noticia a la oficina no se ha reclamado.
--   · cp_documentos_por_avisar: llegaron por correo, quedaron por revisar con un bloqueo o con confianza baja
--     y no se ha avisado a la oficina.
--   · cp_documento_reclamar_aviso / cp_documento_liberar_aviso: el candado de «una vez por documento y tipo».
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.cp_documentos_pendientes(
  p_limite int default 25, p_max_intentos int default 5, p_gracia_segundos int default 120
) returns table (tenant_id uuid, id uuid, estado text, intentos int)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_limite is null or p_limite < 1 or p_limite > 200 then
    raise exception 'cp_documentos_pendientes: p_limite fuera de rango (1-200)';
  end if;
  if p_max_intentos is null or p_max_intentos < 1 or p_max_intentos > 20 then
    raise exception 'cp_documentos_pendientes: p_max_intentos fuera de rango (1-20)';
  end if;
  if p_gracia_segundos is null or p_gracia_segundos < 0 or p_gracia_segundos > 3600 then
    raise exception 'cp_documentos_pendientes: p_gracia_segundos fuera de rango (0-3600)';
  end if;
  return query
  select d.tenant_id, d.id, d.estado, d.intentos
    from public.cp_documento d
   where d.purgado_en is null
     and d.storage_ruta is not null
     and d.intentos < p_max_intentos
     and (
       (d.estado = 'recibido' and d.created_at < now() - make_interval(secs => p_gracia_segundos))
       or (d.estado = 'procesando' and d.procesando_hasta < now())
       or (d.estado = 'fallido'
           and d.updated_at < now() - make_interval(mins => 15 * (2 ^ greatest(least(d.intentos, 6) - 1, 0))::int))
     )
   order by case d.estado when 'recibido' then 0 when 'procesando' then 1 else 2 end, d.updated_at, d.id
   limit p_limite;
end;
$$;
revoke all on function public.cp_documentos_pendientes(int, int, int) from public, anon, authenticated;
grant execute on function public.cp_documentos_pendientes(int, int, int) to service_role;

create or replace function public.cp_documentos_agotados(
  p_limite int default 25, p_max_intentos int default 5, p_dias int default 7
) returns table (tenant_id uuid, id uuid)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_limite is null or p_limite < 1 or p_limite > 200 then
    raise exception 'cp_documentos_agotados: p_limite fuera de rango (1-200)';
  end if;
  if p_max_intentos is null or p_max_intentos < 1 or p_max_intentos > 20 then
    raise exception 'cp_documentos_agotados: p_max_intentos fuera de rango (1-20)';
  end if;
  if p_dias is null or p_dias < 1 or p_dias > 90 then
    raise exception 'cp_documentos_agotados: p_dias fuera de rango (1-90)';
  end if;
  return query
  select d.tenant_id, d.id
    from public.cp_documento d
   where d.purgado_en is null
     and d.estado = 'fallido'
     and d.intentos >= p_max_intentos
     and not (d.avisos_oficina ? 'agotado')
     and d.updated_at > now() - make_interval(days => p_dias)
   order by d.updated_at, d.id
   limit p_limite;
end;
$$;
revoke all on function public.cp_documentos_agotados(int, int, int) from public, anon, authenticated;
grant execute on function public.cp_documentos_agotados(int, int, int) to service_role;

create or replace function public.cp_documentos_por_avisar(
  p_limite int default 25, p_umbral numeric default 0.85, p_dias int default 3
) returns table (tenant_id uuid, id uuid)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_limite is null or p_limite < 1 or p_limite > 200 then
    raise exception 'cp_documentos_por_avisar: p_limite fuera de rango (1-200)';
  end if;
  if p_umbral is null or p_umbral <= 0 or p_umbral > 1 then
    raise exception 'cp_documentos_por_avisar: p_umbral fuera de rango (0-1]';
  end if;
  if p_dias is null or p_dias < 1 or p_dias > 30 then
    raise exception 'cp_documentos_por_avisar: p_dias fuera de rango (1-30)';
  end if;
  return query
  select d.tenant_id, d.id
    from public.cp_documento d
   where d.purgado_en is null
     and d.estado = 'por_revisar'
     and d.canal = 'correo'
     and not (d.avisos_oficina ? 'hallazgos')
     and d.updated_at > now() - make_interval(days => p_dias)
     and (
       coalesce((d.validacion ->> 'bloqueos')::int, 0) > 0
       or (d.confianza_min is not null and d.confianza_min < p_umbral)
     )
   order by d.updated_at, d.id
   limit p_limite;
end;
$$;
revoke all on function public.cp_documentos_por_avisar(int, numeric, int) from public, anon, authenticated;
grant execute on function public.cp_documentos_por_avisar(int, numeric, int) to service_role;

-- «Avisar a la oficina UNA vez por documento y tipo»: UPDATE condicional. NO toca `version` ni `updated_at`
-- (no provoca un conflicto de edición al revisor ni reinicia la espera del reintento).
create or replace function public.cp_documento_reclamar_aviso(p_tenant uuid, p_id uuid, p_tipo text)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare n int;
begin
  if p_tipo is null or p_tipo not in ('hallazgos', 'agotado') then
    raise exception 'cp_documento_reclamar_aviso: tipo desconocido (%)', p_tipo;
  end if;
  update public.cp_documento d
     set avisos_oficina = d.avisos_oficina || jsonb_build_object(p_tipo, to_jsonb(now()))
   where d.id = p_id and d.tenant_id = p_tenant and not (d.avisos_oficina ? p_tipo);
  get diagnostics n = row_count;
  return n > 0;
end;
$$;
revoke all on function public.cp_documento_reclamar_aviso(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.cp_documento_reclamar_aviso(uuid, uuid, text) to service_role;

-- Suelta el candado cuando el aviso NO salió y no quedó en la cola de WhatsApp (rechazo definitivo): se puede
-- reintentar. Un rechazo reintentable NO se suelta: ya está en `wa_outbox`, que lo entrega.
create or replace function public.cp_documento_liberar_aviso(p_tenant uuid, p_id uuid, p_tipo text)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare n int;
begin
  if p_tipo is null or p_tipo not in ('hallazgos', 'agotado') then
    raise exception 'cp_documento_liberar_aviso: tipo desconocido (%)', p_tipo;
  end if;
  update public.cp_documento d
     set avisos_oficina = d.avisos_oficina - p_tipo
   where d.id = p_id and d.tenant_id = p_tenant and d.avisos_oficina ? p_tipo;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;
revoke all on function public.cp_documento_liberar_aviso(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.cp_documento_liberar_aviso(uuid, uuid, text) to service_role;
