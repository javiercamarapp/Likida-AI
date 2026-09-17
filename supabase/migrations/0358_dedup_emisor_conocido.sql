-- AUDITORÍA 32, continuación 17-sep. DAT32C-C1 (CRÍTICO): regresión que
-- introdujo la 0357 de ayer, encontrada por el auditor de modelo de datos al
-- revisar el arreglo del orquestador contra un Postgres real.
--
-- QUÉ SE ROMPIÓ. La 0357 metió `coalesce(rfc_emisor, '')` a la partición del
-- folio para arreglar ARQ-A3 (dos estaciones distintas emiten su folio `1234`
-- el mismo año, y el dedup del ejercicio las colapsaba en una). El arreglo es
-- correcto para ese caso y equivocado para el simétrico, porque el emisor es el
-- ÚNICO elemento de esa llave que el OCR puede perder entero:
-- `intake/ocr.ts:560` hace `rfc = rfcDvOk ? rfcLeido : undefined`, y el
-- comentario de `:550-556` dice por qué pasa seguido («se le vio devolver
-- PER/PEX/PTE donde decía PEC»). Todos los demás elementos de la partición
-- están normalizados contra la variación entre dos lecturas del mismo papel —
-- `unaccent(lower(concepto))`, `folio_norm` (que existe por esto exacto:
-- `engine.ts:545-552`, «el mismo folio aparecía como 286188 y como 059286188»),
-- `lower(cfdi_uuid)`. El emisor no tiene ninguna, y además puede ser NULL.
--
-- Medido contra Postgres 16 con las 334 migraciones, dos fotos del MISMO ticket
-- de $2,500 con el RFC leído en una sola:
--     con la 0349:  total 2500  ← correcto
--     con la 0357:  total 5000  ← la regresión
-- Y se amplifica: `engine.ts:812` saca `tope = 0.15 * total` del total inflado,
-- y el PDF acaba imprimiendo «el ejercicio lleva $5,000.00 de combustible
-- pagado con medios que la LISR 27-III no admite» sobre una compra de $2,500,
-- negándole a la flota los $375 de deducción que la facilidad sí le concede.
-- La 0357 declara en su cabecera que la dirección segura es «fallar hacia es
-- copia»; en este caso falla hacia la contraria.
--
-- EL ARREGLO, en una frase: el emisor solo discrimina cuando se CONOCE. Dentro
-- del grupo (concepto, folio, monto), una fila sin emisor hereda el emisor
-- conocido del grupo en vez de abrir partición propia. Un emisor ausente no es
-- evidencia de una estación distinta: es evidencia de nada.
--
-- Las cuatro direcciones quedan así, y `supabase/tests/0358_dedup_emisor_ocr_nulo.sql`
-- las fija (la 4ª es la que faltaba; las tres primeras las conserva la prueba de
-- la 0357, que sigue verde):
--   1. emisores distintos, los dos conocidos → NO son copias  (ARQ-A3, 0357)
--   2. mismo emisor                          → SÍ son copias
--   3. emisor NULO en ambos                  → SÍ son copias  (0349)
--   4. emisor en uno y NULO en el otro       → SÍ son copias  ← se corrige aquí
-- Caso mixto (A, B y una foto sin emisor, mismo folio y monto): la fila sin
-- emisor se absorbe en el grupo de UNO de los dos conocidos —`min()` elige el
-- menor, de forma determinista— en vez de contarse aparte. Es la dirección
-- segura: nunca infla el cupo del 15 %.
--
-- Mismo molde que la 0349 y la 0357: SECURITY INVOKER heredado,
-- `create or replace`, firma sin cambios, `set search_path` idéntico. La ACL
-- sobrevive al replace (verificado: `service_role` conserva EXECUTE, `anon` y
-- `authenticated` siguen sin él).
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
      id, monto, forma_pago, pagado_en, pagado_forma, cfdi_uuid, cfdi_orden, folio, folio_norm, concepto,
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
          row_number() over (partition by lower(cfdi_uuid), coalesce(cfdi_orden, 1) order by id)
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
            order by id
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
  '0358 (DAT32C-C1): el emisor solo discrimina cuando se CONOCE — una fila sin rfc_emisor hereda el del grupo (concepto, folio, monto) en vez de abrir partición propia, porque el OCR pierde el RFC entero cuando falla el dígito verificador (ocr.ts:560) y dos fotos del mismo ticket dejaban de ser copias (2500 -> 5000). Conserva la 0357 (ARQ-A3: dos emisores conocidos y distintos no son copias), la 0349 (excluir copias) y la 0345 (forma efectiva del REP). Dedup por (cfdi_uuid, cfdi_orden) intacto. FIS-A2 (fecha vs pagado_en) sigue pendiente, es decisión de Javier.';

commit;
