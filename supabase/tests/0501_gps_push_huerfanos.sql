\set ON_ERROR_STOP on
-- 0501 · secreto del push firmado y dispositivos huérfanos. Todo se revierte.
begin;
insert into public.tenant (id, nombre) values
  ('b5010000-0000-0000-0000-000000000001', 'GPS 0501 A'),
  ('b5010000-0000-0000-0000-000000000002', 'GPS 0501 B');

-- (a) rotación: el vigente pasa a «previo» 24 h; versión sube; la segunda rotación descarta el previo viejo
do $$
declare v integer; s record;
begin
  v := public.rotar_gps_push_secreto('b5010000-0000-0000-0000-000000000001', 'cifrado-uno-xxxxxxxxxxxxxxxxxxxx', '2026-10-01T12:00:00Z');
  if v <> 1 then raise exception '(a) primera versión = %', v; end if;
  select * into s from public.gps_push_secreto where tenant_id = 'b5010000-0000-0000-0000-000000000001';
  if s.secreto_previo_cifrado is not null or s.previo_vence_en is not null then raise exception '(a) la primera no tiene previo'; end if;
  v := public.rotar_gps_push_secreto('b5010000-0000-0000-0000-000000000001', 'cifrado-dos-xxxxxxxxxxxxxxxxxxxx', '2026-10-01T13:00:00Z');
  select * into s from public.gps_push_secreto where tenant_id = 'b5010000-0000-0000-0000-000000000001';
  if v <> 2 or s.secreto_cifrado <> 'cifrado-dos-xxxxxxxxxxxxxxxxxxxx' or s.secreto_previo_cifrado <> 'cifrado-uno-xxxxxxxxxxxxxxxxxxxx'
     or s.previo_vence_en <> '2026-10-02T13:00:00Z' then
    raise exception '(a) rotación: v=% previo=% vence=%', v, s.secreto_previo_cifrado, s.previo_vence_en;
  end if;
  perform public.rotar_gps_push_secreto('b5010000-0000-0000-0000-000000000001', 'cifrado-tres-xxxxxxxxxxxxxxxxxxx', '2026-10-01T14:00:00Z');
  select * into s from public.gps_push_secreto where tenant_id = 'b5010000-0000-0000-0000-000000000001';
  if s.secreto_previo_cifrado <> 'cifrado-dos-xxxxxxxxxxxxxxxxxxxx' then raise exception '(a) solo se conserva UN previo (el último)'; end if;
  -- secreto cifrado vacío o corto no entra
  begin
    perform public.rotar_gps_push_secreto('b5010000-0000-0000-0000-000000000002', 'corto', now());
    raise exception '(a) aceptó un secreto corto';
  exception when others then if sqlerrm not like '%secreto cifrado inválido%' then raise; end if; end;
  if exists (select 1 from public.gps_push_secreto where tenant_id = 'b5010000-0000-0000-0000-000000000002') then
    raise exception '(a) la flota B no debía tener secreto';
  end if;
end $$;

-- (b) salud con debounce de 30 s; los contadores cuentan solo lo que se registra
do $$
declare s record;
begin
  perform public.registrar_gps_push_uso('b5010000-0000-0000-0000-000000000001', true, null, 5, '2026-10-01T15:00:00Z');
  perform public.registrar_gps_push_uso('b5010000-0000-0000-0000-000000000001', true, null, 9, '2026-10-01T15:00:10Z');
  perform public.registrar_gps_push_uso('b5010000-0000-0000-0000-000000000001', true, null, 7, '2026-10-01T15:01:00Z');
  perform public.registrar_gps_push_uso('b5010000-0000-0000-0000-000000000001', false, repeat('x', 500), 0, '2026-10-01T15:02:00Z');
  select * into s from public.gps_push_secreto where tenant_id = 'b5010000-0000-0000-0000-000000000001';
  if s.recepciones_total <> 2 or s.ultima_recepcion_guardadas <> 7 or s.ultima_recepcion_en <> '2026-10-01T15:01:00Z' then
    raise exception '(b) debounce de recepciones: total=% guardadas=%', s.recepciones_total, s.ultima_recepcion_guardadas;
  end if;
  if s.rechazos_total <> 1 or length(s.ultimo_rechazo_motivo) <> 120 then raise exception '(b) el motivo debe truncarse a 120'; end if;
  -- otra flota no se toca
  perform public.registrar_gps_push_uso('b5010000-0000-0000-0000-000000000002', true, null, 1, now());
end $$;

-- (c) CHECK de coherencia previo/vencimiento
do $$ begin
  begin
    update public.gps_push_secreto set secreto_previo_cifrado = 'x' where tenant_id = 'b5010000-0000-0000-0000-000000000001' and false;
    insert into public.gps_push_secreto (tenant_id, secreto_cifrado, secreto_previo_cifrado) values ('b5010000-0000-0000-0000-000000000002', 'abc', 'previo-sin-fecha');
    raise exception '(c) aceptó previo sin vencimiento';
  exception when check_violation then null; end;
end $$;

-- (d) huérfanos: PK por flota/proveedor/dispositivo; mismo id en otra flota es otra fila; checks
do $$
begin
  insert into public.gps_dispositivo_huerfano (tenant_id, proveedor, device_id) values
    ('b5010000-0000-0000-0000-000000000001', 'wialon', '12001'),
    ('b5010000-0000-0000-0000-000000000002', 'wialon', '12001');
  begin
    insert into public.gps_dispositivo_huerfano (tenant_id, proveedor, device_id) values ('b5010000-0000-0000-0000-000000000001', 'wialon', '12001');
    raise exception '(d) duplicado aceptado';
  exception when unique_violation then null; end;
  begin
    insert into public.gps_dispositivo_huerfano (tenant_id, proveedor, device_id) values ('b5010000-0000-0000-0000-000000000001', 'wialon', '');
    raise exception '(d) id vacío aceptado';
  exception when check_violation then null; end;
end $$;

-- (e) deny-all: anon/authenticated no tocan nada; funciones solo service_role
do $$ begin
  if has_table_privilege('anon', 'public.gps_push_secreto', 'select') or has_table_privilege('authenticated', 'public.gps_push_secreto', 'select')
     or has_table_privilege('authenticated', 'public.gps_dispositivo_huerfano', 'select')
     or has_table_privilege('anon', 'public.gps_dispositivo_huerfano', 'insert') then
    raise exception '(e) alguien distinto de service_role toca las tablas';
  end if;
  if has_function_privilege('authenticated', 'public.rotar_gps_push_secreto(uuid,text,timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.registrar_gps_push_uso(uuid,boolean,text,integer,timestamptz)', 'execute') then
    raise exception '(e) las funciones del push no deben ser ejecutables por anon/authenticated';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.gps_push_secreto'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.gps_dispositivo_huerfano'::regclass) then
    raise exception '(e) RLS apagada';
  end if;
end $$;

-- (f) cascada: borrar la flota borra secreto y huérfanos
do $$ begin
  delete from public.tenant where id = 'b5010000-0000-0000-0000-000000000001';
  if exists (select 1 from public.gps_push_secreto where tenant_id = 'b5010000-0000-0000-0000-000000000001')
     or exists (select 1 from public.gps_dispositivo_huerfano where tenant_id = 'b5010000-0000-0000-0000-000000000001') then
    raise exception '(f) la cascada no limpió';
  end if;
end $$;

rollback;
\echo 0501_gps_push_huerfanos: OK
