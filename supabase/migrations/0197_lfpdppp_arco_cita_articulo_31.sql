-- ═══════════════════════════════════════════════════════════════════════════
-- 0197 — CITA CORRECTA DEL PLAZO ARCO: art. 31, no art. 32
--
-- LFPDPPP vigente (2025): el art. 31 es el que fija el plazo de 20 días para
-- que el responsable comunique su determinación sobre una solicitud ARCO, y
-- los 15 días siguientes para hacerla efectiva si procede (texto verificado
-- contra la fuente oficial, ordenjuridico.gob.mx). El art. 32 regula OTRA
-- cosa — cómo se cumple el acceso (copias, medio electrónico) — no el plazo.
--
-- `privacidad.ts` (venceArco/DIAS_HABILES_ARCO) ya citaba correctamente el
-- art. 31; el `comment on table` de la 0053 se quedó con el 32. Se corrige
-- aquí, no editando la 0053 — las migraciones ya aplicadas no se tocan.
-- ═══════════════════════════════════════════════════════════════════════════

comment on table public.solicitud_arco is
  'Derechos ARCO del titular (el OPERADOR). Likida es encargado y la flota responsable. vence_en se guarda porque un plazo calculado al leer se vence sin que nadie lo vea (LFPDPPP art. 31).';
