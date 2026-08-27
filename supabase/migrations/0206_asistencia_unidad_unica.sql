-- 0206 · AUDITORÍA FABLE CICLO 2 (c2-8) — un expediente de asistencia por
-- UNIDAD cuando no hay chofer identificable. Espejo del 0201.
--
-- El disparo por cámara ata el expediente a la UNIDAD cuando la unidad no
-- tiene viaje vigente (o el chofer es ambiguo): `operador_id` NULL. La dedupe
-- de ese caso era solo check-then-act — dos corridas de cron solapadas
-- (posible: cadencia de 5 min contra maxDuration de 300 s) procesando dos
-- eventos graves distintos de la misma unidad podían abrir DOS incidencias
-- con DOS 🚨 al jefe, y el comentario del código afirmaba una garantía que
-- ningún constraint respaldaba.
--
-- Parcial con el mismo criterio del 0201:
--   · solo los tipos del circuito de asistencia — la talacha (`averia`) y el
--     OS&D operativo no compiten;
--   · solo abiertas — resolver libera a la unidad para el siguiente;
--   · solo SIN operador y CON unidad — cuando el chofer se conoce rige el
--     0201 (por chofer), y las incidencias de oficina sin unidad ni operador
--     quedan fuera de los dos candados.

create unique index if not exists incidencia_asistencia_unidad_unica
  on public.incidencia (tenant_id, unidad_id)
  where tipo in ('siniestro', 'robo', 'emergencia_medica', 'varado', 'bloqueo')
    and estado <> 'resuelta'
    and operador_id is null
    and unidad_id is not null;

comment on index public.incidencia_asistencia_unidad_unica is
  'Un expediente de asistencia ABIERTO por unidad cuando no hay chofer identificable (0206, espejo del 0201). La carrera de dos corridas de cron con eventos graves de la misma unidad la gana exactamente uno; el perdedor relee y anota su detección en el expediente del ganador.';
