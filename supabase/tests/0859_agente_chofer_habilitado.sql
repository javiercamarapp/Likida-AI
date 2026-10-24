\set ON_ERROR_STOP on
-- 0859 — Compuerta en BASE del Agente 5: por defecto APAGADO, idempotente,
-- aislada por flota y reversible. Falla con `raise exception`.
begin;

insert into public.tenant (id, nombre) values
  ('08590000-0000-4000-8000-0000000000a1', 'Flota A 0859'),
  ('08590000-0000-4000-8000-0000000000b1', 'Flota B 0859'),
  ('08590000-0000-4000-8000-0000000000c1', 'Flota C 0859 sin fila');

-- Filas creadas SIN mencionar la columna nueva (como lo hace el código de hoy).
insert into public.agente_conductor_config (tenant_id) values
  ('08590000-0000-4000-8000-0000000000a1'),
  ('08590000-0000-4000-8000-0000000000b1');

do $$
declare
  a uuid := '08590000-0000-4000-8000-0000000000a1';
  b uuid := '08590000-0000-4000-8000-0000000000b1';
  c uuid := '08590000-0000-4000-8000-0000000000c1';
  v boolean;
begin
  -- (1) DEFAULT APAGADO: una fila nueva no habilita nada.
  select agente_chofer_habilitado into v from public.agente_conductor_config where tenant_id = a;
  if v is distinct from false then raise exception '0859(1): la columna debe nacer en false, vino %', v; end if;
  if public.conductor_agente_chofer_habilitado(a) is distinct from false then
    raise exception '0859(1): una flota con fila nueva (activo=true por defecto) NO debe estar habilitada'; end if;

  -- (2) Sin fila, tenant nulo o desconocido = false (fail-closed).
  if public.conductor_agente_chofer_habilitado(c) is distinct from false then raise exception '0859(2): sin fila debe ser false'; end if;
  if public.conductor_agente_chofer_habilitado(null) is distinct from false then raise exception '0859(2): tenant nulo debe ser false'; end if;
  if public.conductor_agente_chofer_habilitado(gen_random_uuid()) is distinct from false then raise exception '0859(2): tenant desconocido debe ser false'; end if;

  -- (3) AISLAMIENTO: habilitar la flota A no habilita a B ni a C.
  update public.agente_conductor_config set agente_chofer_habilitado = true where tenant_id = a;
  if public.conductor_agente_chofer_habilitado(a) is distinct from true then raise exception '0859(3): A habilitada debe dar true'; end if;
  if public.conductor_agente_chofer_habilitado(b) is distinct from false then raise exception '0859(3): B no debe heredar de A'; end if;
  if public.conductor_agente_chofer_habilitado(c) is distinct from false then raise exception '0859(3): C no debe heredar de A'; end if;

  -- (4) El interruptor general `activo = false` gana sobre la habilitación.
  update public.agente_conductor_config set activo = false where tenant_id = a;
  if public.conductor_agente_chofer_habilitado(a) is distinct from false then raise exception '0859(4): activo=false debe apagar aunque esté habilitada'; end if;
  update public.agente_conductor_config set activo = true where tenant_id = a;

  -- (5) IDEMPOTENCIA: reaplicar el cuerpo de la migración no cambia datos ni falla, y no apaga lo habilitado.
  alter table public.agente_conductor_config add column if not exists agente_chofer_habilitado boolean not null default false;
  if public.conductor_agente_chofer_habilitado(a) is distinct from true then raise exception '0859(5): reaplicar no debe revertir la habilitación'; end if;

  -- (6) PRIVILEGIOS: solo service_role ejecuta la compuerta.
  if has_function_privilege('anon', 'public.conductor_agente_chofer_habilitado(uuid)', 'execute') then raise exception '0859(6): anon no debe ejecutarla'; end if;
  if has_function_privilege('authenticated', 'public.conductor_agente_chofer_habilitado(uuid)', 'execute') then raise exception '0859(6): authenticated no debe ejecutarla'; end if;
  if not has_function_privilege('service_role', 'public.conductor_agente_chofer_habilitado(uuid)', 'execute') then raise exception '0859(6): service_role debe poder ejecutarla'; end if;
  if (select p.proconfig is null from pg_proc p where p.oid = 'public.conductor_agente_chofer_habilitado(uuid)'::regprocedure) then
    raise exception '0859(6): la función debe llevar search_path fijo'; end if;

  -- (7) REVERSA (la del encabezado de la migración): tras ella no queda rastro y se puede volver a aplicar.
  drop function if exists public.conductor_agente_chofer_habilitado(uuid);
  alter table public.agente_conductor_config drop column if exists agente_chofer_habilitado;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'agente_conductor_config' and column_name = 'agente_chofer_habilitado') then
    raise exception '0859(7): la columna debía desaparecer con la reversa'; end if;
  if to_regprocedure('public.conductor_agente_chofer_habilitado(uuid)') is not null then
    raise exception '0859(7): la función debía desaparecer con la reversa'; end if;
end $$;

rollback;
