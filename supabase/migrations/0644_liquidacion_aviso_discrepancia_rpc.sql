-- ═══════════════════════════════════════════════════════════════════════════
-- 0644 — Liquidación externa: «No coincide» ATÓMICO y el aviso de discrepancia con reclamo y reintento.
--
-- Antes, apretar dos veces «No coincide» (o dos entregas del mismo botón de WhatsApp) pasaba el chequeo «ya estaba
-- acusada con ese tipo» en las dos invocaciones y mandaba el aviso dos veces. Aquí la transición es UNA sentencia
-- condicional (`acuse_tipo is distinct from 'no_coincide'`) que, en la misma transacción, deja el aviso `pendiente`:
-- quien la gana es el único que lo crea, y el acuse y su aviso nacen juntos o ninguno (si el proceso muere después, el
-- cron lo levanta de la fila).
--
--   registrar_acuse_no_coincide   → ciclo nuevo si ESTA llamada hizo la transición; NULL si ya era «No coincide», si la
--                                    liquidación no es de ese operador/flota o no existe;
--   reclamar_aviso_discrepancia   → token si le toca mandar (pendiente y vencido su reintento, o `enviando` con arriendo
--                                    vencido); NULL si no;
--   cerrar_aviso_discrepancia     → solo cierra quien conserva el token vigente; devuelve el estado resultante;
--   rearmar_aviso_discrepancia    → el botón «Reavisar»: devuelve el aviso fallido o pendiente a pendiente-ya (conserva a quién
--                                    ya le llegó); NULL si ya salió, si lo está mandando alguien o la liquidación no está en
--                                    «No coincide». Sin fila previa (acuse anterior a la 0643) la crea.
--
-- Todas security definer, search_path vacío, solo service_role. El código funciona sin esta migración.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.registrar_acuse_no_coincide(
  p_tenant uuid, p_liquidacion uuid, p_operador uuid, p_ahora timestamptz default clock_timestamp()
) returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_ciclo integer;
begin
  update public.liquidacion_externa
     set estado = 'acusada', acuse_tipo = 'no_coincide', acuse_en = p_ahora, acuse_confirmado_en = null, updated_at = p_ahora
   where id = p_liquidacion and tenant_id = p_tenant and operador_id = p_operador
     and acuse_tipo is distinct from 'no_coincide';
  if not found then return null; end if;
  select coalesce(max(a.ciclo), 0) + 1 into v_ciclo
    from public.liquidacion_aviso_discrepancia a where a.liquidacion_externa_id = p_liquidacion;
  insert into public.liquidacion_aviso_discrepancia (liquidacion_externa_id, tenant_id, ciclo, estado, proximo_intento_en)
  values (p_liquidacion, p_tenant, v_ciclo, 'pendiente', p_ahora);
  return v_ciclo;
end;
$$;
revoke all on function public.registrar_acuse_no_coincide(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.registrar_acuse_no_coincide(uuid, uuid, uuid, timestamptz) to service_role;

create or replace function public.reclamar_aviso_discrepancia(
  p_tenant uuid, p_liquidacion uuid, p_ciclo integer,
  p_ahora timestamptz default clock_timestamp(), p_lease_segundos integer default 300
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_token uuid;
begin
  if p_lease_segundos < 30 or p_lease_segundos > 900 then raise exception 'lease fuera de 30..900'; end if;
  update public.liquidacion_aviso_discrepancia a
     set estado = 'enviando', claim_token = gen_random_uuid(), claim_expira_en = p_ahora + make_interval(secs => p_lease_segundos),
         actualizado_en = p_ahora
   where a.liquidacion_externa_id = p_liquidacion and a.tenant_id = p_tenant and a.ciclo = p_ciclo
     and ((a.estado = 'pendiente' and a.proximo_intento_en <= p_ahora)
          or (a.estado = 'enviando' and a.claim_expira_en <= p_ahora))
  returning a.claim_token into v_token;
  return v_token;
end;
$$;
revoke all on function public.reclamar_aviso_discrepancia(uuid, uuid, integer, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.reclamar_aviso_discrepancia(uuid, uuid, integer, timestamptz, integer) to service_role;

-- p_resultado: 'enviado' (llegó a todos los destinatarios), 'reintentar' (faltan; cuenta intento y, al llegar a
-- p_max_intentos, queda fallido) o 'fallido' (no hay nada más que intentar). p_aceptados se SUMA a lo ya aceptado.
create or replace function public.cerrar_aviso_discrepancia(
  p_tenant uuid, p_liquidacion uuid, p_ciclo integer, p_claim uuid, p_resultado text,
  p_aceptados text[] default '{}', p_error text default null, p_proximo timestamptz default null,
  p_max_intentos integer default 5, p_ahora timestamptz default clock_timestamp()
) returns text
language plpgsql security definer set search_path = ''
as $$
declare v_estado text;
begin
  if p_resultado not in ('enviado', 'reintentar', 'fallido') then raise exception 'resultado inválido' using errcode = '22023'; end if;
  update public.liquidacion_aviso_discrepancia a
     set telefonos_aceptados = (select coalesce(array_agg(distinct t order by t), '{}')
                                  from unnest(a.telefonos_aceptados || coalesce(p_aceptados, '{}')) as t),
         ultimo_error = case when p_resultado = 'enviado' then null else left(p_error, 500) end,
         intentos = case when p_resultado = 'reintentar' then a.intentos + 1 else a.intentos end,
         estado = case
           when p_resultado = 'enviado' then 'enviado'
           when p_resultado = 'reintentar' and a.intentos + 1 < p_max_intentos then 'pendiente'
           else 'fallido' end,
         proximo_intento_en = case when p_resultado = 'reintentar' and a.intentos + 1 < p_max_intentos
                                   then coalesce(p_proximo, p_ahora) else a.proximo_intento_en end,
         enviado_en = case when p_resultado = 'enviado' then p_ahora else null end,
         claim_token = null, claim_expira_en = null, actualizado_en = p_ahora
   where a.liquidacion_externa_id = p_liquidacion and a.tenant_id = p_tenant and a.ciclo = p_ciclo
     and a.estado = 'enviando' and a.claim_token = p_claim
  returning a.estado into v_estado;
  return v_estado;
end;
$$;
revoke all on function public.cerrar_aviso_discrepancia(uuid, uuid, integer, uuid, text, text[], text, timestamptz, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.cerrar_aviso_discrepancia(uuid, uuid, integer, uuid, text, text[], text, timestamptz, integer, timestamptz) to service_role;

create or replace function public.rearmar_aviso_discrepancia(
  p_tenant uuid, p_liquidacion uuid, p_ahora timestamptz default clock_timestamp()
) returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_ciclo integer; v_estado text;
begin
  if not exists (select 1 from public.liquidacion_externa l
                  where l.id = p_liquidacion and l.tenant_id = p_tenant and l.acuse_tipo = 'no_coincide') then
    return null;
  end if;
  select a.ciclo, a.estado into v_ciclo, v_estado
    from public.liquidacion_aviso_discrepancia a
   where a.liquidacion_externa_id = p_liquidacion and a.tenant_id = p_tenant
   order by a.ciclo desc limit 1 for update;
  if v_ciclo is null then
    insert into public.liquidacion_aviso_discrepancia (liquidacion_externa_id, tenant_id, ciclo, estado, proximo_intento_en)
    values (p_liquidacion, p_tenant, 1, 'pendiente', p_ahora);
    return 1;
  end if;
  if v_estado not in ('pendiente', 'fallido') then return null; end if;
  update public.liquidacion_aviso_discrepancia
     set estado = 'pendiente', intentos = 0, proximo_intento_en = p_ahora, ultimo_error = null, actualizado_en = p_ahora
   where liquidacion_externa_id = p_liquidacion and tenant_id = p_tenant and ciclo = v_ciclo;
  return v_ciclo;
end;
$$;
revoke all on function public.rearmar_aviso_discrepancia(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.rearmar_aviso_discrepancia(uuid, uuid, timestamptz) to service_role;
