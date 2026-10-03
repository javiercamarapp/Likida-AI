\set ON_ERROR_STOP on
-- 0688 — `gastos_fiscales_agregados_tenant` sin ventanas encadenadas (ronda 16, vuelta 2).
--   (a) el esquema que el diseño da por sentado sigue ahí (uq_gasto_cfdi_uuid);
--   (b) datos fuzz: 24 flotas con colisiones deliberadas (par mixto en los dos órdenes de llegada, dos CFDI
--       distintos con el mismo folio/monto, emisores distintos, folio_norm sin folio, empates de created_at, fechas nulas);
--   (c) EQUIVALENCIA EXACTA contra una copia literal de la función de la 0367 (el oráculo), texto jsonb idéntico, 120 llamadas;
--   (d) el fuzz contiene de verdad los casos de las auditorías 0357-0367;
--   (e) el costo: una flota grande, la función nueva cuesta menos de la mitad que el oráculo (aserción relativa).
-- Los arneses 0359/0362/0367 siguen probando el dedup contra la función viva. Todo sintético, con rollback.
begin;

-- Oráculo: la definición de la 0367 TAL CUAL, con otro nombre y en pg_temp.
create function pg_temp.gfa_0367(p_tenant uuid, p_desde date, p_hasta date, p_tope_efectivo numeric, p_tope_alimentacion numeric, p_conceptos_alimentacion text[], p_cortes date[], p_claves_combustible text[], p_vigente_desde date, p_exigible_desde date, p_umbral_renglones_ajenos numeric, p_patron_bar text, p_hoy date)
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
$function$;

-- ── Esquema que el diseño nuevo da por sentado (si cambia, esta prueba lo dice) ──
do $$
begin
  -- (1) el dedup por UUID no puede tener grupos de más de una fila dentro de un tenant
  if not exists (select 1 from pg_index i where i.indexrelid = 'public.uq_gasto_cfdi_uuid'::regclass and i.indisunique) then
    raise exception '0688(a): falta uq_gasto_cfdi_uuid';
  end if;
end $$;

-- ── (b) DATOS FUZZ: 24 flotas con colisiones deliberadas ─────────────────────
-- Dominios chicos para que choquen: mismo concepto/folio/monto con y sin UUID, con y sin emisor,
-- folio_norm sin folio, empates exactos de created_at (desempata el id), fechas nulas y ocr_extra
-- con renglones ajenos. Semilla fija: la misma data en cada corrida.
select setseed(0.688);
insert into public.tenant (id, nombre, plan)
select ('68800000-0000-4000-8000-0000000000' || lpad(t::text, 2, '0'))::uuid, 'Fuzz 0688 ' || t, 'demo'
  from generate_series(1, 24) t;
insert into public.operador (id, tenant_id, nombre, telefono)
select ('68800000-0000-4000-8000-0000000001' || lpad(t::text, 2, '0'))::uuid,
       ('68800000-0000-4000-8000-0000000000' || lpad(t::text, 2, '0'))::uuid, 'Operador 0688 ' || t, '5215568800' || lpad(t::text, 3, '0')
  from generate_series(1, 24) t;
insert into public.viaje (id, tenant_id, operador_id, folio, estatus)
select ('68800000-0000-4000-8000-000000020' || lpad(t::text, 2, '0') || v::text)::uuid,
       ('68800000-0000-4000-8000-0000000000' || lpad(t::text, 2, '0'))::uuid,
       ('68800000-0000-4000-8000-0000000001' || lpad(t::text, 2, '0'))::uuid, 'F0688-' || t || '-' || v, 'liquidado'
  from generate_series(1, 24) t, generate_series(1, 3) v;

create temp table fuzz_gen as
select t, i,
       random() as r1, random() as r2, random() as r3, random() as r4, random() as r5, random() as r6,
       random() as r7, random() as r8, random() as r9, random() as r10, random() as r11, random() as r12
  from generate_series(1, 24) t, generate_series(1, 260) i;

insert into public.gasto
  (id, tenant_id, viaje_id, concepto, monto, fecha, folio, folio_norm, rfc_emisor, cfdi_uuid, cfdi_orden,
   forma_pago, iva_traslado, sub_total, ieps_traslado, estado_sat, efos, tipo_comprobante, xml_verificado,
   clave_prod_serv, pagado_en, pagado_forma, rfc_receptor, ocr_extra, created_at)
select md5('0688-gasto-' || t || '-' || i)::uuid,
       ('68800000-0000-4000-8000-0000000000' || lpad(t::text, 2, '0'))::uuid,
       ('68800000-0000-4000-8000-000000020' || lpad(t::text, 2, '0') || (1 + floor(r1 * 3))::int::text)::uuid,
       (array['diesel','diesel','diesel','caseta','alimentacion','alimentacion','viaticos','otro','factura'])[1 + floor(r2 * 9)::int],
       (array[100, 250.5, 500, 1000, 2500, 10000])[1 + floor(r3 * 6)::int],
       case when r4 < 0.05 then null else date '2026-01-01' + floor(r4 * 270)::int end,
       case when r5 < 0.12 then null when r5 < 0.17 then '' else (array['1','2','3','A-1','a-1','0001','F 9'])[1 + floor(r5 * 7)::int] end,
       case when r5 < 0.12 and r6 < 0.3 then (array['1','A-1'])[1 + floor(r6 * 2)::int]   -- folio_norm SIN folio
            when r5 < 0.17 then null
            when r6 < 0.25 then null
            else (array['1','2','3','a-1','1','9'])[1 + floor(r5 * 6)::int] end,
       case when r7 < 0.3 then null when r7 < 0.34 then '' else (array['XAXX010101000','XEXX010101000','AAA010101AAA'])[1 + floor(r7 * 3)::int] end,
       case when r8 < 0.5 then null when r8 < 0.53 then '' else md5('0688-uuid-' || t || '-' || i) end,
       case when r8 >= 0.5 and r8 < 0.53 then i when r9 < 0.9 then 1 else 2 end,   -- UUID '' repetido: orden distinto (uq_gasto_cfdi_uuid)
       case when r9 < 0.3 then null else (array['01','03','04'])[1 + floor(r9 * 3)::int] end,
       case when r10 < 0.2 then null when r10 < 0.3 then 0 else round((r10 * 1000)::numeric, 2) end,
       case when r10 < 0.4 then null else round((r10 * 900)::numeric, 2) end,
       case when r10 < 0.7 then null else round((r10 * 10)::numeric, 2) end,
       (array['vigente','cancelado','no_encontrado',null])[1 + floor(r11 * 4)::int],
       case when r11 < 0.1 then true when r11 < 0.2 then false else null end,
       case when r11 < 0.6 then 'I' when r11 < 0.7 then 'E' else null end,
       case when r11 < 0.8 then true else null end,
       case when r12 < 0.4 then '15101514' else null end,
       case when r12 < 0.3 then date '2026-02-01' else null end,
       case when r12 < 0.15 then '01' else null end,
       case when r12 < 0.5 then 'XAXX010101000' else null end,
       case when r1 < 0.15 then jsonb_build_object('emisor', 'Oxxo Prueba ' || t, 'urlFacturacion', 'https://Facturacion.Ejemplo.mx/' || i)
            when r1 < 0.25 then jsonb_build_object('moneda', case when r2 < 0.5 then 'USD' else 'MXN' end,
                                'renglones', jsonb_build_array(jsonb_build_object('importe', '450.00', 'ajenoAlViaje', true),
                                                               jsonb_build_object('importe', '20', 'ajenoAlViaje', false)))
            when r1 < 0.3 then jsonb_build_object('producto', 'Cerveza oxxo', 'renglones', 'no-es-arreglo')
            else null end,
       timestamptz '2026-01-01 00:00:00+00' + make_interval(hours => (floor(r12 * 24) * 12)::int)   -- empates frecuentes
  from fuzz_gen;

-- una liquidación aprobada/ajustada/pendiente en algunos viajes (el join de liquidacion_firmada)
select set_config('likida.revision_en_curso', '1', true);   -- como la RPC revisar_liquidacion: nacen ya firmadas
insert into public.liquidacion (id, tenant_id, viaje_id, total_comprobado, total_anticipo, diferencia, estatus, revision, revisada_en, motivo)
select md5('0688-liq-' || t || '-' || v)::uuid,
       ('68800000-0000-4000-8000-0000000000' || lpad(t::text, 2, '0'))::uuid,
       ('68800000-0000-4000-8000-000000020' || lpad(t::text, 2, '0') || v::text)::uuid, 0, 0, 0, 'cuadrada',
       (array['aprobada','ajustada','pendiente'])[v], case when v < 3 then now() end, 'prueba 0688'
  from generate_series(1, 24) t, generate_series(1, 3) v where (t + v) % 2 = 0;
select set_config('likida.revision_en_curso', '', true);

analyze public.gasto;

-- ── (c) EQUIVALENCIA EXACTA: cada llamada nueva == oráculo 0367, texto idéntico ──
do $$
declare
  t uuid; k int; combos int := 0; distintas int := 0;
  p record; nuevo jsonb; viejo jsonb; algun_dedup boolean := false; filas_ref int; filas_base int;
begin
  for p in
    select * from (values
      -- desde, hasta, tope_efectivo, tope_alim, conceptos_alim, cortes, claves, vigente, exigible, umbral, patron, hoy
      (null::date, null::date, 2000::numeric, 750::numeric, array['alimentacion','viaticos'], array[]::date[], array['15101514'], null::date, null::date, 3::numeric, '\yoxxo\y', date '2026-10-02'),
      (date '2026-01-01', date '2026-12-31', 2000, 750, array['alimentacion','viaticos'], array[date '2026-03-01', date '2026-07-01'], array['15101514'], date '2026-01-01', date '2026-02-01', 3, '\yoxxo\y', date '2026-10-02'),
      (date '2026-03-01', date '2026-05-31', 500, 300, array['alimentacion'], array[date '2026-04-15'], array['15101514', '99999999'], date '2026-04-01', date '2026-03-15', 0.5, 'cerveza', date '2027-01-15'),
      (null, date '2026-06-30', 2000, null, array['alimentacion','viaticos'], null, null, null, null, 3, null, date '2026-10-02'),
      (date '2026-06-01', null, 1500, 100, null, array[date '2026-09-01'], array[]::text[], null, date '2026-06-01', 1, '\yoxxo\y', date '2026-12-31')
    ) as v(d, h, te, ta, ca, co, cl, vi, ex, um, pa, ho)
  loop
    for k in 1..24 loop
      t := ('68800000-0000-4000-8000-0000000000' || lpad(k::text, 2, '0'))::uuid;
      nuevo := public.gastos_fiscales_agregados_tenant(t, p.d, p.h, p.te, p.ta, p.ca, p.co, p.cl, p.vi, p.ex, p.um, p.pa, p.ho);
      viejo := pg_temp.gfa_0367(t, p.d, p.h, p.te, p.ta, p.ca, p.co, p.cl, p.vi, p.ex, p.um, p.pa, p.ho);
      combos := combos + 1;
      if nuevo::text is distinct from viejo::text then
        raise exception '0688(c): divergencia en flota % con desde=% hasta=%:% nuevo=% % viejo=%', k, p.d, p.h, E'\n', nuevo, E'\n', viejo;
      end if;
      if (select coalesce(sum((c->>'n')::int), 0) from jsonb_array_elements(nuevo) c)
         < (select count(*) from public.gasto g where g.tenant_id = t and (p.d is null or g.fecha >= p.d) and (p.h is null or g.fecha <= p.h)) then
        algun_dedup := true;   -- hubo copias descartadas: el dedup se ejercitó de verdad
      end if;
    end loop;
  end loop;
  if combos <> 120 then raise exception '0688(c): esperaba 120 comparaciones, hubo %', combos; end if;
  if not algun_dedup then raise exception '0688(c): los datos fuzz no ejercitaron el dedup'; end if;
end $$;

-- ── (d) el fuzz SÍ contiene los casos de las auditorías 0357-0367, no solo ruido ──
do $$
declare par_mixto int; mismo_cfdi_distinto int; emisor_distinto int; sin_uuid_dup int;
begin
  -- par mixto: un grupo (concepto, folio, monto) con exactamente 1 fila con UUID y otras sin UUID
  select count(*) into par_mixto from (
    select g.tenant_id, g.concepto, coalesce(g.folio_norm, g.folio), g.monto
      from public.gasto g where g.tenant_id::text like '68800000-%' and coalesce(g.folio_norm, g.folio, '') <> ''
     group by 1, 2, 3, 4 having count(*) > 1 and count(nullif(g.cfdi_uuid, '')) = 1) x;
  -- dos CFDI distintos con el mismo folio/monto/concepto
  select count(*) into mismo_cfdi_distinto from (
    select g.tenant_id, g.concepto, coalesce(g.folio_norm, g.folio), g.monto
      from public.gasto g where g.tenant_id::text like '68800000-%' and coalesce(g.folio_norm, g.folio, '') <> ''
     group by 1, 2, 3, 4 having count(nullif(g.cfdi_uuid, '')) >= 2) x;
  -- mismo folio/monto con emisores distintos
  select count(*) into emisor_distinto from (
    select g.tenant_id, g.concepto, coalesce(g.folio_norm, g.folio), g.monto
      from public.gasto g where g.tenant_id::text like '68800000-%' and coalesce(g.folio_norm, g.folio, '') <> ''
     group by 1, 2, 3, 4 having count(distinct nullif(g.rfc_emisor, '')) >= 2) x;
  select count(*) into sin_uuid_dup from (
    select g.tenant_id, g.concepto, coalesce(g.folio_norm, g.folio), g.monto
      from public.gasto g where g.tenant_id::text like '68800000-%' and coalesce(g.folio_norm, g.folio, '') <> ''
     group by 1, 2, 3, 4 having count(*) > 1 and count(nullif(g.cfdi_uuid, '')) = 0) x;
  if par_mixto < 10 or mismo_cfdi_distinto < 10 or emisor_distinto < 10 or sin_uuid_dup < 10 then
    raise exception '0688(d): el fuzz no cubre los casos (par_mixto %, cfdi_distintos %, emisores %, sin_uuid %)',
      par_mixto, mismo_cfdi_distinto, emisor_distinto, sin_uuid_dup;
  end if;
end $$;

-- ── (e) EL COSTO: un ejercicio completo de una flota grande ya no paga 4 ventanas sobre filas anchas ──
-- 40,000 gastos de UNA flota (el ejercicio de ~7 meses de 5,000 viajes/mes), con ~5% de copias.
-- La aserción es RELATIVA (nuevo vs oráculo en la misma máquina, mismos datos, work_mem de CI): el viejo
-- ordenaba 4 veces filas con jsonb y derramaba a disco; el nuevo solo ordena los grupos con copias.
set local work_mem = '4MB';
insert into public.tenant (id, nombre, plan) values ('68800000-0000-4000-8000-0000000000ff', 'Flota grande 0688', 'demo');
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('68800000-0000-4000-8000-0000000001ff', '68800000-0000-4000-8000-0000000000ff', 'Operador 0688 grande', '5215568800999');
insert into public.viaje (id, tenant_id, operador_id, folio, estatus)
select md5('0688-viaje-grande-' || v)::uuid, '68800000-0000-4000-8000-0000000000ff', '68800000-0000-4000-8000-0000000001ff', 'G0688-' || v, 'liquidado'
  from generate_series(1, 40) v;
insert into public.gasto (id, tenant_id, viaje_id, concepto, monto, fecha, folio, folio_norm, rfc_emisor, cfdi_uuid, iva_traslado, ocr_extra, created_at)
select md5('0688-gasto-grande-' || i)::uuid, '68800000-0000-4000-8000-0000000000ff',
       md5('0688-viaje-grande-' || (1 + j % 40))::uuid,
       (array['diesel','caseta','alimentacion'])[1 + j % 3],
       100 + (j % 1900) + ((j % 7) * 0.5),
       date '2026-01-01' + (j % 270),
       'G' || j, 'G' || j,                       -- cada 20ª fila repite el folio, concepto y monto de la anterior: una copia
       'XAXX010101000',
       case when i % 40 = 0 or (j % 2 = 0 and i % 20 <> 0) then md5('0688-uuid-grande-' || i) end,   -- 1 de cada 40: copia CON uuid de un original sin él (par mixto)
       16.00,
       case when i % 11 = 0 then jsonb_build_object('emisor', 'Gasolinera de prueba', 'urlFacturacion', 'https://f.ejemplo.mx/' || i, 'notas', repeat('x', 200)) end,
       timestamptz '2026-01-01 00:00:00+00' + make_interval(secs => i)
  from generate_series(1, 40000) i, lateral (select case when i % 20 = 0 then i - 1 else i end as j) q;
analyze public.gasto;

do $$
declare
  t uuid := '68800000-0000-4000-8000-0000000000ff';
  t0 timestamptz; viejo_ms numeric := 1e12; nuevo_ms numeric := 1e12; r jsonb; r2 jsonb; i int;
begin
  for i in 1..3 loop
    t0 := clock_timestamp();
    r := pg_temp.gfa_0367(t, '2026-01-01', '2026-12-31', 2000, 750, array['alimentacion','viaticos'], array[date '2026-03-01']::date[], array['15101514'], null, null, 3, '\yoxxo\y', '2026-10-02');
    viejo_ms := least(viejo_ms, extract(epoch from clock_timestamp() - t0) * 1000);
    t0 := clock_timestamp();
    r2 := public.gastos_fiscales_agregados_tenant(t, '2026-01-01', '2026-12-31', 2000, 750, array['alimentacion','viaticos'], array[date '2026-03-01']::date[], array['15101514'], null, null, 3, '\yoxxo\y', '2026-10-02');
    nuevo_ms := least(nuevo_ms, extract(epoch from clock_timestamp() - t0) * 1000);
  end loop;
  if r2::text is distinct from r::text then raise exception '0688(e): la salida de la flota grande no coincide con el oráculo'; end if;
  raise notice '0688(e): oraculo % ms, nuevo % ms (razon %)', round(viejo_ms), round(nuevo_ms), round(viejo_ms / nuevo_ms, 1);
  if nuevo_ms * 1.6 > viejo_ms then
    raise exception '0688(e): el costo no bajó a (al menos) 1/1.6 del oráculo (oráculo % ms, nuevo % ms)', round(viejo_ms), round(nuevo_ms);
  end if;
end $$;

rollback;
