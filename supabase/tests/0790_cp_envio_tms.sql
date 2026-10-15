\set ON_ERROR_STOP on
-- 0790 — CARTA PORTE: envíos al TMS, configuración de salida, revisor asignado y eventos.
--
-- Lo que SOLO la base puede demostrar, contra Postgres real (todo dentro de una transacción revertida):
--
--   (a) UN envío ACTIVO por documento (índice parcial); los terminales no estorban; la llave de idempotencia es
--       única por flota y reutilizable en otra;
--   (b) los CHECK de dominio y de forma (estado, plantilla, sha256, errores en arreglo y ≤ 8 KB, enviado exige fecha);
--   (c) el aislamiento entre flotas: un envío no cuelga de un documento de otra flota;
--   (d) cp_envio_reclamar: reparte SIN repetir filas, respeta lease, proxima_revision y estados terminales, y
--       recupera un lease vencido; la carrera real de dos sesiones vive en 0790_cp_envio_concurrencia.sh;
--   (e) cp_envio_marcar_alerta: la alerta sale UNA vez (el segundo intento da falso), liberar la reabre;
--   (f) el CHECK de tipos de evento, reescrito ENTERO: admite los 18 de antes y los 8 nuevos, rechaza uno inventado;
--   (g) cp_salida_config: defaults de arranque, rangos y pareja de ventana;
--   (h) cp_documento.revisor_asignado con FK a app_user (borrar al usuario lo deja en NULL);
--   (i) permisos: anon/authenticated sin acceso a tablas ni RPC; service_role sí; la cascada limpia los envíos;
--   (j) NO se redefinió ninguna RPC de las migraciones 0420–0695.
-- Datos sintéticos (dominio .invalid).
begin;

insert into public.tenant (id, nombre) values
  ('79000000-0000-4000-8000-0000000000a1', 'Flota A 0790'),
  ('79000000-0000-4000-8000-0000000000b1', 'Flota B 0790');
insert into public.app_user (id, tenant_id, email, rol) values
  ('79000000-0000-4000-8000-0000000000c1', '79000000-0000-4000-8000-0000000000a1', 'revisor-0790@test.invalid', 'flota_admin');
insert into public.cp_documento (id, tenant_id, canal, formato, nombre_archivo, bytes, sha256) values
  ('79000000-0000-4000-8000-0000000000d1', '79000000-0000-4000-8000-0000000000a1', 'manual', 'excel', 'a1.xlsx', 1000, repeat('a', 64)),
  ('79000000-0000-4000-8000-0000000000d2', '79000000-0000-4000-8000-0000000000a1', 'manual', 'excel', 'a2.xlsx', 1000, repeat('b', 64)),
  ('79000000-0000-4000-8000-0000000000d3', '79000000-0000-4000-8000-0000000000a1', 'manual', 'excel', 'a3.xlsx', 1000, repeat('c', 64)),
  ('79000000-0000-4000-8000-0000000000d4', '79000000-0000-4000-8000-0000000000a1', 'manual', 'excel', 'a4.xlsx', 1000, repeat('d', 64)),
  ('79000000-0000-4000-8000-0000000000d5', '79000000-0000-4000-8000-0000000000a1', 'manual', 'excel', 'a5.xlsx', 1000, repeat('e', 64)),
  ('79000000-0000-4000-8000-0000000000e1', '79000000-0000-4000-8000-0000000000b1', 'manual', 'excel', 'b1.xlsx', 1000, repeat('a', 64));

set local role service_role;

-- ── (a) un envío activo por documento ─────────────────────────────────────
do $$
declare
  ta constant uuid := '79000000-0000-4000-8000-0000000000a1';
  tb constant uuid := '79000000-0000-4000-8000-0000000000b1';
  d1 constant uuid := '79000000-0000-4000-8000-0000000000d1';
  e1 constant uuid := '79000000-0000-4000-8000-0000000000e1';
  n int;
begin
  insert into public.cp_envio_tms (tenant_id, documento_id, version_doc, idempotency_key)
  values (ta, d1, 1, 'llave-a-0001');

  begin
    insert into public.cp_envio_tms (tenant_id, documento_id, version_doc, idempotency_key)
    values (ta, d1, 1, 'llave-a-0002');
    raise exception '0790: dos envíos activos para el mismo documento';
  exception when unique_violation then null;
  end;

  -- La misma llave en la misma flota choca; en OTRA flota entra.
  begin
    insert into public.cp_envio_tms (tenant_id, documento_id, version_doc, idempotency_key)
    values (ta, '79000000-0000-4000-8000-0000000000d2', 1, 'llave-a-0001');
    raise exception '0790: la misma llave de idempotencia entró dos veces en la misma flota';
  exception when unique_violation then null;
  end;
  insert into public.cp_envio_tms (tenant_id, documento_id, version_doc, idempotency_key)
  values (tb, e1, 1, 'llave-a-0001');

  -- Un terminal NO estorba: cerrado el primero, el documento admite uno nuevo.
  update public.cp_envio_tms set estado = 'enviado', enviado_en = now()
   where tenant_id = ta and idempotency_key = 'llave-a-0001';
  insert into public.cp_envio_tms (tenant_id, documento_id, version_doc, idempotency_key)
  values (ta, d1, 2, 'llave-a-0003');
  select count(*) into n from public.cp_envio_tms where tenant_id = ta and documento_id = d1;
  if n <> 2 then raise exception '0790: se esperaban 2 envíos (uno terminal y uno activo), hay %', n; end if;
  -- ...y los demás terminales tampoco estorban.
  update public.cp_envio_tms set estado = 'rechazado_tms' where tenant_id = ta and idempotency_key = 'llave-a-0003';
  insert into public.cp_envio_tms (tenant_id, documento_id, version_doc, idempotency_key)
  values (ta, d1, 3, 'llave-a-0004');
  update public.cp_envio_tms set estado = 'subido_a_mano' where tenant_id = ta and idempotency_key = 'llave-a-0004';
  insert into public.cp_envio_tms (tenant_id, documento_id, version_doc, idempotency_key)
  values (ta, d1, 4, 'llave-a-0005');
  update public.cp_envio_tms set estado = 'descartado' where tenant_id = ta and idempotency_key = 'llave-a-0005';
  insert into public.cp_envio_tms (tenant_id, documento_id, version_doc, idempotency_key)
  values (ta, d1, 5, 'llave-a-0006');
  -- Los estados vivos SÍ estorban (pendiente_reque, error_transitorio, enviando, listo).
  update public.cp_envio_tms set estado = 'pendiente_reque' where tenant_id = ta and idempotency_key = 'llave-a-0006';
  begin
    insert into public.cp_envio_tms (tenant_id, documento_id, version_doc, idempotency_key)
    values (ta, d1, 6, 'llave-a-0007');
    raise exception '0790: un envío pendiente_reque no frenó a un segundo activo';
  exception when unique_violation then null;
  end;
end $$;

-- ── (b) cada CHECK rechaza lo suyo ────────────────────────────────────────
do $$
declare
  ta constant uuid := '79000000-0000-4000-8000-0000000000a1';
  d2 constant uuid := '79000000-0000-4000-8000-0000000000d2';
  c record;
  n int := 0;
begin
  for c in
    select * from (values
      ('estado fuera de dominio',  'estado', '''inventado'''),
      ('plantilla fuera de dominio', 'plantilla', '''vieja'''),
      ('sha256 mal formado', 'plantilla_sha256', '''XYZ'''),
      ('intentos negativos', 'intentos', '-1'),
      ('version_doc cero', 'version_doc', '0'),
      ('llave demasiado corta', 'idempotency_key', '''corta'''),
      ('errores no es arreglo', 'errores', '''{"a":1}''::jsonb'),
      ('errores pasa de 8 KB', 'errores', 'to_jsonb((select array_agg(md5(g::text)) from generate_series(1, 400) g))'),
      ('ultimo_error pasa de 8 KB', 'ultimo_error', 'to_jsonb((select array_agg(md5(g::text)) from generate_series(1, 400) g))'),
      ('enviado sin enviado_en', 'estado', '''enviado'''),
      ('referencia demasiado larga', 'referencia_tms', 'repeat(''x'', 201)'),
      ('causa demasiado larga', 'causa_pendiente', 'repeat(''x'', 201)')
    ) as t(nombre, columna, valor)
  loop
    begin
      execute format(
        'insert into public.cp_envio_tms (tenant_id, documento_id, %s%s%I) values (%L, %L, %s%s%s)',
        case when c.columna = 'version_doc' then '' else 'version_doc, ' end,
        case when c.columna = 'idempotency_key' then '' else 'idempotency_key, ' end,
        c.columna, ta, d2,
        case when c.columna = 'version_doc' then '' else '1, ' end,
        case when c.columna = 'idempotency_key' then '' else quote_literal('llave-check-' || n) || ', ' end,
        c.valor);
      raise exception '0790: el CHECK no rechazó «%»', c.nombre;
    exception when check_violation then null;
    end;
    n := n + 1;
  end loop;
end $$;

-- ── (c) un envío no cuelga del documento de otra flota ────────────────────
do $$
begin
  begin
    insert into public.cp_envio_tms (tenant_id, documento_id, version_doc, idempotency_key)
    values ('79000000-0000-4000-8000-0000000000b1', '79000000-0000-4000-8000-0000000000d2', 1, 'llave-cruzada-1');
    raise exception '0790: un envío de la flota B colgó de un documento de la flota A';
  exception when foreign_key_violation then null;
  end;
end $$;

-- ── (d) cp_envio_reclamar ─────────────────────────────────────────────────
do $$
declare
  ta constant uuid := '79000000-0000-4000-8000-0000000000a1';
  ids uuid[];
  primero uuid[];
  segundo uuid[];
  tercero uuid[];
  r record;
begin
  -- Se limpia TODO (la transacción se revierte) para contar exacto: la RPC reclama de todas las flotas.
  delete from public.cp_envio_tms;
  insert into public.cp_envio_tms (tenant_id, documento_id, version_doc, idempotency_key, estado) values
    (ta, '79000000-0000-4000-8000-0000000000d1', 1, 'reclamo-uno-01', 'pendiente_prechequeo'),
    (ta, '79000000-0000-4000-8000-0000000000d2', 1, 'reclamo-dos-02', 'pendiente_reque'),
    (ta, '79000000-0000-4000-8000-0000000000d3', 1, 'reclamo-tres-3', 'error_transitorio');
  -- No reclamables: terminal, futuro, y uno ya con lease vigente.
  insert into public.cp_envio_tms (tenant_id, documento_id, version_doc, idempotency_key, estado, enviado_en) values
    (ta, '79000000-0000-4000-8000-0000000000d4', 1, 'reclamo-term-04', 'enviado', now());
  insert into public.cp_envio_tms (tenant_id, documento_id, version_doc, idempotency_key, estado, proxima_revision) values
    (ta, '79000000-0000-4000-8000-0000000000d5', 1, 'reclamo-fut-005', 'pendiente_reque', now() + interval '1 hour');

  select array_agg(id) into primero from public.cp_envio_reclamar(2);
  if coalesce(cardinality(primero), 0) <> 2 then raise exception '0790: el primer reclamo debía traer 2, trajo %', primero; end if;
  select array_agg(id) into segundo from public.cp_envio_reclamar(10);
  if coalesce(cardinality(segundo), 0) <> 1 then raise exception '0790: el segundo reclamo debía traer solo el que faltaba (1), trajo %', segundo; end if;
  if primero && segundo then raise exception '0790: dos reclamos devolvieron la misma fila'; end if;
  select array_agg(id) into tercero from public.cp_envio_reclamar(10);
  if tercero is not null then raise exception '0790: con todo en lease, el tercer reclamo debía venir vacío, trajo %', tercero; end if;

  -- El reclamo sube los intentos y pone lease; no cambia el estado ni toca terminales/futuros.
  if exists (select 1 from public.cp_envio_tms where tenant_id = ta and idempotency_key in ('reclamo-term-04', 'reclamo-fut-005') and (intentos <> 0 or procesando_hasta is not null)) then
    raise exception '0790: se reclamó un terminal o un envío con proxima_revision futura';
  end if;
  if (select count(*) from public.cp_envio_tms where tenant_id = ta and intentos = 1 and procesando_hasta > now()) <> 3 then
    raise exception '0790: los 3 reclamados debían quedar con 1 intento y lease vigente';
  end if;
  if (select estado from public.cp_envio_tms where tenant_id = ta and idempotency_key = 'reclamo-dos-02') <> 'pendiente_reque' then
    raise exception '0790: reclamar cambió el estado';
  end if;

  -- Lease vencido → se recupera con un intento más. Proxima_revision vencida → entra.
  update public.cp_envio_tms set procesando_hasta = now() - interval '1 second' where tenant_id = ta and idempotency_key = 'reclamo-uno-01';
  update public.cp_envio_tms set proxima_revision = now() - interval '1 minute' where tenant_id = ta and idempotency_key = 'reclamo-fut-005';
  select array_agg(id) into ids from public.cp_envio_reclamar(10);
  if coalesce(cardinality(ids), 0) <> 2 then raise exception '0790: debían reclamarse el lease vencido y el de revisión vencida (2), trajo %', ids; end if;
  select intentos into r from public.cp_envio_tms where tenant_id = ta and idempotency_key = 'reclamo-uno-01';
  if r.intentos <> 2 then raise exception '0790: el lease recuperado debía llevar 2 intentos, lleva %', r.intentos; end if;

  -- Rangos.
  begin perform * from public.cp_envio_reclamar(0); raise exception '0790: p_limite 0 pasó'; exception when raise_exception then
    if sqlerrm not like 'cp_envio_reclamar: p_limite%' then raise; end if; end;
  begin perform * from public.cp_envio_reclamar(10, 5); raise exception '0790: lease de 5 s pasó'; exception when raise_exception then
    if sqlerrm not like 'cp_envio_reclamar: p_lease_segundos%' then raise; end if; end;
end $$;

-- ── (e) la alerta sale UNA vez ────────────────────────────────────────────
do $$
declare
  ta constant uuid := '79000000-0000-4000-8000-0000000000a1';
  tb constant uuid := '79000000-0000-4000-8000-0000000000b1';
  e uuid;
begin
  select id into e from public.cp_envio_tms where tenant_id = ta and idempotency_key = 'reclamo-dos-02';
  if not public.cp_envio_marcar_alerta(ta, e) then raise exception '0790: la primera alerta debía marcarse'; end if;
  if public.cp_envio_marcar_alerta(ta, e) then raise exception '0790: la alerta se marcó dos veces'; end if;
  if public.cp_envio_marcar_alerta(tb, e) then raise exception '0790: otra flota marcó la alerta de este envío'; end if;
  if public.cp_envio_liberar_alerta(tb, e) then raise exception '0790: otra flota liberó la alerta de este envío'; end if;
  if not public.cp_envio_liberar_alerta(ta, e) then raise exception '0790: liberar debía soltar el candado'; end if;
  if public.cp_envio_liberar_alerta(ta, e) then raise exception '0790: liberar dos veces dio verdadero'; end if;
  if not public.cp_envio_marcar_alerta(ta, e) then raise exception '0790: tras liberar, la alerta debía poder marcarse otra vez'; end if;
end $$;

-- ── (f) tipos de evento: los de antes y los nuevos ────────────────────────
do $$
declare
  t text;
  n int := 0;
begin
  foreach t in array array[
    'recibido', 'duplicado_recibido', 'extraccion_iniciada', 'extraccion_ok', 'extraccion_fallida',
    'escalada', 'revision_abierta', 'campo_corregido', 'aprobado', 'rechazado', 'reabierto',
    'salida_viaje', 'exportado', 'perfil_aprendido', 'purgado', 'aviso_oficina', 'reintentos_agotados',
    'dividido',
    'envio_preparado', 'envio_pendiente_reque', 'envio_enviado', 'envio_rechazado', 'envio_error',
    'envio_alertado', 'envio_subido_a_mano', 'revisor_asignado'
  ] loop
    insert into public.cp_documento_evento (documento_id, tenant_id, tipo)
    values ('79000000-0000-4000-8000-0000000000d1', '79000000-0000-4000-8000-0000000000a1', t);
    n := n + 1;
  end loop;
  if n <> 26 then raise exception '0790: se esperaban 26 tipos de evento, se probaron %', n; end if;
  begin
    insert into public.cp_documento_evento (documento_id, tenant_id, tipo)
    values ('79000000-0000-4000-8000-0000000000d1', '79000000-0000-4000-8000-0000000000a1', 'inventado');
    raise exception '0790: el CHECK de eventos admitió un tipo inventado';
  exception when check_violation then null;
  end;
end $$;

-- ── (g) configuración de salida ───────────────────────────────────────────
do $$
declare
  ta constant uuid := '79000000-0000-4000-8000-0000000000a1';
  c record;
  n int := 0;
begin
  insert into public.cp_salida_config (tenant_id) values (ta);
  select * into c from public.cp_salida_config where tenant_id = ta;
  if not (c.modo = 'descarga' and c.plantilla_por_defecto = 'normal' and c.reintentos_max = 6 and c.frecuencia_min = 60
          and c.si_tms_desconocido = 'retener' and c.distancia_formato = 'texto_km'
          and c.ventana_inicio is null and c.destinatario_alerta_correo is null) then
    raise exception '0790: defaults de arranque distintos a los declarados: %', to_jsonb(c);
  end if;
  for c in
    select * from (values
      ('modo inventado', 'modo', '''ftp'''),
      ('plantilla inventada', 'plantilla_por_defecto', '''vieja'''),
      ('reintentos > 50', 'reintentos_max', '51'),
      ('reintentos < 0', 'reintentos_max', '-1'),
      ('frecuencia < 5', 'frecuencia_min', '4'),
      ('frecuencia > 1440', 'frecuencia_min', '1441'),
      ('ventana sin fin', 'ventana_inicio', '''08:00'''),
      ('correo de alerta sin arroba', 'destinatario_alerta_correo', '''sin-arroba'''),
      ('correo de revisión con espacio', 'destinatario_revision_correo', '''a b@x.invalid'''),
      ('desconocido inventado', 'si_tms_desconocido', '''quizas'''),
      ('distancia inventada', 'distancia_formato', '''millas'''),
      ('layout no es objeto', 'layout', '''[1]''::jsonb')
    ) as t(nombre, columna, valor)
  loop
    begin
      execute format('update public.cp_salida_config set %I = %s where tenant_id = %L', c.columna, c.valor, ta);
      raise exception '0790: el CHECK de la configuración no rechazó «%»', c.nombre;
    exception when check_violation then null;
    end;
    n := n + 1;
  end loop;
  -- Valores válidos en el borde sí entran.
  update public.cp_salida_config
     set reintentos_max = 0, frecuencia_min = 1440, ventana_inicio = '08:00', ventana_fin = '20:00',
         destinatario_alerta_correo = 'oficina@test.invalid', si_tms_desconocido = 'enviar',
         distancia_formato = 'numero', modo = 'api', plantilla_por_defecto = 'nueva',
         destinatario_revision_usuario = '79000000-0000-4000-8000-0000000000c1'
   where tenant_id = ta;
end $$;

-- ── (h) revisor asignado ──────────────────────────────────────────────────
do $$
declare
  ta constant uuid := '79000000-0000-4000-8000-0000000000a1';
  u  constant uuid := '79000000-0000-4000-8000-0000000000c1';
begin
  update public.cp_documento set revisor_asignado = u where id = '79000000-0000-4000-8000-0000000000d1';
  begin
    update public.cp_documento set revisor_asignado = gen_random_uuid() where id = '79000000-0000-4000-8000-0000000000d1';
    raise exception '0790: revisor_asignado admitió un usuario inexistente';
  exception when foreign_key_violation then null;
  end;
end $$;
reset role;
-- Borrar al usuario deja el documento sin revisor (y la configuración sin destinatario), no lo borra.
delete from public.app_user where id = '79000000-0000-4000-8000-0000000000c1';
do $$
begin
  if exists (select 1 from public.cp_documento where id = '79000000-0000-4000-8000-0000000000d1' and revisor_asignado is not null) then
    raise exception '0790: borrar al revisor no dejó el documento en NULL';
  end if;
  if not exists (select 1 from public.cp_documento where id = '79000000-0000-4000-8000-0000000000d1') then
    raise exception '0790: borrar al revisor borró el documento';
  end if;
  if exists (select 1 from public.cp_salida_config where destinatario_revision_usuario is not null) then
    raise exception '0790: borrar al usuario no limpió el destinatario de revisión';
  end if;
end $$;

-- ── (i) permisos y cascada ────────────────────────────────────────────────
do $$
declare
  f text;
  r text;
  t text;
  p text;
begin
  foreach f in array array[
    'cp_envio_reclamar(integer,integer)', 'cp_envio_marcar_alerta(uuid,uuid)', 'cp_envio_liberar_alerta(uuid,uuid)'
  ] loop
    foreach r in array array['anon', 'authenticated', 'public'] loop
      if has_function_privilege(r, 'public.' || f, 'execute') then
        raise exception '0790: % puede ejecutar %', r, f;
      end if;
    end loop;
    if not has_function_privilege('service_role', 'public.' || f, 'execute') then
      raise exception '0790: service_role no puede ejecutar %', f;
    end if;
  end loop;
  foreach t in array array['cp_envio_tms', 'cp_salida_config'] loop
    foreach p in array array['select', 'insert', 'update', 'delete'] loop
      if has_table_privilege('anon', 'public.' || t, p) or has_table_privilege('authenticated', 'public.' || t, p) then
        raise exception '0790: anon/authenticated tienen % sobre %', p, t;
      end if;
      if not has_table_privilege('service_role', 'public.' || t, p) then
        raise exception '0790: service_role no tiene % sobre %', p, t;
      end if;
    end loop;
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception '0790: % sin RLS', t;
    end if;
  end loop;
  -- Las RPC son security definer con search_path fijo.
  if exists (
    select 1 from pg_proc
     where pronamespace = 'public'::regnamespace
       and proname in ('cp_envio_reclamar', 'cp_envio_marcar_alerta', 'cp_envio_liberar_alerta')
       and (not prosecdef or proconfig is null or not (proconfig::text ~ 'search_path'))
  ) then
    raise exception '0790: una RPC no es security definer con search_path fijo';
  end if;
end $$;

-- Borrar un documento arrastra sus envíos; borrar la flota arrastra todo.
insert into public.cp_envio_tms (tenant_id, documento_id, version_doc, idempotency_key)
values ('79000000-0000-4000-8000-0000000000b1', '79000000-0000-4000-8000-0000000000e1', 1, 'cascada-doc-01');
delete from public.cp_documento where id = '79000000-0000-4000-8000-0000000000e1';
do $$
begin
  if exists (select 1 from public.cp_envio_tms where idempotency_key = 'cascada-doc-01') then
    raise exception '0790: borrar el documento no arrastró su envío';
  end if;
end $$;
delete from public.tenant where id = '79000000-0000-4000-8000-0000000000a1';
do $$
begin
  if exists (select 1 from public.cp_envio_tms where tenant_id = '79000000-0000-4000-8000-0000000000a1')
     or exists (select 1 from public.cp_salida_config where tenant_id = '79000000-0000-4000-8000-0000000000a1') then
    raise exception '0790: borrar la flota dejó envíos o configuración colgando';
  end if;
end $$;

-- ── (j) la migración no redefine nada de la 0420–0695 ─────────────────────
do $$
begin
  -- Las RPC vigentes siguen existiendo con sus firmas de siempre.
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in (
        'cp_documento_reclamar', 'cp_documento_dividir', 'cp_documentos_por_avisar', 'cp_documentos_pendientes',
        'cp_documentos_agotados', 'cp_documento_reclamar_aviso', 'cp_documento_liberar_aviso')) < 7 then
    raise exception '0790: falta alguna RPC de las migraciones anteriores';
  end if;
end $$;

rollback;
