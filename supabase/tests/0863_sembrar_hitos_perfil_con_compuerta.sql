\set ON_ERROR_STOP on
-- 0863 (A37-S62-01) — la siembra de hitos para flotas con perfil exige la compuerta del Agente 5 (0859). Contra Postgres REAL, rollback.
--   (a) flota con perfil SIN habilitar: no se siembra ni se concilia (default seguro, igual que la 0801);
--   (b) la misma flota HABILITADA (0859): se siembra, es idempotente y respeta su perfil_seguimiento;
--   (c) habilitar la flota A no siembra la flota B con perfil; flotas sin perfil siguen igual que antes;
--   (d) la habilitación con `activo = false` no siembra; privilegios solo service_role.
begin;

insert into public.tenant (id, nombre) values
  ('86300000-0000-4000-8000-0000000000a1', 'Flota perfil habilitada 0863'),
  ('86300000-0000-4000-8000-0000000000b1', 'Flota perfil sin habilitar 0863'),
  ('86300000-0000-4000-8000-0000000000c1', 'Flota sin perfil 0863'),
  ('86300000-0000-4000-8000-0000000000d1', 'Flota perfil habilitada pero apagada 0863');
insert into public.tenant_perfil (tenant_id, perfil) values
  ('86300000-0000-4000-8000-0000000000a1', 'cinco_agentes'), ('86300000-0000-4000-8000-0000000000b1', 'cinco_agentes'),
  ('86300000-0000-4000-8000-0000000000d1', 'cinco_agentes');
insert into public.agente_conductor_config (tenant_id, activo, perfil_seguimiento, agente_chofer_habilitado) values
  ('86300000-0000-4000-8000-0000000000a1', true, 'esenciales', false),
  ('86300000-0000-4000-8000-0000000000b1', true, 'completo', false),
  ('86300000-0000-4000-8000-0000000000d1', false, 'completo', true);
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('86300000-0000-4000-8000-000000000101', '86300000-0000-4000-8000-0000000000a1', 'Chofer A', '525500863001'), -- grep-limpio:ok
  ('86300000-0000-4000-8000-000000000102', '86300000-0000-4000-8000-0000000000b1', 'Chofer B', '525500863002'), -- grep-limpio:ok
  ('86300000-0000-4000-8000-000000000103', '86300000-0000-4000-8000-0000000000c1', 'Chofer C', '525500863003'), -- grep-limpio:ok
  ('86300000-0000-4000-8000-000000000104', '86300000-0000-4000-8000-0000000000d1', 'Chofer D', '525500863004'); -- grep-limpio:ok
insert into public.viaje (id, tenant_id, operador_id, folio, estatus, avisado_en, aceptado_en) values
  ('86300000-0000-4000-8000-000000000201', '86300000-0000-4000-8000-0000000000a1', '86300000-0000-4000-8000-000000000101', 'V-A', 'abierto', now() - interval '3 hours', now() - interval '2 hours'),
  ('86300000-0000-4000-8000-000000000202', '86300000-0000-4000-8000-0000000000b1', '86300000-0000-4000-8000-000000000102', 'V-B', 'abierto', now() - interval '3 hours', now() - interval '2 hours'),
  ('86300000-0000-4000-8000-000000000203', '86300000-0000-4000-8000-0000000000c1', '86300000-0000-4000-8000-000000000103', 'V-C', 'abierto', now() - interval '3 hours', now() - interval '2 hours'),
  ('86300000-0000-4000-8000-000000000204', '86300000-0000-4000-8000-0000000000d1', '86300000-0000-4000-8000-000000000104', 'V-D', 'abierto', now() - interval '3 hours', now() - interval '2 hours');

-- (a) antes de habilitar a A: la flota A (perfil, sin habilitar) NO se siembra aunque tenga fila de config
update public.agente_conductor_config set agente_chofer_habilitado = false where tenant_id = '86300000-0000-4000-8000-0000000000a1';

set local role service_role;
do $$
declare
  vA constant uuid := '86300000-0000-4000-8000-000000000201';
  vB constant uuid := '86300000-0000-4000-8000-000000000202';
  vC constant uuid := '86300000-0000-4000-8000-000000000203';
  vD constant uuid := '86300000-0000-4000-8000-000000000204';
  n int;
begin
  perform public.sembrar_hitos_conductor_con_compuerta(500);
  select count(*) into n from public.viaje_hito where viaje_id in (vA, vB, vD);
  if n <> 0 then raise exception '0863(a): sembró % hitos en flotas con perfil NO habilitadas o apagadas', n; end if;
  select count(*) into n from public.viaje_hito where viaje_id = vC;
  if n <> 5 then raise exception '0863(c): la flota sin perfil debía sembrarse como siempre (5), hay %', n; end if;

  -- (b) habilitar A: se siembra según su perfil (esenciales) y es idempotente; B (perfil, sin habilitar) sigue sin nada
  update public.agente_conductor_config set agente_chofer_habilitado = true where tenant_id = '86300000-0000-4000-8000-0000000000a1';
  perform public.sembrar_hitos_conductor_con_compuerta(500);
  select count(*) into n from public.viaje_hito where viaje_id = vA;
  if n <> 5 then raise exception '0863(b): la flota con perfil habilitada debía sembrar 5 hitos, hay %', n; end if;
  select count(*) into n from public.viaje_hito where viaje_id = vA and tipo = 'salida_carga' and estado = 'esperado';
  if n <> 1 then raise exception '0863(b): esenciales debía dejar salida_carga esperado'; end if;
  select count(*) into n from public.viaje_hito where viaje_id = vA and tipo <> 'salida_carga' and estado = 'omitido' and omitido_motivo = 'fuera_de_perfil';
  if n <> 4 then raise exception '0863(b): esenciales debía omitir 4 por perfil, hay %', n; end if;
  if public.sembrar_hitos_conductor_con_compuerta(500) <> 0 then raise exception '0863(b): sembrar de nuevo no es idempotente'; end if;
  select count(*) into n from public.viaje_hito where viaje_id in (vB, vD);
  if n <> 0 then raise exception '0863(c): habilitar A sembró a otra flota con perfil (%)', n; end if;
end $$;

-- (d) privilegios: solo service_role
reset role;
do $$
begin
  if has_function_privilege('anon', 'public.sembrar_hitos_conductor_con_compuerta(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.sembrar_hitos_conductor_con_compuerta(integer)', 'execute') then
    raise exception '0863(d): anon/authenticated no deben ejecutar la siembra';
  end if;
  if not has_function_privilege('service_role', 'public.sembrar_hitos_conductor_con_compuerta(integer)', 'execute') then
    raise exception '0863(d): service_role debe poder ejecutarla';
  end if;
end $$;

rollback;
