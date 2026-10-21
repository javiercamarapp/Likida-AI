-- ═══════════════════════════════════════════════════════════════════════════
-- 0849 · AUDITORÍA ADVERSARIAL (21-oct-2026), HALLAZGO ALTO CONFIRMADO — el
-- mismo TOCTOU del "último dueño activo" que cerró la 0846 para
-- `equipo_cambiar_rol`/`equipo_desactivar_usuario` SEGUÍA ABIERTO en
-- `ejecutar_arco_cancelacion_cuenta` (0442): el recuento de "¿hay otro
-- flota_admin activo?" y el UPDATE que da de baja al titular seguían siendo
-- un SELECT COUNT y un UPDATE separados DENTRO de la misma función — lo que
-- basta para protegerse de DOS llamadas SECUENCIALES, pero no de dos
-- llamadas CONCURRENTES: cada invocación de esta función es, igual que
-- cualquier RPC de supabase-js, SU PROPIA transacción, y nada serializaba
-- esa transacción contra otra transacción paralela sobre la MISMA flota.
--
-- ── EL ESCENARIO REAL ───────────────────────────────────────────────────────
-- Con exactamente dos `flota_admin` activos (A y B), dos cancelaciones ARCO
-- simultáneas — o, peor, una cancelación ARCO de A en paralelo con un
-- `cambiarRolUsuario`/`desactivarUsuario` sobre B disparado por soporte desde
-- /admin — podían, cada una, contar "sí hay otro dueño activo" (viendo al
-- otro todavía activo porque su transacción no había confirmado) ANTES de que
-- cualquiera de las dos UPDATE confirmara. Las dos pasan el candado, las dos
-- actualizan: la flota queda con CERO `flota_admin` activos, exactamente la
-- invariante que esta función y la 0846 existen para proteger — y que NINGUNA
-- de las dos, aisladas la una de la otra, puede garantizar por sí sola.
--
-- ── EL CIERRE: EL MISMO CANDADO, A PROPÓSITO ───────────────────────────────
-- `pg_advisory_xact_lock(hashtextextended('equipo:' || p_tenant::text, 0))` —
-- IDÉNTICO al que ya usan `equipo_cambiar_rol`/`equipo_desactivar_usuario`
-- (0846). No es una coincidencia de estilo: las TRES funciones protegen el
-- MISMO invariante ("al menos un flota_admin activo por flota") sobre la
-- MISMA fila de `app_user`, así que comparten el MISMO candado — compartir el
-- prefijo `'equipo:'` + tenant es lo que hace que una cancelación ARCO y un
-- cambio de rol/baja para la MISMA flota se serialicen ENTRE SÍ, no solo cada
-- una contra sí misma. Un candado distinto (p. ej. `'arco:' || tenant`)
-- habría cerrado la carrera dentro de esta función pero dejado abierta la
-- carrera CRUZADA entre esta función y las de 0846 — que es precisamente el
-- caso "incluso disparadas por superadmin de soporte" del hallazgo.
--
-- El candado se toma ANTES de leer rol/activo del titular (no solo antes del
-- recuento): así la decisión completa —¿es flota_admin activo?, ¿cuántos
-- otros quedan?, UPDATE— ocurre bajo el mismo candado de transacción, sin
-- ninguna ventana entre una lectura fuera del candado y el recuento adentro.
-- Dos llamadas para FLOTAS distintas no se tocan (hashes distintos, cero
-- espera); una solicitud cuyo titular no es `flota_admin` activo (contador,
-- encargado) nunca entra a la sección que toma el candado — cancelar esas
-- cuentas no compite por él.
--
-- Prueba de concurrencia real (dos sesiones psql traslapadas, Postgres real):
-- supabase/tests/0849_arco_cancelacion_candado_concurrencia.sh. Prueba
-- funcional de una sola sesión (ok / ultimo_dueno / aislamiento):
-- supabase/tests/0849_arco_cancelacion_candado_ultimo_dueno.sql.
-- ═══════════════════════════════════════════════════════════════════════════
begin;

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
  '0442 + 0849 (TOCTOU, auditoría adversarial 21-oct-2026): cancelación ARCO del titular que es CUENTA DE OFICINA (app_user), no operador. El recuento del "último dueño activo" y el UPDATE corren bajo pg_advisory_xact_lock("equipo:"||tenant) — EL MISMO candado que equipo_cambiar_rol/equipo_desactivar_usuario (0846) — así que se serializa también contra esas dos funciones para la MISMA flota, no solo contra sí misma. Seudonimiza nombre y correo, quita teléfono/avatar, da de baja, revoca MCP, borra conversaciones de WhatsApp/analista/copiloto. NO borra el login de Auth (lo hace ejecutarCancelacionArco en TS). Se niega con el único dueño activo y con superadmin.';

revoke all on function public.ejecutar_arco_cancelacion_cuenta(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ejecutar_arco_cancelacion_cuenta(uuid, uuid) to service_role;

commit;
