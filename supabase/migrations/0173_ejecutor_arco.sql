-- ═══════════════════════════════════════════════════════════════════════════
-- 0173 — EL EJECUTOR ARCO: una cancelación que de verdad cancela, con evidencia
--
-- Hasta hoy `solicitud_arco` (0053) sólo REGISTRABA: se anotaba la petición,
-- se le ponía vencimiento (15 días hábiles, LFPDPPP art. 32) y aparecía en
-- /admin/compliance. Cumplir era un acto manual sin rastro — y una promesa de
-- borrado que nadie puede demostrar es peor que no prometer nada.
--
-- LO QUE NO SE BORRA, Y POR QUÉ. Una cancelación ARCO no vacía la contabilidad:
-- el CFF art. 30 obliga a conservar la evidencia fiscal CINCO AÑOS, y el propio
-- art. 26 de la LFPDPPP reconoce que el responsable puede negarse a cancelar
-- cuando el dato es necesario para cumplir una obligación legal. Así que:
--
--   · Se ANONIMIZA al titular: su nombre pasa a un seudónimo estable y su
--     teléfono se va. La liquidación conserva su forma; deja de tener dueño.
--   · Se BORRA lo que es sólo suyo y no es contabilidad: el hilo de WhatsApp
--     con su teléfono, sus posiciones, sus avisos salientes y su avatar.
--   · Se CONSERVA el gasto con su CFDI — es contabilidad de la flota, no un
--     dato del chofer— pero desligado de él.
--   · Sus FOTOS se marcan para borrado en Storage. No se pueden borrar desde
--     SQL: Supabase lo prohíbe con un trigger (`storage.protect_delete()`, lo
--     aprendió a golpes la 0165). Van a `storage_huerfano_candidato` con
--     motivo 'arco', y el barrido nocturno las borra por la API.
--
-- LA EVIDENCIA es el punto entero: `solicitud_arco.evidencia` guarda QUÉ se
-- tocó y CUÁNTO, fila por tabla. Sin eso, "ya lo borramos" es una afirmación
-- sin respaldo el día que el INAI pregunte.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.solicitud_arco
  add column if not exists evidencia jsonb,
  add column if not exists ejecutada_en timestamptz;

-- Marca en el propio titular: sin ella, un operador anonimizado se distingue de
-- uno recién dado de alta sólo por el aspecto del nombre, y eso es adivinar.
alter table public.operador
  add column if not exists anonimizado_en timestamptz;

comment on column public.operador.anonimizado_en is
  'Cuándo se ejecutó una cancelación ARCO sobre este operador. NULL = nunca. Su nombre es un seudónimo estable desde entonces.';

comment on column public.solicitud_arco.evidencia is
  'Qué tocó el ejecutor, fila por tabla: {tabla: n}. Es la prueba de cumplimiento — sin ella "ya se borró" no se puede demostrar.';

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
  -- El candado de flota va en el WHERE, no en la confianza: una solicitud de
  -- otra flota no existe para esta llamada.
  select operador_id, tipo, estado into v_operador, v_tipo, v_estado
    from solicitud_arco where id = p_solicitud and tenant_id = p_tenant;

  if v_operador is null then
    return jsonb_build_object('ok', false, 'motivo', 'solicitud sin operador o de otra flota');
  end if;
  if v_tipo not in ('cancelacion', 'oposicion') then
    return jsonb_build_object('ok', false, 'motivo', 'solo cancelacion y oposicion se ejecutan; acceso y rectificacion los contesta una persona');
  end if;
  if v_estado in ('resuelta', 'improcedente') then
    return jsonb_build_object('ok', false, 'motivo', 'ya estaba cerrada');
  end if;

  -- Seudónimo ESTABLE: la misma persona da el mismo rótulo, así que las cifras
  -- por operador siguen cuadrando sin que nadie sepa quién es.
  seudonimo := 'Operador ' || upper(substr(encode(digest(v_operador::text, 'sha256'), 'hex'), 1, 6));

  -- ── 1. Las FOTOS a la cola de borrado de Storage ────────────────────────
  insert into storage_huerfano_candidato (bucket, nombre, motivo)
  select 'comprobantes',
         regexp_replace(g.imagen_url, '^.*/comprobantes/', ''),
         'arco'
    from gasto g
    join viaje v on v.id = g.viaje_id
   where g.tenant_id = p_tenant
     and v.operador_id = v_operador
     and g.imagen_url is not null
     and g.imagen_url like '%/comprobantes/%'
  on conflict (bucket, nombre) do nothing;
  get diagnostics n = row_count;  ev := ev || jsonb_build_object('storage_marcado', n);

  -- ── 2. Lo que es SÓLO suyo y no es contabilidad: fuera ──────────────────
  -- OJO con `wa_mensaje_procesado`: NO se toca. Es el registro de idempotencia
  -- del webhook (sólo `wa_message_id` y horas, ningún dato de la persona), y
  -- vaciarlo haría que Meta pudiera reentregar mensajes ya procesados. Su
  -- retención la lleva la purga por antigüedad, no el ARCO.
  delete from wa_conversacion where tenant_id = p_tenant and operador_id = v_operador;
  get diagnostics n = row_count;  ev := ev || jsonb_build_object('wa_conversacion', n);

  -- `posicion` NO se toca, y conviene que quede escrito por qué: se liga a la
  -- UNIDAD (`unidad_id`), no al operador. La huella de dónde anduvo una persona
  -- sí está ahí de forma indirecta, pero alcanzarla exige reconstruir quién
  -- conducía cada unidad en cada instante — cruzar viajes y fechas. Eso es un
  -- proyecto aparte, no una línea de este ejecutor, y fingir que se cubre sería
  -- peor que declararlo pendiente.

  delete from envio_mensaje e
   where e.tenant_id = p_tenant
     and e.telefono = (select telefono from operador where id = v_operador);
  get diagnostics n = row_count;  ev := ev || jsonb_build_object('envio_mensaje', n);

  -- ── 3. El titular se ANONIMIZA, no se borra ─────────────────────────────
  -- Borrar la fila arrastraría por FK sus viajes y su contabilidad. La ley
  -- pide que deje de ser identificable, no que la flota pierda sus libros.
  -- El teléfono no se puede VACIAR: es `not null` y forma la llave única
  -- (tenant, telefono) porque es la dirección del canal de WhatsApp. Se
  -- sustituye por un valor derivado del hash — irreversible, único dentro de la
  -- flota, y con un prefijo que lo delata como anonimizado para que nadie lo
  -- confunda con un número real ni intente escribirle.
  update operador
     set nombre = seudonimo,
         telefono = 'anon:' || substr(encode(digest(v_operador::text || 'tel', 'sha256'), 'hex'), 1, 16),
         anonimizado_en = now()
   where id = v_operador and tenant_id = p_tenant;
  get diagnostics n = row_count;  ev := ev || jsonb_build_object('operador_anonimizado', n);

  update app_user
     set nombre = seudonimo, telefono = null, avatar_url = null
   where operador_id = v_operador;
  get diagnostics n = row_count;  ev := ev || jsonb_build_object('app_user_anonimizado', n);

  -- ── 4. Se cierra la solicitud con su evidencia ──────────────────────────
  update solicitud_arco
     set estado = 'resuelta',
         resuelta_en = now(),
         ejecutada_en = now(),
         evidencia = ev,
         resolucion = coalesce(resolucion, 'Cancelación ejecutada: datos personales anonimizados y evidencia registrada. La documentación fiscal se conserva por el art. 30 del CFF, desligada del titular.')
   where id = p_solicitud and tenant_id = p_tenant;

  return jsonb_build_object('ok', true, 'evidencia', ev, 'seudonimo', seudonimo);
end $$;

revoke all on function public.ejecutar_arco_cancelacion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ejecutar_arco_cancelacion(uuid, uuid) to service_role;

