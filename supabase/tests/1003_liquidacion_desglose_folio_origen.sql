\set ON_ERROR_STOP on
-- 1003 — folio de origen del desglose, contra Postgres REAL, en una transacción revertida: la columna nace NULL, el CHECK acepta 1 a 40
-- caracteres y rechaza vacío o 41; `recibir_desglose_atomico` (redefinida desde la 0940) guarda el folio, lo recorta/anula si viene vacío,
-- conserva TODO lo anterior (entregas `omitida`, retenida, reintento idempotente, misma clave con otra huella = P0001), el folio NO entra
-- en ningún índice único (dos bitácoras distintas pueden traer el mismo folio) y los permisos de la función no cambian. Datos sintéticos.
begin;

insert into public.tenant (id, nombre) values ('10030000-0000-4000-8000-0000000000a1', 'Flota 1003');
insert into public.operador (id, tenant_id, nombre, telefono)
values ('10030000-0000-4000-8000-0000000000a2', '10030000-0000-4000-8000-0000000000a1', 'Chofer 1003', '525500010031');

-- ── 1. La columna y su CHECK ────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'liquidacion_desglose' and column_name = 'folio_origen' and data_type = 'text') then
    raise exception '1003: falta la columna liquidacion_desglose.folio_origen (text)';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'liquidacion_desglose_folio_origen_largo') then
    raise exception '1003: falta el CHECK del largo del folio';
  end if;
end $$;

-- ── 2. recibir_desglose_atomico guarda el folio y conserva el resto ─────────
do $$
declare
  t uuid := '10030000-0000-4000-8000-0000000000a1';
  op uuid := '10030000-0000-4000-8000-0000000000a2';
  liq jsonb; des jsonb; ent jsonb; r jsonb; v text; n int;
begin
  liq := jsonb_build_object('clave_externa','BIT-F1','huella',repeat('a',64),'sistema_origen','tms-muestra-tms','operador_id',op,
    'folios_viaje','[]'::jsonb,'viaje_ids','[]'::jsonb,'periodo_desde','2026-10-01','periodo_hasta','2026-10-07',
    'conceptos','[{"descripcion":"x","tipo":"percepcion","monto":100}]'::jsonb,'total',100,'moneda','MXN','pdf_origen','generado');
  des := jsonb_build_object('bitacora','F1','folio_origen','1098','total_origen','calculado','poliza','P-1');
  ent := '[{"rol":"operador","correo":"op@ejemplo.test","xlsx_ruta":"x/a.xlsx","estado":"omitida","ultimo_error":"omitida: corte"}]'::jsonb;

  r := public.recibir_desglose_atomico(t, liq, des, '{}'::jsonb, ent);
  if (r->>'creada')::boolean is not true or (r->>'entregas')::int <> 1 then raise exception '1003: la recepción cambió de comportamiento: %', r; end if;
  select d.folio_origen into v from public.liquidacion_desglose d join public.liquidacion_externa l on l.id = d.liquidacion_externa_id where l.clave_externa = 'BIT-F1';
  if v is distinct from '1098' then raise exception '1003: no guardó el folio (guardó %)', v; end if;
  select count(*) into n from public.liquidacion_entrega_correo e join public.liquidacion_externa l on l.id = e.liquidacion_externa_id
   where l.clave_externa = 'BIT-F1' and e.estado = 'omitida';
  if n <> 1 then raise exception '1003: perdió el estado omitida de la entrega'; end if;

  -- reintento idempotente: no duplica ni cambia el folio
  r := public.recibir_desglose_atomico(t, liq, jsonb_set(des, '{folio_origen}', '"9999"'), '{}'::jsonb, ent);
  if (r->>'creada')::boolean is not false then raise exception '1003: el reintento no fue idempotente'; end if;
  select d.folio_origen into v from public.liquidacion_desglose d join public.liquidacion_externa l on l.id = d.liquidacion_externa_id where l.clave_externa = 'BIT-F1';
  if v <> '1098' then raise exception '1003: el reintento cambió el folio (%)', v; end if;

  -- sin folio, o vacío: NULL (se muestra la bitácora)
  liq := liq || jsonb_build_object('clave_externa','BIT-F2','huella',repeat('b',64));
  perform public.recibir_desglose_atomico(t, liq, jsonb_build_object('bitacora','F2','total_origen','calculado'), '{}'::jsonb, '[]'::jsonb);
  liq := liq || jsonb_build_object('clave_externa','BIT-F3','huella',repeat('c',64));
  perform public.recibir_desglose_atomico(t, liq, jsonb_build_object('bitacora','F3','folio_origen','   ','total_origen','calculado'), '{}'::jsonb, '[]'::jsonb);
  select count(*) into n from public.liquidacion_desglose d join public.liquidacion_externa l on l.id = d.liquidacion_externa_id
   where l.clave_externa in ('BIT-F2','BIT-F3') and d.folio_origen is null;
  if n <> 2 then raise exception '1003: sin folio (o vacío) debía quedar NULL'; end if;

  -- el MISMO folio en dos bitácoras distintas: permitido (no hay índice único sobre el folio)
  liq := liq || jsonb_build_object('clave_externa','BIT-F4','huella',repeat('d',64));
  perform public.recibir_desglose_atomico(t, liq, jsonb_build_object('bitacora','F4','folio_origen','1098','total_origen','calculado'), '{}'::jsonb, '[]'::jsonb);
  select count(*) into n from public.liquidacion_desglose d where d.tenant_id = t and d.folio_origen = '1098';
  if n <> 2 then raise exception '1003: dos bitácoras con el mismo folio debían coexistir (hay %)', n; end if;

  -- un folio de más de 40 se recorta a 40 (la RPC no lo rechaza; el código ya valida antes)
  liq := liq || jsonb_build_object('clave_externa','BIT-F5','huella',repeat('e',64));
  perform public.recibir_desglose_atomico(t, liq, jsonb_build_object('bitacora','F5','folio_origen',repeat('9',60),'total_origen','calculado'), '{}'::jsonb, '[]'::jsonb);
  select length(d.folio_origen) into n from public.liquidacion_desglose d join public.liquidacion_externa l on l.id = d.liquidacion_externa_id where l.clave_externa = 'BIT-F5';
  if n <> 40 then raise exception '1003: el folio largo debía recortarse a 40 (quedó en %)', n; end if;

  -- misma clave con otra huella: P0001, como siempre
  begin
    perform public.recibir_desglose_atomico(t, liq || jsonb_build_object('huella', repeat('f',64)), des, '{}'::jsonb, '[]'::jsonb);
    raise exception 'FALLO: aceptó la misma clave con otra huella';
  exception when sqlstate 'P0001' then null; end;
end $$;

-- ── 3. El CHECK rechaza vacío y más de 40 al escribir directo ───────────────
do $$
declare t uuid := '10030000-0000-4000-8000-0000000000a1'; id uuid;
begin
  select d.liquidacion_externa_id into id from public.liquidacion_desglose d where d.tenant_id = t limit 1;
  begin update public.liquidacion_desglose set folio_origen = '' where liquidacion_externa_id = id; raise exception 'FALLO: aceptó un folio vacío';
  exception when check_violation then null; end;
  begin update public.liquidacion_desglose set folio_origen = repeat('x', 41) where liquidacion_externa_id = id; raise exception 'FALLO: aceptó un folio de 41';
  exception when check_violation then null; end;
end $$;

-- ── 4. Permisos de la función (intactos) ────────────────────────────────────
do $$
declare p record; f text := 'public.recibir_desglose_atomico(uuid, jsonb, jsonb, jsonb, jsonb)';
begin
  select prosecdef, proconfig into p from pg_proc where oid = f::regprocedure;
  if not p.prosecdef then raise exception '1003: dejó de ser SECURITY DEFINER'; end if;
  if p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%') then raise exception '1003: perdió el search_path fijo'; end if;
  if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then raise exception '1003: anon/authenticated ejecutan la función'; end if;
  if not has_function_privilege('service_role', f, 'execute') then raise exception '1003: service_role perdió el execute'; end if;
end $$;

rollback;
