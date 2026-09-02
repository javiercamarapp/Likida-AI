-- ═══════════════════════════════════════════════════════════════════════════
-- AUDITORÍA 24 · BE-22 (BAJO) — UNA ORDEN DEL BUS LA CIERRA QUIEN LA TOMÓ.
--
-- `worker/bus/[accion]` reclama con el estado anclado en el WHERE
-- (`ordenes-claim`: `.eq('estado','pendiente')`, la atomicidad vive ahí), pero
-- la CIERRA con `.eq('id', id)` a secas. Con dos workers en la misma Mac —o
-- uno viejo que revivió con un id en la mano— el worker B marca `hecha` la
-- orden que tomó A, y `resultado` cuenta lo que hizo B sobre el trabajo de A.
-- Es bitácora interna (por eso BAJO), pero es una bitácora que miente.
--
-- El estado ya se puede anclar sin tocar el esquema; el DUEÑO no, porque la
-- 0127 no lo guarda: `bus_orden` sabe quién CREÓ la orden (`creado_por`) y
-- cuándo se tomó (`tomada_en`), no QUIÉN la tomó. Esta columna cierra ese
-- hueco. Es la misma llave con la que ya se autentica el worker
-- (`worker_llave`, 0135), así que el servidor la conoce sin que el cliente
-- mande nada nuevo.
--
-- Anulable a propósito: las órdenes ya tomadas antes de esta migración no
-- tienen dueño y no se les inventa uno. La ruta lo trata como el resto del
-- producto trata lo que no sabe — no lo adivina: si la orden no trae dueño,
-- el ancla por dueño no aplica y queda solo el ancla por estado.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.bus_orden
  add column if not exists tomada_por text;

comment on column public.bus_orden.tomada_por is
  'Nombre del worker que reclamó la orden (worker_llave.nombre, 0135). NULL en las tomadas antes de la 0285. AUDITORÍA 24, BE-22: cerrar una orden exige ser quien la tomó.';
