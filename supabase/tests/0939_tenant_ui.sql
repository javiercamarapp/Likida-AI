\set ON_ERROR_STOP on
-- 0939 — versión de interfaz por flota (tenant_ui) contra Postgres REAL (datos sintéticos, rollback).
-- Lo que solo la base garantiza:
--   (a) una fila por flota (PK), dominio cerrado v1|v2 (un nombre inventado rebota), flota inexistente y versión nula rebotan;
--   (b) el trigger asienta en bitacora_auditoria cada alta, cambio y baja (tenant_ui.aplicar/cambiar/quitar);
--   (c) borrar a quien lo cambió NO quita la versión (set null); borrar la flota borra la versión SIN romper por la bitácora
--       (el cascade no asienta nada);
--   (d) RLS deny-all: encendida y SIN políticas; una sesión `authenticated` no lee ni escribe;
--   (e) la función del trigger no es ejecutable por anon/authenticated;
--   (f) IDEMPOTENCIA: reaplicar la migración tal cual no falla, no duplica el trigger y no deja políticas.
begin;

insert into public.tenant (id, nombre) values
  ('93900000-0000-4000-8000-0000000000a1', 'Flota A 0939'),
  ('93900000-0000-4000-8000-0000000000b1', 'Flota B 0939');
insert into public.app_user (id, tenant_id, email, rol) values
  ('93900000-0000-4000-8000-000000000401', '93900000-0000-4000-8000-0000000000a1', 'admin-0939@test.invalid', 'flota_admin'),
  ('93900000-0000-4000-8000-000000000402', '93900000-0000-4000-8000-0000000000a1', 'admin2-0939@test.invalid', 'flota_admin');

-- (f) reaplicar la migración tal cual (la ruta es relativa a la raíz del repo, como el resto de los pasos de CI)
\i supabase/migrations/0939_tenant_ui.sql
\i supabase/migrations/0939_tenant_ui.sql

do $$
declare
  A constant uuid := '93900000-0000-4000-8000-0000000000a1';
  B constant uuid := '93900000-0000-4000-8000-0000000000b1';
  U constant uuid := '93900000-0000-4000-8000-000000000401';
  n int;
begin
  -- (f) tras reaplicar dos veces: un solo trigger, ninguna política
  select count(*) into n from pg_trigger where tgrelid = 'public.tenant_ui'::regclass and tgname = 'tenant_ui_bitacora_trg' and not tgisinternal;
  if n <> 1 then raise exception '0939: reaplicar dejó % triggers de bitácora', n; end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tenant_ui') then
    raise exception '0939: tenant_ui no debe tener políticas (deny-all)';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.tenant_ui'::regclass) then raise exception '0939: sin RLS'; end if;

  -- (a) PK y dominio
  insert into public.tenant_ui (tenant_id, version, cambiado_por) values (A, 'v2', U);
  begin
    insert into public.tenant_ui (tenant_id, version) values (A, 'v2');
    raise exception '0939: dos filas para la misma flota';
  exception when unique_violation then null; end;
  begin
    insert into public.tenant_ui (tenant_id, version) values (B, 'v9');
    raise exception '0939: aceptó una versión fuera del dominio';
  exception when check_violation then null; end;
  begin
    insert into public.tenant_ui (tenant_id, version) values (gen_random_uuid(), 'v2');
    raise exception '0939: versión para una flota que no existe';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.tenant_ui (tenant_id, version) values (B, null);
    raise exception '0939: versión nula';
  exception when not_null_violation then null; end;

  -- (b) bitácora: alta, cambio, baja
  select count(*) into n from public.bitacora_auditoria where tenant_id = A and accion = 'tenant_ui.aplicar' and actor_id = U;
  if n <> 1 then raise exception '0939: el alta no quedó en bitácora (hay %)', n; end if;
  update public.tenant_ui set version = 'v1' where tenant_id = A;
  select count(*) into n from public.bitacora_auditoria
    where tenant_id = A and accion = 'tenant_ui.cambiar' and detalle = jsonb_build_object('de', 'v2', 'a', 'v1');
  if n <> 1 then raise exception '0939: el cambio no quedó en bitácora con de/a (hay %)', n; end if;

  -- (c) borrar a quien lo cambió no quita la versión
  delete from public.app_user where id = U;
  if not exists (select 1 from public.tenant_ui where tenant_id = A and cambiado_por is null and version = 'v1') then
    raise exception '0939: borrar al autor quitó la versión o no puso cambiado_por en null';
  end if;

  -- (b) baja explícita asienta 'quitar'
  delete from public.tenant_ui where tenant_id = A;
  select count(*) into n from public.bitacora_auditoria where tenant_id = A and accion = 'tenant_ui.quitar';
  if n <> 1 then raise exception '0939: la baja no quedó en bitácora (hay %)', n; end if;

  -- (c) borrar la flota con versión: el cascade no debe romper por la bitácora ni asentar nada
  insert into public.tenant_ui (tenant_id, version) values (B, 'v2');
  select count(*) into n from public.bitacora_auditoria where tenant_id = B;
  delete from public.tenant where id = B;
  if exists (select 1 from public.tenant_ui where tenant_id = B) then
    raise exception '0939: la versión sobrevivió a la baja de la flota';
  end if;

  -- (e) la función del trigger no es ejecutable por los roles de la app
  if has_function_privilege('anon', 'public.tenant_ui_bitacora()', 'execute')
     or has_function_privilege('authenticated', 'public.tenant_ui_bitacora()', 'execute') then
    raise exception '0939: tenant_ui_bitacora() ejecutable por anon/authenticated';
  end if;
end $$;

-- (d) una sesión autenticada no ve ninguna versión (ni la de su flota) y no puede escribir
insert into public.tenant_ui (tenant_id, version) values ('93900000-0000-4000-8000-0000000000a1', 'v2');
set local role authenticated;
select set_config('request.jwt.claim.sub', '93900000-0000-4000-8000-000000000402', true);
do $$ begin
  begin
    if (select count(*) from public.tenant_ui) <> 0 then
      raise exception '0939: authenticated leyó tenant_ui (% filas)', (select count(*) from public.tenant_ui);
    end if;
  exception when insufficient_privilege then null; end;  -- sin privilegio también es deny-all
  begin
    update public.tenant_ui set version = 'v1' where tenant_id = '93900000-0000-4000-8000-0000000000a1';
    if found then raise exception '0939: authenticated cambió tenant_ui'; end if;
  exception when insufficient_privilege then null; end;
  begin
    insert into public.tenant_ui (tenant_id, version) values ('93900000-0000-4000-8000-0000000000a1', 'v2');
    raise exception '0939: authenticated escribió tenant_ui';
  exception when insufficient_privilege or unique_violation then
    if sqlstate = '23505' then raise exception '0939: authenticated llegó a la restricción única (RLS no bloqueó)'; end if;
  end;
end $$;
reset role;

rollback;
