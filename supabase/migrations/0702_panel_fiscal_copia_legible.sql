-- ═══════════════════════════════════════════════════════════════════════════
-- 0702 · El PANEL DEL CONTADOR se queda con la copia LEGIBLE, no con la
--        primera — PORTADO sobre la definición viva (0688).
--
-- AUDITORÍA 32 (continuación 13, 10-oct-2026), FIS-32C13-C1, CRÍTICO.
-- Es la MISMA regla que la continuación 12 escribió para la definición de la
-- 0367. Lo que esta migración agrega es que esa regla NUNCA LLEGÓ A `master`,
-- y que la definición que `master` tiene viva la contradice.
--
-- LO QUE PASÓ, y es un modo de falla de proceso que conviene dejar escrito:
--
--   · La continuación 12 escribió el arreglo como `0368_panel_fiscal_copia_
--     legible.sql` sobre la rama `claude/auditoria-32`. El PR 477 nunca se
--     fusionó.
--   · `master` siguió solo y, en la ronda 16 de carga, la
--     `0688_gastos_fiscales_sin_ventanas_encadenadas.sql` REESCRIBIÓ
--     `gastos_fiscales_agregados_tenant` por rendimiento, partiendo de la
--     definición de la 0367 —la que NO trae el desempate— y declarando en su
--     propia cabecera «La salida es byte a byte la de la 0367».
--   · Resultado: la 0688 es la última definición y vuelve a quedarse con la
--     copia de `created_at` MENOR, que es SIEMPRE la ilegible (el producto
--     guarda la foto ANTES de pedir la refoto: `processor.ts` + `acuse_
--     ticket.ts` lo dicen literal). El daño de FIS/DAT/ARQ-32C12-C1 está VIVO
--     en producción, con el arreglo escrito y sin aplicar.
--   · Y al fusionar `master` en la rama, la 0368 habría quedado ANTES de la
--     0688 en el orden de aplicación: la 0688 la habría sobrescrito y el
--     arreglo se habría perdido EN SILENCIO, con el archivo presente en el
--     repo. Por eso se renumera a 0702 (sobre la 0701, la más alta) y por eso
--     el cuerpo se porta a la ESTRUCTURA de la 0688 en vez de reaplicar el de
--     la 0367 — reaplicarlo habría revertido la pasada estrecha y devuelto los
--     4.5-7 s de p50 que la ronda 16 midió y bajó.
--
-- EL DAÑO, sin cambios respecto de la continuación 12. Un ticket de diésel de
-- $2,500 TIMBRADO (IVA $344.83, forma de pago `01`) que entró dos veces: la
-- foto borrosa primero, sin CFDI ni forma de pago, y la legible después.
--
--   sumar_combustible_ejercicio (0365)  →  efectivo 2500.00   (gana la legible)
--   gastos_fiscales_agregados_tenant    →  muestraId = LA BORROSA
--     (0688, el panel del contador)        iva 0 · ivaEstado 'nulo'
--                                          tieneCfdi false · subTotal 0
--                                          formaPago null · sobreTopeEfectivo true
--
-- El contralor abre `/dashboard/fiscal` y ve «IVA $0 · sin CFDI · sobre el tope
-- de efectivo» de un ticket timbrado con $344.83 desglosados. Es textualmente
-- lo que CLAUDE.md prohíbe: una cifra fiscal que se lee distinto en dos
-- pantallas se lee como dos cálculos. La 0367 cerró el IVA DUPLICADO; esto lo
-- deja BORRADO, el error simétrico.
--
-- EL CAMBIO, y es el mismo de la 0368, con UNA diferencia de estructura
-- forzada por la 0688: el campo `sin_forma_pago_util` se calcula en la pasada
-- ESTRECHA (`estrecha`), no en `con_emisor_del_grupo` —que la 0688 ya no
-- tiene—, porque es una de las columnas que DECIDEN el dedup y tiene que
-- llegar a las dos ventanas. De ahí viaja por los `e.*` / `y.*` / `x.*` que la
-- 0688 ya propaga. Los DOS desempates (`folio_numerado` y `uuid_numerado`)
-- pasan a `order by sin_forma_pago_util, created_at, id`. Ni un cambio más:
-- no se toca la partición, ni la firma, ni `search_path`, ni
-- `STABLE PARALLEL SAFE`, ni SECURITY INVOKER, ni el anti-join de
-- `descartadas`, ni la pasada ancha. El orden sigue siendo TOTAL porque
-- `created_at` es `not null default now()` e `id` es la PK.
--
-- EL CRITERIO ES EL DE LA 0364 Y NO SE REABRE: las dos copias son fotos del
-- MISMO pago; que una no se haya podido leer no cambia cómo se pagó, sólo dice
-- que trae menos información. Sobrevive la que más información trae y el orden
-- de llegada queda de desempate. La dirección del error residual sigue siendo
-- deliberada: preferir la legible sólo puede RECUPERAR IVA acreditable real.
--
-- EL ARNÉS DE LA 0688 SE AJUSTA, y hay que decir exactamente qué se ajustó
-- para que nadie lo lea como «se tocó la prueba hasta que pasara»: su bloque
-- (c) compara la salida contra una copia LITERAL de la 0367 y exige texto
-- idéntico. Esa copia es el ORÁCULO de que la pasada estrecha no cambió la
-- salida, y su tie-break tenía que moverse con la regla o el oráculo dejaría
-- de medir la reestructuración y empezaría a medir el desempate. El oráculo
-- recibe el MISMO campo y los MISMOS dos `order by` — nada más —, así que
-- sigue probando lo único que le toca: que la 0688 y la 0367 producen la misma
-- salida bajo la MISMA regla de sobreviviente. Quien vigila el desempate es
-- `supabase/tests/0702_panel_fiscal_copia_legible.sql`, que siembra copias que
-- DIFIEREN en `forma_pago`, `iva_traslado`, `sub_total` y `cfdi_uuid` en LAS
-- DOS direcciones de llegada, y que está MEDIDO rojo contra la 0688 sola.
--
-- LO QUE NO CIERRA, para que nadie lo lea como cerrado:
--   · `guardar_liquidacion_tx` (`0366:194`) queda DIVERGENTE A PROPÓSITO: su
--     `order by created_at, id` sólo alimenta `sum(monto) filter (where
--     rn = 1)` y `monto` está DENTRO de la llave de partición, así que las dos
--     copias lo traen idéntico por construcción y la elección de sobreviviente
--     NO puede mover `v_total`. Divergencia formal, sin consecuencia medible.
--   · ARQ-C1 —que las sedes sigan siendo varias redacciones de la misma regla
--     en dos lenguajes— va en su 20ª aparición y es un rediseño, no un parche.
--     Esta ronda le agrega evidencia nueva y cara: una reescritura por
--     rendimiento de UNA de las sedes revirtió, sin que nadie lo notara, un
--     arreglo fiscal CRÍTICO de otra rama.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.gastos_fiscales_agregados_tenant(p_tenant uuid, p_desde date, p_hasta date, p_tope_efectivo numeric, p_tope_alimentacion numeric, p_conceptos_alimentacion text[], p_cortes date[], p_claves_combustible text[], p_vigente_desde date, p_exigible_desde date, p_umbral_renglones_ajenos numeric, p_patron_bar text, p_hoy date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE PARALLEL SAFE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  with
  -- PASADA 1, ESTRECHA: solo las columnas que deciden el dedup.
  estrecha as (
    select g.id, g.created_at,
      unaccent(lower(g.concepto))                          as ck,
      g.monto,
      nullif(g.rfc_emisor, '')                             as rfc_emisor,
      nullif(g.cfdi_uuid, '')                              as cfdi_uuid,
      g.cfdi_orden,
      nullif(g.folio, '')                                  as folio,
      coalesce(nullif(g.folio_norm, ''), nullif(g.folio, '')) as fk,
      -- FIS-32C13-C1 (0702): 0 = de esta copia SI se puede derivar el numerador
      -- del 15 %; 1 = no. Es la negacion exacta del `case` de
      -- `forma_pago_efectiva` de la 0364 (`0364:109-113`), con `pagado_en is
      -- null` donde la 0364 lee `pagado_en`. Un CFDI PPD trae `99` sin
      -- `pagado_en` POR CONSTRUCCION, asi que de el no se deriva nada.
      -- Entra en la pasada ESTRECHA a proposito: es una de las columnas que
      -- DECIDEN el dedup, y calcularla aqui no agrega una lectura (la 0688 ya
      -- recorre `gasto` en esta pasada) ni arrastra las columnas anchas.
      case
        when nullif(g.forma_pago, '') is null then 1
        when nullif(g.forma_pago, '') = '99' and g.pagado_en is null then 1
        else 0
      end as sin_forma_pago_util
    from gasto g
    where g.tenant_id = p_tenant
      and (p_desde is null or g.fecha >= p_desde)
      and (p_hasta is null or g.fecha <= p_hasta)
  ),
  grupos_folio as (
    select e.ck, e.fk, e.monto
    from estrecha e
    where e.fk is not null
    group by e.ck, e.fk, e.monto
    having count(*) > 1
  ),
  folio_numerado as (
    select x.id,
      x.uuids_en_grupo,
      row_number() over (
        partition by x.ck, x.fk, x.monto, coalesce(x.rfc_emisor, x.rfc_emisor_del_grupo, '')
        order by x.sin_forma_pago_util, x.created_at, x.id
      ) as orden_folio
    from (
      select y.*,
        count(y.cfdi_uuid) over (
          partition by y.ck, y.fk, y.monto, coalesce(y.rfc_emisor, y.rfc_emisor_del_grupo, '')
        ) as uuids_en_grupo
      from (
        select e.*,
          min(e.rfc_emisor) over (partition by e.ck, e.fk, e.monto) as rfc_emisor_del_grupo
        from estrecha e
        join grupos_folio gf on gf.ck = e.ck and gf.fk = e.fk and gf.monto = e.monto
      ) y
    ) x
  ),
  grupos_uuid as (
    select lower(e.cfdi_uuid) as u, coalesce(e.cfdi_orden, 1) as o
    from estrecha e
    where e.cfdi_uuid is not null
    group by 1, 2
    having count(*) > 1
  ),
  uuid_numerado as (
    select e.id,
      row_number() over (
        partition by lower(e.cfdi_uuid), coalesce(e.cfdi_orden, 1)
        order by e.sin_forma_pago_util, e.created_at, e.id
      ) as orden_uuid
    from estrecha e
    join grupos_uuid gu on gu.u = lower(e.cfdi_uuid) and gu.o = coalesce(e.cfdi_orden, 1)
  ),
  descartadas as (
    select e.id
    from estrecha e
    left join folio_numerado f on f.id = e.id
    left join uuid_numerado  u on u.id = e.id
    where (f.id is not null or u.id is not null)
      and (case
             when e.folio is not null and coalesce(f.uuids_en_grupo, 0) <= 1 then coalesce(f.orden_folio, 1)
             when e.cfdi_uuid is not null then coalesce(u.orden_uuid, 1)
             when e.folio is not null then coalesce(f.orden_folio, 1)
             else 1
           end) > 1
  ),
  -- PASADA 2, ANCHA: solo las filas que sobreviven al dedup.
  base as (
    select
      g.id, g.viaje_id, g.concepto, g.monto, g.fecha,
      nullif(g.rfc_emisor, '')      as rfc_emisor,
      nullif(g.cfdi_uuid, '')       as cfdi_uuid,
      nullif(g.estado_sat, '')      as estado_sat,
      g.efos, g.efos_revisar,
      nullif(g.forma_pago, '')      as forma_pago,
      (g.pagado_en is not null)     as pagado,
      nullif(g.pagado_forma, '')    as pagado_forma,
      g.sub_total, g.iva_traslado, g.ieps_traslado,
      nullif(g.clave_prod_serv, '') as clave_prod_serv,
      (nullif(g.cfdi_uuid, '') is not null) as tiene_cfdi,
      coalesce(g.fecha::text, 'sin-fecha:' || g.id::text) as dia,
      (g.monto > p_tope_efectivo) as sobre_tope,
      case when g.iva_traslado is null then 'nulo'
           when g.iva_traslado > 0 then 'positivo'
           else 'no_positivo' end as iva_estado,
      g.ocr_extra,
      (l.id is not null) as liquidacion_firmada,
      nullif(g.rfc_receptor, '') as rfc_receptor,
      (nullif(g.ocr_extra->>'moneda', '') is not null and g.ocr_extra->>'moneda' <> 'MXN') as moneda_extranjera,
      (g.monto > 0 and aj.importe > 0 and aj.importe / g.monto >= p_umbral_renglones_ajenos) as renglones_ajenos,
      (
        g.concepto = 'alimentacion' and p_patron_bar is not null and (
          coalesce(g.ocr_extra->>'emisor', '') ~* p_patron_bar
          or coalesce(g.ocr_extra->>'producto', '') ~* p_patron_bar
        )
      ) as consumo_bar,
      (
        (g.concepto = 'diesel' or g.clave_prod_serv = any (coalesce(p_claves_combustible, '{}'::text[])))
        and g.tipo_comprobante in ('I', 'E')
        and (g.fecha is null or p_vigente_desde is null or g.fecha >= p_vigente_desde)
        and not coalesce(g.cfdi_esquema_alterno, false)
        and not coalesce(g.complemento_hidrocarburos, false)
        and g.xml_verificado is true
        and p_exigible_desde is not null
        and (g.fecha is null or g.fecha >= p_exigible_desde)
      ) as complemento_hidrocarburos_falta,
      (
        g.fecha is not null and p_hoy is not null
        and extract(year from g.fecha)::int < extract(year from p_hoy)::int
              - (case when extract(month from p_hoy)::int = 1 then 1 else 0 end)
      ) as otro_ejercicio
    from gasto g
    -- Las liquidaciones firmadas de ESTA flota, como conjunto (hash), no una búsqueda por cada gasto:
    -- con las liquidaciones ya aprobadas (el caso normal: «cuadró sola» nace `aprobada`) la unión directa
    -- por `viaje_id` hacía 180,000 búsquedas de índice (+0.9 s de CPU medido). El filtro por tenant es
    -- equivalente al original porque el gasto y su liquidación cuelgan del MISMO viaje por llave
    -- compuesta (viaje_id, tenant_id) en las dos tablas, y `liquidacion_viaje_uidx` (viaje_id único)
    -- garantiza una fila por viaje, así que la unión no duplica gastos.
    left join (
      select l0.viaje_id, l0.id from liquidacion l0
       where l0.tenant_id = p_tenant and l0.revision in ('aprobada', 'ajustada')
    ) l on l.viaje_id = g.viaje_id
    left join descartadas d on d.id = g.id
    cross join lateral (
      select case
        when jsonb_typeof(g.ocr_extra->'renglones') = 'array' then
          coalesce((
            select sum((r->>'importe')::numeric)
            from jsonb_array_elements(g.ocr_extra->'renglones') r
            where (r->>'ajenoAlViaje') = 'true'
              and (r->>'importe') ~ '^-?[0-9]+(\.[0-9]+)?$'
          ), 0)
        else 0::numeric
      end as importe
    ) aj
    where g.tenant_id = p_tenant
      and (p_desde is null or g.fecha >= p_desde)
      and (p_hasta is null or g.fecha <= p_hasta)
      and d.id is null
  ),
  dias as (
    select viaje_id, dia, sum(monto) filter (where tiene_cfdi) as total_timbrado
    from base
    where p_tope_alimentacion is not null
      and concepto = any (coalesce(p_conceptos_alimentacion, '{}'::text[]))
      and monto > 0
    group by viaje_id, dia
    having sum(monto) filter (where tiene_cfdi) > p_tope_alimentacion
  ),
  filas as (
    select
      b.*,
      case when not b.tiene_cfdi and b.fecha is not null
           then (select count(*) from unnest(coalesce(p_cortes, '{}'::date[])) c where b.fecha < c)
      end as banda,
      case when not b.tiene_cfdi then b.rfc_emisor end as rfc_sin_cfdi,
      case when not b.tiene_cfdi
           then substring(lower(b.ocr_extra->>'urlFacturacion') from '^(?:[a-z][a-z0-9+.-]*://)?([^/?#]+)')
      end as host,
      case when not b.tiene_cfdi then nullif(upper(trim(b.ocr_extra->>'emisor')), '') end as emisor,
      d.viaje_id      as dia_viaje,
      d.dia           as dia_dia,
      d.total_timbrado as total_timbrado_dia
    from base b
    left join dias d
      on d.viaje_id = b.viaje_id and d.dia = b.dia
     and b.tiene_cfdi and b.monto > 0
     and b.concepto = any (coalesce(p_conceptos_alimentacion, '{}'::text[]))
  ),
  celdas as (
    select
      concepto, clave_prod_serv, forma_pago, pagado, pagado_forma, efos, efos_revisar, estado_sat, tiene_cfdi,
      (fecha is null) as sin_fecha, iva_estado, sobre_tope,
      banda, rfc_sin_cfdi, host, emisor,
      dia_viaje, dia_dia, total_timbrado_dia, liquidacion_firmada,
      rfc_receptor, moneda_extranjera, renglones_ajenos, consumo_bar,
      complemento_hidrocarburos_falta, otro_ejercicio,
      count(*)                                        as n,
      sum(monto)                                      as monto,
      coalesce(sum(iva_traslado), 0)                  as iva,
      coalesce(sum(ieps_traslado), 0)                 as ieps,
      count(*) filter (where ieps_traslado is null)   as ieps_nulos,
      coalesce(sum(sub_total), 0)                     as sub_total,
      count(*) filter (where sub_total is null)       as sub_total_nulos,
      min(id::text)                                   as muestra_id,
      min(cfdi_uuid)                                  as muestra_cfdi,
      max(fecha)                                      as fecha_max
    from filas
    group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'concepto', concepto,
    'claveProdServ', clave_prod_serv,
    'formaPago', forma_pago,
    'pagado', pagado,
    'pagadoForma', pagado_forma,
    'efos', efos,
    'efosRevisar', efos_revisar,
    'estadoSat', estado_sat,
    'tieneCfdi', tiene_cfdi,
    'sinFecha', sin_fecha,
    'ivaEstado', iva_estado,
    'sobreTopeEfectivo', sobre_tope,
    'banda', banda,
    'rfcEmisor', rfc_sin_cfdi,
    'host', host,
    'emisor', emisor,
    'totalTimbradoDia', total_timbrado_dia,
    'liquidacionFirmada', liquidacion_firmada,
    'rfcReceptor', rfc_receptor,
    'monedaExtranjera', moneda_extranjera,
    'renglonesAjenos', renglones_ajenos,
    'consumoBar', consumo_bar,
    'complementoHidrocarburosFalta', complemento_hidrocarburos_falta,
    'otroEjercicio', otro_ejercicio,
    'n', n,
    'monto', monto,
    'iva', iva,
    'ieps', ieps,
    'iepsNulos', ieps_nulos,
    'subTotal', sub_total,
    'subTotalNulos', sub_total_nulos,
    'muestraId', muestra_id,
    'muestraCfdi', muestra_cfdi,
    'fechaMax', to_char(fecha_max, 'YYYY-MM-DD')
  ) order by concepto, n desc, muestra_id), '[]'::jsonb)
  from celdas;
$function$

;
