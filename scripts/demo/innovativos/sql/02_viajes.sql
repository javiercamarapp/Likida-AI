-- ═══════════════════════════════════════════════════════════════════════════
-- 02 — Viajes: 140 EN CURSO (uno por operador, 1..140) + 266 CERRADOS de los
-- últimos 7 días, con los hitos del conductor (llegó a cargar, salió, llegó a
-- descargar, salió).
--
-- El PLAN de cada viaje se calcula una vez (innovativos_sim.plan_viaje) y de él
-- salen viaje, hitos, posiciones GPS (03) y pases de peaje (04): así las
-- tres cosas son coherentes entre sí (el tractor va donde dice su viaje).
--
-- Escenarios sembrados a propósito para el guion:
--   · «llegue_sin_gps»: el operador escribió «ya llegué a descargar» pero el GPS
--     lo muestra a >100 km. El hito queda RECIBIDO (no confirmado), no validado.
--   · «silencio»: sin señal de vida: el GPS dejó de reportar hace >100 min y el
--     hito pendiente va ESCALADO (nivel 1 o 2) al jefe de tráfico.
-- ═══════════════════════════════════════════════════════════════════════════

drop table if exists innovativos_sim.plan_viaje cascade;
create table innovativos_sim.plan_viaje as
with a as (select current_setting('inn.ancla')::timestamptz as anc),
base as (
  select i, 'abierto'::text as tipo, i as n, 'INN-' || (24000 + i) as folio,
         innovativos_sim.u('v:u1:' || i) as u1, innovativos_sim.u('v:u2:' || i) as u2, innovativos_sim.u('v:u3:' || i) as u3
  from generate_series(1, 140) i
  union all
  select 140 + k, 'cerrado', 1 + (innovativos_sim.h('cn:' || k) % 250)::int, 'INN-' || (23000 + k),
         innovativos_sim.u('v:u1:' || (140 + k)), innovativos_sim.u('v:u2:' || (140 + k)), innovativos_sim.u('v:u3:' || (140 + k))
  from generate_series(1, 266) k
),
conorigen as (
  select b.*, tr.term, tr.economico,
         (select s.cliente_key from innovativos_sim.sitio s
           where (b.u1 >= 0.6 or s.nodo = tr.term)
           order by md5(b.i::text || s.cliente_key) limit 1) as o_key
  from base b join innovativos_sim.tracto tr on tr.n = b.n
),
condestino as (
  select c.*, so.nodo as nodo_o,
         (select s.cliente_key from innovativos_sim.sitio s
           where s.nodo <> so.nodo order by md5('d' || c.i::text || s.cliente_key) limit 1) as d_key
  from conorigen c join innovativos_sim.sitio so on so.cliente_key = c.o_key
),
geo as (
  select c.*, sd.nodo as nodo_d,
         abs(nd.km - no.km) as dist_km, no.km as ka, nd.km as kb
  from condestino c
  join innovativos_sim.sitio sd on sd.cliente_key = c.d_key
  join innovativos_sim.nodo no on no.cod = c.nodo_o
  join innovativos_sim.nodo nd on nd.cod = sd.nodo
),
tiempos as (
  select g.*, g.dist_km / 65.0 as travel_h, 1.5 as dwell_c, 2.0 as dwell_d,
         case when g.tipo = 'abierto' and g.i % 27 = 5 then 'llegue_sin_gps'
              when g.tipo = 'abierto' and g.i % 23 = 0 then 'silencio'
              else 'normal' end as escenario
  from geo g
)
select t.i, t.tipo, t.n, t.folio, t.term, t.economico, t.o_key, t.d_key, t.nodo_o, t.nodo_d,
       t.ka, t.kb, round(t.dist_km::numeric, 1)::float8 as dist_km, t.travel_h, t.dwell_c, t.dwell_d, t.escenario,
       t.u1, t.u2, t.u3,
       case when t.tipo = 'abierto' then
              a.anc - make_interval(secs => 3600 * (
                case t.escenario
                  when 'llegue_sin_gps' then t.dwell_c + t.travel_h * 0.35
                  when 'silencio'       then t.dwell_c + t.travel_h * (0.2 + 0.5 * t.u2)
                  else -1.0 + t.u2 * (1.0 + t.dwell_c + t.travel_h + 1.8) end))
            else a.anc - make_interval(secs => 86400 * (1.3 + 5.5 * t.u2))
       end as t0
from tiempos t, a;

alter table innovativos_sim.plan_viaje add primary key (i);
alter table innovativos_sim.plan_viaje add column t_lc timestamptz, add column t_sc timestamptz,
  add column t_ld timestamptz, add column t_sd timestamptz;
update innovativos_sim.plan_viaje set
  t_lc = t0,
  t_sc = t0 + make_interval(secs => 3600 * dwell_c),
  t_ld = t0 + make_interval(secs => 3600 * (dwell_c + travel_h)),
  t_sd = t0 + make_interval(secs => 3600 * (dwell_c + travel_h + dwell_d));

-- Un viaje abierto no puede haber terminado: se recorta a «descargando».
update innovativos_sim.plan_viaje p set
  t0   = t0   + (current_setting('inn.ancla')::timestamptz - t_sd) + interval '10 minutes',
  t_lc = t_lc + (current_setting('inn.ancla')::timestamptz - t_sd) + interval '10 minutes',
  t_sc = t_sc + (current_setting('inn.ancla')::timestamptz - t_sd) + interval '10 minutes',
  t_ld = t_ld + (current_setting('inn.ancla')::timestamptz - t_sd) + interval '10 minutes',
  t_sd = t_sd + (current_setting('inn.ancla')::timestamptz - t_sd) + interval '10 minutes'
where tipo = 'abierto' and t_sd <= current_setting('inn.ancla')::timestamptz;

-- ── Viajes ─────────────────────────────────────────────────────────────────
insert into viaje (id, tenant_id, operador_id, terminal_id, folio, origen, destino, anticipo,
                   fecha_inicio, fecha_fin, estatus, unidad_id, cliente_id, ingreso_flete, km_recorridos,
                   avisado_en, aceptado_en, llegada_en, descarga_en,
                   cita_origen_en, cita_destino_en, eta_destino_en, origen_geocerca_id, destino_geocerca_id)
select innovativos_sim.uid('viaje:' || p.folio), current_setting('inn.tenant')::uuid,
       innovativos_sim.uid('operador:' || p.n), innovativos_sim.uid('terminal:' || p.term), p.folio,
       so.planta || ', ' || so.ciudad, sd.planta || ', ' || sd.ciudad,
       round((p.dist_km * 1.1 + 400)::numeric, -1),
       (p.t0 at time zone 'America/Mexico_City')::date,
       case when p.tipo = 'cerrado' then (p.t_sd at time zone 'America/Mexico_City')::date end,
       case when p.tipo = 'cerrado' then 'liquidado' else 'abierto' end,
       innovativos_sim.uid('unidad:' || p.n), innovativos_sim.uid('cliente:' || p.o_key),
       round((p.dist_km * (30 + 8 * p.u3))::numeric, 0),
       case when p.tipo = 'cerrado' then round((p.dist_km * (1.0 + 0.05 * p.u3))::numeric)::int end,
       p.t0 - interval '3 hours', p.t0 - interval '2 hours 50 minutes',
       case when p.tipo = 'cerrado' then p.t_ld end,
       case when p.tipo = 'cerrado' then p.t_sd end,
       p.t0 - interval '15 minutes', p.t_ld + interval '20 minutes',
       case when p.tipo = 'abierto' then p.t_ld + make_interval(mins => (innovativos_sim.h('eta' || p.i) % 40)::int - 10) end,
       innovativos_sim.uid('geo:planta:' || p.o_key), innovativos_sim.uid('geo:planta:' || p.d_key)
from innovativos_sim.plan_viaje p
join innovativos_sim.sitio so on so.cliente_key = p.o_key
join innovativos_sim.sitio sd on sd.cliente_key = p.d_key
on conflict (id) do nothing;

-- ── Hitos del conductor ────────────────────────────────────────────────────
-- Cada viaje tiene 4 eventos con su hora «real»; los que ya pasaron se validan
-- (por GPS en ~55 %, por palabra del chofer conciliada con el GPS en el resto);
-- el siguiente queda ESPERADO. Excepciones: ver cabecera.
insert into viaje_hito (id, tenant_id, viaje_id, tipo, estado, ciclo, fuente, interpretacion, confianza,
                        mensaje_en, recibido_en, texto_chofer, contacto_nombre, contacto_area, sin_contacto,
                        lat, lng, validado_en, validado_por, solicitado_en, recordatorios_enviados,
                        ultimo_aviso_en, escalado_en, escalacion_nivel, created_at, updated_at)
select innovativos_sim.uid('hito:' || p.folio || ':' || e.tipo), current_setting('inn.tenant')::uuid,
       innovativos_sim.uid('viaje:' || p.folio), e.tipo,
       r.estado, 1,
       case when r.estado in ('recibido','validado') then r.fuente end,
       case when r.estado in ('recibido','validado') then
            case r.fuente when 'ubicacion' then 'ubicacion' when 'boton' then 'boton' else 'regla' end end,
       case when r.estado in ('recibido','validado') then
            case r.fuente when 'ubicacion' then 0.99 else round((0.9 + 0.09 * p.u3)::numeric, 2)::real end end,
       case when r.estado in ('recibido','validado') and r.fuente <> 'ubicacion' then r.recibido end,
       case when r.estado in ('recibido','validado') then r.recibido end,
       case when r.estado in ('recibido','validado') and r.fuente = 'texto' then
            case when r.escenario_llegue then 'Ya llegué a descargar, estoy en la puerta'
                 else (array['Ya llegué a la planta','Llegué, me estoy reportando','Ya cargué, salgo','Ya descargué, saliendo','Ya estoy en andén','Entregado, me retiro'])
                      [innovativos_sim.pick('txt' || p.folio || e.tipo, 6)] end end,
       case when r.estado in ('recibido','validado') and e.tipo in ('llegada_carga','llegada_descarga') and p.u1 < 0.6 and not r.escenario_llegue
            then (array['Sr. Quintero','Sra. Valdés','Ing. Barrera','Don Pedro','Srita. Lucero','Sr. Montaño'])[innovativos_sim.pick('con' || p.folio || e.tipo, 6)] || ' (ficticio)' end,
       case when r.estado in ('recibido','validado') and e.tipo in ('llegada_carga','llegada_descarga') and p.u1 < 0.6 and not r.escenario_llegue
            then (array['Andén','Báscula','Vigilancia','Almacén','Recibo'])[innovativos_sim.pick('area' || p.folio || e.tipo, 5)] end,
       case when r.estado in ('recibido','validado') and e.tipo in ('llegada_carga','llegada_descarga') and p.u1 >= 0.6 and not r.escenario_llegue then true else false end,
       case when r.estado in ('recibido','validado') then
            (case when r.escenario_llegue then pl.lat else case when e.tipo in ('llegada_carga','salida_carga') then lo.lat else ld.lat end end) + (innovativos_sim.u('jl' || p.folio || e.tipo) - 0.5) * 0.0008 end,
       case when r.estado in ('recibido','validado') then
            (case when r.escenario_llegue then pl.lng else case when e.tipo in ('llegada_carga','salida_carga') then lo.lng else ld.lng end end) + (innovativos_sim.u('jg' || p.folio || e.tipo) - 0.5) * 0.0008 end,
       case when r.estado = 'validado' then least(r.recibido + interval '1 minute', r.anc) end,
       case when r.estado = 'validado' then case when r.fuente = 'ubicacion' then 'gps' else 'sistema' end end,
       case when r.estado in ('esperado','escalado') then r.anc - case when r.estado = 'escalado' then interval '150 minutes' else interval '8 minutes' end
            else r.recibido - interval '5 minutes' end,
       case when r.estado = 'escalado' then 2 when r.estado = 'esperado' then (innovativos_sim.h('rec' || p.folio) % 2)::int else 0 end,
       case when r.estado = 'escalado' then r.anc - interval '70 minutes' end,
       case when r.estado = 'escalado' then r.anc - interval '40 minutes' end,
       case when r.estado = 'escalado' then case when p.i % 46 = 0 then 2 else 1 end else 0 end,
       r.anc - interval '1 minute', r.anc - interval '1 minute'
from innovativos_sim.plan_viaje p
join innovativos_sim.sitio so on so.cliente_key = p.o_key
join innovativos_sim.sitio sd on sd.cliente_key = p.d_key
cross join lateral (values ('llegada_carga', 1, p.t_lc), ('salida_carga', 2, p.t_sc),
                           ('llegada_descarga', 3, p.t_ld), ('salida_descarga', 4, p.t_sd)) e(tipo, ord, ts)
cross join lateral (select so.lat as lat, so.lng as lng) lo
cross join lateral (select sd.lat as lat, sd.lng as lng) ld
-- Donde REALMENTE va el tractor cuando el operador escribe «ya llegué» (35 % de la ruta): lejos de la planta.
-- Misma fórmula de progreso que usa 03_gps.sql para sus posiciones.
cross join lateral innovativos_sim.punto(p.ka + sign(p.kb - p.ka) * 0.35 * abs(p.kb - p.ka)) pl
cross join lateral (
  select current_setting('inn.ancla')::timestamptz as anc,
         (p.escenario = 'llegue_sin_gps' and e.tipo = 'llegada_descarga') as escenario_llegue,
         (array['ubicacion','texto','boton'])[case when p.escenario = 'llegue_sin_gps' and e.tipo = 'llegada_descarga' then 2
                                                   when innovativos_sim.u('f' || p.folio || e.tipo) < 0.55 then 1
                                                   when innovativos_sim.u('f' || p.folio || e.tipo) < 0.85 then 2 else 3 end] as fuente,
         -- El reporte llega entre 3 y 10 min DESPUÉS de la hora real (nunca antes de que el GPS llegue al sitio: el GPS
         -- reporta cada 5 min y un «llegué» a los 0-2 min se compararía con la muestra anterior, aún en la carretera).
         least(e.ts + make_interval(mins => 3 + (innovativos_sim.h('dl' || p.folio || e.tipo) % 8)::int),
               current_setting('inn.ancla')::timestamptz - interval '1 minute') as recibido,
         case
           when p.tipo = 'cerrado' then 'validado'
           when p.escenario = 'llegue_sin_gps' and e.tipo = 'llegada_descarga' then 'recibido'
           when p.escenario = 'llegue_sin_gps' and e.ord > 3 then null
           when e.ts <= current_setting('inn.ancla')::timestamptz then 'validado'
           when e.ord = (select min(x) from (values (1, p.t_lc), (2, p.t_sc), (3, p.t_ld), (4, p.t_sd)) q(x, tt)
                         where tt > current_setting('inn.ancla')::timestamptz)
                then case when p.escenario = 'silencio' then 'escalado' else 'esperado' end
           else null end as estado
) r
where r.estado is not null
on conflict (id) do nothing;
