\set ON_ERROR_STOP on
-- 0923 — auditoría 37, lote M-Z-resto-14. Contra Postgres REAL, dentro de una transacción revertida.
--   (a) A37-S63-03  una llegada RECIBIDA sin fila de validación cuenta como degradada (y una validada con GPS real, no);
--   (b) A37-S63-02  equipo_desactivar_usuario con el rol desfasado devuelve 'conflicto' y NO deja la flota sin dueño;
--   (c) A37-S63-08  recibir_desglose_atomico rechaza viaje_ids de otra flota al crear, y un reintento con la misma
--                   huella no agrega entregas a destinatarios nuevos;
--   (d) A37-S63-04  authenticated ya no lee las columnas cifradas; service_role sí; insight_linea_base NO cambia (diseño 0805).
begin;

insert into public.tenant (id, nombre) values
  ('09230000-0000-4000-8000-0000000000a1', 'Flota A 0923'),
  ('09230000-0000-4000-8000-0000000000b1', 'Flota B 0923');
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('09230000-0000-4000-8000-0000000000a2', '09230000-0000-4000-8000-0000000000a1', 'Chofer A1 0923', '525500009231'),
  ('09230000-0000-4000-8000-0000000000a3', '09230000-0000-4000-8000-0000000000a1', 'Chofer A2 0923', '525500009232'),
  ('09230000-0000-4000-8000-0000000000b2', '09230000-0000-4000-8000-0000000000b1', 'Chofer B1 0923', '525500009233');
insert into public.viaje (id, tenant_id, operador_id, folio, estatus, avisado_en, aceptado_en) values
  ('09230000-0000-4000-8000-0000000000d1', '09230000-0000-4000-8000-0000000000a1', '09230000-0000-4000-8000-0000000000a2', 'A-0923-1', 'abierto', now() - interval '5 hours', now() - interval '5 hours'),
  ('09230000-0000-4000-8000-0000000000d2', '09230000-0000-4000-8000-0000000000a1', '09230000-0000-4000-8000-0000000000a3', 'A-0923-2', 'abierto', now() - interval '5 hours', now() - interval '5 hours'),
  ('09230000-0000-4000-8000-0000000000e1', '09230000-0000-4000-8000-0000000000b1', '09230000-0000-4000-8000-0000000000b2', 'B-0923-1', 'abierto', now() - interval '5 hours', now() - interval '5 hours');
select public.sembrar_hitos_conductor(10);
insert into public.app_user (id, tenant_id, email, rol, activo) values
  ('09230000-0000-4000-8000-0000000000c1', '09230000-0000-4000-8000-0000000000a1', 'duena-0923@test.invalid', 'flota_admin', true),
  ('09230000-0000-4000-8000-0000000000c3', '09230000-0000-4000-8000-0000000000a1', 'conta-0923@test.invalid', 'contador', true);

-- ── (a) A37-S63-03 ──────────────────────────────────────────────────────────
do $$
declare
  t uuid := '09230000-0000-4000-8000-0000000000a1';
  d1 uuid := '09230000-0000-4000-8000-0000000000d1';
  d2 uuid := '09230000-0000-4000-8000-0000000000d2';
  h1 uuid := (select id from public.viaje_hito where viaje_id = d1 and tipo = 'llegada_carga');
  h2 uuid := (select id from public.viaje_hito where viaje_id = d2 and tipo = 'llegada_carga');
  ind jsonb;
begin
  -- d1·llegada_carga: validada con GPS real, NO degradada.
  update public.viaje_hito set estado = 'validado', fuente = 'texto', interpretacion = 'regla', mensaje_en = now(), recibido_en = now(),
    validado_en = now(), validado_por = 'gps', updated_at = now() where id = h1;
  insert into public.viaje_hito_validacion (tenant_id, viaje_id, viaje_hito_id, ciclo, resultado, fuente, distancia_m, tolerancia_m, radio_m)
  values (t, d1, h1, 1, 'validado', 'gps', 20, 150, 300);
  -- d2·llegada_carga: capturada por la OFICINA, sin fila de validación: no se validó nada -> degradada.
  update public.viaje_hito set estado = 'recibido', fuente = 'oficina', interpretacion = 'regla', mensaje_en = now(), recibido_en = now(), updated_at = now()
   where id = h2;

  ind := public.conductor_indicadores(t, now() - interval '1 day', now() + interval '1 hour');
  if (ind->>'llegadas_validables')::int <> 2 then raise exception '0923(a): llegadas_validables esperaba 2: %', ind; end if;
  if (ind->>'validacion_degradada')::int <> 1 then
    raise exception '0923(a): validacion_degradada esperaba 1 (la llegada sin fila de validación), salió %: %', ind->>'validacion_degradada', ind;
  end if;
  if (ind->>'validados_ubicacion')::int <> 1 then raise exception '0923(a): validados_ubicacion (0385) cambió: %', ind; end if;
end $$;

set local role service_role;

-- ── (b) A37-S63-02 ──────────────────────────────────────────────────────────
do $$
declare v_motivo text;
begin
  -- El llamador leyó a c3 como 'contador'; antes de la RPC, c3 es ascendido a dueño y c1 degradado: c3 es el ÚNICO dueño.
  update public.app_user set rol = 'flota_admin' where id = '09230000-0000-4000-8000-0000000000c3';
  update public.app_user set rol = 'contador' where id = '09230000-0000-4000-8000-0000000000c1';
  v_motivo := public.equipo_desactivar_usuario(
    '09230000-0000-4000-8000-0000000000a1', '09230000-0000-4000-8000-0000000000c3', 'contador', '09230000-0000-4000-8000-0000000000c1');
  if v_motivo <> 'conflicto' then raise exception '0923(b): con el rol desfasado debía dar conflicto (motivo %)', v_motivo; end if;
  if (select count(*) from public.app_user where tenant_id = '09230000-0000-4000-8000-0000000000a1' and rol = 'flota_admin' and activo) <> 1 then
    raise exception '0923(b): la flota quedó sin dueño activo';
  end if;
  -- Con el rol correcto el último dueño sigue rebotando, y una baja normal sigue pasando.
  v_motivo := public.equipo_desactivar_usuario(
    '09230000-0000-4000-8000-0000000000a1', '09230000-0000-4000-8000-0000000000c3', 'flota_admin', '09230000-0000-4000-8000-0000000000c1');
  if v_motivo <> 'ultimo_dueno' then raise exception '0923(b): el último dueño debía rebotar (motivo %)', v_motivo; end if;
  v_motivo := public.equipo_desactivar_usuario(
    '09230000-0000-4000-8000-0000000000a1', '09230000-0000-4000-8000-0000000000c1', 'contador', '09230000-0000-4000-8000-0000000000c3');
  if v_motivo <> 'ok' then raise exception '0923(b): la baja normal de un contador debía pasar (motivo %)', v_motivo; end if;
end $$;

-- ── (c) A37-S63-08 ──────────────────────────────────────────────────────────
create function pg_temp.liq(p_clave text, p_huella text, p_op uuid, p_viajes jsonb) returns jsonb language sql as $$
  select jsonb_build_object(
    'clave_externa', p_clave, 'huella', p_huella, 'sistema_origen', 'desglose-bitacora', 'operador_id', p_op,
    'folios_viaje', jsonb_build_array('B-1'), 'viaje_ids', p_viajes,
    'periodo_desde', '2026-10-01', 'periodo_hasta', '2026-10-07',
    'conceptos', '[{"descripcion":"x","tipo":"percepcion","monto":10}]'::jsonb,
    'total', 10, 'moneda', 'MXN', 'pdf_ruta', null, 'pdf_origen', 'generado', 'pdf_sha256', null)
$$;
create function pg_temp.desg(p_bit text) returns jsonb language sql as $$
  select jsonb_build_object('bitacora', p_bit, 'terminal', 'T1', 'poliza', 'P-1', 'unidad', 'U-1',
    'tipo_operador', 'foraneo', 'dias', 6, 'total_origen', 'tms', 'retenida_motivo', null)
$$;
create function pg_temp.entr(p_correos text[]) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('rol', r, 'correo', c, 'xlsx_ruta', 'ruta/x.xlsx',
         'xlsx_sha256', repeat('a', 64), 'disparo', 'auto') order by ord), '[]'::jsonb)
  from unnest(array['operador','coordinador','rh','archivo'], p_correos) with ordinality as t(r, c, ord)
  where c is not null
$$;
grant execute on function pg_temp.liq(text, text, uuid, jsonb), pg_temp.desg(text), pg_temp.entr(text[]) to public;

do $$
declare
  A constant uuid := '09230000-0000-4000-8000-0000000000a1';
  OA constant uuid := '09230000-0000-4000-8000-0000000000a2';
  VA constant text := '09230000-0000-4000-8000-0000000000d1';
  VB constant text := '09230000-0000-4000-8000-0000000000e1';
  H1 constant text := repeat('1', 64);
  r jsonb; n int; id1 uuid; v_code text;
begin
  -- Un viaje de OTRA flota no se puede colgar de la liquidación al crearla (y no queda nada escrito).
  begin
    perform public.recibir_desglose_atomico(A, pg_temp.liq('K-AJENO', H1, OA, jsonb_build_array(VB)), pg_temp.desg('B-AJENO'), '{}', pg_temp.entr(array['a@ejemplo.test']));
    raise exception 'FALLO c1: aceptó un viaje de otra flota';
  exception when foreign_key_violation then null;
  end;
  select count(*) into n from public.liquidacion_externa where tenant_id = A and clave_externa = 'K-AJENO';
  if n <> 0 then raise exception 'FALLO c2: quedó escrita una liquidación con viajes ajenos'; end if;

  -- Con viajes propios, pasa y se guardan.
  r := public.recibir_desglose_atomico(A, pg_temp.liq('K1', H1, OA, jsonb_build_array(VA)), pg_temp.desg('B-1'), '{}',
         pg_temp.entr(array['op@ejemplo.test','co@ejemplo.test']));
  id1 := (r->>'liquidacion_id')::uuid;
  if (r->>'creada')::boolean is not true or (r->>'entregas')::int <> 2 then raise exception 'FALLO c3: %', r; end if;

  -- Reintento con la MISMA huella pero un destinatario nuevo: NO se agrega entrega.
  r := public.recibir_desglose_atomico(A, pg_temp.liq('K1', H1, OA, jsonb_build_array(VA)), pg_temp.desg('B-1'), '{}',
         pg_temp.entr(array['op@ejemplo.test','co@ejemplo.test','rh@ejemplo.test']));
  if (r->>'creada')::boolean or (r->>'entregas')::int <> 0 or (r->>'reparada')::boolean then raise exception 'FALLO c4: %', r; end if;
  select count(*) into n from public.liquidacion_entrega_correo where liquidacion_externa_id = id1;
  if n <> 2 then raise exception 'FALLO c5: el reintento agregó entregas (hay %, esperaba 2)', n; end if;

  -- Un reintento de una liquidación ya existente NO revalida viajes (pudieron borrarse): sigue siendo idempotente.
  delete from public.viaje where id = VA::uuid;
  r := public.recibir_desglose_atomico(A, pg_temp.liq('K1', H1, OA, jsonb_build_array(VA)), pg_temp.desg('B-1'), '{}', pg_temp.entr(array['op@ejemplo.test']));
  if (r->>'creada')::boolean then raise exception 'FALLO c6: %', r; end if;
end $$;

-- ── (d) A37-S63-04 ──────────────────────────────────────────────────────────
reset role;
do $$
begin
  if has_column_privilege('authenticated', 'public.conector_credencial', 'valores_cifrados', 'select') then
    raise exception '0923(d1): authenticated aún puede leer conector_credencial.valores_cifrados';
  end if;
  if not has_column_privilege('authenticated', 'public.conector_credencial', 'tenant_id', 'select') then
    raise exception '0923(d2): authenticated perdió la lectura del resto de conector_credencial';
  end if;
  if has_column_privilege('authenticated', 'public.rastreo_credencial', 'token_cifrado', 'select') then
    raise exception '0923(d3): authenticated aún puede leer rastreo_credencial.token_cifrado';
  end if;
  if not has_column_privilege('authenticated', 'public.rastreo_credencial', 'token_ultimos4', 'select') then
    raise exception '0923(d4): authenticated perdió la lectura de token_ultimos4';
  end if;
  if not has_column_privilege('service_role', 'public.conector_credencial', 'valores_cifrados', 'select')
     or not has_column_privilege('service_role', 'public.rastreo_credencial', 'token_cifrado', 'select') then
    raise exception '0923(d5): service_role debe seguir leyendo las columnas cifradas';
  end if;
  -- insight_linea_base conserva su diseño (0805): el administrador de la flota la recaptura con su JWT.
  if not has_table_privilege('authenticated', 'public.insight_linea_base', 'insert') then
    raise exception '0923(d6): la 0923 no debía cerrar la escritura de insight_linea_base (diseño 0805)';
  end if;
end $$;
-- Y de verdad: una sesión authenticated que pide la columna cifrada recibe 42501.
set local role authenticated;
do $$
begin
  begin
    perform valores_cifrados from public.conector_credencial limit 1;
    raise exception '0923(d10): authenticated leyó valores_cifrados';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
