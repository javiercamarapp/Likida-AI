-- ═══════════════════════════════════════════════════════════════════════════
-- AUDITORÍA 25 · agentico.md:455 (ALTO, REINCIDENTE de la 24) — «tu jefe ya
-- tiene la solicitud» se afirmaba sin comprobarlo.
--
-- `avisarAlJefe` (talacha_wa.ts) devuelve `true` solo si Meta aceptó el
-- envío, pero ese resultado vivía SOLO en una variable local (`avisado`) del
-- turno que lo intentó. `pendienteDelViaje` leía `id, monto_estimado,
-- evidencia_path, gasto_id` — ninguna columna decía si el aviso había
-- salido — así que el turno SIGUIENTE (el chofer repite el reporte, o manda
-- la foto de la nota) no tenía con qué desmentirse y contestaba «tu jefe ya
-- tiene la solicitud» aunque el primer intento hubiera fallado (Meta 131047
-- por re-engagement, un blip de red).
--
-- `avisada_jefe_en` persiste el HECHO, no una promesa: NULL hasta que
-- `sendButtons` de verdad aceptó el envío. El turno siguiente ahora puede
-- reintentar en vez de reafirmar.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.incidencia add column if not exists avisada_jefe_en timestamptz;

comment on column public.incidencia.avisada_jefe_en is
  'NULL = el aviso al jefe (WhatsApp, avisarAlJefe en talacha_wa.ts) no se ha entregado todavía. Se sella solo cuando sendButtons devuelve éxito — nunca al crear la incidencia. Auditoría 25, agentico.md:455: antes ese hecho vivía solo en una variable local del turno que lo intentó, y el turno siguiente no tenía con qué desmentir "tu jefe ya tiene la solicitud".';
