\set ON_ERROR_STOP on
-- 0890 · lote A5-05 de la auditoría 37 (S62-06/07/08/10). Postgres real, datos sintéticos, todo en una transacción que se revierte.
begin;

insert into public.tenant (id, nombre) values
  ('89000000-0000-4000-8000-0000000000a1', 'Flota A 0890'),
  ('89000000-0000-4000-8000-0000000000b1', 'Flota B 0890');
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('89000000-0000-4000-8000-0000000000a2', '89000000-0000-4000-8000-0000000000a1', 'Operador Uno', '5215500000001');
insert into public.app_user (id, tenant_id, email, rol) values
  ('89000000-0000-4000-8000-000000000401', '89000000-0000-4000-8000-0000000000a1', 'admin-0890@test.invalid', 'flota_admin'),
  ('89000000-0000-4000-8000-000000000402', '89000000-0000-4000-8000-0000000000a1', 'otro-0890@test.invalid', 'flota_admin');

-- ── S62-06: tarifario sin traslape ──────────────────────────────────────────
do $$
declare
  A constant uuid := '89000000-0000-4000-8000-0000000000a1';
  B constant uuid := '89000000-0000-4000-8000-0000000000b1';
  v_ok boolean;
begin
  insert into public.peaje_tarifa (tenant_id, caseta_norm, clase, importe, vigente_desde, vigente_hasta, origen)
    values (A, 'caseta uno', 5, 100, '2026-01-01', '2026-06-30', 'declarada');
  -- traslape parcial, contenido y abierto: 23P01
  v_ok := false;
  begin insert into public.peaje_tarifa (tenant_id, caseta_norm, clase, importe, vigente_desde, vigente_hasta, origen)
    values (A, 'caseta uno', 5, 110, '2026-06-30', '2026-12-31', 'declarada');
  exception when sqlstate '23P01' then v_ok := true; end;
  if not v_ok then raise exception '0890(06): aceptó un traslape de un día (extremos incluidos)'; end if;
  v_ok := false;
  begin insert into public.peaje_tarifa (tenant_id, caseta_norm, clase, importe, vigente_desde, vigente_hasta, origen)
    values (A, 'caseta uno', 5, 110, '2026-03-01', '2026-03-31', 'declarada');
  exception when sqlstate '23P01' then v_ok := true; end;
  if not v_ok then raise exception '0890(06): aceptó una vigencia contenida'; end if;
  v_ok := false;
  begin insert into public.peaje_tarifa (tenant_id, caseta_norm, clase, importe, vigente_desde, vigente_hasta, origen)
    values (A, 'caseta uno', 5, 110, '2025-01-01', null, 'declarada');
  exception when sqlstate '23P01' then v_ok := true; end;
  if not v_ok then raise exception '0890(06): aceptó una vigencia abierta que cubre la guardada'; end if;
  -- contigua (día siguiente), otra clase, otra caseta, otra flota: sí
  insert into public.peaje_tarifa (tenant_id, caseta_norm, clase, importe, vigente_desde, vigente_hasta, origen) values
    (A, 'caseta uno', 5, 110, '2026-07-01', null, 'declarada'),
    (A, 'caseta uno', 6, 150, '2026-03-01', null, 'declarada'),
    (A, 'caseta dos', 5, 90,  '2026-03-01', null, 'declarada'),
    (B, 'caseta uno', 5, 95,  '2026-03-01', null, 'declarada');
  -- ahora la 2.ª está abierta: una anterior que la cubra, no
  v_ok := false;
  begin insert into public.peaje_tarifa (tenant_id, caseta_norm, clase, importe, vigente_desde, vigente_hasta, origen)
    values (A, 'caseta uno', 5, 120, '2026-08-01', '2026-08-31', 'declarada');
  exception when sqlstate '23P01' then v_ok := true; end;
  if not v_ok then raise exception '0890(06): aceptó una vigencia dentro de la abierta'; end if;
  -- el upsert por la llave única (mismo inicio) sigue actualizando, también su fin
  insert into public.peaje_tarifa (tenant_id, caseta_norm, clase, importe, vigente_desde, vigente_hasta, origen)
    values (A, 'caseta uno', 5, 105, '2026-01-01', '2026-06-30', 'declarada')
    on conflict (tenant_id, caseta_norm, clase, vigente_desde) do update set importe = excluded.importe;
  if (select importe from public.peaje_tarifa where tenant_id = A and caseta_norm = 'caseta uno' and clase = 5 and vigente_desde = '2026-01-01') <> 105 then
    raise exception '0890(06): el upsert por llave no actualizó';
  end if;
  -- confirmar (update de columnas ajenas) no se bloquea
  update public.peaje_tarifa set confirmada = true, confirmada_por = 'Finanzas' where tenant_id = A and caseta_norm = 'caseta uno' and clase = 5 and vigente_desde = '2026-01-01';
  -- ensanchar una vigencia hasta traslapar con otra: rechazado en UPDATE
  v_ok := false;
  begin update public.peaje_tarifa set vigente_hasta = '2026-07-15' where tenant_id = A and caseta_norm = 'caseta uno' and clase = 5 and vigente_desde = '2026-01-01';
  exception when sqlstate '23P01' then v_ok := true; end;
  if not v_ok then raise exception '0890(06): UPDATE ensanchó la vigencia hasta traslapar'; end if;
  -- privilegios de la función
  if has_function_privilege('authenticated', 'public.peaje_tarifa_sin_traslape()', 'execute') then raise exception '0890(06): authenticated ejecuta el trigger'; end if;
end $$;

-- ── S62-08: residuos de la entrega por correo ───────────────────────────────
do $$
declare
  A constant uuid := '89000000-0000-4000-8000-0000000000a1';
  L constant uuid := '89000000-0000-4000-8000-0000000000d1';
  r jsonb; n int; v_ok boolean;
begin
  insert into public.liquidacion_externa
    (id, tenant_id, clave_externa, huella, operador_id, periodo_desde, periodo_hasta, conceptos, total, moneda, pdf_origen, estado, acuse_tipo, acuse_en, created_at)
  values (L, A, 'L1', repeat('a',64), '89000000-0000-4000-8000-0000000000a2', '2025-01-01','2025-01-07',
    '[{"descripcion":"x","tipo":"percepcion","monto":1}]'::jsonb, 1, 'MXN', 'generado', 'acusada', 'recibida', now() - interval '20 months', now() - interval '20 months');
  insert into public.liquidacion_entrega_correo
    (id, tenant_id, liquidacion_externa_id, rol, correo, estado, xlsx_ruta, pedido_por, ultimo_error, proximo_intento_en, created_at) values
    -- ya purgada por la 0788 pero con residuos
    ('89000000-0000-4000-8000-0000000000e1', A, L, 'operador',    'purgado', 'entregada', null, 'jefe@ejemplo.test', 'rechazó a uno@ejemplo.test', now() - interval '14 months', now() - interval '14 months'),
    -- pendiente atascada (viejísima)
    ('89000000-0000-4000-8000-0000000000e2', A, L, 'coordinador', 'dos@ejemplo.test',  'pendiente', 'a/dos.xlsx', 'jefe@ejemplo.test', 'timeout', now() - interval '20 months', now() - interval '20 months'),
    -- enviando con lease vencido y viejísima
    ('89000000-0000-4000-8000-0000000000e3', A, L, 'rh',          'tres@ejemplo.test', 'enviando',  'a/tres.xlsx', null, null, now() - interval '20 months', now() - interval '20 months'),
    -- pendiente RECIENTE: no se toca
    ('89000000-0000-4000-8000-0000000000e4', A, L, 'archivo',     'cuatro@ejemplo.test', 'pendiente', 'a/cuatro.xlsx', 'jefe@ejemplo.test', 'x', now() + interval '1 hour', now() - interval '2 months'),
    -- pendiente vieja de creación pero con próximo intento reciente (sigue viva): no se toca
    ('89000000-0000-4000-8000-0000000000e5', A, L, 'rh',          'cinco@ejemplo.test', 'pendiente', 'a/cinco.xlsx', null, null, now() + interval '1 hour', now() - interval '20 months'),
    -- terminal reciente con residuos: no se toca (aún dentro de retención)
    ('89000000-0000-4000-8000-0000000000e6', A, L, 'operador',    'seis@ejemplo.test',  'entregada', 'a/seis.xlsx', 'jefe@ejemplo.test', 'e', now() - interval '3 months', now() - interval '3 months');

  set local role service_role;
  foreach n in array array[0, 11] loop
    v_ok := false;
    begin perform public.purgar_liquidacion_entrega_correo_residuos(n, 100); exception when sqlstate 'PU001' then v_ok := true; end;
    if not v_ok then raise exception '0890(08): p_meses=% se aceptó (piso 12)', n; end if;
  end loop;
  foreach n in array array[0, 5001] loop
    v_ok := false;
    begin perform public.purgar_liquidacion_entrega_correo_residuos(13, n); exception when sqlstate 'PU001' then v_ok := true; end;
    if not v_ok then raise exception '0890(08): p_limite=% se aceptó', n; end if;
  end loop;

  r := public.purgar_liquidacion_entrega_correo_residuos(13, 100);
  if (r->>'limpiadas')::int <> 1 then raise exception '0890(08): limpió % (esperaba 1): %', r->>'limpiadas', r; end if;
  if (r->>'atascadasCerradas')::int <> 2 then raise exception '0890(08): cerró % (esperaba 2): %', r->>'atascadasCerradas', r; end if;
  if (r->>'archivosEncolados')::int <> 2 then raise exception '0890(08): encoló % (esperaba 2)', r->>'archivosEncolados'; end if;
  if exists (select 1 from public.liquidacion_entrega_correo where id = '89000000-0000-4000-8000-0000000000e1' and (pedido_por is not null or ultimo_error is not null)) then
    raise exception '0890(08): quedaron pedido_por/ultimo_error en la ya purgada'; end if;
  if (select count(*) from public.liquidacion_entrega_correo where id in ('89000000-0000-4000-8000-0000000000e2','89000000-0000-4000-8000-0000000000e3')
        and estado = 'fallida' and correo = 'purgado' and xlsx_ruta is null and pedido_por is null and ultimo_error is null
        and claim_token is null) <> 2 then
    raise exception '0890(08): las atascadas no quedaron cerradas y purgadas'; end if;
  if (select count(*) from public.liquidacion_entrega_correo where id in ('89000000-0000-4000-8000-0000000000e4','89000000-0000-4000-8000-0000000000e5','89000000-0000-4000-8000-0000000000e6')
        and correo <> 'purgado' and estado in ('pendiente','entregada')) <> 3 then
    raise exception '0890(08): tocó una entrega viva o dentro de retención'; end if;
  if (select pedido_por from public.liquidacion_entrega_correo where id = '89000000-0000-4000-8000-0000000000e6') is null then
    raise exception '0890(08): limpió pedido_por de una terminal aún dentro de retención'; end if;
  if (select count(*) from public.storage_huerfano_candidato where bucket = 'liquidaciones' and nombre in ('a/dos.xlsx','a/tres.xlsx')) <> 2 then
    raise exception '0890(08): archivos sin encolar'; end if;
  -- idempotente
  r := public.purgar_liquidacion_entrega_correo_residuos(13, 100);
  if (r->>'limpiadas')::int <> 0 or (r->>'atascadasCerradas')::int <> 0 then raise exception '0890(08): no es idempotente: %', r; end if;
  reset role;
  if has_function_privilege('authenticated', 'public.purgar_liquidacion_entrega_correo_residuos(integer, integer, timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.purgar_liquidacion_entrega_correo_residuos(integer, integer, timestamptz)', 'execute') then
    raise exception '0890(08): la función no es solo de service_role'; end if;
end $$;

-- ── S62-07: retención del programa de despacho ──────────────────────────────
do $$
declare
  A constant uuid := '89000000-0000-4000-8000-0000000000a1';
  C1 constant uuid := '89000000-0000-4000-8000-0000000000c1';
  C2 constant uuid := '89000000-0000-4000-8000-0000000000c2';
  F1 constant uuid := '89000000-0000-4000-8000-0000000000f1';
  F2 constant uuid := '89000000-0000-4000-8000-0000000000f2';
  r jsonb; n int; v_ok boolean;
begin
  insert into public.programa_despacho_carga (id, tenant_id, terminal, origen, archivo_sha256, created_at) values
    (C1, A, 'T1', 'subida', repeat('a', 64), now() - interval '14 months'),
    (C2, A, 'T1', 'subida', repeat('b', 64), now() - interval '1 month');
  insert into public.programa_despacho_fila (id, tenant_id, carga_ultima_id, terminal, fecha, tipo, num, clave_natural, huella, comentarios) values
    (F1, A, C1, 'T1', (now() - interval '14 months')::date, 'EXPORTACION', 1, 'T1|viejo|1', 'huella-uno', 'llamar a Pedro'),
    (F2, A, C2, 'T1', (now() - interval '1 month')::date,   'EXPORTACION', 2, 'T1|nuevo|2', 'huella-dos', 'comentario reciente');
  insert into public.programa_despacho_cambio (tenant_id, fila_id, campo, antes, despues, carga_id, en) values
    (A, F1, 'comentarios', 'x', 'llamar a Pedro', C1, now() - interval '14 months'),
    (A, F2, 'comentarios', 'x', 'comentario reciente', C2, now() - interval '1 month');

  set local role service_role;
  foreach n in array array[0, 5] loop
    v_ok := false;
    begin perform public.purgar_programa_despacho(n, 100); exception when sqlstate 'PU001' then v_ok := true; end;
    if not v_ok then raise exception '0890(07): p_meses=% se aceptó (piso 6)', n; end if;
  end loop;
  v_ok := false;
  begin perform public.purgar_programa_despacho(12, 0); exception when sqlstate 'PU001' then v_ok := true; end;
  if not v_ok then raise exception '0890(07): p_limite=0 se aceptó'; end if;

  r := public.purgar_programa_despacho(12, 100);
  if (r->>'cambios')::int <> 1 or (r->>'comentariosVaciados')::int <> 1 or (r->>'cargas')::int <> 1 then
    raise exception '0890(07): conteos inesperados: %', r; end if;
  if (select count(*) from public.programa_despacho_cambio where tenant_id = A) <> 1 then raise exception '0890(07): borró el cambio reciente'; end if;
  if (select comentarios from public.programa_despacho_fila where id = F1) is not null then raise exception '0890(07): no vació el comentario viejo'; end if;
  if (select comentarios from public.programa_despacho_fila where id = F2) is distinct from 'comentario reciente' then raise exception '0890(07): tocó el comentario reciente'; end if;
  if (select count(*) from public.programa_despacho_fila where tenant_id = A) <> 2 then raise exception '0890(07): borró filas'; end if;
  if exists (select 1 from public.programa_despacho_carga where id = C1) or not exists (select 1 from public.programa_despacho_carga where id = C2) then
    raise exception '0890(07): cargas mal purgadas'; end if;
  if (select carga_ultima_id from public.programa_despacho_fila where id = F1) is not null then raise exception '0890(07): la fila vieja sigue apuntando a la carga purgada'; end if;
  r := public.purgar_programa_despacho(12, 100);
  if (r->>'cambios')::int <> 0 or (r->>'comentariosVaciados')::int <> 0 or (r->>'cargas')::int <> 0 then raise exception '0890(07): no es idempotente: %', r; end if;
  reset role;
  if has_function_privilege('authenticated', 'public.purgar_programa_despacho(integer, integer, timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.purgar_programa_despacho(integer, integer, timestamptz)', 'execute') then
    raise exception '0890(07): la función no es solo de service_role'; end if;
end $$;

-- ── S62-10: línea base con tope y capturada_por no suplantable ──────────────
do $$
declare
  A constant uuid := '89000000-0000-4000-8000-0000000000a1';
  v_ok boolean;
begin
  v_ok := false;
  begin insert into public.insight_linea_base (tenant_id, proceso, minutos_por_unidad, unidad, fuente) values (A, 'absurdo', 1000000000, 'u', 'f');
  exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception '0890(10): aceptó 1e9 minutos'; end if;
  insert into public.insight_linea_base (tenant_id, proceso, minutos_por_unidad, unidad, fuente) values (A, 'tope', 100000, 'u', 'f');
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '89000000-0000-4000-8000-000000000401', true);
do $$
declare A constant uuid := '89000000-0000-4000-8000-0000000000a1'; v_ok boolean;
begin
  insert into public.insight_linea_base (tenant_id, proceso, minutos_por_unidad, unidad, fuente, capturada_por)
    values (A, 'propio', 10, 'u', 'f', '89000000-0000-4000-8000-000000000401');
  insert into public.insight_linea_base (tenant_id, proceso, minutos_por_unidad, unidad, fuente) values (A, 'sin_autor', 10, 'u', 'f');
  v_ok := false;
  begin insert into public.insight_linea_base (tenant_id, proceso, minutos_por_unidad, unidad, fuente, capturada_por)
    values (A, 'suplantado', 10, 'u', 'f', '89000000-0000-4000-8000-000000000402');
  exception when insufficient_privilege then v_ok := true; end;
  if not v_ok then raise exception '0890(10): puso a otro usuario en capturada_por'; end if;
  v_ok := false;
  begin update public.insight_linea_base set capturada_por = '89000000-0000-4000-8000-000000000402' where proceso = 'propio';
  exception when insufficient_privilege then v_ok := true; end;
  if not v_ok then raise exception '0890(10): reasignó capturada_por a otro usuario'; end if;
end $$;
reset role;

rollback;
