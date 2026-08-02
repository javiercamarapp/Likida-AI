-- REVIERTE la 0038 — el mecanismo `foto_pendiente` se quita del camino activo.
--
-- AUDITORÍA 9, CRÍTICO (dos auditores independientes, agéntico y backend). El
-- reclamo (`reclamarFotoPendiente(tenantId, { viajeId })`, processor.ts)
-- tomaba CUALQUIER foto pendiente del viaje sin verificar que fuera el par
-- correcto: si mientras un ticket sin código esperaba llegaba OTRA foto con
-- código de un gasto DISTINTO (un voucher, otra caseta con QR propio), el
-- sistema los fusionaba — el código se pegaba al ticket equivocado y el gasto
-- real de la segunda foto desaparecía de la liquidación sin aviso, sin log.
--
-- El ahorro que perseguía (~$0.015 por ticket de dos fotos, evitando una
-- segunda llamada de visión) no justifica el riesgo de perder un gasto real
-- de la liquidación, a 5 días del demo. Decisión de Javier, 1-ago-2026.
--
-- La tabla nunca tuvo tráfico de producción (Likida es pre-revenue): DROP
-- limpio, sin migración de datos que preservar.

drop table if exists foto_pendiente;
