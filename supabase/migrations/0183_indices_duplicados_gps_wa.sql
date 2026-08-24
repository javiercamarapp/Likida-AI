-- Los advisors de producción detectaron que 0176/0177 recreaban índices con
-- otro nombre pero exactamente la misma definición. Cada copia cobra en cada
-- INSERT y no mejora ningún plan. Se conserva el nombre que el código y las
-- verificaciones actuales conocen.
drop index if exists public.posicion_unidad_tiempo_idx;
drop index if exists public.wa_evento_pendiente_lease_idx;
