-- ═══════════════════════════════════════════════════════════════════════════
-- 0104 — LA RETENCIÓN OPERATIVA QUE /privacidad PROMETÍA SIN EJECUTOR
-- (hallazgo E5, auditoría 4).
--
-- La página publicada prometía plazos de borrado y no existía función que
-- borrara nada de lo prometido. La regla del repo es la misma para una cifra
-- que para una promesa legal: si la pantalla lo dice, algo lo ejecuta. Esta
-- migración pone a correr los dos plazos operativos que faltaban; el texto de
-- la página se corrige en el mismo cambio para decir EXACTAMENTE lo que estas
-- funciones hacen.
--
-- QUÉ SÍ SE PURGA (operativo/conversacional, nada fiscal):
--
--   · `wa_conversacion` sin actividad en 180 días. Su `estado` jsonb guarda
--     los últimos turnos de la charla con el chofer — texto libre que puede
--     traer cualquier dato personal — y hoy vivía para siempre. Borrar la
--     fila es seguro por diseño: `loadConversation` (conv.ts) la recrea en el
--     siguiente mensaje (insert + relectura si pierde la carrera del índice
--     único), `desdeFila` ya descarta los turnos cuando el viaje cambió, los
--     pendientes de despacho caducan a los 30 minutos (VIGENCIA_PENDIENTE_MS)
--     y `comprobante_huerfano.ofrecido_en` vive FUERA del estado justamente
--     porque el estado se pierde. Lo único que muere con la fila es la
--     memoria de una conversación que lleva medio año muda.
--
--   · `codigo_pendiente` con más de 180 días esperando. La bandeja empareja
--     en minutos u horas (el acercamiento y su ticket llegan en la misma
--     ráfaga) y `reclamarCodigoPendiente` (repo.ts) BORRA la fila al
--     emparejar — lo que queda aquí es solo lo que nunca encontró pareja. Un
--     código que en 180 días no encontró su comprobante ya no lo va a
--     encontrar: su viaje se liquidó sin él o el operador re-mandó la foto.
--     Ese folio jamás entró a un gasto ni a una liquidación, así que borrarlo
--     no toca contabilidad de nadie.
--
-- QUÉ NO SE PURGA, A PROPÓSITO:
--
--   · NADA FISCAL. `gasto`, `cfdi_xml`, `liquidacion`, `viaje`, `factura_*`:
--     el CFF art. 30 obliga a CONSERVARLO al menos cinco años — y más en sus
--     tres supuestos (ver `normas/cff-30.yaml`, `limite_importante`). Una
--     purga que tocara esas tablas le borraría al cliente el respaldo que la
--     ley LE obliga a guardar.
--   · `comprobante_huerfano`. Su propia ficha (0040) lo dice: "No se borra:
--     es el rastro de un comprobante que existió". Los adjuntados ya viven en
--     `gasto` (fiscal); los descartados y pendientes son imágenes de
--     comprobantes — el lado conservador es tratarlos como lo fiscal.
--   · `bitacora_auditoria`. Append-only por diseño (0053): un registro de
--     auditoría con purga automática deja de servir como evidencia.
--   · `chat_conversacion`/`chat_mensaje`. Es el historial que el cliente pidió
--     GUARDADO (0088) — borrárselo por cron sería quitarle una feature, no
--     cumplir una promesa de privacidad.
--
-- SIN ÍNDICE NUEVO, A PROPÓSITO: `wa_conversacion` tiene una fila por
-- (tenant, teléfono) y en `codigo_pendiente` solo sobreviven los códigos sin
-- pareja — las dos son tablas chicas por construcción, y un índice por fecha
-- cobraría en cada escritura para ahorrarle un seq scan a un cron diario.
--
-- Mismo patrón que la 0101: SECURITY DEFINER con su revoke — la verificación
-- 75 vigila el conjunto.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.purgar_wa_conversacion(
  p_dias integer default 180,
  p_ahora timestamptz default now()
) returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare borradas bigint;
begin
  delete from public.wa_conversacion
   where updated_at < p_ahora - make_interval(days => p_dias);
  get diagnostics borradas = row_count;
  return borradas;
end;
$$;

comment on function public.purgar_wa_conversacion is
  'Borra el estado conversacional de WhatsApp sin actividad en p_dias (default 180). Seguro: loadConversation (conv.ts) recrea la fila en el siguiente mensaje. La llama mantenimiento_de_datos.';

revoke all on function public.purgar_wa_conversacion(integer, timestamptz) from public;
revoke all on function public.purgar_wa_conversacion(integer, timestamptz) from anon;
revoke all on function public.purgar_wa_conversacion(integer, timestamptz) from authenticated;
grant execute on function public.purgar_wa_conversacion(integer, timestamptz) to service_role;

create or replace function public.purgar_codigo_pendiente(
  p_dias integer default 180,
  p_ahora timestamptz default now()
) returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare borradas bigint;
begin
  delete from public.codigo_pendiente
   where creado_en < p_ahora - make_interval(days => p_dias);
  get diagnostics borradas = row_count;
  return borradas;
end;
$$;

comment on function public.purgar_codigo_pendiente is
  'Borra los códigos de facturación que llevan más de p_dias (default 180) sin encontrar su comprobante. Los emparejados ya no están: reclamarCodigoPendiente (repo.ts) los borra al usarlos. La llama mantenimiento_de_datos.';

revoke all on function public.purgar_codigo_pendiente(integer, timestamptz) from public;
revoke all on function public.purgar_codigo_pendiente(integer, timestamptz) from anon;
revoke all on function public.purgar_codigo_pendiente(integer, timestamptz) from authenticated;
grant execute on function public.purgar_codigo_pendiente(integer, timestamptz) to service_role;

-- `mantenimiento_de_datos` aprende las dos llaves nuevas (misma firma que
-- 0098/0101/0102: el cron de purgar llama la RPC única y no hay que tocarlo).
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
begin
  wa_purgados := public.purgar_wa_mensaje_procesado(p_dias_wa, p_ahora);
  ia_consolidados := public.consolidar_llm_costo_mensual(p_ahora);
  idem_purgadas := public.purgar_api_idempotencia(7, p_ahora);
  correo_purgado := public.purgar_correo_procesado(90, p_ahora);
  corridas_purgadas := public.purgar_agente_corrida(180, p_ahora);
  conversaciones_purgadas := public.purgar_wa_conversacion(180, p_ahora);
  codigos_purgados := public.purgar_codigo_pendiente(180, p_ahora);
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
    'corridaEn', p_ahora
  );
end;
$$;

revoke all on function public.mantenimiento_de_datos(integer, timestamptz) from public;
revoke all on function public.mantenimiento_de_datos(integer, timestamptz) from anon;
revoke all on function public.mantenimiento_de_datos(integer, timestamptz) from authenticated;
grant execute on function public.mantenimiento_de_datos(integer, timestamptz) to service_role;
