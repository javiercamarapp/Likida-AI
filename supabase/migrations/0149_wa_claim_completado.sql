-- ═══════════════════════════════════════════════════════════════════════════
-- 0149 — `wa_mensaje_procesado.completado_en`: reclamado ≠ completado.
--
-- AUDITORÍA 18, CRÍTICO (C5) + ALTO (A3, A27). El claim de idempotencia (0002)
-- se toma en la PRIMERA línea de `processInbound`, antes de hacer nada, y solo
-- se soltaba en el `catch` o en cuatro `return` tempranos. Una muerte por
-- `maxDuration` no ejecuta ninguno: la fila quedaba tomada hasta la purga de
-- 30 días (0072). Cinco minutos después, el cron de la bandeja durable (0119)
-- reclamaba la fila pendiente, `claimMessage` devolvía 'duplicado' —que
-- significaba "ya hecho"— y el cron SELLABA `procesado_en` sobre un mensaje
-- que nunca corrió el OCR. El sistema reportaba éxito; el gasto no existía.
--
-- EL ARREGLO: la fila distingue "reclamado" de "completado". `completado_en`
-- lo pone `completarMessageClaim` al final de un turno que sí terminó. Ante
-- 23505, `claimMessage` mira la fila:
--   · completado_en puesto                         → duplicado de verdad
--   · sin completar y created_at más viejo que el  → claim huérfano: se
--     lease (LEASE_CLAIM_MS = maxDuration + 30s)     RETOMA con UPDATE anclado
--   · sin completar y fresco                       → en curso en otra invocación
--
-- Aditiva e idempotente: las filas viejas quedan con NULL y, por su
-- `created_at`, se leen como huérfanas retomables — que es exactamente lo
-- que son si no se completaron, y un reenvío de Meta ya no las alcanza.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.wa_mensaje_procesado
  add column if not exists completado_en timestamptz;

comment on column public.wa_mensaje_procesado.completado_en is
  'Cuándo terminó el turno que reclamó este wamid (auditoría 18, C5). NULL = reclamado pero no completado: si created_at es más viejo que el lease (LEASE_CLAIM_MS en conv.ts), es un claim huérfano de una invocación muerta y claimMessage lo retoma con un UPDATE anclado en vez de reportarlo como duplicado.';
