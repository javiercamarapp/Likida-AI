-- ═══════════════════════════════════════════════════════════════════════════
-- 0688 · `gastos_fiscales_agregados_tenant` (Resumen y panel del Contador) deja
--        de ordenar CUATRO veces el ejercicio completo con las filas anchas.
--
-- RONDA 16, vuelta 2 (prueba de carga de 250 camiones / 5,000 viajes al mes,
-- scripts/carga/250-camiones/). Con ~180,000 gastos del ejercicio la función
-- tardaba 4.5-7 s en p50 y 10-30 s en p95, y crece lineal con el historial:
--
--   · la 0367 numeraba las copias con cuatro funciones de ventana encadenadas
--     (`min` del emisor del grupo, `count` de UUID, `row_number` por folio y
--     `row_number` por UUID) sobre `base_cruda`, que arrastra las 40 columnas
--     de `gasto` —el `ocr_extra` jsonb incluido—: cuatro ordenamientos de
--     todas las filas, en disco, con `unaccent` por fila;
--   · y las dos subconsultas de `renglones_ajenos` se evaluaban dos veces por fila.
--
-- EL DISEÑO NUEVO (misma salida, comprobada con md5 contra la 0367):
--
--   1. PASADA ESTRECHA: una lectura del periodo con SOLO las 8 columnas que
--      deciden el dedup (id, created_at, concepto sin acentos, monto, emisor,
--      UUID, orden, folio). Un `group by ... having count(*) > 1` (hash, sin
--      ordenar) saca los grupos (concepto, folio, monto) con más de una fila.
--   2. LAS VENTANAS SOLO CORREN SOBRE ESOS GRUPOS. Una fila cuyo grupo de folio
--      es de una sola fila es siempre `orden_copia = 1` (su `min` es ella, su
--      censo de UUID es 0 o 1, su `row_number` es 1), así que no necesita
--      ventana. Con datos limpios los grupos con copias son una fracción
--      mínima; con muchas copias el trabajo crece con las copias, no con el
--      ejercicio. Las ventanas son LAS MISMAS de la 0367 (mismas particiones,
--      mismo orden, mismo desempate por id, mismo censo del par mixto 0367).
--   3. El dedup por UUID (`lower(uuid), orden`) se resuelve igual: solo los
--      grupos con más de una fila entran a la ventana. Bajo `uq_gasto_cfdi_uuid`
--      (tenant, uuid, orden) y `gasto_cfdi_uuid_minuscula` esa lista es vacía;
--      se conserva por si algún día esos invariantes cambian (la prueba lo vigila).
--   4. PASADA ANCHA: las columnas completas SOLO se calculan para las filas
--      que sobreviven (anti-join contra el conjunto de `descartadas`, que es
--      pequeño), y `renglones_ajenos` se evalúa UNA vez por fila.
--   5. LA LIQUIDACIÓN FIRMADA como conjunto por hash (ver el comentario del join): con las
--      liquidaciones ya aprobadas ahorra otros 0.6 s de CPU de los 2.7 s medidos.
--
-- DESCARTADO, y por qué (para no re-litigarlo): un agregado incremental por
-- trigger. De las 26 dimensiones de las celdas, 9 dependen de PARÁMETROS de la
-- llamada (tope de efectivo, tope de alimentación, cortes de plazo, claves de
-- combustible, vigencias de hidrocarburos, umbral de renglones ajenos, patrón de
-- bar, `hoy`) y el dedup depende del orden de llegada (ver 0367): una tabla
-- resumen tendría que replicar la regla en un trigger y reconstruirse en cada
-- cambio de parámetro del tenant, con el riesgo de divergir en silencio.
--
-- MISMO contrato que la 0367: misma firma, mismo tipo de retorno, STABLE,
-- PARALLEL SAFE, mismo search_path. CREATE OR REPLACE conserva los GRANT
-- (solo service_role). La salida es byte a byte la de la 0367:
-- supabase/tests/0688_gastos_fiscales_sin_ventanas_encadenadas.sql la compara
-- con una copia literal de la 0367 sobre 24 flotas con colisiones deliberadas
-- (par mixto en los dos órdenes de llegada, dos CFDI distintos con el mismo
-- folio, emisores distintos, folio_norm sin folio, empates de created_at, fechas
-- nulas), 5 combinaciones de parámetros y periodos con y sin cota.
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
      coalesce(nullif(g.folio_norm, ''), nullif(g.folio, '')) as fk
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
        order by x.created_at, x.id
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
        order by e.created_at, e.id
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
