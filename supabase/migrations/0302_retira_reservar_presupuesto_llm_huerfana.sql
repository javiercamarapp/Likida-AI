-- ═══════════════════════════════════════════════════════════════════════════
-- 0302 — Retira el overload huérfano de 6 argumentos de
-- `reservar_presupuesto_llm` (auditoría de graduación de agentes,
-- 2-sep-2026).
--
-- La función existe hoy en Postgres con DOS firmas: la de 6 argumentos
-- (creada en 0186, vuelta a crear igual en 0193) y la de 8 argumentos —
-- `+ p_proposito, p_reserva_interactivo_usd` — creada en 0244. `create or
-- replace function` NO reemplaza un signature distinto: crea un overload
-- nuevo al lado, y nadie retiró el viejo cuando 0244 desplegó el nuevo.
--
-- Confirmado por grep exhaustivo de `src/`: el único call-site real
-- (`src/lib/llm/budget.ts`) llama con los 8 argumentos NOMBRADOS —
-- PostgREST resuelve el overload de 8 por el nombre de los parámetros, así
-- que el de 6 lleva desde 0244 sin un solo caller. No es un riesgo de
-- seguridad (mismos GRANTs que el de 8), es superficie muerta: dos firmas
-- con el mismo nombre y comportamiento parecido invitan al próximo cambio a
-- tocar la que no es.
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists public.reservar_presupuesto_llm(
  uuid, uuid, uuid, numeric, numeric, numeric
);
