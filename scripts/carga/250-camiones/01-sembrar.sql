-- ═══════════════════════════════════════════════════════════════════════════
-- 01-sembrar.sql — escenario de la prueba de carga de la ronda 16:
-- UNA flota de 250 tractos / 262 operadores / 5,000 viajes al mes con 12 meses
-- de historia (60,000 viajes) + 20 flotas pequeñas como «ruido de tenant».
--
-- Todo sintético: tenants «ZZZ CARGA …», folios ZZZ-, teléfonos del rango
-- falso 52155{5,6}xxxxxxx, RFC XAXX010101000 / XEXX010101000, UUID derivados
-- de md5 con prefijo fijo. Cero datos reales (repo público).
--
-- CÓMO CORRERLO (como `postgres`, sobre una base con TODAS las migraciones):
--   psql -v ON_ERROR_STOP=1 -f scripts/carga/250-camiones/01-sembrar.sql
-- Después: 02-analyze.sql (estadísticas), 03-medir.sql (EXPLAIN de las
-- consultas calientes), 04-limpiar.sql (borra todo). Ver README.md.
--
-- VOLUMEN (por viaje, calibrado contra lo que escribe el código real):
--   gasto 4 · viaje_hito 5 (sembrar_hitos_conductor) · viaje_hito_aviso ~2 ·
--   viaje_hito_evento ~3 · pase de peaje (desglose_peaje_linea) 3 ·
--   cp_documento 1 · vigia_mensaje 1.5 / vigia_evento 2 · liquidacion 1 ·
--   viaje_cruce_geocerca ~1.
--   posicion: 1 punto cada 5 min por unidad EN MOVIMIENTO (≈12 h/día, 85 % de
--   los días) SOLO de los últimos 90 días — la retención real de
--   purgar_posicion (0155). Un año de GPS serían ~10 M de filas que el cron
--   de purga borra de todos modos; sembrarlas medía un estado que no existe.
--
-- La siembra desactiva triggers y FK (`session_replication_role = replica`)
-- SOLO dentro de esta transacción, porque genera filas coherentes por
-- construcción y los triggers (journal de jornada, no-tras-liquidar) son
-- exactamente lo que no queremos disparar 1.5 M de veces. Los índices
-- (únicos incluidos) sí se mantienen: se mide con el costo de escritura real
-- de los índices.
-- ═══════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\timing on

create or replace function pg_temp.sembrar_flota(
  p_tenant uuid, p_nombre text, p_prefijo int,           -- 0 = flota grande, 1..20 = chicas → 52155{ppp}{iiii}
  p_unidades int, p_operadores int, p_viajes_anio int,
  p_gps_dias int, p_abiertos int
) returns void language plpgsql as $f$
declare
  ops uuid[]; unis uuid[]; clis uuid[]; geos uuid[]; cas uuid[];
  v_hoy date := current_date;
begin
  insert into tenant (id, nombre, plan) values (p_tenant, p_nombre, 'demo');

  insert into unidad (id, tenant_id, numero_economico, placas, estado, activo, gps_device_id, gps_proveedor)
  select md5('uni'||p_tenant||i)::uuid, p_tenant, 'ZZZ-T' || lpad(i::text,3,'0'),
         'ZZ' || lpad(i::text,5,'0'), 'en_ruta', true, 'zzz-dev-'||p_prefijo||'-'||i, 'tabla_propia'
  from generate_series(1,p_unidades) i;
  select array_agg(id order by numero_economico) into unis from unidad where tenant_id=p_tenant;

  insert into operador (id, tenant_id, nombre, telefono, activo)
  select md5('ope'||p_tenant||i)::uuid, p_tenant, 'ZZZ Chofer '||lpad(i::text,3,'0'),
         '52155'||lpad(p_prefijo::text,3,'0')||lpad(i::text,4,'0'), true
  from generate_series(1,p_operadores) i;
  select array_agg(id order by telefono) into ops from operador where tenant_id=p_tenant;

  insert into cliente (id, tenant_id, nombre, rfc, dias_credito, activo)
  select md5('cli'||p_tenant||i)::uuid, p_tenant, 'ZZZ Cliente '||lpad(i::text,3,'0'),
         null, 30, true
  from generate_series(1, greatest(5, p_unidades/4)) i;
  select array_agg(id order by nombre) into clis from cliente where tenant_id=p_tenant;

  insert into geocerca (id, tenant_id, nombre, tipo, lat, lng, radio_m, activa, codigo, cliente_id, fuente, catalogo)
  select md5('geo'||p_tenant||i)::uuid, p_tenant, 'ZZZ Sitio '||lpad(i::text,3,'0'),
         case when i%3=0 then 'planta' when i%3=1 then 'cliente' else 'patio' end,
         19.0 + (i%40)*0.2, -102.0 + (i%50)*0.15, 300, true, 'ZG'||i, clis[1+(i%array_length(clis,1))], 'manual', 'conductor'
  from generate_series(1, greatest(10, p_unidades/2)) i;
  select array_agg(id order by nombre) into geos from geocerca where tenant_id=p_tenant;

  insert into peaje_caseta (id, tenant_id, nombre, nombre_norm, lat, lng, radio_m, activa, fuente)
  select md5('cas'||p_tenant||i)::uuid, p_tenant, 'ZZZ Caseta '||i, 'zzz caseta '||i,
         19.0 + (i%40)*0.2, -102.0 + (i%50)*0.15, 300, true, 'manual'
  from generate_series(1, greatest(10, p_unidades/2)) i;
  select array_agg(id order by nombre) into cas from peaje_caseta where tenant_id=p_tenant;

  -- ── VIAJES ────────────────────────────────────────────────────────────
  -- n=1 es el más viejo (hace 365 días); los últimos p_abiertos son 'abierto'
  -- (un operador distinto cada uno: uq_viaje_abierto_por_operador cubre tambien
  -- 'en_cuadre'), los siguientes hasta completar un viaje vivo por operador
  -- son 'en_cuadre', el resto 'liquidado'.
  insert into viaje (id, tenant_id, operador_id, folio, origen, destino, anticipo, fecha_inicio, fecha_fin,
                     estatus, created_at, unidad_id, cliente_id, ingreso_flete, km_recorridos,
                     avisado_en, aceptado_en, llegada_en, descarga_en, regreso_en,
                     cita_origen_en, cita_destino_en, eta_origen_en, eta_destino_en,
                     origen_geocerca_id, destino_geocerca_id)
  select md5('via'||p_tenant||n)::uuid, p_tenant, ops[1+(n % p_operadores)],
         'ZZZ-'||p_prefijo||'-'||lpad(n::text,6,'0'),
         (array['Monterrey','Guadalajara','Querétaro','León','Puebla','Veracruz','Tijuana','Mérida'])[1+(n%8)],
         (array['CDMX','Toluca','Saltillo','Irapuato','Manzanillo','Hermosillo','Cancún','Mexicali'])[1+((n*3)%8)],
         case when n % 3 = 0 then 4500 else 3000 end,
         d.f, case when estatus_ = 'abierto' then null else d.f + 2 end,
         estatus_, d.f::timestamptz + make_interval(secs => (n*7919) % 80000),
         unis[1+(n % p_unidades)], clis[1+(n % array_length(clis,1))],
         15000 + (n*37) % 20000, 300 + (n*13) % 1400,
         d.f::timestamptz + interval '1 hour', d.f::timestamptz + interval '90 minutes',
         d.f::timestamptz + interval '20 hours', d.f::timestamptz + interval '23 hours', null,
         d.f::timestamptz + interval '8 hours', d.f::timestamptz + interval '1 day 10 hours',
         d.f::timestamptz + interval '8 hours', d.f::timestamptz + interval '1 day 10 hours',
         geos[1+(n % array_length(geos,1))], geos[1+((n*5) % array_length(geos,1))]
  from generate_series(1,p_viajes_anio) n,
       lateral (select v_hoy - (364 - (n*364/p_viajes_anio))::int as f) d,
       lateral (select case when n > p_viajes_anio - p_abiertos then 'abierto'
                            when n > p_viajes_anio - p_operadores then 'en_cuadre'
                            else 'liquidado' end as estatus_) e(estatus_);

  drop table if exists tmp_v;
  create temp table tmp_v on commit drop as
    select id, n, operador_id, unidad_id, estatus, created_at, fecha_inicio
    from (select v.*, row_number() over (order by v.created_at, v.id) as n
          from viaje v where tenant_id = p_tenant) x;
  create index on tmp_v (n);

  -- ── GASTOS: 4 por viaje (2 diésel con CFDI, 1 caseta, 1 alimentación) ─
  insert into gasto (id, tenant_id, viaje_id, concepto, monto, fecha, folio, rfc_emisor, cfdi_uuid, cfdi_valido,
                     created_at, estado_sat, sub_total, iva_traslado, forma_pago, metodo_pago, ocr_confianza, cfdi_orden)
  select md5('gas'||v.id||k)::uuid, p_tenant, v.id,
         (array['diesel','diesel','caseta','alimentacion'])[k], 
         case k when 1 then 2800 when 2 then 2100 when 3 then 640 else 180 end + (v.n % 90),
         v.fecha_inicio + (k>2)::int, 'G'||v.n||'-'||k, 'XEXX010101000',
         case when k<=2 then lower(md5('cfdi'||v.id||k)::text) end,
         k<=2, v.created_at + make_interval(hours => k*5), case when k<=2 then 'vigente' end,
         case when k<=2 then 2000 end, case when k<=2 then 320 end, '03', 'PUE', 0.93, 1
  from tmp_v v, generate_series(1,4) k;

  -- ── LIQUIDACIONES: una por viaje liquidado ────────────────────────────
  insert into liquidacion (id, tenant_id, viaje_id, total_comprobado, total_anticipo, diferencia, estatus,
                           created_at, revision)
  select md5('liq'||v.id)::uuid, p_tenant, v.id, 5000, 4500, -500,
         case when v.n%10=0 then 'con_diferencias' else 'cuadrada' end,
         v.created_at + interval '3 days', 'pendiente'
  from tmp_v v where v.estatus = 'liquidado';

  -- ── HITOS DEL CONDUCTOR (0380): 5 por viaje ───────────────────────────
  insert into viaje_hito (id, tenant_id, viaje_id, tipo, estado, ciclo, fuente, interpretacion, confianza,
                          mensaje_en, recibido_en, validado_en, validado_por, solicitado_en, created_at, updated_at,
                          recordatorios_enviados, escalacion_nivel)
  select md5('hit'||v.id||t.tipo)::uuid, p_tenant, v.id, t.tipo, h.estado, 1,
         case when h.estado <> 'esperado' then 'boton' end, case when h.estado <> 'esperado' then 'boton' end,
         case when h.estado <> 'esperado' then 0.95 end,
         v.created_at + make_interval(hours => t.ord*4),
         case when h.estado <> 'esperado' then v.created_at + make_interval(hours => t.ord*4) end,
         case when h.estado = 'validado' then v.created_at + make_interval(hours => t.ord*4, mins => 5) end,
         case when h.estado = 'validado' then 'gps' end,
         v.created_at + make_interval(hours => t.ord*4 - 1),
         v.created_at, v.created_at + make_interval(hours => t.ord*4),
         0, 0
  from tmp_v v,
       (values (1,'llegada_carga'),(2,'salida_carga'),(3,'llegada_descarga'),(4,'salida_descarga'),(5,'regreso')) t(ord,tipo),
       lateral (select case when v.estatus = 'abierto' and t.ord > 2 then 'esperado'
                            when v.estatus = 'abierto' and t.ord = 2 then 'recibido'
                            else 'validado' end as estado) h;

  insert into viaje_hito_aviso (id, tenant_id, viaje_id, viaje_hito_id, operador_id, ciclo, clase, nivel, ok, canal, created_at)
  select gen_random_uuid(), p_tenant, h.viaje_id, h.id, v.operador_id, 1, c.clase, 0, true, 'plantilla', h.solicitado_en
  from viaje_hito h join tmp_v v on v.id = h.viaje_id,
       (values ('solicitud'),('confirmacion')) c(clase)
  where h.tenant_id = p_tenant and h.tipo in ('llegada_carga','llegada_descarga') and (c.clase='solicitud' or h.estado<>'esperado');

  insert into viaje_hito_evento (tenant_id, viaje_id, viaje_hito_id, tipo_hito, evento, detalle, created_at)
  select p_tenant, h.viaje_id, h.id, h.tipo, e.ev, '{}'::jsonb, h.solicitado_en + e.d
  from viaje_hito h, (values ('solicitado', interval '0'),('recibido', interval '5 minutes'),('validado', interval '6 minutes')) e(ev,d)
  where h.tenant_id = p_tenant and h.tipo in ('llegada_carga','salida_descarga')
    and (e.ev='solicitado' or h.estado in ('recibido','validado'));

  insert into viaje_cruce_geocerca (id, tenant_id, viaje_id, geocerca_id, hito_tipo, tipo, detectado_en, distancia_m)
  select gen_random_uuid(), p_tenant, v.id, geos[1+(v.n % array_length(geos,1))], 'llegada_carga', 'entrada',
         v.created_at + interval '4 hours', 120
  from tmp_v v where v.n % 2 = 0;

  -- ── PEAJES: 3 pases por viaje en un desglose por semana ───────────────
  insert into desglose_peaje (id, tenant_id, proveedor, periodo_desde, periodo_hasta, archivo_nombre, creado_en)
  select md5('des'||p_tenant||w)::uuid, p_tenant, 'zzz', v_hoy - 7*(w+1), v_hoy - 7*w - 1, 'zzz-'||w||'.csv', (v_hoy - 7*w)::timestamptz
  from generate_series(0,52) w;

  insert into desglose_peaje_linea (id, tenant_id, desglose_id, indice, fecha, caseta, monto, tag, viaje_id, estatus,
                                    diferencia, hora, cruce_en, unidad_id, caseta_id, gps_veredicto, gps_distancia_m)
  select md5('lin'||v.id||k)::uuid, p_tenant, md5('des'||p_tenant||(least(52, (v_hoy - v.fecha_inicio)/7)))::uuid,
         (v.n*3+k), v.fecha_inicio, 'ZZZ Caseta', 210 + k*40, 'ZZZTAG'||(v.n%250), v.id,
         case when (v.n+k)%12=0 then 'sin_contraparte' else 'cuadra' end, 0, time '06:00' + make_interval(hours=>k*3),
         v.created_at + make_interval(hours => k*3), v.unidad_id, cas[1+((v.n+k) % array_length(cas,1))],
         case when (v.n+k)%9=0 then 'sin_datos' else 'confirma' end, 80
  from tmp_v v, generate_series(1,3) k;

  -- ── CARTA PORTE: 1 documento por viaje ────────────────────────────────
  insert into cp_documento (id, tenant_id, canal, formato, nombre_archivo, mime, bytes, sha256, estado, version,
                            cliente_id, viaje_id, intentos, remitente_reconocido, confianza_min,
                            created_at, updated_at, aprobado_en, abierto_en)
  select md5('cpd'||v.id)::uuid, p_tenant, 'correo', 'pdf_texto', 'ZZZ-cp-'||v.n||'.pdf', 'application/pdf', 90000,
         md5('cp1'||v.id)||md5('cp2'||v.id),
         case when v.created_at > now() - interval '2 days' then (array['recibido','procesando','por_revisar'])[1+(v.n%3)] else 'aprobado' end,
         1, clis[1+(v.n % array_length(clis,1))], v.id, 0, true, 0.9,
         v.created_at, v.created_at + interval '1 hour',
         case when v.created_at > now() - interval '2 days' then null else v.created_at + interval '2 hours' end,
         null
  from tmp_v v;

  -- ── VIGÍA: contactos/conversaciones/mensajes/eventos ──────────────────
  insert into vigia_contacto (id, tenant_id, cliente_id, telefono, telefono_hash, nombre, estado, consentimiento_en, consentimiento_origen)
  select md5('vct'||p_tenant||i)::uuid, p_tenant, clis[1+(i % array_length(clis,1))],
         '52156'||lpad(p_prefijo::text,3,'0')||lpad(i::text,4,'0'), md5('vh'||p_tenant||i)||md5('vi'||p_tenant||i),
         'ZZZ Contacto '||i, 'activo', now() - interval '300 days', 'alta_flota'
  from generate_series(1, greatest(8, p_unidades/2)) i;

  insert into vigia_conversacion (id, tenant_id, contacto_id, cliente_id, viaje_id, estado, control, ultima_entrada_en,
                                  entradas_sin_respuesta, created_at, updated_at, cerrada_en)
  select md5('vcv'||v.id)::uuid, p_tenant, md5('vct'||p_tenant||(1+((v.n/2) % greatest(8, p_unidades/2))))::uuid,
         clis[1+(v.n % array_length(clis,1))], v.id,
         case when v.estatus = 'abierto' then 'activa' else 'cerrada' end, 'agente',
         v.created_at + interval '6 hours', 0, v.created_at, v.created_at + interval '1 day',
         case when v.estatus = 'abierto' then null else v.created_at + interval '2 days' end
  from tmp_v v where v.n % 2 = 0;      -- 1 conversación de cada 2 viajes

  insert into vigia_mensaje (id, tenant_id, conversacion_id, direccion, autor, wamid, tipo, texto, intencion, clasificador,
                             estado, enviado_en, via, autoenviado, created_at, respuesta_a)
  select md5('vmg'||v.id||k)::uuid, p_tenant, md5('vcv'||v.id)::uuid,
         case when k=2 then 'saliente' else 'entrante' end, case when k=2 then 'agente' else 'cliente' end,
         'zzzwam'||v.n||'k'||k, 'texto', 'ZZZ mensaje sintético '||k, case when k=2 then null else 'ubicacion' end, 'reglas',
         case when k=2 then 'enviado' else 'recibido' end,
         case when k=2 then v.created_at + interval '7 hours' end, case when k=2 then 'texto' end, k=2,
         v.created_at + make_interval(hours => 6 + k),
         case when k=2 then md5('vmg'||v.id||1)::uuid end
  from tmp_v v, generate_series(1,3) k where v.n % 2 = 0;   -- 3 mensajes por conversación ⇒ 1.5/viaje

  insert into vigia_evento (tenant_id, conversacion_id, tipo, nivel, created_at)
  select p_tenant, md5('vcv'||v.id)::uuid, (array['entrante','borrador','enviado','autoenviado'])[k], 0,
         v.created_at + make_interval(hours => 6, mins => k)
  from tmp_v v, generate_series(1,4) k where v.n % 2 = 0;   -- 2 eventos/viaje

  -- ── LIQUIDACIÓN EXTERNA: una por cada 5 viajes liquidados ─────────────
  insert into liquidacion_externa (id, tenant_id, clave_externa, huella, sistema_origen, operador_id, folios_viaje, viaje_ids,
                                   periodo_desde, periodo_hasta, conceptos, total, moneda, pdf_origen, estado, via, generacion,
                                   intentos, created_at, updated_at, enviada_en)
  select md5('lex'||v.id)::uuid, p_tenant, 'ZZZ-LEX-'||v.n, md5('h1'||v.id)||md5('h2'||v.id), 'zzz', v.operador_id,
         array['ZZZ-'||p_prefijo||'-'||lpad(v.n::text,6,'0')], array[v.id], v.fecha_inicio, v.fecha_inicio + 6,
         '[{"concepto":"sueldo","monto":4500}]'::jsonb, 4500, 'MXN', 'generado',
         case when v.created_at > now() - interval '2 days' then 'pendiente' else 'enviada' end, 'plantilla', 1, 0,
         v.created_at + interval '4 days', v.created_at + interval '4 days',
         case when v.created_at > now() - interval '2 days' then null else v.created_at + interval '4 days' end
  from tmp_v v where v.estatus='liquidado' and v.n % 5 = 0;

  -- ── GPS: 1 punto / 5 min por unidad en movimiento, últimos p_gps_dias ─
  insert into posicion (tenant_id, unidad_id, lat, lng, velocidad, rumbo, odometro, medida_en, recibida_en, proveedor, ignicion)
  select p_tenant, unis[u],
         19.0 + (u%40)*0.2 + 0.05*sin((u+extract(epoch from m)/3600)/7.0),
         -102.0 + (u%50)*0.15 + 0.05*cos((u+extract(epoch from m)/3600)/9.0),
         70 + (u % 20), (u*7)%360, u*1000 + extract(epoch from m)/60,
         m, m + interval '20 seconds', 'tabla_propia', true
  from generate_series(1,p_unidades) u,
       generate_series(0, p_gps_dias-1) d,
       lateral (select (v_hoy - d)::timestamptz + interval '6 hours' as ini) i,
       generate_series(0, 143) s,
       lateral (select i.ini + s * interval '5 minutes' as m) mm
  where ((u*31 + d*17) % 100) < 85              -- 85 % de los días con movimiento
    and (i.ini + s * interval '5 minutes') < now();
end
$f$;

begin;
set local session_replication_role = replica;
set local synchronous_commit = off;
set local maintenance_work_mem = '512MB';

-- La flota objetivo: 250 tractos, 262 operadores, 5,000 viajes/mes × 12 = 60,000.
select pg_temp.sembrar_flota('aaaaaaaa-0000-4000-8000-000000000250', 'ZZZ CARGA 250', 0, 250, 262, 60000, 90, 230);
commit;

-- 20 flotas pequeñas (ruido de tenant): 6 tractos, 7 operadores, 250 viajes/año, 30 días de GPS.
do $$
declare i int;
begin
  perform set_config('session_replication_role','replica', true);
  for i in 1..20 loop
    perform pg_temp.sembrar_flota(md5('zzz-chica-'||i)::uuid, 'ZZZ CARGA CHICA '||lpad(i::text,2,'0'), i, 6, 7, 250, 30, 5);
  end loop;
end $$;

-- ── Estado de trabajo vivo para los crons (se aplica a todas las flotas ZZZ) ─
-- vigia_config habilitada (si no, el cron de Vigía no barre la flota) y las
-- conversaciones activas con un cliente esperando respuesta desde hace 20 min.
begin;
set local session_replication_role = replica;
insert into vigia_config (tenant_id, habilitado, sla_respuesta_min, sla_critico_min)
select id, true, 15, 10 from tenant where nombre like 'ZZZ CARGA%';
update vigia_conversacion c set sin_respuesta_desde = now() - interval '20 minutes', entradas_sin_respuesta = 1
 where c.estado = 'activa' and c.tenant_id in (select id from tenant where nombre like 'ZZZ CARGA%');
insert into conector_poll_estado (tenant_id, proveedor, recurso, errores_seguidos)
select id, 'tabla_propia', 'posiciones', 0 from tenant where nombre like 'ZZZ CARGA%';
commit;
analyze;
