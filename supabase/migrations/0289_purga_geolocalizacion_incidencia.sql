-- ═══════════════════════════════════════════════════════════════════════════
-- AUDITORÍA 24 · LEG-6 (ALTO) — «SE BORRA A LOS 90 DÍAS» ERA FALSO PARA DOS
-- DE LOS TRES ALMACENES DE GEOLOCALIZACIÓN.
--
-- El aviso de privacidad que la flota pone al chofer (`privacidad.ts`,
-- «Sobre tu ubicación … Se borra a los 90 días») era verdad para `posicion`
-- (purga de la 0155) y mentira para el pin de asistencia: `asistencia_wa.ts`
-- (`anclarUbicacionIncidencia`) escribe `incidencia.lat/lng` y anota un
-- `incidencia_evento` tipo `ubicacion_anclada` con `detalle = {lat, lng}` — y
-- ninguna purga los tocaba. Art. 11 LFPDPPP: el plazo afirmado en el
-- documento probatorio tiene que ejecutarse.
--
-- ── EL PLAZO ──────────────────────────────────────────────────────────────
-- 90 días contados desde que la incidencia se RESOLVIÓ (`resuelta_en`), no
-- desde el pin: mientras el expediente está abierto la ubicación es la
-- herramienta con la que la mesa manda la grúa. Se retira SOLO la
-- geolocalización; el renglón de la incidencia y su bitácora sobreviven —son
-- el hecho operativo del siniestro (mismo criterio que la 0273 para el texto
-- libre: lo que se cancela es el dato personal, no el hecho de la flota)—.
-- En `incidencia_evento.detalle` se quitan las llaves `lat`/`lng` y se deja
-- una marca `geolocalizacion_purgada_en` para que nadie lea el hueco como
-- «nunca hubo pin».
--
-- El plazo del resto del expediente (texto, contacto de emergencia, jornada)
-- es una decisión legal pendiente del abogado (LEG-6, segunda mitad); esta
-- migración cierra la promesa que YA está escrita en el aviso.
-- ═══════════════════════════════════════════════════════════════════════════

-- Índice parcial para que la purga nocturna no barra todas las incidencias.
create index if not exists incidencia_geo_purga_idx
  on public.incidencia (resuelta_en)
  where estado = 'resuelta' and (lat is not null or lng is not null);

create or replace function public.purgar_geolocalizacion_incidencia(
  p_dias integer default 90,
  p_ahora timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  corte timestamptz;
  n_incidencias bigint; n_eventos bigint;
begin
  if p_dias < 30 then
    raise exception 'purgar_geolocalizacion_incidencia: % días es demasiado poco; el mínimo es 30', p_dias using errcode = 'PU001';
  end if;
  corte := p_ahora - make_interval(days => p_dias);

  -- Primero la bitácora (mira `incidencia.resuelta_en`, que no cambia), luego
  -- la incidencia: así una corrida cortada a la mitad no deja el pin del
  -- evento vivo con el de la incidencia ya borrado.
  update public.incidencia_evento e
     set detalle = (coalesce(e.detalle, '{}'::jsonb) - 'lat' - 'lng')
                   || jsonb_build_object('geolocalizacion_purgada_en', p_ahora)
    from public.incidencia i
   where i.id = e.incidencia_id
     and i.estado = 'resuelta'
     and i.resuelta_en < corte
     and (e.detalle ? 'lat' or e.detalle ? 'lng');
  get diagnostics n_eventos = row_count;

  update public.incidencia
     set lat = null, lng = null
   where estado = 'resuelta'
     and resuelta_en < corte
     and (lat is not null or lng is not null);
  get diagnostics n_incidencias = row_count;

  return jsonb_build_object('incidencias', n_incidencias, 'eventos', n_eventos);
end;
$$;
comment on function public.purgar_geolocalizacion_incidencia is
  'Retira lat/lng de las incidencias RESUELTAS hace más de p_dias (90) y las llaves lat/lng de sus incidencia_evento (deja geolocalizacion_purgada_en). Es la ejecución del «se borra a los 90 días» del aviso de privacidad para el pin de asistencia (LEG-6, auditoría 24). No borra renglones: el hecho del siniestro se conserva. La llama mantenimiento_de_datos (0289).';
revoke all on function public.purgar_geolocalizacion_incidencia(integer, timestamptz) from public, anon, authenticated;
grant execute on function public.purgar_geolocalizacion_incidencia(integer, timestamptz) to service_role;

-- mantenimiento_de_datos: la ÚLTIMA definición (0288) más esta purga.
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
  prospectos jsonb := '{}'::jsonb;
  outbox jsonb := '{}'::jsonb; seguridad jsonb := '{}'::jsonb;
  geo_incidencia jsonb := '{}'::jsonb;
  ia_consolidados bigint := 0; idem_purgadas bigint := 0; correo_purgado bigint := 0;
  corridas_purgadas bigint := 0; conversaciones_purgadas bigint := 0;
  codigos_purgados bigint := 0;
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
  begin prospectos := public.purgar_prospecto_persona(365, p_ahora);
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
  -- 0288 (auditoría 24, DAT-9/REN-4): las dos tablas que crecían sin plazo.
  begin outbox := public.purgar_wa_outbox(90, p_ahora, vence);
  exception when others then fallos := fallos || ('wa_outbox: ' || sqlerrm); end;
  begin seguridad := public.purgar_evento_seguridad_flota(180, 365, p_ahora, vence);
  exception when others then fallos := fallos || ('evento_seguridad_flota: ' || sqlerrm); end;
  begin geo_incidencia := public.purgar_geolocalizacion_incidencia(90, p_ahora);
  exception when others then fallos := fallos || ('incidencia_geolocalizacion: ' || sqlerrm); end;

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
    'prospectoPersonasPurgadas', coalesce((prospectos->>'personasBorradas')::bigint, 0),
    'prospectoCorreosPurgados', coalesce((prospectos->>'correosBorrados')::bigint, 0),
    'prospectoPiezasPurgadas', coalesce((prospectos->>'piezasBorradas')::bigint, 0),
    'prospectoDossiersAnonimizados', coalesce((prospectos->>'dossiersAnonimizados')::bigint, 0),
    'prospectoToquesAnonimizados', coalesce((prospectos->>'toquesAnonimizados')::bigint, 0),
    'comercialEventosAnonimizados', comercial_anonimizados,
    'waEventosPurgados', coalesce((eventos->>'borradas')::bigint, 0),
    'posicionesPurgadas', coalesce((posiciones->>'borradas')::bigint, 0),
    'bitacoraPurgada', coalesce((bitacora->>'borradas')::bigint, 0),
    'cobranzaContactosPurgados', coalesce((cobranza->>'borradas')::bigint, 0),
    'storageHuerfanoMarcado', coalesce((storage_huerfano->>'marcados')::bigint, 0),
    'storageHuerfanoRevisado', coalesce((storage_huerfano->>'revisados')::bigint, 0),
    'waOutboxPurgado', coalesce((outbox->>'borradas')::bigint, 0),
    'eventosSeguridadPurgados', coalesce((seguridad->>'borradas')::bigint, 0),
    'incidenciaGeoPurgada', coalesce((geo_incidencia->>'incidencias')::bigint, 0),
    'incidenciaEventoGeoPurgado', coalesce((geo_incidencia->>'eventos')::bigint, 0),
    'fallos', to_jsonb(fallos),
    'parcial', coalesce((wa->>'parcial')::boolean, false) or coalesce((eventos->>'parcial')::boolean, false)
             or coalesce((posiciones->>'parcial')::boolean, false) or coalesce((llm->>'parcial')::boolean, false)
             or coalesce((bitacora->>'parcial')::boolean, false) or coalesce((cobranza->>'parcial')::boolean, false)
             or coalesce((storage_huerfano->>'parcial')::boolean, false)
             or coalesce((outbox->>'parcial')::boolean, false) or coalesce((seguridad->>'parcial')::boolean, false)
             or cardinality(fallos) > 0,
    'corridaEn', p_ahora
  );
end;
$$;

comment on function public.mantenimiento_de_datos(integer, timestamptz) is
  'Purga nocturna (cron /api/cron/purgar). 0288: wa_outbox y evento_seguridad_flota. 0289: geolocalización de incidencias resueltas (90 d; devuelve incidenciaGeoPurgada e incidenciaEventoGeoPurgado). Cada purga corre en su propio bloque: un fallo se acumula en `fallos` y no tumba a las demás.';
