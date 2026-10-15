\set ON_ERROR_STOP on
-- 0788 — Retención de la entrega por correo. Contra Postgres real, datos sintéticos.
--   (a) parámetros inseguros: p_meses < 12 (piso), p_limite fuera de 1..5000;
--   (b) solo estados terminales y solo lo que ya venció; pendiente/enviando NUNCA;
--   (c) encola xlsx_ruta una sola vez (bucket liquidaciones) y la pone en NULL;
--   (d) el correo queda en 'purgado'; dos destinatarios del mismo rol y generación
--       purgados a la vez NO chocan en la unicidad, y la regla sigue vigente para
--       correos reales; un correo con forma inválida sigue sin entrar;
--   (e) idempotente; respeta p_limite (parcial); otra flota que no vence no se toca;
--   (f) la retención de liquidacion_externa no se acorta (la fila madre sigue);
--   (g) solo service_role ejecuta la función.
begin;

insert into public.tenant (id, nombre) values
  ('78800000-0000-4000-8000-0000000000a1', 'Flota A 0788'),
  ('78800000-0000-4000-8000-0000000000b1', 'Flota B 0788');
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('78800000-0000-4000-8000-0000000000a2', '78800000-0000-4000-8000-0000000000a1', 'Operador Uno', '5215500000001'),
  ('78800000-0000-4000-8000-0000000000b2', '78800000-0000-4000-8000-0000000000b1', 'Operador Dos', '5215500000002');

set local role service_role;

insert into public.liquidacion_externa
  (id, tenant_id, clave_externa, huella, operador_id, periodo_desde, periodo_hasta, conceptos, total, moneda, pdf_origen, estado, acuse_tipo, acuse_en, created_at)
values
  ('78800000-0000-4000-8000-0000000000d1', '78800000-0000-4000-8000-0000000000a1', 'L1', repeat('a',64), '78800000-0000-4000-8000-0000000000a2', '2025-01-01','2025-01-07',
    '[{"descripcion":"x","tipo":"percepcion","monto":1}]'::jsonb, 1, 'MXN', 'generado', 'acusada', 'recibida', now() - interval '20 months', now() - interval '20 months'),
  ('78800000-0000-4000-8000-0000000000d3', '78800000-0000-4000-8000-0000000000b1', 'L1', repeat('c',64), '78800000-0000-4000-8000-0000000000b2', '2025-01-01','2025-01-07',
    '[{"descripcion":"x","tipo":"percepcion","monto":1}]'::jsonb, 1, 'MXN', 'generado', 'acusada', 'recibida', now() - interval '20 months', now() - interval '20 months');

do $$
declare
  v_falla boolean; n int; r jsonb;
  A  constant uuid := '78800000-0000-4000-8000-0000000000a1';
  B  constant uuid := '78800000-0000-4000-8000-0000000000b1';
  L1 constant uuid := '78800000-0000-4000-8000-0000000000d1';
  L3 constant uuid := '78800000-0000-4000-8000-0000000000d3';
begin
  -- Entregas de la liquidación L1 (flota A): 14 meses de antigüedad, salvo indicación.
  insert into public.liquidacion_entrega_correo (id, tenant_id, liquidacion_externa_id, rol, correo, estado, xlsx_ruta, created_at) values
    ('78800000-0000-4000-8000-0000000000e1', A, L1, 'operador',    'uno@ejemplo.test',  'entregada', 'a/uno.xlsx',  now() - interval '14 months'),
    ('78800000-0000-4000-8000-0000000000e2', A, L1, 'coordinador', 'dos@ejemplo.test',  'rebotada',  'a/dos.xlsx',  now() - interval '14 months'),
    ('78800000-0000-4000-8000-0000000000e3', A, L1, 'rh',          'tres@ejemplo.test', 'enviada',   null,          now() - interval '14 months'),
    ('78800000-0000-4000-8000-0000000000e4', A, L1, 'rh',          'cuatro@ejemplo.test', 'omitida', null,          now() - interval '14 months'),
    ('78800000-0000-4000-8000-0000000000e5', A, L1, 'archivo',     'cinco@ejemplo.test', 'pendiente', 'a/cinco.xlsx', now() - interval '30 months'),
    ('78800000-0000-4000-8000-0000000000e6', A, L1, 'archivo',     'seis@ejemplo.test',  'enviando',  'a/seis.xlsx',  now() - interval '30 months'),
    ('78800000-0000-4000-8000-0000000000e7', A, L1, 'operador',    'siete@ejemplo.test', 'entregada', 'a/siete.xlsx', now() - interval '3 months'),
    ('78800000-0000-4000-8000-0000000000e8', B, L3, 'operador',    'ocho@ejemplo.test',  'entregada', 'b/ocho.xlsx',  now() - interval '11 months');
  -- e5 y e6 (vivas) necesitan lease coherente: e6 sin token es válido (ambos nulos).

  -- (a) parámetros inseguros
  foreach n in array array[0, 11] loop
    v_falla := false;
    begin perform public.purgar_liquidacion_entrega_correo(n, 100); exception when sqlstate 'PU001' then v_falla := true; end;
    if not v_falla then raise exception 'FALLO a1: p_meses=% se aceptó (piso 12)', n; end if;
  end loop;
  foreach n in array array[0, 5001] loop
    v_falla := false;
    begin perform public.purgar_liquidacion_entrega_correo(13, n); exception when sqlstate 'PU001' then v_falla := true; end;
    if not v_falla then raise exception 'FALLO a2: p_limite=% se aceptó', n; end if;
  end loop;

  -- (b)(c)(d) la purga real con 13 meses: caen e1..e4 (14 meses, terminales).
  r := public.purgar_liquidacion_entrega_correo(13, 100);
  if (r->>'purgadas')::int <> 4 then raise exception 'FALLO b1: purgó % (esperaba 4): %', r->>'purgadas', r; end if;
  if (r->>'archivosEncolados')::int <> 2 then raise exception 'FALLO c1: encoló % (esperaba 2)', r->>'archivosEncolados'; end if;
  if (select count(*) from public.liquidacion_entrega_correo where id in
        ('78800000-0000-4000-8000-0000000000e1','78800000-0000-4000-8000-0000000000e2','78800000-0000-4000-8000-0000000000e3','78800000-0000-4000-8000-0000000000e4')
        and correo = 'purgado' and xlsx_ruta is null) <> 4 then
    raise exception 'FALLO d1: las cuatro vencidas no quedaron en purgado sin archivo';
  end if;
  if not exists (select 1 from public.storage_huerfano_candidato where bucket = 'liquidaciones' and nombre = 'a/uno.xlsx' and motivo = 'retencion_entrega_correo')
     or not exists (select 1 from public.storage_huerfano_candidato where bucket = 'liquidaciones' and nombre = 'a/dos.xlsx' and motivo = 'retencion_entrega_correo') then
    raise exception 'FALLO c2: los archivos no quedaron encolados para borrado';
  end if;
  -- la fila de constancia conserva estado y fecha
  if not exists (select 1 from public.liquidacion_entrega_correo where id = '78800000-0000-4000-8000-0000000000e2' and estado = 'rebotada') then
    raise exception 'FALLO d2: la constancia perdió su estado';
  end if;
  -- pendiente / enviando de 30 meses, la reciente y la de otra flota (11 meses) NO se tocan
  if (select count(*) from public.liquidacion_entrega_correo where id in
        ('78800000-0000-4000-8000-0000000000e5','78800000-0000-4000-8000-0000000000e6','78800000-0000-4000-8000-0000000000e7','78800000-0000-4000-8000-0000000000e8')
        and correo <> 'purgado' and (xlsx_ruta is not null)) <> 4 then
    raise exception 'FALLO b2: se purgó una viva, una reciente o una que aún no vence';
  end if;

  -- (d) unicidad: tres 'purgado' del mismo rol/generación conviven (e3 y e4 son 'rh'); correo real sigue único
  insert into public.liquidacion_entrega_correo (tenant_id, liquidacion_externa_id, rol, correo, estado)
    values (A, L1, 'operador', 'nuevo@ejemplo.test', 'pendiente');
  v_falla := false;
  begin
    insert into public.liquidacion_entrega_correo (tenant_id, liquidacion_externa_id, rol, correo, estado)
      values (A, L1, 'operador', 'NUEVO@ejemplo.test', 'pendiente');
  exception when unique_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO d3: la unicidad por correo real se perdió'; end if;
  v_falla := false;
  begin
    insert into public.liquidacion_entrega_correo (tenant_id, liquidacion_externa_id, rol, correo)
      values (A, L1, 'operador', 'sin-arroba');
  exception when check_violation then v_falla := true; end;
  if not v_falla then raise exception 'FALLO d4: un correo inválido entró'; end if;

  -- (e) idempotente: la segunda corrida no purga ni encola de nuevo
  r := public.purgar_liquidacion_entrega_correo(13, 100);
  if (r->>'purgadas')::int <> 0 or (r->>'archivosEncolados')::int <> 0 then raise exception 'FALLO e1: no es idempotente: %', r; end if;
  -- con p_ahora adelantado 3 meses la de la otra flota (11 m) ya vence; las vivas siguen intactas
  r := public.purgar_liquidacion_entrega_correo(13, 100, now() + interval '3 months');
  if (r->>'purgadas')::int <> 1 or not exists (select 1 from public.liquidacion_entrega_correo where id = '78800000-0000-4000-8000-0000000000e8' and correo = 'purgado') then
    raise exception 'FALLO e2: esperaba purgar solo la de la otra flota (11 m): %', r;
  end if;
  if (select count(*) from public.liquidacion_entrega_correo where id in
        ('78800000-0000-4000-8000-0000000000e5','78800000-0000-4000-8000-0000000000e6') and correo <> 'purgado') <> 2 then
    raise exception 'FALLO e3: una entrega pendiente/enviando se purgó';
  end if;
  -- parcial con tope
  update public.liquidacion_entrega_correo set estado = 'fallida', created_at = now() - interval '40 months'
   where id in ('78800000-0000-4000-8000-0000000000e5','78800000-0000-4000-8000-0000000000e6');
  r := public.purgar_liquidacion_entrega_correo(13, 1);
  if (r->>'purgadas')::int <> 1 or (r->>'parcial')::boolean is not true then raise exception 'FALLO e4: el tope no marcó parcial: %', r; end if;

  -- (f) la liquidación madre sigue: esta purga no toca liquidacion_externa
  if (select count(*) from public.liquidacion_externa where id in (L1, L3)) <> 2 then
    raise exception 'FALLO f1: la purga de entregas tocó liquidacion_externa';
  end if;
end $$;

-- (g) permisos
do $$
begin
  if has_function_privilege('anon', 'public.purgar_liquidacion_entrega_correo(integer, integer, timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.purgar_liquidacion_entrega_correo(integer, integer, timestamptz)', 'execute') then
    raise exception 'FALLO g1: anon o authenticated ejecutan la purga';
  end if;
  if not has_function_privilege('service_role', 'public.purgar_liquidacion_entrega_correo(integer, integer, timestamptz)', 'execute') then
    raise exception 'FALLO g2: service_role no ejecuta la purga';
  end if;
end $$;

rollback;
