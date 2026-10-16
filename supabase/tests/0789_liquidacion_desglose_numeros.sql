\set ON_ERROR_STOP on
-- 0789 — Desglose por liquidación: número de liquidación, número de pago y varias bitácoras.
-- Contra Postgres real. Prueba lo que solo la base garantiza:
--   (a) las columnas nuevas son nulas por omisión: un desglose sin números sigue guardándose igual que antes;
--   (b) el número de liquidación es único por flota+terminal (terminal nula = la misma), solo cuando existe;
--       dos desgloses SIN número no chocan entre sí, y la misma numeración en otra flota o terminal es otra;
--   (c) formas: número vacío o de más de 40 caracteres, lista de bitácoras vacía, de más de 100 o multidimensional se rechazan;
--   (d) varias bitácoras caben en un solo encabezado y se leen enteras;
--   (e) la excepción `unidades_mezcladas` se acepta y los tipos de 0786 siguen aceptados; uno inventado, no;
--   (f) RLS: la flota B no ve los desgloses de la A y `authenticated` no escribe.
-- Datos sintéticos (sin personas ni empresas reales). Se puede aplicar dos veces: todo corre en una transacción que se revierte.
begin;

insert into public.tenant (id, nombre) values
  ('78900000-0000-4000-8000-0000000000a1', 'Flota A 0789'),
  ('78900000-0000-4000-8000-0000000000b1', 'Flota B 0789');

insert into public.operador (id, tenant_id, nombre, telefono) values
  ('78900000-0000-4000-8000-0000000000a2', '78900000-0000-4000-8000-0000000000a1', 'Operador Uno', '5215500000011'),
  ('78900000-0000-4000-8000-0000000000b2', '78900000-0000-4000-8000-0000000000b1', 'Operador Dos', '5215500000012');

set local role service_role;

insert into public.liquidacion_externa
  (id, tenant_id, clave_externa, huella, operador_id, periodo_desde, periodo_hasta, conceptos, total, moneda, pdf_origen)
select ('78900000-0000-4000-8000-00000000d0' || lpad(g::text, 2, '0'))::uuid,
       case when g <= 6 then '78900000-0000-4000-8000-0000000000a1'::uuid else '78900000-0000-4000-8000-0000000000b1'::uuid end,
       'K' || g, repeat(to_hex(g), 64)::text,
       case when g <= 6 then '78900000-0000-4000-8000-0000000000a2'::uuid else '78900000-0000-4000-8000-0000000000b2'::uuid end,
       '2026-09-01'::date, '2026-09-07'::date,
       '[{"descripcion":"x","tipo":"percepcion","monto":1}]'::jsonb, 1, 'MXN', 'generado'
  from generate_series(1, 7) g;

do $$
declare
  v_falla boolean; n int; c int; arr text[];
  A constant uuid := '78900000-0000-4000-8000-0000000000a1';
  B constant uuid := '78900000-0000-4000-8000-0000000000b1';
  L1 constant uuid := '78900000-0000-4000-8000-00000000d001';
  L2 constant uuid := '78900000-0000-4000-8000-00000000d002';
  L3 constant uuid := '78900000-0000-4000-8000-00000000d003';
  L4 constant uuid := '78900000-0000-4000-8000-00000000d004';
  L5 constant uuid := '78900000-0000-4000-8000-00000000d005';
  L6 constant uuid := '78900000-0000-4000-8000-00000000d006';
  L7 constant uuid := '78900000-0000-4000-8000-00000000d007';
begin
  -- (a) sin los campos nuevos: igual que antes, y las columnas nacen nulas.
  insert into public.liquidacion_desglose (liquidacion_externa_id, tenant_id, bitacora, total_origen) values (L1, A, 'BIT-1', 'tms');
  select count(*) into c from public.liquidacion_desglose
   where liquidacion_externa_id = L1 and numero_liquidacion is null and numero_pago is null and bitacoras is null;
  if c <> 1 then raise exception 'FALLO a1: las columnas nuevas no nacen nulas'; end if;
  -- dos desgloses sin número no chocan (el único es parcial)
  insert into public.liquidacion_desglose (liquidacion_externa_id, tenant_id, bitacora, total_origen) values (L2, A, 'BIT-2', 'tms');

  -- (b) número de liquidación único por flota+terminal
  insert into public.liquidacion_desglose (liquidacion_externa_id, tenant_id, bitacora, numero_liquidacion, numero_pago, bitacoras, total_origen)
    values (L3, A, 'BIT-3', '1228', '10', array['BIT-3','BIT-4'], 'tms');
  v_falla := false;
  begin  -- mismo número, misma flota, ambas sin terminal
    insert into public.liquidacion_desglose (liquidacion_externa_id, tenant_id, bitacora, numero_liquidacion, total_origen)
      values (L4, A, 'BIT-5', '1228', 'tms');
  exception when unique_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO b1: el mismo número de liquidación se duplicó en la misma flota'; end if;
  -- mismo número en otra terminal: otra liquidación
  insert into public.liquidacion_desglose (liquidacion_externa_id, tenant_id, bitacora, terminal, numero_liquidacion, total_origen)
    values (L4, A, 'BIT-5', 'T2', '1228', 'tms');
  v_falla := false;
  begin  -- y esa terminal tampoco se repite
    insert into public.liquidacion_desglose (liquidacion_externa_id, tenant_id, bitacora, terminal, numero_liquidacion, total_origen)
      values (L5, A, 'BIT-6', 'T2', '1228', 'tms');
  exception when unique_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO b2: el mismo número en la misma terminal se duplicó'; end if;
  -- el mismo número en OTRA flota es otro
  insert into public.liquidacion_desglose (liquidacion_externa_id, tenant_id, bitacora, numero_liquidacion, total_origen)
    values (L7, B, 'BIT-7', '1228', 'tms');
  -- un número distinto en la misma flota convive
  insert into public.liquidacion_desglose (liquidacion_externa_id, tenant_id, bitacora, numero_liquidacion, total_origen)
    values (L5, A, 'BIT-6', '1229', 'tms');

  -- (c) formas
  foreach n in array array[1,2,3,4,5,6] loop
    v_falla := false;
    begin
      case n
        when 1 then update public.liquidacion_desglose set numero_liquidacion = '' where liquidacion_externa_id = L2;
        when 2 then update public.liquidacion_desglose set numero_liquidacion = repeat('9', 41) where liquidacion_externa_id = L2;
        when 3 then update public.liquidacion_desglose set numero_pago = '' where liquidacion_externa_id = L2;
        when 4 then update public.liquidacion_desglose set bitacoras = '{}'::text[] where liquidacion_externa_id = L2;
        when 5 then update public.liquidacion_desglose set bitacoras = (select array_agg('B' || g) from generate_series(1, 101) g) where liquidacion_externa_id = L2;
        when 6 then update public.liquidacion_desglose set bitacoras = array[['a','b'],['c','d']] where liquidacion_externa_id = L2;
      end case;
    exception when check_violation then v_falla := true; end;
    if not v_falla then raise exception 'FALLO c.%: un valor inválido de los campos nuevos se aceptó', n; end if;
  end loop;

  -- (d) varias bitácoras en un solo encabezado, leídas enteras y en orden
  select bitacoras into arr from public.liquidacion_desglose where liquidacion_externa_id = L3;
  if arr is distinct from array['BIT-3','BIT-4'] then raise exception 'FALLO d1: las bitácoras no se leyeron enteras (%)', arr; end if;
  update public.liquidacion_desglose set bitacoras = (select array_agg('B' || g) from generate_series(1, 100) g) where liquidacion_externa_id = L2;
  select cardinality(bitacoras) into c from public.liquidacion_desglose where liquidacion_externa_id = L2;
  if c <> 100 then raise exception 'FALLO d2: 100 bitácoras deberían caber y hay %', c; end if;

  -- (e) excepciones: el tipo nuevo se acepta; los de 0786 siguen; uno inventado no
  insert into public.liquidacion_excepcion (tenant_id, clave_externa, tipo, detalle)
    values (A, 'LIQ-1228', 'unidades_mezcladas', '{"unidades":2}'::jsonb);
  insert into public.liquidacion_excepcion (tenant_id, clave_externa, tipo)
    select A, 'TODOS', t from unnest(array['sin_poliza','operador_no_encontrado','operador_sin_correo','coordinador_sin_correo',
      'total_no_cuadra','concepto_prohibido','neto_negativo','tipo_sin_regla','correccion_pendiente','mapeo_invalido','unidades_mezcladas']) t;
  select count(*) into c from public.liquidacion_excepcion where tenant_id = A and clave_externa = 'TODOS';
  if c <> 11 then raise exception 'FALLO e1: se esperaban 11 tipos aceptados y hay %', c; end if;
  v_falla := false;
  begin
    insert into public.liquidacion_excepcion (tenant_id, clave_externa, tipo) values (A, 'K', 'tipo_inventado');
  exception when check_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO e2: un tipo de excepción inventado se aceptó'; end if;
  -- una sola abierta por flota+clave+tipo, también para el tipo nuevo
  v_falla := false;
  begin
    insert into public.liquidacion_excepcion (tenant_id, clave_externa, tipo) values (A, 'LIQ-1228', 'unidades_mezcladas');
  exception when unique_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO e3: se abrió una segunda excepción unidades_mezcladas igual'; end if;
end $$;

-- (f) RLS: la flota B (con permiso de finanzas) no ve los desgloses de A y no puede escribir.
reset role;
do $$
declare c int; v_falla boolean;
  A constant uuid := '78900000-0000-4000-8000-0000000000a1';
begin
  if not (select relrowsecurity from pg_class where oid = 'public.liquidacion_desglose'::regclass) then
    raise exception 'FALLO f0: liquidacion_desglose perdió su RLS';
  end if;
  set local role authenticated;
  select count(*) into c from public.liquidacion_desglose where tenant_id = A;
  if c <> 0 then raise exception 'FALLO f1: un usuario sin flota ve % desgloses de la flota A', c; end if;
  v_falla := false;
  begin
    update public.liquidacion_desglose set numero_liquidacion = '999' where tenant_id = A;
    get diagnostics c = row_count;
    if c > 0 then v_falla := false; else v_falla := true; end if;
  exception when insufficient_privilege then v_falla := true; end;
  if not v_falla then raise exception 'FALLO f2: authenticated pudo escribir el número de liquidación'; end if;
  reset role;
end $$;

rollback;
\echo 0789 OK
