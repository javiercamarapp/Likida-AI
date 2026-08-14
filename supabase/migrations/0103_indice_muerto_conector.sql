-- ═══════════════════════════════════════════════════════════════════════════
-- 0103 — UN ÍNDICE MUERTO MENOS (hallazgo F4, auditoría 4).
--
-- `conector_credencial_por_flota` era parcial sobre (tenant_id, conector_id)
-- WHERE activo... y el UNIQUE `conector_credencial_unica` de la misma 0094 ya
-- cubre ESAS MISMAS columnas, completo. Toda búsqueda por igualdad que el
-- parcial serviría la sirve el unique; el parcial solo cobraba su
-- mantenimiento en cada INSERT/UPDATE sin responder una sola consulta que el
-- otro no pudiera. Se tira.
-- ═══════════════════════════════════════════════════════════════════════════

drop index if exists public.conector_credencial_por_flota;
