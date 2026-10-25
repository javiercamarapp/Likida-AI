\set ON_ERROR_STOP on
-- 0876 · gasto_mezclar_ocr_extra (A37-S45-10) y uq_unidad_economico_ci (A37-S46-10).
-- Datos sintéticos; todo dentro de una transacción que termina en rollback.
--   (a) merge: las claves del parche entran y las que ya estaban (validación SAT, ingesta XML) SOBREVIVEN;
--   (b) historial: se AGREGA al arreglo; un valor suelto previo se vuelve el primer elemento; nada se pisa;
--   (c) monto: cambia junto con el merge, y p_sin_xml_verificado respeta al XML;
--   (d) filas tocadas: 0 si el gasto no existe o es de otra flota;
--   (e) argumentos incoherentes se rechazan;
--   (f) privilegios: solo service_role;
--   (g) número económico único sin mayúsculas ni espacios de orilla, por flota; y reaplicar es inofensivo;
--   (h) la REVERSA de la cabecera.
begin;

create function pg_temp.ok(c boolean, m text) returns void language plpgsql as $$
begin
  if c is not true then raise exception '0876: %', m; end if;
end $$;

create temp table _w (t1 uuid, t2 uuid, g1 uuid, g2 uuid);
do $$
declare t1 uuid; t2 uuid; o1 uuid; v1 uuid; g1 uuid; g2 uuid;
begin
  insert into tenant (nombre) values ('ZZZ 0876 FLOTA A') returning id into t1;
  insert into tenant (nombre) values ('ZZZ 0876 FLOTA B') returning id into t2;
  insert into operador (tenant_id, nombre, telefono) values (t1, 'P', '520000087601') returning id into o1;
  insert into viaje (tenant_id, operador_id) values (t1, o1) returning id into v1;
  insert into gasto (tenant_id, viaje_id, concepto, monto, ocr_extra)
    values (t1, v1, 'diesel', 800.00, '{"litros": 40, "validacionSat": {"estado": "vigente"}}') returning id into g1;
  insert into gasto (tenant_id, viaje_id, concepto, monto, xml_verificado)
    values (t1, v1, 'caseta', 100.00, true) returning id into g2;
  insert into _w values (t1, t2, g1, g2);
end $$;

-- (a) merge: lo escrito por otros sobrevive.
do $$
declare w _w; n int; x jsonb;
begin
  select * into w from _w;
  n := public.gasto_mezclar_ocr_extra(w.t1, w.g1, '{"montoDisputado": {"por": "op"}}'::jsonb);
  perform pg_temp.ok(n = 1, 'a1: debía tocar 1 fila');
  select ocr_extra into x from gasto where id = w.g1;
  perform pg_temp.ok((x->>'litros')::int = 40 and x->'validacionSat'->>'estado' = 'vigente', 'a2: lo previo sobrevive');
  perform pg_temp.ok(x->'montoDisputado'->>'por' = 'op', 'a3: el parche entra');
end $$;

-- (b)+(c) historial append y monto.
do $$
declare w _w; n int; x jsonb; m numeric;
begin
  select * into w from _w;
  n := public.gasto_mezclar_ocr_extra(w.t1, w.g1, '{}'::jsonb, 'montoCorregido', '{"antes": 800, "despues": 8000}'::jsonb, 8000, true);
  perform pg_temp.ok(n = 1, 'b1: 1 fila');
  n := public.gasto_mezclar_ocr_extra(w.t1, w.g1, '{}'::jsonb, 'montoCorregido', '{"antes": 8000, "despues": 8500}'::jsonb, 8500, true);
  select ocr_extra, monto into x, m from gasto where id = w.g1;
  perform pg_temp.ok(jsonb_array_length(x->'montoCorregido') = 2, 'b2: dos entradas, ninguna pisada');
  perform pg_temp.ok((x->'montoCorregido'->0->>'despues')::int = 8000 and (x->'montoCorregido'->1->>'despues')::int = 8500, 'b3: orden conservado');
  perform pg_temp.ok(m = 8500.00, 'c1: monto cambiado');
  perform pg_temp.ok((x->>'litros')::int = 40, 'b4: lo previo sigue ahí');

  -- valor suelto previo (no arreglo) → primer elemento
  update gasto set ocr_extra = '{"montoCorregido": {"antes": 1, "despues": 2}}' where id = w.g1;
  perform public.gasto_mezclar_ocr_extra(w.t1, w.g1, '{}'::jsonb, 'montoCorregido', '{"antes": 2, "despues": 3}'::jsonb);
  select ocr_extra into x from gasto where id = w.g1;
  perform pg_temp.ok(jsonb_array_length(x->'montoCorregido') = 2 and (x->'montoCorregido'->0->>'despues')::int = 2, 'b5: valor suelto previo se conserva como primer elemento');

  -- ocr_extra null
  update gasto set ocr_extra = null where id = w.g1;
  perform public.gasto_mezclar_ocr_extra(w.t1, w.g1, '{"x": 1}'::jsonb);
  select ocr_extra into x from gasto where id = w.g1;
  perform pg_temp.ok((x->>'x')::int = 1, 'b6: parte de ocr_extra null');
end $$;

-- (c2) p_sin_xml_verificado respeta al XML: gasto verificado no se toca.
do $$
declare w _w; n int; m numeric;
begin
  select * into w from _w;
  n := public.gasto_mezclar_ocr_extra(w.t1, w.g2, '{}'::jsonb, null, null, 999, true);
  select monto into m from gasto where id = w.g2;
  perform pg_temp.ok(n = 0 and m = 100.00, 'c2: gasto con XML verificado no se corrige a mano');
end $$;

-- (d) 0 filas: inexistente o de otra flota.
do $$
declare w _w; n int;
begin
  select * into w from _w;
  n := public.gasto_mezclar_ocr_extra(w.t2, w.g1, '{"x": 2}'::jsonb);
  perform pg_temp.ok(n = 0, 'd1: otra flota no toca el gasto');
  n := public.gasto_mezclar_ocr_extra(w.t1, gen_random_uuid(), '{"x": 2}'::jsonb);
  perform pg_temp.ok(n = 0, 'd2: gasto inexistente → 0');
end $$;

-- (e) argumentos incoherentes.
do $$
declare w _w; ok1 boolean := false; ok2 boolean := false;
begin
  select * into w from _w;
  begin perform public.gasto_mezclar_ocr_extra(w.t1, w.g1, '[1]'::jsonb); exception when others then ok1 := true; end;
  begin perform public.gasto_mezclar_ocr_extra(w.t1, w.g1, '{}'::jsonb, 'k', null); exception when others then ok2 := true; end;
  perform pg_temp.ok(ok1, 'e1: parche no objeto se rechaza');
  perform pg_temp.ok(ok2, 'e2: clave sin entrada se rechaza');
end $$;

-- (f) privilegios.
do $$
declare f text := 'public.gasto_mezclar_ocr_extra(uuid,uuid,jsonb,text,jsonb,numeric,boolean)';
begin
  perform pg_temp.ok(not has_function_privilege('anon', f, 'execute'), 'f1: anon no ejecuta');
  perform pg_temp.ok(not has_function_privilege('authenticated', f, 'execute'), 'f2: authenticated no ejecuta');
  perform pg_temp.ok(has_function_privilege('service_role', f, 'execute'), 'f3: service_role ejecuta');
end $$;

-- (g) número económico único sin mayúsculas, por flota.
do $$
declare w _w; dup boolean := false; otra boolean := true;
begin
  select * into w from _w;
  perform pg_temp.ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_unidad_economico_ci'), 'g0: el índice existe');
  insert into unidad (tenant_id, numero_economico, placas) values (w.t1, 't-042', 'ZZ-0876-1');
  begin
    insert into unidad (tenant_id, numero_economico, placas) values (w.t1, 'T-042', 'ZZ-0876-2');
  exception when unique_violation then dup := true; end;
  perform pg_temp.ok(dup, 'g1: «T-042» choca con «t-042» en la misma flota');
  begin
    insert into unidad (tenant_id, numero_economico, placas) values (w.t2, 'T-042', 'ZZ-0876-3');
  exception when unique_violation then otra := false; end;
  perform pg_temp.ok(otra, 'g2: otra flota puede usar el mismo número económico');
end $$;

-- (h) reaplicar la migración es inofensivo (idempotente).
\i supabase/migrations/0876_gasto_ocr_extra_mezcla_atomica_y_economico_unico.sql

-- (i) la reversa de la cabecera.
drop function if exists public.gasto_mezclar_ocr_extra(uuid, uuid, jsonb, text, jsonb, numeric, boolean);
drop index if exists public.uq_unidad_economico_ci;
do $$ begin
  perform pg_temp.ok(not exists (select 1 from pg_proc where proname = 'gasto_mezclar_ocr_extra'), 'h1: función retirada');
  perform pg_temp.ok(not exists (select 1 from pg_indexes where indexname = 'uq_unidad_economico_ci'), 'h2: índice retirado');
end $$;

rollback;
select '0876 OK' as resultado;
