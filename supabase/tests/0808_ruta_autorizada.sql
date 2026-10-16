\set ON_ERROR_STOP on
-- 0808 — ruta_autorizada (T-A5-48), contra Postgres REAL (datos sintéticos, rollback).
-- Lo que solo la base garantiza:
--   (a) la URL: solo https y solo maps.app.goo.gl/… o google.com/maps…; rechaza http, otros dominios y los que los imitan;
--   (b) largos de corredor y sitios; sin cadenas vacías;
--   (c) unicidad POR FLOTA de (corredor, origen, destino) tratando el nulo como vacío; otra flota puede repetir;
--   (d) vigente_hasta y revisada_en son fechas y pueden ser nulas; borrar la flota borra sus rutas;
--   (e) RLS: una flota no ve las rutas de otra; authenticated no escribe; anon no lee;
--   (f) la migración se puede reaplicar sin error, sin duplicar la política ni perder filas (idempotente).
begin;

insert into public.tenant (id, nombre) values
  ('80800000-0000-4000-8000-0000000000a1', 'Flota A 0808'),
  ('80800000-0000-4000-8000-0000000000b1', 'Flota B 0808');
insert into public.app_user (id, tenant_id, email, rol) values
  ('80800000-0000-4000-8000-000000000401', '80800000-0000-4000-8000-0000000000a1', 'admin-0808@test.invalid', 'flota_admin');

do $$
declare
  ta constant uuid := '80800000-0000-4000-8000-0000000000a1';
  tb constant uuid := '80800000-0000-4000-8000-0000000000b1';
  x text;
begin
  -- (a) URL válidas
  foreach x in array array[
    'https://maps.app.goo.gl/EjemploSintetico1', 'https://www.google.com/maps/dir/Origen+Demo/Destino+Demo',
    'https://google.com/maps', 'https://google.com/maps?q=demo', 'https://www.google.com/maps/@20.1,-99.2,12z'
  ] loop
    insert into public.ruta_autorizada (tenant_id, corredor, sitio_origen, url) values (ta, 'c-' || md5(x), 'o', x);
  end loop;
  -- (a) URL inválidas
  foreach x in array array[
    'http://maps.app.goo.gl/abc', 'HTTPS://maps.app.goo.gl/abc', 'ftp://maps.app.goo.gl/abc', 'maps.app.goo.gl/abc', 'javascript:alert(1)',
    'https://example.com/maps', 'https://www.waze.com/ul?q=demo', 'https://maps.app.goo.gl.example.com/abc',
    'https://google.com.example.com/maps', 'https://maps.app.goo.gl@example.com/abc', 'https://www.google.com@example.com/maps',
    'https://google.com/mapsx', 'https://google.com/search?q=maps', 'https://maps.app.goo.gl/', 'https://goo.gl/abc',
    'https://maps.app.goo.gl:8443/abc', 'https://maps.app.goo.gl/a b', '', ' '
  ] loop
    begin
      insert into public.ruta_autorizada (tenant_id, corredor, url) values (ta, 'malo-' || md5(x), x);
      raise exception '0808: el CHECK dejó pasar la URL «%»', x;
    exception when check_violation then null; end;
  end loop;
  begin
    insert into public.ruta_autorizada (tenant_id, corredor, url) values (ta, 'largo', 'https://maps.app.goo.gl/' || repeat('a', 2100));
    raise exception '0808: URL de más de 2048';
  exception when check_violation then null; end;

  -- (b) largos y vacíos
  begin
    insert into public.ruta_autorizada (tenant_id, corredor, url) values (ta, '', 'https://maps.app.goo.gl/x');
    raise exception '0808: corredor vacío';
  exception when check_violation then null; end;
  begin
    insert into public.ruta_autorizada (tenant_id, corredor, url) values (ta, repeat('a', 81), 'https://maps.app.goo.gl/x');
    raise exception '0808: corredor de más de 80';
  exception when check_violation then null; end;
  begin
    insert into public.ruta_autorizada (tenant_id, corredor, sitio_origen, url) values (ta, 'k1', '', 'https://maps.app.goo.gl/x');
    raise exception '0808: sitio_origen vacío';
  exception when check_violation then null; end;
  begin
    insert into public.ruta_autorizada (tenant_id, corredor, sitio_destino, url) values (ta, 'k2', repeat('a', 81), 'https://maps.app.goo.gl/x');
    raise exception '0808: sitio_destino de más de 80';
  exception when check_violation then null; end;

  -- (c) unicidad por flota, nulo = vacío
  insert into public.ruta_autorizada (tenant_id, corredor, url) values (ta, 'monterrey', 'https://maps.app.goo.gl/c1');
  begin
    insert into public.ruta_autorizada (tenant_id, corredor, url) values (ta, 'monterrey', 'https://maps.app.goo.gl/c2');
    raise exception '0808: dos rutas de corredor completo para el mismo corredor';
  exception when unique_violation then null; end;
  insert into public.ruta_autorizada (tenant_id, corredor, sitio_origen, url) values (ta, 'monterrey', 'pl-1', 'https://maps.app.goo.gl/o1');
  insert into public.ruta_autorizada (tenant_id, corredor, sitio_destino, url) values (ta, 'monterrey', 'pl-1', 'https://maps.app.goo.gl/d1');
  insert into public.ruta_autorizada (tenant_id, corredor, sitio_origen, sitio_destino, url) values (ta, 'monterrey', 'pl-1', 'pl-1', 'https://maps.app.goo.gl/od1');
  begin
    insert into public.ruta_autorizada (tenant_id, corredor, sitio_origen, url) values (ta, 'monterrey', 'pl-1', 'https://maps.app.goo.gl/o2');
    raise exception '0808: dos rutas con el mismo corredor y origen';
  exception when unique_violation then null; end;
  insert into public.ruta_autorizada (tenant_id, corredor, url) values (tb, 'monterrey', 'https://maps.app.goo.gl/b1'); -- otra flota: cabe

  -- (d) fechas nulas o reales; borrar la flota borra sus rutas
  insert into public.ruta_autorizada (tenant_id, corredor, url, vigente_hasta, revisada_en) values (tb, 'laredo', 'https://maps.app.goo.gl/l1', '2027-01-31', '2026-10-01');
  begin
    insert into public.ruta_autorizada (tenant_id, corredor, url, vigente_hasta) values (tb, 'fecha', 'https://maps.app.goo.gl/f1', '2026-02-30');
    raise exception '0808: fecha imposible';
  exception when datetime_field_overflow then null; end;
  if (select count(*) from public.ruta_autorizada where tenant_id = tb and vigente_hasta is null) <> 1 then
    raise exception '0808: vigente_hasta no admite nulo o no se guardó la fecha';
  end if;
  delete from public.tenant where id = tb;
  if exists (select 1 from public.ruta_autorizada where tenant_id = tb) then raise exception '0808: las rutas sobrevivieron a la flota'; end if;

  -- (e) RLS activa y permisos
  if not (select relrowsecurity from pg_class where oid = 'public.ruta_autorizada'::regclass) then raise exception '0808: sin RLS'; end if;
  if has_table_privilege('anon', 'public.ruta_autorizada', 'select') then raise exception '0808: anon puede leer'; end if;
  if has_table_privilege('authenticated', 'public.ruta_autorizada', 'insert') then raise exception '0808: authenticated puede escribir'; end if;
  if has_table_privilege('authenticated', 'public.ruta_autorizada', 'update') then raise exception '0808: authenticated puede actualizar'; end if;
end $$;

-- (e) RLS: la flota A ve solo lo suyo (se siembra otra flota para comprobar el cruce)
insert into public.tenant (id, nombre) values ('80800000-0000-4000-8000-0000000000c1', 'Flota C 0808');
insert into public.ruta_autorizada (tenant_id, corredor, url) values
  ('80800000-0000-4000-8000-0000000000c1', 'otra-flota', 'https://maps.app.goo.gl/c1');

set local role authenticated;
select set_config('request.jwt.claim.sub', '80800000-0000-4000-8000-000000000401', true);
do $$ begin
  if exists (select 1 from public.ruta_autorizada where tenant_id = '80800000-0000-4000-8000-0000000000c1')
     or (select count(*) from public.ruta_autorizada) = 0 then
    raise exception '0808: RLS dejó cruzar flotas (ve % filas)', (select count(*) from public.ruta_autorizada);
  end if;
end $$;
reset role;

-- (f) reaplicar la migración: sin error, sin política duplicada y sin perder filas
do $$ begin
  create temp table if not exists _antes_0808 on commit drop as select count(*)::int as n from public.ruta_autorizada;
end $$;
\ir ../migrations/0808_ruta_autorizada.sql
do $$
begin
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'ruta_autorizada') <> 1 then
    raise exception '0808: reaplicar duplicó o perdió la política';
  end if;
  if (select count(*) from public.ruta_autorizada) <> (select n from _antes_0808) then
    raise exception '0808: reaplicar cambió las filas';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'ruta_autorizada' and indexname = 'ruta_autorizada_unica') then
    raise exception '0808: falta la unicidad por flota';
  end if;
  if (select count(*) from pg_constraint where conrelid = 'public.ruta_autorizada'::regclass and conname = 'ruta_autorizada_url_mapas') <> 1 then
    raise exception '0808: falta el CHECK de la URL';
  end if;
end $$;

rollback;
