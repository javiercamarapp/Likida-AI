\set ON_ERROR_STOP on
-- 0460 — EL PATIO DEL JEFE Y LA INVITACIÓN DEL OPERADOR (W2 «producto»).
--
-- Lo que SOLO la base puede demostrar, contra Postgres real:
--   (a) la FK compuesta app_user(terminal_id, tenant_id) → terminal(id, tenant_id):
--       un jefe de la flota B NO puede quedar amarrado a un patio de la flota A;
--   (b) borrar un patio deja al jefe SIN patio (set null de la columna) y NO
--       borra al usuario ni toca su tenant_id;
--   (c) la coherencia de la constancia de invitación: fecha y vía van juntas o
--       ninguna, y la vía tiene dominio cerrado;
--   (d) la idempotencia del reclamo: dos UPDATE condicionados a «pendiente» —el
--       patrón de `invitarOperadores`— reclaman a lo más UNA vez la misma fila.
begin;

insert into public.tenant (id, nombre) values
  ('46000000-0000-4000-8000-0000000000a1', 'Flota A 0460'),
  ('46000000-0000-4000-8000-0000000000b1', 'Flota B 0460');
insert into public.terminal (id, tenant_id, nombre) values
  ('46000000-0000-4000-8000-0000000000a2', '46000000-0000-4000-8000-0000000000a1', 'Patio Norte');
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('46000000-0000-4000-8000-0000000000a3', '46000000-0000-4000-8000-0000000000a1', 'Chofer A', '525500004601');

-- (a) el jefe de la flota A SÍ puede tener el patio de A…
insert into public.app_user (id, tenant_id, email, rol, terminal_id) values
  ('46000000-0000-4000-8000-0000000000c1', '46000000-0000-4000-8000-0000000000a1', 'jefe-0460@test.invalid', 'encargado',
   '46000000-0000-4000-8000-0000000000a2');

-- …y el de la flota B NO puede colgarse del patio de A.
do $$
begin
  begin
    insert into public.app_user (id, tenant_id, email, rol, terminal_id) values
      ('46000000-0000-4000-8000-0000000000c2', '46000000-0000-4000-8000-0000000000b1', 'jefe-b-0460@test.invalid', 'encargado',
       '46000000-0000-4000-8000-0000000000a2');
    raise exception 'PATIO_AJENO_0460: la FK compuesta dejó pasar un patio de otra flota';
  exception when foreign_key_violation then
    null; -- esperado
  end;
end $$;

-- (c) coherencia de la constancia
do $$
begin
  begin
    update public.operador set invitacion_via = 'plantilla' where id = '46000000-0000-4000-8000-0000000000a3';
    raise exception 'INVITACION_0460: aceptó una vía sin fecha';
  exception when check_violation then null; end;
  begin
    update public.operador set invitacion_enviada_en = now(), invitacion_via = 'telepatia'
      where id = '46000000-0000-4000-8000-0000000000a3';
    raise exception 'INVITACION_0460: aceptó una vía fuera del dominio';
  exception when check_violation then null; end;
end $$;

-- (d) el reclamo es idempotente: el segundo intento no toca ninguna fila
do $$
declare primero int; segundo int;
begin
  with r as (
    update public.operador set invitacion_enviada_en = now(), invitacion_via = 'reclamada'
    where id = '46000000-0000-4000-8000-0000000000a3' and activo and invitacion_enviada_en is null
    returning 1
  ) select count(*) into primero from r;
  with r as (
    update public.operador set invitacion_enviada_en = now(), invitacion_via = 'reclamada'
    where id = '46000000-0000-4000-8000-0000000000a3' and activo and invitacion_enviada_en is null
    returning 1
  ) select count(*) into segundo from r;
  if primero <> 1 or segundo <> 0 then
    raise exception 'RECLAMO_0460 primero=% segundo=% (esperado 1 / 0)', primero, segundo;
  end if;
end $$;

-- (e) 0461: los conteos por patio son de la flota ENTERA pedida y no mezclan flotas
insert into public.terminal (id, tenant_id, nombre) values
  ('46000000-0000-4000-8000-0000000000b2', '46000000-0000-4000-8000-0000000000b1', 'Patio B');
update public.operador set terminal_id = '46000000-0000-4000-8000-0000000000a2'
  where id = '46000000-0000-4000-8000-0000000000a3';
do $$
declare op int; je int; filas int; filas_b int;
begin
  select operadores, jefes into op, je from public.terminales_conteos_tenant('46000000-0000-4000-8000-0000000000a1')
    where terminal_id = '46000000-0000-4000-8000-0000000000a2';
  select count(*) into filas from public.terminales_conteos_tenant('46000000-0000-4000-8000-0000000000a1');
  select count(*) into filas_b from public.terminales_conteos_tenant('46000000-0000-4000-8000-0000000000b1');
  if op <> 1 or je <> 1 or filas <> 1 or filas_b <> 1 then
    raise exception 'CONTEOS_0461 operadores=% jefes=% filasA=% filasB=% (esperado 1 / 1 / 1 / 1)', op, je, filas, filas_b;
  end if;
end $$;

-- (f) 0462: el fallo de la invitación es coherente y no convive con un envío exitoso
do $$
begin
  begin
    update public.operador set invitacion_fallo = 'número inválido' where id = '46000000-0000-4000-8000-0000000000a3';
    raise exception 'FALLO_0462: aceptó un motivo sin fecha';
  exception when check_violation then null; end;
  -- el operador del bloque (d) ya tiene la invitación reclamada: un fallo encima no entra
  begin
    update public.operador set invitacion_fallo = 'número inválido', invitacion_fallo_en = now()
      where id = '46000000-0000-4000-8000-0000000000a3';
    raise exception 'FALLO_0462: aceptó un fallo sobre una invitación enviada';
  exception when check_violation then null; end;
  -- soltar la invitación y registrar el fallo SÍ entra
  update public.operador set invitacion_enviada_en = null, invitacion_via = null,
    invitacion_fallo = 'número inválido', invitacion_fallo_en = now()
    where id = '46000000-0000-4000-8000-0000000000a3';
end $$;

-- (b) borrar el patio: el jefe queda sin patio, vivo y en su flota
delete from public.terminal where id = '46000000-0000-4000-8000-0000000000a2';
do $$
declare t uuid; ten uuid;
begin
  select terminal_id, tenant_id into t, ten from public.app_user where id = '46000000-0000-4000-8000-0000000000c1';
  if t is not null or ten is distinct from '46000000-0000-4000-8000-0000000000a1' then
    raise exception 'SET_NULL_0460 terminal_id=% tenant_id=% (esperado null / flota A)', t, ten;
  end if;
end $$;

rollback;
