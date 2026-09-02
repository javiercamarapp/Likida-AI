-- ═══════════════════════════════════════════════════════════════════════════
-- AUDITORÍA 24 · AGEN-4 (ALTO) — toda muerte posterior al commit del cierre
-- aterrizaba en el mismo renglón, y ese renglón no mandaba el PDF que existe
-- ni avisaba al jefe.
--
-- `guardar_liquidacion_tx` commitea (viaje `liquidado`, fila en `liquidacion`
-- con `pdf_url`, los dos PDF en Storage) y DESPUÉS, en el mismo turno, se
-- entrega: `say(resumen)` → `sendDocument(PDF)` → `avisarCierreAlJefe`. Si
-- Vercel mata la invocación entre el commit y cualquiera de esos tres pasos
-- (C8, C10, C11, C12, C13 de la tabla de puntos de muerte), la base queda
-- cerrada y nadie se entera: el cron reprocesa el «listo», `getOpenViaje` es
-- null y el chofer lee «pídeselo a tu contralor». Ningún reintento sabía que
-- faltaba entregar porque la entrega no dejaba marca.
--
-- Dos sellos, nulos hasta que ocurre lo que nombran:
--   · `entregada_operador_en`  — Meta aceptó el PDF del operador.
--   · `avisada_oficina_en`     — el aviso de cierre al jefe salió (texto o
--                                 plantilla, o el PDF del contralor).
-- El reintento del «listo» (processor.ts, rama sin viaje abierto) los lee:
-- lo que está en null se entrega y se sella; lo sellado no se repite.
--
-- Índice parcial por tenant para el barrido de «liquidaciones de las últimas
-- 24 h sin entregar» (pendiente, cron): pequeño por construcción, porque
-- casi todas las filas quedan selladas en su propio turno.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.liquidacion add column if not exists entregada_operador_en timestamptz;
alter table public.liquidacion add column if not exists avisada_oficina_en    timestamptz;

comment on column public.liquidacion.entregada_operador_en is
  'Cuándo Meta aceptó el PDF del operador por WhatsApp (AGEN-4). Null = falta entregar; el reintento del «listo» lo manda y sella.';
comment on column public.liquidacion.avisada_oficina_en is
  'Cuándo salió el aviso de cierre a la oficina (texto/plantilla o PDF del contralor). Null = falta avisar.';

create index if not exists liquidacion_entrega_pendiente_idx
  on public.liquidacion (tenant_id, created_at)
  where entregada_operador_en is null or avisada_oficina_en is null;
