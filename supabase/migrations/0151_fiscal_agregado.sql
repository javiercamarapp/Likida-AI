-- ═══════════════════════════════════════════════════════════════════════════
-- 0151 — gastos_fiscales_agregados_tenant: el panel fiscal a 50k viajes/mes
--        SIN mover la ley fiscal a SQL.
--
-- `getGastosFiscales` (fiscal.ts) traía a JS TODOS los comprobantes del
-- periodo (periodo por defecto: el EJERCICIO) y luego `traerPorIds` sobre los
-- viajes para ponerles folio/operador. Con 300k gastos/mes el `traerTodo`
-- (techo 100,000 filas) lanza ~día 10 del año; las 600k ids de viaje son
-- 3,000 viajes de red. Y `getGastosFiscalesSeries` pedía además la vista
-- 'todo' sin cota. Mapa: docs/escala-50k/MAPA.md #3 y #4.
--
-- La 0112 NO lo movió a RPC, y su razón sigue siendo válida: `resumirFiscal`
-- y `resumirPerdidas` son LEY (deducibilidad por comprobante: LISR 27-III,
-- 28-V, LIVA 5, CFF 69-B, RFA 2.9, plazo del portal) y reescribirla en SQL la
-- duplicaría en dos lenguajes que habría que mantener sincronizados.
--
-- ESTA FUNCIÓN NO JUZGA NADA. Hace lo que un `group by` sabe hacer: agrupa
-- los comprobantes por las dimensiones EXACTAS que la ley en TS consulta por
-- fila y devuelve por celda las sumas y conteos. Las mismas funciones de
-- fiscal.ts reciben las celdas (como `GastoFiscal` con `celda.n`) y pesan
-- cada una por `n`. Cientos de celdas en vez de millones de filas; la regla
-- sigue en UN sitio. Prueba de equivalencia: fiscal_agregado.test.ts
-- (la reducción JS sobre filas crudas vs sobre celdas, mismo dataset).
--
-- Dimensiones (una celda = una combinación):
--   concepto, clave_prod_serv, forma_pago, estado_sat, efos, efos_revisar,
--   tiene_cfdi, sin_fecha, iva_estado (nulo / positivo / no_positivo),
--   sobre_tope (monto > p_tope_efectivo, FILA POR FILA),
--   y SOLO para los sin CFDI: banda de fecha, rfc_emisor, host del portal y
--   emisor leído (lo que `identificarComercio` mira para saber el plazo);
--   y SOLO para alimentación timbrada de un (viaje, día) cuyo total timbrado
--   rebasa p_tope_alimentacion: ese (viaje, día) y su total.
--
-- Los tres juicios que no son categóricos y cómo se resuelven SIN mover la regla:
--   · `monto > efectivoTopeMxn` (LISR 27-III): el tope lo manda el llamador
--     desde la config del tenant y SQL solo parte las filas en dos montones.
--     Sobre la SUMA de una celda no se puede evaluar ($3,000 en tres tickets
--     de $1,000 no rebasan $2,000) — por eso es dimensión y no agregado.
--   · Proporción de alimentación por (viaje, día) (LISR 28-V / LIVA 5-I):
--     solo altera el resultado cuando lo TIMBRADO del día rebasa el tope
--     (`min(1, tope/totalTimbrado)`; si no rebasa, p = 1). Esos días —raros—
--     se parten en celdas propias con su total; la FÓRMULA la aplica
--     `resumirFiscal` con `diasSobreTope` del motor, no esta función.
--   · Plazo del portal: `vencido` es monótono en la fecha para un plazo
--     dado, así que TS calcula con el reloj real (`calcularCaducidad`) un
--     CORTE por plazo distinto del catálogo y lo manda en `p_cortes`
--     (ascendente); aquí solo se cuenta cuántos cortes quedan por encima de
--     la fecha del ticket (`banda`). Identificar el comercio y decidir
--     vencido sigue siendo de `facturacion/`.
--
-- `fecha` es la del COMPROBANTE (la que decide el periodo para el SAT);
-- `p_desde`/`p_hasta` nulos = sin cota ('todo'). Los sin fecha quedan fuera
-- de cualquier corte y se cuentan (`sin_fecha`) cuando entran.
--
-- Índice: `gasto_tenant_fecha_idx` (0111, tenant_id + fecha) sirve el rango;
-- el `group by` corre sobre esas filas. No se agrega índice: sin EXPLAIN que
-- lo justifique (regla 4), y el filtro es el mismo que el de la 0112.
--
-- Molde 0112: SECURITY INVOKER (RLS de `gasto` sigue encima), `p_tenant` sin
-- default (olvidarlo es un 404 de PostgREST, no la base entera), revoke de
-- public/anon/authenticated + grant a service_role. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.gastos_fiscales_agregados_tenant(
  p_tenant uuid,
  p_desde date,
  p_hasta date,
  p_tope_efectivo numeric,
  p_tope_alimentacion numeric,
  p_conceptos_alimentacion text[],
  p_cortes date[]
)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  with base as (
    select
      g.id, g.viaje_id, g.concepto, g.monto, g.fecha,
      nullif(g.rfc_emisor, '')      as rfc_emisor,
      nullif(g.cfdi_uuid, '')       as cfdi_uuid,
      nullif(g.estado_sat, '')      as estado_sat,
      g.efos, g.efos_revisar,
      nullif(g.forma_pago, '')      as forma_pago,
      g.sub_total, g.iva_traslado, g.ieps_traslado,
      nullif(g.clave_prod_serv, '') as clave_prod_serv,
      (nullif(g.cfdi_uuid, '') is not null) as tiene_cfdi,
      -- El mismo criterio de día que `diasSobreTope`: sin fecha, cada
      -- comprobante es su propio día (no se inventa una fecha para sumar).
      coalesce(g.fecha::text, 'sin-fecha:' || g.id::text) as dia,
      (g.monto > p_tope_efectivo) as sobre_tope,
      case when g.iva_traslado is null then 'nulo'
           when g.iva_traslado > 0 then 'positivo'
           else 'no_positivo' end as iva_estado,
      g.ocr_extra
    from gasto g
    where g.tenant_id = p_tenant
      and (p_desde is null or g.fecha >= p_desde)
      and (p_hasta is null or g.fecha <= p_hasta)
  ),
  dias as (
    -- Los (viaje, día) de alimentación cuyo total TIMBRADO rebasa el tope.
    -- `monto > 0` y los conceptos vienen del mismo criterio del motor
    -- (`diasSobreTope`): los manda el llamador, no se repiten aquí.
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
      -- El HOST de la liga de facturación: los dominios del catálogo de
      -- comercios describen hosts, y la liga completa suele traer el folio
      -- del ticket (una por comprobante — agrupar por ella no agruparía).
      case when not b.tiene_cfdi
           then substring(lower(b.ocr_extra->>'urlFacturacion') from '^(?:[a-z][a-z0-9+.-]*://)?([^/?#]+)')
      end as host,
      case when not b.tiene_cfdi then nullif(b.ocr_extra->>'emisor', '') end as emisor,
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
      concepto, clave_prod_serv, forma_pago, efos, efos_revisar, estado_sat, tiene_cfdi,
      (fecha is null) as sin_fecha, iva_estado, sobre_tope,
      banda, rfc_sin_cfdi, host, emisor,
      dia_viaje, dia_dia, total_timbrado_dia,
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
    group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'concepto', concepto,
    'claveProdServ', clave_prod_serv,
    'formaPago', forma_pago,
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
$$;

comment on function public.gastos_fiscales_agregados_tenant(uuid, date, date, numeric, numeric, text[], date[]) is
  'Comprobantes de UNA flota en un periodo (fecha del comprobante; nulos = sin cota) AGREGADOS por las dimensiones fiscales que fiscal.ts consulta por fila (concepto, clave, forma de pago, estado SAT, EFOS, con/sin CFDI, con/sin desglose de IVA, monto > p_tope_efectivo, y para los sin CFDI la banda de fecha vs p_cortes + RFC/host/emisor; para alimentación timbrada sobre p_tope_alimentacion, el (viaje, día) y su total). NO evalúa deducibilidad: la ley sigue en resumirFiscal/resumirPerdidas (TS), que pesan cada celda por n. Reemplaza el traerTodo del ejercicio + traerPorIds de viajes de getGastosFiscales (mig. 0151, escala 50k). SECURITY INVOKER; p_tenant sin default.';

revoke all on function public.gastos_fiscales_agregados_tenant(uuid, date, date, numeric, numeric, text[], date[]) from public, anon, authenticated;
grant execute on function public.gastos_fiscales_agregados_tenant(uuid, date, date, numeric, numeric, text[], date[]) to service_role;
