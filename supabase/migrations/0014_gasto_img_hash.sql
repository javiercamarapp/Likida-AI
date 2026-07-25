-- FASE 2 (NIVEL 2): dedup de fotos por CONTENIDO. La idempotencia por
-- waMessageId cubre los reintentos de Meta, pero si el operador reenvía la MISMA
-- foto a mano (otro waMessageId) se duplicaba el gasto. Guardamos el SHA-256 de
-- la imagen y consultamos por (viaje_id, img_hash) antes de re-OCR / re-insertar.
-- Columna nullable → sin impacto en el camino actual (fotos sin hash siguen igual).
alter table gasto add column if not exists img_hash text;
create index if not exists idx_gasto_viaje_hash on gasto (viaje_id, img_hash);
