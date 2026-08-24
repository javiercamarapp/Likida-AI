-- ═══════════════════════════════════════════════════════════════════════════
-- 0175 — `poliza_datos_tenant`: lo que hace falta para asentar, agregado en SQL
--
-- La landing promete «el formato que SAP Business One o CONTPAQi ya sabe
-- importar». Para eso hace falta el desglose POR CONCEPTO de cada liquidación,
-- que hasta hoy no salía de ningún lado: `liquidacion` guarda los totales y el
-- IVA acreditable, pero los subtotales por concepto viven en `gasto`.
--
-- Se agrega en SQL y no en TypeScript por la razón de siempre en este repo
-- (MAPA de escala): traer los gastos de un mes a memoria para sumarlos por
-- concepto es el patrón que revienta a 50k viajes/mes. Aquí Postgres devuelve
-- una fila por liquidación con su desglose ya hecho.
--
-- LO QUE NO HACE, a propósito: no elige cuentas ni arma el asiento. Eso vive en
-- `contabilidad/poliza.ts`, en TypeScript, porque el catálogo contable es de la
-- flota y la regla de qué cuenta corresponde a qué concepto es de su contador —
-- no de una función de base de datos.
--
-- `subtotal` y no `monto`: el asiento carga la base y el IVA por separado. Un
-- gasto sin `sub_total` leído (ticket sin desglose) cae a `monto`, y eso se
-- ROTULA en la salida (`base_estimada`) para que quien importe sepa que ese
-- renglón trae el total y no la base — no se calla una estimación.
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
    -- Cuántos renglones traen el TOTAL en vez de la base: quien importa tiene
    -- que saberlo, porque su IVA no está separado.
    'baseEstimada',   coalesce(g.sin_subtotal, 0)
  ) order by l.created_at), '[]'::jsonb)
  from liquidacion l
  join viaje v on v.id = l.viaje_id
  left join operador o on o.id = v.operador_id
  left join lateral (
    select
      jsonb_agg(jsonb_build_object('concepto', t.concepto, 'subtotal', t.base) order by t.concepto) as desglose,
      sum(t.sin_sub) as sin_subtotal
    from (
      select gg.concepto,
             sum(coalesce(gg.sub_total, gg.monto)) as base,
             count(*) filter (where gg.sub_total is null) as sin_sub
        from gasto gg
       where gg.tenant_id = p_tenant and gg.viaje_id = l.viaje_id
       group by gg.concepto
    ) t
  ) g on true
 where l.tenant_id = p_tenant
   and (l.created_at at time zone 'America/Mexico_City')::date >= p_desde
   and (l.created_at at time zone 'America/Mexico_City')::date <= p_hasta;
$$;

revoke all on function public.poliza_datos_tenant(uuid, date, date) from public, anon, authenticated;
grant execute on function public.poliza_datos_tenant(uuid, date, date) to service_role;

