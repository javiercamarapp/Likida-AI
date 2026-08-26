-- ═══════════════════════════════════════════════════════════════════════════
-- demo-5k.sql — SIEMBRA de la flota demo «Transportes Peninsulares, S.A. de C.V.»
-- (TPS): 5,000 unidades, ~7,500 operadores, 25 terminales, 40 clientes,
-- ~27,500 viajes en 30 días, ~90,000 gastos, ~24,000 liquidaciones (ver
-- BLOQUE 4 por qué no 70,000: techo de traerTodo).
-- Modelo: docs/demo-5k-modelo.md · Uso y limpieza: docs/demo-5k.md
--
-- Todo ficticio: RFC/placas/teléfonos inventados (teléfonos del rango falso
-- 5215559xxxxxx). Tenant con id FIJO (lo usa demo-5k-limpiar.sql).
--
-- CÓMO CORRERLO: cada bloque `do $$ … $$` es una transacción independiente;
-- se pueden pegar uno por uno en el SQL editor de Supabase (corre como
-- postgres: RLS no aplica) o el archivo entero con psql. Orden obligatorio:
--   1 tenant+terminales+clientes → 2 operadores → 3 unidades →
--   4 viajes (por tramos de días) → 5 gastos (por tramos de n) → liquidaciones (gastos ANTES:
--   trigger trg_gasto_no_tras_liquidar) → viajes del guion (1042/1039/1037/1035).
--
-- CONSTRAINTS RESPETADOS: uq_viaje_abierto_por_operador (un abierto/en_cuadre
-- por operador), viaje_estatus_dominio, viaje_folio_unico, gasto_concepto_dominio
-- (9 conceptos: los 14 del modelo se mapean — ver docs/demo-5k.md),
-- uq_gasto_cfdi_uuid, uq_operador_telefono_activo (global), unidad_estado_dominio,
-- liquidacion_estatus_dominio, liquidacion_viaje_uidx, config_tenant_valida.
-- avisado_en va NULL en los abiertos (el cron de WhatsApp no les escribe).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── BLOQUE 1: tenant, terminales, clientes, tarifas ─────────────────────────
do $$
declare
  t uuid := 'dddddddd-0000-4000-8000-000000005000';
  term text[] := array['MTY','GDL','CDMX','QRO','SLP','PUE','VER','MID','CUN','VSA','TIJ','CJS','NLD','HMO','CUL','LEON','AGS','TOL','TAM','SAL','MZT','OAX','TUX','CHI','DUR'];
  ciud text[] := array['Monterrey, NL','Guadalajara, JAL','Ciudad de México','Querétaro, QRO','San Luis Potosí, SLP','Puebla, PUE','Veracruz, VER','Mérida, YUC','Cancún, QROO','Villahermosa, TAB','Tijuana, BC','Ciudad Juárez, CHIH','Nuevo Laredo, TAMPS','Hermosillo, SON','Culiacán, SIN','León, GTO','Aguascalientes, AGS','Toluca, MEX','Tampico, TAMPS','Saltillo, COAH','Mazatlán, SIN','Oaxaca, OAX','Tuxtla Gutiérrez, CHIS','Chihuahua, CHIH','Durango, DGO'];
  cli text[] := array['Abarrotes del Norte','Súper Peninsular','Panificadora Central','Bebidas del Golfo','Autopartes Bajío','Ensambladora Saltillo','Aceros Monterrey','Cementos del Pacífico','Frutas de Sinaloa','Granos del Bajío','Paquetería Express MX','Farmacéutica Azteca','Lácteos de Jalisco','Vidriería Potosina','Papelera del Centro','Plásticos Industriales de Querétaro','Electrodomésticos del Bajío','Cervecería del Sureste','Textiles de Puebla','Químicos de Coatzacoalcos','Maderas de Durango','Pesquera del Pacífico','Cárnicos de Sonora','Avícola del Centro','Muebles de Ocotlán','Calzado León','Hortalizas de Sinaloa','Fertilizantes del Golfo','Llantas Nacionales','Distribuidora Ferretera MX','Azucarera de Veracruz','Mineral de Zacatecas','Cartón Corrugado del Norte','Refrescos de Occidente','Aceites Comestibles del Bajío','Tiendas La Esquina','Mayorista Tuxtla','Arroz de Morelos','Cementos de Yucatán','Acero Laminado de Coahuila'];
  i int;
begin
  if exists (select 1 from tenant where id = t) then
    raise exception 'TPS ya existe: corre scripts/demo-5k-limpiar.sql primero';
  end if;

  -- OPERABILIDAD-19C2-4 (barrido MEDIO/BAJO): las dos notas de abajo vivían
  -- COMO `--` DENTRO del literal `'{...}'::jsonb` del INSERT — no eran
  -- comentarios SQL de verdad, eran texto crudo metido en medio del JSON,
  -- así que este INSERT moría con un error de sintaxis JSON en cuanto
  -- alguien corría el script. Se mueven aquí, fuera del literal.
  --
  -- (1) "caseta":{"topeMonto":5000} — una línea del estado del TAG por viaje.
  -- (2) AUDITORÍA 19 (fiscal F4): `regimenElegible` decía `true`, pero este
  --     tenant declara `regimen_fiscal='601'` (General de Ley PM) unas
  --     líneas arriba, y `REGIMENES_ELEGIBLES` (administracion.ts) es la
  --     lista CERRADA ['624','612'] — 601 NO califica. El seed afirmaba una
  --     elegibilidad que el motor real nunca produciría para este régimen,
  --     sin que nadie lo validara. Corregido a lo que 601 de verdad da: no
  --     elegible (`"regimenElegible":false`).
  insert into tenant (id, nombre, rfc, ciudad, plan, razon_social, domicilio_fiscal,
                      url_aviso_privacidad, contacto_privacidad, regimen_fiscal,
                      codigo_postal_fiscal, uso_cfdi, config)
  values (t, 'Transportes Peninsulares, S.A. de C.V.', 'TPE150812AB3', 'Monterrey, NL', 'demo',
          'TRANSPORTES PENINSULARES SA DE CV',
          'Av. Ruiz Cortines 3200, Parque Industrial Apodaca, 66600 Apodaca, Nuevo León',
          'https://app.likida.ai/aviso/' || t, 'privacidad@tps-demo.mx', '601', '66600', 'G03',
          '{"empresa":{"rfc":"TPE150812AB3"},
            "politica":[{"concepto":"diesel","topeMonto":4000,"requiereCfdi":true},
                        {"concepto":"caseta","topeMonto":5000},
                        {"concepto":"alimentacion","topeMonto":450},
                        {"concepto":"viaticos","topeMonto":450},
                        {"concepto":"hospedaje","topeMonto":900,"requiereCfdi":true},
                        {"concepto":"transporte","topeMonto":800},
                        {"concepto":"flete"},
                        {"concepto":"factura","requiereCfdi":true},
                        {"concepto":"otro","topeMonto":1500}],
            "tabulador":{"rendimientoPorDefecto":2.2,"precioDieselPorDefecto":24,"umbralDesviacion":0.06},
            "estimulos":{"efectivoTopeMxn":2000,"viaticosTopeFiscalDiarioMxn":750},
            "facilidadCombustibleEfectivo":{"dedicacionExclusivaCarga":true,"regimenElegible":false}}'::jsonb);

  for i in 1..25 loop
    insert into terminal (id, tenant_id, nombre, ciudad)
    values (('dddddddd-0001-4000-8000-' || lpad(i::text, 12, '0'))::uuid, t, term[i], ciud[i]);
  end loop;

  for i in 1..40 loop
    insert into cliente (id, tenant_id, nombre, rfc, contacto, correo, telefono, dias_credito, activo)
    values (('dddddddd-0002-4000-8000-' || lpad(i::text, 12, '0'))::uuid, t, cli[i],
            'C' || upper(substr(md5(cli[i]), 1, 2)) || lpad((150101 + i * 317)::text, 6, '0') || chr(65 + i % 26) || (i % 10)::text,
            (array['Lic. Mariana Solís','Ing. Roberto Ayala','C.P. Lucía Treviño','Lic. Gerardo Ponce','Ing. Daniela Robles'])[1 + i % 5],
            'logistica' || i || '@' || lower(regexp_replace(split_part(cli[i], ' ', 1), '[^A-Za-z]', '', 'g')) || '-demo.mx',
            '5215559' || lpad((900000 + i)::text, 6, '0'), (array[15, 30, 30, 45, 60])[1 + i % 5], true);
    -- tarifa por km por cliente ($28–$42/km)
    insert into tarifa (tenant_id, cliente_id, modo, precio, moneda, vigente_desde, activa)
    values (t, ('dddddddd-0002-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'por_km',
            28 + ((i * 7) % 15), 'MXN', date '2026-01-01', true);
  end loop;
  raise notice 'TPS: tenant, 25 terminales, 40 clientes, 40 tarifas';
end $$;

-- ── BLOQUE 2: ~7,500 operadores ──────────────────────────────────────────────
do $$
declare
  t uuid := 'dddddddd-0000-4000-8000-000000005000';
  nom text[] := array['José Luis','Juan Carlos','Miguel Ángel','Francisco','Jesús','Antonio','Alejandro','Roberto','Pedro','Ricardo','Fernando','Jorge','Manuel','Luis Alberto','Rafael','Armando','Gerardo','Arturo','Ramón','Sergio','Eduardo','Raúl','Javier','Óscar','Víctor Manuel','Martín','Salvador','Alfredo','Enrique','Guadalupe','Rubén','Andrés','Marco Antonio','Gustavo','Felipe','Ernesto','Julio César','Adrián','Héctor','Daniel','Israel','Ignacio','Rogelio','Alberto','Cristian','Mario','Noé','Abel','Rodolfo','Santiago','Tomás','Ulises','Benjamín','Esteban','Gabriel','Hugo','Iván','Leonardo','Moisés','Omar'];
  ap text[] := array['Hernández','García','Martínez','López','González','Pérez','Rodríguez','Sánchez','Ramírez','Cruz','Flores','Gómez','Morales','Vázquez','Reyes','Jiménez','Torres','Díaz','Gutiérrez','Ruiz','Mendoza','Aguilar','Ortiz','Castillo','Romero','Chávez','Rivera','Juárez','Ramos','Domínguez','Herrera','Medina','Castro','Vargas','Guzmán','Méndez','Salazar','Ortega','Delgado','Cortés','Santiago','Guerrero','Luna','Moreno','Rojas','Contreras','Estrada','Cervantes','Espinoza','Lara','Alvarado','Ibarra','Navarro','Cabrera','Peña','Soto','Trejo','Zamora','Villanueva','Cano','Maldonado','Padilla','Canul','Pech','Dzul','Couoh','Tun','Uc','Chan','May','Balam','Ek','Poot','Cauich','Chi','Koh','Noh','Puc','Tamayo','Treviño','Elizondo','Garza','Villarreal','Cantú','Zepeda'];
begin
  insert into operador (id, tenant_id, terminal_id, nombre, telefono, numero_empleado, activo,
                        licencia, licencia_tipo, licencia_vence, created_at, aviso_privacidad_en, aviso_privacidad_version)
  select
    ('dddddddd-0003-4000-8000-' || lpad(i::text, 12, '0'))::uuid, t,
    ('dddddddd-0001-4000-8000-' || lpad((1 + (i * 7) % 25)::text, 12, '0'))::uuid,
    nom[1 + (i * 13) % 60] || ' ' || ap[1 + (i * 31) % 85] || ' ' || ap[1 + (i * 17 + 5) % 85],
    '5215559' || lpad(i::text, 6, '0'),
    'OP-' || lpad(i::text, 5, '0'),
    (i % 25) <> 0,                                  -- 96 % activos
    'E' || lpad((31000000 + i * 53)::text, 8, '0'), 'E',
    date '2026-09-01' + ((i * 37) % 1100),          -- vence 2026–2029
    now() - ((i * 29) % 8000) * interval '1 day' - (i % 24) * interval '1 hour',   -- antigüedad 0–22 años
    now() - ((i * 11) % 200) * interval '1 day', 'v3'
  from generate_series(1, 7500) i;
  raise notice 'TPS: % operadores', (select count(*) from operador where tenant_id = t);
end $$;

-- ── BLOQUE 3: 5,000 unidades ─────────────────────────────────────────────────
do $$
declare
  t uuid := 'dddddddd-0000-4000-8000-000000005000';
  term text[] := array['MTY','GDL','CDMX','QRO','SLP','PUE','VER','MID','CUN','VSA','TIJ','CJS','NLD','HMO','CUL','LEON','AGS','TOL','TAM','SAL','MZT','OAX','TUX','CHI','DUR'];
begin
  insert into unidad (id, tenant_id, numero_economico, placas, marca, modelo, anio, estado, km_actual,
                      poliza_vence, permiso_sict_vence, verificacion_vence, activo, config_vehicular,
                      peso_bruto_ton, aseguradora_rc, poliza_rc_numero, permiso_sict_tipo, permiso_sict_numero, creada_en)
  select
    ('dddddddd-0004-4000-8000-' || lpad(i::text, 12, '0'))::uuid, t,
    'T-' || lpad(i::text, 4, '0'),
    chr(65 + (i * 7) % 26) || chr(65 + (i * 11) % 26) || chr(65 + (i * 3) % 26) || '-' || lpad(((i * 4931) % 10000)::text, 4, '0') || '-A',
    case when i % 20 < 12 then 'Kenworth' when i % 20 < 17 then 'Freightliner' when i % 20 < 19 then 'International' else 'Volvo' end,
    case when i % 20 < 8 then 'T680' when i % 20 < 11 then 'T880' when i % 20 < 12 then 'T660'
         when i % 20 < 16 then 'Cascadia' when i % 20 < 17 then 'M2 112'
         when i % 20 < 19 then 'LT625' else 'VNL 760' end,
    2014 + ((i * 7 + (i / 7)) % 13),
    case when i % 100 < 5 then 'taller' when i % 100 < 8 then 'disponible' else 'en_ruta' end,
    80000 + ((i * 7919) % 1320000),
    date '2026-08-22' + ((i * 13) % 365), date '2026-08-22' + ((i * 17) % 730), date '2026-08-22' + ((i * 19) % 180),
    true, 'T3S2', 46.5, (array['Qualitas','GNP','HDI Seguros','AXA','Chubb'])[1 + i % 5],
    'RC-' || lpad((2026000000 + i * 61)::text, 10, '0'), 'TPAF', 'SICT-' || lpad((400000 + i)::text, 7, '0'),
    now() - ((i * 23) % 4000) * interval '1 day'
  from generate_series(1, 5000) i;
  raise notice 'TPS: % unidades', (select count(*) from unidad where tenant_id = t);
end $$;

-- ── BLOQUE 4: viajes ─────────────────────────────────────────────────────────
-- VOLUMEN: `por_dia` entre semana y `domingo`. Con 970/580 salen ~27,500
-- viajes en 30 días y ~90,000 gastos — A PROPÓSITO por debajo del techo de
-- `traerTodo` (100,000 filas por tabla, src/lib/likida/pg.ts:48): con más
-- gastos, /combustible-casetas, /rentabilidad, /operadores y el motor fiscal
-- del inicio LANZAN «lectura incompleta» en vez de pintar cifras
-- (docs/escala-15k.md §6). Para 70,000 viajes pon 2,540/1,000 y acepta ese
-- error, o agrega en SQL esas lecturas (como la 0112).
--
-- Se corre UNA vez por cada tramo de días `d0..d1` (d = días antes de hoy):
-- p.ej. (29,20), (19,10), (9,2), (1,0). El último tramo trae los ABIERTOS.
-- Cada viaje n lleva folio TPS-YYMM-nnnnnn (n global = d*3000 + k) y se
-- reparte sobre 60 corredores reales (×2 sentidos), los locales repetidos
-- para pesar ~25 %.
do $$
declare
  t uuid := 'dddddddd-0000-4000-8000-000000005000';
  d0 int := 29; d1 int := 20;            -- ← EDITAR por tramo
  por_dia int := 970; domingo int := 580;
  hoy date := current_date;
  -- corredores: origen, destino (índice de terminal 1..25), km, casetas aprox.
  co int[] := array[1,2,7,8,3,13,11,5,10,12, 1,1,1,1,1,2,2,2,2,2, 3,3,3,3,3,3,3,3,4,4, 4,6,7,5,10,10,6,23,14,15, 15,25,25,20,24,24,12,13,13,19, 19,17,16,18,6,9,8,3,11,1, 1,3,3,16,2,17,4,20,12,1];
  cd int[] := array[4,3,6,9,8,3,14,1,7,24, 20,13,19,3,2,16,17,21,15,11, 4,6,18,7,22,5,16,17,5,16, 2,22,19,2,23,8,4,22,15,21, 25,21,20,24,25,14,1,20,2,5, 3,5,17,2,10,10,7,23,15,18, 20,18,23,17,16,16,16,1,24,4];
  km int[] := array[700,540,280,310,1310,1170,900,520,480,370, 85,230,520,900,780,220,230,470,690,2200, 215,130,65,400,460,420,390,500,200,175, 350,340,500,350,300,560,330,550,690,220, 330,230,480,630,700,750,1150,320,1000,420, 500,170,120,500,600,870,1000,800,1430,870, 85,65,130,120,220,120,175,85,370,215];
  ca int[] := array[2900,2300,900,1100,4800,4600,1900,2200,1600,800, 250,900,1500,3600,3100,700,750,1800,2400,5200, 700,450,200,1400,1500,1500,1300,1700,650,550, 1300,1100,1200,1300,600,1500,1100,900,1500,700, 900,800,1300,1700,1500,1200,3200,1200,4000,1300, 1900,500,350,2100,1800,2600,3100,2400,3000,3400, 250,200,450,350,700,350,550,250,800,700];
  ciud text[] := array['Monterrey, NL','Guadalajara, JAL','Ciudad de México','Querétaro, QRO','San Luis Potosí, SLP','Puebla, PUE','Veracruz, VER','Mérida, YUC','Cancún, QROO','Villahermosa, TAB','Tijuana, BC','Ciudad Juárez, CHIH','Nuevo Laredo, TAMPS','Hermosillo, SON','Culiacán, SIN','León, GTO','Aguascalientes, AGS','Toluca, MEX','Tampico, TAMPS','Saltillo, COAH','Mazatlán, SIN','Oaxaca, OAX','Tuxtla Gutiérrez, CHIS','Chihuahua, CHIH','Durango, DGO'];
  ncorr int := 70;
  abiertos_desde int := 1;               -- los viajes con d <= 1 salen abiertos/en_cuadre
begin
  insert into viaje (id, tenant_id, operador_id, terminal_id, unidad_id, cliente_id, folio, origen, destino,
                     anticipo, fecha_inicio, fecha_fin, estatus, created_at, avisado_en, aceptado_en, escalado_en,
                     avisos_enviados, intake_pendientes, km_recorridos, ingreso_flete, llegada_en, descarga_en, regreso_en)
  select
    ('dddddddd-0005-4000-8000-' || lpad(v.n::text, 12, '0'))::uuid, t,
    ('dddddddd-0003-4000-8000-' || lpad(v.op::text, 12, '0'))::uuid,
    ('dddddddd-0001-4000-8000-' || lpad(v.o::text, 12, '0'))::uuid,
    case when v.abierto and v.r1 < 0.12 then null
         else ('dddddddd-0004-4000-8000-' || lpad((1 + (v.n * 37) % 5000)::text, 12, '0'))::uuid end,
    ('dddddddd-0002-4000-8000-' || lpad((1 + (v.n * 11 + v.d) % 40)::text, 12, '0'))::uuid,
    'TPS-' || to_char(v.fecha, 'YYMM') || '-' || lpad(v.n::text, 6, '0'),
    ciud[v.o], ciud[v.de],
    v.anticipo, v.fecha,
    case when v.abierto then null else v.fecha + v.dias end,
    case when not v.abierto then 'liquidado' when v.r2 < 0.08 then 'en_cuadre' else 'abierto' end,
    v.creado,
    case when v.abierto then null else v.creado + interval '3 minutes' end,
    case when v.abierto or v.r3 < 0.08 then null else v.creado + (5 + (v.n % 40)) * interval '1 minute' end,
    case when v.abierto and v.r3 < 0.015 then v.creado + interval '2 hours' else null end,
    case when v.abierto then 0 when v.r3 < 0.08 then 3 else 1 end,
    case when v.abierto and v.r1 > 0.94 then 1 + (v.n % 3) else 0 end,
    v.kmr,
    round(v.kmr * (28 + ((1 + (v.n * 11 + v.d) % 40) * 7) % 15) * (0.97 + v.r1 * 0.08))::numeric(12,2),
    case when v.abierto then null else v.creado + v.dias * interval '1 day' - interval '6 hours' end,
    case when v.abierto then null else v.creado + v.dias * interval '1 day' - interval '3 hours' end,
    case when v.abierto then null else v.creado + v.dias * interval '1 day' end
  from (
    select *,
      greatest(1, ceil(kmx / 550.0))::int as dias,
      -- anticipo: diésel estimado (km/2.3 × $23.60) + casetas + viáticos $450/día (+ maniobras 25 %), a $100
      (round((kmx / 2.3 * 23.6 + casx + 450 * greatest(1, ceil(kmx / 550.0)) + case when r2 < 0.25 then 600 else 0 end) / 100) * 100)::numeric(12,2) as anticipo,
      round(kmx * (0.97 + r1 * 0.09))::int as kmr,
      (fecha::timestamptz + interval '5 hours' + (k * 41 % 840) * interval '1 minute') as creado
    from (
      select n, d, k, fecha, abierto, r1, r2, r3,
        case when flip then co[c] else cd[c] end as o,
        case when flip then cd[c] else co[c] end as de,
        km[c] as kmx, ca[c] as casx,
        -- operador: los abiertos SIN repetir (salta los inactivos, múltiplos de 25); los demás rotan
        case when abierto then ((k + (1 - d) * 1100) + ((k + (1 - d) * 1100) - 1) / 24) else 1 + (n * 7 + d * 131) % 7500 end as op
      from (
        select n, d, k, fecha, abierto, c, flip, r1, r2, r3
        from (
          select dd.d, kk.k, dd.fecha, (dd.d <= abiertos_desde) as abierto,
                 (dd.d * 3000 + kk.k) as n,
                 1 + floor(random() * ncorr)::int as c, random() < 0.5 as flip,
                 random() as r1, random() as r2, random() as r3
          from (select d, (hoy - d) as fecha from generate_series(d1, d0) d) dd
          cross join lateral generate_series(1, case when extract(dow from dd.fecha) = 0 then domingo else por_dia end) kk(k)
        ) z
      ) y
    ) x
  ) v;
  raise notice 'TPS viajes tramo %-%: %', d0, d1, (select count(*) from viaje where tenant_id = t);
end $$;

-- NOTA sobre `n`: el número de viaje va en los 12 últimos dígitos de su uuid
-- (dddddddd-0005-4000-8000-000000nnnnnn). Se extrae con regexp+bigint y NUNCA
-- con ::int a secas: el planificador puede evaluar la expresión sobre filas de
-- OTRO tenant (uuid aleatorio) antes de aplicar el filtro de tenant y truena.
-- ── BLOQUE 5: gastos (ANTES de las liquidaciones — trigger 0036) ─────────────
-- Se corre una vez por tramo de viajes `n0..n1` (n = número global del folio,
-- columna 5 del uuid del viaje; p.ej. 0–30000, 30001–60000, 60001–90000).
-- Conceptos del modelo (14) → dominio real (9):
--   diésel→diesel · casetas→caseta · viáticos/alimentos→alimentacion ·
--   hospedaje→hospedaje · refacción/grúa/custodia (con CFDI)→factura ·
--   maniobras, pensión, báscula, lavado, telefonía, permisos, multa→otro
--   (el detalle va en ocr_extra.detalle y en el folio).
do $$
declare
  t uuid := 'dddddddd-0000-4000-8000-000000005000';
  n0 int := 0; n1 int := 30000;          -- ← EDITAR por tramo
  rfc_est text[] := array['PEM870101AB1','GDO020515KL3','OXX970101HJ2','ESG150410QW8','CRE010203RT5','GAS990909MN4','HID120512PL7','ORS080808ZX1','ESP160301BV6','FUL140707CD9','PET050505EF2','ARC171111GH0'];
  est_nom text[] := array['Estación Pemex Carretera','G500 Autopista','Oxxo Gas','Energéticos del Golfo','Corpogas','Gasolineras del Norte','Hidrosina','Orsan','Estaciones del Pacífico','Full Gas','Petro Servicio Bajío','Arco Autoservicio'];
begin
  -- 1) diésel: 1–3 cargas, ~8 % de viajes con una carga sobre el tope de $4,000
  insert into gasto (tenant_id, viaje_id, concepto, monto, fecha, folio, cfdi_uuid, rfc_emisor, rfc_receptor,
                     estado_sat, efos, efos_revisar, clave_prod_serv, clave_unidad, tipo_comprobante,
                     complemento_hidrocarburos, xml_verificado, forma_pago, sub_total, ieps_traslado, iva_traslado,
                     ocr_confianza, ocr_extra, created_at)
  select
    t, g.viaje_id, 'diesel', g.monto, g.fecha,
    'DS-' || lpad(((g.n * 7 + g.k * 1009) % 900000 + 100000)::text, 6, '0'),
    case when g.con_cfdi then md5('tps-ds-' || g.n || '-' || g.k)::uuid::text end,
    rfc_est[1 + (g.n + g.k) % 12], 'TPE150812AB3',
    case when not g.con_cfdi then null when g.r < 0.004 then 'cancelado' when g.r < 0.014 then 'pendiente' else 'vigente' end,
    case when g.con_cfdi and g.r > 0.998 then true else false end,
    case when g.con_cfdi and g.r > 0.995 and g.r <= 0.998 then true else false end,
    '15101505', 'LTR', 'I', g.con_cfdi,
    case when g.con_cfdi then g.r2 < 0.92 else null end,
    case when g.r2 < 0.25 then '01' when g.r2 < 0.80 then '04' else '28' end,
    round((g.monto / 1.16 - g.litros * 6.174)::numeric, 2), round((g.litros * 6.174)::numeric, 2), round((g.monto - g.monto / 1.16)::numeric, 2),
    round((0.86 + g.r * 0.13)::numeric, 2),
    jsonb_build_object('litros', round(g.litros::numeric, 2), 'precioLitro', 23.60, 'estacion', est_nom[1 + (g.n + g.k) % 12]),
    g.creado
  from (
    select v.id as viaje_id, v.n, s.k,
      v.fecha_inicio + least(s.k - 1, v.dias - 1) as fecha,
      v.created_at + (s.k - 1) * interval '9 hours' + interval '40 minutes' as creado,
      round(((v.total_diesel / v.cargas) * (case when v.sobre and s.k = 1 then 1.0 else (0.96 + random() * 0.04) end))::numeric, 2) as monto,
      (v.total_diesel / v.cargas) / 23.6 as litros,
      random() > 0.05 as con_cfdi, random() as r, random() as r2
    from (
      select id, n, fecha_inicio, created_at, km_recorridos, sobre,
        greatest(1, ceil(km_recorridos / 550.0))::int as dias,
        total_diesel,
        case when sobre then greatest(1, ceil(total_diesel / 4400.0)) else greatest(1, ceil(total_diesel / 3900.0)) end::int as cargas
      from (
        select id, (regexp_replace(substring(id::text from 25), '\D', '', 'g'))::bigint as n, fecha_inicio, created_at, km_recorridos,
               km_recorridos / 2.3 * 23.6 * (0.92 + random() * 0.18) as total_diesel,
               random() < 0.08 as sobre
        from viaje where tenant_id = t and (regexp_replace(substring(id::text from 25), '\D', '', 'g'))::bigint between n0 and n1
      ) a
    ) v
    cross join lateral generate_series(1, v.cargas) s(k)
  ) g;

  -- 2) casetas: 90 % de los viajes con peaje; una línea (estado del TAG) o ticket en efectivo
  insert into gasto (tenant_id, viaje_id, concepto, monto, fecha, folio, cfdi_uuid, rfc_emisor, rfc_receptor,
                     estado_sat, clave_prod_serv, clave_unidad, tipo_comprobante, xml_verificado, forma_pago,
                     sub_total, iva_traslado, ocr_confianza, ocr_extra, created_at)
  select
    t, g.viaje_id, 'caseta', g.monto, g.fecha,
    case when g.tag then 'IAVE-' || to_char(g.fecha, 'YYMM') || '-' || lpad((g.n % 99999)::text, 5, '0') else 'CAS-' || lpad(((g.n * 13) % 900000 + 100000)::text, 6, '0') end,
    case when g.con_cfdi then md5('tps-ca-' || g.n)::uuid::text end,
    case when g.tag then 'CAP0102055J6' else 'PCA120101RT8' end, 'TPE150812AB3',
    case when g.con_cfdi then 'vigente' end,
    '95111602', 'E48', 'I', case when g.con_cfdi then g.r < 0.93 end,
    case when g.tag then '03' else '01' end,
    round(g.monto / 1.16, 2), round(g.monto - g.monto / 1.16, 2),
    round((0.88 + g.r * 0.11)::numeric, 2),
    jsonb_build_object('tag', g.tag, 'proveedor', case when g.tag then (array['IAVE','PASE','TeleVía'])[1 + g.n % 3] else 'CAPUFE' end),
    g.creado
  from (
    select v.id as viaje_id, v.n, v.fecha_inicio as fecha, v.created_at + interval '5 hours' as creado,
      round((v.casetas * (0.9 + random() * 0.18))::numeric, 2) as monto,
      tag, case when tag then random() < 0.80 else random() < 0.50 end as con_cfdi, random() as r
    from (
      select v.id, (regexp_replace(substring(v.id::text from 25), '\D', '', 'g'))::bigint as n, v.fecha_inicio, v.created_at,
             -- casetas ≈ anticipo − diésel estimado − viáticos (cuadra con el tabulador del corredor)
             greatest(200, v.anticipo - v.km_recorridos / 2.3 * 23.6 - 450 * greatest(1, ceil(v.km_recorridos / 550.0))) as casetas,
             random() < 0.70 as tag, random() as r0
      from viaje v where v.tenant_id = t and (regexp_replace(substring(v.id::text from 25), '\D', '', 'g'))::bigint between n0 and n1
    ) v where v.r0 < 0.90
  ) g;

  -- 3) alimentación (40 %), hospedaje (8 %, ruta larga), factura (5 %: refacción/grúa/custodia), otro (35 %)
  insert into gasto (tenant_id, viaje_id, concepto, monto, fecha, folio, cfdi_uuid, rfc_emisor, rfc_receptor,
                     estado_sat, tipo_comprobante, xml_verificado, forma_pago, sub_total, iva_traslado,
                     ocr_confianza, ocr_extra, created_at)
  select
    t, g.viaje_id, g.concepto, g.monto, g.fecha,
    upper(substr(g.concepto, 1, 2)) || '-' || lpad(((g.n * 31 + g.k * 7) % 900000 + 100000)::text, 6, '0'),
    case when g.con_cfdi then md5('tps-ot-' || g.n || '-' || g.k)::uuid::text end,
    case when g.con_cfdi then (array['RES120101AB1','HOT150202CD2','TAL160303EF3','GRU170404GH4','SEG180505IJ5','MAN190606KL6'])[1 + (g.n + g.k) % 6] end,
    'TPE150812AB3',
    case when g.con_cfdi then 'vigente' end, 'I', case when g.con_cfdi then g.r < 0.9 end,
    g.forma_pago, round(g.monto / 1.16, 2), round(g.monto - g.monto / 1.16, 2),
    round((0.80 + g.r * 0.19)::numeric, 2),
    jsonb_build_object('detalle', g.detalle), g.creado
  from (
    select v.id as viaje_id, v.n, x.k, v.fecha_inicio + (x.k % greatest(1, v.dias)) as fecha,
      v.created_at + (6 + x.k * 7) * interval '1 hour' as creado,
      x.concepto, x.detalle,
      round(x.monto::numeric, 2) as monto, x.con_cfdi, x.forma_pago, random() as r
    from (
      select id, (regexp_replace(substring(id::text from 25), '\D', '', 'g'))::bigint as n, fecha_inicio, created_at,
             greatest(1, ceil(km_recorridos / 550.0))::int as dias, random() as ra, random() as rh, random() as rf, random() as ro
      from viaje where tenant_id = t and (regexp_replace(substring(id::text from 25), '\D', '', 'g'))::bigint between n0 and n1
    ) v
    cross join lateral (
      select 1 as k, 'alimentacion' as concepto, 'alimentos en ruta' as detalle,
             case when random() < 0.02 then 2100 + random() * 600 else 150 + random() * 300 end as monto,
             random() < 0.30 as con_cfdi, '01' as forma_pago where v.ra < 0.40
      union all
      select 2, 'hospedaje', 'hotel de paso', 450 + random() * 450, random() < 0.85, case when random() < 0.5 then '01' else '04' end where v.dias >= 2 and v.rh < 0.20
      union all
      select 3, 'factura', (array['refacción en ruta','grúa / auxilio vial','custodia de carga'])[1 + (v.n % 3)],
             case v.n % 3 when 0 then 800 + random() * 5700 when 1 then 4000 + random() * 14000 else 3500 + random() * 8500 end,
             random() < 0.80, case when v.n % 3 = 0 then '01' else '03' end where v.rf < 0.05
      union all
      select 4, 'otro', (array['maniobras carga/descarga','pensión / estacionamiento','báscula','lavado y engrasado','telefonía','permiso / sobrepeso','multa'])[1 + (v.n % 7)],
             (array[300 + random() * 1200, 80 + random() * 170, 60 + random() * 90, 250 + random() * 350, 50 + random() * 250, 500 + random() * 2500, 1200 + random() * 7800])[1 + (v.n % 7)],
             (array[random() < 0.4, random() < 0.5, random() < 0.6, random() < 0.7, random() < 0.2, random() < 0.5, false])[1 + (v.n % 7)],
             '01' where v.ro < 0.35
    ) x
  ) g;
  raise notice 'TPS gastos tramo %-%: %', n0, n1, (select count(*) from gasto where tenant_id = t);
end $$;

-- ── BLOQUE 5b: ajustes sobre gastos (ANTES de liquidar) ──────────────────────
-- Margen bajo el techo de traerTodo: se quitan los gastos menores (telefonía,
-- báscula) y se siembran 14 CFDI repetidos entre dos viajes (detectarAnomalias).
delete from gasto where tenant_id='dddddddd-0000-4000-8000-000000005000'
  and concepto='otro' and (ocr_extra->>'detalle') in ('telefonía','báscula');
with src as (
  select g.id, g.cfdi_uuid, row_number() over (order by g.id) rn
  from gasto g where g.tenant_id='dddddddd-0000-4000-8000-000000005000' and g.concepto='diesel' and g.cfdi_uuid is not null
    and g.viaje_id in (select id from viaje where tenant_id='dddddddd-0000-4000-8000-000000005000' and estatus='liquidado' and fecha_inicio between current_date-12 and current_date-10)
  limit 14
), dst as (
  select g.id, row_number() over (order by g.id) rn
  from gasto g where g.tenant_id='dddddddd-0000-4000-8000-000000005000' and g.concepto='diesel' and g.cfdi_uuid is not null
    and g.viaje_id in (select id from viaje where tenant_id='dddddddd-0000-4000-8000-000000005000' and estatus='liquidado' and fecha_inicio between current_date-9 and current_date-8)
  limit 14
)
update gasto g set cfdi_uuid = src.cfdi_uuid, cfdi_orden = 2, xml_verificado = false
from src join dst on dst.rn = src.rn where g.id = dst.id;

-- ~7 % de los viajes con UNA carga de diésel sobre el tope ($4,050–4,600):
-- el reparto en cargas de arriba rara vez lo produce solo.
with pick as (
  select distinct on (g.viaje_id) g.id
  from gasto g join viaje v on v.id = g.viaje_id
  where g.tenant_id='dddddddd-0000-4000-8000-000000005000' and g.concepto='diesel' and g.monto <= 4000
    and v.tenant_id='dddddddd-0000-4000-8000-000000005000'
    and (regexp_replace(substring(v.id::text from 25), '\D', '', 'g'))::bigint % 14 = 3
  order by g.viaje_id, g.created_at
)
update gasto g set monto = m.monto, sub_total = round(m.monto / 1.16 - (m.monto / 23.6) * 6.174, 2),
  ieps_traslado = round((m.monto / 23.6) * 6.174, 2), iva_traslado = round(m.monto - m.monto / 1.16, 2),
  ocr_extra = jsonb_set(ocr_extra, '{litros}', to_jsonb(round(m.monto / 23.6, 2)))
from (select id, round((4050 + random() * 550)::numeric, 2) as monto from pick) m where g.id = m.id;

-- ── BLOQUE 6: liquidaciones (97 % de los liquidados) ─────────────────────────
-- Una por viaje 'liquidado' salvo 1 de cada 33 (liquidado sin liquidación, legal).
-- comprobado = suma de gastos; diferencia = anticipo − comprobado; el JSON de
-- diferencias sigue la forma de src/types/likida.ts (tipo, monto, nota, …):
-- sobre_politica cuando un gasto pasa el tope de tenant.config.politica, y
-- sin_cfdi (monto 0, como el motor) cuando diésel/hospedaje/factura no trae CFDI.
do $$
declare
  t uuid := 'dddddddd-0000-4000-8000-000000005000';
begin
  -- viajes que "regresarían" después de hoy se cierran hoy
  update viaje set fecha_fin = least(fecha_fin, current_date),
                   regreso_en = least(regreso_en, now() - interval '3 hours'),
                   llegada_en = least(llegada_en, now() - interval '6 hours'),
                   descarga_en = least(descarga_en, now() - interval '4 hours')
  where tenant_id = t and estatus = 'liquidado' and fecha_fin > current_date;

  insert into liquidacion (tenant_id, viaje_id, total_comprobado, total_anticipo, diferencia, estatus, diferencias,
                           created_at, iva_acreditable, ieps_acreditable, peaje_acreditable, litros_diesel_acreditables)
  select
    t, v.id, g.comprobado, v.anticipo, v.anticipo - g.comprobado,
    case when g.n_sobre > 0 then 'con_diferencias'
         when g.n_sin > 0 or g.n_cancel > 0 then 'revisar'
         else 'cuadrada' end,
    coalesce(g.difs, '[]'::jsonb),
    least(v.regreso_en + interval '2 hours' + (v.n % 17) * interval '50 minutes', now() - interval '20 minutes'),
    g.iva, g.ieps, g.peaje, g.litros
  from (
    select id, anticipo, regreso_en, (regexp_replace(substring(id::text from 25), '\D', '', 'g'))::bigint as n
    from viaje where tenant_id = t and estatus = 'liquidado'
  ) v
  join lateral (
    select
      coalesce(sum(monto), 0)::numeric(12,2) as comprobado,
      count(*) filter (where sobre) as n_sobre,
      count(*) filter (where sin_cfdi) as n_sin,
      count(*) filter (where estado_sat = 'cancelado') as n_cancel,
      coalesce(sum(iva_traslado) filter (where cfdi_uuid is not null and estado_sat = 'vigente'), 0)::numeric(12,2) as iva,
      coalesce(sum(ieps_traslado) filter (where concepto = 'diesel' and cfdi_uuid is not null and estado_sat = 'vigente'), 0)::numeric(12,2) as ieps,
      coalesce(0.5 * sum(monto) filter (where concepto = 'caseta' and cfdi_uuid is not null), 0)::numeric(12,2) as peaje,
      coalesce(sum((ocr_extra->>'litros')::numeric) filter (where concepto = 'diesel' and cfdi_uuid is not null and estado_sat = 'vigente'), 0)::numeric(12,3) as litros,
      jsonb_agg(
        case when sobre then jsonb_build_object('tipo', 'sobre_politica', 'concepto', concepto, 'esperado', tope, 'real', monto,
                                                'monto', round(monto - tope, 2), 'gastoId', gid,
                                                'nota', initcap(concepto) || ' excede el tope de $' || tope || ' por $' || round(monto - tope, 2))
             else jsonb_build_object('tipo', 'sin_cfdi', 'concepto', concepto, 'real', monto, 'monto', 0, 'gastoId', gid,
                                     'nota', initcap(concepto) || ' de $' || monto || ' sin CFDI (folio ' || folio || ')') end
        order by gid
      ) filter (where sobre or sin_cfdi) as difs
    from (
      select g.id as gid, g.concepto, g.monto, g.folio, g.cfdi_uuid, g.estado_sat, g.iva_traslado, g.ieps_traslado, g.ocr_extra,
        case g.concepto when 'diesel' then 4000 when 'caseta' then 5000 when 'alimentacion' then 450 when 'hospedaje' then 900 when 'otro' then 1500 end as tope,
        g.monto > case g.concepto when 'diesel' then 4000 when 'caseta' then 5000 when 'alimentacion' then 450 when 'hospedaje' then 900 when 'otro' then 1500 else 999999 end as sobre,
        (g.cfdi_uuid is null and g.concepto in ('diesel', 'hospedaje', 'factura')) as sin_cfdi
      from gasto g where g.viaje_id = v.id
    ) x
  ) g on true
  where v.n % 33 <> 0;
  raise notice 'TPS liquidaciones: %', (select count(*) from liquidacion where tenant_id = t);
end $$;

-- ── BLOQUE 7: los viajes del guion del video (1042 / 1039 / 1037 / 1035) ──────
-- Van HASTA ARRIBA de /dashboard/viajes (created_at más reciente). 1042 es el
-- del simulador: anticipo $10,600; diésel $4,200 (sobre tope $4,000) + diésel
-- $3,800 + caseta $1,400 + factura CFDI $1,200 = $10,600; liquidado hoy con la
-- única diferencia sobre_politica de $200.
do $$
declare
  t uuid := 'dddddddd-0000-4000-8000-000000005000';
  v1042 uuid := 'dddddddd-0006-4000-8000-000000001042';
  v1039 uuid := 'dddddddd-0006-4000-8000-000000001039';
  v1037 uuid := 'dddddddd-0006-4000-8000-000000001037';
  v1035 uuid := 'dddddddd-0006-4000-8000-000000001035';
  op text := 'dddddddd-0003-4000-8000-';
begin
  insert into viaje (id, tenant_id, operador_id, terminal_id, unidad_id, cliente_id, folio, origen, destino, anticipo,
                     fecha_inicio, fecha_fin, estatus, created_at, avisado_en, aceptado_en, avisos_enviados,
                     km_recorridos, ingreso_flete, llegada_en, descarga_en, regreso_en) values
    (v1042, t, (op || '000000007101')::uuid, 'dddddddd-0001-4000-8000-000000000001', 'dddddddd-0004-4000-8000-000000001042', 'dddddddd-0002-4000-8000-000000000007',
     '1042', 'Monterrey, NL', 'Querétaro, QRO', 10600, current_date - 2, current_date, 'liquidado', now() - interval '10 minutes',
     (current_date - 2)::timestamptz + interval '6 hours', (current_date - 2)::timestamptz + interval '6 hours 12 minutes', 1,
     704, 26752, now() - interval '9 hours', now() - interval '7 hours', now() - interval '3 hours'),
    (v1039, t, (op || '000000007102')::uuid, 'dddddddd-0001-4000-8000-000000000002', 'dddddddd-0004-4000-8000-000000001039', 'dddddddd-0002-4000-8000-000000000013',
     '1039', 'Guadalajara, JAL', 'Ciudad de México', 8400, current_date - 2, current_date - 1, 'liquidado', now() - interval '25 minutes',
     (current_date - 2)::timestamptz + interval '5 hours', (current_date - 2)::timestamptz + interval '5 hours 9 minutes', 1,
     543, 19005, now() - interval '30 hours', now() - interval '28 hours', now() - interval '26 hours'),
    (v1037, t, (op || '000000007103')::uuid, 'dddddddd-0001-4000-8000-000000000007', 'dddddddd-0004-4000-8000-000000001037', 'dddddddd-0002-4000-8000-000000000004',
     '1037', 'Veracruz, VER', 'Puebla, PUE', 6200, current_date - 1, current_date - 1, 'liquidado', now() - interval '40 minutes',
     (current_date - 1)::timestamptz + interval '5 hours', (current_date - 1)::timestamptz + interval '5 hours 5 minutes', 1,
     282, 9870, now() - interval '22 hours', now() - interval '21 hours', now() - interval '20 hours'),
    (v1035, t, (op || '000000007104')::uuid, 'dddddddd-0001-4000-8000-000000000005', 'dddddddd-0004-4000-8000-000000001035', 'dddddddd-0002-4000-8000-000000000005',
     '1035', 'San Luis Potosí, SLP', 'Monterrey, NL', 9100, current_date - 3, current_date - 1, 'liquidado', now() - interval '55 minutes',
     (current_date - 3)::timestamptz + interval '7 hours', (current_date - 3)::timestamptz + interval '7 hours 20 minutes', 1,
     521, 17714, now() - interval '40 hours', now() - interval '38 hours', now() - interval '36 hours');

  insert into gasto (tenant_id, viaje_id, concepto, monto, fecha, folio, cfdi_uuid, rfc_emisor, rfc_receptor, estado_sat, efos,
                     clave_prod_serv, clave_unidad, tipo_comprobante, complemento_hidrocarburos, xml_verificado, forma_pago,
                     sub_total, ieps_traslado, iva_traslado, ocr_confianza, ocr_extra, created_at) values
    -- 1042
    (t, v1042, 'diesel', 4200, current_date - 2, 'DS-8801', 'b7e3f1a2-1c4d-4e6f-8a90-00000000a042', 'PEM870101AB1', 'TPE150812AB3', 'vigente', false,
     '15101505', 'LTR', 'I', true, true, '04', 2522.11, 1098.44, 579.45, 0.97, '{"litros":177.97,"precioLitro":23.60,"estacion":"Estación Pemex Carretera"}', now() - interval '9 minutes'),
    (t, v1042, 'diesel', 3800, current_date - 1, 'DS-8834', 'b7e3f1a2-1c4d-4e6f-8a90-00000000b042', 'GDO020515KL3', 'TPE150812AB3', 'vigente', false,
     '15101505', 'LTR', 'I', true, true, '04', 2281.91, 993.87, 524.22, 0.96, '{"litros":161.02,"precioLitro":23.60,"estacion":"G500 Autopista"}', now() - interval '8 minutes'),
    (t, v1042, 'caseta', 1400, current_date - 2, 'IAVE-2608-01042', 'c8f4a2b3-2d5e-4f70-9b01-00000000c042', 'CAP0102055J6', 'TPE150812AB3', 'vigente', null,
     '95111602', 'E48', 'I', null, true, '03', 1206.90, null, 193.10, 0.96, '{"tag":true,"proveedor":"IAVE"}', now() - interval '7 minutes'),
    (t, v1042, 'factura', 1200, current_date - 1, 'FA-4471', 'd9a5b3c4-3e6f-4a81-8c12-00000000d042', 'MAN190606KL6', 'TPE150812AB3', 'vigente', null,
     null, null, 'I', null, true, '03', 1034.48, null, 165.52, 0.95, '{"detalle":"maniobras de descarga"}', now() - interval '6 minutes'),
    -- 1039: 4,000 + 3,100 diésel + 900 casetas + 400 alimentación = 8,400
    (t, v1039, 'diesel', 4000, current_date - 2, 'DS-8790', 'b7e3f1a2-1c4d-4e6f-8a90-00000000a039', 'OXX970101HJ2', 'TPE150812AB3', 'vigente', false,
     '15101505', 'LTR', 'I', true, true, '04', 2402.01, 1046.13, 551.86, 0.97, '{"litros":169.49,"precioLitro":23.60,"estacion":"Oxxo Gas"}', now() - interval '24 minutes'),
    (t, v1039, 'diesel', 3100, current_date - 1, 'DS-8812', 'b7e3f1a2-1c4d-4e6f-8a90-00000000b039', 'ESG150410QW8', 'TPE150812AB3', 'vigente', false,
     '15101505', 'LTR', 'I', true, true, '04', 1861.56, 810.75, 427.69, 0.96, '{"litros":131.36,"precioLitro":23.60,"estacion":"Energéticos del Golfo"}', now() - interval '23 minutes'),
    (t, v1039, 'caseta', 900, current_date - 2, 'IAVE-2608-01039', 'c8f4a2b3-2d5e-4f70-9b01-00000000c039', 'CAP0102055J6', 'TPE150812AB3', 'vigente', null,
     '95111602', 'E48', 'I', null, true, '03', 775.86, null, 124.14, 0.95, '{"tag":true,"proveedor":"PASE"}', now() - interval '22 minutes'),
    (t, v1039, 'alimentacion', 400, current_date - 1, 'AL-2210', null, null, 'TPE150812AB3', null, null,
     null, null, 'I', null, null, '01', 344.83, null, 55.17, 0.91, '{"detalle":"alimentos en ruta"}', now() - interval '21 minutes'),
    -- 1037: 3,900 diésel + 1,850 casetas + 450 alimentación = 6,200
    (t, v1037, 'diesel', 3900, current_date - 1, 'DS-8821', 'b7e3f1a2-1c4d-4e6f-8a90-00000000a037', 'CRE010203RT5', 'TPE150812AB3', 'vigente', false,
     '15101505', 'LTR', 'I', true, true, '04', 2341.96, 1019.98, 538.06, 0.98, '{"litros":165.25,"precioLitro":23.60,"estacion":"Corpogas"}', now() - interval '39 minutes'),
    (t, v1037, 'caseta', 1850, current_date - 1, 'IAVE-2608-01037', 'c8f4a2b3-2d5e-4f70-9b01-00000000c037', 'CAP0102055J6', 'TPE150812AB3', 'vigente', null,
     '95111602', 'E48', 'I', null, true, '03', 1594.83, null, 255.17, 0.96, '{"tag":true,"proveedor":"TeleVía"}', now() - interval '38 minutes'),
    (t, v1037, 'alimentacion', 450, current_date - 1, 'AL-2231', 'e1b6c4d5-4f70-4b92-9d23-00000000e037', 'RES120101AB1', 'TPE150812AB3', 'vigente', null,
     null, null, 'I', null, true, '01', 387.93, null, 62.07, 0.93, '{"detalle":"alimentos en ruta"}', now() - interval '37 minutes'),
    -- 1035: 3,950 + 2,750 diésel + 2,100 casetas + 300 alimentación = 9,100
    (t, v1035, 'diesel', 3950, current_date - 3, 'DS-8766', 'b7e3f1a2-1c4d-4e6f-8a90-00000000a035', 'GAS990909MN4', 'TPE150812AB3', 'vigente', false,
     '15101505', 'LTR', 'I', true, true, '28', 2371.99, 1033.05, 544.96, 0.97, '{"litros":167.37,"precioLitro":23.60,"estacion":"Gasolineras del Norte"}', now() - interval '54 minutes'),
    (t, v1035, 'diesel', 2750, current_date - 2, 'DS-8779', 'b7e3f1a2-1c4d-4e6f-8a90-00000000b035', 'HID120512PL7', 'TPE150812AB3', 'vigente', false,
     '15101505', 'LTR', 'I', true, true, '28', 1651.38, 719.21, 379.41, 0.95, '{"litros":116.53,"precioLitro":23.60,"estacion":"Hidrosina"}', now() - interval '53 minutes'),
    (t, v1035, 'caseta', 2100, current_date - 3, 'IAVE-2608-01035', 'c8f4a2b3-2d5e-4f70-9b01-00000000c035', 'CAP0102055J6', 'TPE150812AB3', 'vigente', null,
     '95111602', 'E48', 'I', null, true, '03', 1810.34, null, 289.66, 0.97, '{"tag":true,"proveedor":"IAVE"}', now() - interval '52 minutes'),
    (t, v1035, 'alimentacion', 300, current_date - 2, 'AL-2198', null, null, 'TPE150812AB3', null, null,
     null, null, 'I', null, null, '01', 258.62, null, 41.38, 0.90, '{"detalle":"alimentos en ruta"}', now() - interval '51 minutes');

  insert into liquidacion (tenant_id, viaje_id, total_comprobado, total_anticipo, diferencia, estatus, diferencias, created_at,
                           iva_acreditable, ieps_acreditable, peaje_acreditable, litros_diesel_acreditables) values
    (t, v1042, 10600, 10600, 0, 'con_diferencias',
     ('[{"tipo":"sobre_politica","concepto":"diesel","esperado":4000,"real":4200,"monto":200,"nota":"Diésel excede el tope de $4,000 por $200","gastoId":"' ||
      (select id from gasto where viaje_id = v1042 and monto = 4200) || '"}]')::jsonb,
     now() - interval '5 minutes', 1462.29, 2092.31, 700, 338.99),
    (t, v1039, 8400, 8400, 0, 'cuadrada', '[]'::jsonb, now() - interval '20 minutes', 1103.69, 1856.88, 450, 300.85),
    (t, v1037, 6200, 6200, 0, 'con_diferencias',
     '[{"tipo":"sobre_politica","concepto":"caseta","esperado":1500,"real":1850,"monto":350,"nota":"Caseta excede el tope de $1,500 por $350"}]'::jsonb,
     now() - interval '35 minutes', 855.30, 1019.98, 925, 165.25),
    (t, v1035, 9100, 9100, 0, 'con_diferencias',
     '[{"tipo":"sobre_politica","concepto":"caseta","esperado":1500,"real":2100,"monto":600,"nota":"Caseta excede el tope de $1,500 por $600"}]'::jsonb,
     now() - interval '50 minutes', 1214.03, 1752.26, 1050, 283.90);
end $$;

-- ── BLOQUE 8: operación y cobranza (pod, incidencias, mantenimiento, huérfanos, facturas, pagos) ──
do $$
declare
  t uuid := 'dddddddd-0000-4000-8000-000000005000';
begin
  -- evidencia de entrega: 60 % de los viajes en curso ya subieron POD
  insert into pod (tenant_id, viaje_id, operador_id, storage_path, lat, lng, estado, capturado_en, creado_en)
  select t, v.id, v.operador_id, 'pod/' || t || '/' || v.id || '.jpg',
         19.4 + (n % 700) / 100.0, -99.1 - (n % 500) / 100.0,
         case when n % 10 < 6 then 'subido' when n % 10 < 8 then 'pendiente' else 'rechazado' end,
         v.created_at + interval '9 hours', v.created_at + interval '9 hours'
  from (select id, operador_id, created_at, (regexp_replace(substring(id::text from 25), '\D', '', 'g'))::bigint as n from viaje
        where tenant_id = t and estatus in ('abierto', 'en_cuadre')) v
  where n % 10 < 8;
  update pod set storage_path = null where tenant_id = t and estado <> 'subido';

  -- incidencias: 60, la mitad abiertas, algunas fuera de SLA
  insert into incidencia (tenant_id, viaje_id, unidad_id, tipo, prioridad, estado, descripcion, sla_horas, abierta_en, resuelta_en, monto_estimado)
  select t, v.id, v.unidad_id,
         (array['retraso','averia','dano','faltante','desvio'])[1 + i % 5],
         (array['baja','media','alta'])[1 + i % 3],
         case when i % 2 = 0 then 'resuelta' when i % 4 = 1 then 'en_proceso' else 'abierta' end,
         (array['Retraso por cierre carretero en la 57','Falla de turbo, unidad detenida en ruta','Daño en caja por maniobra de descarga','Faltante de 2 tarimas al entregar','Desvío de ruta reportado por GPS'])[1 + i % 5],
         (array[4, 8, 24, 48])[1 + i % 4],
         now() - (i * 7) * interval '1 hour',
         case when i % 2 = 0 then now() - (i * 5) * interval '1 hour' end,
         case when i % 5 = 1 then 4500 + i * 120 when i % 5 = 2 then 2200 + i * 30 end
  from generate_series(1, 60) i
  join lateral (select id, unidad_id from viaje where tenant_id = t and unidad_id is not null
                order by (regexp_replace(substring(id::text from 25), '\D', '', 'g'))::bigint offset i * 37 limit 1) v on true;

  -- mantenimiento: las 250 unidades en taller tienen orden abierta; 40 preventivos en proceso
  insert into mantenimiento (tenant_id, unidad_id, tipo, descripcion, estado, km_servicio, abierta_en)
  select t, id, case when (regexp_replace(substring(id::text from 25), '\D', '', 'g'))::bigint % 3 = 0 then 'correctivo' else 'preventivo' end,
         case when (regexp_replace(substring(id::text from 25), '\D', '', 'g'))::bigint % 3 = 0 then 'Cambio de clutch y reparación de embrague' else 'Servicio preventivo de 30,000 km' end,
         case when (regexp_replace(substring(id::text from 25), '\D', '', 'g'))::bigint % 2 = 0 then 'en_proceso' else 'abierta' end,
         km_actual, now() - ((regexp_replace(substring(id::text from 25), '\D', '', 'g'))::bigint % 9) * interval '1 day'
  from unidad where tenant_id = t and estado = 'taller';
  insert into mantenimiento (tenant_id, unidad_id, tipo, descripcion, estado, km_servicio, abierta_en)
  select t, id, 'dvir', 'Reporte de inspección: luces traseras y llanta con desgaste', 'abierta', km_actual, now() - interval '2 days'
  from unidad where tenant_id = t and estado = 'en_ruta' and (regexp_replace(substring(id::text from 25), '\D', '', 'g'))::bigint % 125 = 0;

  -- comprobantes huérfanos: 12 pendientes + 30 resueltos
  insert into comprobante_huerfano (tenant_id, operador_id, ruta_imagen, gasto, motivo, creado_en, resuelto_en, resolucion, viaje_id)
  select t, ('dddddddd-0003-4000-8000-' || lpad((3000 + i)::text, 12, '0'))::uuid,
         'huerfanos/' || t || '/' || i || '.jpg',
         jsonb_build_object('concepto', case when i % 3 = 0 then 'caseta' else 'diesel' end, 'monto', case when i % 3 = 0 then 380 + i * 7 else 2900 + i * 41 end,
                            'folio', 'HF-' || (7000 + i), 'fecha', (current_date - (i % 6))::text),
         (array['sin_viaje','tras_liquidar','fallo_ocr'])[1 + i % 3],
         now() - (i * 3) * interval '1 hour',
         case when i > 12 then now() - (i * 2) * interval '1 hour' end,
         case when i > 12 then (array['adjuntado','descartado'])[1 + i % 2] end,
         case when i > 12 and i % 2 = 1 then ('dddddddd-0005-4000-8000-' || lpad((6000 + i)::text, 12, '0'))::uuid end
  from generate_series(1, 42) i;

  -- cobranza: 600 facturas (viajes liquidados con cliente), 55 % pagadas, algunas vencidas
  insert into factura_emitida (tenant_id, cliente_id, viaje_id, folio, cfdi_uuid, fecha, subtotal, iva, total, moneda, estatus, vence_en, creada_en)
  select t, v.cliente_id, v.id, 'F-' || lpad((20260000 + v.n)::text, 8, '0'),
         md5('tps-fe-' || v.n)::uuid::text, v.fecha_fin,
         v.ingreso_flete, round(v.ingreso_flete * 0.16, 2), round(v.ingreso_flete * 1.16, 2), 'MXN',
         case when v.n % 20 < 11 then 'pagada' when v.n % 20 = 19 then 'cancelada' else 'emitida' end,
         v.fecha_fin + c.dias_credito, v.fecha_fin::timestamptz + interval '18 hours'
  from (select id, cliente_id, fecha_fin, ingreso_flete, (regexp_replace(substring(id::text from 25), '\D', '', 'g'))::bigint as n
        from viaje where tenant_id = t and estatus = 'liquidado' and ingreso_flete is not null and fecha_fin <= current_date) v
  join cliente c on c.id = v.cliente_id
  where v.n % 46 = 0;
  -- facturas "vencidas": las más viejas emitidas a 15 días
  update factura_emitida set vence_en = fecha + 7 where tenant_id = t and estatus = 'emitida' and fecha < current_date - 10;
  insert into pago_recibido (tenant_id, factura_id, fecha, monto, metodo, referencia, registrado_en)
  select t, id, least(vence_en, current_date), total, 'transferencia', 'SPEI-' || substr(md5(id::text), 1, 10), now()
  from factura_emitida where tenant_id = t and estatus = 'pagada';
  raise notice 'TPS bloque 8 listo';
end $$;
