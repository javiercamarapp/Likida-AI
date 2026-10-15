\set ON_ERROR_STOP on
-- 0775-0777 — Revisión de cobros de peajes, contra Postgres REAL.
-- Lo que solo la base puede demostrar: la clase de la línea admite 0..99 y rechaza lo demás; el periodo oficial
-- del desglose va completo o vacío (las dos fechas), no invertido y con origen del dominio; el catálogo de casetas
-- por nombre es único por flota, con coordenadas juntas y dentro de rango y clases sanas; la baja de un TAG es
-- única por flota y con la forma del TAG; el reclamo admite solo los estados del dominio, exige fecha de envío
-- cuando ya no está "preparado", tiene montos no negativos y su FK compuesta impide colgarlo del desglose de otra
-- flota; la nota de crédito exige monto positivo y su FK compuesta impide colgarla del reclamo de otra flota
-- (borrar el reclamo borra sus notas); todas las tablas nacen con RLS deny-all. Idempotencia: las migraciones se
-- aplican dos veces sin error (lo comprueba quien corre este archivo: ver el encabezado de la 0775).
begin;

insert into public.tenant (id, nombre) values
  ('77500000-0000-4000-8000-0000000000a1', 'Flota A 0775'),
  ('77500000-0000-4000-8000-0000000000b1', 'Flota B 0775');
insert into public.desglose_peaje (id, tenant_id, proveedor) values
  ('77500000-0000-4000-8000-0000000000a2', '77500000-0000-4000-8000-0000000000a1', 'IAVE'),
  ('77500000-0000-4000-8000-0000000000b2', '77500000-0000-4000-8000-0000000000b1', 'IAVE');

do $$
declare
  A constant uuid := '77500000-0000-4000-8000-0000000000a1';
  B constant uuid := '77500000-0000-4000-8000-0000000000b1';
  DA constant uuid := '77500000-0000-4000-8000-0000000000a2';
  DB constant uuid := '77500000-0000-4000-8000-0000000000b2';
  rid uuid;
  n int;
begin
  -- ── 0775: clase de la línea ──
  insert into public.desglose_peaje_linea (tenant_id, desglose_id, indice, monto, clase, unidad_archivo, importe_100)
  values (A, DA, 0, 100, 5, 'TC0001', 120.50), (A, DA, 1, 100, null, null, null);
  begin
    insert into public.desglose_peaje_linea (tenant_id, desglose_id, indice, monto, clase) values (A, DA, 2, 100, 100);
    raise exception '0775: la clase admitió 100';
  exception when check_violation then null; end;
  begin
    insert into public.desglose_peaje_linea (tenant_id, desglose_id, indice, monto, clase) values (A, DA, 3, 100, -1);
    raise exception '0775: la clase admitió un negativo';
  exception when check_violation then null; end;
  begin
    insert into public.desglose_peaje_linea (tenant_id, desglose_id, indice, monto, unidad_archivo) values (A, DA, 4, 100, repeat('x', 41));
    raise exception '0775: la unidad del archivo admitió más de 40 caracteres';
  exception when check_violation then null; end;

  -- ── 0775: periodo oficial del desglose ──
  update public.desglose_peaje set periodo_oficial_desde = '2026-09-01', periodo_oficial_hasta = '2026-09-10', periodo_origen = 'nombre_archivo', no_periodo = '745', calidad = '{"filasLeidas": 9635}' where id = DA;
  begin
    update public.desglose_peaje set periodo_oficial_desde = '2026-09-01' where id = DB;
    raise exception '0775: el periodo oficial admitió una sola fecha';
  exception when check_violation then null; end;
  begin
    update public.desglose_peaje set periodo_oficial_desde = '2026-09-10', periodo_oficial_hasta = '2026-09-01' where id = DB;
    raise exception '0775: el periodo oficial admitió fechas invertidas';
  exception when check_violation then null; end;
  begin
    update public.desglose_peaje set periodo_oficial_desde = '2026-09-01', periodo_oficial_hasta = '2026-09-10', periodo_origen = 'adivinado' where id = DB;
    raise exception '0775: el origen del periodo admitió un valor inventado';
  exception when check_violation then null; end;

  -- ── 0776: catálogo de casetas por nombre ──
  insert into public.peaje_caseta_nombre (tenant_id, nombre, nombre_norm, clases_permitidas, no_cruzar) values (A, 'CASETA UNO', 'caseta uno', '{1}', false);
  insert into public.peaje_caseta_nombre (tenant_id, nombre, nombre_norm) values (B, 'CASETA UNO', 'caseta uno');  -- otra flota: mismo nombre, otra fila
  begin
    insert into public.peaje_caseta_nombre (tenant_id, nombre, nombre_norm) values (A, 'Caseta  Uno', 'caseta uno');
    raise exception '0776: el nombre normalizado se repitió en la misma flota';
  exception when unique_violation then null; end;
  insert into public.peaje_caseta_nombre (tenant_id, nombre, nombre_norm, lat, lng) values (A, 'CASETA DOS', 'caseta dos', 25.6, -100.3);
  begin
    insert into public.peaje_caseta_nombre (tenant_id, nombre, nombre_norm, lat) values (A, 'CASETA TRES', 'caseta tres', 25.6);
    raise exception '0776: una coordenada a medias';
  exception when check_violation then null; end;
  begin
    insert into public.peaje_caseta_nombre (tenant_id, nombre, nombre_norm, lat, lng) values (A, 'CASETA CUATRO', 'caseta cuatro', 95, -100.3);
    raise exception '0776: latitud fuera de rango';
  exception when check_violation then null; end;
  begin
    insert into public.peaje_caseta_nombre (tenant_id, nombre, nombre_norm, clases_permitidas) values (A, 'CASETA CINCO', 'caseta cinco', '{1,100}');
    raise exception '0776: clase permitida fuera de 0..99';
  exception when check_violation then null; end;

  -- ── 0776: TAGs dados de baja ──
  insert into public.peaje_tag_baja (tenant_id, tag, baja_en) values (A, 'IMDM00000001', '2026-09-05');
  insert into public.peaje_tag_baja (tenant_id, tag, baja_en) values (B, 'IMDM00000001', '2026-09-06');
  begin
    insert into public.peaje_tag_baja (tenant_id, tag, baja_en) values (A, 'IMDM00000001', '2026-09-07');
    raise exception '0776: la baja del TAG se duplicó en la misma flota';
  exception when unique_violation then null; end;
  begin
    insert into public.peaje_tag_baja (tenant_id, tag, baja_en) values (A, 'imdm 1', '2026-09-07');
    raise exception '0776: el TAG sin normalizar entró';
  exception when check_violation then null; end;

  -- ── 0777: reclamos y notas de crédito ──
  insert into public.peaje_reclamo (tenant_id, desglose_id, categoria, n_cruces, monto_reclamado, fecha_cobro_mas_antiguo)
  values (A, DA, 'extemporaneo', 12, 5000, '2026-08-19') returning id into rid;
  begin
    insert into public.peaje_reclamo (tenant_id, categoria, estado, monto_reclamado, fecha_cobro_mas_antiguo)
    values (A, 'x', 'inventado', 1, '2026-08-19');
    raise exception '0777: el estado admitió un valor inventado';
  exception when check_violation then null; end;
  begin
    insert into public.peaje_reclamo (tenant_id, categoria, estado, monto_reclamado, fecha_cobro_mas_antiguo)
    values (A, 'x', 'enviado', 1, '2026-08-19');
    raise exception '0777: un reclamo enviado sin fecha de envío';
  exception when check_violation then null; end;
  begin
    insert into public.peaje_reclamo (tenant_id, categoria, monto_reclamado, fecha_cobro_mas_antiguo) values (A, 'x', -1, '2026-08-19');
    raise exception '0777: monto reclamado negativo';
  exception when check_violation then null; end;
  begin
    insert into public.peaje_reclamo (tenant_id, desglose_id, categoria, monto_reclamado, fecha_cobro_mas_antiguo) values (A, DB, 'x', 1, '2026-08-19');
    raise exception '0777: el reclamo de la flota A colgó del desglose de la flota B';
  exception when foreign_key_violation then null; end;

  insert into public.peaje_reclamo_nota (tenant_id, reclamo_id, fecha, monto, referencia) values (A, rid, '2026-09-20', 1000, 'NC-1');
  begin
    insert into public.peaje_reclamo_nota (tenant_id, reclamo_id, fecha, monto) values (A, rid, '2026-09-21', 0);
    raise exception '0777: nota de crédito de monto cero';
  exception when check_violation then null; end;
  begin
    insert into public.peaje_reclamo_nota (tenant_id, reclamo_id, fecha, monto) values (B, rid, '2026-09-21', 10);
    raise exception '0777: la nota de la flota B colgó del reclamo de la flota A';
  exception when foreign_key_violation then null; end;
  -- borrar el reclamo borra sus notas; borrar el desglose conserva el reclamo (set null solo de desglose_id)
  delete from public.desglose_peaje where id = DA;
  select count(*) into n from public.peaje_reclamo where id = rid and desglose_id is null and tenant_id = A;
  if n <> 1 then raise exception '0777: borrar el desglose debía dejar el reclamo con desglose_id nulo (conservando tenant_id), quedaron %', n; end if;
  delete from public.peaje_reclamo where id = rid;
  select count(*) into n from public.peaje_reclamo_nota where reclamo_id = rid;
  if n <> 0 then raise exception '0777: borrar el reclamo debía borrar sus notas, quedaron %', n; end if;

  -- ── RLS deny-all ──
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relname in ('peaje_caseta_nombre', 'peaje_tag_baja', 'peaje_reclamo', 'peaje_reclamo_nota') and c.relrowsecurity;
  if n <> 4 then raise exception '0776/0777: las 4 tablas debían nacer con RLS, tienen % ', n; end if;
end $$;

rollback;
