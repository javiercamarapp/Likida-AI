-- ═══════════════════════════════════════════════════════════════════════════
-- 0645 — Liquidación externa: los teléfonos de la copia y del aviso de discrepancia se capturan SIN formato de Excel.
--
-- La 0564 exigía `formato` (la plantilla derivada del Excel de muestra) para guardar, además, a quién se copia y a quién
-- se avisa. Una flota que usa el PDF genérico no tenía dónde decir quién es su jefe de flota ni quién revisa las
-- discrepancias. Con `formato` nulo la fila guarda SOLO los teléfonos: el documento sigue saliendo con el PDF genérico
-- (el código trata formato nulo como «sin formato»), y la copia y el aviso funcionan igual.
--
-- Idempotente (`drop not null` repetido no falla). El CHECK de la 0564 (`jsonb_typeof(formato) = 'object'`) ya acepta
-- NULL (un CHECK desconocido pasa), así que no se toca. El código funciona sin esta migración: guardar teléfonos sin
-- formato pide aplicarla y lo dice; todo lo demás sigue igual.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.liquidacion_formato_flota alter column formato drop not null;

comment on column public.liquidacion_formato_flota.formato is
  '0564/0645: plantilla del formato de la flota (objeto jsonb) o NULL cuando la fila solo guarda los teléfonos de la copia y del aviso de discrepancia (flota con el PDF genérico).';
