-- ═══════════════════════════════════════════════════════════════════════════
-- 0148 · RETENCIÓN DE LAS PERSONAS DE PROSPECTOS — auditoría 18 (C2).
--
-- `prospecto_persona` (0138) y `prospecto.contacto_nombre` (0105) guardan
-- nombre, puesto, correo y teléfono de personas físicas que NO contrataron
-- nada con Likida. Frente a ellas Likida es RESPONSABLE (LFPDPPP art. 14), y
-- nada en el esquema de prospectos (0105-0141) ni en `mantenimiento_de_datos`
-- (0104) purgaba esos datos: se quedaban para siempre. El aviso de prospectos
-- (/aviso/prospectos, privacidad.ts → avisoProspectos) promete que "a los 12
-- meses sin ningún contacto" se borran; ESTA migración es lo que lo ejecuta.
-- Mismo criterio que la 0104: la página solo promete plazos que algo corre.
--
-- ── La regla ────────────────────────────────────────────────────────────────
-- Se borra a la PERSONA (fila de prospecto_persona) y se anula
-- `prospecto.contacto_nombre` cuando el prospecto:
--   · no es cliente ni está en trato: estado in ('nuevo','contactado','perdido')
--     — `demo`/`negociacion`/`cerrado` son una relación viva o un contrato, y
--     ahí aplica otra base (la relación misma); y
--   · lleva más de p_dias sin un solo toque en `prospecto_contacto` (0118, en
--     las dos direcciones) — o, si nunca hubo toque, desde que se capturó el
--     prospecto (`prospecto.created_at`) y la persona (`prospecto_persona.created_at`).
-- La EMPRESA (nombre, giro, plaza, vacante, notas) NO se toca: no es dato de
-- una persona. Las notas pueden traer nombres en prosa; eso se trata aguas
-- arriba (seudonimo.ts no los manda al modelo) y a solicitud ARCO.
--
-- ── `conservar_hasta` ───────────────────────────────────────────────────────
-- Columna nueva: un freno explícito por persona. NULL = regla general; una
-- fecha = no se purga antes de ella (p. ej. un ARCO de acceso en curso, o un
-- decisor que pidió "escríbanme en enero"). Se pone a mano desde el Cerebro;
-- la purga la respeta y el bloque 120 de verificaciones.sql lo comprueba.
--
-- ── Idempotencia ────────────────────────────────────────────────────────────
-- `add column if not exists`, `create or replace function`. Reaplicarla no
-- cambia nada. Y `mantenimiento_de_datos` se REDEFINE con la firma de siempre
-- (integer, timestamptz) y las mismas llaves de la 0104 más una:
-- `prospectoPersonasPurgadas`. El cron (/api/cron/purgar) no se toca.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.prospecto_persona
  add column if not exists conservar_hasta timestamptz;

comment on column public.prospecto_persona.conservar_hasta is
  'Freno explícito a la purga por inactividad (0148): NULL = regla general (365 días sin toque); una fecha = no se borra antes de ella. Para ARCO en curso o una cita futura pactada con la persona.';

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
  -- Un prospecto FRÍO: sin trato vivo y sin toque dentro del plazo. Se
  -- evalúa en línea (sin tabla temporal: una función que se llama desde un
  -- cron no debe depender de planes cacheados sobre relaciones temporales).
  delete from public.prospecto_persona pp
   using public.prospecto p
   where p.id = pp.prospecto_id
     and p.estado in ('nuevo', 'contactado', 'perdido')
     and p.created_at < limite
     and pp.created_at < limite
     and (pp.conservar_hasta is null or pp.conservar_hasta < p_ahora)
     and not exists (
       select 1 from public.prospecto_contacto c
        where c.prospecto_id = p.id and c.ocurrio_en >= limite
     );
  get diagnostics borradas = row_count;

  -- El contacto "de cabecera" del prospecto es la misma clase de dato.
  update public.prospecto p
     set contacto_nombre = null, updated_at = p_ahora
   where p.estado in ('nuevo', 'contactado', 'perdido')
     and p.created_at < limite
     and p.contacto_nombre is not null
     and not exists (
       select 1 from public.prospecto_contacto c
        where c.prospecto_id = p.id and c.ocurrio_en >= limite
     );

  return borradas;
end;
$$;

comment on function public.purgar_prospecto_persona is
  'Borra las personas (prospecto_persona) y el contacto_nombre de prospectos sin trato vivo (nuevo/contactado/perdido) y sin ningún toque en prospecto_contacto en los últimos p_dias (default 365), respetando conservar_hasta. Lo que /aviso/prospectos promete. La llama mantenimiento_de_datos.';

revoke all on function public.purgar_prospecto_persona(integer, timestamptz) from public;
revoke all on function public.purgar_prospecto_persona(integer, timestamptz) from anon;
revoke all on function public.purgar_prospecto_persona(integer, timestamptz) from authenticated;
grant execute on function public.purgar_prospecto_persona(integer, timestamptz) to service_role;

-- `mantenimiento_de_datos` aprende la llave nueva. Cuerpo de la 0104 íntegro
-- más una línea: si otra migración posterior la redefine, tiene que conservar
-- `prospectoPersonasPurgadas` — el bloque 120 de verificaciones.sql lo exige.
create or replace function public.mantenimiento_de_datos(
  p_dias_wa integer default 30,
  p_ahora timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  wa_purgados bigint;
  ia_consolidados bigint;
  idem_purgadas bigint;
  correo_purgado bigint;
  corridas_purgadas bigint;
  conversaciones_purgadas bigint;
  codigos_purgados bigint;
  personas_purgadas bigint;
begin
  wa_purgados := public.purgar_wa_mensaje_procesado(p_dias_wa, p_ahora);
  ia_consolidados := public.consolidar_llm_costo_mensual(p_ahora);
  idem_purgadas := public.purgar_api_idempotencia(7, p_ahora);
  correo_purgado := public.purgar_correo_procesado(90, p_ahora);
  corridas_purgadas := public.purgar_agente_corrida(180, p_ahora);
  conversaciones_purgadas := public.purgar_wa_conversacion(180, p_ahora);
  codigos_purgados := public.purgar_codigo_pendiente(180, p_ahora);
  personas_purgadas := public.purgar_prospecto_persona(365, p_ahora);
  return jsonb_build_object(
    'waPurgados', wa_purgados,
    'diasWa', p_dias_wa,
    'iaConsolidados', ia_consolidados,
    'llmCostoPurgado', false,
    'idempotenciaPurgada', idem_purgadas,
    'correoPurgado', correo_purgado,
    'corridasPurgadas', corridas_purgadas,
    'conversacionesPurgadas', conversaciones_purgadas,
    'codigosPurgados', codigos_purgados,
    'prospectoPersonasPurgadas', personas_purgadas,
    'corridaEn', p_ahora
  );
end;
$$;

revoke all on function public.mantenimiento_de_datos(integer, timestamptz) from public;
revoke all on function public.mantenimiento_de_datos(integer, timestamptz) from anon;
revoke all on function public.mantenimiento_de_datos(integer, timestamptz) from authenticated;
grant execute on function public.mantenimiento_de_datos(integer, timestamptz) to service_role;
