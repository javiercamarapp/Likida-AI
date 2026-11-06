\set ON_ERROR_STOP on
-- 0997 — superadmin_acceso contra Postgres REAL: dominio, solo agregar, poda con piso de 365 dias y cierre de privilegios. Termina en rollback.
begin;

do $$
declare
  act constant uuid := '99700000-0000-4000-8000-0000000000a1';
  ten constant uuid := '99700000-0000-4000-8000-0000000000b1';
  n int; i bigint; priv boolean; sec boolean;
begin
  -- 1. Inserta lectura, descarga y ver_como.
  insert into public.superadmin_acceso (actor, tenant_id, tipo, ruta) values
    (act, ten, 'lectura', '/dashboard/viajes'),
    (act, ten, 'descarga', '/api/export/liquidaciones'),
    (act, ten, 'ver_como', '/dashboard');
  select count(*) into n from public.superadmin_acceso where actor = act;
  if n <> 3 then raise exception '0997(1): esperaba 3 filas y hay %', n; end if;

  -- 2. Dominio: tipo desconocido, ruta con querystring o vacia, detalle que no es objeto.
  begin insert into public.superadmin_acceso (actor, tenant_id, tipo, ruta) values (act, ten, 'borrado', '/x'); raise exception '0997(2): tipo invalido debia rebotar';
  exception when check_violation then null; end;
  begin insert into public.superadmin_acceso (actor, tenant_id, tipo, ruta) values (act, ten, 'lectura', '/x?tenant=1'); raise exception '0997(2): ruta con query debia rebotar';
  exception when check_violation then null; end;
  begin insert into public.superadmin_acceso (actor, tenant_id, tipo, ruta) values (act, ten, 'lectura', ''); raise exception '0997(2): ruta vacia debia rebotar';
  exception when check_violation then null; end;
  begin insert into public.superadmin_acceso (actor, tenant_id, tipo, ruta, detalle) values (act, ten, 'lectura', '/x', '[1]'::jsonb); raise exception '0997(2): detalle no objeto debia rebotar';
  exception when check_violation then null; end;

  -- 3. Solo agregar: UPDATE y DELETE rebotan.
  select min(id) into i from public.superadmin_acceso where actor = act;
  begin update public.superadmin_acceso set ruta = '/otra' where id = i; raise exception '0997(3): update debia rebotar';
  exception when insufficient_privilege then null; end;
  begin delete from public.superadmin_acceso where id = i; raise exception '0997(3): delete debia rebotar';
  exception when insufficient_privilege then null; end;

  -- 4. Poda: piso de 365 dias; solo se va lo mas viejo.
  begin perform public.purgar_superadmin_acceso(30); raise exception '0997(4): poda de 30 dias debia lanzar';
  exception when invalid_parameter_value then null; end;
  perform set_config('likida.purgando_superadmin_acceso', 'on', true);
  insert into public.superadmin_acceso (actor, tenant_id, tipo, ruta, creado_en) values (act, ten, 'lectura', '/vieja', now() - interval '400 days');
  perform set_config('likida.purgando_superadmin_acceso', 'off', true);
  n := public.purgar_superadmin_acceso(365);
  if n <> 1 then raise exception '0997(4): debia podar 1 fila (la de 400 dias), podo %', n; end if;
  select count(*) into n from public.superadmin_acceso where actor = act;
  if n <> 3 then raise exception '0997(4): debian quedar 3 filas recientes, quedan %', n; end if;
  -- la marca de poda no queda puesta: un DELETE posterior vuelve a rebotar
  begin delete from public.superadmin_acceso where actor = act; raise exception '0997(4): delete tras la poda debia rebotar';
  exception when insufficient_privilege then null; end;

  -- 5. Seguridad: RLS prendida sin politicas, sin privilegios para anon/authenticated, service_role acotado.
  if not (select relrowsecurity from pg_class where oid = 'public.superadmin_acceso'::regclass) then raise exception '0997(5): RLS debia estar prendida'; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'superadmin_acceso';
  if n <> 0 then raise exception '0997(5): no debe haber politicas, hay %', n; end if;
  select count(*) into n from unnest(array['anon', 'authenticated']) r
   where has_table_privilege(r, 'public.superadmin_acceso', 'select,insert,update,delete,truncate,references,trigger');
  if n <> 0 then raise exception '0997(5): anon/authenticated no deben tener privilegios (hay %)', n; end if;
  priv := has_table_privilege('service_role', 'public.superadmin_acceso', 'select,insert');
  if not priv then raise exception '0997(5): service_role debia leer e insertar'; end if;
  if has_table_privilege('service_role', 'public.superadmin_acceso', 'update') or has_table_privilege('service_role', 'public.superadmin_acceso', 'delete') then
    raise exception '0997(5): service_role no debe actualizar ni borrar directo';
  end if;
  select p.prosecdef into sec from pg_proc p where p.oid = 'public.purgar_superadmin_acceso(integer)'::regprocedure;
  if not sec then raise exception '0997(5): la poda debia ser security definer'; end if;
  if has_function_privilege('anon', 'public.purgar_superadmin_acceso(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.purgar_superadmin_acceso(integer)', 'execute') then
    raise exception '0997(5): anon/authenticated no deben ejecutar la poda';
  end if;
end $$;

rollback;
