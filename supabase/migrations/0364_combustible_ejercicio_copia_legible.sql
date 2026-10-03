-- ═══════════════════════════════════════════════════════════════════════════
-- 0364 · El desempate entre copias del ejercicio de combustible prefiere la
--        copia LEGIBLE (la que trae forma de pago), y sólo después el orden de
--        llegada.
--
-- AUDITORÍA 32 (continuación 8), FIS-32C8-C1 (CRÍTICO).
--
-- QUÉ ARREGLÓ LA 0363 Y QUÉ ERRÓ. La 0363 quitó el `order by id` (= min(uuid),
-- un volado) y lo cambió por `order by created_at, id`. El determinismo quedó
-- bien y así se queda: `created_at` es `not null default now()` e `id` es la PK,
-- así que el orden es TOTAL. Lo que quedó mal es el criterio de fondo, y su
-- propia cabecera deja escrito el supuesto del que salió:
--
--     «LA BUENA: llega a las 10:00, trae forma_pago '01', uuid MAYOR.
--      LA BORROSA: la misma foto una hora después, SIN forma de pago.»
--
-- El producto hace lo CONTRARIO, y está escrito en el código:
--
--   1. llega la foto, el OCR no lee la forma de pago → `forma_pago = null`
--      (`intake/ocr.ts:620` devuelve `undefined`, `repo.ts:378` lo escribe);
--   2. `decidirAcuse` ve `confianza < CONFIANZA_LEGIBLE` (0.65) y pide refoto
--      (`acuse_ticket.ts:202`);
--   3. **el gasto YA está guardado** cuando se pide la segunda foto — es
--      literal el comentario de `processor.ts:3163`;
--   4. la buena llega después y crea fila nueva (`repo.ts:404/:456`).
--
-- Es decir: la copia ILEGIBLE es siempre la de `created_at` menor. Con el
-- desempate por orden de llegada gana SIEMPRE, y `forma_pago` viaja FUERA de la
-- partición, así que quien gana decide `forma_pago_efectiva` → `efectivo`, el
-- NUMERADOR del tope del 15 % de la RFA 2026 regla 2.9.
--
-- MEDIDO sobre base virgen con las 340 migraciones, par sembrado en el orden que
-- el producto produce:
--
--     total 2500.00 · efectivo 0        ← esperado: efectivo 2500
--
-- y con el uuid de la borrosa MAYOR (el caso en que `order by id` acertaba de
-- casualidad), lo mismo: efectivo 0. **La 0363 no cambió la cifra: cambió el
-- volado del 50 % por un error del 100 %**, y hacia el lado caro — un numerador
-- corto hace creer que queda cupo del 15 % donde ya no queda, y el PDF imprime
-- «deducible por la facilidad» donde debía imprimir «el excedente NO se deduce».
-- Sobre un CFDI de diésel de $5,800 en efectivo eso son ~$750 de ISR por ticket
-- que el contador va a encontrar en la primera revisión.
--
-- EL CRITERIO. Las dos copias son fotos del MISMO pago. Que una no haya podido
-- leer la forma de pago no cambia cómo se pagó: sólo dice que esa foto trae
-- menos información. Así que entre copias se conserva la que permite derivar el
-- numerador, y el orden de llegada queda de desempate. El rango mira la forma
-- EFECTIVA, no la cruda, porque `forma_pago = '99'` sin `pagado_en` es tan
-- inservible como `null` para `base` (ver el `case` de `forma_pago_efectiva`,
-- idéntico y sin tocar más abajo).
--
-- DIRECCIÓN DEL ERROR RESIDUAL, a propósito: preferir la copia legible sólo
-- puede SUBIR `efectivo`, nunca bajarlo. Un numerador más alto consume antes el
-- tope del 15 % y hace que el PDF diga «no se deduce» antes, que es el lado
-- seguro: se sub-deduce, no se sobre-deduce.
--
-- LO QUE NO SE TOCA, y es la mitad del punto de este archivo:
--   · LA PARTICIÓN, byte por byte — conserva la 0358 (el emisor sólo discrimina
--     cuando se conoce), la 0357 (ARQ-A3), la 0349 (excluir copias) y la 0345.
--   · El determinismo de la 0363: `created_at, id` sigue siendo el desempate,
--     ahora en segundo y tercer lugar. El orden sigue siendo TOTAL.
--   · Firma, `search_path`, `stable`, `parallel safe` e INVOKER.
--   · Las otras cuatro sedes del dedup (0360 cierre, 0362 panel, 0361 póliza,
--     `engine.ts` motor TS). Tienen el MISMO sesgo —el panel fiscal lo tiene
--     medido en DAT-32C8-A1— pero cada una elige para otra cosa y arreglarlas
--     de paso sería salirse del alcance de este hallazgo. Quedan anotadas.
--
-- FIS-A2 (fecha vs `pagado_en`) sigue pendiente: es decisión de Javier.
-- ═══════════════════════════════════════════════════════════════════════════

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
  marcados as (
    select
      monto, forma_pago, pagado_en, pagado_forma,
      case
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
  '0364 (FIS-32C8-C1): entre copias del mismo comprobante sobrevive la que SI trae forma de pago util; `created_at, id` queda de desempate (0363). La 0363 desempataba solo por orden de llegada, y el producto guarda la foto ILEGIBLE ANTES de pedir la buena (processor.ts:3163 + acuse_ticket.ts:202), asi que la copia sin forma_pago ganaba SIEMPRE: medido, efectivo=0 sobre un ticket de 2500 en efectivo, con y sin el uuid a favor. `forma_pago`/`pagado_en`/`pagado_forma` viajan FUERA de la particion y de ellos sale el NUMERADOR del tope del 15% de la RFA 2.9, asi que el PDF imprimia "deducible" donde debia imprimir "el excedente NO se deduce". Preferir la copia legible solo puede SUBIR el numerador: se sub-deduce, nunca se sobre-deduce. La PARTICION no cambia: conserva la 0358, la 0357 (ARQ-A3), la 0349 y la 0345. Las otras cuatro sedes del dedup (0360, 0361, 0362, engine.ts) tienen el mismo sesgo y quedan anotadas, no tocadas. FIS-A2 (fecha vs pagado_en) sigue pendiente, es decision de Javier.';
