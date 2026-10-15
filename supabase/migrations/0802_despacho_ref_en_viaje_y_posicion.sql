-- 0802 — CONDUCTOR: `despacho_ref`, la referencia de despacho que liga una posición con su viaje.
--
-- El TMS del cliente guarda un campo de despacho en cada posición procesada. Con él se puede ligar la posición al viaje
-- sin adivinar por «unidad + ventana de tiempo». Lo que NO está definido por el cliente es si ese valor es único por viaje
-- o por tramo, así que se construye con la semántica más débil: texto, puede repetirse entre tramos de un mismo viaje.
--   (a) `viaje.despacho_ref text` (nullable) — la referencia de despacho del viaje. La capa TS la normaliza (mayúsculas, sin espacios).
--   (b) el índice parcial (tenant_id, despacho_ref) donde despacho_ref no es nulo, NO único, es `viaje_despacho_ref_idx` y lo crea la 0780
--       (esta migración ya NO crea un segundo índice idéntico: doble costo de escritura en `viaje`).
--   (c) `posicion.despacho_ref text` (nullable, sin default) — en la tabla más grande del sistema es un cambio de metadatos:
--       sin NOT NULL, sin DEFAULT, sin reescritura. NO se crea índice sobre posicion: la consulta «última posición de la unidad
--       con referencia» ya la cubre `posicion_unidad_medida_idx` (0288) y la prueba lo mide con EXPLAIN.
--
-- Solo aditiva e idempotente (if not exists). RLS sin cambios (ambas tablas ya la tienen). No toca 0050 ni 0092:
-- `uq_posicion_lectura` (0288) y `viaje_folio_unico` quedan intactos.

-- NOTA DE INTEGRACIÓN (INT-RAMAS): 0780_viaje_despacho_ref.sql es la DUEÑA de `viaje.despacho_ref`, `posicion.despacho_ref` y del índice
-- `viaje_despacho_ref_idx`; esta migración repite las dos columnas (idempotente, no hace nada) y NO crea otro índice sobre `viaje`
-- (revisión adversarial M5: antes añadía `viaje_tenant_despacho_ref_idx`, idéntico al de la 0780).

alter table public.viaje    add column if not exists despacho_ref text;
alter table public.posicion add column if not exists despacho_ref text;

comment on column public.viaje.despacho_ref is
  'Referencia de despacho del TMS del cliente. Texto normalizado por la capa TS; puede repetirse entre tramos de un mismo viaje (el cliente no ha definido si es unica por viaje o por tramo).';
comment on column public.posicion.despacho_ref is
  'Referencia de despacho que acompana a la posicion en el TMS del cliente. Nullable y sin default a proposito: posicion es la tabla mas grande.';
