-- 0065 — Un CFDI puede amparar VARIOS gastos, y hay tickets que la máquina no
-- debe volver a intentar sola.
--
-- ═══ 1. `uq_gasto_cfdi_uuid` IMPEDÍA LA FACTURA DE CAPUFE ══════════════════
--
-- CAPUFE no factura ticket por ticket: se capturan los datos fiscales UNA vez,
-- se validan N códigos de caseta contra la misma pantalla y al final se emite
-- UNA sola factura con todos. Ocho casetas de un viaje = ocho filas de `gasto`
-- y UN `cfdi_uuid`.
--
-- El índice de la 0019 era `unique (tenant_id, cfdi_uuid) where cfdi_uuid is
-- not null`, o sea "un CFDI, un gasto". Con él, escribir el folio sobre la
-- segunda caseta reventaba con 23505 y las otras siete se quedaban sin folio —
-- volviendo a la cola del cron, que la hora siguiente las mandaría a facturar
-- OTRA VEZ. Un segundo CFDI por el mismo cruce, que hay que cancelar y que
-- fuera de plazo ya no se puede.
--
-- ── POR QUÉ NO SE BORRA EL ÍNDICE ────────────────────────────────────────
--
-- Porque protege de algo REAL y distinto: el mismo comprobante entrando dos
-- veces. Ese es el caso de la 0019 —dos fotos del mismo XML en una ráfaga de
-- WhatsApp, donde el `monto` sale del CFDI— y ahí dos filas SÍ son dinero
-- contado dos veces. `processor.ts` depende de que ese 23505 llegue y lo trata
-- como benigno (`violaIndice(e, 'uq_gasto_cfdi_uuid')`), así que el índice
-- conserva su NOMBRE a propósito.
--
-- El índice mezclaba dos hechos que no son el mismo:
--
--     "este gasto NACIÓ de ese CFDI"        → 1 a 1. Es lo que hay que impedir.
--     "este gasto está AMPARADO por ese CFDI" → N a 1. Es la factura de CAPUFE.
--
-- La salida: agregar `cfdi_orden` (1 = único o el primero; >1 solo lo escribe
-- el reparto de una factura de varios códigos) y mover el índice único a
-- `(tenant_id, cfdi_uuid, cfdi_orden)`. Dos filas siguen sin poder compartir el
-- mismo `(cfdi_uuid, cfdi_orden)` —eso sigue siendo el mismo comprobante dos
-- veces—, pero ocho filas con `cfdi_orden` 1..8 y el mismo `cfdi_uuid` ya
-- pasan: es exactamente la factura de CAPUFE.
--
-- ═══ 2. NOTA DE RECONSTRUCCIÓN (4-ago-2026, ronda 10 de auditoría) ═════════
--
-- Este archivo se BORRÓ POR ACCIDENTE con un `rm -f` mal compuesto durante la
-- auditoría de operabilidad de la ronda 10 — nunca estuvo commiteado (era
-- `??` en `git status` desde que se escribió), así que no había forma de
-- recuperarlo con git. La migración YA ESTABA aplicada contra la base real
-- (`cfdi_de_varias_casetas`, `20260805042253` en `list_migrations`) y sigue
-- intacta: lo único que se perdió fue el archivo local, no el esquema.
--
-- Lo de arriba (la sección 1) es el comentario ORIGINAL, capturado íntegro en
-- el transcript de esta misma sesión antes del borrado. El SQL de abajo NO es
-- un recorte del original —esa parte sí se perdió—: se reconstruyó leyendo el
-- esquema real con `pg_indexes`, `information_schema.columns`,
-- `pg_constraint` y `col_description` contra el proyecto Likida, así que
-- describe fielmente lo que la base tiene hoy, aunque el orden exacto de las
-- sentencias originales pueda no coincidir línea por línea.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. El orden de un gasto dentro de su CFDI ──────────────────────────────
alter table public.gasto add column if not exists cfdi_orden smallint not null default 1;

comment on column public.gasto.cfdi_orden is
  'En que lugar entro este gasto a su CFDI. 1 = unico, o el primero. >1 solo lo escribe el reparto de una factura de varios codigos (CAPUFE). NO es el renglon del XML: es el orden en que se mandaron los codigos, que es lo unico que nos consta.';

alter table public.gasto drop constraint if exists gasto_cfdi_orden_positivo;
alter table public.gasto add constraint gasto_cfdi_orden_positivo
  check (cfdi_orden >= 1);

-- ── 2. El índice único pasa de "un CFDI, un gasto" a "un CFDI+orden, un gasto" ──
drop index if exists public.uq_gasto_cfdi_uuid;
create unique index uq_gasto_cfdi_uuid on public.gasto (tenant_id, cfdi_uuid, cfdi_orden)
  where cfdi_uuid is not null;

-- ── 3. Las columnas de bloqueo de la cola (completan la reconstrucción) ────
--
-- ⚠️ NOTA DE LA AUDITORÍA 12 (5-ago-2026): la reconstrucción del 4-ago OLVIDÓ
-- dos columnas y su CHECK — el código (`cron/facturar/route.ts:281`,
-- `facturacion/pendientes.ts:121,174-175`, `facturacion/al_vuelo.ts:561`) y el
-- bloque 44 de verificaciones.sql las consumen como si existieran, y en la
-- base real existen (la migración original las traía), pero el repo no podía
-- reproducir el esquema desde cero. Este bloque las completa.
--
-- `autofactura_bloqueada_en` / `autofactura_bloqueo`: cuando el cron marca un
-- gasto como NO reintentable (CAPTCHA, emisión sin confirmar), lo escribe
-- `bloquearGasto` (`al_vuelo.ts`) con ambas columnas a la vez. El CHECK
-- garantiza la coherencia que el bloque 44 presupone: una marca de tiempo sin
-- motivo (o un motivo sin marca) no se guarda — mandaría a una persona a
-- facturar algo sin decirle por qué falló.
alter table public.gasto add column if not exists autofactura_bloqueada_en timestamptz;
alter table public.gasto add column if not exists autofactura_bloqueo text;

comment on column public.gasto.autofactura_bloqueada_en is
  'Cuando el cron de facturacion marco este gasto como no reintentable (CAPTCHA, emision sin confirmar). NULL = sigue en la cola. El parcial `gasto_por_facturar_idx` de la 0063 y la consulta del cron filtran por esto.';
comment on column public.gasto.autofactura_bloqueo is
  'El motivo del bloqueo, para la pantalla del contralor. Siempre a la par de autofactura_bloqueada_en (CHECK gasto_bloqueo_coherente): sin motivo no se bloquea.';

alter table public.gasto drop constraint if exists gasto_bloqueo_coherente;
alter table public.gasto add constraint gasto_bloqueo_coherente
  check ((autofactura_bloqueada_en is null) = (autofactura_bloqueo is null));
