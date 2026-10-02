-- ═══════════════════════════════════════════════════════════════════════════
-- 01 — Base del tenant: flota, terminales, clientes, geocercas, operadores,
-- tractos. Todo con ids deterministas + ON CONFLICT DO NOTHING => re-correr no
-- duplica nada.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Tenant ─────────────────────────────────────────────────────────────────
insert into tenant (id, nombre, rfc, ciudad, plan, razon_social, domicilio_fiscal,
                    url_aviso_privacidad, contacto_privacidad, regimen_fiscal,
                    codigo_postal_fiscal, uso_cfdi, zona_horaria, config)
values (current_setting('inn.tenant')::uuid, 'Innovativos (demo)', 'IDE201001AB3', 'Tlaquepaque, JAL', 'demo',
        'INNOVATIVOS DEMO SA DE CV',
        'Calle Ficticia 100, Parque Industrial Demo, 45600 San Pedro Tlaquepaque, Jalisco',
        'https://app.likida.ai/aviso/' || current_setting('inn.tenant'), 'privacidad@innovativos-demo.invalid',
        '601', '45600', 'G03', 'America/Mexico_City',
        '{"empresa":{"rfc":"IDE201001AB3"},
          "politica":[{"concepto":"diesel","topeMonto":9000,"requiereCfdi":true},
                      {"concepto":"caseta","topeMonto":6000},
                      {"concepto":"alimentacion","topeMonto":450},
                      {"concepto":"viaticos","topeMonto":450},
                      {"concepto":"hospedaje","topeMonto":900,"requiereCfdi":true},
                      {"concepto":"flete"},
                      {"concepto":"factura","requiereCfdi":true},
                      {"concepto":"otro","topeMonto":1500}],
          "tabulador":{"rendimientoPorDefecto":2.3,"precioDieselPorDefecto":24,"umbralDesviacion":0.06},
          "facilidadCombustibleEfectivo":{"dedicacionExclusivaCarga":true,"regimenElegible":false}}'::jsonb)
on conflict (id) do nothing;

-- ── Terminales ─────────────────────────────────────────────────────────────
insert into terminal (id, tenant_id, nombre, ciudad)
select innovativos_sim.uid('terminal:' || v.cod), current_setting('inn.tenant')::uuid, v.nombre, v.ciudad
from (values ('GDL', 'Tlaquepaque', 'San Pedro Tlaquepaque, JAL'),
             ('SIL', 'Silao',       'Silao de la Victoria, GTO'),
             ('APO', 'Apodaca',     'Apodaca, NL')) v(cod, nombre, ciudad)
on conflict (id) do nothing;

-- ── Clientes ficticios + su planta (geocerca) ──────────────────────────────
-- crit = grupo de WhatsApp «crítico» del Vigía (se siembra solo el de esos 3).
drop table if exists innovativos_sim.sitio cascade;
create table innovativos_sim.sitio (
  cliente_key text primary key, nodo text not null, nombre_cliente text not null, razon text not null,
  rfc text not null, tel text not null, planta text not null, lat float8 not null, lng float8 not null,
  ciudad text not null, cp text not null, dias_credito int not null, crit boolean not null default false
);
insert into innovativos_sim.sitio values
 ('c01','GDL','Electrónica Ficticia de Occidente','ELECTRONICA FICTICIA DE OCCIDENTE SA DE CV','EFO100101AA1','2899910000001','Planta El Salto',           20.5150,-103.1850,'El Salto, JAL','45680',30,false),
 ('c02','GDL','Lácteos Ficticios de Jalisco',      'LACTEOS FICTICIOS DE JALISCO SA DE CV',     'LFJ100101AA2','2899910000002','CEDIS Tlaquepaque',        20.6280,-103.2920,'Tlaquepaque, JAL','45500',45,false),
 ('c03','LAG','Alimentos Ficticios de los Altos',  'ALIMENTOS FICTICIOS DE LOS ALTOS SA DE CV', 'AFA100101AA3','2899910000003','Planta Lagos de Moreno',   21.3520,-101.9180,'Lagos de Moreno, JAL','47480',30,false),
 ('c04','LEO','Calzado Ficticio de León',          'CALZADO FICTICIO DE LEON SA DE CV',         'CFL100101AA4','2899910000004','Bodega León',              21.1050,-101.6550,'León, GTO','37500',15,false),
 ('c05','SIL','Autopartes Ficticias del Bajío',    'AUTOPARTES FICTICIAS DEL BAJIO SA DE CV',   'AFB100101AA5','2899910000005','Planta Silao',             20.9350,-101.4250,'Silao, GTO','36100',30,true),
 ('c06','SIL','Ensambladora Ficticia Guanajuato',  'ENSAMBLADORA FICTICIA GUANAJUATO SA DE CV', 'EFG100101AA6','2899910000006','Puerto Seco Silao',        20.9720,-101.3920,'Silao, GTO','36110',45,false),
 ('c07','SLP','Químicos Ficticios del Centro',     'QUIMICOS FICTICIOS DEL CENTRO SA DE CV',    'QFC100101AA7','2899910000007','Planta Química SLP',       22.1150,-100.9250,'San Luis Potosí, SLP','78395',30,false),
 ('c08','SLP','Envases Ficticios Potosinos',       'ENVASES FICTICIOS POTOSINOS SA DE CV',      'EFP100101AA8','2899910000008','Planta Envases SLP',       22.1900,-101.0200,'San Luis Potosí, SLP','78430',30,false),
 ('c09','MAT','Minerales Ficticios del Altiplano', 'MINERALES FICTICIOS DEL ALTIPLANO SA DE CV','MFA100101AA9','2899910000009','Patio Minero Matehuala',   23.6400,-100.6500,'Matehuala, SLP','78700',60,false),
 ('c10','SAL','Armadora Ficticia Ramos Arizpe',    'ARMADORA FICTICIA RAMOS ARIZPE SA DE CV',   'AFR100101AB1','2899910000010','Planta Ramos Arizpe',      25.5600,-100.9400,'Ramos Arizpe, COAH','25900',30,true),
 ('c11','SAL','Acero Ficticio de Coahuila',        'ACERO FICTICIO DE COAHUILA SA DE CV',       'AFC100101AB2','2899910000011','Planta Acero Saltillo',    25.4400,-100.9800,'Saltillo, COAH','25000',45,false),
 ('c12','APO','Cervecería Ficticia del Norte',     'CERVECERIA FICTICIA DEL NORTE SA DE CV',    'CFN100101AB3','2899910000012','CEDIS Apodaca Norte',      25.7750,-100.1850,'Apodaca, NL','66600',30,true),
 ('c13','APO','Electrodomésticos Ficticios Apodaca','ELECTRODOMESTICOS FICTICIOS APODACA SA DE CV','EFA100101AB4','2899910000013','Planta Apodaca',         25.7900,-100.2100,'Apodaca, NL','66610',30,false),
 ('c14','APO','Logística Ficticia Escobedo',       'LOGISTICA FICTICIA ESCOBEDO SA DE CV',      'LFE100101AB5','2899910000014','Bodega Escobedo',          25.8000,-100.3200,'General Escobedo, NL','66050',15,false);

-- Geocercas: patios de las 3 terminales, la planta de cada cliente y su andén (hija).
insert into geocerca (id, tenant_id, nombre, tipo, lat, lng, radio_m, activa, codigo, direccion, cliente_id, padre_id, fuente)
select innovativos_sim.uid('geo:patio:' || v.cod), current_setting('inn.tenant')::uuid, v.nombre, 'patio', v.lat, v.lng, 600, true,
       'PATIO-' || v.cod, v.dir, null, null, 'csv'
from (values ('GDL','Patio Tlaquepaque', 20.6395,-103.3120,'Calle Ficticia 100, Tlaquepaque, JAL'),
             ('SIL','Patio Silao',       20.9440,-101.4300,'Carretera Ficticia km 4, Silao, GTO'),
             ('APO','Patio Apodaca',     25.7800,-100.1900,'Av. Ficticia 2000, Apodaca, NL')) v(cod, nombre, lat, lng, dir)
on conflict (id) do nothing;

insert into cliente (id, tenant_id, nombre, rfc, contacto, correo, telefono, dias_credito, activo,
                     razon_social, regimen_fiscal, uso_cfdi, cp_fiscal)
select innovativos_sim.uid('cliente:' || s.cliente_key), current_setting('inn.tenant')::uuid, s.nombre_cliente, s.rfc,
       'Contacto Ficticio ' || right(s.cliente_key, 2), 'logistica@' || s.cliente_key || '.demo.invalid', s.tel, s.dias_credito, true,
       s.razon, '601', 'G03', s.cp
from innovativos_sim.sitio s
on conflict (id) do nothing;

insert into geocerca (id, tenant_id, nombre, tipo, lat, lng, radio_m, activa, codigo, direccion, cliente_id, padre_id, fuente)
select innovativos_sim.uid('geo:planta:' || s.cliente_key), current_setting('inn.tenant')::uuid, s.planta, 'planta',
       s.lat, s.lng, 350 + 50 * (innovativos_sim.h(s.cliente_key) % 5)::int, true, 'PL-' || upper(s.cliente_key),
       s.ciudad, innovativos_sim.uid('cliente:' || s.cliente_key), null, 'csv'
from innovativos_sim.sitio s
on conflict (id) do nothing;

insert into geocerca (id, tenant_id, nombre, tipo, lat, lng, radio_m, activa, codigo, direccion, cliente_id, padre_id, fuente)
select innovativos_sim.uid('geo:anden:' || s.cliente_key), current_setting('inn.tenant')::uuid, 'Andén ' || s.planta, 'anden',
       s.lat + 0.0006, s.lng + 0.0004, 60, true, 'AN-' || upper(s.cliente_key),
       s.ciudad, innovativos_sim.uid('cliente:' || s.cliente_key), innovativos_sim.uid('geo:planta:' || s.cliente_key), 'csv'
from innovativos_sim.sitio s
on conflict (id) do nothing;

update cliente c set geocerca_id = innovativos_sim.uid('geo:planta:' || s.cliente_key)
from innovativos_sim.sitio s
where c.id = innovativos_sim.uid('cliente:' || s.cliente_key) and c.geocerca_id is null;

-- ── Tractos y operadores (1..250 emparejados; 251..262 = relevos) ──────────
-- Terminal: 40 % Tlaquepaque, 30 % Silao, 30 % Apodaca.
drop table if exists innovativos_sim.tracto cascade;
create table innovativos_sim.tracto as
select n,
       'IN-' || lpad(n::text, 3, '0')                                  as economico,
       (case when n % 10 < 4 then 'GDL' when n % 10 < 7 then 'SIL' else 'APO' end) as term,
       'PSD' || lpad(n::text, 9, '0')                                  as tag,
       'INN-GPS-' || lpad(n::text, 4, '0')                             as device
from generate_series(1, 250) n;

insert into unidad (id, tenant_id, numero_economico, placas, marca, modelo, anio, estado, km_actual,
                    poliza_vence, permiso_sict_vence, verificacion_vence, activo, config_vehicular,
                    gps_device_id, gps_proveedor, terminal_id)
select innovativos_sim.uid('unidad:' || t.n), current_setting('inn.tenant')::uuid, t.economico,
       'D' || chr(65 + (t.n % 26)) || chr(65 + ((t.n / 26) % 26)) || lpad((1000 + t.n)::text, 4, '0'),
       (array['Kenworth','Freightliner','International','Volvo'])[innovativos_sim.pick('marca' || t.n, 4)],
       (array['T680','Cascadia','LT625','VNL 760'])[innovativos_sim.pick('marca' || t.n, 4)],
       2016 + (innovativos_sim.h('anio' || t.n) % 11)::int,
       case when t.n <= 140 then 'en_ruta' when t.n <= 152 then 'taller' else 'disponible' end,
       180000 + (innovativos_sim.h('km' || t.n) % 520000)::int,
       (current_setting('inn.ancla')::timestamptz)::date + (30 + innovativos_sim.h('pol' || t.n) % 300)::int,
       (current_setting('inn.ancla')::timestamptz)::date + (60 + innovativos_sim.h('sict' || t.n) % 600)::int,
       (current_setting('inn.ancla')::timestamptz)::date + (20 + innovativos_sim.h('ver' || t.n) % 160)::int,
       true, 'T3S2', t.device, 'tabla_propia', innovativos_sim.uid('terminal:' || t.term)
from innovativos_sim.tracto t
on conflict (id) do nothing;

insert into operador (id, tenant_id, terminal_id, nombre, telefono, numero_empleado, activo,
                      licencia, licencia_tipo, licencia_vence)
select innovativos_sim.uid('operador:' || n), current_setting('inn.tenant')::uuid,
       innovativos_sim.uid('terminal:' || term),
       (array['Josué','Luis','Juan','Miguel','Carlos','Jorge','Ricardo','Fernando','Raúl','Héctor','Alberto','Mario',
              'Sergio','Arturo','Eduardo','Roberto','Manuel','Óscar','Pedro','Javier','Gerardo','Armando','Ramón','Víctor',
              'Daniel','Rubén','Enrique','Francisco','Gustavo','Alfredo'])[innovativos_sim.pick('n1' || n, 30)]
       || ' ' ||
       (array['Hernández','García','Martínez','López','González','Rodríguez','Pérez','Sánchez','Ramírez','Flores',
              'Gómez','Díaz','Reyes','Cruz','Morales','Ortiz','Gutiérrez','Chávez','Ramos','Mendoza','Ruiz','Aguilar',
              'Medina','Castillo','Vargas','Jiménez','Torres','Vázquez','Domínguez','Núñez'])[innovativos_sim.pick('n2' || n, 30)]
       || ' ' ||
       (array['Soto','Lara','Rojas','Navarro','Ibarra','Salazar','Cortés','Guerrero','Fuentes','Paredes',
              'Mora','Rangel','Zamora','Cervantes','Villa','Montes','Cisneros','Ponce','Orozco','Varela'])[innovativos_sim.pick('n3' || n, 20)],
       '289992' || lpad(n::text, 7, '0'), 'DEMO-' || lpad(n::text, 4, '0'), true,
       'LF' || lpad((5000000 + n * 17)::text, 7, '0'), 'E',
       (current_setting('inn.ancla')::timestamptz)::date + (-20 + innovativos_sim.h('lic' || n) % 700)::int
from (
  select g.n, case when g.n <= 250 then (select term from innovativos_sim.tracto where n = g.n)
                   else (array['GDL','SIL','APO'])[1 + g.n % 3] end as term
  from generate_series(1, 262) g(n)
) o
on conflict (id) do nothing;

-- TAG de peaje (formato inventado «PSD…»): uno por tracto.
insert into peaje_tag (id, tenant_id, tag, tag_original, unidad_id, proveedor, activo)
select innovativos_sim.uid('tag:' || t.n), current_setting('inn.tenant')::uuid, t.tag, t.tag,
       innovativos_sim.uid('unidad:' || t.n), 'PASE (demo)', true
from innovativos_sim.tracto t
on conflict (id) do nothing;
