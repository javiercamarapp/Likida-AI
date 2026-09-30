-- ═══════════════════════════════════════════════════════════════════════════
-- 0365 · Un par MIXTO de copias —una foto con `cfdi_uuid`, la otra sin él—
--        contaba DOS VECES en `total`, y `total` es el DENOMINADOR del tope del
--        15 % de la RFA 2026 regla 2.9.
--
-- AUDITORÍA 32 (continuación 9), DAT-32C9-C1 / FIS-32C9-C2 / ARQ-32C9-C1
-- (CRÍTICO). Tres auditores llegaron por separado al mismo mecanismo.
--
-- LO QUE PASÓ, Y ES EL SEGUNDO DÍA SEGUIDO. La 0363 arregló el determinismo y
-- erró el criterio; la 0364 arregló el criterio y rompió la exclusión mutua
-- entre sus dos ventanas. Las dos veces la suite quedó verde.
--
-- EL HECHO DE SQL QUE NADIE MODELÓ. Las dos `row_number()` de `marcados` se
-- evalúan sobre EL MISMO conjunto de filas; el `case` sólo elige cuál de los dos
-- rangos ya calculados usa cada fila. Una fila con `cfdi_uuid` toma su rango de
-- la ventana del UUID —donde `uq_gasto_cfdi_uuid` la deja SIEMPRE en 1— pero
-- sigue ocupando rango en la ventana del FOLIO:
--
--   · con la 0363 (`order by created_at, id`) absorbía el rango 1 del grupo de
--     folio cuando llegaba primero, y expulsaba a su copia;
--   · la 0364 le puso `order by sin_forma_pago_util, created_at, id` a esa misma
--     ventana, y un CFDI PPD trae `forma_pago '99'` sin `pagado_en` POR
--     CONSTRUCCIÓN → `sin_forma_pago_util = 1` → pierde el rango 1 del folio,
--     que se va a su copia. **Sobreviven las DOS.**
--
-- Y el par mixto no es un caso raro: es la ÚNICA forma que puede tomar un par de
-- copias de un comprobante con folio fiscal. `uq_gasto_img_hash` deja entrar la
-- segunda foto (es otra imagen) y `uq_gasto_cfdi_uuid` prohíbe que las dos
-- lleven el UUID, así que exactamente una lo trae.
--
-- LA CABECERA DE LA 0364 ES FALSA, y se corrige aquí por escrito. Dice
-- (`0364:53-56`) que su error residual «sólo puede SUBIR `efectivo`, nunca
-- bajarlo … se sub-deduce, nunca se sobre-deduce». Mueve el DENOMINADOR, no el
-- numerador: inflar `total` infla el tope (`engine.ts:847`,
-- `const tope = 0.15 * total`) y vuelve deducible lo que la regla no concede.
-- Es la dirección que le cuesta dinero al cliente frente al SAT, y el PDF
-- imprime además un total de combustible que la flota no compró — una cifra
-- inventada en un papel firmado, contra la primera regla del producto.
--
-- MEDIDO sobre PostgreSQL 16.13 con el andamio y las 341 migraciones sobre base
-- virgen, el MISMO par de filas (un ticket de $10,000, folio 'MIX'):
--     definición 0363 → total 10000.00 · tope 1500.00   (correcto)
--     definición 0364 → total 20000.00 · tope 3000.00   (el ticket dos veces)
--
-- EL ARREGLO. Cuando el grupo de folio trae UNA sola fila con `cfdi_uuid`, la
-- ventana del FOLIO manda para todas las filas del grupo, la del UUID incluida.
-- Eso restaura la exclusión mutua: exactamente una fila del grupo se queda con
-- el rango 1. El criterio de la 0364 se conserva entero, porque esa ventana ya
-- ordena por `sin_forma_pago_util` primero: entre las dos copias sigue
-- sobreviviendo la LEGIBLE, ahora sin traerse a la otra consigo.
--
-- LO QUE NO SE TOCA:
--   · LAS DOS PARTICIONES, byte por byte — conservan la 0358 (el emisor sólo
--     discrimina cuando se conoce), la 0357 (ARQ-A3), la 0349 y la 0345.
--   · El criterio de la 0364 y el determinismo de la 0363: el orden sigue
--     siendo `sin_forma_pago_util, created_at, id`, total y determinista.
--   · Dos CFDI **distintos** que comparten folio, monto, concepto y emisor:
--     `uuids_en_grupo >= 2` los manda a la rama del UUID igual que antes y
--     siguen contando DOS veces, porque son dos comprobantes y no copias. El
--     arnés lo siembra explícito para que este arreglo no pueda comprarse la
--     aserción del par mixto fusionando comprobantes legítimos.
--   · Firma, `search_path`, `stable`, `parallel safe` e INVOKER.
--   · Las otras cuatro sedes del dedup (0360 cierre, 0362 panel, 0361 póliza,
--     `engine.ts` motor TS). El panel fiscal tiene el mismo sesgo medido en
--     DAT-32C8-A1 y sigue anotado, no tocado: arreglarlo de paso sería salirse
--     del alcance de este hallazgo.
--
-- LO QUE QUEDA ABIERTO Y SE DICE AQUÍ, no en la síntesis: un grupo de folio con
-- DOS uuids distintos MÁS una copia sin uuid deja sobrevivir a las tres, igual
-- que antes de este arreglo. No lo toco porque no lo pude reproducir desde el
-- producto —haría falta que dos CFDI distintos compartan folio, monto, concepto
-- y emisor, y además que una tercera foto del mismo importe entre sin UUID— y
-- arreglar a ciegas es cómo se introducen los bugs de la ronda siguiente.
--
-- FIS-A2 (fecha vs `pagado_en`) sigue pendiente: es decisión de Javier.
-- ═══════════════════════════════════════════════════════════════════════════

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
      ) as rfc_emisor_del_grupo,
      -- FIS-32C8-C1 (0364): 0 = de esta copia SÍ se puede derivar el numerador
      -- del 15 %; 1 = no. Es exactamente la negación del `case` de
      -- `forma_pago_efectiva` de `base`, y por eso se lee junto a él: si ese
      -- `case` devolvería NULL, esta copia no sirve para el numerador.
      case
        when c.forma_pago is null then 1
        when c.forma_pago = '99' and c.pagado_en is null then 1
        else 0
      end as sin_forma_pago_util
    from candidatos c
  ),
  con_censo_de_uuids as (
    -- DAT-32C9-C1 (0365): cuántas filas del grupo de folio traen `cfdi_uuid`.
    -- Va en un CTE aparte por la misma razón que el emisor del grupo: una
    -- función de ventana no puede anidarse en el `partition by` de otra, y esta
    -- partición usa `rfc_emisor_del_grupo`, que ya es resultado de ventana.
    -- `count()` ignora los NULL, así que cuenta exactamente las filas con UUID.
    -- No es `distinct`: un CFDI consolidado con varias `cfdi_orden` da >= 2 y
    -- cae en la rama del UUID, que es donde debe caer.
    select
      g.*,
      count(g.cfdi_uuid) over (
        partition by
          unaccent(lower(g.concepto)),
          coalesce(g.folio_norm, g.folio),
          g.monto,
          coalesce(g.rfc_emisor, g.rfc_emisor_del_grupo, '')
      ) as uuids_en_grupo
    from con_emisor_del_grupo g
  ),
  marcados as (
    select
      monto, forma_pago, pagado_en, pagado_forma,
      case
        -- DAT-32C9-C1 (0365): cuando el grupo de folio trae UNA sola fila con
        -- `cfdi_uuid`, la ventana del FOLIO manda para TODAS las filas del
        -- grupo, la del UUID incluida. Es lo que restaura la exclusión mutua
        -- que la 0364 rompió: las dos `row_number()` se evalúan sobre el mismo
        -- conjunto de filas, así que la fila con UUID tomaba rango 1 de su
        -- propia ventana —donde `uq_gasto_cfdi_uuid` la deja sola— y dejaba el
        -- rango 1 del folio a su copia. Sobrevivían las DOS y `total`, que es el
        -- DENOMINADOR del tope del 15 % de la RFA 2.9, contaba el ticket doble.
        -- Con `uuids_en_grupo >= 2` no se toca nada: dos CFDI DISTINTOS que
        -- comparten folio, monto y emisor son dos comprobantes, no copias, y
        -- siguen contando dos veces.
        when folio is not null and uuids_en_grupo <= 1 then
          row_number() over (
            partition by
              unaccent(lower(concepto)),
              coalesce(folio_norm, folio),
              monto,
              coalesce(rfc_emisor, rfc_emisor_del_grupo, '')
            order by sin_forma_pago_util, created_at, id
          )
        when cfdi_uuid is not null then
          -- FIS-32C8-C1 (0364): primero la copia legible, después el orden de
          -- llegada (ARQ-32C7-C1, 0363) y el uuid como desempate total.
          row_number() over (
            partition by lower(cfdi_uuid), coalesce(cfdi_orden, 1)
            order by sin_forma_pago_util, created_at, id
          )
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
            -- FIS-32C8-C1 (0364): ídem. Aquí es donde vive el daño medido — la
            -- rama del `cfdi_uuid` es inalcanzable para copias por
            -- `uq_gasto_cfdi_uuid`, y se corrige igual por coherencia.
            order by sin_forma_pago_util, created_at, id
          )
        else 1
      end as orden_copia
    from con_censo_de_uuids
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
  '0365 (DAT-32C9-C1): cuando el grupo de folio trae UNA sola fila con cfdi_uuid, la ventana del FOLIO manda para todas las filas del grupo. La 0364 rompio la exclusion mutua entre sus dos ventanas: se evaluan sobre el MISMO conjunto de filas, asi que la fila con uuid tomaba rango 1 de su propia ventana (uq_gasto_cfdi_uuid la deja sola) y dejaba el rango 1 del folio a su copia. Sobrevivian las DOS y `total` contaba el ticket doble; `total` es el DENOMINADOR del tope del 15% de la RFA 2.9 (engine.ts:847), asi que el tope se inflaba y se volvia deducible lo que la regla no concede. Medido sobre el mismo par: 0363 daba total 10000, la 0364 daba 20000. La cabecera de la 0364 afirmaba que su error residual solo podia sub-deducir: es falso, movia el denominador. Se conservan el criterio de la 0364 (sobrevive la copia legible), el determinismo de la 0363 (created_at, id) y las DOS particiones byte por byte. Dos CFDI DISTINTOS con el mismo folio, monto y emisor siguen contando dos veces: uuids_en_grupo >= 2 los manda a la rama del uuid. Las otras cuatro sedes del dedup (0360, 0361, 0362, engine.ts) quedan anotadas, no tocadas. FIS-A2 sigue pendiente, es decision de Javier.';

commit;
