-- pgTAP: aislamiento y bitácora de `tenant_perfil` (migración 0770). T-PER-12.
-- Cuatro aserciones, todo sintético y dentro de una transacción que termina en rollback
-- (incluida la extensión pgTAP, que no queda instalada tras correr este archivo):
--   (a) `anon` y `authenticated` no ven ni escriben `tenant_perfil` (RLS deny-all);
--   (b) insert/update/delete generan filas `perfil_tenant.aplicar|cambiar|quitar` en `bitacora_auditoria`;
--   (c) un `perfil` fuera del dominio cerrado rebota (CHECK);
--   (d) `on delete cascade`: al borrar el tenant desaparece su fila de `tenant_perfil`.
-- Correr:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/0770_tenant_perfil_aislamiento.sql
-- (en CI con pg_prove si se agrega: la extensión se crea aquí mismo).
begin;
create extension if not exists pgtap;
select plan(4);

-- Datos sintéticos (como superusuario del servidor).
insert into public.tenant (id, nombre) values ('00000000-0000-0000-0000-0000000a7701', 'Flota Sintetica T-PER-12 A');
insert into public.tenant (id, nombre) values ('00000000-0000-0000-0000-0000000a7702', 'Flota Sintetica T-PER-12 B');

-- (a) Con una fila ya presente, ningún rol de la API la ve ni la toca.
insert into public.tenant_perfil (tenant_id, perfil) values ('00000000-0000-0000-0000-0000000a7701', 'cinco_agentes');

create temp table _resultado_a (rol text, vistas int, insert_bloqueado bool, update_filas int, delete_filas int);
grant all on _resultado_a to public;

do $$
declare
  r text;
  vistas int; filas_u int; filas_d int; ins_bloq bool;
begin
  foreach r in array array['anon', 'authenticated'] loop
    execute format('set local role %I', r);
    select count(*) into vistas from public.tenant_perfil;
    ins_bloq := false;
    begin
      insert into public.tenant_perfil (tenant_id, perfil) values ('00000000-0000-0000-0000-0000000a7702', 'cinco_agentes');
    exception when insufficient_privilege then ins_bloq := true;
    end;
    update public.tenant_perfil set cambiado_en = now();
    get diagnostics filas_u = row_count;
    delete from public.tenant_perfil;
    get diagnostics filas_d = row_count;
    reset role;
    insert into _resultado_a values (r, vistas, ins_bloq, filas_u, filas_d);
  end loop;
end $$;

select ok(
  (select bool_and(vistas = 0 and insert_bloqueado and update_filas = 0 and delete_filas = 0) and count(*) = 2 from _resultado_a)
  and (select count(*) = 1 from public.tenant_perfil where tenant_id = '00000000-0000-0000-0000-0000000a7701'),
  '(a) anon y authenticated: 0 filas visibles, insert rebota por RLS, update/delete afectan 0 filas y la fila sigue intacta'
);

-- (b) Bitácora por trigger: alta, cambio y baja de la flota B (la A ya generó su alta arriba).
insert into public.tenant_perfil (tenant_id, perfil) values ('00000000-0000-0000-0000-0000000a7702', 'cinco_agentes');
update public.tenant_perfil set perfil = 'cinco_agentes' where tenant_id = '00000000-0000-0000-0000-0000000a7702';
delete from public.tenant_perfil where tenant_id = '00000000-0000-0000-0000-0000000a7702';

select is(
  (select array_agg(accion order by id) from public.bitacora_auditoria
    where tenant_id = '00000000-0000-0000-0000-0000000a7702' and accion like 'perfil_tenant.%'),
  array['perfil_tenant.aplicar', 'perfil_tenant.cambiar', 'perfil_tenant.quitar'],
  '(b) insert, update y delete asientan perfil_tenant.aplicar, .cambiar y .quitar en bitacora_auditoria'
);

-- (c) Perfil fuera del dominio cerrado.
select throws_ok(
  $$insert into public.tenant_perfil (tenant_id, perfil) values ('00000000-0000-0000-0000-0000000a7702', 'perfil_inventado')$$,
  '23514',
  null,
  '(c) un perfil fuera del dominio rebota por CHECK (23514)'
);

-- (d) on delete cascade al borrar el tenant de prueba (la flota A conserva su fila hasta aquí).
delete from public.tenant where id = '00000000-0000-0000-0000-0000000a7701';
select is(
  (select count(*)::int from public.tenant_perfil where tenant_id = '00000000-0000-0000-0000-0000000a7701'),
  0,
  '(d) borrar el tenant elimina su fila de tenant_perfil (cascade)'
);

select * from finish();
rollback;
