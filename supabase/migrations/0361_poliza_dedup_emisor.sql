-- 0361 — La póliza del contador recibe el emisor del comprobante.
--
-- AUDITORÍA 32, continuación 5 (26-sep-2026). Cierra la mitad que la
-- continuación 4 dejó PARCIAL de FIS-C4 / ARQ32C4-C2 (CRÍTICO).
--
-- EL CUARTO LADO DEL MISMO ESPEJO. Las migraciones 0357/0358/0359 le enseñaron
-- al panel que el folio se reinicia por emisor; `790900d` se lo enseñó al motor
-- (`copiasDeComprobante`, engine.ts:514); la 0360 al cierre
-- (`guardar_liquidacion_tx`). Faltaba el asiento contable: `poliza_datos_tenant`
-- arma su propio `jsonb` por comprobante con 18 claves y `rfc_emisor` no es
-- ninguna de ellas, así que `aGasto` (`api/export/poliza/route.ts`) no tiene de
-- dónde sacarlo y el predicado corre con la regla ANTERIOR a la 0357.
--
-- MEDIDO contra Postgres 16.13 con las 337 migraciones sobre base virgen, dos
-- tickets de diésel de $2,500 con folio `1234` de DOS estaciones distintas
-- (`ESA030303CC1`, `ESB040404DD2`), subtotal $2,155.17 + IVA $344.83 cada uno:
--
--   guardar_liquidacion_tx (0360)  → total_comprobado = 5000.00   ← DOS comprobantes
--   poliza_datos_tenant    (0342)  → gasto[0] ? 'rfcEmisor' = f   ← AUSENTE
--
-- Con el emisor ausente en cada fila, `emisorDelGrupo` sale vacío, la llave
-- termina en `|''` para todas y la estación B se marca copia: la cubeta de
-- diésel del asiento recibe $2,155.17 de base en vez de $4,310.34. El papel que
-- el contralor firma dice $5,000 y el archivo que su contador sube al ERP dice
-- $2,500. Norma: `normas/rfa-2026-2.9.yaml` (`verificado_fuente_primaria`), el
-- 15 % se mide sobre «el total de los pagos efectuados por consumo de
-- combustible» — un pago real borrado por «copia» sale del numerador Y del
-- denominador.
--
-- SE ESPEJA LA 0358, NO LA 0357: `nullif(rfc_emisor, '')` deja el emisor en NULL
-- cuando no se conoce, que es lo que `copiasDeComprobante` necesita para que la
-- fila sin emisor herede el del grupo. Un RFC vacío no es un emisor.
--
-- `version` sube a 361 a propósito: `RPC_VERSION_MINIMA` en la ruta es el
-- mecanismo por el que este producto FALLA CERRADO cuando la base va atrás del
-- código (es lo que arregló FIS-4 en la auditoría 24, cuando producción iba en
-- la 0271 y el asiento del contador daba el 100 % por deducible). Sin subirla,
-- una base en la 0342 devolvería filas sin `rfcEmisor` y el asiento volvería
-- silenciosamente a la regla pre-0357.
--
-- `SECURITY INVOKER` se declara EXPLÍCITO. Es el default de Postgres, así que no
-- cambia comportamiento —`prosecdef` sigue en `f`, verificado antes y después—,
-- pero evita que esta migración sume una sexta instancia al patrón que el rubro
-- de seguridad reporta desde hace cuatro rondas (SEG-31-B3) en una función que
-- de todos modos se está reescribiendo entera.
--
-- No cambia importes persistidos, ni revisiones, ni permisos, ni documentos
-- históricos. ACL verificada idéntica tras el replace
-- (`{postgres=X/postgres,service_role=X/postgres}`) y reaplicable dos veces.
begin;
CREATE OR REPLACE FUNCTION public.poliza_datos_tenant(p_tenant uuid, p_desde date, p_hasta date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE PARALLEL SAFE
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'version',        361,
    'liquidacionId',  l.id,
    'revision',      l.revision,
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
             -- FIS-C4 / ARQ32C4-C2: la columna con la que el motor decide qué
             -- es copia. `nullif('')` espeja `repo.ts:1012` (`|| undefined`):
             -- un RFC vacío NO es un emisor conocido.
             'rfcEmisor',   nullif(gg.rfc_emisor, ''),
             'formaPago',   nullif(gg.forma_pago, ''),
             'pagadoEn',    gg.pagado_en,
             'pagadoForma', nullif(gg.pagado_forma, ''),
             'ivaRetenido', gg.iva_retenido,
             'isrRetenido', gg.isr_retenido,
             'ivaTraslado', gg.iva_traslado,
             'iepsTraslado', gg.ieps_traslado
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
$function$;
comment on function public.poliza_datos_tenant(uuid,date,date) is
  'Insumos de póliza v361: además de la revisión humana y los traslados IVA/IEPS por comprobante (0342), entrega `rfcEmisor` — la columna con la que `copiasDeComprobante` decide qué es copia desde 790900d/0357-0360. Sin ella el asiento contable dedupaba con la llave anterior a la 0357 y perdía base deducible real. Excluye rechazadas; conserva pendientes para informar el bloqueo. SECURITY INVOKER; sólo service_role.';
commit;
