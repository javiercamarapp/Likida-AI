\set ON_ERROR_STOP on
-- 0803 — equivalencias texto→sitio y los dos criterios nuevos de viaje_sitio_derivado, contra Postgres REAL (datos sintéticos, rollback).
-- Lo que solo la base garantiza:
--   (a) UNIQUE (flota, texto, lado, cliente-o-ninguno): reimportar no duplica; el mismo texto con otro cliente u otro lado sí cabe;
--   (b) dominios: lado, tipo, y `tipo = 'sitio'` ⇔ hay sitio (una instrucción no lleva sitio; un sitio no puede faltar);
--   (c) el sitio es de la MISMA flota (FK compuesta) y borrar el sitio borra su equivalencia;
--   (d) RLS: una flota no ve las equivalencias de otra; la escritura solo la hace el servidor;
--   (e) viaje_sitio_derivado admite `equivalencia` y `equivalencia_sin_sitio` (sin sitio) y sigue rechazando criterios inventados;
--   (f) la migración se puede reaplicar sin error (se prueba en el arnés de CI; aquí el CHECK ya quedó con los 5 valores).
begin;

insert into public.tenant (id, nombre) values
  ('80300000-0000-4000-8000-0000000000a1', 'Flota A 0803'),
  ('80300000-0000-4000-8000-0000000000b1', 'Flota B 0803');
insert into public.geocerca (id, tenant_id, nombre, tipo, lat, lng, radio_m) values
  ('80300000-0000-4000-8000-0000000000e1', '80300000-0000-4000-8000-0000000000a1', 'Planta Demo', 'planta', 20.5, -103.3, 300),
  ('80300000-0000-4000-8000-0000000000e2', '80300000-0000-4000-8000-0000000000b1', 'Planta Ajena', 'planta', 21.5, -102.3, 300);
insert into public.cliente (id, tenant_id, nombre) values
  ('80300000-0000-4000-8000-0000000000c1', '80300000-0000-4000-8000-0000000000a1', 'Cliente Demo Uno'),
  ('80300000-0000-4000-8000-0000000000c2', '80300000-0000-4000-8000-0000000000a1', 'Cliente Demo Dos');
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('80300000-0000-4000-8000-000000000101', '80300000-0000-4000-8000-0000000000a1', 'Chofer A', '525500803001'); -- grep-limpio:ok
insert into public.viaje (id, tenant_id, operador_id, folio, estatus) values
  ('80300000-0000-4000-8000-000000000201', '80300000-0000-4000-8000-0000000000a1', '80300000-0000-4000-8000-000000000101', 'V-0803', 'abierto');
insert into public.app_user (id, tenant_id, email, rol) values
  ('80300000-0000-4000-8000-000000000401', '80300000-0000-4000-8000-0000000000a1', 'admin-0803@test.invalid', 'flota_admin');

do $$
declare
  ta constant uuid := '80300000-0000-4000-8000-0000000000a1';
  tb constant uuid := '80300000-0000-4000-8000-0000000000b1';
  ga constant uuid := '80300000-0000-4000-8000-0000000000e1';
  gb constant uuid := '80300000-0000-4000-8000-0000000000e2';
  c1 constant uuid := '80300000-0000-4000-8000-0000000000c1';
  c2 constant uuid := '80300000-0000-4000-8000-0000000000c2';
  v1 constant uuid := '80300000-0000-4000-8000-000000000201';
begin
  -- (a) unicidad
  insert into public.sitio_equivalencia (tenant_id, texto_normalizado, lado, geocerca_id, tipo) values (ta, 'stop planta demo final acero', 'ambos', ga, 'sitio');
  begin
    insert into public.sitio_equivalencia (tenant_id, texto_normalizado, lado, geocerca_id, tipo) values (ta, 'stop planta demo final acero', 'ambos', ga, 'sitio');
    raise exception '0803: duplicó la misma equivalencia (sin cliente)';
  exception when unique_violation then null; end;
  insert into public.sitio_equivalencia (tenant_id, texto_normalizado, lado, geocerca_id, tipo, cliente_id) values (ta, 'stop planta demo final acero', 'ambos', ga, 'sitio', c1);
  insert into public.sitio_equivalencia (tenant_id, texto_normalizado, lado, geocerca_id, tipo, cliente_id) values (ta, 'stop planta demo final acero', 'ambos', ga, 'sitio', c2);
  begin
    insert into public.sitio_equivalencia (tenant_id, texto_normalizado, lado, geocerca_id, tipo, cliente_id) values (ta, 'stop planta demo final acero', 'ambos', ga, 'sitio', c1);
    raise exception '0803: duplicó la misma equivalencia (mismo cliente)';
  exception when unique_violation then null; end;
  insert into public.sitio_equivalencia (tenant_id, texto_normalizado, lado, geocerca_id, tipo) values (ta, 'stop planta demo final acero', 'destino', ga, 'sitio'); -- otro lado: cabe
  insert into public.sitio_equivalencia (tenant_id, texto_normalizado, lado, geocerca_id, tipo) values (tb, 'stop planta demo final acero', 'ambos', gb, 'sitio'); -- otra flota: cabe

  -- (b) dominios
  insert into public.sitio_equivalencia (tenant_id, texto_normalizado, tipo) values (ta, 'vacio cliente demo', 'ignorar');
  insert into public.sitio_equivalencia (tenant_id, texto_normalizado, lado, tipo) values (ta, 'salir a ruta antes de las 7 pm', 'origen', 'sin_sitio');
  begin insert into public.sitio_equivalencia (tenant_id, texto_normalizado, lado, tipo) values (ta, 'x1', 'arriba', 'ignorar'); raise exception '0803: lado inventado'; exception when check_violation then null; end;
  begin insert into public.sitio_equivalencia (tenant_id, texto_normalizado, tipo) values (ta, 'x2', 'adivinar'); raise exception '0803: tipo inventado'; exception when check_violation then null; end;
  begin insert into public.sitio_equivalencia (tenant_id, texto_normalizado, tipo) values (ta, 'x3', 'sitio'); raise exception '0803: tipo sitio sin sitio'; exception when check_violation then null; end;
  begin insert into public.sitio_equivalencia (tenant_id, texto_normalizado, geocerca_id, tipo) values (ta, 'x4', ga, 'ignorar'); raise exception '0803: una instrucción con sitio'; exception when check_violation then null; end;
  begin insert into public.sitio_equivalencia (tenant_id, texto_normalizado, geocerca_id, tipo) values (ta, '', ga, 'sitio'); raise exception '0803: texto vacío'; exception when check_violation then null; end;

  -- (c) el sitio es de la misma flota
  begin insert into public.sitio_equivalencia (tenant_id, texto_normalizado, geocerca_id, tipo) values (ta, 'x5', gb, 'sitio'); raise exception '0803: ligó un sitio de otra flota'; exception when foreign_key_violation then null; end;

  -- (e) viaje_sitio_derivado: criterios nuevos
  insert into public.viaje_sitio_derivado (tenant_id, viaje_id, lado, geocerca_id, criterio) values (ta, v1, 'origen', ga, 'equivalencia');
  insert into public.viaje_sitio_derivado (tenant_id, viaje_id, lado, criterio) values (ta, v1, 'destino', 'equivalencia_sin_sitio');
  begin insert into public.viaje_sitio_derivado (tenant_id, viaje_id, lado, criterio) values (ta, v1, 'origen', 'adivinado'); raise exception '0803: criterio inventado'; exception when check_violation or unique_violation then null; end;
  delete from public.viaje_sitio_derivado where viaje_id = v1;
  insert into public.viaje_sitio_derivado (tenant_id, viaje_id, lado, geocerca_id, criterio) values (ta, v1, 'origen', ga, 'nombre_exacto'); -- los tres anteriores siguen valiendo
  insert into public.viaje_sitio_derivado (tenant_id, viaje_id, lado, geocerca_id, criterio) values (ta, v1, 'destino', ga, 'codigo');

  -- (c, cont.) borrar el sitio borra sus equivalencias
  delete from public.viaje_sitio_derivado where viaje_id = v1;
  delete from public.geocerca where id = ga;
  if exists (select 1 from public.sitio_equivalencia where geocerca_id = ga) then raise exception '0803: la equivalencia sobrevivió al sitio'; end if;
  if (select count(*) from public.sitio_equivalencia where tenant_id = ta) <> 2 then raise exception '0803: debían quedar solo las 2 instrucciones de la flota A'; end if;

  -- RLS activa y sin permisos para anon
  if not (select relrowsecurity from pg_class where oid = 'public.sitio_equivalencia'::regclass) then raise exception '0803: sin RLS'; end if;
  if has_table_privilege('anon', 'public.sitio_equivalencia', 'select') then raise exception '0803: anon puede leer'; end if;
  if has_table_privilege('authenticated', 'public.sitio_equivalencia', 'insert') then raise exception '0803: authenticated puede escribir'; end if;
end $$;

-- (d) RLS: la flota A ve solo lo suyo
set local role authenticated;
select set_config('request.jwt.claim.sub', '80300000-0000-4000-8000-000000000401', true);
do $$ begin
  if (select count(*) from public.sitio_equivalencia) <> 2
     or exists (select 1 from public.sitio_equivalencia where tenant_id = '80300000-0000-4000-8000-0000000000b1') then
    raise exception '0803: RLS dejó cruzar flotas (ve % filas)', (select count(*) from public.sitio_equivalencia);
  end if;
end $$;
reset role;

rollback;
