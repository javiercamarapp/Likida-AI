\set ON_ERROR_STOP on
-- 0809 — cliente_documento_requerido (T-A5-52), contra Postgres REAL (datos sintéticos, rollback).
-- Lo que solo la base garantiza:
--   (a) tipo solo 'basico' o 'complementario'; nombre de 1 a 80 sin contar espacios de los extremos;
--   (b) firma y sello nacen en false;
--   (c) unicidad POR CLIENTE del nombre sin distinguir mayúsculas ni espacios de los extremos; otro cliente y otra flota pueden repetir;
--   (d) el cliente debe ser de la MISMA flota (llave compuesta); borrar el cliente o la flota borra sus documentos;
--   (e) RLS: una flota no ve los documentos de otra; authenticated no escribe; anon no lee;
--   (f) la migración se puede reaplicar sin error, sin duplicar la política ni perder filas (idempotente).
begin;

insert into public.tenant (id, nombre) values
  ('80900000-0000-4000-8000-0000000000a1', 'Flota A 0809'),
  ('80900000-0000-4000-8000-0000000000b1', 'Flota B 0809');
insert into public.app_user (id, tenant_id, email, rol) values
  ('80900000-0000-4000-8000-000000000401', '80900000-0000-4000-8000-0000000000a1', 'admin-0809@test.invalid', 'flota_admin');
insert into public.cliente (id, tenant_id, nombre) values
  ('80900000-0000-4000-8000-0000000000c1', '80900000-0000-4000-8000-0000000000a1', 'Cliente demo 1'),
  ('80900000-0000-4000-8000-0000000000c2', '80900000-0000-4000-8000-0000000000a1', 'Cliente demo 2'),
  ('80900000-0000-4000-8000-0000000000c3', '80900000-0000-4000-8000-0000000000b1', 'Cliente demo 1');

do $$
declare
  ta constant uuid := '80900000-0000-4000-8000-0000000000a1';
  tb constant uuid := '80900000-0000-4000-8000-0000000000b1';
  c1 constant uuid := '80900000-0000-4000-8000-0000000000c1';
  c2 constant uuid := '80900000-0000-4000-8000-0000000000c2';
  c3 constant uuid := '80900000-0000-4000-8000-0000000000c3';
begin
  -- (a) dominio
  insert into public.cliente_documento_requerido (tenant_id, cliente_id, nombre, tipo) values (ta, c1, 'Documento demo A', 'basico');
  insert into public.cliente_documento_requerido (tenant_id, cliente_id, nombre, tipo) values (ta, c1, 'Documento demo B', 'complementario');
  begin
    insert into public.cliente_documento_requerido (tenant_id, cliente_id, nombre, tipo) values (ta, c1, 'Documento demo C', 'otro');
    raise exception '0809: tipo fuera de dominio';
  exception when check_violation then null; end;
  begin
    insert into public.cliente_documento_requerido (tenant_id, cliente_id, nombre, tipo) values (ta, c1, '   ', 'basico');
    raise exception '0809: nombre en blanco';
  exception when check_violation then null; end;
  begin
    insert into public.cliente_documento_requerido (tenant_id, cliente_id, nombre, tipo) values (ta, c1, repeat('a', 81), 'basico');
    raise exception '0809: nombre de mas de 80';
  exception when check_violation then null; end;
  insert into public.cliente_documento_requerido (tenant_id, cliente_id, nombre, tipo) values (ta, c1, repeat('a', 80), 'basico');

  -- (b) firma y sello nacen en false
  if exists (select 1 from public.cliente_documento_requerido where nombre = 'Documento demo A' and (requiere_firma or requiere_sello)) then
    raise exception '0809: firma o sello no nacen en false';
  end if;
  insert into public.cliente_documento_requerido (tenant_id, cliente_id, nombre, tipo, requiere_firma, requiere_sello) values (ta, c1, 'Documento firmado', 'basico', true, true);

  -- (c) unicidad por cliente, sin distinguir mayúsculas ni extremos
  begin
    insert into public.cliente_documento_requerido (tenant_id, cliente_id, nombre, tipo) values (ta, c1, ' DOCUMENTO DEMO a ', 'complementario');
    raise exception '0809: el mismo nombre se repitio dentro del cliente';
  exception when unique_violation then null; end;
  insert into public.cliente_documento_requerido (tenant_id, cliente_id, nombre, tipo) values (ta, c2, 'Documento demo A', 'basico'); -- otro cliente: cabe
  insert into public.cliente_documento_requerido (tenant_id, cliente_id, nombre, tipo) values (tb, c3, 'Documento demo A', 'basico'); -- otra flota: cabe

  -- (d) el cliente tiene que ser de la misma flota
  begin
    insert into public.cliente_documento_requerido (tenant_id, cliente_id, nombre, tipo) values (ta, c3, 'Cruzado', 'basico');
    raise exception '0809: un documento colgo del cliente de otra flota';
  exception when foreign_key_violation then null; end;
  delete from public.cliente where id = c2;
  if exists (select 1 from public.cliente_documento_requerido where cliente_id = c2) then raise exception '0809: los documentos sobrevivieron al cliente'; end if;
  delete from public.tenant where id = tb;
  if exists (select 1 from public.cliente_documento_requerido where tenant_id = tb) then raise exception '0809: los documentos sobrevivieron a la flota'; end if;

  -- (e) RLS activa y permisos
  if not (select relrowsecurity from pg_class where oid = 'public.cliente_documento_requerido'::regclass) then raise exception '0809: sin RLS'; end if;
  if has_table_privilege('anon', 'public.cliente_documento_requerido', 'select') then raise exception '0809: anon puede leer'; end if;
  if has_table_privilege('authenticated', 'public.cliente_documento_requerido', 'insert') then raise exception '0809: authenticated puede escribir'; end if;
  if has_table_privilege('authenticated', 'public.cliente_documento_requerido', 'update') then raise exception '0809: authenticated puede actualizar'; end if;
  if has_table_privilege('authenticated', 'public.cliente_documento_requerido', 'delete') then raise exception '0809: authenticated puede borrar'; end if;
end $$;

-- (e) RLS: la flota A ve solo lo suyo (se siembra otra flota para comprobar el cruce)
insert into public.tenant (id, nombre) values ('80900000-0000-4000-8000-0000000000d1', 'Flota D 0809');
insert into public.cliente (id, tenant_id, nombre) values ('80900000-0000-4000-8000-0000000000d2', '80900000-0000-4000-8000-0000000000d1', 'Cliente ajeno');
insert into public.cliente_documento_requerido (tenant_id, cliente_id, nombre, tipo) values
  ('80900000-0000-4000-8000-0000000000d1', '80900000-0000-4000-8000-0000000000d2', 'Documento ajeno', 'basico');

set local role authenticated;
select set_config('request.jwt.claim.sub', '80900000-0000-4000-8000-000000000401', true);
do $$ begin
  if exists (select 1 from public.cliente_documento_requerido where tenant_id = '80900000-0000-4000-8000-0000000000d1')
     or (select count(*) from public.cliente_documento_requerido) = 0 then
    raise exception '0809: RLS dejo cruzar flotas (ve % filas)', (select count(*) from public.cliente_documento_requerido);
  end if;
end $$;
reset role;

-- (f) reaplicar la migración: sin error, sin política duplicada y sin perder filas
do $$ begin
  create temp table if not exists _antes_0809 on commit drop as select count(*)::int as n from public.cliente_documento_requerido;
end $$;
\ir ../migrations/0809_catalogo_documentos_cliente.sql
do $$
begin
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'cliente_documento_requerido') <> 1 then
    raise exception '0809: reaplicar duplico o perdio la politica';
  end if;
  if (select count(*) from public.cliente_documento_requerido) <> (select n from _antes_0809) then
    raise exception '0809: reaplicar cambio las filas';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'cliente_documento_requerido' and indexname = 'cliente_documento_requerido_unico') then
    raise exception '0809: falta la unicidad por cliente';
  end if;
  if (select count(*) from pg_constraint where conrelid = 'public.cliente_documento_requerido'::regclass and conname = 'cliente_documento_requerido_tipo') <> 1 then
    raise exception '0809: falta el CHECK de tipo';
  end if;
end $$;

rollback;
