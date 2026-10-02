-- ═══════════════════════════════════════════════════════════════════════════
-- 0367 · El PANEL DEL CONTADOR deja de contar dos veces el par mixto: la
--        última sede SQL del dedup que faltaba por alinear.
--
-- AUDITORÍA 32 (continuación 11), FIS-32C10-C1 (2ª aparición) /
-- DAT-32C10-C2 (4ª aparición), CRÍTICO. Dos auditores lo trajeron de vuelta y
-- el orquestador lo reprodujo contra PostgreSQL 16.14 con las 343 migraciones
-- sobre base virgen.
--
-- EL MECANISMO. `gastos_fiscales_agregados_tenant` (0362) no usa una ventana
-- con llave calculada como la 0360/0366: usa un `case` con DOS ventanas
-- distintas. Una fila con `cfdi_uuid` se numera en la partición del UUID y una
-- fila con folio en la del folio — y las funciones de ventana se evalúan sobre
-- TODAS las filas, no sólo las de su rama. Por eso el daño DEPENDE DEL ORDEN
-- DE LLEGADA, que es peor que si fuera constante:
--
--   · la copia con UUID llega primero → es `orden_copia = 1` en la partición
--     del UUID, y en la del folio ocupa el 1, así que su copia sin UUID cae al
--     2 y se descarta. El panel acierta por accidente.
--   · la copia SIN UUID llega primero → ella es el 1 de la partición del
--     folio, y la del UUID es el 1 de la suya. SOBREVIVEN LAS DOS.
--
-- MEDIDO, un ticket de diésel de $10,000 en dos filas (la foto ligada a su
-- CFDI y otra del mismo ticket sin él), con la copia sin UUID llegando primero:
--
--     PANEL 0362 : monto=20000.00  iva=2758.62  celdas=2
--     MOTOR 0365 : total=10000.00
--     la verdad  : monto=10000.00  iva=1379.31  (UN comprobante)
--
-- EL DAÑO. El contralor abre `/dashboard/fiscal`, ve DOS comprobantes y
-- $20,000.00 de diésel con $2,758.62 de IVA acreditable, lo cruza contra su
-- póliza y encuentra $10,000.00 y $1,379.31. Es textualmente lo que CLAUDE.md
-- prohíbe: «una cifra fiscal que se lee distinto en dos pantallas se lee como
-- dos cálculos». El IVA acreditable duplicado es, además, un acreditamiento
-- improcedente si el contador lo arrastra a su declaración.
--
-- LOS DOS ARNESES QUE YA EXISTÍAN DEL PANEL —`0359_panel_fiscal_dedup_emisor`
-- y `0362_panel_fiscal_desempate_estable`— **PASAN CON EL DAÑO PRESENTE**.
-- Probaban el eje del emisor y el del desempate, nunca un par mixto: la misma
-- ceguera que la 0366 documentó del `0360_cierre_dedup_emisor`.
--
-- EL CAMBIO, y es uno solo. Un CTE `con_censo_de_uuids` —espejo del que la
-- 0365 le puso al ejercicio, la 0366 al cierre y este mismo commit al motor
-- TS— y una rama PRIMERA en el `case`: cuando el grupo de folio trae UNA sola
-- fila con UUID, la numeración del FOLIO manda para todas las filas del grupo,
-- la del UUID incluida. Con `uuids_en_grupo >= 2` no se toca nada, así que dos
-- CFDI distintos que comparten concepto, folio, monto y emisor siguen contando
-- dos veces.
--
-- Nótese que la partición del censo es LA MISMA que la de la rama de folio
-- —incluido `coalesce(rfc_emisor, rfc_emisor_del_grupo, '')`—, para que el
-- censo y la llave hablen del mismo grupo. Por eso va en un CTE aparte: una
-- función de ventana no puede anidarse en el `partition by` de otra, y esta
-- partición usa `rfc_emisor_del_grupo`, que ya es resultado de ventana.
--
-- CON ESTO EL CENSO DE SEDES DEL DEDUP QUEDA EN CERO DIVERGENTES para el eje
-- del par mixto: `sumar_combustible_ejercicio` (0365), `guardar_liquidacion_tx`
-- (0366), `gastos_fiscales_agregados_tenant` (0367) y `copiasDeComprobante`
-- (`engine.ts`, en el commit `c7aed16` de esta misma ronda). Lo que NO cierra
-- es ARQ-C1 —que las cuatro sigan siendo cuatro redacciones de la misma
-- regla—, que lleva 18 apariciones y es un rediseño, no un parche.
--
-- El cuerpo de abajo es la definición VIVA de la 0362 tal como la devuelve
-- `pg_get_functiondef`, con los DOS cambios descritos y ni uno más.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.gastos_fiscales_agregados_tenant(p_tenant uuid, p_desde date, p_hasta date, p_tope_efectivo numeric, p_tope_alimentacion numeric, p_conceptos_alimentacion text[], p_cortes date[], p_claves_combustible text[], p_vigente_desde date, p_exigible_desde date, p_umbral_renglones_ajenos numeric, p_patron_bar text, p_hoy date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE PARALLEL SAFE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  with base_cruda as (
    select
      g.id, g.created_at, g.viaje_id, g.concepto, g.monto, g.fecha,
      nullif(g.rfc_emisor, '')      as rfc_emisor,
      nullif(g.cfdi_uuid, '')       as cfdi_uuid,
      g.cfdi_orden,
      nullif(g.folio, '')           as folio,
      nullif(g.folio_norm, '')      as folio_norm,
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
      (
        g.monto > 0
        and coalesce((
          select sum((r->>'importe')::numeric)
          from jsonb_array_elements(
            case when jsonb_typeof(g.ocr_extra->'renglones') = 'array'
                 then g.ocr_extra->'renglones' else '[]'::jsonb end
          ) r
          where (r->>'ajenoAlViaje') = 'true'
            and (r->>'importe') ~ '^-?[0-9]+(\.[0-9]+)?$'
        ), 0) > 0
        and coalesce((
          select sum((r->>'importe')::numeric)
          from jsonb_array_elements(
            case when jsonb_typeof(g.ocr_extra->'renglones') = 'array'
                 then g.ocr_extra->'renglones' else '[]'::jsonb end
          ) r
          where (r->>'ajenoAlViaje') = 'true'
            and (r->>'importe') ~ '^-?[0-9]+(\.[0-9]+)?$'
        ), 0) / g.monto >= p_umbral_renglones_ajenos
      ) as renglones_ajenos,
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
    left join liquidacion l on l.viaje_id = g.viaje_id and l.revision in ('aprobada', 'ajustada')
    where g.tenant_id = p_tenant
      and (p_desde is null or g.fecha >= p_desde)
      and (p_hasta is null or g.fecha <= p_hasta)
  ),
  -- FIS-A3 (0355): mismo criterio que copiasDeComprobante (engine.ts) y
  -- sumar_combustible_ejercicio (0349) — dedup por (cfdi_uuid, cfdi_orden) si
  -- hay CFDI, si no por (concepto sin acentos, folio_norm/folio, monto); sin
  -- ninguno de los dos, nunca es copia. Desempate por id, determinista.
  con_emisor_del_grupo as (
    -- DAT32C-C2 (0359): el emisor conocido del grupo (concepto, folio, monto),
    -- con la MISMA semantica que la 0358 le dio a sumar_combustible_ejercicio.
    -- `min()` ignora los NULL, asi que sale NULL solo cuando ninguna fila del
    -- grupo trae emisor. CTE aparte porque una funcion de ventana no puede
    -- anidarse en el `partition by` de otra. `bc.rfc_emisor` ya viene
    -- normalizado con `nullif(...,'')` desde base_cruda.
    select bc.*,
      min(bc.rfc_emisor) over (
        partition by unaccent(lower(bc.concepto)), coalesce(bc.folio_norm, bc.folio), bc.monto
      ) as rfc_emisor_del_grupo
    from base_cruda bc
  ),
  con_censo_de_uuids as (
    -- FIS-32C10-C1 (0367): cuantas filas del grupo de folio traen `cfdi_uuid`.
    -- Espejo literal del CTE homonimo que la 0365 le puso a
    -- `sumar_combustible_ejercicio` y la 0366 a `guardar_liquidacion_tx`. Va en
    -- un CTE aparte por la misma razon que el emisor del grupo: una funcion de
    -- ventana no puede anidarse en el `partition by` de otra, y esta particion
    -- usa `rfc_emisor_del_grupo`, que ya es resultado de ventana. `count()`
    -- ignora los NULL, asi que cuenta exactamente las filas con UUID. La
    -- particion es la MISMA que la de la rama de folio de abajo, para que el
    -- censo y la llave hablen del mismo grupo.
    select bc.*,
      count(bc.cfdi_uuid) over (
        partition by
          unaccent(lower(bc.concepto)),
          coalesce(bc.folio_norm, bc.folio),
          bc.monto,
          coalesce(bc.rfc_emisor, bc.rfc_emisor_del_grupo, '')
      ) as uuids_en_grupo
    from con_emisor_del_grupo bc
  ),
  marcadas as (
    select bc.*,
      case
        -- FIS-32C10-C1 (0367): cuando el grupo de folio trae UNA sola fila con
        -- `cfdi_uuid`, la llave del FOLIO manda para TODAS las filas del grupo,
        -- la del UUID incluida. Sin esta rama las dos filas de un par mixto
        -- --la foto timbrada y su copia sin uuid-- caen en particiones
        -- DISTINTAS por construccion, cada una es `orden_copia = 1` en la suya,
        -- y SOBREVIVEN LAS DOS cuando la copia sin uuid llega primero. Es
        -- exactamente la rama que la 0365 le puso al ejercicio y la 0366 al
        -- cierre; aqui faltaba, y por eso el panel del contador publicaba el
        -- DOBLE del ticket con su IVA acreditable duplicado.
        --
        -- Con `uuids_en_grupo >= 2` no se toca nada: dos CFDI DISTINTOS que
        -- comparten concepto, folio, monto y emisor son dos comprobantes, no
        -- copias, y siguen contando dos veces.
        when bc.folio is not null and bc.uuids_en_grupo <= 1 then
          row_number() over (
            partition by
              unaccent(lower(bc.concepto)),
              coalesce(bc.folio_norm, bc.folio),
              bc.monto,
              coalesce(bc.rfc_emisor, bc.rfc_emisor_del_grupo, '')
            order by bc.created_at, bc.id
          )
        when bc.cfdi_uuid is not null then
          row_number() over (partition by lower(bc.cfdi_uuid), coalesce(bc.cfdi_orden, 1) order by bc.created_at, bc.id)
        when bc.folio is not null then
          -- DAT32C-C2 (0359): el folio lo numera cada estacion y se reinicia por
          -- emisor, asi que dos tickets legitimos de $2,500 con folio 1234 de
          -- estaciones distintas se colapsaban en uno y el panel del contador
          -- perdia la celda entera de la segunda, con su IVA acreditable.
          row_number() over (
            partition by
              unaccent(lower(bc.concepto)),
              coalesce(bc.folio_norm, bc.folio),
              bc.monto,
              coalesce(bc.rfc_emisor, bc.rfc_emisor_del_grupo, '')
            order by bc.created_at, bc.id
          )
        else 1
      end as orden_copia
    from con_censo_de_uuids bc
  ),
  base as (
    select id, viaje_id, concepto, monto, fecha, rfc_emisor, cfdi_uuid, estado_sat,
      efos, efos_revisar, forma_pago, pagado, pagado_forma, sub_total, iva_traslado,
      ieps_traslado, clave_prod_serv, tiene_cfdi, dia, sobre_tope, iva_estado,
      ocr_extra, liquidacion_firmada, rfc_receptor, moneda_extranjera,
      renglones_ajenos, consumo_bar, complemento_hidrocarburos_falta, otro_ejercicio
    from marcadas
    where orden_copia = 1
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
