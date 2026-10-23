\set ON_ERROR_STOP on
-- 0857 — Recepción atómica del desglose por correo (hallazgo A35-A1-01), contra Postgres real.
-- Lo que solo la base puede demostrar:
--   (a) éxito completo: liquidación + encabezado + evento + entregas en una llamada;
--   (b) fallo a mitad (una entrega con correo inválido tumba lo último): NO queda NADA de las
--       escrituras anteriores (ni liquidación, ni encabezado, ni evento);
--   (c) idempotencia: la misma llamada otra vez no duplica ni crea nada;
--   (d) reparación: una liquidación a medias (estado que dejaba el código anterior: fila sin
--       encabezado, o encabezado sin entregas y sin retención) se completa; con la misma huella;
--       una retenida NO recibe entregas; otra huella lanza P0001 y no toca nada;
--   (e) aislamiento por tenant: un operador de otra flota no puede colgarse; la misma clave en
--       dos flotas son dos liquidaciones; las entregas llevan el tenant que se pidió;
--   (f) permisos (solo service_role) y la reversa documentada en la cabecera de la migración.
-- Datos sintéticos (sin personas ni empresas reales). Corre desde la raíz del repo (usa \i).
begin;

insert into public.tenant (id, nombre) values
  ('85700000-0000-4000-8000-0000000000a1', 'Flota A 0857'),
  ('85700000-0000-4000-8000-0000000000b1', 'Flota B 0857');

insert into public.operador (id, tenant_id, nombre, telefono) values
  ('85700000-0000-4000-8000-0000000000a2', '85700000-0000-4000-8000-0000000000a1', 'Operador Uno', '5215500000001'),
  ('85700000-0000-4000-8000-0000000000b2', '85700000-0000-4000-8000-0000000000b1', 'Operador Dos', '5215500000002');

-- Utilidades de la prueba: arman los cinco parámetros.
create function pg_temp.liq(p_clave text, p_huella text, p_op uuid) returns jsonb language sql as $$
  select jsonb_build_object(
    'clave_externa', p_clave, 'huella', p_huella, 'sistema_origen', 'desglose-bitacora', 'operador_id', p_op,
    'folios_viaje', jsonb_build_array('B-1'), 'viaje_ids', '[]'::jsonb,
    'periodo_desde', '2026-10-01', 'periodo_hasta', '2026-10-07',
    'conceptos', '[{"descripcion":"x","tipo":"percepcion","monto":10}]'::jsonb,
    'total', 10, 'moneda', 'MXN', 'pdf_ruta', null, 'pdf_origen', 'generado', 'pdf_sha256', null)
$$;
create function pg_temp.desg(p_ret text, p_bit text default 'B-1') returns jsonb language sql as $$
  select jsonb_build_object('bitacora', p_bit, 'terminal', 'T1', 'poliza', 'P-1', 'unidad', 'U-1',
    'tipo_operador', 'foraneo', 'dias', 6, 'total_origen', 'tms', 'retenida_motivo', p_ret)
$$;
create function pg_temp.entr(p_correos text[]) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('rol', r, 'correo', c, 'xlsx_ruta', 'ruta/x.xlsx',
         'xlsx_sha256', repeat('a', 64), 'disparo', 'auto') order by ord), '[]'::jsonb)
  from unnest(array['operador','coordinador','rh','archivo'], p_correos) with ordinality as t(r, c, ord)
  where c is not null
$$;
grant execute on function pg_temp.liq(text, text, uuid), pg_temp.desg(text, text), pg_temp.entr(text[]) to public;

set local role service_role;

do $$
declare
  A constant uuid := '85700000-0000-4000-8000-0000000000a1';
  B constant uuid := '85700000-0000-4000-8000-0000000000b1';
  OA constant uuid := '85700000-0000-4000-8000-0000000000a2';
  OB constant uuid := '85700000-0000-4000-8000-0000000000b2';
  H1 constant text := repeat('1', 64);
  H2 constant text := repeat('2', 64);
  r jsonb; n int; id1 uuid; id2 uuid; v_ok boolean;
begin
  -- ── (a) éxito completo ─────────────────────────────────────────────────────
  r := public.recibir_desglose_atomico(A, pg_temp.liq('K1', H1, OA), pg_temp.desg(null), '{"origen":"t"}',
         pg_temp.entr(array['op@ejemplo.test','co@ejemplo.test','rh@ejemplo.test','ar@ejemplo.test']));
  id1 := (r->>'liquidacion_id')::uuid;
  if (r->>'creada')::boolean is not true or (r->>'entregas')::int <> 4 or (r->>'reparada')::boolean then
    raise exception 'FALLO a1: respuesta inesperada %', r;
  end if;
  select count(*) into n from public.liquidacion_desglose where liquidacion_externa_id = id1 and tenant_id = A;
  if n <> 1 then raise exception 'FALLO a2: encabezado %', n; end if;
  select count(*) into n from public.liquidacion_externa_evento where liquidacion_externa_id = id1 and tipo = 'recibida';
  if n <> 1 then raise exception 'FALLO a3: evento %', n; end if;
  select count(*) into n from public.liquidacion_entrega_correo where liquidacion_externa_id = id1 and tenant_id = A;
  if n <> 4 then raise exception 'FALLO a4: entregas %', n; end if;

  -- ── (c) idempotencia ──────────────────────────────────────────────────────
  r := public.recibir_desglose_atomico(A, pg_temp.liq('K1', H1, OA), pg_temp.desg(null), '{"origen":"t"}',
         pg_temp.entr(array['op@ejemplo.test','co@ejemplo.test','rh@ejemplo.test','ar@ejemplo.test']));
  if (r->>'liquidacion_id')::uuid <> id1 or (r->>'creada')::boolean or (r->>'reparada')::boolean or (r->>'entregas')::int <> 0 then
    raise exception 'FALLO c1: la segunda llamada no fue idempotente %', r;
  end if;
  select count(*) into n from public.liquidacion_externa where tenant_id = A and clave_externa = 'K1';
  if n <> 1 then raise exception 'FALLO c2: liquidaciones %', n; end if;
  select count(*) into n from public.liquidacion_entrega_correo where liquidacion_externa_id = id1;
  if n <> 4 then raise exception 'FALLO c3: entregas duplicadas %', n; end if;
  select count(*) into n from public.liquidacion_externa_evento where liquidacion_externa_id = id1;
  if n <> 1 then raise exception 'FALLO c4: evento duplicado %', n; end if;
  -- mayúsculas en el correo: mismo destino
  r := public.recibir_desglose_atomico(A, pg_temp.liq('K1', H1, OA), pg_temp.desg(null), '{}',
         pg_temp.entr(array['OP@Ejemplo.TEST',null,null,null]));
  if (r->>'entregas')::int <> 0 then raise exception 'FALLO c5: el correo con otras mayúsculas duplicó %', r; end if;

  -- ── (b) fallo a mitad: la entrega 3 tiene correo inválido ─────────────────────
  v_ok := false;
  begin
    perform public.recibir_desglose_atomico(A, pg_temp.liq('K2', H1, OA), pg_temp.desg(null, 'B-2'), '{}',
      pg_temp.entr(array['op@ejemplo.test','co@ejemplo.test','esto-no-es-correo','ar@ejemplo.test']));
  exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'FALLO b1: el correo inválido debía tumbar la recepción'; end if;
  select count(*) into n from public.liquidacion_externa where tenant_id = A and clave_externa = 'K2';
  if n <> 0 then raise exception 'FALLO b2: quedó la liquidación a medias (%)', n; end if;
  select count(*) into n from public.liquidacion_desglose where tenant_id = A and bitacora = 'B-2';
  if n <> 0 then raise exception 'FALLO b3: quedó un encabezado huérfano (%)', n; end if;
  select count(*) into n from public.liquidacion_externa_evento where tenant_id = A and liquidacion_externa_id <> id1;
  if n <> 0 then raise exception 'FALLO b4: quedó un evento huérfano (%)', n; end if;
  select count(*) into n from public.liquidacion_entrega_correo where tenant_id = A and liquidacion_externa_id <> id1;
  if n <> 0 then raise exception 'FALLO b5: quedaron entregas (%)', n; end if;
  -- y el reintento ya sano crea todo
  r := public.recibir_desglose_atomico(A, pg_temp.liq('K2', H1, OA), pg_temp.desg(null, 'B-2'), '{}',
         pg_temp.entr(array['op@ejemplo.test','co@ejemplo.test',null,null]));
  if (r->>'creada')::boolean is not true or (r->>'entregas')::int <> 2 then raise exception 'FALLO b6: %', r; end if;

  -- ── (d) reparación del estado que dejaba el código anterior ───────────────────
  -- d1: liquidación SIN encabezado (corte justo después del insert de la fila).
  insert into public.liquidacion_externa
    (tenant_id, clave_externa, huella, operador_id, periodo_desde, periodo_hasta, conceptos, total, moneda, pdf_origen)
  values (A, 'K3', H1, OA, '2026-10-01', '2026-10-07', '[{"descripcion":"x","tipo":"percepcion","monto":10}]', 10, 'MXN', 'generado')
  returning id into id2;
  r := public.recibir_desglose_atomico(A, pg_temp.liq('K3', H1, OA), pg_temp.desg(null, 'B-3'), '{}',
         pg_temp.entr(array['op@ejemplo.test','co@ejemplo.test',null,null]));
  if (r->>'creada')::boolean or (r->>'reparada')::boolean is not true or (r->>'entregas')::int <> 2 then
    raise exception 'FALLO d1: no reparó la liquidación sin encabezado %', r;
  end if;
  select count(*) into n from public.liquidacion_desglose where liquidacion_externa_id = id2;
  if n <> 1 then raise exception 'FALLO d2: sin encabezado tras reparar'; end if;
  -- d3: encabezado sin entregas y sin retención (corte justo antes de las entregas).
  insert into public.liquidacion_externa
    (tenant_id, clave_externa, huella, operador_id, periodo_desde, periodo_hasta, conceptos, total, moneda, pdf_origen)
  values (A, 'K4', H1, OA, '2026-10-01', '2026-10-07', '[{"descripcion":"x","tipo":"percepcion","monto":10}]', 10, 'MXN', 'generado')
  returning id into id2;
  insert into public.liquidacion_desglose (liquidacion_externa_id, tenant_id, bitacora, total_origen)
  values (id2, A, 'B-4', 'tms');
  r := public.recibir_desglose_atomico(A, pg_temp.liq('K4', H1, OA), pg_temp.desg(null), '{}',
         pg_temp.entr(array['op@ejemplo.test',null,null,null]));
  if (r->>'reparada')::boolean is not true or (r->>'entregas')::int <> 1 then
    raise exception 'FALLO d3: no creó las entregas del desglose a medias %', r;
  end if;
  -- d4: una RETENIDA no recibe entregas aunque se las pidan.
  r := public.recibir_desglose_atomico(A, pg_temp.liq('K5', H1, OA), pg_temp.desg('neto negativo', 'B-5'), '{}',
         pg_temp.entr(array['op@ejemplo.test',null,null,null]));
  if (r->>'entregas')::int <> 0 then raise exception 'FALLO d4: una retenida recibió entregas %', r; end if;
  r := public.recibir_desglose_atomico(A, pg_temp.liq('K5', H1, OA), pg_temp.desg('neto negativo', 'B-5'), '{}',
         pg_temp.entr(array['op@ejemplo.test',null,null,null]));
  select count(*) into n from public.liquidacion_entrega_correo e join public.liquidacion_externa l on l.id = e.liquidacion_externa_id
   where l.clave_externa = 'K5' and l.tenant_id = A;
  if n <> 0 then raise exception 'FALLO d5: la reparación mandó una retenida (%)', n; end if;
  -- d6: otra huella con la misma clave => P0001 y nada cambia.
  v_ok := false;
  begin
    perform public.recibir_desglose_atomico(A, pg_temp.liq('K1', H2, OA), pg_temp.desg(null), '{}',
      pg_temp.entr(array['otro@ejemplo.test',null,null,null]));
  exception when sqlstate 'P0001' then v_ok := true; end;
  if not v_ok then raise exception 'FALLO d6: otra huella debía lanzar P0001'; end if;
  select count(*) into n from public.liquidacion_entrega_correo where liquidacion_externa_id = id1;
  if n <> 4 then raise exception 'FALLO d7: la huella distinta tocó las entregas (%)', n; end if;

  -- ── (e) aislamiento por tenant ──────────────────────────────────────────────
  -- e1: operador de la flota B colgado de la flota A => lo rechaza la FK compuesta; nada queda.
  v_ok := false;
  begin
    perform public.recibir_desglose_atomico(A, pg_temp.liq('K6', H1, OB), pg_temp.desg(null, 'B-6'), '{}',
      pg_temp.entr(array['op@ejemplo.test',null,null,null]));
  exception when foreign_key_violation then v_ok := true; end;
  if not v_ok then raise exception 'FALLO e1: se colgó un operador de otra flota'; end if;
  select count(*) into n from public.liquidacion_externa where clave_externa = 'K6';
  if n <> 0 then raise exception 'FALLO e2: quedó la fila de K6'; end if;
  -- e3: la misma clave en la flota B es OTRA liquidación, con sus entregas y su tenant.
  r := public.recibir_desglose_atomico(B, pg_temp.liq('K1', H1, OB), pg_temp.desg(null), '{}',
         pg_temp.entr(array['op@ejemplo.test',null,null,null]));
  if (r->>'creada')::boolean is not true or (r->>'liquidacion_id')::uuid = id1 then
    raise exception 'FALLO e3: la clave de A se mezcló con la de B %', r;
  end if;
  select count(*) into n from public.liquidacion_entrega_correo where tenant_id = B and liquidacion_externa_id = (r->>'liquidacion_id')::uuid;
  if n <> 1 then raise exception 'FALLO e4: entregas de B %', n; end if;
  select count(*) into n from public.liquidacion_entrega_correo where tenant_id = B and liquidacion_externa_id = id1;
  if n <> 0 then raise exception 'FALLO e5: la flota B ve/crea entregas de la liquidación de A'; end if;
  -- e6: tenant nulo y argumentos mal formados se rechazan.
  v_ok := false;
  begin perform public.recibir_desglose_atomico(null, '{}', '{}', '{}', '[]'); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FALLO e6: tenant nulo aceptado'; end if;
  v_ok := false;
  begin perform public.recibir_desglose_atomico(A, '{}', '{}', '{}', '{}'); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FALLO e7: p_entregas que no es arreglo aceptado'; end if;
end $$;

-- ── (f) permisos ────────────────────────────────────────────────────────────
reset role;
do $$
begin
  if has_function_privilege('anon', 'public.recibir_desglose_atomico(uuid,jsonb,jsonb,jsonb,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.recibir_desglose_atomico(uuid,jsonb,jsonb,jsonb,jsonb)', 'execute') then
    raise exception 'FALLO f1: anon/authenticated pueden ejecutar la función';
  end if;
  if not has_function_privilege('service_role', 'public.recibir_desglose_atomico(uuid,jsonb,jsonb,jsonb,jsonb)', 'execute') then
    raise exception 'FALLO f2: service_role no puede ejecutarla';
  end if;
end $$;

-- ── (g) la migración es idempotente: aplicarla otra vez no cambia nada ───────
\i supabase/migrations/0857_recibir_desglose_atomico.sql
do $$
begin
  if (select count(*) from pg_proc where proname = 'recibir_desglose_atomico') <> 1 then
    raise exception 'FALLO g1: la segunda aplicación duplicó la función';
  end if;
end $$;

-- ── (h) la REVERSA de la cabecera: quita la función y NO toca ningún dato ─────
drop function if exists public.recibir_desglose_atomico(uuid, jsonb, jsonb, jsonb, jsonb);
do $$
declare n int;
begin
  if exists (select 1 from pg_proc where proname = 'recibir_desglose_atomico') then
    raise exception 'FALLO h1: la reversa no quitó la función';
  end if;
  select count(*) into n from public.liquidacion_externa where tenant_id = '85700000-0000-4000-8000-0000000000a1';
  if n < 4 then raise exception 'FALLO h2: la reversa tocó datos (%)', n; end if;
end $$;

rollback;
