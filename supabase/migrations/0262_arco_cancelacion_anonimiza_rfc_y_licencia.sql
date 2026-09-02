-- 0262 — LEG-C2: la cancelación ARCO no anonimizaba el RFC ni la licencia
-- del operador.
--
-- `ejecutar_arco_cancelacion` (0173, redefinida en 0178) anonimiza `nombre` y
-- `telefono` en `operador`, pero el UPDATE nunca tocó `rfc` (añadida en 0080)
-- ni `licencia`/`licencia_tipo`/`licencia_vence` (añadidas en 0053). Las
-- cuatro columnas son ANTERIORES a 0178 en el calendario — no es un olvido de
-- orden, es que el UPDATE de 0178 solo enumeró `nombre`/`telefono` y nadie
-- volvió a barrer el esquema completo de `operador` para ver qué más había
-- ganado la tabla desde 0173. Una cancelación "ejecutada" dejaba el RFC y la
-- licencia del titular intactos.
--
-- LA DISTINCIÓN QUE 0178 YA RESOLVIÓ PARA LAS FOTOS DE GASTO/CFDI, Y QUE ESTA
-- MIGRACIÓN EXTIENDE AL RFC Y A LA LICENCIA:
--
-- El propio comentario de 0178 dice que "la documentación fiscal se conserva
-- por el art. 30 del CFF y queda DESLIGADA DEL TITULAR". El Carta Porte ya
-- EMITIDO lleva el RFC del operador (`RFCFigura`, ver
-- `src/lib/likida/carta_porte_xml.ts`) — pero ese RFC vive en un XML TIMBRADO
-- que se guarda como snapshot inmutable en `ccp_timbre.xml` (ver
-- `leerXmlTimbrado` en `carta_porte_timbre.ts`), NUNCA se regenera a partir de
-- `operador.rfc` después de emitido, y tiene su PROPIA obligación de
-- retención de cinco años — independiente de la fila viva de `operador` y de
-- cualquier solicitud ARCO (alterar un CFDI ya timbrado sería ilegal). El
-- único camino que sí lee `operador.rfc` en vivo es el XML "borrador"
-- (pre-timbre, `/api/export/carta-porte-xml` sin `?timbrado=1`), que por
-- definición TODAVÍA no es un documento fiscal emitido — es correcto que
-- refleje el estado actual del operador, RFC anonimizado incluido.
--
-- Es decir: la obligación fiscal ya está satisfecha por el documento
-- histórico independiente. `operador.rfc`, `.licencia`, `.licencia_tipo` y
-- `.licencia_vence` son atributos de identidad de una persona VIVA en la fila
-- mutable — un RFC y una licencia de conducir son identificadores emitidos
-- por una autoridad externa (SAT / autoridad de tránsito) que ubican a esa
-- persona fuera de la base de Likida, exactamente el mismo tipo de dato que
-- `nombre` y `telefono`. Ninguna obligación fiscal exige retenerlos EN LA
-- FILA VIVA: se anonimizan igual que el resto de la identidad del titular.
--
-- REGLA PARA QUIEN LE AÑADA LA PRÓXIMA COLUMNA A `operador`: pregúntate si es
-- identidad de la persona (se anonimiza aquí, como nombre/telefono/rfc/
-- licencia*) o es dato de la relación laboral/operativa que no la identifica
-- por sí solo fuera de esta base (se queda, como ya se quedan `tenant_id`,
-- `terminal_id` y `numero_empleado` — un consecutivo interno de nómina, no un
-- identificador emitido por una autoridad externa). Revisado contra el
-- esquema completo de `operador` al escribir esta migración: no hay ninguna
-- otra columna de identidad externa sin anonimizar además de estas cuatro.
create or replace function public.ejecutar_arco_cancelacion(
  p_tenant uuid,
  p_solicitud uuid
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
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

  seudonimo := 'Operador ' || upper(substr(encode(digest(v_operador::text, 'sha256'), 'hex'), 1, 6));

  -- Las imágenes de gasto/CFDI se CONSERVAN: son evidencia fiscal. La antigua
  -- 0173 las ponía en una cola de borrado; 0178 no promete ese borrado.
  ev := ev || jsonb_build_object('evidencia_fiscal_retenida', true, 'fundamento_retencion', 'CFF art. 30');

  delete from wa_conversacion where tenant_id = p_tenant and operador_id = v_operador;
  get diagnostics n = row_count; ev := ev || jsonb_build_object('wa_conversacion', n);

  delete from envio_mensaje e
   where e.tenant_id = p_tenant
     and e.telefono = (select telefono from operador where id = v_operador);
  get diagnostics n = row_count; ev := ev || jsonb_build_object('envio_mensaje', n);

  -- 0262: RFC y licencia entran al mismo UPDATE que nombre/telefono — ver el
  -- razonamiento completo en el comentario de arriba y en `comment on
  -- function` más abajo.
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
$$;

comment on function public.ejecutar_arco_cancelacion(uuid, uuid) is
  'Ejecuta una solicitud ARCO de CANCELACIÓN (no oposición): anonimiza nombre, teléfono, RFC y licencia (licencia_tipo, licencia_vence) del operador, borra su conversación de WhatsApp y sus envíos, y anonimiza su app_user. NO toca la documentación fiscal ya emitida (gasto.imagen_url, cfdi_uuid, ccp_timbre.xml): esos artefactos son inmutables, tienen su propia retención de 5 años (CFF art. 30) y quedan DESLIGADOS del titular en vez de borrados — ver 0178. Regla para la próxima columna de `operador`: identidad de la persona (RFC, licencia, nombre, teléfono) se anonimiza aquí; dato de la relación operativa sin identificar por sí solo fuera de esta base (tenant_id, terminal_id, numero_empleado) se queda. SECURITY INVOKER.';

revoke all on function public.ejecutar_arco_cancelacion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ejecutar_arco_cancelacion(uuid, uuid) to service_role;
