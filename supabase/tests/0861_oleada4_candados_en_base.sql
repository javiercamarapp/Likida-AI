\set ON_ERROR_STOP on
-- 0861 — tres candados en base (A36-R03-05, A36-R03-01, A36-R03-03), contra Postgres REAL.
--   (a) nota de crédito: veto de `rechazado`, tope contra lo reclamado (centavos), idempotencia por clave ANTES del veto;
--   (b) rearme de archivo de peajes fallida: tope de intentos (sin reiniciarlos), tope de 50 de la cola, candado por flota, aislamiento;
--   (c) ARCO: anonimiza entregas rol=operador de ese operador (no otras flotas, ni otros roles, ni otros operadores), omite las vivas,
--       conserva la liquidación y xlsx_sha256, idempotente, y una entrega nueva tras la cancelación nace omitida;
--   (d) privilegios solo service_role; (e) la REVERSA de la cabecera funciona y la migración es reaplicable.
begin;

insert into public.tenant (id, nombre) values
  ('86100000-0000-4000-8000-0000000000a1', 'Flota A 0861'),
  ('86100000-0000-4000-8000-0000000000b1', 'Flota B 0861');
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('86100000-0000-4000-8000-0000000000a2', '86100000-0000-4000-8000-0000000000a1', 'Chofer A1', '525500086101'),
  ('86100000-0000-4000-8000-0000000000a3', '86100000-0000-4000-8000-0000000000a1', 'Chofer A2', '525500086102'),
  ('86100000-0000-4000-8000-0000000000b2', '86100000-0000-4000-8000-0000000000b1', 'Chofer B1', '525500086103');

do $$
declare
  A constant uuid := '86100000-0000-4000-8000-0000000000a1';
  B constant uuid := '86100000-0000-4000-8000-0000000000b1';
  op1 constant uuid := '86100000-0000-4000-8000-0000000000a2';
  op2 constant uuid := '86100000-0000-4000-8000-0000000000a3';
  opb constant uuid := '86100000-0000-4000-8000-0000000000b2';
  r_ok uuid := '86100000-0000-4000-8000-000000000a11';
  r_rech uuid := '86100000-0000-4000-8000-000000000a12';
  r_dup uuid := '86100000-0000-4000-8000-000000000a13';
  j jsonb; n int; v numeric; e text; i int;
  arch uuid; l1 uuid := '86100000-0000-4000-8000-000000000c01'; l2 uuid := '86100000-0000-4000-8000-000000000c02';
  l3 uuid := '86100000-0000-4000-8000-000000000c03'; lb uuid := '86100000-0000-4000-8000-000000000c04';
  l4 uuid := '86100000-0000-4000-8000-000000000c05';
begin
  -- ═════ (a) notas de crédito ═════
  insert into public.peaje_reclamo (id, tenant_id, categoria, estado, monto_reclamado, enviado_en, fecha_cobro_mas_antiguo) values
    (r_ok, A, 'extemporaneo', 'enviado', 100.10, '2026-09-01', '2026-08-01'),
    (r_rech, A, 'duplicado_exacto', 'rechazado', 500, '2026-09-01', '2026-08-01'),
    (r_dup, A, 'tag_dado_de_baja', 'enviado', 500, '2026-09-01', '2026-08-01');

  -- veto de rechazado: código propio y NO escribe.
  j := public.peaje_nota_credito_registrar(A, r_rech, 10, '2026-09-10', null, 'kr');
  if (j->>'ok')::boolean or j->>'codigo' <> 'rechazado' then raise exception '0861 a: rechazado debía vetarse: %', j; end if;
  if exists (select 1 from public.peaje_reclamo_nota where reclamo_id = r_rech) then raise exception '0861 a: escribió nota en rechazado'; end if;
  select estado into e from public.peaje_reclamo where id = r_rech;
  if e <> 'rechazado' then raise exception '0861 a: el reclamo rechazado revivió a %', e; end if;

  -- tope: 100.00 cabe, 0.11 más rebasa (en centavos: 10010 < 10000+11).
  j := public.peaje_nota_credito_registrar(A, r_ok, 100.00, '2026-09-10', null, 'k1');
  if not (j->>'ok')::boolean or j->>'estado' <> 'acreditado_parcial' then raise exception '0861 a: 100.00 de 100.10 debía registrarse parcial: %', j; end if;
  j := public.peaje_nota_credito_registrar(A, r_ok, 0.11, '2026-09-11', null, 'k2');
  if (j->>'ok')::boolean or j->>'codigo' <> 'excede_reclamado' or (j->>'monto_acreditado')::numeric <> 100.00 or (j->>'monto_reclamado')::numeric <> 100.10 then
    raise exception '0861 a: 0.11 debía exceder lo reclamado: %', j; end if;
  select monto_acreditado into v from public.peaje_reclamo where id = r_ok;
  select count(*) into n from public.peaje_reclamo_nota where reclamo_id = r_ok;
  if v <> 100.00 or n <> 1 then raise exception '0861 a: el rechazo por tope escribió (acreditado %, notas %)', v, n; end if;
  -- exactamente lo que falta (0.10) cierra el reclamo.
  j := public.peaje_nota_credito_registrar(A, r_ok, 0.10, '2026-09-12', null, 'k3');
  if not (j->>'ok')::boolean or j->>'estado' <> 'acreditado' then raise exception '0861 a: 0.10 debía completar: %', j; end if;

  -- idempotencia por clave: el reintento de una nota ya registrada contesta duplicada=true AUN si ahora excedería o el reclamo cambió.
  j := public.peaje_nota_credito_registrar(A, r_ok, 100.00, '2026-09-10', null, 'k1');
  if not (j->>'ok')::boolean or not (j->>'duplicada')::boolean then raise exception '0861 a: el reintento idéntico debía ser duplicada: %', j; end if;
  update public.peaje_reclamo set estado = 'rechazado' where id = r_ok;
  j := public.peaje_nota_credito_registrar(A, r_ok, 100.00, '2026-09-10', null, 'k1');
  if not (j->>'ok')::boolean or not (j->>'duplicada')::boolean then raise exception '0861 a: duplicada antes del veto: %', j; end if;
  select count(*) into n from public.peaje_reclamo_nota where reclamo_id = r_ok;
  if n <> 2 then raise exception '0861 a: debían ser 2 notas, hay %', n; end if;

  -- aislamiento por flota; sin clave se topa igual.
  j := public.peaje_nota_credito_registrar(B, r_dup, 10, '2026-09-10', null, 'kb');
  if (j->>'ok')::boolean or j->>'codigo' <> 'no_existe' then raise exception '0861 a: otra flota tocó el reclamo: %', j; end if;
  j := public.peaje_nota_credito_registrar(A, r_dup, 600, '2026-09-10', null, null);
  if (j->>'ok')::boolean or j->>'codigo' <> 'excede_reclamado' then raise exception '0861 a: sin clave también debe topar: %', j; end if;

  -- ═════ (b) rearme de archivos ═════
  insert into public.peaje_ingesta_archivo (id, tenant_id, huella, nombre, bytes, contenido, estado, intentos, ultimo_error) values
    ('86100000-0000-4000-8000-000000000d01', A, repeat('1', 64), 'f1.csv', 2, '\x0102', 'fallida', 2, 'sin mapeo'),
    ('86100000-0000-4000-8000-000000000d02', A, repeat('2', 64), 'f2.csv', 2, '\x0102', 'fallida', 5, 'agotado'),
    ('86100000-0000-4000-8000-000000000d03', A, repeat('3', 64), 'f3.csv', 2, null, 'fallida', 0, 'purgado'),
    ('86100000-0000-4000-8000-000000000d04', A, repeat('4', 64), 'p4.csv', 2, '\x0102', 'pendiente', 0, null),
    ('86100000-0000-4000-8000-000000000d05', B, repeat('5', 64), 'fb.csv', 2, '\x0102', 'fallida', 0, 'x');

  j := public.peaje_archivo_rearmar(A, '86100000-0000-4000-8000-000000000d01', '\x0a0b0c'::bytea, 5);
  if not (j->>'ok')::boolean then raise exception '0861 b: rearmar f1 debía funcionar: %', j; end if;
  select estado, intentos, length(contenido), bytes into e, i, n, v from public.peaje_ingesta_archivo where id = '86100000-0000-4000-8000-000000000d01';
  if e <> 'pendiente' or i <> 2 or n <> 3 or v <> 3 then raise exception '0861 b: f1 mal rearmado (% % % %)', e, i, n, v; end if;
  -- ya no está fallida: no se rearma otra vez.
  j := public.peaje_archivo_rearmar(A, '86100000-0000-4000-8000-000000000d01', '\x01'::bytea, 5);
  if (j->>'ok')::boolean or j->>'codigo' <> 'no_fallida' then raise exception '0861 b: un pendiente no se rearma: %', j; end if;
  -- intentos agotados: no se rearma y los intentos no se tocan.
  j := public.peaje_archivo_rearmar(A, '86100000-0000-4000-8000-000000000d02', '\x01'::bytea, 5);
  if (j->>'ok')::boolean or j->>'codigo' <> 'intentos_agotados' then raise exception '0861 b: debía agotarse: %', j; end if;
  select estado into e from public.peaje_ingesta_archivo where id = '86100000-0000-4000-8000-000000000d02';
  if e <> 'fallida' then raise exception '0861 b: f2 cambió de estado: %', e; end if;
  -- contenido purgado (null) se repone con el reenviado.
  j := public.peaje_archivo_rearmar(A, '86100000-0000-4000-8000-000000000d03', '\x0f'::bytea, 5);
  if not (j->>'ok')::boolean then raise exception '0861 b: f3 con contenido purgado debía rearmarse: %', j; end if;
  -- aislamiento: otra flota no rearma el archivo de A, ni A el de B.
  j := public.peaje_archivo_rearmar(B, '86100000-0000-4000-8000-000000000d02', '\x01'::bytea, 5);
  if (j->>'ok')::boolean or j->>'codigo' <> 'no_existe' then raise exception '0861 b: B tocó archivo de A: %', j; end if;
  j := public.peaje_archivo_rearmar(A, '86100000-0000-4000-8000-000000000d05', '\x01'::bytea, 5);
  if (j->>'ok')::boolean or j->>'codigo' <> 'no_existe' then raise exception '0861 b: A tocó archivo de B: %', j; end if;
  -- contenido inválido.
  j := public.peaje_archivo_rearmar(A, '86100000-0000-4000-8000-000000000d02', null, 9);
  if (j->>'ok')::boolean or j->>'codigo' <> 'contenido_invalido' then raise exception '0861 b: contenido nulo: %', j; end if;
  -- tope de 50: se llena la cola de A y un archivo fallido más ya no entra; la otra flota no se afecta.
  insert into public.peaje_ingesta_archivo (tenant_id, huella, nombre, bytes, contenido, estado)
    select A, lpad(to_hex(g), 64, 'e'), 'rel2-' || g, 2, '\x01', 'pendiente' from generate_series(1, 60) g
     where g <= 50 - (select count(*) from public.peaje_ingesta_archivo where tenant_id = A and estado in ('pendiente','procesando'));
  select count(*) into n from public.peaje_ingesta_archivo where tenant_id = A and estado in ('pendiente','procesando');
  if n <> 50 then raise exception '0861 b: preparación del tope: esperaba 50 y hay %', n; end if;
  j := public.peaje_archivo_rearmar(A, '86100000-0000-4000-8000-000000000d02', '\x01'::bytea, 99);
  if (j->>'ok')::boolean or j->>'codigo' <> 'cola_llena' then raise exception '0861 b: con 50 pendientes debía ser cola_llena: %', j; end if;
  j := public.peaje_archivo_rearmar(B, '86100000-0000-4000-8000-000000000d05', '\x01'::bytea, 5);
  if not (j->>'ok')::boolean then raise exception '0861 b: la cola llena de A no debe frenar a B: %', j; end if;

  -- ═════ (c) ARCO ═════
  insert into public.liquidacion_externa (id, tenant_id, clave_externa, huella, operador_id, periodo_desde, periodo_hasta, conceptos, total, moneda, pdf_origen) values
    (l1, A, 'K1', repeat('a', 64), op1, '2026-09-01', '2026-09-07', '[{"descripcion":"Sueldo","tipo":"percepcion","monto":100}]'::jsonb, 100, 'MXN', 'generado'),
    (l2, A, 'K2', repeat('b', 64), op1, '2026-09-08', '2026-09-14', '[{"descripcion":"Sueldo","tipo":"percepcion","monto":100}]'::jsonb, 100, 'MXN', 'generado'),
    (l3, A, 'K3', repeat('c', 64), op2, '2026-09-01', '2026-09-07', '[{"descripcion":"Sueldo","tipo":"percepcion","monto":100}]'::jsonb, 100, 'MXN', 'generado'),
    (lb, B, 'K1', repeat('d', 64), opb, '2026-09-01', '2026-09-07', '[{"descripcion":"Sueldo","tipo":"percepcion","monto":100}]'::jsonb, 100, 'MXN', 'generado');
  insert into public.liquidacion_entrega_correo (id, tenant_id, liquidacion_externa_id, rol, correo, estado, xlsx_ruta, xlsx_sha256, ultimo_error) values
    ('86100000-0000-4000-8000-000000000e01', A, l1, 'operador', 'chofer1@ejemplo.invalid', 'entregada', 'A/l1.xlsx', repeat('f', 64), 'rebote a chofer1@ejemplo.invalid'),
    ('86100000-0000-4000-8000-000000000e02', A, l2, 'operador', 'chofer1@ejemplo.invalid', 'pendiente', 'A/l2.xlsx', repeat('f', 64), null),
    ('86100000-0000-4000-8000-000000000e03', A, l1, 'coordinador', 'coord@ejemplo.invalid', 'entregada', 'A/l1c.xlsx', repeat('f', 64), null),
    ('86100000-0000-4000-8000-000000000e04', A, l3, 'operador', 'chofer2@ejemplo.invalid', 'pendiente', 'A/l3.xlsx', repeat('f', 64), null),
    ('86100000-0000-4000-8000-000000000e05', B, lb, 'operador', 'choferb@ejemplo.invalid', 'pendiente', 'B/lb.xlsx', repeat('f', 64), null);

  -- operador vivo: la función se niega (no puede vaciar el correo de quien no canceló).
  j := public.arco_anonimizar_entregas_correo(A, op1);
  if (j->>'ok')::boolean or j->>'codigo' <> 'operador_no_anonimizado' then raise exception '0861 c: operador vivo: %', j; end if;
  if (select count(*) from public.liquidacion_entrega_correo where correo = 'purgado') <> 0 then raise exception '0861 c: purgó a un operador vivo'; end if;
  -- otra flota con el id del operador: no existe.
  j := public.arco_anonimizar_entregas_correo(B, op1);
  if (j->>'ok')::boolean or j->>'codigo' <> 'no_existe' then raise exception '0861 c: operador de otra flota: %', j; end if;

  -- la cancelación ARCO (anonimizado_en) dispara la anonimización por el disparador.
  update public.operador set anonimizado_en = now() where id = op1;
  if not exists (select 1 from public.liquidacion_entrega_correo where id = '86100000-0000-4000-8000-000000000e01'
                    and correo = 'purgado' and xlsx_ruta is null and estado = 'entregada' and ultimo_error is null and xlsx_sha256 = repeat('f', 64)) then
    raise exception '0861 c: la entrega terminal no quedó anonimizada conservando estado y hash'; end if;
  if not exists (select 1 from public.liquidacion_entrega_correo where id = '86100000-0000-4000-8000-000000000e02'
                    and correo = 'purgado' and xlsx_ruta is null and estado = 'omitida' and claim_token is null) then
    raise exception '0861 c: la entrega pendiente no quedó omitida'; end if;
  -- no toca: otros roles del mismo operador, otro operador de la flota, otra flota.
  if not exists (select 1 from public.liquidacion_entrega_correo where id = '86100000-0000-4000-8000-000000000e03' and correo = 'coord@ejemplo.invalid' and xlsx_ruta = 'A/l1c.xlsx')
     or not exists (select 1 from public.liquidacion_entrega_correo where id = '86100000-0000-4000-8000-000000000e04' and correo = 'chofer2@ejemplo.invalid' and estado = 'pendiente')
     or not exists (select 1 from public.liquidacion_entrega_correo where id = '86100000-0000-4000-8000-000000000e05' and correo = 'choferb@ejemplo.invalid' and estado = 'pendiente') then
    raise exception '0861 c: tocó entregas de otro rol, otro operador u otra flota'; end if;
  -- la evidencia fiscal intacta.
  if (select count(*) from public.liquidacion_externa where id in (l1, l2)) <> 2 then raise exception '0861 c: tocó la liquidación'; end if;
  -- los xlsx se encolaron para borrarse.
  if (select count(*) from public.storage_huerfano_candidato where bucket = 'liquidaciones' and nombre in ('A/l1.xlsx', 'A/l2.xlsx') and motivo = 'arco_entrega_correo') <> 2 then
    raise exception '0861 c: los xlsx no se encolaron'; end if;
  -- idempotente.
  j := public.arco_anonimizar_entregas_correo(A, op1);
  if not (j->>'ok')::boolean or (j->>'anonimizadas')::int <> 0 then raise exception '0861 c: la segunda corrida debía ser no-op: %', j; end if;

  -- una entrega al operador cancelado que nace DESPUÉS nace omitida; a otro operador, normal.
  insert into public.liquidacion_externa (id, tenant_id, clave_externa, huella, operador_id, periodo_desde, periodo_hasta, conceptos, total, moneda, pdf_origen)
    values (l4, A, 'K4', repeat('9', 64), op1, '2026-09-15', '2026-09-21', '[{"descripcion":"Sueldo","tipo":"percepcion","monto":100}]'::jsonb, 100, 'MXN', 'generado');
  insert into public.liquidacion_entrega_correo (id, tenant_id, liquidacion_externa_id, rol, correo, xlsx_ruta) values
    ('86100000-0000-4000-8000-000000000e06', A, l4, 'operador', 'chofer1@ejemplo.invalid', 'A/l4.xlsx'),
    ('86100000-0000-4000-8000-000000000e07', A, l4, 'coordinador', 'coord@ejemplo.invalid', 'A/l4c.xlsx');
  if not exists (select 1 from public.liquidacion_entrega_correo where id = '86100000-0000-4000-8000-000000000e06' and correo = 'purgado' and estado = 'omitida' and xlsx_ruta is null)
     or not exists (select 1 from public.liquidacion_entrega_correo where id = '86100000-0000-4000-8000-000000000e07' and estado = 'pendiente' and correo = 'coord@ejemplo.invalid') then
    raise exception '0861 c: la entrega nueva al operador cancelado no nació omitida (o afectó al coordinador)'; end if;
  -- el operador 2 (vivo) sigue recibiendo.
  insert into public.liquidacion_entrega_correo (id, tenant_id, liquidacion_externa_id, rol, correo, generacion) values
    ('86100000-0000-4000-8000-000000000e08', A, l3, 'operador', 'chofer2@ejemplo.invalid', 2);
  if not exists (select 1 from public.liquidacion_entrega_correo where id = '86100000-0000-4000-8000-000000000e08' and estado = 'pendiente') then
    raise exception '0861 c: el operador vivo dejó de recibir'; end if;

  -- ═════ (d) privilegios ═════
  for e in select unnest(array[
      'public.peaje_nota_credito_registrar(uuid,uuid,numeric,date,text,text)',
      'public.peaje_archivo_rearmar(uuid,uuid,bytea,integer)',
      'public.arco_anonimizar_entregas_correo(uuid,uuid,timestamptz)']) loop
    if has_function_privilege('anon', e, 'execute') or has_function_privilege('authenticated', e, 'execute')
       or not has_function_privilege('service_role', e, 'execute') then
      raise exception '0861 d: privilegios incorrectos en %', e;
    end if;
  end loop;
end $$;

rollback;

-- (e) la REVERSA de la cabecera: se quitan las piezas nuevas y (a) se restaura la definición de la 0860 (por referencia, literal).
begin;
drop trigger if exists liquidacion_entrega_correo_omitir_operador_cancelado on public.liquidacion_entrega_correo;
drop trigger if exists operador_anonimiza_entregas_correo on public.operador;
drop function if exists public.liquidacion_entrega_correo_omitir_operador_cancelado();
drop function if exists public.operador_anonimiza_entregas_correo();
drop function if exists public.arco_anonimizar_entregas_correo(uuid, uuid, timestamptz);
drop function if exists public.peaje_archivo_rearmar(uuid, uuid, bytea, integer);
\i supabase/migrations/0860_peaje_nota_credito_idempotente.sql
do $$
begin
  if exists (select 1 from pg_proc where proname in ('arco_anonimizar_entregas_correo', 'peaje_archivo_rearmar', 'operador_anonimiza_entregas_correo', 'liquidacion_entrega_correo_omitir_operador_cancelado'))
     or exists (select 1 from pg_trigger where tgname in ('operador_anonimiza_entregas_correo', 'liquidacion_entrega_correo_omitir_operador_cancelado')) then
    raise exception '0861 e: la reversa no dejó limpio';
  end if;
  if pg_get_functiondef('public.peaje_nota_credito_registrar(uuid,uuid,numeric,date,text,text)'::regprocedure) like '%excede_reclamado%' then
    raise exception '0861 e: (a) no volvió a la definición de la 0860';
  end if;
end $$;
rollback;

-- (f) reaplicable: dos veces seguidas sobre la base ya migrada no falla.
begin;
\i supabase/migrations/0861_oleada4_candados_en_base.sql
\i supabase/migrations/0861_oleada4_candados_en_base.sql
rollback;
