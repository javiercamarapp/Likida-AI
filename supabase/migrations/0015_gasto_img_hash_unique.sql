-- FASE 2 R1: cerrar el race de fotos idénticas en el MISMO lote. El pre-check
-- (gastoExistePorHash) atrapa el reenvío tras el acuse, pero dos fotos idénticas
-- en el mismo Promise.all podían pre-checar ambas antes de insertar → duplicado.
-- Un índice ÚNICO sobre (tenant_id, viaje_id, img_hash) lo hace atómico: la 2ª
-- inserción choca con 23505 y el processor la trata como duplicado.
--
-- Los NULL son DISTINTOS por default en índices únicos de Postgres → las fotos sin
-- hash (flag CUADRA_DEDUP_FOTOS apagado) NO chocan entre sí: camino actual intacto.
drop index if exists idx_gasto_viaje_hash;
create unique index if not exists uq_gasto_img_hash on gasto (tenant_id, viaje_id, img_hash);
