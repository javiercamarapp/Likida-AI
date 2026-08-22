-- ═══════════════════════════════════════════════════════════════════════════
-- 0152 — Agregados de COMERCIAL y OPERACIÓN: de "traer la tabla a JS" a RPC.
--
-- Escala 50k viajes/mes (docs/escala-50k/MAPA.md, #12-#19). Ocho funciones
-- del lado del ingreso y del encargado leían `viaje`, `liquidacion`,
-- `factura_emitida`+`factura_saldo`, `pod`, `incidencia` ENTERAS del tenant
-- con `traerTodo` para reducirlas a un puñado de números (o a una lista que
-- la pantalla recorta después). `traerTodo` lanza `LecturaIncompleta` a las
-- 100,000 filas: con 600k viajes/año esas pantallas tienen fecha de
-- caducidad ~mes 2. Aquí cada reducción se hace en SQL, con el molde de la
-- 0112: SECURITY INVOKER, `p_tenant` sin default primero, `stable parallel
-- safe`, `search_path` fijo, `coalesce` sobre cada suma, `revoke` a
-- public/anon/authenticated y `grant` SOLO a service_role. Lado JS: cada
-- función valida la FORMA del jsonb y LANZA si no encaja — nunca `?? 0`.
--
--   1. rentabilidad_tenant          ← getRentabilidad        (comercial.ts)
--   2. cartera_tenant               ← getCartera / getPanelClientes
--   3. cobranza_tenant              ← getCobranza (paginada, ver abajo)
--   4. facturacion_clientes_tenant  ← getFacturacionClientes
--   5. tablero_operacion_tenant     ← getTableroOperacion    (operacion.ts)
--   6. carga_operadores_tenant      ← getCargaOperadores
--   7. incidencias_tenant           ← getIncidencias (join en SQL)
--
-- ── EL SALDO DE UNA FACTURA ES EL DE LA VISTA `factura_saldo` (0049) ───────
-- Las funciones 2, 3 y 4 leen el saldo y el `vencida` de la VISTA, no los
-- recalculan: `total - sum(pagos)` y `vence_en < current_date and saldo >
-- 0.01 and estatus vivo` viven en un solo sitio. Se comprobó con EXPLAIN
-- (Postgres 17, al escribir esta migración) que el planificador SÍ empuja
-- `tenant_id = p_tenant` dentro del `group by f.id` de la vista (la
-- columna depende funcionalmente de la PK): Index Scan por
-- `factura_cliente_idx` y no seq scan de todas las flotas. Por eso el filtro
-- va en la vista (`s.tenant_id`) Y en la tabla (`fe.tenant_id`): el primero
-- es el que acota el plan, el segundo el que ancla el join.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Rentabilidad de UNA flota  →  getRentabilidad (comercial.ts)
--
-- Leía `viaje.ingreso_flete` y `liquidacion.total_comprobado` enteros. Un
-- `ingreso_flete` NULL NO es cero: se cuenta aparte (`viajesSinIngreso`) y
-- no entra a la suma — es la regla del producto y se conserva tal cual.
-- `p_desde` acota por `created_at` (null = todo el histórico), como la 0112.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.rentabilidad_tenant(
  p_tenant uuid,
  p_desde timestamptz default null
)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  with v as (
    select count(*) filter (where ingreso_flete is not null) as con_ingreso,
           count(*) filter (where ingreso_flete is null)     as sin_ingreso,
           coalesce(sum(ingreso_flete), 0)                   as ingreso
      from viaje
     where tenant_id = p_tenant
       and (p_desde is null or created_at >= p_desde)
  ),
  l as (
    select coalesce(sum(total_comprobado), 0) as costo
      from liquidacion
     where tenant_id = p_tenant
       and (p_desde is null or created_at >= p_desde)
  )
  select jsonb_build_object(
    'ingreso',          v.ingreso,
    'viajesConIngreso', v.con_ingreso,
    'viajesSinIngreso', v.sin_ingreso,
    'costoComprobado',  l.costo
  )
  from v, l;
$$;

comment on function public.rentabilidad_tenant(uuid, timestamptz) is
  'Rentabilidad agregada de UNA flota en jsonb: ingreso (suma de viaje.ingreso_flete capturado), viajesConIngreso, viajesSinIngreso (NULL no es 0) y costoComprobado (suma de liquidacion.total_comprobado). p_desde acota por created_at o null = histórico. Reemplaza el traerTodo de getRentabilidad (comercial.ts), que leía viaje y liquidacion enteras. SECURITY INVOKER; p_tenant sin default.';

revoke all on function public.rentabilidad_tenant(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.rentabilidad_tenant(uuid, timestamptz) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Cartera de clientes de UNA flota  →  getCartera + getPanelClientes
--
-- Un cliente por fila con SUS conteos (viajes, ingreso capturado, viajes sin
-- ingreso), sus datos de contacto y su saldo por cobrar. `saldoPorCobrar`
-- y `vencido` son NULL cuando el cliente no tiene ninguna factura viva
-- (`facturas = 0`): un saldo desconocido no es un saldo de cero. Las
-- canceladas y los borradores no cuentan (mismo criterio que getCobranza).
-- `viajesSinCliente` y `conIngreso` son de la flota entera.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.cartera_tenant(p_tenant uuid)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  with por_cliente as (
    select cliente_id,
           count(*)                                      as viajes,
           coalesce(sum(ingreso_flete), 0)               as ingreso,
           count(*) filter (where ingreso_flete is null) as sin_ingreso
      from viaje
     where tenant_id = p_tenant and cliente_id is not null
     group by cliente_id
  ),
  flota as (
    select count(*) filter (where cliente_id is null)         as sin_cliente,
           count(*) filter (where ingreso_flete is not null)  as con_ingreso
      from viaje
     where tenant_id = p_tenant
  ),
  saldos as (
    select cliente_id,
           count(*)                                              as facturas,
           coalesce(sum(saldo), 0)                               as saldo,
           coalesce(sum(saldo) filter (where vencida), 0)        as vencido
      from factura_saldo
     where tenant_id = p_tenant
       and estatus not in ('cancelada', 'borrador')
     group by cliente_id
  ),
  filas as (
    select c.id, c.nombre, c.rfc, c.dias_credito, c.activo, c.contacto, c.correo, c.telefono,
           coalesce(pc.viajes, 0)      as viajes,
           coalesce(pc.ingreso, 0)     as ingreso,
           coalesce(pc.sin_ingreso, 0) as sin_ingreso,
           coalesce(s.facturas, 0)     as facturas,
           s.saldo, s.vencido
      from cliente c
      left join por_cliente pc on pc.cliente_id = c.id
      left join saldos s on s.cliente_id = c.id
     where c.tenant_id = p_tenant
  )
  select jsonb_build_object(
    'clientes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'nombre', nombre, 'rfc', rfc, 'diasCredito', dias_credito, 'activo', activo,
        'contacto', contacto, 'correo', correo, 'telefono', telefono,
        'viajes', viajes, 'ingreso', ingreso, 'viajesSinIngreso', sin_ingreso,
        'facturas', facturas, 'saldoPorCobrar', saldo, 'vencido', vencido
      ) order by ingreso desc, nombre, id)
      from filas
    ), '[]'::jsonb),
    'viajesSinCliente', flota.sin_cliente,
    'conIngreso',       flota.con_ingreso
  )
  from flota;
$$;

comment on function public.cartera_tenant(uuid) is
  'Cartera de clientes de UNA flota en jsonb: por cliente (viajes, ingreso capturado, viajesSinIngreso, contacto, facturas vivas, saldoPorCobrar/vencido o NULL sin facturas), más viajesSinCliente y conIngreso de la flota. Ordena por ingreso desc, nombre, id. Reemplaza los traerTodo de getCartera y getPanelClientes (viaje y factura_saldo enteras). SECURITY INVOKER; p_tenant sin default.';

revoke all on function public.cartera_tenant(uuid) from public, anon, authenticated;
grant execute on function public.cartera_tenant(uuid) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Cobranza de UNA flota, PAGINADA  →  getCobranza (comercial.ts)
--
-- Los agregados (porCobrar, vencido, sinCondiciones) son sobre TODAS las
-- facturas vivas del periodo; la lista es UNA página (≤100) con orden
-- estable: vencida primero, saldo mayor, fecha más reciente, id. Antes la
-- función devolvía las facturas ENTERAS a la vista — con 600k/año no cabe.
-- `p_desde`/`p_hasta` acotan por `fecha` de la factura (null = sin cota).
-- El TOTAL de facturas del periodo NO viene aquí: lo pide JS con un count
-- head sobre factura_emitida (mismo filtro), para que la cifra de "N
-- facturas" salga de un conteo exacto de PostgREST y no de un recuento
-- paralelo dentro del jsonb.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.cobranza_tenant(
  p_tenant uuid,
  p_desde date default null,
  p_hasta date default null,
  p_limite int default 100,
  p_desplazamiento int default 0
)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  with f as (
    select fe.id, fe.cliente_id, fe.folio, fe.fecha,
           s.total, s.pagado, s.saldo, s.estatus, s.vence_en, s.vencida
      from factura_saldo s
      join factura_emitida fe on fe.id = s.factura_id
     where s.tenant_id = p_tenant
       and fe.tenant_id = p_tenant
       and (p_desde is null or fe.fecha >= p_desde)
       and (p_hasta is null or fe.fecha <= p_hasta)
  ),
  vivas as (
    select * from f where estatus not in ('cancelada', 'borrador')
  ),
  pagina as (
    select f.*, coalesce(c.nombre, '—') as cliente
      from f
      left join cliente c on c.id = f.cliente_id
     order by f.vencida desc, f.saldo desc, f.fecha desc, f.id
     limit least(greatest(coalesce(p_limite, 100), 1), 100)
    offset greatest(coalesce(p_desplazamiento, 0), 0)
  )
  select jsonb_build_object(
    'porCobrar',      coalesce((select sum(saldo) from vivas), 0),
    'vencido',        coalesce((select sum(saldo) from vivas where vencida), 0),
    'sinCondiciones', (select count(*) from vivas where vence_en is null),
    'facturas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'folio', folio, 'cliente', cliente, 'fecha', fecha,
        'total', total, 'pagado', pagado, 'saldo', saldo, 'estatus', estatus,
        'venceEn', vence_en, 'vencida', vencida
      ) order by vencida desc, saldo desc, fecha desc, id)
      from pagina
    ), '[]'::jsonb)
  );
$$;

comment on function public.cobranza_tenant(uuid, date, date, int, int) is
  'Cobranza de UNA flota en jsonb: porCobrar (suma de saldo de facturas vivas), vencido (saldo vencido), sinCondiciones (vivas sin vence_en) sobre TODO el periodo, y UNA página (≤100, p_limite/p_desplazamiento) de facturas con orden estable vencida desc, saldo desc, fecha desc, id. p_desde/p_hasta acotan por factura_emitida.fecha (null = sin cota). Reemplaza el traerTodo de getCobranza (comercial.ts), que devolvía todas las facturas a la vista. SECURITY INVOKER; p_tenant sin default.';

revoke all on function public.cobranza_tenant(uuid, date, date, int, int) from public, anon, authenticated;
grant execute on function public.cobranza_tenant(uuid, date, date, int, int) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Facturación a clientes de UNA flota  →  getFacturacionClientes
--
-- Reemplaza DOS reducciones JS que recibían tablas enteras: `armarCartera`
-- (antigüedad de saldos, por cubeta y por cliente, sobre TODAS las facturas)
-- y `armarEnLaMesa` (viajes liquidados sin factura viva, sobre TODOS los
-- viajes liquidados + liquidaciones + facturas + factura_viaje). Las dos
-- funciones JS siguen existiendo, PURAS, y son el oráculo de la prueba de
-- equivalencia (facturacion_clientes_equivalencia.test.ts).
--
-- Las reglas que se copian tal cual, con su razón en el archivo TS:
--   · UN SOLO `p_hoy` para vencimiento y días: «vencida · 0 días vencida» es
--     imposible por construcción. El día del vencimiento NO está vencido
--     (dias <= 0 es corriente), igual que `vence_en < current_date` en la vista.
--   · Cubetas: corriente / 1-30 / 31-60 / >60 / sin_fecha. El 60 es de 31-60.
--   · Solo las VIVAS con saldo > 0.01 entran a las cubetas y al por cobrar;
--     así la suma de las cinco cubetas ES el por cobrar, al centavo.
--   · Un viaje está facturado si una factura VIVA lo ampara por
--     `factura_emitida.viaje_id` o por `factura_viaje`; el borrador no cuenta
--     pero se marca; la cancelada no cuenta y el viaje vuelve a la mesa.
--   · `liquidadoEn` = día LOCAL MX del cierre de la liquidación (la más
--     antigua si hubiera varias) y, si no hay, `viaje.fecha_fin`; sin ninguno
--     el renglón sale sin días (no se inventa fecha).
-- Las listas van recortadas (facturas ≤ p_limite_facturas, viajes en la mesa
-- ≤ 25 = LIMITE_EN_LA_MESA); los agregados son sobre TODO.
-- `p_desde`/`p_hasta` acotan las FACTURAS por `fecha` (null = sin cota); la
-- mesa no se acota: un viaje liquidado hace un año sin facturar sigue en la
-- mesa, y esconderlo por periodo sería mentir en la cifra que más cuesta.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.facturacion_clientes_tenant(
  p_tenant uuid,
  p_hoy date,
  p_desde date default null,
  p_hasta date default null,
  p_limite_facturas int default 100
)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  with f as (
    select fe.id, fe.folio, coalesce(c.nombre, '—') as cliente, fe.fecha, s.total, s.pagado, s.saldo,
           s.estatus, s.vence_en,
           s.estatus not in ('cancelada', 'borrador') as viva,
           s.saldo > 0.01                             as con_saldo,
           case when s.vence_en is null then null else (p_hoy - s.vence_en) end as dias
      from factura_saldo s
      join factura_emitida fe on fe.id = s.factura_id
      left join cliente c on c.id = fe.cliente_id
     where s.tenant_id = p_tenant
       and fe.tenant_id = p_tenant
       and (p_desde is null or fe.fecha >= p_desde)
       and (p_hasta is null or fe.fecha <= p_hasta)
  ),
  fc as (
    select f.*,
           case when vence_en is null then 'sin_fecha'
                when dias <= 0 then 'corriente'
                when dias <= 30 then 'v1_30'
                when dias <= 60 then 'v31_60'
                else 'v60_mas' end as cubeta,
           case when vence_en is not null and dias > 0 then dias else null end as dias_vencida
      from f
  ),
  en_cubeta as (
    select * from fc where viva and con_saldo
  ),
  clientes as (
    select cliente,
           sum(total)  as facturado,
           sum(pagado) as cobrado,
           coalesce(sum(saldo) filter (where con_saldo), 0)                           as saldo,
           coalesce(sum(saldo) filter (where con_saldo and dias_vencida is not null), 0) as vencido,
           count(*)                                                                   as facturas,
           coalesce(sum(saldo) filter (where con_saldo and cubeta = 'corriente'), 0)  as c_corriente,
           coalesce(sum(saldo) filter (where con_saldo and cubeta = 'v1_30'), 0)      as c_v1_30,
           coalesce(sum(saldo) filter (where con_saldo and cubeta = 'v31_60'), 0)     as c_v31_60,
           coalesce(sum(saldo) filter (where con_saldo and cubeta = 'v60_mas'), 0)    as c_v60_mas,
           coalesce(sum(saldo) filter (where con_saldo and cubeta = 'sin_fecha'), 0)  as c_sin_fecha,
           max(dias_vencida) filter (where con_saldo)                                 as dias_mas_vencido
      from fc
     where viva
     group by cliente
  ),
  pagina as (
    select * from fc
     order by viva desc, dias_vencida desc nulls last, saldo desc, fecha desc, id
     limit least(greatest(coalesce(p_limite_facturas, 100), 1), 100)
  ),
  -- ── La mesa: viajes liquidados que ninguna factura viva ampara ──────────
  liq as (
    select v.id, v.folio, v.origen, v.destino, v.cliente_id, v.ingreso_flete,
           coalesce(
             (select min((l.created_at at time zone 'America/Mexico_City')::date)
                from liquidacion l where l.viaje_id = v.id and l.tenant_id = p_tenant),
             v.fecha_fin
           ) as liquidado_en
      from viaje v
     where v.tenant_id = p_tenant and v.estatus = 'liquidado'
  ),
  amparo as (
    select x.viaje_id,
           bool_or(x.estatus not in ('borrador', 'cancelada')) as viva,
           bool_or(x.estatus = 'borrador')                     as borrador
      from (
        select fe.viaje_id, fe.estatus
          from factura_emitida fe
         where fe.tenant_id = p_tenant and fe.viaje_id is not null
        union all
        select fv.viaje_id, fe.estatus
          from factura_viaje fv
          join factura_emitida fe on fe.id = fv.factura_id
         where fe.tenant_id = p_tenant
      ) x
     group by x.viaje_id
  ),
  mesa as (
    select liq.*, coalesce(c.nombre, null) as cliente,
           coalesce(a.borrador, false) as solo_borrador,
           case when liq.liquidado_en is null then null else (p_hoy - liq.liquidado_en) end as dias
      from liq
      left join amparo a on a.viaje_id = liq.id
      left join cliente c on c.id = liq.cliente_id
     where not coalesce(a.viva, false)
  ),
  mesa_lista as (
    select * from mesa
     order by dias desc nulls last, coalesce(ingreso_flete, 0) desc, coalesce(folio, left(id::text, 8)), id
     limit 25
  )
  select jsonb_build_object(
    'cartera', jsonb_build_object(
      'facturasTotal', (select count(*) from fc),
      'vivas',         (select count(*) from fc where viva),
      'borradores',    (select count(*) from fc where estatus = 'borrador'),
      'canceladas',    (select count(*) from fc where estatus = 'cancelada'),
      'facturado',     coalesce((select sum(total)  from fc where viva), 0),
      'cobrado',       coalesce((select sum(pagado) from fc where viva), 0),
      'porCobrar',     coalesce((select sum(saldo) from en_cubeta), 0),
      'vencido',       coalesce((select sum(saldo) from en_cubeta where dias_vencida is not null), 0),
      'sinCondiciones',(select count(*) from en_cubeta where cubeta = 'sin_fecha'),
      'cubetas', jsonb_build_array(
        jsonb_build_object('clave', 'corriente', 'saldo', coalesce((select sum(saldo) from en_cubeta where cubeta = 'corriente'), 0), 'facturas', (select count(*) from en_cubeta where cubeta = 'corriente')),
        jsonb_build_object('clave', 'v1_30',     'saldo', coalesce((select sum(saldo) from en_cubeta where cubeta = 'v1_30'), 0),     'facturas', (select count(*) from en_cubeta where cubeta = 'v1_30')),
        jsonb_build_object('clave', 'v31_60',    'saldo', coalesce((select sum(saldo) from en_cubeta where cubeta = 'v31_60'), 0),    'facturas', (select count(*) from en_cubeta where cubeta = 'v31_60')),
        jsonb_build_object('clave', 'v60_mas',   'saldo', coalesce((select sum(saldo) from en_cubeta where cubeta = 'v60_mas'), 0),   'facturas', (select count(*) from en_cubeta where cubeta = 'v60_mas')),
        jsonb_build_object('clave', 'sin_fecha', 'saldo', coalesce((select sum(saldo) from en_cubeta where cubeta = 'sin_fecha'), 0), 'facturas', (select count(*) from en_cubeta where cubeta = 'sin_fecha'))
      ),
      'clientes', coalesce((
        select jsonb_agg(jsonb_build_object(
          'cliente', cliente, 'facturado', facturado, 'cobrado', cobrado, 'saldo', saldo,
          'vencido', vencido, 'facturas', facturas, 'diasMasVencido', dias_mas_vencido,
          'porCubeta', jsonb_build_object(
            'corriente', c_corriente, 'v1_30', c_v1_30, 'v31_60', c_v31_60,
            'v60_mas', c_v60_mas, 'sin_fecha', c_sin_fecha)
        ) order by vencido desc, saldo desc, cliente)
        from clientes
      ), '[]'::jsonb),
      'facturas', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', id, 'folio', folio, 'cliente', cliente, 'fecha', fecha, 'total', total,
          'pagado', pagado, 'saldo', saldo, 'estatus', estatus, 'venceEn', vence_en
        ) order by viva desc, dias_vencida desc nulls last, saldo desc, fecha desc, id)
        from pagina
      ), '[]'::jsonb)
    ),
    'enLaMesa', jsonb_build_object(
      'total',            (select count(*) from mesa),
      'ingresoCapturado', coalesce((select sum(ingreso_flete) from mesa), 0),
      'sinIngreso',       (select count(*) from mesa where ingreso_flete is null),
      'conBorrador',      (select count(*) from mesa where solo_borrador),
      'diasMasViejo',     (select max(dias) from mesa),
      'viajes', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', id, 'folio', folio, 'origen', origen, 'destino', destino, 'cliente', cliente,
          'ingresoFlete', ingreso_flete, 'liquidadoEn', liquidado_en, 'soloBorrador', solo_borrador
        ) order by dias desc nulls last, coalesce(ingreso_flete, 0) desc, coalesce(folio, left(id::text, 8)), id)
        from mesa_lista
      ), '[]'::jsonb)
    ),
    'viajesLiquidados', (select count(*) from liq)
  );
$$;

comment on function public.facturacion_clientes_tenant(uuid, date, date, date, int) is
  'Facturación a clientes de UNA flota en jsonb, contra UN solo p_hoy: cartera por antigüedad (vivas/borradores/canceladas, facturado, cobrado, porCobrar = suma exacta de las 5 cubetas, vencido, sinCondiciones, cubetas, por cliente, y una página ≤100 de facturas) + en la mesa (viajes liquidados sin factura viva: total, ingresoCapturado, sinIngreso, conBorrador, diasMasViejo, y los 25 más viejos) + viajesLiquidados. p_desde/p_hasta acotan las facturas por fecha (null = sin cota); la mesa nunca se acota. Reemplaza armarCartera/armarEnLaMesa sobre tablas enteras (facturacion_clientes.ts). SECURITY INVOKER; p_tenant sin default.';

revoke all on function public.facturacion_clientes_tenant(uuid, date, date, date, int) from public, anon, authenticated;
grant execute on function public.facturacion_clientes_tenant(uuid, date, date, date, int) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Tablero de operación de UNA flota  →  getTableroOperacion (operacion.ts)
--
-- Seis conteos, ninguno es dinero. `podPendientes` cuenta viajes EN CURSO
-- sin POD 'subido' (un POD rechazado no cuenta como entregado), partiendo de
-- los VIAJES y no de la tabla `pod`: el viaje del que nadie creó el registro
-- es justo el que se persigue. Unidades: solo las activas.
--
-- FILTRA POR ESTATUS ADEMÁS DE AGREGAR (FE-3): el `where ... estatus in
-- ('abierto','en_cuadre')` usa `idx_viaje_tenant (tenant_id, estatus)` y lee
-- unos cientos de filas, no los 600k del año. Los seis números de este
-- tablero son TODOS del presente: ninguno mira el histórico.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.tablero_operacion_tenant(p_tenant uuid)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  with en_curso as (
    select v.id, v.unidad_id,
           exists (select 1 from pod p where p.viaje_id = v.id and p.tenant_id = p_tenant and p.estado = 'subido') as con_pod
      from viaje v
     where v.tenant_id = p_tenant and v.estatus in ('abierto', 'en_cuadre')
  ),
  u as (
    select count(*) filter (where estado = 'disponible') as disponibles,
           count(*) filter (where estado = 'taller')     as taller
      from unidad
     where tenant_id = p_tenant and activo
  ),
  i as (
    select count(*) as abiertas from incidencia
     where tenant_id = p_tenant and estado <> 'resuelta'
  )
  select jsonb_build_object(
    'viajesActivos',       (select count(*) from en_curso),
    'sinUnidad',           (select count(*) from en_curso where unidad_id is null),
    'unidadesDisponibles', u.disponibles,
    'unidadesEnTaller',    u.taller,
    'incidenciasAbiertas', i.abiertas,
    'podPendientes',       (select count(*) from en_curso where not con_pod)
  )
  from u, i;
$$;

comment on function public.tablero_operacion_tenant(uuid) is
  'Los seis conteos del tablero del encargado de UNA flota en jsonb: viajesActivos (abierto|en_cuadre), sinUnidad, unidadesDisponibles, unidadesEnTaller (solo activas), incidenciasAbiertas (estado <> resuelta) y podPendientes (viajes en curso sin POD subido). Reemplaza el traerTodo de getTableroOperacion (operacion.ts), que leía viaje y pod enteras. SECURITY INVOKER; p_tenant sin default.';

revoke all on function public.tablero_operacion_tenant(uuid) from public, anon, authenticated;
grant execute on function public.tablero_operacion_tenant(uuid) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Carga por operador de UNA flota  →  getCargaOperadores (operacion.ts)
--
-- Todos los operadores de la flota (con ceros si no traen nada), y por cada
-- uno: abiertos, enCuadre, liquidados, enCurso (abierto+en_cuadre), sinPod
-- (en curso sin POD subido) e incidenciasAbiertas (viajes suyos con alguna
-- incidencia no resuelta). Orden: más carga primero, luego nombre.
--
-- ── SE FILTRA POR ESTATUS, NO SOLO SE AGREGA (auditoría de frontend, FE-3) ─
-- Agregar en SQL quita el viaje de red, pero un `group by` sobre los 600k
-- viajes del año sigue leyendo 600k filas en CADA carga del inicio del
-- encargado — y lo que esta pantalla contesta ("¿a quién NO le cargo otro?")
-- vive ENTERO en los viajes VIVOS, que son unos cientos. El `where` de aquí
-- usa `idx_viaje_tenant (tenant_id, estatus)`: los vivos siempre, y los
-- liquidados SOLO dentro de `p_desde` (por `created_at`).
--
-- CIFRA QUE CAMBIA DE SIGNIFICADO: `liquidados` pasa de "todos los que ha
-- cerrado ese operador en la historia" a "los que cerró desde `p_desde`" (el
-- llamador manda 90 días). No se pinta en ninguna pantalla hoy —`despacho`
-- enseña `enCurso`/`sinPod` y el tablero `incidenciasAbiertas`—, así que el
-- cambio no mueve ningún número visible; el JSDoc de `getCargaOperadores` lo
-- dice para que nadie lo lea como histórico.
-- ═══════════════════════════════════════════════════════════════════════════
-- Sin esto, un entorno donde ya se hubiera aplicado la versión de un solo
-- parámetro se quedaría con DOS sobrecargas y PostgREST no sabría cuál llamar.
drop function if exists public.carga_operadores_tenant(uuid);

create or replace function public.carga_operadores_tenant(
  p_tenant uuid,
  p_desde timestamptz default null
)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  with v as (
    select v.id, v.operador_id, v.estatus,
           exists (select 1 from pod p where p.viaje_id = v.id and p.tenant_id = p_tenant and p.estado = 'subido') as con_pod,
           exists (select 1 from incidencia i where i.viaje_id = v.id and i.tenant_id = p_tenant and i.estado <> 'resuelta') as con_incidencia
      from viaje v
     where v.tenant_id = p_tenant and v.operador_id is not null
       and (v.estatus in ('abierto', 'en_cuadre')
            or (v.estatus = 'liquidado' and (p_desde is null or v.created_at >= p_desde)))
  ),
  acum as (
    select operador_id,
           count(*) filter (where estatus = 'abierto')                  as abiertos,
           count(*) filter (where estatus = 'en_cuadre')                as en_cuadre,
           count(*) filter (where estatus = 'liquidado')                as liquidados,
           count(*) filter (where estatus in ('abierto', 'en_cuadre'))  as en_curso,
           count(*) filter (where estatus in ('abierto', 'en_cuadre') and not con_pod) as sin_pod,
           count(*) filter (where con_incidencia)                       as incidencias
      from v
     group by operador_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'operadorId', o.id,
    'nombre', o.nombre,
    'telefono', nullif(o.telefono, ''),
    'activo', o.activo,
    'enCurso',    coalesce(a.en_curso, 0),
    'abiertos',   coalesce(a.abiertos, 0),
    'enCuadre',   coalesce(a.en_cuadre, 0),
    'liquidados', coalesce(a.liquidados, 0),
    'sinPod',     coalesce(a.sin_pod, 0),
    'incidenciasAbiertas', coalesce(a.incidencias, 0)
  ) order by coalesce(a.en_curso, 0) desc, o.nombre, o.id), '[]'::jsonb)
  from operador o
  left join acum a on a.operador_id = o.id
  where o.tenant_id = p_tenant;
$$;

comment on function public.carga_operadores_tenant(uuid, timestamptz) is
  'Carga por operador de UNA flota en jsonb (array): por cada operador, enCurso/abiertos/enCuadre/liquidados, sinPod (en curso sin POD subido) e incidenciasAbiertas; orden enCurso desc, nombre. Filtra por estatus además de agregar (FE-3): los vivos (abierto|en_cuadre) siempre, los liquidados solo desde p_desde por created_at — con 50k viajes/mes un group by sobre el histórico lee 600k filas por carga. Reemplaza el traerTodo de getCargaOperadores (operacion.ts). SECURITY INVOKER; p_tenant sin default.';

revoke all on function public.carga_operadores_tenant(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.carga_operadores_tenant(uuid, timestamptz) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Incidencias de UNA flota, con su folio y su unidad  →  getIncidencias
--
-- Antes traía TODOS los viajes (600k) para resolver el folio de unas cuantas
-- incidencias. El join va aquí, anclado por tenant en los dos lados: una
-- incidencia que apunte a un viaje de otra flota sale sin folio, igual que
-- antes (el Map solo tenía los viajes propios). Las ABIERTAS salen siempre;
-- las resueltas solo si se abrieron desde `p_desde` (null = todas). Tope
-- `p_limite` (≤500), orden abierta_en desc, id.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.incidencias_tenant(
  p_tenant uuid,
  p_desde timestamptz default null,
  p_limite int default 500
)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  with i as (
    select *
      from incidencia
     where tenant_id = p_tenant
       and (estado <> 'resuelta' or p_desde is null or abierta_en >= p_desde)
     order by abierta_en desc, id
     limit least(greatest(coalesce(p_limite, 500), 1), 500)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'viajeId', i.viaje_id,
    'folio', nullif(v.folio, ''),
    'unidadId', i.unidad_id,
    'numeroEconomico', u.numero_economico,
    'tipo', i.tipo,
    'prioridad', i.prioridad,
    'estado', i.estado,
    'descripcion', nullif(i.descripcion, ''),
    'slaHoras', i.sla_horas,
    'abiertaEn', i.abierta_en,
    'resueltaEn', i.resuelta_en
  ) order by i.abierta_en desc, i.id), '[]'::jsonb)
  from i
  left join viaje  v on v.id = i.viaje_id  and v.tenant_id = p_tenant
  left join unidad u on u.id = i.unidad_id and u.tenant_id = p_tenant;
$$;

comment on function public.incidencias_tenant(uuid, timestamptz, int) is
  'Incidencias de UNA flota en jsonb (array) con el folio del viaje y el número económico de la unidad resueltos en SQL (join anclado por tenant). Abiertas siempre; resueltas solo si abierta_en >= p_desde (null = todas). Tope p_limite (≤500), orden abierta_en desc, id. Reemplaza getIncidencias (operacion.ts), que traía viaje y unidad enteras para resolver un folio. SECURITY INVOKER; p_tenant sin default.';

revoke all on function public.incidencias_tenant(uuid, timestamptz, int) from public, anon, authenticated;
grant execute on function public.incidencias_tenant(uuid, timestamptz, int) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- Índices. Regla 4 de docs/escala-50k/REGLAS-ESCALA.md: solo con EXPLAIN.
--
-- `incidencia (tenant_id, abierta_en desc, id)`: `incidencias_tenant` ordena
-- por abierta_en desc con LIMIT; los índices existentes de incidencia son
-- (tenant_id, estado, prioridad) y (tenant_id, id) — ninguno sirve el orden,
-- así que el plan es Sort sobre todas las incidencias de la flota. Con
-- ~50k incidencias/año es un sort de 50k filas por carga del inicio del
-- encargado; con el índice es un Index Scan que se detiene en el LIMIT.
-- Sin CONCURRENTLY a propósito (regla 4: el orquestador decide cómo aplicar).
-- ═══════════════════════════════════════════════════════════════════════════
create index if not exists incidencia_tenant_abierta_idx
  on public.incidencia (tenant_id, abierta_en desc, id);
