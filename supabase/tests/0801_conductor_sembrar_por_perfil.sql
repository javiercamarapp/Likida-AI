\set ON_ERROR_STOP on
-- 0801 — CONDUCTOR: la siembra de hitos respeta el perfil de seguimiento, contra Postgres REAL (sintético, rollback).
-- Lo que solo la base garantiza:
--   (a) flota `completo` o SIN configuración: cinco hitos `esperado`, sin motivo (idéntico a la 0380);
--   (b) flota `esenciales`: solo `salida_carga` nace `esperado`; los otros cuatro nacen `omitido` con motivo `fuera_de_perfil`
--       (el CHECK viaje_hito_omitido_motivo se cumple) y sembrar de nuevo no duplica ni cambia nada (UNIQUE viaje, tipo);
--   (c) una flota con el agente apagado no recibe filas;
--   (d) cambiar de `completo` a `esenciales` con viajes abiertos omite lo pendiente y CONSERVA lo ya registrado;
--   (e) volver a `completo` reactiva lo omitido por el perfil, salvo si un hito posterior ya se registró (queda
--       omitido `inferido_por_<posterior>`); otros motivos de omisión no se tocan;
--   (f) un viaje no abierto no se toca; solo service_role ejecuta la función.
begin;

insert into public.tenant (id, nombre) values
  ('80500000-0000-4000-8000-0000000000a1', 'Flota esenciales 0801'),
  ('80500000-0000-4000-8000-0000000000b1', 'Flota completo 0801'),
  ('80500000-0000-4000-8000-0000000000c1', 'Flota sin config 0801'),
  ('80500000-0000-4000-8000-0000000000d1', 'Flota apagada 0801');

insert into public.agente_conductor_config (tenant_id, activo, perfil_seguimiento) values
  ('80500000-0000-4000-8000-0000000000a1', true,  'esenciales'),
  ('80500000-0000-4000-8000-0000000000b1', true,  'completo'),
  ('80500000-0000-4000-8000-0000000000d1', false, 'esenciales');

insert into public.operador (id, tenant_id, nombre, telefono) values
  ('80500000-0000-4000-8000-000000000101', '80500000-0000-4000-8000-0000000000a1', 'Chofer A', '525500801001'), -- grep-limpio:ok
  ('80500000-0000-4000-8000-000000000102', '80500000-0000-4000-8000-0000000000b1', 'Chofer B', '525500801002'), -- grep-limpio:ok
  ('80500000-0000-4000-8000-000000000103', '80500000-0000-4000-8000-0000000000c1', 'Chofer C', '525500801003'), -- grep-limpio:ok
  ('80500000-0000-4000-8000-000000000104', '80500000-0000-4000-8000-0000000000d1', 'Chofer D', '525500801004'); -- grep-limpio:ok

insert into public.viaje (id, tenant_id, operador_id, folio, estatus, avisado_en, aceptado_en) values
  ('80500000-0000-4000-8000-000000000201', '80500000-0000-4000-8000-0000000000a1', '80500000-0000-4000-8000-000000000101', 'V-A', 'abierto',   now() - interval '3 hours', now() - interval '2 hours'),
  ('80500000-0000-4000-8000-000000000202', '80500000-0000-4000-8000-0000000000b1', '80500000-0000-4000-8000-000000000102', 'V-B', 'abierto',   now() - interval '3 hours', now() - interval '2 hours'),
  ('80500000-0000-4000-8000-000000000203', '80500000-0000-4000-8000-0000000000c1', '80500000-0000-4000-8000-000000000103', 'V-C', 'abierto',   now() - interval '3 hours', now() - interval '2 hours'),
  ('80500000-0000-4000-8000-000000000204', '80500000-0000-4000-8000-0000000000d1', '80500000-0000-4000-8000-000000000104', 'V-D', 'abierto',   now() - interval '3 hours', now() - interval '2 hours'),
  ('80500000-0000-4000-8000-000000000205', '80500000-0000-4000-8000-0000000000a1', '80500000-0000-4000-8000-000000000101', 'V-L', 'liquidado', now() - interval '3 hours', now() - interval '2 hours');

set local role service_role;

do $$
declare
  A constant uuid := '80500000-0000-4000-8000-0000000000a1';
  B constant uuid := '80500000-0000-4000-8000-0000000000b1';
  vA constant uuid := '80500000-0000-4000-8000-000000000201';
  vB constant uuid := '80500000-0000-4000-8000-000000000202';
  vC constant uuid := '80500000-0000-4000-8000-000000000203';
  vD constant uuid := '80500000-0000-4000-8000-000000000204';
  vL constant uuid := '80500000-0000-4000-8000-000000000205';
  n int; r record; sembrados int;
begin
  -- (a)(b)(c)(f) primera siembra
  sembrados := public.sembrar_hitos_conductor(500);
  -- Aislamiento de la base de CI: solo se cuentan las filas de este bloque.
  select count(*) into n from public.viaje_hito where viaje_id in (vA, vB, vC);
  if n <> 15 then raise exception '0801: se esperaban 15 hitos en los tres viajes con agente activo, hay %', n; end if;
  select count(*) into n from public.viaje_hito where viaje_id in (vD, vL);
  if n <> 0 then raise exception '0801: sembró % hitos en una flota apagada o un viaje liquidado', n; end if;

  -- completo y sin configuración: cinco esperado, sin motivo
  select count(*) into n from public.viaje_hito where viaje_id in (vB, vC) and estado = 'esperado' and omitido_motivo is null;
  if n <> 10 then raise exception '0801: completo/sin config debía sembrar 10 esperado, hay %', n; end if;

  -- esenciales: solo salida_carga esperado; los demás omitido/fuera_de_perfil
  select count(*) into n from public.viaje_hito where viaje_id = vA and tipo = 'salida_carga' and estado = 'esperado' and omitido_motivo is null;
  if n <> 1 then raise exception '0801: esenciales debía sembrar salida_carga esperado'; end if;
  select count(*) into n from public.viaje_hito where viaje_id = vA and tipo <> 'salida_carga' and estado = 'omitido' and omitido_motivo = 'fuera_de_perfil';
  if n <> 4 then raise exception '0801: esenciales debía sembrar 4 omitidos fuera_de_perfil, hay %', n; end if;

  -- idempotente: sembrar de nuevo no duplica ni cambia
  if public.sembrar_hitos_conductor(500) <> 0 then raise exception '0801: sembrar de nuevo devolvió filas'; end if;
  select count(*) into n from public.viaje_hito where viaje_id in (vA, vB, vC);
  if n <> 15 then raise exception '0801: sembrar de nuevo duplicó (hay %)', n; end if;

  -- (d) completo -> esenciales con un hito ya registrado: se omite lo pendiente y se conserva lo registrado
  update public.viaje_hito set estado = 'recibido', fuente = 'texto', recibido_en = now() where viaje_id = vB and tipo = 'llegada_carga';
  update public.agente_conductor_config set perfil_seguimiento = 'esenciales' where tenant_id = B;
  perform public.sembrar_hitos_conductor(500);
  select estado into r from public.viaje_hito where viaje_id = vB and tipo = 'llegada_carga';
  if r.estado <> 'recibido' then raise exception '0801: omitió un hito ya registrado (%)', r.estado; end if;
  select count(*) into n from public.viaje_hito where viaje_id = vB and tipo in ('llegada_descarga', 'salida_descarga', 'regreso')
     and estado = 'omitido' and omitido_motivo = 'fuera_de_perfil';
  if n <> 3 then raise exception '0801: al pasar a esenciales debían omitirse 3 pendientes, se omitieron %', n; end if;
  select estado into r from public.viaje_hito where viaje_id = vB and tipo = 'salida_carga';
  if r.estado <> 'esperado' then raise exception '0801: salida_carga debía seguir esperado (%)', r.estado; end if;

  -- (e) esenciales -> completo: lo omitido por el perfil vuelve; si un posterior ya se registró, queda inferido
  update public.viaje_hito set estado = 'recibido', fuente = 'texto', recibido_en = now(), omitido_motivo = null where viaje_id = vB and tipo = 'llegada_descarga'; -- registrado a pesar del perfil (fuera de orden)
  update public.viaje_hito set estado = 'omitido', omitido_motivo = 'inferido_por_regreso' where viaje_id = vB and tipo = 'salida_descarga'; -- otro motivo: no se toca
  update public.agente_conductor_config set perfil_seguimiento = 'completo' where tenant_id = B;
  perform public.sembrar_hitos_conductor(500);
  select estado, omitido_motivo into r from public.viaje_hito where viaje_id = vB and tipo = 'regreso';
  if r.estado <> 'esperado' or r.omitido_motivo is not null then raise exception '0801: regreso debía reactivarse (% %)', r.estado, r.omitido_motivo; end if;
  select estado, omitido_motivo into r from public.viaje_hito where viaje_id = vB and tipo = 'salida_descarga';
  if r.estado <> 'omitido' or r.omitido_motivo <> 'inferido_por_regreso' then raise exception '0801: tocó una omisión de otro motivo (% %)', r.estado, r.omitido_motivo; end if;
  select estado, omitido_motivo into r from public.viaje_hito where viaje_id = vB and tipo = 'llegada_carga';
  if r.estado <> 'recibido' then raise exception '0801: tocó un hito registrado al reactivar'; end if;

  -- reactivar con un posterior ya registrado: queda omitido, inferido por ese posterior
  update public.viaje_hito set estado = 'omitido', omitido_motivo = 'fuera_de_perfil' where viaje_id = vB and tipo = 'regreso';
  update public.viaje_hito set estado = 'recibido', fuente = 'texto', recibido_en = now(), omitido_motivo = null where viaje_id = vB and tipo = 'salida_descarga';
  update public.viaje_hito set estado = 'omitido', omitido_motivo = 'fuera_de_perfil' where viaje_id = vB and tipo = 'salida_carga';
  perform public.sembrar_hitos_conductor(500);
  select estado, omitido_motivo into r from public.viaje_hito where viaje_id = vB and tipo = 'salida_carga';
  if r.estado <> 'omitido' or r.omitido_motivo <> 'inferido_por_llegada_descarga' then
    raise exception '0801: con un posterior registrado debía quedar inferido_por_llegada_descarga (% %)', r.estado, r.omitido_motivo;
  end if;

  -- (f) un viaje liquidado no se concilia aunque la flota sea esenciales
  insert into public.viaje_hito (tenant_id, viaje_id, tipo) values (A, vL, 'regreso');
  perform public.sembrar_hitos_conductor(500);
  select estado into r from public.viaje_hito where viaje_id = vL and tipo = 'regreso';
  if r.estado <> 'esperado' then raise exception '0801: tocó un hito de un viaje liquidado'; end if;

  -- p_limite inválido sigue rebotando
  begin perform public.sembrar_hitos_conductor(0); raise exception '0801: aceptó p_limite 0';
  exception when raise_exception then if sqlerrm like '0801:%' then raise; end if; end;
end $$;

-- solo service_role ejecuta la función
reset role;
do $$
begin
  if has_function_privilege('authenticated', 'public.sembrar_hitos_conductor(integer)', 'execute')
     or has_function_privilege('anon', 'public.sembrar_hitos_conductor(integer)', 'execute') then
    raise exception '0801: sembrar_hitos_conductor es ejecutable por authenticated o anon';
  end if;
  if not has_function_privilege('service_role', 'public.sembrar_hitos_conductor(integer)', 'execute') then
    raise exception '0801: service_role no puede ejecutar sembrar_hitos_conductor';
  end if;
end $$;

rollback;
