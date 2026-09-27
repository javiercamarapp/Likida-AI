-- ═══════════════════════════════════════════════════════════════════════════
-- 0362 · El desempate del dedup del panel fiscal: `created_at, id`, no `id`.
--
-- AUDITORÍA 32 (continuación 6), DAT-32C6-A2 (ALTO).
--
-- Cuando dos filas son copias del MISMO comprobante, las cuatro
-- implementaciones del dedup se quedan con una. Hasta aquí no coincidían en
-- CUÁL, y sólo el panel era la rareza:
--
--   cierre       0360:161   order by created_at, id        → la primera en llegar
--   póliza       0361:122   order by gg.created_at, gg.id  → la primera en llegar
--   motor TS     engine.ts `copiasDeComprobante`           → la primera de la lista
--   panel        0359:155/:167  order by bc.id             → min(uuid)  ← ESTA
--
-- Un uuid v4 no guarda ninguna relación con el orden de llegada, así que el
-- panel conservaba una fila AL AZAR de entre las copias, y hacia el lado
-- contrario de los otros tres.
--
-- POR QUÉ NO SE VIO ANTES, y es lo que hace al hallazgo caro: el TOTAL no se
-- mueve. `monto` está en la partición, así que las dos copias tienen el mismo
-- monto y `sum(monto)` sale igual con cualquier desempate — que es justo lo que
-- afirman los arneses de la 0358, la 0359 y la 0360. Lo que sí se mueve es todo
-- lo que NO está en la partición: `sub_total`, `iva_traslado`, `ieps_traslado`,
-- `estado_sat`, `rfc_receptor`.
--
-- EL DAÑO, con valores. El chofer manda la foto buena de un ticket de diésel de
-- $2,500 y luego una borrosa del MISMO ticket. La buena trae el desglose
-- ($2,155.17 de base, $344.83 de IVA); la borrosa viene sin él. El PDF y el
-- asiento que el contador sube a su ERP se quedan con la buena. El panel se
-- quedaba con la que tocara, y cuando tocaba la borrosa publicaba **base $0 e
-- IVA acreditable $0** sobre un comprobante real de $2,500. El contralor cruza
-- la cifra del panel contra su póliza y no cuadra, en una dirección que no
-- puede reconciliar porque no hay regla: es el uuid.
--
-- Es la misma enfermedad que DAT32C-C2 —«una cifra fiscal que se lee distinto
-- en dos pantallas se lee como dos cálculos»— por un eje que ninguna prueba
-- ejercitaba.
--
-- El cuerpo de abajo es la definición VIVA de la 0359 tal como la devuelve
-- `pg_get_functiondef`, con TRES cambios textuales y ni uno más: `created_at`
-- entra a `base_cruda`, y los DOS `order by bc.id` de los `row_number()` pasan
-- a `order by bc.created_at, bc.id`. No se toca la firma, ni `search_path`, ni
-- SECURITY INVOKER, ni la ACL (sobrevive al `create or replace`), ni la
-- partición: quién es copia no cambia, sólo cuál de las copias se conserva.
-- `created_at` es `not null default now()` y ya tiene índice
-- (`gasto_created_at_idx`), así que el desempate no puede caer en NULL ni
-- cuesta un plan nuevo. `id` se conserva como segundo criterio para que el
-- orden siga siendo total cuando dos copias comparten `created_at` al
-- microsegundo — sin él, el empate volvería a ser indeterminado.
--
-- Se hace en migración aparte y por reemplazo completo, igual que la 0359 y la
-- 0361, porque reescribir 190 líneas a mano para cambiar tres es cómo se cuela
-- una diferencia que nadie ve.
--
-- NO se toca `version`: esta función no la publica (es el `jsonb` de celdas del
-- panel, no la RPC versionada de la póliza), así que no hay contrato de versión
-- que mover ni `RPC_VERSION_MINIMA` que subir.
--
-- Prueba: `supabase/tests/0362_panel_fiscal_desempate_estable.sql`, cableada en
-- ci-postgres. Es determinista a propósito —la fila buena tiene el uuid MAYOR y
-- el `created_at` MENOR—, así que el desempate viejo y el nuevo eligen filas
-- distintas y el arnés no puede pasar con los dos. Rojo medido antes de esta
-- migración: `muestraId=00000362-…-0002` (la borrosa) donde se espera
-- `ffff0362-…-0001`.
-- ═══════════════════════════════════════════════════════════════════════════
begin;

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
  marcadas as (
    select bc.*,
      case
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
  '0362 (DAT-32C6-A2): el dedup del panel fiscal desempata por (created_at, id) como el cierre (0360), la poliza (0361) y copiasDeComprobante en TS, en vez de por min(uuid). La particion —quien es copia— no cambia; cambia cual de las copias se conserva, y con ella todo lo que no esta en la particion: sub_total, iva_traslado, ieps_traslado, estado_sat, rfc_receptor. Antes, de dos fotos del mismo ticket de $2,500 el panel podia quedarse con la borrosa y publicar base $0 e IVA acreditable $0 donde el PDF y el asiento publican $2,155.17 y $344.83. El total no lo delataba porque monto esta en la particion. Todo lo demas de la 0359/0355/0316/0317 queda intacto.';

commit;
