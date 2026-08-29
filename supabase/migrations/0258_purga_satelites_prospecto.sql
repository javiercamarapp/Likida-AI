-- ═══════════════════════════════════════════════════════════════════════════
-- 0258 · LA PURGA ALCANZA TODAS LAS TABLAS COLGADAS DE `prospecto` — auditoría
-- adversarial tandas 21-24, hallazgo 1 (ALTO), cuarta pasada del tema
-- (0148 → 0191 → 0245 → esta).
--
-- ── LO MEDIDO (28-ago-2026, contra producción) ──────────────────────────────
--
-- /aviso/prospectos promete, cableado (privacidad.ts fr. IV): «a los N meses
-- sin ningún contacto, tu nombre, puesto, correo y teléfono se eliminan
-- automáticamente». La 0245 auditó columna por columna la tabla `prospecto`
-- y NO tocó las tablas satélite que nacieron un día antes en otro fork
-- (0217). Aplicando el MISMO filtro de frialdad de `purgar_prospecto_persona`
-- con p_dias=0 contra producción:
--
--   · `prospecto_correo` (0217): 1,414 filas de 852 prospectos fríos
--     sobreviven íntegras — correo, contacto_nombre y puesto, un correo por
--     fila; 286 con forma `nombre.apellido@` (persona física identificable).
--     El aviso incluso declara que algunos correos «se dedujeron»: están
--     DENTRO de su ámbito. En 12 meses la promesa cableada falla.
--   · `cola_aprobacion` (0117): 27 piezas `correo_frio` de prospectos fríos
--     conservan `titulo`/`cuerpo`/`cuerpo_final` — el borrador COMPLETO, con
--     el nombre de pila de la persona repuesto adentro («Hola Ramón, …»).
--     Es la TERCERA tabla satélite que nadie había visto: el mismo argumento
--     con el que la 0245 anuló `mensaje_wa` («el nombre guardado en prosa»)
--     aplica literal a estas piezas.
--   · `prospecto_dossier` (0217): 25 dossiers de prospectos fríos; 0 con
--     `telefonos` hoy, pero la columna existe PARA guardar teléfonos y 2
--     dossiers traen correos dentro de `datos` (arreglo de hallazgos con
--     fuente). Se anonimizan `telefonos` y `datos`; `historia`/`empleados`/
--     `flotilla`/`fuentes` son datos de la EMPRESA (medido: 0 con '@') y se
--     quedan — LFPDPPP protege personas, no razones sociales.
--   · `prospecto_toque` (0130): 8 toques de fríos, todos con `resumen` NULL
--     hoy — pero `resumen` es texto libre («la nota manual también cabe») y
--     puede llevar nombres en prosa. Se anula; canal/fecha/actor (el actor es
--     personal de Likida, no el prospecto) se quedan: el hecho sin la prosa.
--
-- La 0245 falló por mirar UNA tabla. Esta no repite el error mirando dos:
-- barre TODAS las FK a `prospecto` (pg_constraint, medido contra producción:
-- prospecto_persona, prospecto_contacto, prospecto_toque, cola_aprobacion,
-- comercial_evento, prospecto_correo, prospecto_dossier, y el self-FK
-- `duplicado_de`), y el bloque 206 de verificaciones.sql lo vuelve
-- ESTRUCTURAL: toda tabla nueva con FK a `prospecto` tiene que aparecer en la
-- purga o en la lista de exentas con razón escrita, o el CI truena.
--
-- ── LAS DOS EXENTAS, con su razón (la misma que exige el bloque 206) ────────
--
--   · `prospecto_contacto` (0118): índice de la relación SIN datos de persona
--     POR DISEÑO (su schema: «SIN el cuerpo completo ni datos personales de
--     más»; medido: 0 resúmenes con '@'). Y es el INSUMO del filtro de
--     frialdad: purgarlo destruiría el instrumento que decide qué purgar.
--   · `comercial_evento` (0181): ya la anonimiza `purgar_comercial_evento`
--     (0245) por EDAD del evento, con o sin prospecto — un criterio más
--     amplio que la frialdad (payload de Cal.com llega también sin
--     prospecto_id). Medido: 0 payloads no vacíos de prospectos fríos.
--
-- ── HALLAZGO 5 (BAJO), resuelto aquí porque es esta misma función ───────────
--
-- La 0245 dejó una asimetría sin razonar: el DELETE de `prospecto_persona`
-- respetaba `conservar_hasta` y el UPDATE de `prospecto` anulaba mensajes y
-- atribución SIN consultarlo. Se resuelve en el sentido de RESPETARLO EN TODO
-- EL EXPEDIENTE: un `conservar_hasta` vigente en cualquier persona del
-- prospecto congela la pasada COMPLETA (personas, fila del prospecto y
-- satélites). Por qué en este sentido y no en el otro:
--
--   1. Los DOS usos declarados del freno (0148) lo piden: en un ARCO en
--      disputa, los mensajes redactados y la atribución pueden ser LA
--      EVIDENCIA del tratamiento reclamado — purgarlos a media disputa es
--      destruir lo que el ejercicio pide examinar; y en «escríbanme en
--      enero», anular el correo/teléfono de la fila del prospecto (lo que el
--      vendedor usa para escribir) mientras se conserva la fila de la
--      persona era exactamente al revés de lo pactado con el decisor.
--   2. El freno es EXPLÍCITO, con fecha, puesto por un humano desde el
--      Cerebro: retener de más durante un plazo acotado y deliberado es el
--      error barato; destruir evidencia es el caro.
--
-- El bloque 120 de verificaciones.sql se reescribe acorde (la persona frenada
-- se siembra en su PROPIO prospecto frío y se comprueba que su expediente
-- entero sobrevive).
--
-- ── EL FILTRO DE FRIALDAD, FACTORIZADO ──────────────────────────────────────
--
-- La 0245 repetía el filtro en dos statements y ya habían divergido una vez
-- (la lista de estados de la 0181 entró al DELETE y al UPDATE en momentos
-- distintos). Ahora se evalúa UNA vez, a un arreglo local (`v_frios`), y
-- todos los DML cuelgan de él: no puede divergir porque no existe dos veces.
-- Sin tabla temporal (la lección de la 0148: una función de cron no debe
-- depender de planes cacheados sobre relaciones temporales); un arreglo de
-- ~10³ uuids en memoria no le pesa a nadie.
--
-- ── Borrar vs. anonimizar, tabla por tabla ──────────────────────────────────
--
--   · `prospecto_persona` → DELETE: la fila entera es la persona (0245).
--   · `prospecto` → UPDATE a NULL: la fila es la EMPRESA (0245).
--   · `prospecto_correo` → DELETE: cada fila es UN correo de UNA persona con
--     su nombre y puesto; no queda nada de empresa que conservar. Sin
--     condición de edad por columna — mismo criterio que el UPDATE de la
--     0245: la frialdad es del PROSPECTO, no de la fila (un correo cosechado
--     ayer para una persona 13 meses sin contacto sigue siendo la persona).
--   · `cola_aprobacion` → DELETE de las piezas del prospecto frío: `cuerpo`
--     es NOT NULL (no se puede anonimizar en sitio) y el índice de «qué se
--     mandó» ya vive en `prospecto_contacto.resumen`, que se queda. La única
--     FK entrante (prospecto_contacto.pieza_id) es ON DELETE SET NULL:
--     borrar no rompe nada.
--   · `prospecto_dossier` → UPDATE: `telefonos`/`datos` a NULL (ahí vive lo
--     personal); la ficha de empresa se queda.
--   · `prospecto_toque` → UPDATE: `resumen` a NULL; el hecho (canal, fecha,
--     actor interno) se queda — mismo contrato que `comercial_evento`.
--
-- ── Idempotencia y contrato ─────────────────────────────────────────────────
--
-- `purgar_prospecto_persona` cambia de retorno (bigint → jsonb: ahora reporta
-- cinco cifras, no una), así que se hace DROP + CREATE con la MISMA firma de
-- entrada (integer, timestamptz) — el bloque 120 comprueba el privilegio por
-- esa firma y sigue resolviendo. Su único consumidor era
-- `mantenimiento_de_datos`, que se redefine aquí mismo con TODAS las llaves
-- de la 0245 (los bloques 120/127/137/201 exigen `prospectoPersonasPurgadas`
-- y `comercialEventosAnonimizados`) más cuatro nuevas:
-- `prospectoCorreosPurgados`, `prospectoPiezasPurgadas`,
-- `prospectoDossiersAnonimizados`, `prospectoToquesAnonimizados`.
-- Re-aplicar la migración no cambia nada.
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists public.purgar_prospecto_persona(integer, timestamptz);

create function public.purgar_prospecto_persona(
  p_dias integer default 365,
  p_ahora timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  limite timestamptz := p_ahora - make_interval(days => p_dias);
  v_frios uuid[];
  personas bigint; correos bigint; piezas bigint; dossiers bigint; toques bigint;
begin
  -- EL filtro de frialdad, evaluado UNA vez (ver cabecera de la 0258). Un
  -- prospecto FRÍO: sin trato vivo (estados fríos de la 0181 incluidos), sin
  -- toque dentro del plazo, y SIN freno vigente en ninguna de sus personas —
  -- `conservar_hasta` congela el expediente completo (hallazgo 5, 0258).
  select coalesce(array_agg(p.id), '{}') into v_frios
    from public.prospecto p
   where p.estado in ('nuevo', 'contactado', 'perdido', 'lost', 'no-show', 'cancelled')
     and p.created_at < limite
     and not exists (
       select 1 from public.prospecto_contacto c
        where c.prospecto_id = p.id and c.ocurrio_en >= limite
     )
     and not exists (
       select 1 from public.prospecto_persona pp
        where pp.prospecto_id = p.id
          and pp.conservar_hasta is not null and pp.conservar_hasta >= p_ahora
     );

  -- La fila entera es la persona → DELETE. `pp.created_at < limite` se queda
  -- (0148): una persona recién capturada no ha cumplido su plazo aunque el
  -- prospecto sí. El chequeo de `conservar_hasta` por fila es redundante con
  -- el filtro de arriba A PROPÓSITO — cinturón y tirantes por si el filtro
  -- cambiara sin releer esto.
  delete from public.prospecto_persona pp
   where pp.prospecto_id = any(v_frios)
     and pp.created_at < limite
     and (pp.conservar_hasta is null or pp.conservar_hasta < p_ahora);
  get diagnostics personas = row_count;

  -- TODOS los datos de la PERSONA en la fila del prospecto (0245):
  -- `empresa`/`ciudad`/`vacante`/`estado` se QUEDAN — son del NEGOCIO.
  update public.prospecto p
     set contacto_nombre = null, telefono = null, correo = null, notas = null,
         lead_clave = null,
         mensaje_wa = null, mensaje_correo_asunto = null, mensaje_correo = null,
         mensajes_generados_en = null, mensajes_modelo = null,
         atribucion = null,
         updated_at = p_ahora
   where p.id = any(v_frios)
     and (p.contacto_nombre is not null or p.telefono is not null
          or p.correo is not null or p.notas is not null or p.lead_clave is not null
          or p.mensaje_wa is not null or p.mensaje_correo is not null
          or p.mensaje_correo_asunto is not null or p.atribucion is not null);

  -- 0217: correo + contacto_nombre + puesto, una persona por fila → DELETE.
  delete from public.prospecto_correo pc
   where pc.prospecto_id = any(v_frios);
  get diagnostics correos = row_count;

  -- 0117: el borrador completo con el nombre de pila adentro → DELETE.
  delete from public.cola_aprobacion ca
   where ca.prospecto_id = any(v_frios);
  get diagnostics piezas = row_count;

  -- 0217: teléfonos y hallazgos con datos de persona fuera; la ficha de la
  -- EMPRESA (historia/empleados/flotilla/fuentes) se queda.
  update public.prospecto_dossier d
     set telefonos = null, datos = null
   where d.prospecto_id = any(v_frios)
     and (d.telefonos is not null or d.datos is not null);
  get diagnostics dossiers = row_count;

  -- 0130: la prosa fuera; el hecho (canal, fecha, actor interno) se queda.
  update public.prospecto_toque t
     set resumen = null
   where t.prospecto_id = any(v_frios)
     and t.resumen is not null;
  get diagnostics toques = row_count;

  return jsonb_build_object(
    'personasBorradas', personas,
    'correosBorrados', correos,
    'piezasBorradas', piezas,
    'dossiersAnonimizados', dossiers,
    'toquesAnonimizados', toques
  );
end;
$$;

comment on function public.purgar_prospecto_persona is
  'Purga por inactividad (0148 → 0191 → 0245 → 0258): sobre el prospecto frío (sin trato vivo, sin toque en p_dias, sin conservar_hasta vigente en NINGUNA de sus personas — el freno congela el expediente entero) borra prospecto_persona, anula todo dato de persona en la fila del prospecto, BORRA sus prospecto_correo y sus piezas de cola_aprobacion, y anonimiza prospecto_dossier (telefonos/datos) y prospecto_toque (resumen). Exentas con razón: prospecto_contacto (sin datos de persona por diseño; es el instrumento de frialdad) y comercial_evento (la anonimiza purgar_comercial_evento por edad). El bloque 206 exige que toda FK nueva a prospecto se decida aquí o se exente por escrito. Lo que /aviso/prospectos promete.';

revoke all on function public.purgar_prospecto_persona(integer, timestamptz) from public;
revoke all on function public.purgar_prospecto_persona(integer, timestamptz) from anon;
revoke all on function public.purgar_prospecto_persona(integer, timestamptz) from authenticated;
grant execute on function public.purgar_prospecto_persona(integer, timestamptz) to service_role;

-- ── `mantenimiento_de_datos` aprende las llaves nuevas ──────────────────────
-- Cuerpo de la 0245 ÍNTEGRO (cada purga en su bloque, fallos acumulados,
-- `parcial` si algo falló); cambia SOLO el bloque de prospectos (ahora
-- recibe jsonb) y las cuatro llaves nuevas. Si otra migración posterior la
-- redefine, tiene que conservar TODAS las llaves — los bloques 120/127/137/
-- 201 y el 205 de verificaciones.sql lo exigen.
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
