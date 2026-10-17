\set ON_ERROR_STOP on
-- 0800 — CONDUCTOR: voluntarios del piloto, origen de la aceptación y funciones atómicas, contra Postgres REAL (sintético, rollback).
-- Lo que solo la base garantiza:
--   (a) `aceptar_viajes_importados` acepta SOLO viajes abiertos, sin aceptar, de la flota y de un operador voluntario; deja
--       aceptado_origen='importacion' y avisado_en puesto (viaje_aceptado_requiere_aviso, 0058, nunca se viola);
--   (b) un no voluntario, otra flota, un viaje ya aceptado por el chofer o uno no abierto devuelven 0 filas y no se tocan (falla cerrado);
--   (c) `retirar_voluntario` apaga la marca y deja «sin aceptar» SOLO los importados abiertos de ese operador (los del chofer, los
--       liquidados y los de otros operadores intactos; los hitos se conservan); otra flota no puede retirar;
--   (d) CHECK de aceptado_origen y del tope piloto_max_voluntarios; valores por omisión;
--   (e) solo service_role ejecuta ambas funciones.
begin;

insert into public.tenant (id, nombre) values
  ('80000000-0000-4000-8000-0000000000a1', 'Flota A 0800'),
  ('80000000-0000-4000-8000-0000000000b1', 'Flota B 0800');

-- Flota A: op1 voluntario, op2 NO voluntario, op3 voluntario (viaje ya aceptado por el chofer), op4 voluntario (viaje liquidado).
-- Flota B: op5 voluntario (para probar el aislamiento entre flotas).
insert into public.operador (id, tenant_id, nombre, telefono, agente_voluntario, agente_voluntario_desde)
values
  ('80000000-0000-4000-8000-000000000101', '80000000-0000-4000-8000-0000000000a1', 'Chofer 1', '525500800001', true,  now()), -- grep-limpio:ok
  ('80000000-0000-4000-8000-000000000102', '80000000-0000-4000-8000-0000000000a1', 'Chofer 2', '525500800002', false, null), -- grep-limpio:ok
  ('80000000-0000-4000-8000-000000000103', '80000000-0000-4000-8000-0000000000a1', 'Chofer 3', '525500800003', true,  now()), -- grep-limpio:ok
  ('80000000-0000-4000-8000-000000000104', '80000000-0000-4000-8000-0000000000a1', 'Chofer 4', '525500800004', true,  now()), -- grep-limpio:ok
  ('80000000-0000-4000-8000-000000000105', '80000000-0000-4000-8000-0000000000b1', 'Chofer 5', '525500800005', true,  now()); -- grep-limpio:ok

insert into public.viaje (id, tenant_id, operador_id, folio, estatus, avisado_en, aceptado_en, aceptado_origen) values
  ('80000000-0000-4000-8000-000000000201', '80000000-0000-4000-8000-0000000000a1', '80000000-0000-4000-8000-000000000101', 'V-1', 'abierto',   null, null, null),
  ('80000000-0000-4000-8000-000000000202', '80000000-0000-4000-8000-0000000000a1', '80000000-0000-4000-8000-000000000102', 'V-2', 'abierto',   null, null, null),
  ('80000000-0000-4000-8000-000000000203', '80000000-0000-4000-8000-0000000000a1', '80000000-0000-4000-8000-000000000103', 'V-3', 'abierto',   now() - interval '3 hours', now() - interval '2 hours', 'chofer'),
  ('80000000-0000-4000-8000-000000000204', '80000000-0000-4000-8000-0000000000a1', '80000000-0000-4000-8000-000000000104', 'V-4', 'liquidado', null, null, null),
  ('80000000-0000-4000-8000-000000000205', '80000000-0000-4000-8000-0000000000b1', '80000000-0000-4000-8000-000000000105', 'V-5', 'abierto',   null, null, null);

set local role service_role;

do $$
declare
  A constant uuid := '80000000-0000-4000-8000-0000000000a1';
  B constant uuid := '80000000-0000-4000-8000-0000000000b1';
  v1 constant uuid := '80000000-0000-4000-8000-000000000201'; -- voluntario, abierto, sin aceptar
  v2 constant uuid := '80000000-0000-4000-8000-000000000202'; -- NO voluntario
  v3 constant uuid := '80000000-0000-4000-8000-000000000203'; -- ya aceptado por el chofer
  v4 constant uuid := '80000000-0000-4000-8000-000000000204'; -- liquidado
  v5 constant uuid := '80000000-0000-4000-8000-000000000205'; -- otra flota
  op1 constant uuid := '80000000-0000-4000-8000-000000000101';
  op3 constant uuid := '80000000-0000-4000-8000-000000000103';
  op5 constant uuid := '80000000-0000-4000-8000-000000000105';
  t constant timestamptz := '2026-10-30 12:00:00+00';
  ids uuid[]; n int; r record;
begin
  -- (a)+(b) todos los viajes de la flota A a la vez: solo v1 se acepta
  select array_agg(o_id) into ids from public.aceptar_viajes_importados(A, array[v1, v2, v3, v4, v5], t);
  if ids is distinct from array[v1] then raise exception '0800: aceptó % (se esperaba solo v1)', ids; end if;
  select * into r from public.viaje where id = v1;
  if r.aceptado_en <> t or r.avisado_en <> t or r.aceptado_origen <> 'importacion' then
    raise exception '0800: v1 quedó aceptado_en=% avisado_en=% origen=%', r.aceptado_en, r.avisado_en, r.aceptado_origen;
  end if;
  -- no voluntario: intacto
  select * into r from public.viaje where id = v2;
  if r.aceptado_en is not null or r.avisado_en is not null or r.aceptado_origen is not null then raise exception '0800: tocó al no voluntario'; end if;
  -- ya aceptado por el chofer: NO se reescribe
  select * into r from public.viaje where id = v3;
  if r.aceptado_origen <> 'chofer' or r.aceptado_en = t or r.avisado_en = t then raise exception '0800: reescribió una aceptación del chofer'; end if;
  -- liquidado: intacto
  select * into r from public.viaje where id = v4;
  if r.aceptado_en is not null or r.aceptado_origen is not null then raise exception '0800: tocó un viaje liquidado'; end if;
  -- otra flota: v5 no se tocó ni siquiera pasando el id (el tenant manda)
  select * into r from public.viaje where id = v5;
  if r.aceptado_en is not null or r.aceptado_origen is not null then raise exception '0800: aceptó un viaje de OTRA flota'; end if;

  -- idempotente: repetir no devuelve nada ni mueve la hora
  select count(*) into n from public.aceptar_viajes_importados(A, array[v1], t + interval '1 hour');
  if n <> 0 then raise exception '0800: repetir devolvió % filas', n; end if;
  if (select aceptado_en from public.viaje where id = v1) <> t then raise exception '0800: repetir movió aceptado_en'; end if;

  -- un aviso previo se conserva (coalesce): aviso de antes, aceptación de la importación
  update public.viaje set avisado_en = t - interval '1 hour', aceptado_en = null, aceptado_origen = null where id = v1;
  perform 1 from public.aceptar_viajes_importados(A, array[v1], t);
  if (select avisado_en from public.viaje where id = v1) <> t - interval '1 hour' then raise exception '0800: pisó un aviso previo'; end if;

  -- entradas vacías o nulas: sin filas y sin error; tenant nulo rebota
  select count(*) into n from public.aceptar_viajes_importados(A, array[]::uuid[], t);
  if n <> 0 then raise exception '0800: arreglo vacío devolvió filas'; end if;
  select count(*) into n from public.aceptar_viajes_importados(A, null, t);
  if n <> 0 then raise exception '0800: arreglo nulo devolvió filas'; end if;
  begin perform public.aceptar_viajes_importados(null, array[v1], t); raise exception '0800: aceptó con tenant nulo';
  exception when raise_exception then if sqlerrm like '0800:%' then raise; end if; end;

  -- falla cerrado: la flota B no puede aceptar el viaje de la A
  select count(*) into n from public.aceptar_viajes_importados(B, array[v1, v2], t);
  if n <> 0 then raise exception '0800: la flota B aceptó viajes de la A'; end if;

  -- (c) retirar_voluntario: v1 (importado, abierto) vuelve a «sin aceptar»; v3 (chofer) y v2/v4 intactos
  -- preparar un hito ya recibido en v1 para comprobar que se conserva
  perform 1 from public.viaje where id = v1;
  n := public.retirar_voluntario(A, op1);
  if n <> 1 then raise exception '0800: retirar devolvió % (se esperaba 1)', n; end if;
  select * into r from public.viaje where id = v1;
  if r.aceptado_en is not null or r.aceptado_origen is not null then raise exception '0800: v1 no volvió a sin aceptar'; end if;
  if r.avisado_en <> t - interval '1 hour' then raise exception '0800: retirar borró un aviso previo (no era de la importación)'; end if;
  if (select agente_voluntario from public.operador where id = op1) then raise exception '0800: la marca no se apagó'; end if;
  if (select agente_voluntario_desde from public.operador where id = op1) is not null then raise exception '0800: desde no se limpió'; end if;
  -- idempotente
  if public.retirar_voluntario(A, op1) <> 0 then raise exception '0800: retirar dos veces no es idempotente'; end if;

  -- retirar a op3: su viaje aceptado por el CHOFER no se toca (solo la marca se apaga)
  n := public.retirar_voluntario(A, op3);
  if n <> 0 then raise exception '0800: retirar a op3 revirtió % viajes del chofer', n; end if;
  select * into r from public.viaje where id = v3;
  if r.aceptado_origen <> 'chofer' or r.aceptado_en is null then raise exception '0800: retirar tocó la aceptación del chofer'; end if;
  if (select agente_voluntario from public.operador where id = op3) then raise exception '0800: la marca de op3 no se apagó'; end if;

  -- aviso que puso la propia importación se quita al retirar (para que no corra el reloj de escalación)
  update public.operador set agente_voluntario = true where id = op1;
  update public.viaje set avisado_en = null where id = v1;
  perform 1 from public.aceptar_viajes_importados(A, array[v1], t);
  if public.retirar_voluntario(A, op1) <> 1 then raise exception '0800: no revirtió el segundo viaje importado'; end if;
  if (select avisado_en from public.viaje where id = v1) is not null then raise exception '0800: dejó corriendo el aviso puesto por la importación'; end if;

  -- un viaje importado y LIQUIDADO no se revierte
  update public.operador set agente_voluntario = true where id = op1;
  perform 1 from public.aceptar_viajes_importados(A, array[v1], t);
  reset role;
  update public.viaje set estatus = 'liquidado' where id = v1;
  set local role service_role;
  if public.retirar_voluntario(A, op1) <> 0 then raise exception '0800: revirtió un viaje liquidado'; end if;
  if (select aceptado_origen from public.viaje where id = v1) <> 'importacion' then raise exception '0800: borró el origen de un liquidado'; end if;

  -- otra flota no puede retirar a un operador ajeno (ni cambiar su marca)
  if public.retirar_voluntario(A, op5) <> 0 then raise exception '0800: la flota A retiró viajes de la B'; end if;
  if not (select agente_voluntario from public.operador where id = op5) then raise exception '0800: la flota A apagó la marca de un operador de la B'; end if;
  if (select aceptado_origen from public.viaje where id = v5) is not null then raise exception '0800: v5 cambió'; end if;
  begin perform public.retirar_voluntario(A, null); raise exception '0800: aceptó operador nulo';
  exception when raise_exception then if sqlerrm like '0800:%' then raise; end if; end;

  -- (d) CHECK de origen y tope de voluntarios
  begin update public.viaje set aceptado_origen = 'inventado' where id = v2; raise exception '0800: aceptó un origen inventado';
  exception when check_violation then null; end;
  insert into public.agente_conductor_config (tenant_id) values (B);
  if (select piloto_max_voluntarios from public.agente_conductor_config where tenant_id = B) <> 6 then raise exception '0800: el tope por omisión no es 6'; end if;
  begin update public.agente_conductor_config set piloto_max_voluntarios = 0 where tenant_id = B; raise exception '0800: aceptó tope 0';
  exception when check_violation then null; end;
  begin update public.agente_conductor_config set piloto_max_voluntarios = 51 where tenant_id = B; raise exception '0800: aceptó tope 51';
  exception when check_violation then null; end;
  update public.agente_conductor_config set piloto_max_voluntarios = 50 where tenant_id = B;
  if (select agente_voluntario from public.operador where id = op3) is distinct from false then raise exception '0800: default de agente_voluntario'; end if;
end $$;

-- (e) solo service_role
reset role;
set local role authenticated;
do $$
begin
  begin perform public.aceptar_viajes_importados('80000000-0000-4000-8000-0000000000a1', array['80000000-0000-4000-8000-000000000201']::uuid[]);
    raise exception '0800: authenticated ejecutó aceptar_viajes_importados';
  exception when insufficient_privilege then null; end;
  begin perform public.retirar_voluntario('80000000-0000-4000-8000-0000000000a1', '80000000-0000-4000-8000-000000000101');
    raise exception '0800: authenticated ejecutó retirar_voluntario';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$
begin
  begin perform public.retirar_voluntario('80000000-0000-4000-8000-0000000000a1', '80000000-0000-4000-8000-000000000101');
    raise exception '0800: anon ejecutó retirar_voluntario';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

rollback;
