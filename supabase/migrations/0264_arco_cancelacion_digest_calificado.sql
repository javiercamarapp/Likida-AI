-- ═══════════════════════════════════════════════════════════════════════════
-- 0264 — LA CANCELACIÓN ARCO NUNCA HA PODIDO EJECUTARSE EN PRODUCCIÓN.
--
-- Encontrado verificando manualmente la 0262 (LEG-C2) contra producción, no
-- por una auditoría automática: al ejecutar `ejecutar_arco_cancelacion` de
-- verdad (una solicitud real, no un id inventado), truena antes de llegar a
-- las escrituras:
--
--   ERROR: 42883: function digest(text, unknown) does not exist
--   QUERY: seudonimo := 'Operador ' || upper(substr(encode(digest(…), 'hex'), 1, 6))
--
-- LA CAUSA: `digest()` la trae la extensión pgcrypto, instalada en el esquema
-- `extensions` (verificado: `select nspname from pg_proc … where
-- proname='digest'` → `extensions`, dos veces). Pero la función declara
-- `set search_path = public, pg_catalog` desde que nació en la 0173 —sin
-- `extensions`—, así que CUALQUIER llamada sin calificar a `digest()` falla
-- siempre, ejecute quien ejecute, sin importar el `search_path` por defecto
-- de la base (que sí trae `extensions`, pero el `SET` de la función lo
-- reemplaza en vez de extenderlo).
--
-- No lo introdujo la 0262 ni la 0263 de esta noche: es un defecto de la 0173
-- (05-jul-2026), heredado sin cambios por la 0178. Verificado con
-- `select count(*) from solicitud_arco where tipo='cancelacion'` → 0 filas
-- en producción: NINGUNA cancelación real se ha intentado nunca, así que el
-- defecto no ha causado daño — pero habría fallado la PRIMERA vez que un
-- operador ejerciera su derecho de cancelación, con un error de Postgres
-- crudo en vez de una respuesta legal.
--
-- EL ARREGLO: agregar `extensions` al `SET search_path` de la función, no
-- calificar la llamada. Se probó primero calificar (`extensions.digest`) y
-- se descartó al medirlo contra el Postgres LOCAL de CI: ahí `pgcrypto` vive
-- en `public` (verificado: `select nspname from pg_extension … where
-- extname='pgcrypto'` → `public` en local, `extensions` en Supabase
-- gestionado) — el esquema `extensions` local no tiene esta extensión en
-- absoluto, así que `extensions.digest` habría tronado LOCAL mientras
-- arreglaba PRODUCCIÓN. Agregar `extensions` al `search_path` (sin quitar
-- `public`) funciona en los dos: local resuelve por `public` como siempre,
-- gestionado resuelve por el `extensions` que ahora sí se busca.
--
-- ESTE ES EL MISMO DEFECTO DE FONDO QUE YA ENCONTRÓ EL FORK DE PLAYWRIGHT
-- ESTA NOCHE con los GRANT de `supabase start`: el andamio local de CI no
-- reproduce el layout de esquemas de Supabase gestionado, así que una
-- batería en verde local NO GARANTIZA que la misma función corra en
-- producción. Queda pendiente, fuera de esta migración, alinear
-- `andamio_ci.sql` para que instale `pgcrypto` en `extensions` como hace
-- Supabase gestionado — así esta clase de bug se atrapa en CI la próxima vez,
-- en vez de descubrirse verificando a mano contra producción.
--
-- `ejecutar_arco_oposicion` (misma migración 0178) NO usa `digest` — no
-- necesita este arreglo.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.ejecutar_arco_cancelacion(
  p_tenant uuid,
  p_solicitud uuid
) returns jsonb
language plpgsql
security invoker
set search_path = public, extensions, pg_catalog
as $fn$
declare
  v_operador uuid;
  v_tipo text;
  v_estado text;
  ev jsonb := '{}'::jsonb;
  n int;
  seudonimo text;
begin
  select operador_id, tipo, estado into v_operador, v_tipo, v_estado
    from solicitud_arco where id = p_solicitud and tenant_id = p_tenant;

  if v_operador is null then
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

  -- 0264: search_path EXTENDIDO a `extensions` (arriba, en el `set` de la
  -- función) — `digest()` sigue sin calificar, pero ahora se encuentra sin
  -- importar en qué esquema viva pgcrypto. Las dos llamadas de abajo
  -- (seudónimo, teléfono anonimizado) tenían el mismo defecto.
  seudonimo := 'Operador ' || upper(substr(encode(digest(v_operador::text, 'sha256'), 'hex'), 1, 6));

  ev := ev || jsonb_build_object('evidencia_fiscal_retenida', true, 'fundamento_retencion', 'CFF art. 30');

  delete from wa_conversacion where tenant_id = p_tenant and operador_id = v_operador;
  get diagnostics n = row_count; ev := ev || jsonb_build_object('wa_conversacion', n);

  delete from envio_mensaje e
   where e.tenant_id = p_tenant
     and e.telefono = (select telefono from operador where id = v_operador);
  get diagnostics n = row_count; ev := ev || jsonb_build_object('envio_mensaje', n);

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
         resolucion = coalesce(resolucion, 'Cancelación ejecutada: datos personales anonimizados. La documentación fiscal se conserva por el art. 30 del CFF y queda desligada del titular.')
   where id = p_solicitud and tenant_id = p_tenant;

  return jsonb_build_object('ok', true, 'evidencia', ev, 'seudonimo', seudonimo);
end;
$fn$;

comment on function public.ejecutar_arco_cancelacion(uuid, uuid) is
  'Ejecuta una solicitud ARCO de CANCELACIÓN (no oposición): anonimiza nombre, teléfono, RFC y licencia (licencia_tipo, licencia_vence) del operador, borra su conversación de WhatsApp y sus envíos, y anonimiza su app_user. NO toca la documentación fiscal ya emitida (gasto.imagen_url, cfdi_uuid, ccp_timbre.xml): esos artefactos son inmutables, tienen su propia retención de 5 años (CFF art. 30) y quedan DESLIGADOS del titular en vez de borrados — ver 0178. search_path EXTENDIDO a `extensions` (0264): pgcrypto vive en ese esquema en Supabase gestionado, fuera del search_path original de esta función (`public, pg_catalog`), y una llamada sin calificar a `digest()` tronaba SIEMPRE — defecto heredado desde la 0173 y nunca ejercido en producción (0 cancelaciones reales intentadas). SECURITY INVOKER.';

revoke all on function public.ejecutar_arco_cancelacion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ejecutar_arco_cancelacion(uuid, uuid) to service_role;
