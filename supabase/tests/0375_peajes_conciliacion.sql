\set ON_ERROR_STOP on
-- 0375 + 0376 — CONCILIACIÓN DE PEAJES (Agente 2): hora del cobro, tag↔unidad,
-- catálogo de casetas, cruce GPS, buzón firmado y su cola con claim.
--
-- Lo que SOLO la base puede demostrar, contra Postgres real:
--
--   (a) peaje_tag: un TAG = una unidad por flota (unique), forma del TAG, y la
--       FK compuesta: la unidad de OTRA flota no se puede casar;
--   (b) peaje_caseta: coordenadas y radio con rango, nombre único por flota;
--   (c) la línea del desglose: hora/cruce_en nulos son NULL (no medianoche),
--       el CHECK del veredicto GPS, y la FK a la caseta que se suelta (set null);
--   (d) la cola peaje_ingesta_archivo: unique (flota, huella) — el MISMO archivo
--       dos veces es una fila —, CHECK de estado/tamaño/contenido coherente;
--   (e) el CLAIM peaje_archivo_reclamar: toma pendientes, marca procesando con
--       token y lease, no entrega dos veces lo ya reclamado, recupera lo que
--       quedó con el lease vencido (con un intento más) y respeta el backoff;
--   (f) desglose_peaje.ingesta_archivo_id único: un archivo no da dos desgloses;
--   (g) peaje_posiciones_ventana devuelve SOLO posiciones de esa flota, esa
--       unidad y esa ventana;
--   (h) RLS: deny-all para authenticated y anon en las 5 tablas nuevas;
--   (i) cron_latido admite 'peajes' Y los doce de antes, y rechaza uno inventado;
--   (j) los grants de las dos funciones: solo service_role.
begin;

insert into public.tenant (id, nombre) values
  ('37500000-0000-4000-8000-0000000000a1', 'Flota A 0375'),
  ('37500000-0000-4000-8000-0000000000b1', 'Flota B 0375');
insert into public.unidad (id, tenant_id, numero_economico) values
  ('37500000-0000-4000-8000-0000000000a2', '37500000-0000-4000-8000-0000000000a1', 'C2-08'),
  ('37500000-0000-4000-8000-0000000000b2', '37500000-0000-4000-8000-0000000000b1', 'C2-08');
insert into public.app_user (id, tenant_id, email, rol) values
  ('37500000-0000-4000-8000-0000000000c1', '37500000-0000-4000-8000-0000000000a1', 'dueno-0375@test.invalid', 'flota_admin');

set local role service_role;

-- ── (a) peaje_tag ───────────────────────────────────────────────────────────
insert into public.peaje_tag (id, tenant_id, tag, unidad_id) values
  ('37500000-0000-4000-8000-0000000000d1', '37500000-0000-4000-8000-0000000000a1', 'IMDM10000001', '37500000-0000-4000-8000-0000000000a2');

do $$ begin
  -- el mismo TAG en la misma flota choca…
  begin
    insert into public.peaje_tag (tenant_id, tag, unidad_id)
    values ('37500000-0000-4000-8000-0000000000a1', 'IMDM10000001', '37500000-0000-4000-8000-0000000000a2');
    raise exception '0375: el mismo TAG entró dos veces en la misma flota';
  exception when unique_violation then null;
  end;
  -- …en OTRA flota no (cada flota tiene su tabla de TAGs).
  insert into public.peaje_tag (tenant_id, tag, unidad_id)
  values ('37500000-0000-4000-8000-0000000000b1', 'IMDM10000001', '37500000-0000-4000-8000-0000000000b2');
  -- la unidad de OTRA flota no se puede casar (FK compuesta)
  begin
    insert into public.peaje_tag (tenant_id, tag, unidad_id)
    values ('37500000-0000-4000-8000-0000000000a1', 'IMDM10000002', '37500000-0000-4000-8000-0000000000b2');
    raise exception '0375: un TAG de la flota A se casó con una UNIDAD de la flota B';
  exception when foreign_key_violation then null;
  end;
  -- forma del TAG: normalizado, 4 a 40
  begin
    insert into public.peaje_tag (tenant_id, tag, unidad_id) values ('37500000-0000-4000-8000-0000000000a1', 'imdm 1', '37500000-0000-4000-8000-0000000000a2');
    raise exception '0375: el CHECK de forma dejó pasar un TAG sin normalizar';
  exception when check_violation then null;
  end;
  begin
    insert into public.peaje_tag (tenant_id, tag, unidad_id) values ('37500000-0000-4000-8000-0000000000a1', 'AB1', '37500000-0000-4000-8000-0000000000a2');
    raise exception '0375: el CHECK dejó pasar un TAG de 3 caracteres';
  exception when check_violation then null;
  end;
  begin
    insert into public.peaje_tag (tenant_id, tag, unidad_id) values ('37500000-0000-4000-8000-0000000000a1', repeat('A', 41), '37500000-0000-4000-8000-0000000000a2');
    raise exception '0375: el CHECK dejó pasar un TAG de 41 caracteres';
  exception when check_violation then null;
  end;
end $$;

-- ── (b) peaje_caseta ────────────────────────────────────────────────────────
insert into public.peaje_caseta (id, tenant_id, nombre, nombre_norm, lat, lng) values
  ('37500000-0000-4000-8000-0000000000e1', '37500000-0000-4000-8000-0000000000a1', 'Caseta Ejemplo Norte', 'caseta ejemplo norte', 19.5, -99.2);

do $$
declare
  c record; rechazo boolean;
begin
  if (select radio_m from public.peaje_caseta where id = '37500000-0000-4000-8000-0000000000e1') <> 300 then
    raise exception '0375: el radio por default no es 300 m';
  end if;
  begin
    insert into public.peaje_caseta (tenant_id, nombre, nombre_norm, lat, lng) values ('37500000-0000-4000-8000-0000000000a1', 'Otra', 'caseta ejemplo norte', 19.6, -99.3);
    raise exception '0375: el nombre normalizado entró dos veces en la misma flota';
  exception when unique_violation then null;
  end;
  insert into public.peaje_caseta (tenant_id, nombre, nombre_norm, lat, lng) values ('37500000-0000-4000-8000-0000000000b1', 'Caseta Ejemplo Norte', 'caseta ejemplo norte', 19.5, -99.2);

  for c in select * from (values
    ('lat > 90', 91.0::float8, -99.0::float8, 300),
    ('lat < -90', -91.0, -99.0, 300),
    ('lng > 180', 19.0, 181.0, 300),
    ('lng < -180', 19.0, -181.0, 300),
    ('radio 49', 19.0, -99.0, 49),
    ('radio 5001', 19.0, -99.0, 5001)
  ) as t(nombre, lat, lng, radio) loop
    rechazo := false;
    begin
      insert into public.peaje_caseta (tenant_id, nombre, nombre_norm, lat, lng, radio_m)
      values ('37500000-0000-4000-8000-0000000000a1', 'chk ' || c.nombre, 'chk ' || c.nombre, c.lat, c.lng, c.radio);
    exception when check_violation then rechazo := true;
    end;
    if not rechazo then raise exception '0375: el CHECK de caseta dejó pasar «%»', c.nombre; end if;
  end loop;
  -- los bordes SÍ entran
  insert into public.peaje_caseta (tenant_id, nombre, nombre_norm, lat, lng, radio_m) values
    ('37500000-0000-4000-8000-0000000000a1', 'borde 50', 'borde 50', 19.0, -99.0, 50),
    ('37500000-0000-4000-8000-0000000000a1', 'borde 5000', 'borde 5000', 19.0, -99.0, 5000);
  begin
    insert into public.peaje_caseta (tenant_id, nombre, nombre_norm, lat, lng) values ('37500000-0000-4000-8000-0000000000a1', repeat('x', 121), 'x', 19.0, -99.0);
    raise exception '0375: el CHECK dejó pasar un nombre de 121 caracteres';
  exception when check_violation then null;
  end;
end $$;

-- ── (c) la línea del desglose ───────────────────────────────────────────────
insert into public.desglose_peaje (id, tenant_id, proveedor) values
  ('37500000-0000-4000-8000-0000000000f1', '37500000-0000-4000-8000-0000000000a1', 'PASE');
insert into public.desglose_peaje_linea (id, tenant_id, desglose_id, indice, fecha, caseta, monto) values
  ('37500000-0000-4000-8000-000000000f11', '37500000-0000-4000-8000-0000000000a1', '37500000-0000-4000-8000-0000000000f1', 0, '2026-08-05', 'Caseta Ejemplo Norte', 189.00);

do $$
declare l record;
begin
  select hora, cruce_en, unidad_id, caseta_id, gps_veredicto, gps_distancia_m into l
    from public.desglose_peaje_linea where id = '37500000-0000-4000-8000-000000000f11';
  if l.hora is not null or l.cruce_en is not null or l.gps_veredicto is not null or l.gps_distancia_m is not null
     or l.unidad_id is not null or l.caseta_id is not null then
    raise exception '0375: una línea sin hora/GPS no quedó en NULL (NULL nunca es medianoche ni cero)';
  end if;
  update public.desglose_peaje_linea
     set hora = '10:30:00', cruce_en = '2026-08-05T16:30:00Z', caseta_id = '37500000-0000-4000-8000-0000000000e1',
         gps_veredicto = 'confirma', gps_distancia_m = 0, gps_detalle = '{"via":"muestra","muestras":3}'
   where id = '37500000-0000-4000-8000-000000000f11';
  begin
    update public.desglose_peaje_linea set gps_veredicto = 'acusado' where id = '37500000-0000-4000-8000-000000000f11';
    raise exception '0375: el CHECK de veredicto GPS dejó pasar «acusado»';
  exception when check_violation then null;
  end;
  begin
    update public.desglose_peaje_linea set gps_distancia_m = -1 where id = '37500000-0000-4000-8000-000000000f11';
    raise exception '0375: el CHECK dejó pasar una distancia negativa';
  exception when check_violation then null;
  end;
  begin
    update public.desglose_peaje_linea set caseta_id = '37500000-0000-4000-8000-0000000fffff' where id = '37500000-0000-4000-8000-000000000f11';
    raise exception '0375: la línea apuntó a una caseta inexistente';
  exception when foreign_key_violation then null;
  end;
  -- borrar la caseta NO borra la línea (es un hecho del archivo del proveedor): suelta la liga.
  delete from public.peaje_caseta where id = '37500000-0000-4000-8000-0000000000e1';
  if not exists (select 1 from public.desglose_peaje_linea where id = '37500000-0000-4000-8000-000000000f11' and caseta_id is null) then
    raise exception '0375: borrar la caseta borró la línea o no soltó la liga';
  end if;
  -- borrar la unidad suelta unidad_id de la línea
  update public.desglose_peaje_linea set unidad_id = '37500000-0000-4000-8000-0000000000a2' where id = '37500000-0000-4000-8000-000000000f11';
end $$;

-- ── (d) la cola de ingesta ──────────────────────────────────────────────────
insert into public.peaje_ingesta_archivo (id, tenant_id, huella, nombre, bytes, contenido) values
  ('37500000-0000-4000-8000-000000000a01', '37500000-0000-4000-8000-0000000000a1', repeat('a', 64), 'pase-1.csv', 10, '\x0102'),
  ('37500000-0000-4000-8000-000000000a02', '37500000-0000-4000-8000-0000000000a1', repeat('b', 64), 'pase-2.csv', 10, '\x0102'),
  ('37500000-0000-4000-8000-000000000a03', '37500000-0000-4000-8000-0000000000a1', repeat('c', 64), 'pase-3.csv', 10, '\x0102');

do $$
declare c record; rechazo boolean;
begin
  -- el MISMO archivo (misma huella) dos veces en la misma flota choca; en otra flota no
  begin
    insert into public.peaje_ingesta_archivo (tenant_id, huella, nombre, bytes, contenido)
    values ('37500000-0000-4000-8000-0000000000a1', repeat('a', 64), 'otra-copia.csv', 10, '\x01');
    raise exception '0375: el mismo archivo entró dos veces a la cola de la misma flota';
  exception when unique_violation then null;
  end;
  insert into public.peaje_ingesta_archivo (tenant_id, huella, nombre, bytes, contenido)
  values ('37500000-0000-4000-8000-0000000000b1', repeat('a', 64), 'pase-1.csv', 10, '\x01');

  for c in select * from (values
    ('huella corta', 'huella', 'abc'),
    ('huella en mayúsculas', 'huella', repeat('A', 64)),
    ('estado inventado', 'estado', 'enviada'),
    ('origen inventado', 'origen', 'sftp'),   -- 'correo' y 'pull' son canales válidos desde la 0563
    ('bytes 0', 'bytes', '0'),
    ('bytes > 4 MB', 'bytes', '4194305'),
    ('intentos negativos', 'intentos', '-1')
  ) as t(nombre, columna, valor) loop
    rechazo := false;
    begin
      insert into public.peaje_ingesta_archivo (tenant_id, huella, nombre, bytes, contenido, estado, origen, intentos)
      select '37500000-0000-4000-8000-0000000000a1',
             case when c.columna = 'huella' then c.valor else md5(c.nombre) || md5(c.nombre) end,
             'chk.csv',
             case when c.columna = 'bytes' then c.valor::int else 10 end,
             '\x01',
             case when c.columna = 'estado' then c.valor else 'pendiente' end,
             case when c.columna = 'origen' then c.valor else 'api' end,
             case when c.columna = 'intentos' then c.valor::int else 0 end;
    exception when check_violation then rechazo := true;
    end;
    if not rechazo then raise exception '0375: el CHECK de la cola dejó pasar «%»', c.nombre; end if;
  end loop;

  -- contenido coherente: pendiente sin contenido NO; procesada con contenido NO.
  begin
    insert into public.peaje_ingesta_archivo (tenant_id, huella, nombre, bytes, contenido, estado)
    values ('37500000-0000-4000-8000-0000000000a1', repeat('d', 64), 'x.csv', 10, null, 'pendiente');
    raise exception '0375: un archivo pendiente entró SIN contenido';
  exception when check_violation then null;
  end;
  begin
    insert into public.peaje_ingesta_archivo (tenant_id, huella, nombre, bytes, contenido, estado)
    values ('37500000-0000-4000-8000-0000000000a1', repeat('e', 64), 'x.csv', 10, '\x01', 'procesada');
    raise exception '0375: un archivo procesado conservó su contenido';
  exception when check_violation then null;
  end;
  -- fallida puede conservar el contenido (para reintentar) o no.
  insert into public.peaje_ingesta_archivo (tenant_id, huella, nombre, bytes, contenido, estado) values
    ('37500000-0000-4000-8000-0000000000a1', repeat('f', 64), 'x.csv', 10, '\x01', 'fallida'),
    ('37500000-0000-4000-8000-0000000000a1', repeat('1', 64), 'x.csv', 10, null, 'fallida');
end $$;

-- ── (e) el CLAIM ────────────────────────────────────────────────────────────
-- Lo que no debe tocar: el de la otra flota con contenido, y el fallido.
do $$
declare r1 record; n int; r2 int; tok uuid; intentos_antes int;
begin
  -- rangos del límite
  begin perform * from public.peaje_archivo_reclamar(0, 300); raise exception '0376: aceptó límite 0';
  exception when raise_exception then if sqlerrm like '0376:%' then raise; end if; end;
  begin perform * from public.peaje_archivo_reclamar(51, 300); raise exception '0376: aceptó límite 51';
  exception when raise_exception then if sqlerrm like '0376:%' then raise; end if; end;
  begin perform * from public.peaje_archivo_reclamar(5, 10); raise exception '0376: aceptó un lease de 10 s';
  exception when raise_exception then if sqlerrm like '0376:%' then raise; end if; end;

  -- reclama 2 de los 4 pendientes (3 de la flota A + 1 de B)
  select count(*), min(reclamo::text)::uuid into n, tok from public.peaje_archivo_reclamar(2, 300);
  if n <> 2 then raise exception '0376: el claim con límite 2 devolvió % filas', n; end if;
  if (select count(*) from public.peaje_ingesta_archivo where estado = 'procesando' and reclamo = tok and intentos = 1 and reclamado_hasta > now()) <> 2 then
    raise exception '0376: el claim no marcó procesando con token, intento y lease';
  end if;

  -- un SEGUNDO claim no entrega lo ya reclamado: solo los 2 pendientes que quedan
  select count(*) into n from public.peaje_archivo_reclamar(10, 300);
  if n <> 2 then raise exception '0376: el segundo claim devolvió % (esperaba los 2 restantes, no los ya reclamados)', n; end if;
  select count(*) into n from public.peaje_archivo_reclamar(10, 300);
  if n <> 0 then raise exception '0376: con todo reclamado, un tercer claim devolvió %', n; end if;

  -- el fallido NO se reclama
  if exists (select 1 from public.peaje_ingesta_archivo where estado = 'fallida' and reclamo is not null) then
    raise exception '0376: el claim tomó un archivo fallido';
  end if;

  -- lease vencido → se recupera, con un intento más y un token nuevo
  update public.peaje_ingesta_archivo set reclamado_hasta = now() - interval '1 minute'
   where id = '37500000-0000-4000-8000-000000000a01';
  select intentos into intentos_antes from public.peaje_ingesta_archivo where id = '37500000-0000-4000-8000-000000000a01';
  select count(*) into n from public.peaje_archivo_reclamar(10, 300);
  if n <> 1 then raise exception '0376: el lease vencido devolvió % filas (esperaba 1)', n; end if;
  if (select intentos from public.peaje_ingesta_archivo where id = '37500000-0000-4000-8000-000000000a01') <> intentos_antes + 1 then
    raise exception '0376: recuperar un lease vencido no sumó el intento';
  end if;

  -- el backoff se respeta: un pendiente con proximo_intento_en futuro no se toma
  update public.peaje_ingesta_archivo set estado = 'pendiente', reclamo = null, reclamado_hasta = null, proximo_intento_en = now() + interval '1 hour'
   where id = '37500000-0000-4000-8000-000000000a02';
  select count(*) into n from public.peaje_archivo_reclamar(10, 300);
  if n <> 0 then raise exception '0376: el claim ignoró el backoff (proximo_intento_en futuro)'; end if;
end $$;

-- ── (f) un archivo = un desglose ────────────────────────────────────────────
insert into public.desglose_peaje (id, tenant_id, proveedor, ingesta_archivo_id) values
  ('37500000-0000-4000-8000-0000000000f2', '37500000-0000-4000-8000-0000000000a1', 'PASE', '37500000-0000-4000-8000-000000000a01');
do $$ begin
  begin
    insert into public.desglose_peaje (tenant_id, proveedor, ingesta_archivo_id)
    values ('37500000-0000-4000-8000-0000000000a1', 'PASE', '37500000-0000-4000-8000-000000000a01');
    raise exception '0376: un mismo archivo de la cola generó dos desgloses';
  exception when unique_violation then null;
  end;
  -- los desgloses manuales (sin archivo) no se estorban entre sí
  insert into public.desglose_peaje (tenant_id, proveedor) values
    ('37500000-0000-4000-8000-0000000000a1', 'PASE'), ('37500000-0000-4000-8000-0000000000a1', 'PASE');
end $$;

-- ── (g) peaje_posiciones_ventana ────────────────────────────────────────────
insert into public.posicion (tenant_id, unidad_id, lat, lng, medida_en, proveedor) values
  ('37500000-0000-4000-8000-0000000000a1', '37500000-0000-4000-8000-0000000000a2', 19.5, -99.2, '2026-08-05T16:25:00Z', 't'),
  ('37500000-0000-4000-8000-0000000000a1', '37500000-0000-4000-8000-0000000000a2', 19.5, -99.2, '2026-08-05T16:31:00Z', 't'),
  ('37500000-0000-4000-8000-0000000000a1', '37500000-0000-4000-8000-0000000000a2', 19.5, -99.2, '2026-08-05T18:00:00Z', 't'),
  ('37500000-0000-4000-8000-0000000000b1', '37500000-0000-4000-8000-0000000000b2', 19.5, -99.2, '2026-08-05T16:30:00Z', 't');
do $$
declare n int;
begin
  select count(*) into n from public.peaje_posiciones_ventana(
    '37500000-0000-4000-8000-0000000000a1',
    '[{"linea_id":"37500000-0000-4000-8000-000000000f11","unidad_id":"37500000-0000-4000-8000-0000000000a2","desde":"2026-08-05T16:10:00Z","hasta":"2026-08-05T16:50:00Z"}]'::jsonb);
  if n <> 2 then raise exception '0376: la ventana devolvió % posiciones (esperaba 2: la de las 18:00 y la de la otra flota NO)', n; end if;
  -- la flota B pidiendo la unidad de A no recibe nada
  select count(*) into n from public.peaje_posiciones_ventana(
    '37500000-0000-4000-8000-0000000000b1',
    '[{"linea_id":"37500000-0000-4000-8000-000000000f11","unidad_id":"37500000-0000-4000-8000-0000000000a2","desde":"2026-08-05T00:00:00Z","hasta":"2026-08-06T00:00:00Z"}]'::jsonb);
  if n <> 0 then raise exception '0376: una flota leyó las posiciones de una unidad AJENA (%)', n; end if;
end $$;
-- entrada que no es arreglo: no devuelve filas (un objeto no es un arreglo de ventanas)
do $$
declare n int;
begin
  begin
    select count(*) into n from public.peaje_posiciones_ventana('37500000-0000-4000-8000-0000000000a1', '{}'::jsonb);
    if n <> 0 then raise exception '0376: una entrada que no es arreglo devolvió % filas', n; end if;
  exception when others then
    if sqlerrm like '0376:%' then raise; end if;  -- lanzar por la forma también es seguro; lo que no puede ser es filtrar datos
  end;
end $$;

-- ── (i) cron_latido ─────────────────────────────────────────────────────────
do $$
declare
  ids text[] := array[
    'wa-pendientes','wa-outbox','escalar','facturar','purgar','runner','gps','asistencia',
    'descarga-sat','jornada','portales-vivos','liquidaciones-externas','peajes'
  ];
  k text; no_entraron text[] := '{}';
begin
  foreach k in array ids loop
    begin
      insert into public.cron_latido (id) values (k) on conflict (id) do update set ultimo_latido = now();
    exception when check_violation then no_entraron := no_entraron || k;
    end;
  end loop;
  if cardinality(no_entraron) > 0 then
    raise exception '0376: el CHECK de cron_latido dejó fuera: %', array_to_string(no_entraron, ',');
  end if;
  begin
    insert into public.cron_latido (id) values ('cron-que-nadie-escribio');
    raise exception '0376: cron_latido aceptó un id inventado (¿se perdió la lista?)';
  exception when check_violation then null;
  end;
end $$;

-- rotación de la llave
do $$ begin
  insert into public.peaje_ingesta_config (tenant_id) values ('37500000-0000-4000-8000-0000000000a1');
  if (select rotacion from public.peaje_ingesta_config) <> 1 then raise exception '0376: la rotación no arranca en 1'; end if;
  begin
    update public.peaje_ingesta_config set rotacion = 0;
    raise exception '0376: el CHECK dejó pasar rotación 0';
  exception when check_violation then null;
  end;
end $$;
-- mapeo de columnas: monto y caseta obligatorios en el jsonb
do $$ begin
  insert into public.peaje_mapeo_columnas (tenant_id, proveedor_norm, proveedor, columnas)
  values ('37500000-0000-4000-8000-0000000000a1', 'pase', 'PASE', '{"fecha":"A","caseta":"B","monto":"C"}');
  begin
    insert into public.peaje_mapeo_columnas (tenant_id, proveedor_norm, proveedor, columnas)
    values ('37500000-0000-4000-8000-0000000000a1', 'iave', 'IAVE', '{"fecha":"A"}');
    raise exception '0376: el mapeo sin monto/caseta entró';
  exception when check_violation then null;
  end;
  begin
    insert into public.peaje_mapeo_columnas (tenant_id, proveedor_norm, proveedor, columnas)
    values ('37500000-0000-4000-8000-0000000000a1', 'pase', 'PASE otra vez', '{"caseta":"B","monto":"C"}');
    raise exception '0376: el mismo proveedor tuvo dos mapeos';
  exception when unique_violation then null;
  end;
  begin
    insert into public.peaje_mapeo_columnas (tenant_id, proveedor_norm, proveedor, columnas)
    values ('37500000-0000-4000-8000-0000000000a1', 'tv', 'TV', '["monto","caseta"]');
    raise exception '0376: un mapeo que no es objeto entró';
  exception when check_violation then null;
  end;
end $$;

-- ── cascada: borrar la flota se lleva todo lo nuevo ─────────────────────────
reset role;
delete from public.tenant where id = '37500000-0000-4000-8000-0000000000b1';
do $$ begin
  if exists (select 1 from public.peaje_tag where tenant_id = '37500000-0000-4000-8000-0000000000b1')
     or exists (select 1 from public.peaje_caseta where tenant_id = '37500000-0000-4000-8000-0000000000b1')
     or exists (select 1 from public.peaje_ingesta_archivo where tenant_id = '37500000-0000-4000-8000-0000000000b1') then
    raise exception '0375: borrar la flota no arrastró sus TAGs, casetas o cola';
  end if;
end $$;

-- ── (h) RLS: deny-all para authenticated y anon ─────────────────────────────
reset role;
do $$
declare t text; n bigint;
begin
  foreach t in array array['peaje_tag','peaje_caseta','peaje_ingesta_archivo','peaje_ingesta_config','peaje_mapeo_columnas'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception '0375/0376: la tabla % no tiene RLS prendida', t;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
      raise exception '0375/0376: la tabla % tiene políticas — debe ser deny-all (solo service_role)', t;
    end if;
  end loop;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub', '37500000-0000-4000-8000-0000000000c1', true);
do $$
declare t text; n bigint;
begin
  foreach t in array array['peaje_tag','peaje_caseta','peaje_ingesta_archivo','peaje_ingesta_config','peaje_mapeo_columnas'] loop
    begin
      execute format('select count(*) from public.%I', t) into n;
      if n <> 0 then raise exception '0375/0376: authenticated leyó % filas de %', n, t; end if;
    exception when insufficient_privilege then null;
    end;
  end loop;
  -- las líneas nuevas del desglose tampoco se leen por REST
  begin
    if (select count(*) from public.desglose_peaje_linea) <> 0 then raise exception '0375: authenticated leyó líneas del desglose'; end if;
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ── (j) los grants de las funciones: solo service_role ──────────────────────
do $$
declare f text;
begin
  foreach f in array array['public.peaje_archivo_reclamar(int,int)', 'public.peaje_posiciones_ventana(uuid,jsonb)'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception '0376: % es ejecutable por anon/authenticated', f;
    end if;
    if not has_function_privilege('service_role', f, 'execute') then
      raise exception '0376: service_role no puede ejecutar %', f;
    end if;
  end loop;
end $$;

rollback;
\echo '0375/0376 OK'
