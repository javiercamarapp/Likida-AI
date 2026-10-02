-- ═══════════════════════════════════════════════════════════════════════════
-- 05 — Liquidación FASE 1: lo que «su sistema» (SAP/TMS) ya calculó y Likida
-- solo ENTREGA al operador. Una liquidación por operador con sus viajes
-- cerrados de la semana. Likida no recalcula: el total es la suma de SUS
-- renglones (percepciones − deducciones), como exige el contrato de la 0370.
--
-- Estados sembrados (ninguno «pendiente»/«en_cola»: así ningún worker intenta
-- mandar nada por WhatsApp en un demo): acusada (recibida), acusada
-- (no coincide = discrepancia que se escala al jefe de flota), enviada, fallida.
-- ═══════════════════════════════════════════════════════════════════════════

drop table if exists innovativos_sim.liquidacion_sistema cascade;
create table innovativos_sim.liquidacion_sistema as
select y.operador_id, y.numero_empleado, y.cnt, y.clave, y.folios, y.ids, y.desde, y.hasta,
       y.base, y.bono, y.viaticos, y.anticipo,
       y.base + y.bono + y.viaticos as perc,
       round((y.base + y.bono + y.viaticos) * 0.06, 2) as isr,
       round((y.base + y.bono + y.viaticos) * 0.02, 2) as imss,
       innovativos_sim.u('liqest' || y.clave) as r
from (
  select x.operador_id, x.numero_empleado, count(*)::int as cnt,
         'SAP-LIQ-' || x.numero_empleado || '-' || to_char(max(x.fecha_fin), 'YYMMDD') as clave,
         array_agg(x.folio order by x.fecha_inicio, x.folio) as folios,
         array_agg(x.id order by x.fecha_inicio, x.folio) as ids,
         min(x.fecha_inicio) as desde, max(x.fecha_fin) as hasta,
         round(sum(x.dist * 4.1 + 350)::numeric, 2) as base,
         (case when innovativos_sim.u('bono' || x.numero_empleado) < 0.6 then 150.00 * count(*) else 0 end)::numeric(12,2) as bono,
         (320.00 * count(*))::numeric(12,2) as viaticos,
         (case when innovativos_sim.u('antc' || x.numero_empleado) < 0.4 then round((sum(x.dist * 4.1 + 350) * 0.2)::numeric, 2) else 0 end)::numeric(12,2) as anticipo
  from (
    select v.operador_id, o.numero_empleado, v.folio, v.id, v.fecha_inicio, v.fecha_fin, p.dist_km as dist
    from viaje v
    join operador o on o.id = v.operador_id
    join innovativos_sim.plan_viaje p on p.folio = v.folio
    where v.tenant_id = current_setting('inn.tenant')::uuid and v.estatus = 'liquidado'
  ) x
  group by x.operador_id, x.numero_empleado
) y;

insert into liquidacion_externa (id, tenant_id, clave_externa, huella, sistema_origen, operador_id, folios_viaje, viaje_ids,
                                 periodo_desde, periodo_hasta, conceptos, total, moneda, pdf_origen, estado, via, generacion,
                                 intentos, proximo_intento_en, ultimo_error, wamid, enviada_en, acuse_tipo, acuse_en,
                                 created_at, updated_at)
select innovativos_sim.uid('liqext:' || l.clave), current_setting('inn.tenant')::uuid, l.clave,
       innovativos_sim.sha(l.clave || ':' || (l.perc - l.isr - l.imss - l.anticipo)::text), 'SAP (demo)',
       l.operador_id, l.folios, l.ids, l.desde, l.hasta,
       (select jsonb_agg(c.j order by c.ord) from (
          select 1 as ord, jsonb_build_object('clave', 'P001', 'descripcion', 'Pago por viaje (' || l.cnt || ')', 'tipo', 'percepcion', 'monto', l.base) as j
          union all select 2, jsonb_build_object('clave', 'P010', 'descripcion', 'Bono de puntualidad', 'tipo', 'percepcion', 'monto', l.bono) where l.bono > 0
          union all select 3, jsonb_build_object('clave', 'P020', 'descripcion', 'Viáticos', 'tipo', 'percepcion', 'monto', l.viaticos)
          union all select 4, jsonb_build_object('clave', 'D001', 'descripcion', 'ISR retenido', 'tipo', 'deduccion', 'monto', l.isr)
          union all select 5, jsonb_build_object('clave', 'D002', 'descripcion', 'Cuota IMSS', 'tipo', 'deduccion', 'monto', l.imss)
          union all select 6, jsonb_build_object('clave', 'D030', 'descripcion', 'Descuento de anticipo', 'tipo', 'deduccion', 'monto', l.anticipo) where l.anticipo > 0
        ) c),
       l.perc - l.isr - l.imss - l.anticipo, 'MXN', 'generado',
       e.estado, case when e.estado = 'fallida' then 'plantilla' else 'sesion' end, 1,
       case when e.estado = 'fallida' then 3 else 1 end,
       current_setting('inn.ancla')::timestamptz,
       case when e.estado = 'fallida' then 'Plantilla de Meta aún no aprobada (dato de demo)' end,
       case when e.estado in ('enviada', 'acusada') then 'wamid.DEMO' || upper(substr(innovativos_sim.sha(l.clave), 1, 20)) end,
       case when e.estado in ('enviada', 'acusada') then l.hasta::timestamptz + interval '1 day 15 hours' end,
       case when e.estado = 'acusada' then case when e.no_coincide then 'no_coincide' else 'recibida' end end,
       case when e.estado = 'acusada' then l.hasta::timestamptz + interval '1 day 16 hours' end,
       l.hasta::timestamptz + interval '1 day 12 hours', current_setting('inn.ancla')::timestamptz - interval '1 hour'
from innovativos_sim.liquidacion_sistema l
cross join lateral (
  select case when l.r < 0.70 then 'acusada' when l.r < 0.88 then 'enviada' when l.r < 0.94 then 'fallida' else 'enviada' end as estado,
         (l.r >= 0.62 and l.r < 0.70) as no_coincide
) e
on conflict (id) do nothing;
