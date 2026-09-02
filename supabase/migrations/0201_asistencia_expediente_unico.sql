-- 0201 · AUDITORÍA FABLE CICLO 1 (92-E) — un expediente de asistencia por chofer.
--
-- `atenderAsistenciaChofer` hacía check-then-create sin candado: dos webhooks
-- concurrentes del mismo chofer (mensajes DISTINTOS — `claimMessage` solo
-- dedupe el mismo wa_message_id) podían ambos ver "no hay abierta" y abrir
-- DOS incidencias con DOS 🚨 al jefe, y la que nadie reconociera seguiría
-- escalando por su cuenta en la Fase 5.
--
-- El candado es la semántica del circuito hecha constraint: UN expediente de
-- asistencia abierto por chofer. La severidad de un reporte nuevo sube EN el
-- expediente (UPDATE de tipo/prioridad + aviso nuevo), no en una fila nueva —
-- y el código, al recibir el unique_violation de la carrera, relee el
-- expediente ganador y sigue por el camino de "mensaje adicional".
--
-- Parcial a propósito:
--   · solo los tipos del circuito de asistencia — la talacha (`averia`) y el
--     resto del OS&D operativo no compiten;
--   · solo abiertas — resolver libera al chofer para el siguiente expediente;
--   · solo con operador — las incidencias de oficina (operador NULL) y las
--     del panel quedan fuera.

create unique index if not exists incidencia_asistencia_abierta_unica
  on public.incidencia (tenant_id, operador_id)
  where tipo in ('siniestro', 'robo', 'emergencia_medica', 'varado', 'bloqueo')
    and estado <> 'resuelta'
    and operador_id is not null;

comment on index public.incidencia_asistencia_abierta_unica is
  'Un expediente de asistencia ABIERTO por chofer (0201). La carrera check-then-create del webhook la gana exactamente uno; el perdedor relee y anota su mensaje en el expediente del ganador. La severidad sube en el mismo expediente, nunca en una fila paralela.';
