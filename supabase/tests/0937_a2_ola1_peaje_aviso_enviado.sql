\set ON_ERROR_STOP on
-- 0937 — peaje_aviso_enviado, contra Postgres REAL.
-- Lo que solo la base garantiza: el sello es único por (flota, tipo, clave) —el compare-and-set de «avisar una sola
-- vez»—, el tipo admite solo plazo | recordatorio_archivo, la clave de 1 a 120 caracteres, borrar la flota borra sus
-- sellos y la tabla nace con RLS, sin acceso directo para anon/authenticated y con grant explícito a service_role.
begin;

insert into public.tenant (id, nombre) values
  ('93700000-0000-4000-8000-0000000000a1', 'Flota A 0937'),
  ('93700000-0000-4000-8000-0000000000b1', 'Flota B 0937');

do $$
declare
  A constant uuid := '93700000-0000-4000-8000-0000000000a1';
  B constant uuid := '93700000-0000-4000-8000-0000000000b1';
  n int;
begin
  insert into public.peaje_aviso_enviado (tenant_id, tipo, clave) values (A, 'plazo', 'd1:30'), (A, 'plazo', 'd1:7'), (B, 'plazo', 'd1:30');
  insert into public.peaje_aviso_enviado (tenant_id, tipo, clave) values (A, 'recordatorio_archivo', '2026-09-21/2026-09-30');

  -- el segundo intento por la misma (flota, tipo, clave) choca: así se reserva «una sola vez»
  begin
    insert into public.peaje_aviso_enviado (tenant_id, tipo, clave) values (A, 'plazo', 'd1:30');
    raise exception '0937: admitió el mismo aviso dos veces';
  exception when unique_violation then null; end;
  -- ...y con on conflict do nothing el compare-and-set devuelve 0 filas
  insert into public.peaje_aviso_enviado (tenant_id, tipo, clave) values (A, 'plazo', 'd1:30') on conflict do nothing;
  get diagnostics n = row_count;
  if n <> 0 then raise exception '0937: on conflict do nothing insertó %', n; end if;

  begin
    insert into public.peaje_aviso_enviado (tenant_id, tipo, clave) values (A, 'spam', 'x');
    raise exception '0937: el tipo admitió un valor fuera del dominio';
  exception when check_violation then null; end;
  begin
    insert into public.peaje_aviso_enviado (tenant_id, tipo, clave) values (A, 'plazo', '');
    raise exception '0937: la clave admitió la cadena vacía';
  exception when check_violation then null; end;
  begin
    insert into public.peaje_aviso_enviado (tenant_id, tipo, clave) values (A, 'plazo', repeat('x', 121));
    raise exception '0937: la clave admitió más de 120 caracteres';
  exception when check_violation then null; end;

  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relname = 'peaje_aviso_enviado' and c.relrowsecurity;
  if n <> 1 then raise exception '0937: la tabla no tiene RLS'; end if;
  if has_table_privilege('anon', 'public.peaje_aviso_enviado', 'select') or has_table_privilege('authenticated', 'public.peaje_aviso_enviado', 'select') then
    raise exception '0937: anon/authenticated tienen acceso directo';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    if not (has_table_privilege('service_role', 'public.peaje_aviso_enviado', 'select')
        and has_table_privilege('service_role', 'public.peaje_aviso_enviado', 'insert')
        and has_table_privilege('service_role', 'public.peaje_aviso_enviado', 'update')
        and has_table_privilege('service_role', 'public.peaje_aviso_enviado', 'delete')) then
      raise exception '0937: service_role no tiene el grant explícito';
    end if;
  end if;

  delete from public.tenant where id = B;
  select count(*) into n from public.peaje_aviso_enviado where tenant_id = B;
  if n <> 0 then raise exception '0937: borrar la flota no borró sus sellos'; end if;
end $$;

rollback;
