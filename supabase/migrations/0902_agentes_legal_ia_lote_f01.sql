-- REVERSA: drop function if exists public.vencer_wa_outbox(integer); drop trigger if exists wa_outbox_fija_vigencia on public.wa_outbox; drop function if exists public.wa_outbox_fija_vigencia(); alter table public.wa_outbox drop column if exists vence_en; y volver a aplicar los cuerpos de reclamar_wa_outbox (supabase/migrations/0180_reservas_agente_y_outbox_wa.sql), ejecutar_arco_cancelacion (0442) y ejecutar_arco_cancelacion_cuenta (0849) con create or replace + revoke/grant.
-- ═══════════════════════════════════════════════════════════════════════════
-- 0902 · Lote M-F-agentes-legal-ia-01 (auditoría 37): una sola migración, ADITIVA e IDEMPOTENTE
--
--  A37-L-05 (outbox WhatsApp sin vigencia). `wa_outbox.vence_en` (nullable) + trigger que la fija a
--    creada_en + 24 h en todo insert que no la traiga. `reclamar_wa_outbox` ya no reclama lo vencido y
--    `vencer_wa_outbox` lo pasa a 'dead' (el cron lo llama y alerta). Con un token vencido un fin de
--    semana, la cola ya no sale de golpe días después con instrucciones caducas a choferes y jefes.
--    Compatible hacia atrás: el código desplegado inserta sin `vence_en` (lo pone el trigger) y sigue
--    reclamando con la misma firma.
--  A37-L-02 (legal): `ejecutar_arco_cancelacion` da de baja (activo=false) al operador cancelado.
--  A37-L-04 (legal): la misma función retira lat/lng/nota de `pod` del operador.
--  A37-L-03 (legal): `ejecutar_arco_cancelacion_cuenta` declara en la constancia que los correos
--    congelados como firma se CONSERVAN (y cuáles), en vez de afirmar que no hay ligadura.
--
-- Los cuerpos de las dos funciones ARCO son los vigentes (0442 y 0849) con SOLO los cambios de arriba.
-- ═══════════════════════════════════════════════════════════════════════════
begin;

-- ── A37-L-05 ────────────────────────────────────────────────────────────────
alter table public.wa_outbox add column if not exists vence_en timestamptz;
comment on column public.wa_outbox.vence_en is
  'A37-L-05 (0902): a partir de aquí el mensaje ya no se envía (instrucción caduca). Lo fija el trigger a creada_en + 24 h si el insert no la trae; NULL = sin vigencia (filas previas ya enviadas/muertas).';

-- Lo que ya espera en la cola hoy: vigencia de 24 h desde que se creó (si lleva más tiempo, vence en el
-- primer ciclo y se avisa; no sale de golpe).
update public.wa_outbox
   set vence_en = creada_en + interval '24 hours'
 where vence_en is null and estado in ('pending', 'sending');

create or replace function public.wa_outbox_fija_vigencia()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.vence_en is null then
    new.vence_en := coalesce(new.creada_en, now()) + interval '24 hours';
  end if;
  return new;
end $$;

drop trigger if exists wa_outbox_fija_vigencia on public.wa_outbox;
create trigger wa_outbox_fija_vigencia
  before insert on public.wa_outbox
  for each row execute function public.wa_outbox_fija_vigencia();

revoke all on function public.wa_outbox_fija_vigencia() from public, anon, authenticated;

create or replace function public.reclamar_wa_outbox(p_limite int default 25, p_lease_seconds int default 120)
returns table(id uuid, payload jsonb, intentos int, lease_token uuid)
language plpgsql security invoker set search_path=public,pg_catalog as $$
begin
  return query
  with candidatas as (
    select o.id from wa_outbox o
     where ((o.estado='pending' and o.proximo_intento_en <= now())
        or (o.estado='sending' and o.lease_expires_at < now()))
       and (o.vence_en is null or o.vence_en > now())
     order by o.proximo_intento_en, o.creada_en
     for update skip locked limit greatest(1, least(p_limite, 100))
  )
  update wa_outbox o set estado='sending', intentos=o.intentos+1,
    lease_token=gen_random_uuid(), lease_expires_at=now()+make_interval(secs=>p_lease_seconds)
   from candidatas c where o.id=c.id
  returning o.id,o.payload,o.intentos,o.lease_token;
end $$;

create or replace function public.vencer_wa_outbox(p_limite integer default 100)
returns table(id uuid, creada_en timestamptz, vence_en timestamptz)
language plpgsql security invoker set search_path=public,pg_catalog as $$
begin
  return query
  with vencidas as (
    select o.id from wa_outbox o
     where o.vence_en is not null and o.vence_en <= now()
       and (o.estado='pending' or (o.estado='sending' and o.lease_expires_at < now()))
     order by o.vence_en
     for update skip locked limit greatest(1, least(p_limite, 500))
  )
  update wa_outbox o
     set estado='dead', lease_token=null, lease_expires_at=null,
         ultimo_error=left('vencida: no se envió antes de su vigencia ('||coalesce(o.ultimo_error,'sin error previo')||')', 500)
    from vencidas v where o.id=v.id
  returning o.id, o.creada_en, o.vence_en;
end $$;

comment on function public.vencer_wa_outbox(integer) is
  'A37-L-05 (0902): pasa a dead las salidas pending/sending cuya vigencia (vence_en) ya pasó y devuelve cuáles, para que el cron alerte. Nada que ya se envió se toca.';

revoke all on function public.reclamar_wa_outbox(int,int), public.vencer_wa_outbox(integer) from public, anon, authenticated;
grant execute on function public.reclamar_wa_outbox(int,int), public.vencer_wa_outbox(integer) to service_role;

-- ── A37-L-02 y A37-L-04 (operador) ──────────────────────────────────────────
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

  -- A37-L-04: la evidencia de entrega (`pod`) guarda la posición exacta del chofer al entregar
  -- y un texto libre, ligados a su id y sin ningún fundamento fiscal que los retenga. Se
  -- retiran; la fila, la foto y el viaje (hecho operativo y fiscal de la flota) se conservan.
  update pod
     set lat = null, lng = null, nota = null
   where tenant_id = p_tenant and operador_id = v_operador
     and (lat is not null or lng is not null or nota is not null);
  get diagnostics n = row_count; ev := ev || jsonb_build_object('pod_geolocalizacion_y_nota_retiradas', n);

  -- A37-L-02: el operador cancelado se DA DE BAJA. Con `activo = true` y teléfono `anon:<hex>`
  -- seguía entrando a los flujos proactivos (GPS, jornada, avisos) como si fuera un operador vivo.
  update operador
     set nombre = seudonimo,
         telefono = 'anon:' || substr(encode(digest(v_operador::text || 'tel', 'sha256'), 'hex'), 1, 16),
         rfc = null,
         licencia = null,
         licencia_tipo = null,
         licencia_vence = null,
         anonimizado_en = now(),
         activo = false
   where id = v_operador and tenant_id = p_tenant;
  get diagnostics n = row_count; ev := ev || jsonb_build_object('operador_anonimizado_y_dado_de_baja', n);

  update app_user
     set nombre = seudonimo, telefono = null, avatar_url = null
   where operador_id = v_operador;
  get diagnostics n = row_count; ev := ev || jsonb_build_object('app_user_anonimizado', n);

  update solicitud_arco
     set estado = 'resuelta', resuelta_en = now(), ejecutada_en = now(), evidencia = ev,
         resolucion = coalesce(resolucion, 'Se sustituyeron el nombre y el teléfono del registro operativo y se dio de baja al operador, se eliminaron sus conversaciones y el contacto de emergencia registrado sobre su persona, y se retiraron las coordenadas y la nota de sus evidencias de entrega. Se conservan el identificador del operador, el correo de la cuenta, la referencia del titular en la solicitud y la documentación fiscal. Requieren revisión de privacidad para determinar los pasos pendientes.')
   where id = p_solicitud and tenant_id = p_tenant;

  return jsonb_build_object('ok', true, 'evidencia', ev, 'seudonimo', seudonimo);
end;
$$;

comment on function public.ejecutar_arco_cancelacion(uuid, uuid) is
  'LEG-M5 (0356) + 0442 + 0902 (A37-L-02/L-04): además de lo conversacional y el contacto de emergencia, da de baja al operador (activo=false) y retira lat/lng/nota de sus pod. Sin operador pero con solicitud_arco.titular_user_id delega en ejecutar_arco_cancelacion_cuenta. Historial: 0173, 0262/0264/0273/0275/0286/0290/0340, 0353, 0356, 0442.';

revoke all on function public.ejecutar_arco_cancelacion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ejecutar_arco_cancelacion(uuid, uuid) to service_role;

-- ── A37-L-03 (cuenta de oficina) ────────────────────────────────────────────
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

  -- 0849 (auditoría adversarial 21-oct-2026, HALLAZGO ALTO confirmado): el
  -- MISMO candado por flota que usan equipo_cambiar_rol/equipo_desactivar_usuario
  -- (0846), tomado ANTES de leer rol/activo del titular — así toda la decisión
  -- de abajo (¿es el último dueño activo?, UPDATE) corre serializada contra
  -- cualquier otra llamada concurrente que compita por el mismo invariante
  -- para la MISMA flota, sea otra cancelación ARCO, un cambio de rol o una
  -- baja desde /dashboard/usuarios o /admin.
  perform pg_advisory_xact_lock(hashtextextended('equipo:' || p_tenant::text, 0));

  select rol, activo, telefono into v_rol, v_activo, v_telefono
    from app_user where id = v_user and tenant_id = p_tenant;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'la cuenta del titular no existe en esta flota');
  end if;
  if v_rol = 'superadmin' then
    return jsonb_build_object('ok', false, 'motivo', 'una cuenta de plataforma no se cancela por esta vía');
  end if;

  -- No dejar la flota sin dueño: si es el único flota_admin activo, un humano
  -- nombra a otro antes (mismo criterio que desactivarUsuario). El recuento
  -- ahora corre DENTRO del candado de arriba: una llamada concurrente para la
  -- MISMA flota espera a que esta transacción confirme o aborte antes de
  -- recontar, así que ve el estado YA actualizado, nunca el viejo.
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
    'bitacora_auditoria_conservada', true,
    -- A37-L-03: estos correos se CONGELARON a propósito como firma/prueba (quién cerró, registró,
    -- anuló o declaró un asiento; quién revisó una liquidación). La cuenta se seudonimiza pero esos
    -- campos NO se reescriben; la constancia lo dice en vez de afirmar que no hay ligadura.
    'correos_congelados_retenidos', true,
    'correos_congelados_en', jsonb_build_array('jornada_dia.cerrado_por_email', 'jornada_asiento.registrado_por_email / anulado_por_email', 'jornada_politica.declarada_por_email', 'liquidacion.revisada_por_email'));

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
         resolucion = coalesce(resolucion, 'Se sustituyeron tu nombre y tu correo de cuenta, se quitó tu teléfono y tu foto, se dio de baja tu acceso y se eliminaron tus conversaciones de WhatsApp, del analista y del copiloto. Se conservan la bitácora de auditoría (el registro de quién hizo qué en la plataforma), la documentación fiscal de la flota (CFF art. 30) y el correo con el que firmaste o revisaste asientos de jornada y liquidaciones, que se congela a propósito como prueba de quién los firmó; el fundamento y el plazo de esa conservación los confirma el abogado de la empresa.')
   where id = p_solicitud and tenant_id = p_tenant;

  return jsonb_build_object('ok', true, 'evidencia', ev, 'seudonimo', seudonimo, 'user_id', v_user);
end;
$$;

comment on function public.ejecutar_arco_cancelacion_cuenta(uuid, uuid) is
  '0442 + 0849 + 0902 (A37-L-03): cancelación ARCO de una CUENTA DE OFICINA. Mismo candado por flota que 0846/0849. Seudonimiza nombre y correo, quita teléfono/avatar, da de baja, revoca MCP, borra conversaciones. Los correos congelados como firma (jornada, revisión de liquidaciones) se CONSERVAN y la constancia lo declara. NO borra el login de Auth. Se niega con el único dueño activo y con superadmin.';

revoke all on function public.ejecutar_arco_cancelacion_cuenta(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ejecutar_arco_cancelacion_cuenta(uuid, uuid) to service_role;

commit;
