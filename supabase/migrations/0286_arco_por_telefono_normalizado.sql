-- ═══════════════════════════════════════════════════════════════════════════
-- AUDITORÍA 24 · DAT-2 / LEG-2 (CRÍTICO) — LA CANCELACIÓN ARCO BORRABA 0
-- CONVERSACIONES.
--
-- `ejecutar_arco_cancelacion` hacía `delete from wa_conversacion where
-- operador_id = v_operador`. Ningún escritor de la app llena
-- `wa_conversacion.operador_id` (`loadConversation` inserta por teléfono;
-- `asignar_wa`/`despacho_wa` también), así que el DELETE borraba 0 filas, la
-- evidencia archivaba `"wa_conversacion": 0` («no había nada») y la
-- conversación —con el teléfono real y hasta 12 turnos de texto libre— seguía
-- viva mientras el panel decía «el titular quedó anonimizado». Ejecutado en la
-- auditoría (S40): `{"wa_conversacion": 0}` y 1 fila con `5219993700779`.
--
-- Lo mismo pasaba con `envio_mensaje`: empataba por igualdad exacta de
-- `telefono` contra el teléfono del operador, y el mismo celular llega como
-- `52…`, `521…` o `+52…` según por dónde entre (0024, 0274).
--
-- ── EL ARREGLO ────────────────────────────────────────────────────────────
-- Se lee el teléfono del titular ANTES de anonimizarlo y se empata por
-- `telefono_normalizado()` (la misma expresión que indexa
-- `uq_wa_conversacion_tenant_telefono_norm`, 0274), además de por
-- `operador_id` para las filas que sí lo traigan. Se conserva el criterio del
-- 0173: la conversación se BORRA (es texto libre del titular + su estado), no
-- se seudonimiza — no hay nada operativo de la flota adentro.
--
-- De paso, DATOS-23-5 (MEDIO): el UPDATE de `incidencia_evento` alcanzaba a
-- TODAS las incidencias ya anonimizadas del tenant (re-escribía marcas de
-- otros titulares en cada ejecución). Ahora se acota a las incidencias de ESTE
-- titular, capturadas antes de soltar `operador_id`.
--
-- ── CABECERA: LA LECCIÓN DE LA 0273/0275 ─────────────────────────────────
-- Esta migración SÍ tiene que copiar el cuerpo (cambia el predicado). Por eso
-- conserva a la letra la cabecera vigente: SECURITY INVOKER y
-- `set search_path = public, extensions, pg_catalog` (0264/0275: pgcrypto vive
-- en `extensions` en Supabase gestionado y `digest()` sin calificar truena sin
-- él). `arco_search_path.test.ts` lee la ÚLTIMA definición y lo exige; el
-- bloque 234 de verificaciones.sql lo lee de `pg_proc.proconfig` en la base.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.ejecutar_arco_cancelacion(
  p_tenant uuid,
  p_solicitud uuid
) returns jsonb
language plpgsql
security invoker
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

  -- 0286: el teléfono REAL del titular, leído ANTES de que el UPDATE de abajo
  -- lo vuelva `anon:…`. Es la llave con la que la app guarda su conversación.
  select telefono into v_telefono from operador where id = v_operador and tenant_id = p_tenant;

  -- Las imágenes de gasto/CFDI se CONSERVAN: son evidencia fiscal. La antigua
  -- 0173 las ponía en una cola de borrado; 0178 no promete ese borrado.
  ev := ev || jsonb_build_object('evidencia_fiscal_retenida', true, 'fundamento_retencion', 'CFF art. 30');

  -- 0286 (DAT-2/LEG-2): por teléfono normalizado —52/521/+52 son el mismo
  -- celular— y también por `operador_id` para las filas que sí lo traigan.
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

  -- ── 0273 (AUDITORÍA 22, LEG-A4): EL TEXTO QUE ESCRIBIÓ EL TITULAR ────────
  -- El renglón de la incidencia SOBREVIVE —que hubo un siniestro es un hecho
  -- operativo de la flota—; lo que se cancela es el vínculo con la PERSONA.
  -- Se sustituye por una marca explícita en vez de vaciar: un campo vacío se
  -- leería como «no escribió nada», que es otra mentira.
  --
  -- 0286 (DATOS-23-5): las incidencias de ESTE titular se capturan antes de
  -- soltar `operador_id`, para que el UPDATE de sus eventos no alcance a las
  -- de otros titulares ya anonimizados.
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

  -- 0262: RFC y licencia entran al mismo UPDATE que nombre/telefono.
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
         resolucion = coalesce(resolucion, 'Cancelación ejecutada: datos personales anonimizados, incluido el texto libre que el titular escribió por el chat. La documentación fiscal se conserva por el art. 30 del CFF y queda desligada del titular.')
   where id = p_solicitud and tenant_id = p_tenant;

  return jsonb_build_object('ok', true, 'evidencia', ev, 'seudonimo', seudonimo);
end;
$$;

-- Los grants tal cual la 0264 (la 0275 solo tocó la cabecera y `create or
-- replace` conserva el ACL, pero se repiten para que esta migración sea
-- completa por sí sola).
revoke all on function public.ejecutar_arco_cancelacion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ejecutar_arco_cancelacion(uuid, uuid) to service_role;

comment on function public.ejecutar_arco_cancelacion(uuid, uuid) is
  'Ejecuta una solicitud ARCO de CANCELACIÓN (no oposición): anonimiza nombre, teléfono, RFC y licencia del operador, BORRA su conversación de WhatsApp y sus envíos empatando por telefono_normalizado() y por operador_id (0286, auditoría 24 DAT-2/LEG-2: antes solo por operador_id, que ningún escritor llena, y borraba 0 filas), anonimiza su app_user, y retira el texto libre que el titular escribió (incidencia.descripcion e incidencia_evento.detalle->>texto de SUS incidencias, 0273/0286). NO toca la documentación fiscal ya emitida (CFF art. 30). search_path EXTENDIDO a `extensions` (0264/0275): pgcrypto vive en ese esquema en Supabase gestionado. SECURITY INVOKER. Red estática: src/lib/likida/arco_search_path.test.ts; red en base: bloque 234 de verificaciones.sql.';
