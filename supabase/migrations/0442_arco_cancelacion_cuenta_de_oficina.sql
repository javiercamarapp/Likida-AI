-- ═══════════════════════════════════════════════════════════════════════════
-- 0442 — ARCO DE CANCELACIÓN PARA CUENTAS DE OFICINA (titular que no es operador).
--
-- Auditoría ola 1, #46 (reincidente LEG-A4, cuarta ronda). Un dueño, contador o
-- encargado que escribe PRIVACIDAD / «borrar mi cuenta» por WhatsApp pasa por
-- `resolverCuentaOficina` y no tiene operador: `solicitud_arco` quedaba con
-- operador_id NULL y `ejecutar_arco_cancelacion` la rechazaba con «solicitud sin
-- operador o de otra flota», mientras /privacidad promete «se borran tus datos de
-- cuenta y de acceso». Nada del código borraba una cuenta de oficina.
--
-- Esta migración:
--   1. añade `solicitud_arco.titular_user_id` (FK app_user, on delete set null): el
--      titular cuando NO es operador. `titular_ref` (teléfono) sigue siendo la
--      referencia durable de la solicitud aunque se borre la cuenta.
--   2. `ejecutar_arco_cancelacion_cuenta(tenant, solicitud)`: cancela a ese
--      titular — seudonimiza nombre y correo, quita teléfono y avatar, da de baja
--      la cuenta (activo=false), revoca sus tokens MCP, borra sus conversaciones de
--      WhatsApp, su chat con el analista y su historial del copiloto — y deja la
--      solicitud resuelta con la evidencia de QUÉ tocó y QUÉ se conserva. NO borra
--      el login de Supabase Auth (eso no se puede desde SQL): lo hace
--      `ejecutarCancelacionArco` (TS) justo después, y si falla lo dice.
--      Se niega si es el ÚNICO dueño activo de la flota (la dejaría sin nadie que
--      administre): un humano nombra a otro dueño y repite.
--   3. `ejecutar_arco_cancelacion` (cuerpo 0356 + una rama): sin operador pero con
--      titular_user_id, delega en la función de arriba.
--
-- Lo que se CONSERVA y se dice en la evidencia: bitácora de auditoría (actor y su
-- snapshot de correo: es el rastro de quién hizo qué, no se reescribe), y la
-- documentación fiscal (CFF art. 30), que nunca estuvo ligada al correo.
-- ═══════════════════════════════════════════════════════════════════════════
begin;

alter table public.solicitud_arco
  add column if not exists titular_user_id uuid references public.app_user(id) on delete set null;

create index if not exists solicitud_arco_titular_user_idx
  on public.solicitud_arco (titular_user_id) where titular_user_id is not null;

comment on column public.solicitud_arco.titular_user_id is
  '0442: el titular cuando NO es operador (cuenta de oficina: dueño, contador, encargado). Con operador_id NULL y esto NULL el ejecutor de cancelación sigue negándose.';

create or replace function public.ejecutar_arco_cancelacion_cuenta(p_tenant uuid, p_solicitud uuid)
returns jsonb
language plpgsql
set search_path = public, extensions, pg_catalog
as $$
declare
  v_user uuid;
  v_tipo text;
  v_estado text;
  v_rol text;
  v_activo boolean;
  v_telefono text;
  v_otros_duenos int;
  ev jsonb := '{}'::jsonb;
  n int;
  seudonimo text;
begin
  select titular_user_id, tipo, estado into v_user, v_tipo, v_estado
    from solicitud_arco where id = p_solicitud and tenant_id = p_tenant;

  if v_user is null then
    return jsonb_build_object('ok', false, 'motivo', 'solicitud sin titular de cuenta o de otra flota');
  end if;
  if v_tipo <> 'cancelacion' then
    return jsonb_build_object('ok', false, 'motivo', 'esta función solo ejecuta solicitudes de cancelación');
  end if;
  if v_estado in ('resuelta', 'improcedente') then
    return jsonb_build_object('ok', false, 'motivo', 'ya estaba cerrada');
  end if;

  select rol, activo, telefono into v_rol, v_activo, v_telefono
    from app_user where id = v_user and tenant_id = p_tenant;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'la cuenta del titular no existe en esta flota');
  end if;
  if v_rol = 'superadmin' then
    return jsonb_build_object('ok', false, 'motivo', 'una cuenta de plataforma no se cancela por esta vía');
  end if;

  -- No dejar la flota sin dueño: si es el único flota_admin activo, un humano
  -- nombra a otro antes (mismo criterio que desactivarUsuario).
  if v_rol = 'flota_admin' and v_activo then
    select count(*) into v_otros_duenos from app_user
     where tenant_id = p_tenant and rol = 'flota_admin' and activo and id <> v_user;
    if v_otros_duenos = 0 then
      return jsonb_build_object('ok', false, 'motivo', 'es el único dueño activo de la flota: nombra a otro dueño antes de cancelar esta cuenta');
    end if;
  end if;

  seudonimo := 'Usuario ' || upper(substr(encode(digest(v_user::text, 'sha256'), 'hex'), 1, 6));

  ev := ev || jsonb_build_object(
    'titular', 'cuenta_de_oficina',
    'evidencia_fiscal_retenida', true, 'fundamento_retencion', 'CFF art. 30',
    'bitacora_auditoria_conservada', true);

  delete from wa_conversacion c
   where c.tenant_id = p_tenant
     and v_telefono is not null
     and telefono_normalizado(c.telefono) = telefono_normalizado(v_telefono);
  get diagnostics n = row_count; ev := ev || jsonb_build_object('wa_conversacion', n);

  delete from envio_mensaje e
   where e.tenant_id = p_tenant
     and v_telefono is not null
     and telefono_normalizado(e.telefono) = telefono_normalizado(v_telefono);
  get diagnostics n = row_count; ev := ev || jsonb_build_object('envio_mensaje', n);

  -- Chat con el analista y copiloto: el texto lo escribió la persona (cascada a *_mensaje).
  delete from chat_conversacion where tenant_id = p_tenant and user_id = v_user;
  get diagnostics n = row_count; ev := ev || jsonb_build_object('chat_conversacion', n);

  delete from copiloto_conversacion where user_id = v_user;
  get diagnostics n = row_count; ev := ev || jsonb_build_object('copiloto_conversacion', n);

  update mcp_oauth_token set revocado_en = now()
   where tenant_id = p_tenant and user_id = v_user and revocado_en is null;
  get diagnostics n = row_count; ev := ev || jsonb_build_object('mcp_tokens_revocados', n);

  update app_user
     set nombre = seudonimo,
         email = 'cancelado-' || substr(encode(digest(v_user::text || 'mail', 'sha256'), 'hex'), 1, 16) || '@arco.invalid',
         telefono = null,
         avatar_url = null,
         activo = false,
         desactivado_en = coalesce(desactivado_en, now())
   where id = v_user and tenant_id = p_tenant;
  get diagnostics n = row_count; ev := ev || jsonb_build_object('cuenta_anonimizada_y_dada_de_baja', n);

  update solicitud_arco
     set estado = 'resuelta', resuelta_en = now(), ejecutada_en = now(), evidencia = ev,
         resolucion = coalesce(resolucion, 'Se sustituyeron tu nombre y tu correo de cuenta, se quitó tu teléfono y tu foto, se dio de baja tu acceso y se eliminaron tus conversaciones de WhatsApp, del analista y del copiloto. Se conservan la bitácora de auditoría (el registro de quién hizo qué en la plataforma) y la documentación fiscal de la flota (CFF art. 30), que no está ligada a tu cuenta.')
   where id = p_solicitud and tenant_id = p_tenant;

  return jsonb_build_object('ok', true, 'evidencia', ev, 'seudonimo', seudonimo, 'user_id', v_user);
end;
$$;

comment on function public.ejecutar_arco_cancelacion_cuenta(uuid, uuid) is
  '0442 (auditoría ola 1 #46): cancelación ARCO del titular que es CUENTA DE OFICINA (app_user), no operador. Seudonimiza nombre y correo, quita teléfono/avatar, da de baja, revoca MCP, borra conversaciones de WhatsApp/analista/copiloto. NO borra el login de Auth (lo hace ejecutarCancelacionArco en TS). Se niega con el único dueño activo y con superadmin.';

revoke all on function public.ejecutar_arco_cancelacion_cuenta(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ejecutar_arco_cancelacion_cuenta(uuid, uuid) to service_role;

CREATE OR REPLACE FUNCTION public.ejecutar_arco_cancelacion(p_tenant uuid, p_solicitud uuid)
returns jsonb
language plpgsql
set search_path = public, extensions, pg_catalog
as $$
declare
  v_operador uuid;
  v_tipo text;
  v_estado text;
  v_telefono text;
  v_incidencias uuid[];
  ev jsonb := '{}'::jsonb;
  n int;
  seudonimo text;
begin
  select operador_id, tipo, estado into v_operador, v_tipo, v_estado
    from solicitud_arco where id = p_solicitud and tenant_id = p_tenant;

  if v_operador is null then
    -- 0442 (auditoría ola 1 #46): la solicitud de una CUENTA DE OFICINA (dueño,
    -- contador, encargado) no tiene operador: su titular es un app_user. Antes
    -- se rechazaba aquí y /privacidad prometía el borrado. Ahora se delega.
    if exists (select 1 from solicitud_arco where id = p_solicitud and tenant_id = p_tenant and titular_user_id is not null) then
      return public.ejecutar_arco_cancelacion_cuenta(p_tenant, p_solicitud);
    end if;
    return jsonb_build_object('ok', false, 'motivo', 'solicitud sin operador o de otra flota');
  end if;
  if v_tipo <> 'cancelacion' then
    return jsonb_build_object(
      'ok', false,
      'motivo', case when v_tipo = 'oposicion'
        then 'la oposición no cancela ni anonimiza datos; conserva la revisión humana de decisiones automatizadas'
        else 'esta función solo ejecuta solicitudes de cancelación'
      end
    );
  end if;
  if v_estado in ('resuelta', 'improcedente') then
    return jsonb_build_object('ok', false, 'motivo', 'ya estaba cerrada');
  end if;

  seudonimo := 'Operador ' || upper(substr(encode(digest(v_operador::text, 'sha256'), 'hex'), 1, 6));

  select telefono into v_telefono from operador where id = v_operador and tenant_id = p_tenant;

  ev := ev || jsonb_build_object('evidencia_fiscal_retenida', true, 'fundamento_retencion', 'CFF art. 30');

  delete from wa_conversacion c
   where c.tenant_id = p_tenant
     and (c.operador_id = v_operador
          or (v_telefono is not null
              and telefono_normalizado(c.telefono) = telefono_normalizado(v_telefono)));
  get diagnostics n = row_count; ev := ev || jsonb_build_object('wa_conversacion', n);

  delete from envio_mensaje e
   where e.tenant_id = p_tenant
     and v_telefono is not null
     and telefono_normalizado(e.telefono) = telefono_normalizado(v_telefono);
  get diagnostics n = row_count; ev := ev || jsonb_build_object('envio_mensaje', n);

  -- LEG-M5 (0356): el contacto de emergencia es dato de un TERCERO sin
  -- fundamento fiscal que lo retenga — se borra, no se anonimiza.
  delete from contacto_emergencia ce
   where ce.tenant_id = p_tenant and ce.operador_id = v_operador;
  get diagnostics n = row_count; ev := ev || jsonb_build_object('contacto_emergencia', n);

  select coalesce(array_agg(i.id), '{}'::uuid[]) into v_incidencias
    from incidencia i
   where i.tenant_id = p_tenant and i.operador_id = v_operador
     and i.texto_anonimizado_en is null;

  update incidencia
     set descripcion = '[texto retirado por cancelación ARCO del titular]',
         operador_id = null,
         texto_anonimizado_en = now()
   where tenant_id = p_tenant and id = any(v_incidencias);
  get diagnostics n = row_count; ev := ev || jsonb_build_object('incidencia_texto_anonimizado', n);

  update incidencia_evento e
     set detalle = jsonb_set(
           coalesce(e.detalle, '{}'::jsonb),
           '{texto}',
           to_jsonb('[texto retirado por cancelación ARCO del titular]'::text),
           true)
   where e.tenant_id = p_tenant
     and e.detalle ? 'texto'
     and e.incidencia_id = any(v_incidencias);
  get diagnostics n = row_count; ev := ev || jsonb_build_object('incidencia_evento_texto_anonimizado', n);

  update operador
     set nombre = seudonimo,
         telefono = 'anon:' || substr(encode(digest(v_operador::text || 'tel', 'sha256'), 'hex'), 1, 16),
         rfc = null,
         licencia = null,
         licencia_tipo = null,
         licencia_vence = null,
         anonimizado_en = now()
   where id = v_operador and tenant_id = p_tenant;
  get diagnostics n = row_count; ev := ev || jsonb_build_object('operador_anonimizado', n);

  update app_user
     set nombre = seudonimo, telefono = null, avatar_url = null
   where operador_id = v_operador;
  get diagnostics n = row_count; ev := ev || jsonb_build_object('app_user_anonimizado', n);

  update solicitud_arco
     set estado = 'resuelta', resuelta_en = now(), ejecutada_en = now(), evidencia = ev,
         resolucion = coalesce(resolucion, 'Se sustituyeron el nombre y el teléfono del registro operativo, se eliminaron sus conversaciones y el contacto de emergencia registrado sobre su persona. Se conservan el identificador del operador, el correo de la cuenta, la referencia del titular en la solicitud y la documentación fiscal. Requieren revisión de privacidad para determinar los pasos pendientes.')
   where id = p_solicitud and tenant_id = p_tenant;

  return jsonb_build_object('ok', true, 'evidencia', ev, 'seudonimo', seudonimo);
end;
$$;

comment on function public.ejecutar_arco_cancelacion(uuid, uuid) is
  'LEG-M5 (0356) + 0442: además de lo conversacional, borra contacto_emergencia del operador; sin operador pero con solicitud_arco.titular_user_id (cuenta de oficina) delega en ejecutar_arco_cancelacion_cuenta. La purga por antigüedad (sin ARCO) queda pendiente: exige fijar un plazo de retención, decisión de Javier. Historial: 0173 (creación), 0262/0264/0273/0275/0286/0290/0340 (alcance, digest, search_path), 0353 (cuerpo completo literal), 0356, 0442.';

revoke all on function public.ejecutar_arco_cancelacion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ejecutar_arco_cancelacion(uuid, uuid) to service_role;

commit;
