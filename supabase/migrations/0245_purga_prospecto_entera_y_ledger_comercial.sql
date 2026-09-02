-- ═══════════════════════════════════════════════════════════════════════════
-- 0245 · LA PURGA DE PROSPECTOS BORRA TODO LO QUE EL AVISO PROMETE — auditoría
-- 19, legal C4 (C.17), tercera pasada del tema — y el ledger comercial deja de
-- retener datos personales sin plazo (reincidente legal #6, Cal.com).
--
-- ── LO MEDIDO (28-ago-2026, contra master 9a7ec367) ─────────────────────────
--
-- /aviso/prospectos promete: «tu nombre, puesto, correo y teléfono se
-- eliminan automáticamente [a los 12 meses]. Lo único que queda es el
-- registro de la empresa» (privacidad.ts, avisoProspectos fr. IV). La 0148
-- borraba UNA columna (contacto_nombre); la 0191 amplió a cinco
-- (contacto_nombre, telefono, correo, notas, lead_clave). Pero después de
-- correr `purgar_prospecto_persona(365)` la fila de un prospecto frío
-- CONSERVABA todavía:
--
--   · `mensaje_wa` / `mensaje_correo` / `mensaje_correo_asunto` (0129) — los
--     mensajes redactados llevan ADENTRO el nombre de pila de la persona,
--     repuesto tras la completion (reponerDecisor / sustituirMarcador). Un
--     "Hola Ramón, …" guardado para siempre es el nombre guardado para
--     siempre, solo que en prosa.
--   · `atribucion` (0137) — el jsonb del lead de /getdemo con su fbclid/
--     gclid: identificadores de la PERSONA que llenó el formulario, que
--     ningún plazo tocaba.
--
-- Y además la condición de estado se quedó vieja: la 0181 amplió el dominio
-- del CRM ('lost', 'no-show', 'cancelled', 'won'…) y la purga seguía filtrando
-- `estado in ('nuevo','contactado','perdido')` — un prospecto 'lost' (que es
-- 'perdido' con otro nombre) NUNCA se purgaba.
--
-- ── BORRAR vs. ANONIMIZAR, dicho con todas sus letras ───────────────────────
--
--   · `prospecto_persona` se BORRA (delete): la fila entera es la persona.
--   · Las columnas de persona en `prospecto` se ANULAN (null): la fila es la
--     EMPRESA y el CRM la sigue necesitando; LFPDPPP protege personas, no
--     razones sociales.
--   · `comercial_evento` se ANONIMIZA (payload → '{}'): es un ledger
--     append-only cuya utilidad es el HECHO (hubo una cita, se canceló, en
--     qué fecha) — el dato personal vive en `payload` (el webhook de Cal.com
--     guarda el evento entero: nombre, correo, respuestas del formulario).
--     Se vacía el payload y se conserva el renglón. `clave_idempotencia` y
--     `externo_id` se quedan: son identificadores opacos del EVENTO en el
--     sistema de origen (uid de Cal.com), necesarios para que un webhook
--     retrasado no re-inserte lo purgado, y no llevan nombre ni correo. Si
--     algún día una fuente los llenara con un correo, ese día se amplía esto.
--
-- ── Idempotencia ────────────────────────────────────────────────────────────
-- `create or replace` en las tres funciones; re-aplicarla no cambia nada.
-- `mantenimiento_de_datos` se REDEFINE con la firma de siempre (integer,
-- timestamptz), TODAS las llaves de la 0165 (el bloque 120 de
-- verificaciones.sql exige conservar `prospectoPersonasPurgadas`) y una
-- nueva: `comercialEventosAnonimizados`.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.purgar_prospecto_persona(
  p_dias integer default 365,
  p_ahora timestamptz default now()
) returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  borradas bigint;
  limite timestamptz := p_ahora - make_interval(days => p_dias);
begin
  -- Un prospecto FRÍO: sin trato vivo y sin toque dentro del plazo. Los
  -- estados fríos incluyen los sinónimos que la 0181 trajo del CRM público
  -- ('lost' es 'perdido', 'no-show'/'cancelled' son citas que murieron);
  -- 'appointment'/'rescheduled'/'demo'/'proposal'/'pilot'/'negociacion'/
  -- 'cerrado'/'won' son una relación viva o un contrato y ahí aplica otra
  -- base (la relación misma).
  delete from public.prospecto_persona pp
   using public.prospecto p
   where p.id = pp.prospecto_id
     and p.estado in ('nuevo', 'contactado', 'perdido', 'lost', 'no-show', 'cancelled')
     and p.created_at < limite
     and pp.created_at < limite
     and (pp.conservar_hasta is null or pp.conservar_hasta < p_ahora)
     and not exists (
       select 1 from public.prospecto_contacto c
        where c.prospecto_id = p.id and c.ocurrio_en >= limite
     );
  get diagnostics borradas = row_count;

  -- TODOS los datos de la PERSONA en la fila del prospecto: los cinco de la
  -- 0191 (nombre, teléfono, correo, notas, clave del CRM con el correo
  -- adentro) MÁS los mensajes redactados (llevan el nombre de pila repuesto
  -- en el cuerpo) y la atribución del lead (fbclid/gclid identifican a quien
  -- llenó el formulario). `mensajes_generados_en`/`mensajes_modelo` se anulan
  -- con los mensajes por el CHECK `prospecto_mensajes_coherentes` (0129) — y
  -- porque una fecha de generación sin mensaje no dice nada.
  -- `empresa`/`ciudad`/`vacante`/`estado` se QUEDAN: son datos del NEGOCIO.
  update public.prospecto p
     set contacto_nombre = null, telefono = null, correo = null, notas = null,
         lead_clave = null,
         mensaje_wa = null, mensaje_correo_asunto = null, mensaje_correo = null,
         mensajes_generados_en = null, mensajes_modelo = null,
         atribucion = null,
         updated_at = p_ahora
   where p.estado in ('nuevo', 'contactado', 'perdido', 'lost', 'no-show', 'cancelled')
     and p.created_at < limite
     and (p.contacto_nombre is not null or p.telefono is not null
          or p.correo is not null or p.notas is not null or p.lead_clave is not null
          or p.mensaje_wa is not null or p.mensaje_correo is not null
          or p.mensaje_correo_asunto is not null or p.atribucion is not null)
     and not exists (
       select 1 from public.prospecto_contacto c
        where c.prospecto_id = p.id and c.ocurrio_en >= limite
     );

  return borradas;
end;
$$;

comment on function public.purgar_prospecto_persona is
  'Purga por inactividad (0148 → 0191 → 0245): borra prospecto_persona y anula TODO dato de persona en la fila del prospecto frío (contacto_nombre/telefono/correo/notas/lead_clave + mensajes redactados + atribucion), respetando conservar_hasta. Estados fríos incluyen los sinónimos del CRM de la 0181 (lost/no-show/cancelled). Lo que /aviso/prospectos promete.';

revoke all on function public.purgar_prospecto_persona(integer, timestamptz) from public;
revoke all on function public.purgar_prospecto_persona(integer, timestamptz) from anon;
revoke all on function public.purgar_prospecto_persona(integer, timestamptz) from authenticated;
grant execute on function public.purgar_prospecto_persona(integer, timestamptz) to service_role;

-- ── El ledger comercial (0181): el hecho se queda, el dato personal se va ──
create or replace function public.purgar_comercial_evento(
  p_dias integer default 365,
  p_ahora timestamptz default now()
) returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  anonimizadas bigint;
  limite timestamptz := p_ahora - make_interval(days => p_dias);
begin
  if p_dias < 30 then
    raise exception 'purgar_comercial_evento: % días es demasiado poco; el mínimo es 30', p_dias using errcode = 'PU001';
  end if;
  update public.comercial_evento
     set payload = '{}'::jsonb, error = null
   where ocurrido_en < limite
     and (payload <> '{}'::jsonb or error is not null);
  get diagnostics anonimizadas = row_count;
  return anonimizadas;
end;
$$;

comment on function public.purgar_comercial_evento is
  'Anonimiza los eventos del ledger comercial con más de p_dias (default 365): vacía payload (ahí vive lo personal que Cal.com manda entero — nombre, correo, respuestas) y error (puede citar el payload). La fila se conserva: el ledger es append-only y su valor es el hecho, no la persona. La llama mantenimiento_de_datos.';

revoke all on function public.purgar_comercial_evento(integer, timestamptz) from public;
revoke all on function public.purgar_comercial_evento(integer, timestamptz) from anon;
revoke all on function public.purgar_comercial_evento(integer, timestamptz) from authenticated;
grant execute on function public.purgar_comercial_evento(integer, timestamptz) to service_role;

-- ── `mantenimiento_de_datos` aprende la llave nueva ─────────────────────────
-- Cuerpo de la 0165 ÍNTEGRO (cada purga en su bloque, fallos acumulados,
-- `parcial` si algo falló) más un bloque y una llave. Si otra migración
-- posterior la redefine, tiene que conservar TODAS las llaves — el bloque
-- 120 de verificaciones.sql exige `prospectoPersonasPurgadas` y el bloque de
-- la 0245 exige `comercialEventosAnonimizados`.
create or replace function public.mantenimiento_de_datos(
  p_dias_wa integer default 30,
  p_ahora timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  vence timestamptz := clock_timestamp() + interval '60 seconds';
  wa jsonb := '{}'::jsonb; eventos jsonb := '{}'::jsonb; posiciones jsonb := '{}'::jsonb;
  llm jsonb := '{}'::jsonb; bitacora jsonb := '{}'::jsonb; cobranza jsonb := '{}'::jsonb;
  storage_huerfano jsonb := '{}'::jsonb;
  ia_consolidados bigint := 0; idem_purgadas bigint := 0; correo_purgado bigint := 0;
  corridas_purgadas bigint := 0; conversaciones_purgadas bigint := 0;
  codigos_purgados bigint := 0; personas_purgadas bigint := 0;
  comercial_anonimizados bigint := 0;
  fallos text[] := '{}';
begin
  begin wa := public.purgar_wa_mensaje_procesado(p_dias_wa, p_ahora, vence);
  exception when others then fallos := fallos || ('wa_mensaje_procesado: ' || sqlerrm); end;
  begin ia_consolidados := public.consolidar_llm_costo_mensual(p_ahora);
  exception when others then fallos := fallos || ('consolidar_llm_costo: ' || sqlerrm); end;
  begin idem_purgadas := public.purgar_api_idempotencia(7, p_ahora);
  exception when others then fallos := fallos || ('api_idempotencia: ' || sqlerrm); end;
  begin correo_purgado := public.purgar_correo_procesado(90, p_ahora);
  exception when others then fallos := fallos || ('correo_procesado: ' || sqlerrm); end;
  begin corridas_purgadas := public.purgar_agente_corrida(180, p_ahora);
  exception when others then fallos := fallos || ('agente_corrida: ' || sqlerrm); end;
  begin conversaciones_purgadas := public.purgar_wa_conversacion(180, p_ahora);
  exception when others then fallos := fallos || ('wa_conversacion: ' || sqlerrm); end;
  begin codigos_purgados := public.purgar_codigo_pendiente(180, p_ahora);
  exception when others then fallos := fallos || ('codigo_pendiente: ' || sqlerrm); end;
  begin personas_purgadas := public.purgar_prospecto_persona(365, p_ahora);
  exception when others then fallos := fallos || ('prospecto_persona: ' || sqlerrm); end;
  begin comercial_anonimizados := public.purgar_comercial_evento(365, p_ahora);
  exception when others then fallos := fallos || ('comercial_evento: ' || sqlerrm); end;
  begin eventos := public.purgar_wa_evento_pendiente(30, 90, p_ahora, vence);
  exception when others then fallos := fallos || ('wa_evento_pendiente: ' || sqlerrm); end;
  begin posiciones := public.purgar_posicion(90, p_ahora, vence);
  exception when others then fallos := fallos || ('posicion: ' || sqlerrm); end;
  begin llm := public.purgar_llm_costo(13, p_ahora, vence);
  exception when others then fallos := fallos || ('llm_costo: ' || sqlerrm); end;
  begin bitacora := public.purgar_bitacora_auditoria(365, p_ahora, vence);
  exception when others then fallos := fallos || ('bitacora_auditoria: ' || sqlerrm); end;
  begin cobranza := public.purgar_cobranza_contacto(180, p_ahora, vence);
  exception when others then fallos := fallos || ('cobranza_contacto: ' || sqlerrm); end;
  begin storage_huerfano := public.limpiar_storage_huerfano(7, 500, p_ahora, vence);
  exception when others then fallos := fallos || ('storage_huerfano: ' || sqlerrm); end;

  return jsonb_build_object(
    'waPurgados', coalesce((wa->>'borradas')::bigint, 0),
    'diasWa', p_dias_wa,
    'iaConsolidados', ia_consolidados,
    'llmCostoPurgado', coalesce((llm->>'borradas')::bigint, 0),
    'idempotenciaPurgada', idem_purgadas,
    'correoPurgado', correo_purgado,
    'corridasPurgadas', corridas_purgadas,
    'conversacionesPurgadas', conversaciones_purgadas,
    'codigosPurgados', codigos_purgados,
    'prospectoPersonasPurgadas', personas_purgadas,
    'comercialEventosAnonimizados', comercial_anonimizados,
    'waEventosPurgados', coalesce((eventos->>'borradas')::bigint, 0),
    'posicionesPurgadas', coalesce((posiciones->>'borradas')::bigint, 0),
    'bitacoraPurgada', coalesce((bitacora->>'borradas')::bigint, 0),
    'cobranzaContactosPurgados', coalesce((cobranza->>'borradas')::bigint, 0),
    'storageHuerfanoMarcado', coalesce((storage_huerfano->>'marcados')::bigint, 0),
    'storageHuerfanoRevisado', coalesce((storage_huerfano->>'revisados')::bigint, 0),
    'fallos', to_jsonb(fallos),
    'parcial', coalesce((wa->>'parcial')::boolean, false) or coalesce((eventos->>'parcial')::boolean, false)
             or coalesce((posiciones->>'parcial')::boolean, false) or coalesce((llm->>'parcial')::boolean, false)
             or coalesce((bitacora->>'parcial')::boolean, false) or coalesce((cobranza->>'parcial')::boolean, false)
             or coalesce((storage_huerfano->>'parcial')::boolean, false)
             or cardinality(fallos) > 0,
    'corridaEn', p_ahora
  );
end;
$$;

revoke all on function public.mantenimiento_de_datos(integer, timestamptz) from public, anon, authenticated;
grant execute on function public.mantenimiento_de_datos(integer, timestamptz) to service_role;
