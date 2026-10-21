\set ON_ERROR_STOP on
-- 0852 — `insight_linea_base` ya NO acepta escritura directa vía PostgREST (JWT propio + anon key).
-- La 0805 le dio una policy `for all` + GRANT insert/update/delete explícito a `authenticated`; la 0841 cerró
-- el MISMO patrón en otras 10 tablas pero dejó ésta fuera (se creó DESPUÉS de esa auditoría, nadie la revisó
-- otra vez). Contra Postgres REAL, simulando lo que de verdad decide PostgREST (`set local role` + `set local
-- request.jwt.claims`, mismo mecanismo que usa el bloque 0841 de verificaciones.sql):
--   (a) un flota_admin de SU PROPIA flota SIGUE LEYENDO su línea base — el panel de insights no se rompió;
--   (b) un flota_admin de OTRA flota NO ve esa fila (el filtro de tenant_id sigue vivo en el `for select`);
--   (c) el INSERT directo de esa misma sesión (flota propietaria) rebota — ya no hay policy de escritura;
--   (d) el UPDATE directo rebota igual;
--   (e) el DELETE directo rebota igual, y la fila original sigue EXACTAMENTE intacta;
--   (f) `service_role` — el camino real de un futuro escritor de aplicación — SIGUE pudiendo escribir.
begin;

insert into public.tenant (id, nombre) values
  ('08520000-0000-4000-8000-0000000000a1', 'Flota A 0852'),
  ('08520000-0000-4000-8000-0000000000b1', 'Flota B 0852');
insert into public.app_user (id, tenant_id, email, rol, activo) values
  ('08520000-0000-4000-8000-0000000000c1', '08520000-0000-4000-8000-0000000000a1', 'duena-0852@test.invalid', 'flota_admin', true),
  ('08520000-0000-4000-8000-0000000000d1', '08520000-0000-4000-8000-0000000000b1', 'duena-b-0852@test.invalid', 'flota_admin', true);

set local role service_role;
insert into public.insight_linea_base (id, tenant_id, proceso, minutos_por_unidad, unidad, fuente, capturada_por) values
  ('08520000-0000-4000-8000-0000000000e1', '08520000-0000-4000-8000-0000000000a1', 'captura_comprobantes', 12.5, 'desglose', 'cronometraje de 10 casos', '08520000-0000-4000-8000-0000000000c1');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '08520000-0000-4000-8000-0000000000c1')::text, true);

-- ── (a) el flota_admin DUEÑO de la flota sigue leyendo su línea base ──────
do $$
declare n_vistas int;
begin
  select count(*) into n_vistas from public.insight_linea_base where tenant_id = '08520000-0000-4000-8000-0000000000a1';
  if n_vistas <> 1 then
    raise exception '0852(a): el flota_admin de la flota debía seguir viendo su línea base (vio %)', n_vistas;
  end if;
end $$;

-- ── (c) el INSERT directo de esa misma sesión rebota ──────────────────────
do $$
declare entro boolean := false;
begin
  begin
    insert into public.insight_linea_base (tenant_id, proceso, minutos_por_unidad, unidad, fuente)
      values ('08520000-0000-4000-8000-0000000000a1', 'colado_0852', 1, 'desglose', 'intento directo');
    entro := true;
  exception when insufficient_privilege then null;
  end;
  if entro then
    raise exception '0852(c): el INSERT directo por authenticated debía rebotar y SÍ entró';
  end if;
end $$;

-- ── (d) el UPDATE directo rebota ───────────────────────────────────────────
do $$
declare entro boolean := false; filas int := 0;
begin
  begin
    update public.insight_linea_base set minutos_por_unidad = 999 where id = '08520000-0000-4000-8000-0000000000e1';
    get diagnostics filas = row_count;
    if filas > 0 then entro := true; end if;
  exception when insufficient_privilege then null;
  end;
  if entro then
    raise exception '0852(d): el UPDATE directo por authenticated debía rebotar y SÍ modificó % fila(s)', filas;
  end if;
end $$;

-- ── (e) el DELETE directo rebota, la fila original sigue intacta ─────────
do $$
declare entro boolean := false; filas int := 0;
begin
  begin
    delete from public.insight_linea_base where id = '08520000-0000-4000-8000-0000000000e1';
    get diagnostics filas = row_count;
    if filas > 0 then entro := true; end if;
  exception when insufficient_privilege then null;
  end;
  if entro then
    raise exception '0852(e): el DELETE directo por authenticated debía rebotar y SÍ borró % fila(s)', filas;
  end if;
end $$;

-- ── (b) un flota_admin de OTRA flota no ve esta fila ──────────────────────
select set_config('request.jwt.claims', json_build_object('sub', '08520000-0000-4000-8000-0000000000d1')::text, true);
do $$
declare n_vistas int;
begin
  select count(*) into n_vistas from public.insight_linea_base where id = '08520000-0000-4000-8000-0000000000e1';
  if n_vistas <> 0 then
    raise exception '0852(b): un flota_admin de OTRA flota no debía ver la fila de la flota A (vio %)', n_vistas;
  end if;
end $$;

reset role;

-- ── la fila original sigue EXACTAMENTE intacta tras (c)/(d)/(e) ──────────
do $$
declare minutos numeric;
begin
  select minutos_por_unidad into minutos from public.insight_linea_base where id = '08520000-0000-4000-8000-0000000000e1';
  if minutos is distinct from 12.5 then
    raise exception '0852: la fila original debía seguir intacta (minutos_por_unidad=%), el INSERT/UPDATE/DELETE directos no debían tocarla', minutos;
  end if;
end $$;

-- ── (f) service_role —el camino real de un futuro escritor— sigue escribiendo ─
set local role service_role;
do $$
begin
  insert into public.insight_linea_base (tenant_id, proceso, minutos_por_unidad, unidad, fuente)
    values ('08520000-0000-4000-8000-0000000000a1', 'escritor_real_0852', 2, 'viaje', 'service_role');
exception when others then
  raise exception '0852(f): service_role debía seguir pudiendo escribir (rebotó: %)', sqlerrm;
end $$;
reset role;

rollback;
