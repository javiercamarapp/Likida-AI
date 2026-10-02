\set ON_ERROR_STOP on
-- 0561 + 0562 — acuse confirmado de la liquidación externa y retención de los
-- Agentes 1 y 2. Contra Postgres real, con datos sintéticos.
--
--   (a) 0561: acuse_confirmado_en exige acuse_en (CHECK), el índice parcial de
--       «acuses por leer» existe y la bitácora admite los dos eventos nuevos Y
--       los ocho de la 0370 (el CHECK se reescribe entero);
--   (b) purgar_liquidacion_externa: respeta el piso de 24 meses, solo toca estados
--       terminales (pendiente/en_cola NUNCA), borra la bitácora por cascada,
--       encola el PDF en storage_huerfano_candidato, no toca a lo reciente ni a
--       otra flota que no cumple, es idempotente y rechaza parámetros inseguros;
--   (c) purgar_peaje_archivos_fallidos: solo `fallida` con más de p_dias, vacía el
--       contenido y deja la fila de constancia; un pendiente viejo no se toca;
--   (d) permisos: solo service_role ejecuta las dos funciones.
begin;

insert into public.tenant (id, nombre) values
  ('56200000-0000-4000-8000-0000000000a1', 'Flota A 0562'),
  ('56200000-0000-4000-8000-0000000000b1', 'Flota B 0562');
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('56200000-0000-4000-8000-0000000000a2', '56200000-0000-4000-8000-0000000000a1', 'Chofer A', '525500000011'),
  ('56200000-0000-4000-8000-0000000000b2', '56200000-0000-4000-8000-0000000000b1', 'Chofer B', '525500000012');

set local role service_role;

-- 5 liquidaciones: vieja acusada (con PDF), vieja fallida, vieja PENDIENTE, reciente acusada, y una vieja de otra flota.
insert into public.liquidacion_externa
  (id, tenant_id, clave_externa, huella, operador_id, periodo_desde, periodo_hasta, conceptos, total, moneda, pdf_origen, pdf_ruta, estado, acuse_tipo, acuse_en, created_at)
values
  ('56200000-0000-4000-8000-0000000000d1', '56200000-0000-4000-8000-0000000000a1', 'V1', repeat('a',64), '56200000-0000-4000-8000-0000000000a2', '2020-01-01','2020-01-07',
    '[{"descripcion":"x","tipo":"percepcion","monto":1}]'::jsonb, 1, 'MXN', 'generado', 'a1/vieja1.pdf', 'acusada', 'recibida', now() - interval '70 months', now() - interval '70 months'),
  ('56200000-0000-4000-8000-0000000000d2', '56200000-0000-4000-8000-0000000000a1', 'V2', repeat('b',64), '56200000-0000-4000-8000-0000000000a2', '2020-01-01','2020-01-07',
    '[{"descripcion":"x","tipo":"percepcion","monto":1}]'::jsonb, 1, 'MXN', 'generado', null, 'fallida', null, null, now() - interval '66 months'),
  ('56200000-0000-4000-8000-0000000000d3', '56200000-0000-4000-8000-0000000000a1', 'V3', repeat('c',64), '56200000-0000-4000-8000-0000000000a2', '2020-01-01','2020-01-07',
    '[{"descripcion":"x","tipo":"percepcion","monto":1}]'::jsonb, 1, 'MXN', 'generado', 'a1/pendiente.pdf', 'pendiente', null, null, now() - interval '80 months'),
  ('56200000-0000-4000-8000-0000000000d4', '56200000-0000-4000-8000-0000000000a1', 'R1', repeat('d',64), '56200000-0000-4000-8000-0000000000a2', '2026-09-01','2026-09-07',
    '[{"descripcion":"x","tipo":"percepcion","monto":1}]'::jsonb, 1, 'MXN', 'generado', 'a1/reciente.pdf', 'acusada', 'recibida', now(), now() - interval '2 months'),
  ('56200000-0000-4000-8000-0000000000d5', '56200000-0000-4000-8000-0000000000b1', 'V1', repeat('e',64), '56200000-0000-4000-8000-0000000000b2', '2020-01-01','2020-01-07',
    '[{"descripcion":"x","tipo":"percepcion","monto":1}]'::jsonb, 1, 'MXN', 'generado', 'b1/vieja.pdf', 'enviada', null, null, now() - interval '59 months');
insert into public.liquidacion_externa_evento (liquidacion_externa_id, tenant_id, tipo) values
  ('56200000-0000-4000-8000-0000000000d1', '56200000-0000-4000-8000-0000000000a1', 'recibida'),
  ('56200000-0000-4000-8000-0000000000d1', '56200000-0000-4000-8000-0000000000a1', 'acuse_confirmado'),
  ('56200000-0000-4000-8000-0000000000d1', '56200000-0000-4000-8000-0000000000a1', 'aviso_oficina');

do $$
declare r jsonb; v_falla boolean; n int;
begin
  -- (a) acuse_confirmado_en sin acuse_en no entra.
  v_falla := false;
  begin
    update public.liquidacion_externa set acuse_confirmado_en = now() where id = '56200000-0000-4000-8000-0000000000d2';
  exception when check_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO a1: se confirmó un acuse que no existe'; end if;
  update public.liquidacion_externa set acuse_confirmado_en = now() where id = '56200000-0000-4000-8000-0000000000d1';
  if not exists (select 1 from pg_indexes where indexname = 'liquidacion_externa_acuses_pendientes_idx') then
    raise exception 'FALLO a2: falta el índice de acuses pendientes';
  end if;
  -- los ocho eventos de la 0370 siguen admitidos
  insert into public.liquidacion_externa_evento (liquidacion_externa_id, tenant_id, tipo)
  select '56200000-0000-4000-8000-0000000000d4', '56200000-0000-4000-8000-0000000000a1', t
    from unnest(array['recibida','encolada','enviada','fallback_plantilla','fallida','reintento_manual','acuse_recibida','acuse_no_coincide']) t;
  v_falla := false;
  begin
    insert into public.liquidacion_externa_evento (liquidacion_externa_id, tenant_id, tipo)
    values ('56200000-0000-4000-8000-0000000000d4', '56200000-0000-4000-8000-0000000000a1', 'inventado');
  exception when check_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO a3: un evento inventado entró'; end if;

  -- (b) parámetros inseguros.
  foreach n in array array[0, 12, 23] loop
    v_falla := false;
    begin perform public.purgar_liquidacion_externa(n, 100); exception when sqlstate 'PU001' then v_falla := true; end;
    if not v_falla then raise exception 'FALLO b1: p_meses=% se aceptó (piso 24)', n; end if;
  end loop;
  v_falla := false;
  begin perform public.purgar_liquidacion_externa(60, 0); exception when sqlstate 'PU001' then v_falla := true; end;
  if not v_falla then raise exception 'FALLO b2: p_limite=0 se aceptó'; end if;

  -- (b) la purga real: 60 meses → caen d1 (70 m, acusada) y d2 (66 m, fallida); NO d3 (pendiente, 80 m),
  -- NO d4 (reciente), NO d5 (59 m, otra flota, aún no vence).
  r := public.purgar_liquidacion_externa(60, 100);
  if (r->>'borradas')::int <> 2 then raise exception 'FALLO b3: borró % (esperaba 2): %', r->>'borradas', r; end if;
  if (r->>'pdfsEncolados')::int <> 1 then raise exception 'FALLO b4: encoló % pdfs (esperaba 1)', r->>'pdfsEncolados'; end if;
  if exists (select 1 from public.liquidacion_externa where id in ('56200000-0000-4000-8000-0000000000d1','56200000-0000-4000-8000-0000000000d2')) then
    raise exception 'FALLO b5: quedaron filas vencidas';
  end if;
  if (select count(*) from public.liquidacion_externa where id in ('56200000-0000-4000-8000-0000000000d3','56200000-0000-4000-8000-0000000000d4','56200000-0000-4000-8000-0000000000d5')) <> 3 then
    raise exception 'FALLO b6: se purgó una pendiente, una reciente o una que aún no vence';
  end if;
  if exists (select 1 from public.liquidacion_externa_evento where liquidacion_externa_id = '56200000-0000-4000-8000-0000000000d1') then
    raise exception 'FALLO b7: la bitácora no cayó por cascada';
  end if;
  if not exists (select 1 from public.storage_huerfano_candidato where bucket = 'liquidaciones' and nombre = 'a1/vieja1.pdf' and clase_retencion = 'operativa') then
    raise exception 'FALLO b8: el PDF no quedó encolado para borrado';
  end if;
  -- idempotente
  r := public.purgar_liquidacion_externa(60, 100);
  if (r->>'borradas')::int <> 0 then raise exception 'FALLO b9: la segunda corrida borró más'; end if;
  -- con 58 meses de vigencia... (piso 24, p_ahora futuro): la de 59 meses de la flota B ya vence con 'ahora' dentro de 2 meses
  r := public.purgar_liquidacion_externa(60, 100, now() + interval '2 months');
  if (r->>'borradas')::int <> 1 then raise exception 'FALLO b10: la de 59 meses no venció con p_ahora adelantado: %', r; end if;
  -- la pendiente de 80 meses SIGUE ahí: nunca se purga lo no terminal.
  if not exists (select 1 from public.liquidacion_externa where id = '56200000-0000-4000-8000-0000000000d3') then
    raise exception 'FALLO b11: se purgó una liquidación pendiente';
  end if;

  -- (c) archivos de peajes fallidos.
  insert into public.peaje_ingesta_archivo (id, tenant_id, huella, nombre, bytes, contenido, estado, recibida_en) values
    ('56200000-0000-4000-8000-0000000000e1', '56200000-0000-4000-8000-0000000000a1', repeat('1',64), 'viejo-fallido.csv', 10, '\x61'::bytea, 'fallida', now() - interval '40 days'),
    ('56200000-0000-4000-8000-0000000000e2', '56200000-0000-4000-8000-0000000000a1', repeat('2',64), 'reciente-fallido.csv', 10, '\x61'::bytea, 'fallida', now() - interval '5 days'),
    ('56200000-0000-4000-8000-0000000000e3', '56200000-0000-4000-8000-0000000000a1', repeat('3',64), 'viejo-pendiente.csv', 10, '\x61'::bytea, 'pendiente', now() - interval '90 days');
  v_falla := false;
  begin perform public.purgar_peaje_archivos_fallidos(3, 10); exception when sqlstate 'PU001' then v_falla := true; end;
  if not v_falla then raise exception 'FALLO c1: p_dias=3 se aceptó (piso 7)'; end if;
  r := public.purgar_peaje_archivos_fallidos(30, 10);
  if (r->>'vaciados')::int <> 1 then raise exception 'FALLO c2: vació % (esperaba 1)', r->>'vaciados'; end if;
  if (select contenido from public.peaje_ingesta_archivo where id = '56200000-0000-4000-8000-0000000000e1') is not null then
    raise exception 'FALLO c3: el contenido del fallido viejo sigue';
  end if;
  if not exists (select 1 from public.peaje_ingesta_archivo where id = '56200000-0000-4000-8000-0000000000e1' and estado = 'fallida') then
    raise exception 'FALLO c4: la fila de constancia desapareció';
  end if;
  if (select count(*) from public.peaje_ingesta_archivo where id in ('56200000-0000-4000-8000-0000000000e2','56200000-0000-4000-8000-0000000000e3') and contenido is not null) <> 2 then
    raise exception 'FALLO c5: se vació un fallido reciente o un pendiente';
  end if;
  r := public.purgar_peaje_archivos_fallidos(30, 10);
  if (r->>'vaciados')::int <> 0 then raise exception 'FALLO c6: no es idempotente'; end if;
end $$;

-- (d) permisos
reset role;
do $$
begin
  if has_function_privilege('anon', 'public.purgar_liquidacion_externa(integer,integer,timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.purgar_liquidacion_externa(integer,integer,timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.purgar_peaje_archivos_fallidos(integer,integer,timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.purgar_peaje_archivos_fallidos(integer,integer,timestamptz)', 'execute') then
    raise exception 'FALLO d: anon/authenticated ejecutan una purga';
  end if;
end $$;

rollback;
