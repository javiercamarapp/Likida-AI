\set ON_ERROR_STOP on
-- 0865 — A37-S48-01: la declaración del chofer sustituye a la marca derivada viva (append-only), no pisa una marca humana,
-- es idempotente por mensaje, aislada por flota y reversible. Falla con `raise exception`.
begin;

insert into public.tenant (id, nombre) values
  ('08650000-0000-4000-8000-0000000000a1', 'Flota A 0865'),
  ('08650000-0000-4000-8000-0000000000b1', 'Flota B 0865');

do $$
declare
  a uuid := '08650000-0000-4000-8000-0000000000a1';
  b uuid := '08650000-0000-4000-8000-0000000000b1';
  op_a uuid := gen_random_uuid();
  op_b uuid := gen_random_uuid();
  j_a uuid := gen_random_uuid();
  j_b uuid := gen_random_uuid();
  r text;
  n int;
  vivo public.jornada_asiento%rowtype;
  viejo public.jornada_asiento%rowtype;
begin
  insert into public.operador (id, tenant_id, nombre, telefono) values (op_a, a, 'Operador A 0865', '5265000000001'), (op_b, b, 'Operador B 0865', '5265000000002');
  insert into public.jornada_dia (id, tenant_id, operador_id, dia) values (j_a, a, op_a, date '2026-10-14'), (j_b, b, op_b, date '2026-10-14');

  -- (1) Sin marca viva: se asienta la declarada.
  r := public.asentar_declaracion_jornada(j_a, a, 'inicio_jornada', timestamptz '2026-10-14 06:10:00-06', 'wamid-1');
  if r is distinct from 'asentado' then raise exception '0865(1): esperaba asentado, vino %', r; end if;

  -- (2) El MISMO mensaje reentregado: ya estaba, y no hay doble marca.
  r := public.asentar_declaracion_jornada(j_a, a, 'inicio_jornada', timestamptz '2026-10-14 06:10:00-06', 'wamid-1');
  if r is distinct from 'ya_estaba' then raise exception '0865(2): esperaba ya_estaba, vino %', r; end if;

  -- (3) Una declaración humana viva NO se pisa por otra declaración distinta.
  r := public.asentar_declaracion_jornada(j_a, a, 'inicio_jornada', timestamptz '2026-10-14 07:00:00-06', 'wamid-2');
  if r is distinct from 'ya_estaba' then raise exception '0865(3): una marca humana viva no se pisa, vino %', r; end if;

  -- (4) EL DEFECTO: hay una marca DERIVADA viva (hito de viaje 05:50) y el chofer declara su fin/inicio a las 06:10.
  insert into public.jornada_asiento (tenant_id, jornada_id, tipo, momento, procedencia, origen_ref)
  values (a, j_a, 'fin_jornada', timestamptz '2026-10-14 18:00:00-06', 'hito_viaje', 'viaje:0865:llegada_en');
  r := public.asentar_declaracion_jornada(j_a, a, 'fin_jornada', timestamptz '2026-10-14 18:30:00-06', 'wamid-3');
  if r is distinct from 'asentado' then raise exception '0865(4): la declaración debe sustituir a la derivada, vino %', r; end if;
  select * into vivo from public.jornada_asiento where jornada_id = j_a and tipo = 'fin_jornada' and anulado_en is null;
  if vivo.procedencia is distinct from 'declarado_operador' or vivo.momento is distinct from timestamptz '2026-10-14 18:30:00-06' then
    raise exception '0865(4): la marca viva debe ser la declarada, es % %', vivo.procedencia, vivo.momento; end if;
  select * into viejo from public.jornada_asiento where jornada_id = j_a and tipo = 'fin_jornada' and procedencia = 'hito_viaje';
  if viejo.anulado_en is null or viejo.anulado_motivo is null or viejo.anulado_por_email is null then
    raise exception '0865(4): la derivada debe quedar anulada con motivo y firma (append-only)'; end if;
  if vivo.corrige_a is distinct from viejo.id then raise exception '0865(4): la declarada debe apuntar a la derivada con corrige_a'; end if;
  select count(*) into n from public.jornada_asiento where jornada_id = j_a and tipo = 'fin_jornada';
  if n <> 2 then raise exception '0865(4): el expediente conserva las dos versiones, hay %', n; end if;

  -- (5) AISLAMIENTO: un expediente de otra flota no se toca con el tenant equivocado.
  begin
    perform public.asentar_declaracion_jornada(j_b, a, 'inicio_jornada', now(), 'wamid-x');
    raise exception '0865(5): debía rechazar un expediente de otra flota';
  exception when others then
    if sqlerrm not like '%does not belong to tenant%' then raise; end if;
  end;
  select count(*) into n from public.jornada_asiento where jornada_id = j_b;
  if n <> 0 then raise exception '0865(5): no debe escribirse nada en la flota B'; end if;

  -- (6) Tipos fuera de dominio y mensaje vacío se rechazan.
  begin
    perform public.asentar_declaracion_jornada(j_a, a, 'inicio_descanso', now(), 'wamid-y');
    raise exception '0865(6): inicio_descanso no es un extremo';
  exception when others then
    if sqlerrm not like '%type is invalid%' then raise; end if;
  end;
  begin
    perform public.asentar_declaracion_jornada(j_a, a, 'inicio_jornada', now(), '  ');
    raise exception '0865(6): el mensaje vacío debía rechazarse';
  exception when others then
    if sqlerrm not like '%requires the message id%' then raise; end if;
  end;

  -- (7) PRIVILEGIOS: solo service_role.
  if has_function_privilege('anon', 'public.asentar_declaracion_jornada(uuid, uuid, text, timestamptz, text, uuid, jsonb)', 'execute') then raise exception '0865(7): anon no'; end if;
  if has_function_privilege('authenticated', 'public.asentar_declaracion_jornada(uuid, uuid, text, timestamptz, text, uuid, jsonb)', 'execute') then raise exception '0865(7): authenticated no'; end if;
  if not has_function_privilege('service_role', 'public.asentar_declaracion_jornada(uuid, uuid, text, timestamptz, text, uuid, jsonb)', 'execute') then raise exception '0865(7): service_role sí'; end if;
  if (select p.proconfig is null from pg_proc p where p.oid = 'public.asentar_declaracion_jornada(uuid, uuid, text, timestamptz, text, uuid, jsonb)'::regprocedure) then
    raise exception '0865(7): la función debe llevar search_path fijo'; end if;

  -- (8) REVERSA (la del encabezado): tras ella no queda rastro.
  drop function if exists public.asentar_declaracion_jornada(uuid, uuid, text, timestamptz, text, uuid, jsonb);
  if to_regprocedure('public.asentar_declaracion_jornada(uuid, uuid, text, timestamptz, text, uuid, jsonb)') is not null then
    raise exception '0865(8): la función debía desaparecer con la reversa'; end if;
end $$;

rollback;
