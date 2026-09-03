-- ═══════════════════════════════════════════════════════════════════════════
-- AUDITORÍA 25 — backend.md MEDIO (línea 226) + datos.md ALTO DATOS-24
-- (línea 194, REINCIDENTE de la 24). LA MISMA causa raíz en dos consumidores:
-- la columna `liquidacion.revision` (0299) nunca se propagó a TODOS los
-- lugares que preguntan «¿esta liquidación cuenta?» — solo a algunos.
--
--  1. `poliza_datos_tenant` (0281) y el CSV/API de liquidaciones YA declaran
--     la misma regla en su propio texto — `api/export/liquidaciones/route.ts`
--     (`FILTRO_REVISION_DEFECTO = 'sin_rechazadas'`, `.neq('revision',
--     'rechazada')`) y `api/v1/openapi/route.ts` («por omisión trae solo lo
--     asentable… las rechazadas se piden explícito») — pero la RPC de la
--     póliza nunca la aprendió: su `where` (0281:139-141) solo filtra
--     `tenant_id` y fecha. Un viaje rechazado el día 12 y exportado el 13
--     sale en la póliza y NO en el CSV/API de la MISMA pantalla — dos
--     respuestas sobre el mismo hecho.
--
--     Se agrega `and l.revision <> 'rechazada'`, el MISMO criterio, sin
--     tocar nada más de la función (misma firma, mismo resto del `where`).
--
--  2. `viaje_no_tras_liquidar()` (0158, la función — 0283 solo le agregó
--     COLUMNAS al trigger, nunca tocó el cuerpo) sigue con el `select exists
--     (select 1 from liquidacion where viaje_id = new.id)` crudo de la 0158:
--     una liquidación RECHAZADA todavía cuenta como «emitida» para ESTA
--     función, aunque `gasto_no_tras_liquidar()` (0300) ya aprendió lo
--     contrario. Consecuencia medida: un contralor rechaza un viaje, el
--     encargado reasigna el chofer correcto (`repo.ts:340`,
--     `update viaje set operador_id = …`) y el trigger lo rebota con CU004
--     «ya tiene liquidación emitida» — sobre una liquidación que el propio
--     panel acaba de decir que NO cuenta. El viaje queda inmovilizable por
--     reasignación mientras espera el ticket bueno.
--
--     Se agrega el MISMO `and revision <> 'rechazada'` que ya tiene
--     `gasto_no_tras_liquidar` (0300) — sin el escape del GUC
--     `likida.revision_en_curso`: ningún camino de `revisar_liquidacion`
--     toca `anticipo`/`operador_id`/fechas/`origen`/`destino`/`cliente_id`
--     (solo `viaje.estatus`, en 'rechazar'), así que esa parte del
--     candado no aplica aquí y no hace falta duplicarla.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. `poliza_datos_tenant` — misma firma, mismo resto, un filtro más ─────
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
   and (l.created_at at time zone 'America/Mexico_City')::date <= p_hasta
   -- AUDITORÍA 25 (backend.md MEDIO línea 226): el MISMO criterio que ya
   -- declara `api/export/liquidaciones` (`sin_rechazadas` por omisión) y
   -- `api/v1/openapi` («solo lo asentable») — una liquidación rechazada no
   -- se asienta en la contabilidad del cliente.
   and l.revision <> 'rechazada';
$$;

comment on function public.poliza_datos_tenant(uuid, date, date) is
  'Insumos de la póliza contable por periodo, versión 281 (auditoría 24, FIS-2/FIS-3), excluye `revision = ''rechazada''` desde la 0306+1 (AUDITORÍA 25) — el MISMO criterio que api/export/liquidaciones (sin_rechazadas) y api/v1/openapi (solo lo asentable). Devuelve `gastos` uno por comprobante con TODO lo que `cubetaDe`, `copiasDeComprobante` y `proporcionesDeducibles` (cuadre/engine.ts) leen; la clasificación, la deduplicación y la proporción NO se duplican en SQL. `version` permite a la ruta fallar cerrado ante una RPC anterior.';

-- ── 2. `viaje_no_tras_liquidar` — el mismo cuerpo, una liquidación rechazada
-- ya no cuenta como «emitida» (mismo criterio que 0300 le dio a la de gasto) ─
create or replace function public.viaje_no_tras_liquidar()
returns trigger
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
declare ya boolean;
begin
  select exists (
    select 1 from liquidacion where viaje_id = new.id and revision <> 'rechazada'
  ) into ya;
  if ya then
    raise exception 'el viaje % ya tiene liquidación emitida: su anticipo y su operador son la base de ese papel y no se reeditan', new.id
      using errcode = 'CU004';
  end if;
  return new;
end $$;

comment on function public.viaje_no_tras_liquidar() is
  'DAT-07 (0158) + DAT-4 (0283, columnas del trigger) + AUDITORÍA 25 datos.md ALTO DATOS-24 (mig. 0307): una liquidación RECHAZADA ya no cuenta como "emitida" — mismo criterio que gasto_no_tras_liquidar() desde la 0300. Sin el escape del GUC likida.revision_en_curso: ningún camino de revisar_liquidacion toca las columnas que este trigger vigila (anticipo/operador_id/fechas/origen/destino/cliente_id), solo viaje.estatus.';
