-- ═══════════════════════════════════════════════════════════════════════════
-- AUDITORÍA 24 · FIS-2 + FIS-3 (CRÍTICOS, reincidentes 22→23→24) + DAT-3 (ALTO)
-- — la póliza asienta lo que el PDF dice, comprobante por comprobante.
--
-- Lo que la 0272 dejó a medias, medido con `cuadrarViaje` + `polizaDeLiquidacion`:
--   · FIS-2: una comida de $2,000 con CFDI y tope de $750 (LISR 28-V) sale en
--     el PDF «$750 deducible / $1,250 no deducible» y en la póliza `5020-001
--     cargo 1,724.14` — la base ENTERA como deducible. `repartirPorCubeta` era
--     todo-o-nada porque la RPC no entregaba con qué partir.
--   · FIS-3: dos fotos del mismo flete de $8,000 → `5030-001 cargo 16,000`. El
--     `lateral` de la 0272 lista TODOS los `gasto` del viaje, copias incluidas,
--     y la ruta nunca llamaba a `copiasDeComprobante` (cuadre/engine.ts).
--   · DAT-3: `sub_total`, `iva_traslado`, `ieps_traslado`, `iva_retenido` e
--     `isr_retenido` no tenían piso; un XML con signo invertido producía un
--     cargo negativo a diésel y $10,800 de «IVA no acreditable» inventados.
--
-- ── LO QUE ESTA MIGRACIÓN HACE (y lo que NO) ─────────────────────────────
-- La regla de la cubeta sigue teniendo UNA definición, en TypeScript
-- (`cubetaDe`, `copiasDeComprobante`, `proporcionesDeducibles` —
-- cuadre/engine.ts). Aquí NO se clasifica ni se deduplica: se entregan TODOS
-- los insumos que esas tres funciones leen, por comprobante:
--   · para la cubeta:      `cfdiUuid`, `formaPago`, `pagadoEn` (FIS-6: un '99'
--                          sin complemento de pago es por confirmar)
--   · para las copias:     `cfdiUuid`, `cfdiOrden`, `folio`, `folioNorm`, `monto`
--   · para la proporción:  `monto`, `fecha`, `cfdiUuid` (LISR 28-V por día) —
--                          la del 15% (RFA 2.9) ya viaja en `diferencias`
--   · para el asiento:     `subtotal`, `descuento`, `ivaRetenido`, `isrRetenido`
--                          (la ruta suma las retenciones SIN las copias)
-- y una marca `version: 281` para que la ruta FALLE CERRADO si la base va en
-- una RPC anterior (FIS-4: degradar a «todo deducible» es la única rama que no
-- puede tener un rótulo verdadero).
--
-- `porConcepto`, `baseDesconocida` y `retenciones` se conservan: los lectores
-- previos no se enteran.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── DAT-3: piso en las cinco columnas de dinero de `gasto` ─────────────────
-- `not valid` + `validate` por si producción ya tiene filas: la validación
-- recorre la tabla sin bloquear escrituras y falla con nombre si hay basura.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gasto_importes_no_negativos') then
    alter table public.gasto
      add constraint gasto_importes_no_negativos check (
        coalesce(sub_total, 0) >= 0
        and coalesce(iva_traslado, 0) >= 0
        and coalesce(ieps_traslado, 0) >= 0
        and coalesce(iva_retenido, 0) >= 0
        and coalesce(isr_retenido, 0) >= 0
      ) not valid;
    alter table public.gasto validate constraint gasto_importes_no_negativos;
  end if;
  -- El descuento del CFDI nunca excede su SubTotal: el Total ya viene neto y
  -- una base negativa en el asiento es un dato de origen roto, no un ajuste.
  if not exists (select 1 from pg_constraint where conname = 'gasto_descuento_no_excede') then
    alter table public.gasto
      add constraint gasto_descuento_no_excede check (
        descuento is null or sub_total is null or (descuento >= 0 and descuento <= sub_total)
      ) not valid;
    alter table public.gasto validate constraint gasto_descuento_no_excede;
  end if;
end $$;

comment on constraint gasto_importes_no_negativos on public.gasto is
  'DAT-3 (auditoría 24). La 0070 acotó `monto`; estas cinco quedaron sin piso y la póliza (0272) las volvió cargantes: un XML con signo invertido daba un cargo negativo a diésel y un «IVA no acreditable» inventado que cuadraba.';

-- ── FIS-2 / FIS-3 / FIS-4: la RPC entrega los insumos por comprobante ──────
create or replace function public.poliza_datos_tenant(
  p_tenant uuid,
  p_desde  date,
  p_hasta  date
) returns jsonb
language sql
stable parallel safe
set search_path = public, pg_catalog
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'version',        281,
    'liquidacionId',  l.id,
    'folioViaje',     coalesce(v.folio, ''),
    'operador',       coalesce(o.nombre, ''),
    'fecha',          (l.created_at at time zone 'America/Mexico_City')::date,
    'anticipo',       coalesce(l.total_anticipo, 0),
    'comprobado',     coalesce(l.total_comprobado, 0),
    'diferencia',     coalesce(l.diferencia, 0),
    'ivaAcreditable', coalesce(l.iva_acreditable, 0),
    'porConcepto',    coalesce(g.desglose, '[]'::jsonb),
    'baseDesconocida', coalesce(g.sin_subtotal, 0),
    'gastos',         coalesce(gd.por_gasto, '[]'::jsonb),
    'diferencias',    coalesce(l.diferencias, '[]'::jsonb),
    -- Compatibilidad: la suma cruda. La ruta la recalcula SIN copias a partir
    -- de `ivaRetenido`/`isrRetenido` por gasto.
    'retenciones',    coalesce(gd.retenciones, 0)
  ) order by l.created_at), '[]'::jsonb)
  from liquidacion l
  join viaje v on v.id = l.viaje_id
  left join operador o on o.id = v.operador_id
  left join lateral (
    select
      jsonb_agg(jsonb_build_object(
        'concepto', t.concepto,
        'subtotal', case when t.base_conocida then t.base else null end,
        'baseConocida', t.base_conocida
      ) order by t.concepto) as desglose,
      sum(t.sin_sub) as sin_subtotal
    from (
      select gg.concepto,
             sum(gg.sub_total) filter (where gg.sub_total is not null) as base,
             bool_and(gg.sub_total is not null) as base_conocida,
             count(*) filter (where gg.sub_total is null) as sin_sub
        from gasto gg
       where gg.tenant_id = p_tenant and gg.viaje_id = l.viaje_id
       group by gg.concepto
    ) t
  ) g on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
             'id',          gg.id,
             'concepto',    gg.concepto,
             'monto',       gg.monto,
             'fecha',       gg.fecha,
             'subtotal',    gg.sub_total,
             'descuento',   gg.descuento,
             'tieneCfdi',   gg.cfdi_uuid is not null,
             'cfdiUuid',    gg.cfdi_uuid,
             'cfdiOrden',   gg.cfdi_orden,
             'folio',       gg.folio,
             'folioNorm',   gg.folio_norm,
             'formaPago',   nullif(gg.forma_pago, ''),
             'pagadoEn',    gg.pagado_en,
             'pagadoForma', nullif(gg.pagado_forma, ''),
             'ivaRetenido', gg.iva_retenido,
             'isrRetenido', gg.isr_retenido
           ) order by gg.created_at, gg.id) as por_gasto,
           sum(coalesce(gg.iva_retenido, 0) + coalesce(gg.isr_retenido, 0)) as retenciones
      from gasto gg
     where gg.tenant_id = p_tenant and gg.viaje_id = l.viaje_id
  ) gd on true
 where l.tenant_id = p_tenant
   and (l.created_at at time zone 'America/Mexico_City')::date >= p_desde
   and (l.created_at at time zone 'America/Mexico_City')::date <= p_hasta;
$$;

comment on function public.poliza_datos_tenant(uuid, date, date) is
  'Insumos de la póliza contable por periodo, versión 281 (auditoría 24, FIS-2/FIS-3). Devuelve `gastos` uno por comprobante con TODO lo que `cubetaDe`, `copiasDeComprobante` y `proporcionesDeducibles` (cuadre/engine.ts) leen; la clasificación, la deduplicación y la proporción NO se duplican en SQL. `version` permite a la ruta fallar cerrado ante una RPC anterior.';
