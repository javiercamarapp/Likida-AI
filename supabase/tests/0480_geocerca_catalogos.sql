\set ON_ERROR_STOP on
-- 0480 — `geocerca` con dos catálogos (peajes / conductor), contra Postgres REAL.
--
-- Lo que SOLO la base puede demostrar:
--   (a) una fila nace en el catálogo que su tipo, su código o su fuente delatan; el importador de la 0385
--       (que no sabe nada de `catalogo`) deja sus filas en `conductor`;
--   (b) el catálogo es inmutable (UPDATE directo y upsert por (tenant, nombre) rebotan);
--   (c) el CHECK de pareja: un sitio del Conductor no puede volverse `restringida`/`origen`/`destino`, y una
--       geocerca de peajes no puede volverse `planta`/`cliente`/`anden`;
--   (d) EL CHOQUE DE LA RONDA 02: el upsert por (tenant, nombre) del editor de peajes sobre el nombre de un
--       sitio del Conductor NO cambia su tipo ni sus coordenadas;
--   (e) el nombre sigue único por flota entre los dos catálogos, y otra flota puede repetirlo.
begin;

insert into public.tenant (id, nombre) values
  ('48000000-0000-4000-8000-0000000000a1', 'Flota A 0480'),
  ('48000000-0000-4000-8000-0000000000b1', 'Flota B 0480');

-- (a) por tipo, por código, por fuente, y por omisión (peajes).
insert into public.geocerca (id, tenant_id, nombre, tipo, lat, lng, radio_m, codigo, fuente) values
  ('48000000-0000-4000-8000-0000000000f1', '48000000-0000-4000-8000-0000000000a1', 'Planta Zapopan', 'planta', 20.72, -103.39, 300, 'PL-ZAP', 'csv'),
  ('48000000-0000-4000-8000-0000000000f2', '48000000-0000-4000-8000-0000000000a1', 'Patio con código', 'patio', 20.70, -103.30, 200, 'PT-1', 'manual');
insert into public.geocerca (id, tenant_id, nombre, tipo, lat, lng, radio_m) values
  ('48000000-0000-4000-8000-0000000000f3', '48000000-0000-4000-8000-0000000000a1', 'Caseta Zapotlanejo', 'restringida', 20.62, -103.07, 500),
  ('48000000-0000-4000-8000-0000000000f4', '48000000-0000-4000-8000-0000000000a1', 'Patio sin código', 'patio', 20.60, -103.20, 150);
-- El editor manual del Conductor declara su catálogo para un patio sin código.
insert into public.geocerca (id, tenant_id, nombre, tipo, lat, lng, radio_m, catalogo) values
  ('48000000-0000-4000-8000-0000000000f5', '48000000-0000-4000-8000-0000000000a1', 'Patio del Conductor', 'patio', 20.61, -103.21, 150, 'conductor');

do $$ declare c text; begin
  select catalogo into c from public.geocerca where id = '48000000-0000-4000-8000-0000000000f1';
  if c <> 'conductor' then raise exception '0480: una planta con código CSV no nació en conductor (%)', c; end if;
  select catalogo into c from public.geocerca where id = '48000000-0000-4000-8000-0000000000f2';
  if c <> 'conductor' then raise exception '0480: un patio con código no nació en conductor (%)', c; end if;
  select catalogo into c from public.geocerca where id = '48000000-0000-4000-8000-0000000000f3';
  if c <> 'peajes' then raise exception '0480: una restringida no nació en peajes (%)', c; end if;
  select catalogo into c from public.geocerca where id = '48000000-0000-4000-8000-0000000000f4';
  if c <> 'peajes' then raise exception '0480: un patio sin código ni catálogo no nació en peajes por omisión (%)', c; end if;
  select catalogo into c from public.geocerca where id = '48000000-0000-4000-8000-0000000000f5';
  if c <> 'conductor' then raise exception '0480: un patio declarado conductor no quedó en conductor (%)', c; end if;
end $$;

-- (a2) el importador de la 0385 (no sabe de `catalogo`) deja todo en conductor.
insert into public.cliente (id, tenant_id, nombre) values ('48000000-0000-4000-8000-0000000000e1', '48000000-0000-4000-8000-0000000000a1', 'Cliente A');
do $$ declare r jsonb; c text; begin
  r := public.importar_sitios_conductor('48000000-0000-4000-8000-0000000000a1',
    '[{"linea":2,"codigo":"AN-9","nombre":"Andén 9","tipo":"anden","lat":20.7,"lng":-103.3,"radio_m":40,"direccion":"","cliente":"","padre":""}]'::jsonb);
  if (r->>'ok')::boolean is not true then raise exception '0480: el importador falló: %', r; end if;
  select catalogo into c from public.geocerca where tenant_id = '48000000-0000-4000-8000-0000000000a1' and codigo = 'AN-9';
  if c <> 'conductor' then raise exception '0480: el importador dejó un sitio en %', c; end if;
end $$;

-- (b) catálogo inmutable.
do $$ begin
  begin
    update public.geocerca set catalogo = 'peajes' where id = '48000000-0000-4000-8000-0000000000f1';
    raise exception '0480: un sitio del Conductor cambió de dueño por UPDATE';
  exception when check_violation then null; end;
  begin
    update public.geocerca set catalogo = 'conductor' where id = '48000000-0000-4000-8000-0000000000f4';
    raise exception '0480: una geocerca de peajes cambió de dueño por UPDATE';
  exception when check_violation then null; end;
  begin
    update public.geocerca set catalogo = 'otro' where id = '48000000-0000-4000-8000-0000000000f4';
    raise exception '0480: aceptó un catálogo inventado';
  exception when check_violation then null; end;
end $$;

-- (c) el CHECK de pareja.
do $$ begin
  begin
    update public.geocerca set tipo = 'restringida' where id = '48000000-0000-4000-8000-0000000000f1';
    raise exception '0480: un sitio del Conductor se volvió restringida';
  exception when check_violation then null; end;
  begin
    update public.geocerca set tipo = 'origen' where id = '48000000-0000-4000-8000-0000000000f5';
    raise exception '0480: un patio del Conductor se volvió origen';
  exception when check_violation then null; end;
  begin
    update public.geocerca set tipo = 'planta' where id = '48000000-0000-4000-8000-0000000000f3';
    raise exception '0480: una geocerca de peajes se volvió planta';
  exception when check_violation then null; end;
  -- Dentro de su catálogo SÍ puede cambiar (patio ↔ punto_interes es de los dos).
  update public.geocerca set tipo = 'punto_interes' where id = '48000000-0000-4000-8000-0000000000f4';
  update public.geocerca set tipo = 'anden' where id = '48000000-0000-4000-8000-0000000000f5';
end $$;

-- (d) EL CHOQUE: el upsert del editor de peajes sobre el nombre de un sitio del Conductor.
do $$ declare t text; lat0 double precision; begin
  begin
    insert into public.geocerca (tenant_id, nombre, tipo, lat, lng, radio_m, activa, catalogo)
    values ('48000000-0000-4000-8000-0000000000a1', 'Planta Zapopan', 'origen', 1, 1, 100, true, 'peajes')
    on conflict (tenant_id, nombre) do update
      set tipo = excluded.tipo, lat = excluded.lat, lng = excluded.lng, radio_m = excluded.radio_m, catalogo = excluded.catalogo;
    raise exception '0480: el upsert de peajes pisó un sitio del Conductor';
  exception when check_violation then null; end;
  -- Aunque el upsert no nombrara el catálogo en el SET, el CHECK de pareja frena el cambio de tipo.
  begin
    insert into public.geocerca (tenant_id, nombre, tipo, lat, lng, radio_m, activa)
    values ('48000000-0000-4000-8000-0000000000a1', 'Planta Zapopan', 'restringida', 1, 1, 100, true)
    on conflict (tenant_id, nombre) do update set tipo = excluded.tipo;
    raise exception '0480: el upsert (sin catálogo) cambió el tipo de un sitio del Conductor';
  exception when check_violation then null; end;
  select tipo, lat into t, lat0 from public.geocerca where id = '48000000-0000-4000-8000-0000000000f1';
  if t <> 'planta' or lat0 <> 20.72 then raise exception '0480: el sitio quedó alterado (% %)', t, lat0; end if;
end $$;

-- (e) nombre único entre catálogos; otra flota puede repetirlo.
do $$ begin
  begin
    insert into public.geocerca (tenant_id, nombre, tipo, lat, lng, radio_m, catalogo)
    values ('48000000-0000-4000-8000-0000000000a1', 'Caseta Zapotlanejo', 'patio', 20, -103, 100, 'conductor');
    raise exception '0480: dos catálogos repitieron un nombre en la misma flota';
  exception when unique_violation then null; end;
  insert into public.geocerca (tenant_id, nombre, tipo, lat, lng, radio_m)
  values ('48000000-0000-4000-8000-0000000000b1', 'Caseta Zapotlanejo', 'restringida', 20, -103, 100);
end $$;

-- La función del disparador no la ejecuta nadie desde la API.
set local role authenticated;
do $$ begin
  begin
    perform public.geocerca_catalogo_guardia();
    raise exception '0480: authenticated ejecutó la función del disparador';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

rollback;
\echo 0480_geocerca_catalogos: PASS
