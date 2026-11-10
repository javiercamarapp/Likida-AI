-- ═══════════════════════════════════════════════════════════════════════════
-- 05b — Liquidación por CORREO con Excel (la ruta que usa el cliente piloto; la 05 siembra la ruta de WhatsApp/PDF).
-- Deja cada estado que la pantalla de Liquidación sabe mostrar:
--   001 enviado y entregado (operador, coordinador, RH y revisor)       005 correo del operador REBOTADO + su excepción
--   002 enviado, operador aún «enviada»                                  006 operador SIN correo + su excepción
--   003 RETENIDO por neto negativo (solo el revisor recibe copia)        007 sin póliza: no se guarda nada, solo la excepción
--   004 RETENIDO por póliza provisional (marca visible, revisión humana) 008 anterior a la fecha de corte: entregas «omitida»
-- NADA puede salir de aquí: la configuración queda con «Activar el envío» APAGADO (activa = false), todos los correos son
-- `…@demo.invalid` (dominio que no existe), y ninguna entrega queda `pendiente` ni `enviando`. Idempotente: ids deterministas.
-- xlsx_ruta queda vacía (el demo no tiene Storage): «Descargar Excel» no estará disponible aquí.
-- ═══════════════════════════════════════════════════════════════════════════

-- operadores del demo en orden estable; los 6 primeros participan
drop table if exists cinco_agentes_sim.desglose_op cascade;
create table cinco_agentes_sim.desglose_op as
select row_number() over (order by o.numero_empleado)::int as rn, o.id as operador_id, o.numero_empleado
from operador o
where o.tenant_id = current_setting('demo.tenant')::uuid and o.numero_empleado is not null
order by o.numero_empleado
limit 6;

-- coordinador de demo (correo inexistente)
insert into liquidacion_coordinador (id, tenant_id, nombre, correo, activo)
values (cinco_agentes_sim.uid('liqcoord:demo'), current_setting('demo.tenant')::uuid, 'Coordinador Demo', 'coordinador@demo.invalid', true)
on conflict (id) do nothing;

-- correos de operadores: 1-5 con correo (el 5 rebotado), el 6 sin correo
update operador o set
  correo = case when d.rn <= 5 then 'op' || d.numero_empleado || '@demo.invalid' else null end,
  correo_rebotado_en = case when d.rn = 5 then current_setting('demo.ancla')::timestamptz - interval '2 days' else null end,
  coordinador_id = case when d.rn <= 5 then cinco_agentes_sim.uid('liqcoord:demo') else null end
from cinco_agentes_sim.desglose_op d
where o.id = d.operador_id and o.tenant_id = current_setting('demo.tenant')::uuid;

-- configuración de correo: canal correo, ENVÍO APAGADO, con fecha de corte y revisor
insert into liquidacion_correo_config (tenant_id, canal, activa, remitente_nombre, responder_a, remitente_correo, rh_correos, archivo_correo,
                                       revisores, primer_mes_hasta, no_enviar_antes_de, actualizado_por)
values (current_setting('demo.tenant')::uuid, 'correo', false, 'Nómina Demo', 'nomina@demo.invalid', 'nomina@demo.invalid',
        array['rh@demo.invalid'], 'archivo@demo.invalid', '[{"departamento":"nomina","correo":"revisor@demo.invalid"}]'::jsonb,
        (current_setting('demo.ancla')::timestamptz + interval '30 days')::date, date '2026-10-01', 'demo')
on conflict (tenant_id) do update set
  canal = 'correo', activa = false, remitente_nombre = excluded.remitente_nombre, responder_a = excluded.responder_a,
  remitente_correo = excluded.remitente_correo, rh_correos = excluded.rh_correos, archivo_correo = excluded.archivo_correo,
  revisores = excluded.revisores, primer_mes_hasta = excluded.primer_mes_hasta, no_enviar_antes_de = excluded.no_enviar_antes_de,
  actualizado_por = 'demo';

-- los casos (007 no se guarda: solo su excepción)
drop table if exists cinco_agentes_sim.desglose_caso cascade;
create table cinco_agentes_sim.desglose_caso as
select c.n, 'BIT-DEMO-' || lpad(c.n::text, 3, '0') as clave, c.rn, c.retenida_motivo, c.poliza, c.neto, c.estado_liq, c.hasta
from (values
  (1, 1, null::text,                                                                  'PD-0001'::text,  8120.50::numeric, 'enviada'::text,   date '2026-10-16'),
  (2, 2, null,                                                                        'PD-0002',        6480.00,          'enviada',         date '2026-10-16'),
  (3, 3, 'El neto es negativo.',                                                      'PD-0003',        -350.25,          'pendiente',       date '2026-10-16'),
  (4, 4, 'Póliza provisional: pendiente de revisión humana antes de enviar.',         'PROVISIONAL',    7010.00,          'pendiente',       date '2026-10-16'),
  (5, 5, null,                                                                        'PD-0005',        5230.75,          'enviada',         date '2026-10-16'),
  (6, 6, null,                                                                        'PD-0006',        4990.00,          'enviada',         date '2026-10-16'),
  (8, 1, null,                                                                        'PD-0008',        3100.00,          'enviada',         date '2026-09-18')
) as c(n, rn, retenida_motivo, poliza, neto, estado_liq, hasta);

insert into liquidacion_externa (id, tenant_id, clave_externa, huella, sistema_origen, operador_id, folios_viaje, viaje_ids,
                                 periodo_desde, periodo_hasta, conceptos, total, moneda, pdf_origen, estado, generacion, intentos,
                                 proximo_intento_en, enviada_en, created_at, updated_at)
select cinco_agentes_sim.uid('liqdes:' || c.clave), current_setting('demo.tenant')::uuid, c.clave, cinco_agentes_sim.sha(c.clave || ':' || c.neto::text),
       'desglose-bitacora (demo)', o.operador_id, '{}'::text[], '{}'::uuid[], c.hasta - 6, c.hasta,
       jsonb_build_array(
         jsonb_build_object('clave', 'P001', 'descripcion', 'Sueldo', 'tipo', 'percepcion', 'monto', greatest(c.neto, 0) + 900),
         jsonb_build_object('clave', 'D001', 'descripcion', 'Deducciones', 'tipo', 'deduccion', 'monto', 900 - least(c.neto, 0))),
       c.neto, 'MXN', 'generado', c.estado_liq, 1, case when c.estado_liq = 'enviada' then 1 else 0 end,
       current_setting('demo.ancla')::timestamptz,
       case when c.estado_liq = 'enviada' then c.hasta::timestamptz + interval '1 day 9 hours' end,
       c.hasta::timestamptz + interval '1 day 8 hours', current_setting('demo.ancla')::timestamptz - interval '1 hour'
from cinco_agentes_sim.desglose_caso c join cinco_agentes_sim.desglose_op o on o.rn = c.rn
on conflict (id) do nothing;

insert into liquidacion_desglose (liquidacion_externa_id, tenant_id, bitacora, terminal, poliza, unidad, tipo_operador, dias, total_origen, retenida_motivo, created_at)
select cinco_agentes_sim.uid('liqdes:' || c.clave), current_setting('demo.tenant')::uuid, c.clave, 'MID', c.poliza, 'U-' || (100 + c.n), 'foraneo', 7, 'tms',
       c.retenida_motivo, c.hasta::timestamptz + interval '1 day 8 hours'
from cinco_agentes_sim.desglose_caso c
on conflict (liquidacion_externa_id) do nothing;

-- entregas: (caso, rol, correo, estado). Nada pendiente/enviando.
drop table if exists cinco_agentes_sim.desglose_entrega cascade;
create table cinco_agentes_sim.desglose_entrega as
select e.n, e.rol, e.correo, e.estado, e.error
from (values
  (1, 'operador',    'op#@demo.invalid',          'entregada', null::text),
  (1, 'coordinador', 'coordinador@demo.invalid',  'entregada', null),
  (1, 'rh',          'rh@demo.invalid',           'entregada', null),
  (1, 'revisor',     'revisor@demo.invalid',      'entregada', null),
  (2, 'operador',    'op#@demo.invalid',          'enviada',   null),
  (2, 'coordinador', 'coordinador@demo.invalid',  'enviada',   null),
  (3, 'revisor',     'revisor@demo.invalid',      'entregada', null),
  (4, 'revisor',     'revisor@demo.invalid',      'entregada', null),
  (5, 'operador',    'op#@demo.invalid',          'rebotada',  'Rebotó (dato de demo)'),
  (5, 'coordinador', 'coordinador@demo.invalid',  'entregada', null),
  (6, 'coordinador', 'coordinador@demo.invalid',  'entregada', null),
  (8, 'operador',    'op#@demo.invalid',          'omitida',   'omitida: el periodo termina antes de la fecha de corte del arranque'),
  (8, 'coordinador', 'coordinador@demo.invalid',  'omitida',   'omitida: el periodo termina antes de la fecha de corte del arranque')
) as e(n, rol, correo, estado, error);

insert into liquidacion_entrega_correo (id, tenant_id, liquidacion_externa_id, generacion, rol, correo, estado, intentos, proximo_intento_en, resend_id,
                                        ultimo_error, disparo, enviada_en, entregada_en, rebotada_en, created_at, updated_at)
select cinco_agentes_sim.uid('liqent:' || c.clave || ':' || e.rol), current_setting('demo.tenant')::uuid, cinco_agentes_sim.uid('liqdes:' || c.clave), 1, e.rol,
       replace(e.correo, '#', o.numero_empleado), e.estado, case when e.estado in ('omitida') then 0 else 1 end, current_setting('demo.ancla')::timestamptz,
       case when e.estado in ('enviada', 'entregada', 'rebotada') then 'demo_' || substr(cinco_agentes_sim.sha(c.clave || e.rol), 1, 16) end,
       e.error, 'auto',
       case when e.estado in ('enviada', 'entregada', 'rebotada') then c.hasta::timestamptz + interval '1 day 9 hours' end,
       case when e.estado = 'entregada' then c.hasta::timestamptz + interval '1 day 9 hours 1 minute' end,
       case when e.estado = 'rebotada' then c.hasta::timestamptz + interval '1 day 9 hours 2 minutes' end,
       c.hasta::timestamptz + interval '1 day 8 hours', current_setting('demo.ancla')::timestamptz - interval '1 hour'
from cinco_agentes_sim.desglose_entrega e
join cinco_agentes_sim.desglose_caso c on c.n = e.n
join cinco_agentes_sim.desglose_op o on o.rn = c.rn
on conflict (id) do nothing;

-- excepciones abiertas (una por motivo; la 007 es una bitácora sin póliza que no se guardó)
insert into liquidacion_excepcion (tenant_id, clave_externa, tipo, detalle, primera_vez, ultima_vez)
select current_setting('demo.tenant')::uuid, x.clave, x.tipo, x.detalle, current_setting('demo.ancla')::timestamptz - interval '1 day', current_setting('demo.ancla')::timestamptz - interval '1 day'
from (values
  ('BIT-DEMO-003', 'neto_negativo',          '{"bitacora":"BIT-DEMO-003","motivo":"neto_negativo"}'::jsonb),
  ('BIT-DEMO-004', 'sin_poliza',             '{"bitacora":"BIT-DEMO-004","motivo":"sin_poliza","provisional":true}'::jsonb),
  ('BIT-DEMO-005', 'operador_sin_correo',    '{"bitacora":"BIT-DEMO-005","rol":"operador","motivo":"correo_rebotado"}'::jsonb),
  ('BIT-DEMO-006', 'operador_sin_correo',    '{"bitacora":"BIT-DEMO-006","rol":"operador","motivo":"operador_sin_correo"}'::jsonb),
  ('BIT-DEMO-007', 'sin_poliza',             '{"bitacora":"BIT-DEMO-007"}'::jsonb)
) as x(clave, tipo, detalle)
where not exists (select 1 from liquidacion_excepcion e where e.tenant_id = current_setting('demo.tenant')::uuid and e.clave_externa = x.clave and e.tipo = x.tipo and e.resuelta_en is null)
on conflict do nothing;
