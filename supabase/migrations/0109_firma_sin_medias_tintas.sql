-- ═══════════════════════════════════════════════════════════════════════════
-- 0109 — La firma de la talacha no admite medias tintas.
--
-- La atrapó la verificación 85 EN SU PRIMERA CORRIDA REAL (14-ago-2026): el
-- check de la 0107 dice "hay firma completa ⇔ hay decisión", pero evaluado
-- sobre una incidencia PENDIENTE con solo `autorizada_en` puesto da
-- false = false → pasa. Es decir: se podía estampar la FECHA de una decisión
-- que no ocurrió (o el quién sin el cuándo) mientras la solicitud siguiera
-- pendiente. Nadie del código escribe eso hoy — `talacha_wa.ts` firma los
-- tres campos en un solo UPDATE — pero el constraint existe justo para lo
-- que el código no promete, y el bloque 85 esperaba el rebote (esperado t,
-- salió f).
--
-- El check nuevo ata CADA campo de la firma a la decisión por separado:
-- decidida ⇔ tiene quién, y decidida ⇔ tiene cuándo. Media firma imposible
-- en cualquier estado.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.incidencia
  drop constraint incidencia_decision_firmada;

alter table public.incidencia
  add constraint incidencia_decision_firmada
    check (
      ((autorizacion in ('autorizada', 'rechazada')) = (autorizada_por is not null))
      and
      ((autorizacion in ('autorizada', 'rechazada')) = (autorizada_en is not null))
    );

comment on constraint incidencia_decision_firmada on incidencia is
  'Decidida ⇔ firmada, campo por campo (0109; la 0107 dejaba pasar media firma sobre una pendiente — atrapado por la verificación 85). También el rechazo se firma.';
