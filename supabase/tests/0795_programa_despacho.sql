\set ON_ERROR_STOP on
-- 0795 — Programa de despacho (cargas, filas, cambios) contra Postgres REAL. Datos sintéticos, rollback.
-- Lo que solo la base garantiza:
--   (a) la misma subida (flota, terminal, sha256) no entra dos veces, pero otra terminal u otra flota sí;
--   (b) la fila es única por (flota, terminal, clave_natural) y los catálogos (tipo, tránsito, CCP) rebotan valores inventados;
--   (c) el cambio guarda antes/después, exige que sean distintos, y ocultar una fila no la borra;
--   (d) borrar una carga conserva filas y cambios (carga_ultima_id / carga_id quedan en null); borrar la flota se lleva todo;
--   (e) RLS: otra flota no lee; quien no atiende clientes (contador) no lee; nadie escribe por REST.
begin;

insert into public.tenant (id, nombre) values
  ('07950000-0000-4000-8000-0000000000a1', 'Flota A 0795'),
  ('07950000-0000-4000-8000-0000000000b1', 'Flota B 0795');
insert into public.app_user (id, tenant_id, email, rol) values
  ('07950000-0000-4000-8000-0000000000c1', '07950000-0000-4000-8000-0000000000a1', 'dueno-0795@test.invalid', 'flota_admin'),
  ('07950000-0000-4000-8000-0000000000c3', '07950000-0000-4000-8000-0000000000a1', 'contador-0795@test.invalid', 'contador'),
  ('07950000-0000-4000-8000-0000000000c4', '07950000-0000-4000-8000-0000000000b1', 'dueno-b-0795@test.invalid', 'flota_admin');

set local role service_role;

-- (a) carga única por (flota, terminal, sha256)
do $$
begin
  insert into public.programa_despacho_carga (id, tenant_id, terminal, origen, archivo_sha256, filas_leidas, filas_validas)
  values ('07950000-0000-4000-8000-0000000000d1', '07950000-0000-4000-8000-0000000000a1', 'T1', 'subida', repeat('a', 64), 10, 8);
  begin
    insert into public.programa_despacho_carga (tenant_id, terminal, origen, archivo_sha256)
    values ('07950000-0000-4000-8000-0000000000a1', 'T1', 'drive', repeat('a', 64));
    raise exception '0795(a): el mismo archivo entró dos veces a la misma terminal';
  exception when unique_violation then null; end;
  -- otra terminal, otra flota, otro archivo: sí entran
  insert into public.programa_despacho_carga (tenant_id, terminal, origen, archivo_sha256) values
    ('07950000-0000-4000-8000-0000000000a1', 'T2', 'subida', repeat('a', 64)),
    ('07950000-0000-4000-8000-0000000000b1', 'T1', 'subida', repeat('a', 64)),
    ('07950000-0000-4000-8000-0000000000a1', 'T1', 'api', repeat('b', 64));
  begin
    insert into public.programa_despacho_carga (tenant_id, terminal, origen, archivo_sha256)
    values ('07950000-0000-4000-8000-0000000000a1', 'T1', 'correo', repeat('c', 64));
    raise exception '0795(a): origen inventado';
  exception when check_violation then null; end;
  begin
    insert into public.programa_despacho_carga (tenant_id, terminal, origen, archivo_sha256)
    values ('07950000-0000-4000-8000-0000000000a1', 'T1', 'subida', 'no-es-sha');
    raise exception '0795(a): sha256 mal formado';
  exception when check_violation then null; end;
  begin
    insert into public.programa_despacho_carga (tenant_id, terminal, origen, archivo_sha256, filas_leidas, filas_validas)
    values ('07950000-0000-4000-8000-0000000000a1', 'T1', 'subida', repeat('d', 64), 5, 6);
    raise exception '0795(a): más filas válidas que leídas';
  exception when check_violation then null; end;
  begin
    insert into public.programa_despacho_carga (tenant_id, terminal, origen, archivo_sha256, avisos)
    values ('07950000-0000-4000-8000-0000000000a1', 'T1', 'subida', repeat('e', 64), '{"a":1}'::jsonb);
    raise exception '0795(a): avisos admitió un objeto';
  exception when check_violation then null; end;
  begin
    insert into public.programa_despacho_carga (tenant_id, terminal, origen, archivo_sha256, avisos)
    values ('07950000-0000-4000-8000-0000000000a1', 'T1', 'subida', repeat('e', 64),
            (select jsonb_agg(i) from generate_series(1, 201) i));
    raise exception '0795(a): avisos sin tope de elementos';
  exception when check_violation then null; end;
end $$;

-- (b) fila única por clave natural + catálogos
do $$
begin
  insert into public.programa_despacho_fila (id, tenant_id, carga_ultima_id, terminal, fecha, tipo, bloque, num, clave_natural, caja, unidad, transito, ccp, huella)
  values ('07950000-0000-4000-8000-0000000000e1', '07950000-0000-4000-8000-0000000000a1', '07950000-0000-4000-8000-0000000000d1',
          'T1', date '2026-10-05', 'EXPORTACION', null, 1, 'T1|2026-10-05|EXPORTACION||1', 'CAJA-001', 'U-001', 'patio_nld', 'listo', 'huella-uno');
  begin
    insert into public.programa_despacho_fila (tenant_id, terminal, fecha, tipo, clave_natural, huella)
    values ('07950000-0000-4000-8000-0000000000a1', 'T1', date '2026-10-05', 'EXPORTACION', 'T1|2026-10-05|EXPORTACION||1', 'huella-dos');
    raise exception '0795(b): la clave natural se repitió';
  exception when unique_violation then null; end;
  -- la misma clave en otra terminal y en otra flota es otra fila
  insert into public.programa_despacho_fila (tenant_id, terminal, fecha, tipo, clave_natural, huella) values
    ('07950000-0000-4000-8000-0000000000a1', 'T2', date '2026-10-05', 'EXPORTACION', 'T1|2026-10-05|EXPORTACION||1', 'huella-dos'),
    ('07950000-0000-4000-8000-0000000000b1', 'T1', date '2026-10-05', 'EXPORTACION', 'T1|2026-10-05|EXPORTACION||1', 'huella-dos');
  begin
    insert into public.programa_despacho_fila (tenant_id, terminal, fecha, tipo, clave_natural, huella)
    values ('07950000-0000-4000-8000-0000000000a1', 'T1', date '2026-10-05', 'INVENTADO', 'x', 'huella-dos');
    raise exception '0795(b): tipo inventado';
  exception when check_violation then null; end;
  begin
    insert into public.programa_despacho_fila (tenant_id, terminal, fecha, tipo, clave_natural, huella, transito)
    values ('07950000-0000-4000-8000-0000000000a1', 'T1', date '2026-10-05', 'EXPORTACION', 'x', 'huella-dos', 'volando');
    raise exception '0795(b): tránsito inventado';
  exception when check_violation then null; end;
  begin
    insert into public.programa_despacho_fila (tenant_id, terminal, fecha, tipo, clave_natural, huella, ccp)
    values ('07950000-0000-4000-8000-0000000000a1', 'T1', date '2026-10-05', 'EXPORTACION', 'x', 'huella-dos', 'quizas');
    raise exception '0795(b): CCP inventado';
  exception when check_violation then null; end;
  begin
    insert into public.programa_despacho_fila (tenant_id, terminal, fecha, tipo, clave_natural, huella, color)
    values ('07950000-0000-4000-8000-0000000000a1', 'T1', date '2026-10-05', 'EXPORTACION', 'x', 'huella-dos', '"rojo"'::jsonb);
    raise exception '0795(b): color admitió un escalar';
  exception when check_violation then null; end;
  insert into public.programa_despacho_fila (tenant_id, terminal, fecha, tipo, clave_natural, huella, color)
  values ('07950000-0000-4000-8000-0000000000a1', 'T1', date '2026-10-05', 'EXPORTACION', 'con-color', 'huella-dos', '{"fondo":"rosa"}'::jsonb);
  -- una carga de OTRA flota no se puede colgar de una fila (FK compuesta)
  begin
    insert into public.programa_despacho_fila (tenant_id, carga_ultima_id, terminal, fecha, tipo, clave_natural, huella)
    select '07950000-0000-4000-8000-0000000000b1', c.id, 'T1', date '2026-10-06', 'EXPORTACION', 'cruce', 'huella-dos'
      from public.programa_despacho_carga c where c.tenant_id = '07950000-0000-4000-8000-0000000000a1' limit 1;
    raise exception '0795(b): una fila de la flota B apuntó a una carga de la flota A';
  exception when foreign_key_violation then null; end;
end $$;

-- (c) cambios
do $$
begin
  insert into public.programa_despacho_cambio (tenant_id, fila_id, campo, antes, despues, carga_id)
  values ('07950000-0000-4000-8000-0000000000a1', '07950000-0000-4000-8000-0000000000e1', 'unidad', 'U-001', 'U-009', '07950000-0000-4000-8000-0000000000d1');
  begin
    insert into public.programa_despacho_cambio (tenant_id, fila_id, campo, antes, despues)
    values ('07950000-0000-4000-8000-0000000000a1', '07950000-0000-4000-8000-0000000000e1', 'caja', 'X', 'X');
    raise exception '0795(c): un cambio sin cambio';
  exception when check_violation then null; end;
  begin
    insert into public.programa_despacho_cambio (tenant_id, fila_id, campo, antes, despues)
    values ('07950000-0000-4000-8000-0000000000b1', '07950000-0000-4000-8000-0000000000e1', 'caja', 'X', 'Y');
    raise exception '0795(c): un cambio de la flota B colgó de una fila de la flota A';
  exception when foreign_key_violation then null; end;
  update public.programa_despacho_fila set visible = false where id = '07950000-0000-4000-8000-0000000000e1';
  if not exists (select 1 from public.programa_despacho_fila where id = '07950000-0000-4000-8000-0000000000e1' and not visible) then
    raise exception '0795(c): ocultar la fila la perdió';
  end if;
end $$;

-- (d) borrar una carga conserva filas y cambios
do $$
begin
  delete from public.programa_despacho_carga where id = '07950000-0000-4000-8000-0000000000d1';
  if not exists (select 1 from public.programa_despacho_fila where id = '07950000-0000-4000-8000-0000000000e1' and carga_ultima_id is null) then
    raise exception '0795(d): borrar la carga se llevó la fila o dejó la referencia';
  end if;
  if not exists (select 1 from public.programa_despacho_cambio where fila_id = '07950000-0000-4000-8000-0000000000e1' and carga_id is null) then
    raise exception '0795(d): borrar la carga se llevó el cambio o dejó la referencia';
  end if;
end $$;

-- (e) RLS
reset role;
do $$
declare n integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '07950000-0000-4000-8000-0000000000c1', true);
  select count(*) into n from public.programa_despacho_fila;
  if n = 0 then raise exception '0795(e): el dueño de la flota A no ve sus filas'; end if;
  if exists (select 1 from public.programa_despacho_fila where tenant_id <> '07950000-0000-4000-8000-0000000000a1')
     or exists (select 1 from public.programa_despacho_carga where tenant_id <> '07950000-0000-4000-8000-0000000000a1')
     or exists (select 1 from public.programa_despacho_cambio where tenant_id <> '07950000-0000-4000-8000-0000000000a1') then
    raise exception '0795(e): el dueño de la flota A ve datos de otra flota';
  end if;
  select count(*) into n from public.programa_despacho_cambio;
  if n = 0 then raise exception '0795(e): el dueño de la flota A no ve sus cambios'; end if;
  -- el contador (no atiende clientes) no ve nada
  perform set_config('request.jwt.claim.sub', '07950000-0000-4000-8000-0000000000c3', true);
  select count(*) into n from public.programa_despacho_fila;
  if n <> 0 then raise exception '0795(e): el contador ve el programa (%)', n; end if;
  select count(*) into n from public.programa_despacho_carga;
  if n <> 0 then raise exception '0795(e): el contador ve las cargas (%)', n; end if;
  -- el dueño de B no ve lo de A
  perform set_config('request.jwt.claim.sub', '07950000-0000-4000-8000-0000000000c4', true);
  if exists (select 1 from public.programa_despacho_fila where tenant_id = '07950000-0000-4000-8000-0000000000a1') then
    raise exception '0795(e): el dueño de la flota B ve filas de la flota A';
  end if;
  -- nadie escribe por REST
  begin
    insert into public.programa_despacho_carga (tenant_id, terminal, origen, archivo_sha256)
    values ('07950000-0000-4000-8000-0000000000b1', 'T9', 'subida', repeat('f', 64));
    raise exception '0795(e): un usuario autenticado escribió una carga por REST';
  exception when insufficient_privilege then null; end;
  begin
    update public.programa_despacho_fila set visible = false;
    raise exception '0795(e): un usuario autenticado actualizó filas por REST';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.programa_despacho_cambio;
    raise exception '0795(e): un usuario autenticado borró cambios por REST';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

-- (d, bis) borrar la flota se lleva todo (con el dueño de la base, como una purga del servidor)
do $$
begin
  delete from public.tenant where id = '07950000-0000-4000-8000-0000000000a1';
  if exists (select 1 from public.programa_despacho_carga where tenant_id = '07950000-0000-4000-8000-0000000000a1')
     or exists (select 1 from public.programa_despacho_fila where tenant_id = '07950000-0000-4000-8000-0000000000a1')
     or exists (select 1 from public.programa_despacho_cambio where tenant_id = '07950000-0000-4000-8000-0000000000a1') then
    raise exception '0795(d): quedaron datos de una flota borrada';
  end if;
  if not exists (select 1 from public.programa_despacho_fila where tenant_id = '07950000-0000-4000-8000-0000000000b1') then
    raise exception '0795(d): borrar la flota A tocó a la flota B';
  end if;
end $$;

rollback;
