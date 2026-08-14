-- ═══════════════════════════════════════════════════════════════════════════
-- 0090 — Los hitos del chofer (14-ago-2026, F4 del plan).
--
-- Lo que Transportes Innovativos pidió con sus palabras: el chofer avisa
-- "ya llegué", "estoy descargando", "voy de regreso" por WhatsApp y eso
-- queda SELLADO en el viaje. Tres timestamps y no una tabla de eventos a
-- propósito: un viaje de carga federal tiene UN destino, y cada hito pasa
-- una vez. El día que haya multi-parada, esa será su migración.
--
-- Mismo patrón de sello que avisado_en/aceptado_en (0058): se escribe con
-- UPDATE ... WHERE <col> IS NULL — el primer mensaje gana, el repetido
-- recibe "ya lo tenía anotado" y no mueve la hora. La hora es la del
-- servidor al recibir el mensaje, que es la verdad que tenemos (no la hora
-- del evento físico, y el producto no la presenta como tal).
--
-- La espera en patio (dolor #3 del mapa de dolores: $30k–$96k/día en un
-- CEDIS de 30 unidades) se vuelve medible: descarga_en - llegada_en.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.viaje
  add column llegada_en timestamptz,
  add column descarga_en timestamptz,
  add column regreso_en timestamptz;

comment on column public.viaje.llegada_en is
  'Sello del hito "ya llegué" por WhatsApp (0090). Hora de recepción del mensaje, no del evento físico.';
comment on column public.viaje.descarga_en is
  'Sello del hito "estoy descargando" (0090). descarga_en - llegada_en = espera en patio medible.';
comment on column public.viaje.regreso_en is
  'Sello del hito "voy de regreso" (0090).';
