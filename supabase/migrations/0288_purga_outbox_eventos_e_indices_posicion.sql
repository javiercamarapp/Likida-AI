-- ═══════════════════════════════════════════════════════════════════════════
-- AUDITORÍA 24 · DAT-9 / REN-4 (MEDIO) — DOS TABLAS SIN PLAZO Y SEIS ÍNDICES
-- EN `posicion` DE LOS QUE NINGUNO SIRVE A LA PURGA.
--
-- ── LO QUE CRECÍA SIN RETENCIÓN ───────────────────────────────────────────
-- `wa_outbox` (0180) guarda una fila `sent`/`dead` con su `payload` jsonb por
-- cada mensaje saliente; con 15,000 viajes/mes son 100-150k filas/mes y nadie
-- las borraba (grep de `delete from wa_outbox` en 257 migraciones y en src/:
-- 0). `evento_seguridad_flota` (0203) recibe la telemetría de cámara de 800
-- unidades sin ventana. Ninguna tiene valor fiscal ni legal; la segunda lleva
-- lat/lng del chofer, que el aviso promete no conservar sin plazo (LEG-6).
--
-- Se añaden `purgar_wa_outbox` (90 días sobre sent/dead; lo pending/sending
-- JAMÁS se toca: es trabajo por hacer) y `purgar_evento_seguridad_flota`
-- (180 días los no graves; 365 los graves —un choque/volcadura es constancia
-- de siniestro un año; el expediente de asistencia vive en `incidencia`—), y
-- `mantenimiento_de_datos` las llama con el mismo molde de la 0155 (tandas,
-- `p_vence`, fallos acumulados y `parcial` declarado).
--
-- ── LOS ÍNDICES DE `posicion` ─────────────────────────────────────────────
-- Catálogo vivo antes de esta migración: pkey + `posicion_sin_duplicado
-- (unidad_id, medida_en, proveedor)` + `posicion_tenant_medida_idx (tenant_id,
-- medida_en desc)` + `posicion_unidad_medida_idx (tenant_id, unidad_id,
-- medida_en desc)` + `uq_posicion_lectura (tenant_id, unidad_id, medida_en)`.
--
--   · `posicion_unidad_medida_idx` es la MISMA clave que `uq_posicion_lectura`
--     (un btree se recorre hacia atrás igual de bien): 230k escrituras/día
--     duplicadas por nada. SE QUEDA, aun así: el bloque GPS_0176 de
--     `verificaciones.sql` (mucho anterior a esta ronda) asevera por NOMBRE
--     que existe, y ese bloque no es de esta migración para reescribirlo.
--     Retirarlo es correcto y sigue pendiente; exige cambiar GPS_0176 en el
--     mismo movimiento, y va anotado en el CIERRE de la auditoría 24 en vez de
--     dejar la batería roja.
--   · `posicion_sin_duplicado` es un único MÁS LAXO que `uq_posicion_lectura`
--     (permite la misma lectura con dos proveedores); ningún `on conflict` de
--     src/ lo nombra (el poller usa `tenant_id,unidad_id,medida_en`), y ningún
--     bloque de la batería lo nombra. Se retira.
--   · La purga borra `where medida_en < X` (sin tenant) y NINGÚN índice
--     empezaba por `medida_en`: cada tanda de 50k era un scan de heap. Se
--     añade `posicion_medida_idx (medida_en)`. Neto: se queda igual (uno
--     retirado, uno añadido) y la purga deja de barrer el heap.
--
-- Los dos índices nuevos de purga (`wa_outbox_purga_idx`, parcial sobre
-- sent/dead; `evento_seguridad_ocurrido_idx`) siguen la regla de la 0155:
-- «que las purgas entren por índice».
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Índices ──────────────────────────────────────────────────────────────
drop index if exists public.posicion_sin_duplicado;
create index if not exists posicion_medida_idx on public.posicion (medida_en);
create index if not exists wa_outbox_purga_idx
  on public.wa_outbox (creada_en) where estado in ('sent', 'dead');
create index if not exists evento_seguridad_ocurrido_idx
  on public.evento_seguridad_flota (ocurrido_en);

-- ── 2. wa_outbox ────────────────────────────────────────────────────────────
create or replace function public.purgar_wa_outbox(
  p_dias integer default 90,
  p_ahora timestamptz default now(),
  p_vence timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_dias < 30 then
    raise exception 'purgar_wa_outbox: % días es demasiado poco; el mínimo es 30', p_dias using errcode = 'PU001';
  end if;
  return public.purgar_en_tandas(
    'public.wa_outbox'::regclass,
    format('estado in (''sent'', ''dead'') and creada_en < %L', p_ahora - make_interval(days => p_dias)),
    p_vence);
end;
$$;
comment on function public.purgar_wa_outbox is
  'Borra de la bandeja de salida de WhatsApp lo ya enviado (sent) y las cartas muertas (dead) creadas hace más de p_dias (90). Lo pending/sending nunca se toca. La llama mantenimiento_de_datos (0288).';
revoke all on function public.purgar_wa_outbox(integer, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.purgar_wa_outbox(integer, timestamptz, timestamptz) to service_role;

-- ── 3. evento_seguridad_flota ───────────────────────────────────────────────
create or replace function public.purgar_evento_seguridad_flota(
  p_dias integer default 180,
  p_dias_graves integer default 365,
  p_ahora timestamptz default now(),
  p_vence timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  leves jsonb; graves jsonb;
begin
  if p_dias < 90 or p_dias_graves < p_dias then
    raise exception 'purgar_evento_seguridad_flota: plazos demasiado cortos (mínimo 90 días; los graves no pueden durar menos que los leves)'
      using errcode = 'PU001';
  end if;
  leves := public.purgar_en_tandas(
    'public.evento_seguridad_flota'::regclass,
    format('not grave and ocurrido_en < %L', p_ahora - make_interval(days => p_dias)),
    p_vence);
  graves := public.purgar_en_tandas(
    'public.evento_seguridad_flota'::regclass,
    format('grave and ocurrido_en < %L', p_ahora - make_interval(days => p_dias_graves)),
    p_vence);
  return jsonb_build_object(
    'borradas', (leves->>'borradas')::bigint + (graves->>'borradas')::bigint,
    'parcial', (leves->>'parcial')::boolean or (graves->>'parcial')::boolean);
end;
$$;
comment on function public.purgar_evento_seguridad_flota is
  'Borra la telemetría de cámara/GPS del proveedor: los eventos no graves a los p_dias (180) y los graves (choque/volcadura) a los p_dias_graves (365) — el expediente de asistencia que abrieron vive en incidencia. Lleva lat/lng del chofer: es un plazo de privacidad, no solo de espacio. La llama mantenimiento_de_datos (0288).';
revoke all on function public.purgar_evento_seguridad_flota(integer, integer, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.purgar_evento_seguridad_flota(integer, integer, timestamptz, timestamptz) to service_role;

-- ── 4. mantenimiento_de_datos: se copia la ÚLTIMA definición (0258) y se
--       añaden las dos purgas. Cabecera tal cual: SECURITY DEFINER, search_path
--       public, pg_temp. ────────────────────────────────────────────────────
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
  'Purga nocturna (cron /api/cron/purgar). 0288 añade wa_outbox (90 d sobre sent/dead) y evento_seguridad_flota (180 d; graves 365 d) a las purgas de la 0155-0258; devuelve waOutboxPurgado y eventosSeguridadPurgados. Cada purga corre en su propio bloque: un fallo se acumula en `fallos` y no tumba a las demás.';
