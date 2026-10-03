-- AUDITORÍA 32, continuación 7 (28-sep-2026). ARQ-32C7-C1 (CRÍTICO), encontrado
-- por el auditor de arquitectura al contar las implementaciones del dedup y
-- medirlas contra un Postgres real.
--
-- 0363 · El desempate del dedup del ejercicio de combustible: `created_at, id`,
-- no `id`. Es la MISMA enfermedad que la 0362 arregló ayer en el panel fiscal, en
-- la sede hermana que el censo de ese arreglo NO enumeró.
--
-- EL CENSO CORRECTO, derivado del árbol (`grep -n 'order by' supabase/migrations/03*.sql`)
-- y no heredado de la prosa del arreglo anterior:
--   cierre       0360:161       order by created_at, id        → la primera en llegar
--   panel        0362:168/:180  order by bc.created_at, bc.id  → la primera en llegar
--   motor TS     engine.ts `copiasDeComprobante`               → la primera de la lista
--   ejercicio    0358:90/:102   order by id                    → min(uuid)   ← ESTA
--
-- El cuerpo del mensaje de `2dce888` dio el censo como CUATRO implementaciones y
-- listó la 0361 como si desempatara copias (su `order by gg.created_at, gg.id` es
-- el orden del `jsonb_agg`, no un desempate: `grep -c row_number` sobre la 0361 da
-- 0). La que faltaba en esa lista es justo ésta, y este CRÍTICO es el precio de la
-- omisión. Un uuid v4 no guarda ninguna relación con el orden de llegada, así que
-- `sumar_combustible_ejercicio` conservaba una fila AL AZAR de entre las copias, y
-- hacia el lado contrario de los otros tres.
--
-- POR QUÉ NINGÚN ARNÉS LO VEÍA, que es lo que lo hace caro. Igual que en la 0362,
-- el TOTAL no se mueve: `monto` está en la partición, así que `sum(monto)` sale
-- igual con cualquier desempate — que es exactamente lo que afirman los arneses de
-- la 0357 y la 0358. Lo que sí se mueve es todo lo que quedó FUERA de la
-- partición, y en esta función eso es `forma_pago`, `pagado_en` y `pagado_forma`
-- (`:87`), de los que `base` (`:108-117`) deriva `forma_pago_efectiva` y el
-- `filter` de `:119-125` deriva `efectivo`. **`efectivo` es el NUMERADOR del tope
-- del 15 %**, así que el desempate no mueve una cifra de presentación: mueve la
-- cuenta con la que el PDF decide si un comprobante se deduce.
--
-- Y no puede haber arnés que lo vea con las semillas de hoy:
-- `supabase/tests/0357_dedup_ejercicio_emisor.sql:39-46`,
-- `supabase/tests/0358_dedup_emisor_ocr_nulo.sql:44-46` y hasta el arnés NUEVO de
-- ayer, `supabase/tests/0362_panel_fiscal_desempate_estable.sql:41-49`, siembran
-- **`forma_pago='01'` en las DOS copias**. Con la forma de pago idéntica, el
-- desempate no puede cambiar `efectivo` en ninguna aserción. El arnés de la 0363
-- rompe ese vicio: siembra formas de pago DISTINTAS en las dos copias, que es el
-- único modo de que la elección se note.
--
-- EL DAÑO, con valores. Flota con la facilidad del 15 % (`facilidad15 = true`).
-- Ejercicio 2026: $1,000,000 de diésel, de los cuales $150,000 en efectivo — el
-- tope exacto (`0.15 × 1,000,000`). Entre esos $150,000 hay UN ticket de $2,500
-- del que el chofer mandó dos fotos: la buena (`forma_pago='01'`, uuid mayor,
-- `created_at` menor) y la borrosa (`forma_pago = null`, uuid menor). Que la
-- borrosa tenga `forma_pago` nula no es hipotético: `intake/ocr.ts:620` devuelve
-- `undefined` cuando no lee la forma de pago y `repo.ts:378` lo escribe como
-- `null` — es la premisa del caso con el que se justificaron la 0358 y la 0362.
--
--   · con `order by id`          → sobrevive la borrosa → ese par aporta efectivo 0
--   · con `order by created_at`  → sobrevive la buena   → ese par aporta 2500
--
-- El ejercicio llega a `desde_db.ts:192` como $147,500 en vez de $150,000;
-- `efectivoPrevEjercicio` queda en $145,000; `engine.ts:850` calcula
-- `cupoRestante = max(0, 150,000 − 145,000) = $5,000`, el ticket nuevo de $2,500
-- cabe entero y `proporcionDeducible = 1`. El PDF imprime la nota de `:863`
-- («deducible por la facilidad del 15 %… el ejercicio lleva $147,500.00 de
-- $1,000,000.00») donde con el desempate correcto imprimiría la de `:870`: «el
-- excedente de $2,500.00 de ESTE comprobante NO se deduce».
--
-- Entra un ticket real de $2,500 → sale «deducible» donde debía salir «$2,500 no
-- deducibles», y el motivo es el uuid aleatorio de una foto borrosa. ~$750 de ISR
-- al 30 % por cada volado perdido, en un renglón que el SAT rechaza con la cuenta
-- en la mano, y en la dirección que este repo ya se escribió a sí mismo como la
-- peligrosa: «el error quedó del lado que REGALA cupo» (`desde_db.ts:180`). Peor
-- para el contralor que la cifra: la nota imprime `$147,500.00` como si fuera una
-- medición, y es el 15 % medido contra una fila que el OCR no pudo leer.
--
-- `max(0, …)` de `:192` NO lo tapa: sólo salva el caso en que este viaje es el
-- único diésel del año; con cualquier historial previo la resta no llega a cero y
-- el faltante pasa completo.
--
-- ESTA MIGRACIÓN es la definición VIVA de la 0358 con TRES cambios textuales y ni
-- uno más: `created_at` entra a `candidatos`, y los DOS `order by id` de los
-- `row_number()` pasan a `order by created_at, id`. **La PARTICIÓN no se toca**:
-- quién es copia no cambia (las cuatro direcciones de la 0358 se conservan
-- íntegras, y sus arneses siguen verdes), sólo cuál de las copias se conserva.
-- `created_at` es `not null default now()` y ya tiene índice propio
-- (`gasto_created_at_idx`), así que el desempate no puede caer en NULL ni cuesta
-- un plan nuevo; `id` queda como segundo criterio para que el orden siga siendo
-- total si dos copias comparten `created_at` al microsegundo.
--
-- UNA DE LAS DOS RAMAS NO SE PUEDE PROBAR, y se dice en vez de fingirlo. La 0358
-- tenía DOS `order by id`: la rama del `cfdi_uuid` (:90) y la del folio (:102).
-- El arnés sólo ejercita la segunda, porque la primera es INALCANZABLE para
-- copias: la base tiene `uq_gasto_cfdi_uuid` sobre
-- `(tenant_id, cfdi_uuid, cfdi_orden)`, así que dos filas del mismo tenant no
-- pueden compartir uuid y orden. Medido al escribir el arnés: sembrarlas muere
-- con «duplicate key value violates unique constraint uq_gasto_cfdi_uuid». Dos
-- copias del mismo ticket sólo coexisten por la rama del folio, que es donde
-- vive el daño. El `order by` de la otra se corrige igual, por coherencia.
--
-- Mismo molde que la 0349, la 0357, la 0358 y la 0362: SECURITY INVOKER heredado,
-- `create or replace`, firma sin cambios, `set search_path` idéntico. NO se toca
-- `version` ni `RPC_VERSION_MINIMA`: esta función devuelve `(total, efectivo)`, no
-- publica contrato versionado — ése es el de la póliza (0361).
begin;

CREATE OR REPLACE FUNCTION public.sumar_combustible_ejercicio(p_tenant uuid, p_anio int, p_claves text[])
returns table (total numeric, efectivo numeric)
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  with candidatos as (
    select
      -- ARQ-32C7-C1 (0363): `created_at` entra aquí para poder desempatar por
      -- orden de llegada en vez de por uuid. Es el único campo añadido.
      id, created_at, monto, forma_pago, pagado_en, pagado_forma, cfdi_uuid, cfdi_orden, folio, folio_norm, concepto,
      -- ARQ-A3 (0357): quién emitió el ticket. `nullif(...,'')` es la misma
      -- normalización que ya usa `gastos_fiscales_agregados_tenant` (0192).
      nullif(rfc_emisor, '') as rfc_emisor
    from gasto
    where tenant_id = p_tenant
      and monto > 0
      and fecha >= make_date(p_anio, 1, 1)
      and fecha <= make_date(p_anio, 12, 31)
      and (concepto = 'diesel' or (p_claves is not null and cardinality(p_claves) > 0 and clave_prod_serv = any(p_claves)))
  ),
  con_emisor_del_grupo as (
    -- DAT32C-C1 (0358): el emisor conocido del grupo (concepto, folio, monto).
    -- `min()` ignora los NULL, así que sale NULL solo cuando NINGUNA fila del
    -- grupo trae emisor —el caso 3, que la 0349 ya resolvía bien—. Va en un CTE
    -- aparte porque una función de ventana no puede anidarse en el `partition
    -- by` de otra.
    select
      c.*,
      min(c.rfc_emisor) over (
        partition by unaccent(lower(c.concepto)), coalesce(c.folio_norm, c.folio), c.monto
      ) as rfc_emisor_del_grupo
    from candidatos c
  ),
  marcados as (
    select
      monto, forma_pago, pagado_en, pagado_forma,
      case
        when cfdi_uuid is not null then
          -- ARQ-32C7-C1 (0363): era `order by id` (= min(uuid), un volado).
          row_number() over (partition by lower(cfdi_uuid), coalesce(cfdi_orden, 1) order by created_at, id)
        when folio is not null then
          -- DAT32C-C1 (0358): la fila SIN emisor hereda el del grupo en vez de
          -- abrir partición propia. Con emisor conocido en las dos filas, la
          -- 0357 sigue mandando y dos estaciones distintas siguen sin ser
          -- copias. El `''` final conserva el caso 3 (todo el grupo sin emisor).
          row_number() over (
            partition by
              unaccent(lower(concepto)),
              coalesce(folio_norm, folio),
              monto,
              coalesce(rfc_emisor, rfc_emisor_del_grupo, '')
            -- ARQ-32C7-C1 (0363): era `order by id` (= min(uuid), un volado).
            order by created_at, id
          )
        else 1
      end as orden_copia
    from con_emisor_del_grupo
  ),
  base as (
    select
      monto,
      case
        when forma_pago = '99' and pagado_en is not null then pagado_forma
        when forma_pago = '99' then null
        else forma_pago
      end as forma_pago_efectiva
    from marcados
    where orden_copia = 1
  )
  select
    coalesce(sum(monto), 0) as total,
    coalesce(sum(monto) filter (
      where forma_pago_efectiva is not null
        and forma_pago_efectiva <> '99'
        and forma_pago_efectiva not in ('02', '03', '04', '05', '28', '29')
    ), 0) as efectivo
  from base;
$$;

comment on function public.sumar_combustible_ejercicio(uuid, int, text[]) is
  '0363 (ARQ-32C7-C1): el desempate entre copias es `created_at, id`, no `id`. Con `order by id` sobrevivia una fila AL AZAR (uuid v4) y hacia el lado contrario del cierre (0360), del panel (0362) y del motor TS; `forma_pago`/`pagado_en`/`pagado_forma` viajan FUERA de la particion, asi que el volado movia `efectivo`, que es el NUMERADOR del tope del 15% de la RFA 2.9 — el PDF imprimia "deducible" donde debia imprimir "el excedente NO se deduce". La PARTICION no cambia: conserva la 0358 (el emisor solo discrimina cuando se conoce), la 0357 (ARQ-A3), la 0349 (excluir copias) y la 0345 (forma efectiva del REP). FIS-A2 (fecha vs pagado_en) sigue pendiente, es decision de Javier.';

commit;
