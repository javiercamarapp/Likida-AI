\set ON_ERROR_STOP on
-- 0786 — Liquidación por correo: encabezado del desglose, excepciones y estado del pull.
-- Contra Postgres real. Prueba lo que solo la base garantiza:
--   (a) la FK compuesta impide colgar un encabezado de la liquidación de OTRA flota;
--   (b) purgar la liquidación (purgar_liquidacion_externa, 0562) borra su encabezado en cascada;
--   (c) la bitácora es única por flota+terminal, y dos terminales nulas cuentan como la misma;
--   (d) dominios y formas del encabezado (tipo de operador, origen del total, días, largos);
--   (e) una sola excepción ABIERTA por flota+clave+tipo; resuelta, se puede abrir otra;
--   (f) el estado del pull es una fila por flota con contadores no negativos;
--   (g) las tres tablas nacen con RLS y authenticated no escribe.
-- Datos sintéticos (sin personas ni empresas reales).
begin;

insert into public.tenant (id, nombre) values
  ('78600000-0000-4000-8000-0000000000a1', 'Flota A 0786'),
  ('78600000-0000-4000-8000-0000000000b1', 'Flota B 0786');

insert into public.operador (id, tenant_id, nombre, telefono) values
  ('78600000-0000-4000-8000-0000000000a2', '78600000-0000-4000-8000-0000000000a1', 'Operador Uno', '5215500000001'),
  ('78600000-0000-4000-8000-0000000000b2', '78600000-0000-4000-8000-0000000000b1', 'Operador Dos', '5215500000002');

set local role service_role;

-- Una liquidación vieja de A (para la purga) y una reciente de A y de B.
insert into public.liquidacion_externa
  (id, tenant_id, clave_externa, huella, operador_id, periodo_desde, periodo_hasta, conceptos, total, moneda, pdf_origen, estado, acuse_tipo, acuse_en, created_at)
values
  ('78600000-0000-4000-8000-0000000000d1', '78600000-0000-4000-8000-0000000000a1', 'V1', repeat('a',64), '78600000-0000-4000-8000-0000000000a2', '2020-01-01','2020-01-07',
    '[{"descripcion":"x","tipo":"percepcion","monto":1}]'::jsonb, 1, 'MXN', 'generado', 'acusada', 'recibida', now() - interval '70 months', now() - interval '70 months'),
  ('78600000-0000-4000-8000-0000000000d2', '78600000-0000-4000-8000-0000000000a1', 'R1', repeat('b',64), '78600000-0000-4000-8000-0000000000a2', '2026-09-01','2026-09-07',
    '[{"descripcion":"x","tipo":"percepcion","monto":1}]'::jsonb, 1, 'MXN', 'generado', 'pendiente', null, null, now()),
  ('78600000-0000-4000-8000-0000000000d3', '78600000-0000-4000-8000-0000000000b1', 'R1', repeat('c',64), '78600000-0000-4000-8000-0000000000b2', '2026-09-01','2026-09-07',
    '[{"descripcion":"x","tipo":"percepcion","monto":1}]'::jsonb, 1, 'MXN', 'generado', 'pendiente', null, null, now());

do $$
declare
  v_falla boolean; n int; c int;
  A  constant uuid := '78600000-0000-4000-8000-0000000000a1';
  B  constant uuid := '78600000-0000-4000-8000-0000000000b1';
  L1 constant uuid := '78600000-0000-4000-8000-0000000000d1';  -- A, vieja
  L2 constant uuid := '78600000-0000-4000-8000-0000000000d2';  -- A, reciente
  L3 constant uuid := '78600000-0000-4000-8000-0000000000d3';  -- B
begin
  -- Encabezado válido (con póliza) y otro sin póliza ni terminal.
  insert into public.liquidacion_desglose (liquidacion_externa_id, tenant_id, bitacora, terminal, poliza, unidad, tipo_operador, dias, total_origen)
    values (L1, A, 'BIT-0001', 'T1', 'POL-0001', 'U-100', 'foraneo', 6, 'tms');
  insert into public.liquidacion_desglose (liquidacion_externa_id, tenant_id, bitacora, total_origen)
    values (L2, A, 'BIT-0002', 'calculado');
  select count(*) into c from public.liquidacion_desglose where tenant_id = A;
  if c <> 2 then raise exception 'FALLO a0: se esperaban 2 encabezados de A y hay %', c; end if;

  -- (a) FK compuesta: el encabezado de la flota B no cuelga de la liquidación de A (y viceversa).
  v_falla := false;
  begin
    insert into public.liquidacion_desglose (liquidacion_externa_id, tenant_id, bitacora, total_origen)
      values (L3, A, 'BIT-X', 'tms');
  exception when foreign_key_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO a1: un encabezado de la flota A colgó de la liquidación de B'; end if;
  v_falla := false;
  begin
    insert into public.liquidacion_desglose (liquidacion_externa_id, tenant_id, bitacora, total_origen)
      values (L3, B, 'BIT-0003', 'tms');
    -- válido para B: debe pasar; si falla, cae al when others de abajo
  exception when others then v_falla := true; end;
  if v_falla then raise exception 'FALLO a2: el encabezado legítimo de B se rechazó'; end if;
  -- una liquidación que no existe tampoco admite encabezado
  v_falla := false;
  begin
    insert into public.liquidacion_desglose (liquidacion_externa_id, tenant_id, bitacora, total_origen)
      values ('78600000-0000-4000-8000-0000000000ff', A, 'BIT-Y', 'tms');
  exception when foreign_key_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO a3: se aceptó un encabezado sin liquidación'; end if;

  -- (b) cascada: purgar la liquidación vieja de A se lleva su encabezado.
  perform public.purgar_liquidacion_externa();
  select count(*) into c from public.liquidacion_externa where id = L1;
  if c <> 0 then raise exception 'FALLO b0: la purga no borró la liquidación vieja (el escenario no aplica)'; end if;
  select count(*) into c from public.liquidacion_desglose where liquidacion_externa_id = L1;
  if c <> 0 then raise exception 'FALLO b1: el encabezado sobrevivió a la purga de su liquidación'; end if;
  select count(*) into c from public.liquidacion_desglose where liquidacion_externa_id = L2;
  if c <> 1 then raise exception 'FALLO b2: la purga se llevó el encabezado de una liquidación reciente'; end if;

  -- (c) bitácora única por flota+terminal; terminal nula = misma terminal.
  insert into public.liquidacion_externa
    (id, tenant_id, clave_externa, huella, operador_id, periodo_desde, periodo_hasta, conceptos, total, moneda, pdf_origen)
  values
    ('78600000-0000-4000-8000-0000000000d4', A, 'R2', repeat('d',64), '78600000-0000-4000-8000-0000000000a2', '2026-09-01','2026-09-07',
      '[{"descripcion":"x","tipo":"percepcion","monto":1}]'::jsonb, 1, 'MXN', 'generado'),
    ('78600000-0000-4000-8000-0000000000d5', A, 'R3', repeat('e',64), '78600000-0000-4000-8000-0000000000a2', '2026-09-01','2026-09-07',
      '[{"descripcion":"x","tipo":"percepcion","monto":1}]'::jsonb, 1, 'MXN', 'generado');
  v_falla := false;
  begin  -- misma bitácora, ambas sin terminal
    insert into public.liquidacion_desglose (liquidacion_externa_id, tenant_id, bitacora, total_origen)
      values ('78600000-0000-4000-8000-0000000000d4', A, 'BIT-0002', 'tms');
  exception when unique_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO c1: la misma bitácora sin terminal se duplicó'; end if;
  -- misma bitácora en otra terminal: permitida
  insert into public.liquidacion_desglose (liquidacion_externa_id, tenant_id, bitacora, terminal, total_origen)
    values ('78600000-0000-4000-8000-0000000000d4', A, 'BIT-0002', 'T2', 'tms');
  v_falla := false;
  begin  -- y esa terminal tampoco se repite
    insert into public.liquidacion_desglose (liquidacion_externa_id, tenant_id, bitacora, terminal, total_origen)
      values ('78600000-0000-4000-8000-0000000000d5', A, 'BIT-0002', 'T2', 'tms');
  exception when unique_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO c2: la misma bitácora en la misma terminal se duplicó'; end if;
  -- la misma bitácora en OTRA flota es otra bitácora (B ya tiene BIT-0003; usamos otra liquidación de B)
  insert into public.liquidacion_externa
    (id, tenant_id, clave_externa, huella, operador_id, periodo_desde, periodo_hasta, conceptos, total, moneda, pdf_origen)
  values
    ('78600000-0000-4000-8000-0000000000d6', B, 'R2', repeat('f',64), '78600000-0000-4000-8000-0000000000b2', '2026-09-01','2026-09-07',
      '[{"descripcion":"x","tipo":"percepcion","monto":1}]'::jsonb, 1, 'MXN', 'generado');
  insert into public.liquidacion_desglose (liquidacion_externa_id, tenant_id, bitacora, total_origen)
    values ('78600000-0000-4000-8000-0000000000d6', B, 'BIT-0002', 'tms');

  -- (d) dominios y formas del encabezado
  foreach n in array array[1,2,3,4,5,6,7,8] loop
    v_falla := false;
    begin
      case n
        when 1 then update public.liquidacion_desglose set tipo_operador = 'desconocido' where liquidacion_externa_id = L2;
        when 2 then update public.liquidacion_desglose set total_origen = 'otro' where liquidacion_externa_id = L2;
        when 3 then update public.liquidacion_desglose set dias = -1 where liquidacion_externa_id = L2;
        when 4 then update public.liquidacion_desglose set dias = 400 where liquidacion_externa_id = L2;
        when 5 then update public.liquidacion_desglose set bitacora = '' where liquidacion_externa_id = L2;
        when 6 then update public.liquidacion_desglose set poliza = repeat('p', 61) where liquidacion_externa_id = L2;
        when 7 then update public.liquidacion_desglose set unidad = '' where liquidacion_externa_id = L2;
        when 8 then update public.liquidacion_desglose set retenida_motivo = repeat('m', 501) where liquidacion_externa_id = L2;
      end case;
    exception when check_violation then v_falla := true; end;
    if not v_falla then raise exception 'FALLO d.%: un valor inválido del encabezado se aceptó', n; end if;
  end loop;
  -- los tres tipos de operador y los dos orígenes del total son válidos
  update public.liquidacion_desglose set tipo_operador = 'permisionario', total_origen = 'calculado', dias = 0 where liquidacion_externa_id = L2;
  update public.liquidacion_desglose set tipo_operador = 'local' where liquidacion_externa_id = L2;
  -- póliza nula es válida (hay bitácoras sin póliza)
  select count(*) into c from public.liquidacion_desglose where liquidacion_externa_id = L2 and poliza is null;
  if c <> 1 then raise exception 'FALLO d9: una bitácora sin póliza no se pudo guardar'; end if;

  -- (e) excepciones: una abierta por flota+clave+tipo
  insert into public.liquidacion_excepcion (tenant_id, clave_externa, tipo, detalle)
    values (A, 'BIT-0002', 'sin_poliza', '{"campo":"poliza"}'::jsonb);
  v_falla := false;
  begin
    insert into public.liquidacion_excepcion (tenant_id, clave_externa, tipo) values (A, 'BIT-0002', 'sin_poliza');
  exception when unique_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO e1: se abrió una segunda excepción igual'; end if;
  -- mismo clave con OTRO tipo, y mismo tipo en OTRA flota: permitidos
  insert into public.liquidacion_excepcion (tenant_id, clave_externa, tipo) values (A, 'BIT-0002', 'operador_sin_correo');
  insert into public.liquidacion_excepcion (tenant_id, clave_externa, tipo) values (B, 'BIT-0002', 'sin_poliza');
  -- reaparecer solo actualiza ultima_vez (así lo hace el upsert del repositorio)
  insert into public.liquidacion_excepcion (tenant_id, clave_externa, tipo, ultima_vez)
    values (A, 'BIT-0002', 'sin_poliza', now() + interval '1 hour')
    on conflict (tenant_id, clave_externa, tipo) where resuelta_en is null
    do update set ultima_vez = excluded.ultima_vez;
  select count(*) into c from public.liquidacion_excepcion where tenant_id = A and clave_externa = 'BIT-0002' and tipo = 'sin_poliza';
  if c <> 1 then raise exception 'FALLO e2: reaparecer duplicó la excepción (%)', c; end if;
  -- resuelta, se puede abrir otra; la resuelta queda de historia
  update public.liquidacion_excepcion set resuelta_en = now() + interval '2 hours'
    where tenant_id = A and clave_externa = 'BIT-0002' and tipo = 'sin_poliza';
  insert into public.liquidacion_excepcion (tenant_id, clave_externa, tipo) values (A, 'BIT-0002', 'sin_poliza');
  select count(*) into c from public.liquidacion_excepcion where tenant_id = A and clave_externa = 'BIT-0002' and tipo = 'sin_poliza';
  if c <> 2 then raise exception 'FALLO e3: se esperaban 2 filas (resuelta + abierta) y hay %', c; end if;
  -- dominios
  foreach n in array array[1,2,3,4] loop
    v_falla := false;
    begin
      case n
        when 1 then insert into public.liquidacion_excepcion (tenant_id, clave_externa, tipo) values (A, 'K', 'tipo_inventado');
        when 2 then insert into public.liquidacion_excepcion (tenant_id, clave_externa, tipo) values (A, '', 'sin_poliza');
        when 3 then insert into public.liquidacion_excepcion (tenant_id, clave_externa, tipo, detalle) values (A, 'K', 'sin_poliza', '[]'::jsonb);
        when 4 then insert into public.liquidacion_excepcion (tenant_id, clave_externa, tipo, primera_vez, ultima_vez)
                      values (A, 'K', 'sin_poliza', now(), now() - interval '1 day');
      end case;
    exception when check_violation then v_falla := true; end;
    if not v_falla then raise exception 'FALLO e4.%: una excepción inválida se aceptó', n; end if;
  end loop;
  -- los diez tipos del contrato son aceptados
  insert into public.liquidacion_excepcion (tenant_id, clave_externa, tipo)
    select A, 'TODOS', t from unnest(array['sin_poliza','operador_no_encontrado','operador_sin_correo','coordinador_sin_correo',
      'total_no_cuadra','concepto_prohibido','neto_negativo','tipo_sin_regla','correccion_pendiente','mapeo_invalido']) t;
  select count(*) into c from public.liquidacion_excepcion where tenant_id = A and clave_externa = 'TODOS';
  if c <> 10 then raise exception 'FALLO e5: se esperaban 10 tipos aceptados y hay %', c; end if;

  -- (f) estado del pull: una fila por flota, contadores no negativos
  insert into public.liquidacion_pull_estado (tenant_id) values (A);
  select leidas + importadas + excepciones into c from public.liquidacion_pull_estado where tenant_id = A;
  if c <> 0 then raise exception 'FALLO f0: los contadores no nacen en cero'; end if;
  v_falla := false;
  begin insert into public.liquidacion_pull_estado (tenant_id) values (A);
  exception when unique_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO f1: dos estados de pull para la misma flota'; end if;
  update public.liquidacion_pull_estado
     set cursor = '{"desde":"2026-09-01"}'::jsonb, ultima_corrida = now(), ultimo_exito = now(), leidas = 5, importadas = 4, excepciones = 1
   where tenant_id = A;
  foreach n in array array[1,2,3,4] loop
    v_falla := false;
    begin
      case n
        when 1 then update public.liquidacion_pull_estado set leidas = -1 where tenant_id = A;
        when 2 then update public.liquidacion_pull_estado set cursor = '[]'::jsonb where tenant_id = A;
        when 3 then update public.liquidacion_pull_estado set ultimo_error = repeat('e', 1001) where tenant_id = A;
        when 4 then update public.liquidacion_pull_estado set excepciones = -3 where tenant_id = A;
      end case;
    exception when check_violation then v_falla := true; end;
    if not v_falla then raise exception 'FALLO f2.%: un estado de pull inválido se aceptó', n; end if;
  end loop;
end $$;

-- (g) RLS prendida en las tres y authenticated no escribe
do $$
declare t text;
begin
  foreach t in array array['liquidacion_desglose','liquidacion_excepcion','liquidacion_pull_estado'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception 'FALLO g0: % nació sin RLS', t;
    end if;
  end loop;
end $$;

set local role authenticated;
do $$
declare v_falla boolean;
begin
  v_falla := false;
  begin
    insert into public.liquidacion_excepcion (tenant_id, clave_externa, tipo)
      values ('78600000-0000-4000-8000-0000000000b1', 'X', 'sin_poliza');
  exception when others then v_falla := true; end;
  if not v_falla then raise exception 'FALLO g1: authenticated pudo escribir una excepción'; end if;
  v_falla := false;
  begin
    insert into public.liquidacion_pull_estado (tenant_id) values ('78600000-0000-4000-8000-0000000000b1');
  exception when others then v_falla := true; end;
  if not v_falla then raise exception 'FALLO g2: authenticated pudo escribir el estado del pull'; end if;
  v_falla := false;
  begin
    insert into public.liquidacion_desglose (liquidacion_externa_id, tenant_id, bitacora, total_origen)
      values ('78600000-0000-4000-8000-0000000000d3', '78600000-0000-4000-8000-0000000000b1', 'Z', 'tms');
  exception when others then v_falla := true; end;
  if not v_falla then raise exception 'FALLO g3: authenticated pudo escribir un encabezado'; end if;
end $$;

rollback;
\echo '0786: ok'
