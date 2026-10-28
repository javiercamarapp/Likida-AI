\set ON_ERROR_STOP on
-- 0936 — peaje_regla_flota, contra Postgres REAL.
-- Lo que solo la base garantiza: una fila por flota; clase_uno admite solo 'todas' | 'declaradas'; las clases del
-- utilitario van de 1 a 12 y no más de 12; borrar la flota borra su fila; la tabla nace con RLS prendida, SIN acceso
-- directo para anon/authenticated y con grant explícito a service_role. Idempotencia: quien corre este archivo aplica
-- la migración dos veces sin error.
begin;

insert into public.tenant (id, nombre) values
  ('93600000-0000-4000-8000-0000000000a1', 'Flota A 0936'),
  ('93600000-0000-4000-8000-0000000000b1', 'Flota B 0936');

do $$
declare
  A constant uuid := '93600000-0000-4000-8000-0000000000a1';
  B constant uuid := '93600000-0000-4000-8000-0000000000b1';
  n int;
begin
  -- defaults de la fila
  insert into public.peaje_regla_flota (tenant_id) values (A);
  select count(*) into n from public.peaje_regla_flota
   where tenant_id = A and clase_uno = 'todas' and clases_utilitario = '{}';
  if n <> 1 then raise exception '0936: los defaults no son «todas» y lista vacía'; end if;

  -- una fila por flota
  begin
    insert into public.peaje_regla_flota (tenant_id) values (A);
    raise exception '0936: admitió dos filas para la misma flota';
  exception when unique_violation then null; end;

  -- dominio de clase_uno
  begin
    insert into public.peaje_regla_flota (tenant_id, clase_uno) values (B, 'quizas');
    raise exception '0936: clase_uno admitió un valor fuera del dominio';
  exception when check_violation then null; end;

  -- clases del utilitario: 1..12
  insert into public.peaje_regla_flota (tenant_id, clases_utilitario, clase_uno) values (B, '{1,2,12}', 'declaradas');
  begin
    update public.peaje_regla_flota set clases_utilitario = '{0}' where tenant_id = B;
    raise exception '0936: admitió la clase 0';
  exception when check_violation then null; end;
  begin
    update public.peaje_regla_flota set clases_utilitario = '{13}' where tenant_id = B;
    raise exception '0936: admitió la clase 13';
  exception when check_violation then null; end;
  begin
    update public.peaje_regla_flota set clases_utilitario = '{1,2,3,4,5,6,7,8,9,10,11,12,1}' where tenant_id = B;
    raise exception '0936: admitió más de 12 clases';
  exception when check_violation then null; end;

  -- RLS prendida y permisos
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relname = 'peaje_regla_flota' and c.relrowsecurity;
  if n <> 1 then raise exception '0936: la tabla no tiene RLS'; end if;
  if has_table_privilege('anon', 'public.peaje_regla_flota', 'select') or has_table_privilege('authenticated', 'public.peaje_regla_flota', 'select') then
    raise exception '0936: anon/authenticated tienen acceso directo';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    if not (has_table_privilege('service_role', 'public.peaje_regla_flota', 'select')
        and has_table_privilege('service_role', 'public.peaje_regla_flota', 'insert')
        and has_table_privilege('service_role', 'public.peaje_regla_flota', 'update')
        and has_table_privilege('service_role', 'public.peaje_regla_flota', 'delete')) then
      raise exception '0936: service_role no tiene el grant explícito';
    end if;
  end if;

  -- borrar la flota borra su fila
  delete from public.tenant where id = B;
  select count(*) into n from public.peaje_regla_flota where tenant_id = B;
  if n <> 0 then raise exception '0936: borrar la flota no borró su fila'; end if;
end $$;

rollback;
