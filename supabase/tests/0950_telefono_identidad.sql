\set ON_ERROR_STOP on
-- 0950/0951/0952 — IDENTIDAD POR TELÉFONO (CT-SEG-07 / X-01), contra Postgres real y con datos sintéticos propios (rollback).
--
-- Se demuestra:
--   (a) `telefono_canonico`: 521+10 y 52+10 y 10 dígitos y «+52 1 …» dan la MISMA forma; el marcador «sin-tel:…» da NULL.
--   (b) `telefono_enmascarado` deja solo los 4 últimos dígitos.
--   (c) el guardián (0951) NO toca duplicados históricos: con el disparador apagado se siembra un duplicado entre flotas;
--       después se puede editar el nombre de esas filas y reescribir el mismo valor sin que el guardián estorbe.
--   (d) filas NUEVAS: el mismo número (en otra forma) activo en otra flota se RECHAZA con SQLSTATE 23505 y la restricción
--       `telefono_identidad_unica`, entre las tres tablas, y el mensaje no trae el número ni la flota.
--   (e) en la MISMA flota, operador + app_user con el mismo número se permite; dos del mismo tipo no.
--   (f) un operador de baja no bloquea; REACTIVARLO sí pasa por el guardián; el marcador «sin-tel:…» no cuenta.
--   (g) `telefono_identidad_conflictos()` lista el duplicado histórico, enmascarado, como `entre_flotas`.
--   (h) `resolver_identidad_telefono`: ninguna | unica | misma_flota | ambigua, y ante `ambigua` no devuelve flota ni ref.
--   (i) permisos: ni anon ni authenticated ejecutan el resolutor ni el diagnóstico; service_role sí.
begin;

insert into public.tenant (id, nombre) values
  ('95000000-0000-4000-8000-0000000000a1', 'Flota A 0950'),
  ('95000000-0000-4000-8000-0000000000b1', 'Flota B 0950');
insert into public.cliente (id, tenant_id, nombre) values
  ('95000000-0000-4000-8000-0000000000a2', '95000000-0000-4000-8000-0000000000a1', 'Cliente A'),
  ('95000000-0000-4000-8000-0000000000b2', '95000000-0000-4000-8000-0000000000b1', 'Cliente B');

-- (a) forma canónica
do $$
begin
  if public.telefono_canonico('5219990950001') is distinct from '529990950001' then raise exception '0950(a): 521+10 no colapsó'; end if;
  if public.telefono_canonico('+52 999 095 0001') is distinct from '529990950001' then raise exception '0950(a): +52 con espacios no quedó 52+10'; end if;
  if public.telefono_canonico('9990950001') is distinct from '529990950001' then raise exception '0950(a): los 10 dígitos nacionales no se completaron a 52+10'; end if;
  if public.telefono_canonico('+52 1 999 095 0001') is distinct from '529990950001' then raise exception '0950(a): +52 1 no colapsó'; end if;
  if public.telefono_canonico('sin-tel:abcdefghijklmnopqrst') is not null then raise exception '0950(a): el marcador sin-tel debía dar NULL'; end if;
  if public.telefono_canonico(null) is not null or public.telefono_canonico('') is not null then raise exception '0950(a): null/vacío debían dar NULL'; end if;
  -- (b) máscara
  if public.telefono_enmascarado('5219990950001') is distinct from '********0001' then raise exception '0950(b): máscara incorrecta: %', public.telefono_enmascarado('5219990950001'); end if;
  if public.telefono_enmascarado('5219990950001') like '%99909%' then raise exception '0950(b): la máscara deja ver dígitos del medio'; end if;
end $$;

-- (c) duplicado HISTÓRICO entre flotas (guardián apagado a propósito: así nacen los datos viejos)
alter table public.app_user disable trigger telefono_identidad_guarda;
alter table public.operador disable trigger telefono_identidad_guarda;
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('95000000-0000-4000-8000-0000000000c1', '95000000-0000-4000-8000-0000000000a1', 'Chofer histórico A', '529990950101');
insert into public.app_user (id, tenant_id, email, nombre, rol, telefono) values
  ('95000000-0000-4000-8000-0000000000d1', '95000000-0000-4000-8000-0000000000b1', 'hist-0950@test.invalid', 'Oficina histórica B', 'encargado', '529990950101');
alter table public.app_user enable trigger telefono_identidad_guarda;
alter table public.operador enable trigger telefono_identidad_guarda;

do $$
begin
  -- el guardián no estorba sobre filas que YA estaban duplicadas
  update public.operador set nombre = 'Chofer histórico A (editado)' where id = '95000000-0000-4000-8000-0000000000c1';
  update public.app_user set nombre = 'Oficina histórica B (editada)' where id = '95000000-0000-4000-8000-0000000000d1';
  update public.operador set activo = activo, telefono = telefono where id = '95000000-0000-4000-8000-0000000000c1';
end $$;

-- (g) el diagnóstico lo ve, enmascarado
do $$
declare r record; n integer := 0;
begin
  for r in select * from public.telefono_identidad_conflictos() where '95000000-0000-4000-8000-0000000000a1'::uuid = any (tenants) loop
    n := n + 1;
    if r.tipo is distinct from 'entre_flotas' then raise exception '0950(g): tipo % en vez de entre_flotas', r.tipo; end if;
    if r.filas <> 2 or r.flotas <> 2 then raise exception '0950(g): filas/flotas incorrectas: % / %', r.filas, r.flotas; end if;
    if r.telefono_enmascarado is distinct from '********0101' then raise exception '0950(g): teléfono mal enmascarado: %', r.telefono_enmascarado; end if;
    if r.tablas is distinct from array['app_user', 'operador'] then raise exception '0950(g): tablas incorrectas: %', r.tablas; end if;
  end loop;
  if n <> 1 then raise exception '0950(g): el duplicado histórico debía aparecer UNA vez, aparece %', n; end if;
end $$;

-- (h) resolutor sobre el duplicado histórico: AMBIGUA y sin flota ni ref
do $$
declare r record;
begin
  select * into r from public.resolver_identidad_telefono('+52 1 999 095 0101');
  if r.resultado is distinct from 'ambigua' then raise exception '0950(h): se esperaba ambigua, llegó %', r.resultado; end if;
  if r.tenant_id is not null or r.ref_id is not null or r.tipo is not null then raise exception '0950(h): ante ambigüedad NO debe devolver flota, ref ni tipo'; end if;
  if r.filas <> 2 or r.flotas <> 2 then raise exception '0950(h): conteos incorrectos'; end if;
  -- ninguna
  select * into r from public.resolver_identidad_telefono('5219990959999');
  if r.resultado is distinct from 'ninguna' or r.filas <> 0 then raise exception '0950(h): se esperaba ninguna'; end if;
  select * into r from public.resolver_identidad_telefono(null);
  if r.resultado is distinct from 'ninguna' then raise exception '0950(h): null debía dar ninguna'; end if;
end $$;

-- (d) filas NUEVAS: rechazadas entre flotas, entre tablas, y en otra forma del número
do $$
declare v_c text; v_m text; v_ok boolean;
begin
  -- operador nuevo en B con el número del operador histórico de A, escrito como 521+10
  v_ok := false;
  begin
    insert into public.operador (tenant_id, nombre, telefono) values ('95000000-0000-4000-8000-0000000000b1', 'Intruso', '5219990950101');
  exception when unique_violation then
    get stacked diagnostics v_c = constraint_name, v_m = message_text;
    v_ok := true;
  end;
  if not v_ok then raise exception '0950(d): un operador nuevo entró con un número activo de otra flota'; end if;
  if v_c is distinct from 'telefono_identidad_unica' and v_c is distinct from 'uq_operador_telefono_activo' then raise exception '0950(d): restricción inesperada %', v_c; end if;

  -- app_user nuevo en A con el número de un operador de B (se siembra el operador ya con el guardián encendido)
  insert into public.operador (id, tenant_id, nombre, telefono) values
    ('95000000-0000-4000-8000-0000000000c2', '95000000-0000-4000-8000-0000000000b1', 'Chofer B', '529990950202');
  v_ok := false;
  begin
    insert into public.app_user (id, tenant_id, email, nombre, rol, telefono)
    values ('95000000-0000-4000-8000-0000000000d2', '95000000-0000-4000-8000-0000000000a1', 'intruso-0950@test.invalid', 'Intruso', 'encargado', '+52 1 999 095 0202');
  exception when unique_violation then
    get stacked diagnostics v_c = constraint_name, v_m = message_text;
    v_ok := true;
  end;
  if not v_ok then raise exception '0950(d): un app_user nuevo entró con el número de un operador de otra flota'; end if;
  if v_c is distinct from 'telefono_identidad_unica' then raise exception '0950(d): se esperaba telefono_identidad_unica, llegó %', v_c; end if;
  if v_m like '%0950202%' or v_m like '%Flota%' or v_m like '%95000000%' then raise exception '0950(d): el mensaje filtra el número o la flota: %', v_m; end if;

  -- vigia_contacto nuevo en A con el número del operador de B
  v_ok := false;
  begin
    insert into public.vigia_contacto (tenant_id, cliente_id, telefono, telefono_hash, consentimiento_en, consentimiento_origen)
    values ('95000000-0000-4000-8000-0000000000a1', '95000000-0000-4000-8000-0000000000a2', '529990950202', repeat('a', 64), now(), 'alta_flota');
  exception when unique_violation then
    get stacked diagnostics v_c = constraint_name;
    v_ok := true;
  end;
  if not v_ok then raise exception '0950(d): un contacto del Vigía entró con el número de un operador de otra flota'; end if;
  if v_c is distinct from 'telefono_identidad_unica' then raise exception '0950(d): restricción inesperada en vigia_contacto: %', v_c; end if;
end $$;

-- (e) misma flota: operador + app_user, permitido; resolutor = misma_flota con flota y SIN ref
insert into public.app_user (id, tenant_id, email, nombre, rol, telefono) values
  ('95000000-0000-4000-8000-0000000000d3', '95000000-0000-4000-8000-0000000000b1', 'dueno-chofer-0950@test.invalid', 'Dueño que maneja', 'flota_admin', '529990950202');
do $$
declare r record; v_ok boolean := false;
begin
  select * into r from public.resolver_identidad_telefono('529990950202');
  if r.resultado is distinct from 'misma_flota' then raise exception '0950(e): se esperaba misma_flota, llegó %', r.resultado; end if;
  if r.tenant_id is distinct from '95000000-0000-4000-8000-0000000000b1'::uuid or r.ref_id is not null then raise exception '0950(e): misma_flota debe traer la flota y no el ref'; end if;
  -- dos del MISMO tipo en la misma flota: no (operador)
  begin
    insert into public.operador (tenant_id, nombre, telefono) values ('95000000-0000-4000-8000-0000000000b1', 'Clon', '5219990950202');
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception '0950(e): dos operadores activos con el mismo número en una flota'; end if;
  -- dos app_user con el mismo número en otra forma (la unique cruda de 0059 no los ve)
  v_ok := false;
  begin
    insert into public.app_user (tenant_id, email, nombre, rol, telefono) values
      ('95000000-0000-4000-8000-0000000000b1', 'dup-forma-0950@test.invalid', 'Otra forma', 'contador', '5219990950202');
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception '0950(e): dos app_user con el mismo número en otra forma pasaron'; end if;
end $$;

-- (f) baja / reactivación / marcador
do $$
declare v_ok boolean := false; r record;
begin
  insert into public.operador (id, tenant_id, nombre, telefono, activo) values
    ('95000000-0000-4000-8000-0000000000c3', '95000000-0000-4000-8000-0000000000a1', 'Chofer de baja A', '529990950303', false);
  -- un operador de baja no bloquea a una cuenta nueva en otra flota
  insert into public.app_user (id, tenant_id, email, nombre, rol, telefono) values
    ('95000000-0000-4000-8000-0000000000d4', '95000000-0000-4000-8000-0000000000b1', 'libre-0950@test.invalid', 'Libre', 'encargado', '529990950303');
  -- reactivar al operador de baja SÍ pasa por el guardián
  begin
    update public.operador set activo = true where id = '95000000-0000-4000-8000-0000000000c3';
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception '0950(f): reactivar un operador cuyo número ya es de otra flota pasó'; end if;
  -- el marcador sin-tel no cuenta ni choca
  insert into public.operador (tenant_id, nombre, telefono, numero_empleado, correo) values
    ('95000000-0000-4000-8000-0000000000a1', 'Sin WhatsApp 1', 'sin-tel:' || repeat('a', 20), 'E-0950-1', 'e1-0950@test.invalid'),
    ('95000000-0000-4000-8000-0000000000b1', 'Sin WhatsApp 2', 'sin-tel:' || repeat('b', 20), 'E-0950-2', 'e2-0950@test.invalid');
  select * into r from public.resolver_identidad_telefono('529990950303');
  if r.resultado is distinct from 'unica' or r.tipo is distinct from 'app_user' or r.ref_id is distinct from '95000000-0000-4000-8000-0000000000d4'::uuid then
    raise exception '0950(f): el resolutor debía devolver la cuenta app_user única; llegó % / %', r.resultado, r.tipo;
  end if;
end $$;

-- (i) permisos
set local role anon;
do $$ begin
  begin perform 1 from public.resolver_identidad_telefono('529990950101'); raise exception '0950(i): anon ejecutó el resolutor';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.telefono_identidad_conflictos(); raise exception '0950(i): anon ejecutó el diagnóstico';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin perform 1 from public.resolver_identidad_telefono('529990950101'); raise exception '0950(i): authenticated ejecutó el resolutor';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.telefono_identidades(null); raise exception '0950(i): authenticated ejecutó telefono_identidades';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role service_role;
do $$ begin
  perform 1 from public.resolver_identidad_telefono('529990950101');
  perform 1 from public.telefono_identidad_conflictos();
end $$;
reset role;

rollback;
