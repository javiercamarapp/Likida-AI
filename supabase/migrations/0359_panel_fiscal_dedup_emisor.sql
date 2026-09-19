-- AUDITORÍA 32, continuación 17-sep. DAT32C-C2 (CRÍTICO): el arreglo de ARQ-A3
-- (0357/0358) cerró UNA de las dos copias del predicado de «mismo comprobante».
-- Lo encontró el auditor de modelo de datos barriendo las 334 migraciones por
-- `row_number() over`, y está medido contra Postgres 16.
--
-- DOS FUNCIONES APLICAN ESE CRITERIO SOBRE UN UNIVERSO GRANDE, y desde ayer ya
-- no dicen lo mismo:
--   · `sumar_combustible_ejercicio` (0357/0358) — tenant + ejercicio — dedupa
--     por folio MIRANDO el emisor.
--   · `gastos_fiscales_agregados_tenant` (0355:110) — tenant + rango de fechas,
--     que el panel del contador llena con el año completo — dedupa por folio SIN
--     mirarlo, aunque ya calcula `nullif(g.rfc_emisor,'')` doce líneas arriba
--     (0355:30) y lo publica como dimensión de celda (`rfcEmisor`).
--
-- Medido antes de este arreglo, sobre las MISMAS dos filas (dos estaciones
-- distintas, folio 1234, $2,500 cada una):
--     sumar_combustible_ejercicio  →  5000.00
--     gastos_fiscales_agregados    →  2500.00   (una sola celda, n:1,
--                                                rfcEmisor "ESA030303CCC")
--     iva del panel                →   344.83   (la otra celda se evaporó)
--     la verdad en la base         →  5000.00 y 689.66
-- La estación B no sale como advertencia: sale como ausencia. `orden_copia = 1`
-- (0355:122) tira la fila entera antes de agregar, así que su IVA acreditable no
-- se recupera por ningún lado.
--
-- POR QUÉ ES CRÍTICO. El contralor abre `/dashboard/fiscal`, ve $2,500 de diésel
-- y $344.83 de IVA acreditable, lo cruza contra su póliza y encuentra $5,000 y
-- $689.66. Es lo que CLAUDE.md prohíbe con todas sus letras: «una cifra fiscal
-- que se lee distinto en dos pantallas se lee como dos cálculos», y «un rótulo
-- tiene que ser verdad».
--
-- EL ARREGLO: se porta a esta función EXACTAMENTE la misma semántica que la 0358
-- le dio a su hermana — el emisor discrimina solo cuando se CONOCE, y una fila
-- sin emisor hereda el del grupo (concepto, folio, monto) en vez de abrir
-- partición propia. Así las cuatro direcciones quedan iguales en las dos
-- pantallas, que es el punto:
--   1. emisores distintos, los dos conocidos → NO son copias
--   2. mismo emisor                          → SÍ son copias
--   3. emisor NULO en ambos                  → SÍ son copias
--   4. emisor en uno y NULO en el otro       → SÍ son copias
--
-- El cuerpo de abajo es la definición VIVA de la 0355 tal como la devuelve
-- `pg_get_functiondef`, con un solo cambio textual: el CTE `marcadas` y el
-- `con_emisor_del_grupo` que lo alimenta. Nada más de la función se toca — ni
-- firma, ni `search_path`, ni SECURITY INVOKER, ni la ACL (sobrevive al
-- `create or replace`). Se hizo así a propósito: reescribir 190 líneas a mano
-- para cambiar cuatro es cómo se cuela una diferencia que nadie ve.
--
-- Prueba: `supabase/tests/0359_panel_fiscal_dedup_emisor.sql`, cableada en
-- ci-postgres. Fija las cuatro direcciones Y que las dos funciones coincidan
-- sobre las mismas filas. Rojo medido antes del arreglo: panel=3500 contra
-- motor=6000.
begin;

CREATE OR REPLACE FUNCTION public.gastos_fiscales_agregados_tenant(p_tenant uuid, p_desde date, p_hasta date, p_tope_efectivo numeric, p_tope_alimentacion numeric, p_conceptos_alimentacion text[], p_cortes date[], p_claves_combustible text[], p_vigente_desde date, p_exigible_desde date, p_umbral_renglones_ajenos numeric, p_patron_bar text, p_hoy date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE PARALLEL SAFE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  with base_cruda as (
    select
      g.id, g.viaje_id, g.concepto, g.monto, g.fecha,
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
  marcadas as (
    select bc.*,
      case
        when bc.cfdi_uuid is not null then
          row_number() over (partition by lower(bc.cfdi_uuid), coalesce(bc.cfdi_orden, 1) order by bc.id)
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
            order by bc.id
          )
        else 1
      end as orden_copia
    from con_emisor_del_grupo bc
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
$function$;

comment on function public.gastos_fiscales_agregados_tenant(uuid, date, date, numeric, numeric, text[], date[], text[], date, date, numeric, text, date) is
  '0359 (DAT32C-C2): el dedup por folio del panel fiscal mira al emisor con la misma semantica que la 0358 le dio a sumar_combustible_ejercicio — el folio lo numera cada estacion y se reinicia por emisor, asi que dos tickets legitimos con folio 1234 de estaciones distintas colapsaban en uno y el panel perdia la celda entera de la segunda con su IVA acreditable ($2,500/$344.83 impresos contra $5,000/$689.66 reales), contradiciendo al motor del 15% sobre las mismas filas. Una fila sin rfc_emisor hereda el del grupo en vez de abrir particion propia, para no repetir la regresion DAT32C-C1. Todo lo demas de la 0355/0316/0317 queda intacto.';

commit;
