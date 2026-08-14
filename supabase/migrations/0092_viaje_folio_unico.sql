-- ═══════════════════════════════════════════════════════════════════════════
-- 0092 — El dedup del import de viajes ES de la base (auditoría 3, BE-A3).
--
-- `importarViajes` dedupeaba leyendo los folios existentes y filtrando en
-- código: cierto en serie, falso en paralelo. Dos submits del mismo archivo
-- (doble click, dos pestañas) leían `existentes` antes de que el otro
-- insertara y los 200 viajes del PoC entraban DOS veces — anticipos
-- duplicados en el Registro del contralor y doble población para la cola de
-- cobranza, con las dos respuestas diciendo "creados: 200". El mismo patrón
-- que factura_proveedor (0091) y cotizacion (0051) ya resolvieron: el unique
-- vive en la base y la carrera choca ahí, no en una regla de código.
--
-- (tenant_id, folio) y no folio solo: el folio identifica al viaje DENTRO de
-- su flota — dos flotas pueden traer el mismo folio de TMS distintos. Los
-- viajes despachados por WhatsApp nacen con folio NULL y no chocan entre sí:
-- NULLS DISTINCT, el default de Postgres.
--
-- Verificado ANTES de aplicar: cero pares (tenant_id, folio) duplicados en
-- producción (select ... group by tenant_id, folio having count(*) > 1 → 0).

alter table public.viaje
  add constraint viaje_folio_unico unique (tenant_id, folio);

comment on constraint viaje_folio_unico on public.viaje is
  'Dedup del import en la base: dos submits concurrentes del mismo archivo chocan aquí. folio NULL (despacho por WA) no participa — NULLS DISTINCT.';
