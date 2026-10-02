\set ON_ERROR_STOP on
-- 0677 — VIGÍA, correctiva de la ronda 17: el `encargado` ya no lee por PostgREST la lista de directores ni los correos de respaldo.
-- Postgres REAL, datos sintéticos, rollback.
--   (a) el dueño (flota_admin) lee los directores y los correos de SU flota, y solo los suyos;
--   (b) el encargado y el contador no leen NADA (ni filas ni teléfonos ni correos completos);
--   (c) un dueño de otra flota no ve los de ésta;
--   (d) `es_dueno_flota()` no es ejecutable por anon.
begin;

insert into public.tenant (id, nombre) values
  ('67700000-0000-4000-8000-0000000000a1', 'Flota A 0677'),
  ('67700000-0000-4000-8000-0000000000b1', 'Flota B 0677');
insert into public.cliente (id, tenant_id, nombre) values
  ('67700000-0000-4000-8000-0000000000a2', '67700000-0000-4000-8000-0000000000a1', 'Cliente A'),
  ('67700000-0000-4000-8000-0000000000b2', '67700000-0000-4000-8000-0000000000b1', 'Cliente B');
insert into public.app_user (id, tenant_id, email, rol) values
  ('67700000-0000-4000-8000-0000000000c1', '67700000-0000-4000-8000-0000000000a1', 'dueno-0677@test.invalid', 'flota_admin'),
  ('67700000-0000-4000-8000-0000000000c2', '67700000-0000-4000-8000-0000000000a1', 'encargado-0677@test.invalid', 'encargado'),
  ('67700000-0000-4000-8000-0000000000c3', '67700000-0000-4000-8000-0000000000a1', 'contador-0677@test.invalid', 'contador'),
  ('67700000-0000-4000-8000-0000000000c4', '67700000-0000-4000-8000-0000000000b1', 'dueno-b-0677@test.invalid', 'flota_admin');

set local role service_role;
insert into public.vigia_contacto (id, tenant_id, cliente_id, telefono, telefono_hash, nombre, consentimiento_en, consentimiento_origen) values
  ('67700000-0000-4000-8000-0000000000d1', '67700000-0000-4000-8000-0000000000a1', '67700000-0000-4000-8000-0000000000a2', '525577000001', repeat('a', 64), 'Compras A', now(), 'alta_flota'),
  ('67700000-0000-4000-8000-0000000000d2', '67700000-0000-4000-8000-0000000000b1', '67700000-0000-4000-8000-0000000000b2', '525577000002', repeat('b', 64), 'Compras B', now(), 'alta_flota');
insert into public.vigia_conversacion (id, tenant_id, contacto_id, cliente_id) values
  ('67700000-0000-4000-8000-0000000000e1', '67700000-0000-4000-8000-0000000000a1', '67700000-0000-4000-8000-0000000000d1', '67700000-0000-4000-8000-0000000000a2'),
  ('67700000-0000-4000-8000-0000000000e2', '67700000-0000-4000-8000-0000000000b1', '67700000-0000-4000-8000-0000000000d2', '67700000-0000-4000-8000-0000000000b2');
select public.vigia_director_guardar('67700000-0000-4000-8000-0000000000a1', null, 1, 'Ana', '525511110677', 'ana@a.test.invalid', null);
select public.vigia_director_guardar('67700000-0000-4000-8000-0000000000b1', null, 1, 'Beto', '525511110678', 'beto@b.test.invalid', null);
select public.vigia_correo_reclamar('67700000-0000-4000-8000-0000000000a1', '67700000-0000-4000-8000-0000000000e1', 'k-a', 1, null, 'ana@a.test.invalid', '{}');
select public.vigia_correo_reclamar('67700000-0000-4000-8000-0000000000b1', '67700000-0000-4000-8000-0000000000e2', 'k-b', 1, null, 'beto@b.test.invalid', '{}');
reset role;

-- (a) el dueño de A
do $$ begin perform set_config('request.jwt.claims', '{"sub":"67700000-0000-4000-8000-0000000000c1","role":"authenticated"}', true); end $$;
set local role authenticated;
do $$
begin
  if (select count(*) from public.vigia_director where telefono = '525511110677' and correo = 'ana@a.test.invalid') <> 1 then raise exception '0677: el dueño no lee a sus directores'; end if;
  if (select count(*) from public.vigia_aviso_correo where destino_correo = 'ana@a.test.invalid') <> 1 then raise exception '0677: el dueño no lee los correos de su flota'; end if;
  if exists (select 1 from public.vigia_director where tenant_id = '67700000-0000-4000-8000-0000000000b1')
     or exists (select 1 from public.vigia_aviso_correo where tenant_id = '67700000-0000-4000-8000-0000000000b1') then
    raise exception '0677: el dueño de A ve datos de la flota B';
  end if;
end $$;
reset role;

-- (b) el encargado y el contador: nada
do $$ begin perform set_config('request.jwt.claims', '{"sub":"67700000-0000-4000-8000-0000000000c2","role":"authenticated"}', true); end $$;
set local role authenticated;
do $$
begin
  if exists (select 1 from public.vigia_director) then raise exception '0677: el encargado lee la lista de directores'; end if;
  if exists (select 1 from public.vigia_director where telefono is not null or correo is not null) then raise exception '0677: el encargado lee teléfonos o correos'; end if;
  if exists (select 1 from public.vigia_aviso_correo) then raise exception '0677: el encargado lee los correos de respaldo'; end if;
end $$;
reset role;
do $$ begin perform set_config('request.jwt.claims', '{"sub":"67700000-0000-4000-8000-0000000000c3","role":"authenticated"}', true); end $$;
set local role authenticated;
do $$
begin
  if exists (select 1 from public.vigia_director) or exists (select 1 from public.vigia_aviso_correo) then raise exception '0677: el contador lee directores o correos'; end if;
end $$;
reset role;

-- (c) el dueño de B no ve los de A
do $$ begin perform set_config('request.jwt.claims', '{"sub":"67700000-0000-4000-8000-0000000000c4","role":"authenticated"}', true); end $$;
set local role authenticated;
do $$
begin
  if exists (select 1 from public.vigia_director where tenant_id = '67700000-0000-4000-8000-0000000000a1')
     or exists (select 1 from public.vigia_aviso_correo where tenant_id = '67700000-0000-4000-8000-0000000000a1') then
    raise exception '0677: el dueño de B ve datos de la flota A';
  end if;
  if (select count(*) from public.vigia_director) <> 1 then raise exception '0677: el dueño de B debía ver solo a su director'; end if;
end $$;
reset role;

-- (d) permisos de la función
do $$
begin
  if has_function_privilege('anon', 'public.es_dueno_flota()', 'execute') or has_function_privilege('public', 'public.es_dueno_flota()', 'execute') then
    raise exception '0677: es_dueno_flota no debe ser ejecutable por anon/public';
  end if;
end $$;

rollback;
\echo 0677_vigia_directores_solo_dueno PASS
