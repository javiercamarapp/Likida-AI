-- ═══════════════════════════════════════════════════════════════════════════
-- AUDITORÍA 22 · FIS-C1 (CRÍTICO) — la póliza tiene que saber qué es deducible.
--
-- `poliza_datos_tenant` agrupaba los gastos por concepto y devolvía UNA base
-- por concepto. La ruta HTTP la cargaba entera a `catalogo.gastos[concepto]`,
-- que es la cuenta de gasto DEDUCIBLE de la flota — aunque el motor hubiera
-- marcado ese comprobante `cfdi_efos`, `efectivo_sobre_tope` o
-- `combustible_efectivo`. El PDF decía «No deducible $58,000» y el archivo que
-- el contador importa a CONTPAQi lo asentaba como deducible.
--
-- ── POR QUÉ NO SE CLASIFICA AQUÍ ──────────────────────────────────────────
-- La pregunta «¿en qué cubeta cae este gasto?» tiene UNA definición y vive en
-- TypeScript: `cubetaDe` + `NO_DEDUCIBLE_ISR` + `POR_CONFIRMAR`
-- (cuadre/engine.ts). Repetir esas listas en SQL sería una segunda fuente de
-- verdad que diverge en la primera auditoría que agregue un tipo — es
-- exactamente el patrón que este repo ya documenta como su modo de falla caro.
--
-- Así que esta función NO decide: entrega los insumos y la ruta clasifica con
-- la misma función que el motor.
--   · `gastos`      → un renglón por gasto: id, concepto, base, `@Descuento` y
--                     si tiene CFDI (lo único que `cubetaDe` mira además de
--                     las diferencias).
--   · `retenciones` → Σ IVA/ISR retenido del periodo (FIS-A1): el proveedor
--                     cobra menos pero el gasto no baja, así que va como ABONO
--                     a una cuenta por pagar, no restando la base.
--   · `diferencias` → el jsonb que la liquidación ya guarda, con `gastoId` y
--                     `tipo` por diferencia.
--
-- `porConcepto` y `baseDesconocida` se conservan intactos: los consumidores
-- que ya existen no se enteran de este cambio.
-- ═══════════════════════════════════════════════════════════════════════════

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
    -- FIS-C1: los insumos para que la ruta clasifique con `cubetaDe`.
    'gastos',         coalesce(gd.por_gasto, '[]'::jsonb),
    'diferencias',    coalesce(l.diferencias, '[]'::jsonb),
    -- FIS-A1: la retención NO es un gasto, es cuenta por pagar al SAT. Las
    -- columnas existen desde la 0063 y nadie las leía.
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
             'id',        gg.id,
             'concepto',  gg.concepto,
             'subtotal',  gg.sub_total,
             'descuento', gg.descuento,
             'tieneCfdi', gg.cfdi_uuid is not null
           ) order by gg.concepto, gg.id) as por_gasto,
           sum(coalesce(gg.iva_retenido, 0) + coalesce(gg.isr_retenido, 0)) as retenciones
      from gasto gg
     where gg.tenant_id = p_tenant and gg.viaje_id = l.viaje_id
  ) gd on true
 where l.tenant_id = p_tenant
   and (l.created_at at time zone 'America/Mexico_City')::date >= p_desde
   and (l.created_at at time zone 'America/Mexico_City')::date <= p_hasta;
$$;

comment on function public.poliza_datos_tenant(uuid, date, date) is
  'Insumos de la póliza contable por periodo. Devuelve `gastos` (uno por comprobante, con su base y si tiene CFDI) y `diferencias` para que la capa TS clasifique cada gasto con `cubetaDe` — la clasificación de deducibilidad NO se duplica en SQL. Auditoría 22, FIS-C1.';
