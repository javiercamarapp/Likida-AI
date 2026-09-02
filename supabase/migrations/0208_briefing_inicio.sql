-- 0208 · BRIEFING DE INICIO DE VIAJE (orden post-plan-maestro #4, ficha §7.1).
--
-- El sello de idempotencia del briefing. El briefing se intenta en DOS
-- momentos —al despachar (mejor esfuerzo: la ventana de 24 h del chofer suele
-- estar cerrada y el texto libre no entra) y cuando el chofer confirma el
-- viaje (su mensaje abre la ventana y el texto sí llega)— y el chofer debe
-- recibirlo UNA vez: dos briefings idénticos enseñan a ignorar el canal, que
-- es el mismo argumento del aviso de asignación (notificar.ts).
--
-- Es el patrón de `avisado_en` (mismo archivo de destino, mismo contrato):
-- una marca de tiempo nullable que solo escribe el UPDATE condicional
-- `is('briefing_enviado_en', null)` DESPUÉS de que Meta aceptó el mensaje —
-- la lección c2-1 de la auditoría Fable ciclo 2: sellar antes de enviar
-- convierte un fallo transitorio en un silencio permanente. Sin constraint
-- de unicidad porque no hay tabla de eventos que deduplicar: la fila del
-- viaje ES el registro, y el UPDATE condicional es atómico en Postgres.

alter table public.viaje
  add column if not exists briefing_enviado_en timestamptz;

comment on column public.viaje.briefing_enviado_en is
  'Cuándo salió el briefing de inicio al chofer (0208). NULL = aún no sale — se reintenta al confirmar el viaje. Solo lo escribe briefing_inicio_wa.ts, tras un envío que Meta aceptó, con UPDATE condicional sobre NULL (un briefing por viaje).';
