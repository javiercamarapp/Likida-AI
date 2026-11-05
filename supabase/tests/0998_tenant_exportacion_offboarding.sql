\set ON_ERROR_STOP on
-- 0998 — tenant_exportacion contra Postgres REAL: forma, transiciones solo hacia adelante, columnas inmutables y privilegios. Termina en rollback.
begin;

do $$
declare
  ten constant uuid := '99800000-0000-4000-8000-0000000000b1';
  usr constant uuid := '99800000-0000-4000-8000-0000000000a1';
  h constant text := repeat('ab', 32);
  id1 uuid; n int; est text;
begin
  -- 1. Nace 'generado'.
  insert into public.tenant_exportacion (tenant_id, solicitado_por, filas_total, manifiesto, huella_sha256)
    values (ten, usr, 12, '{"archivos":[]}'::jsonb, h) returning id into id1;
  select estado into est from public.tenant_exportacion where id = id1;
  if est <> 'generado' then raise exception '0998(1): debia nacer generado, nacio %', est; end if;

  -- 2. Forma: huella invalida, manifiesto que no es objeto, filas negativas, estado fuera de lista.
  begin insert into public.tenant_exportacion (tenant_id, solicitado_por, filas_total, manifiesto, huella_sha256) values (ten, usr, 1, '{}'::jsonb, 'XYZ'); raise exception '0998(2): huella invalida debia rebotar';
  exception when check_violation then null; end;
  begin insert into public.tenant_exportacion (tenant_id, solicitado_por, filas_total, manifiesto, huella_sha256) values (ten, usr, 1, '[]'::jsonb, h); raise exception '0998(2): manifiesto no objeto debia rebotar';
  exception when check_violation then null; end;
  begin insert into public.tenant_exportacion (tenant_id, solicitado_por, filas_total, manifiesto, huella_sha256) values (ten, usr, -1, '{}'::jsonb, h); raise exception '0998(2): filas negativas debian rebotar';
  exception when check_violation then null; end;
  begin insert into public.tenant_exportacion (tenant_id, solicitado_por, filas_total, manifiesto, huella_sha256, estado) values (ten, usr, 1, '{}'::jsonb, h, 'perdido'); raise exception '0998(2): estado invalido debia rebotar';
  exception when check_violation then null; end;

  -- 3. Transiciones: generado -> entregado -> purgado; no se regresa.
  update public.tenant_exportacion set estado = 'entregado', entregado_en = now() where id = id1;
  begin update public.tenant_exportacion set estado = 'generado' where id = id1; raise exception '0998(3): regresar a generado debia rebotar';
  exception when invalid_parameter_value then null; end;
  update public.tenant_exportacion set estado = 'purgado' where id = id1;
  begin update public.tenant_exportacion set estado = 'entregado' where id = id1; raise exception '0998(3): salir de purgado debia rebotar';
  exception when invalid_parameter_value then null; end;

  -- 4. Inmutables: huella, manifiesto, filas y flota no cambian.
  begin update public.tenant_exportacion set huella_sha256 = repeat('cd', 32) where id = id1; raise exception '0998(4): cambiar la huella debia rebotar';
  exception when insufficient_privilege then null; end;
  begin update public.tenant_exportacion set manifiesto = '{"x":1}'::jsonb where id = id1; raise exception '0998(4): cambiar el manifiesto debia rebotar';
  exception when insufficient_privilege then null; end;
  begin update public.tenant_exportacion set tenant_id = usr where id = id1; raise exception '0998(4): cambiar la flota debia rebotar';
  exception when insufficient_privilege then null; end;

  -- 5. Seguridad.
  if not (select relrowsecurity from pg_class where oid = 'public.tenant_exportacion'::regclass) then raise exception '0998(5): RLS debia estar prendida'; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'tenant_exportacion';
  if n <> 0 then raise exception '0998(5): no debe haber politicas, hay %', n; end if;
  select count(*) into n from unnest(array['anon', 'authenticated']) r
   where has_table_privilege(r, 'public.tenant_exportacion', 'select,insert,update,delete,truncate,references,trigger');
  if n <> 0 then raise exception '0998(5): anon/authenticated no deben tener privilegios (hay %)', n; end if;
  if not has_table_privilege('service_role', 'public.tenant_exportacion', 'select,insert,update') then raise exception '0998(5): service_role debia leer, insertar y actualizar'; end if;
  if has_table_privilege('service_role', 'public.tenant_exportacion', 'delete') then raise exception '0998(5): service_role no debe borrar constancias'; end if;
end $$;

rollback;
