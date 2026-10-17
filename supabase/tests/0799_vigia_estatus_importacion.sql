\set ON_ERROR_STOP on
-- 0799 — Estatus de importación por caja contra Postgres REAL. Datos sintéticos, rollback.
-- Lo que solo la base garantiza:
--   (a) único por flota, caja (sin importar mayúsculas ni espacios) y fuente; otra fuente u otra flota sí puede repetir la caja;
--       estado, docs, fuente y forma de caja/unidad rebotan valores inventados; los defaults son «desconocido»;
--   (b) una fuente no puede retroceder su observado_en (un dato más viejo no pisa al más nuevo); avanzar sí;
--   (c) la fila del programa no puede ser de otra flota; borrarla deja el estatus sin fila; borrar la flota se lleva todo;
--   (d) RLS: otra flota no lee; quien no atiende clientes (contador) no lee; nadie escribe por REST.
begin;

insert into public.tenant (id, nombre) values
  ('07990000-0000-4000-8000-0000000000a1', 'Flota A 0799'),
  ('07990000-0000-4000-8000-0000000000b1', 'Flota B 0799');
insert into public.app_user (id, tenant_id, email, rol) values
  ('07990000-0000-4000-8000-0000000000c1', '07990000-0000-4000-8000-0000000000a1', 'dueno-0799@test.invalid', 'flota_admin'),
  ('07990000-0000-4000-8000-0000000000c3', '07990000-0000-4000-8000-0000000000a1', 'contador-0799@test.invalid', 'contador'),
  ('07990000-0000-4000-8000-0000000000c4', '07990000-0000-4000-8000-0000000000b1', 'dueno-b-0799@test.invalid', 'flota_admin');

set local role service_role;

insert into public.programa_despacho_fila (id, tenant_id, terminal, fecha, tipo, num, clave_natural, huella) values
  ('07990000-0000-4000-8000-0000000000e1', '07990000-0000-4000-8000-0000000000a1', 'T1', date '2026-10-05', 'IMPORTACION', 1, 'T1|2026-10-05|IMPORTACION||1', 'huella-uno'),
  ('07990000-0000-4000-8000-0000000000e3', '07990000-0000-4000-8000-0000000000b1', 'T1', date '2026-10-05', 'IMPORTACION', 1, 'T1|2026-10-05|IMPORTACION||1', 'huella-tres');

-- (a) unicidad y dominios
do $$
declare r record;
begin
  insert into public.vigia_estatus_importacion (tenant_id, caja, estado, docs, fuente, observado_en, fila_id)
  values ('07990000-0000-4000-8000-0000000000a1', 'CJ0001', 'patio', 'listo', 'programa', timestamptz '2026-10-05 08:00+00',
          '07990000-0000-4000-8000-0000000000e1');
  begin
    insert into public.vigia_estatus_importacion (tenant_id, caja, fuente, observado_en)
    values ('07990000-0000-4000-8000-0000000000a1', 'CJ0001', 'programa', now());
    raise exception '0799(a): la misma caja entró dos veces por la misma fuente';
  exception when unique_violation then null; end;
  begin
    insert into public.vigia_estatus_importacion (tenant_id, caja, fuente, observado_en)
    values ('07990000-0000-4000-8000-0000000000a1', '  cj0001 ', 'programa', now());
    raise exception '0799(a): la caja entró otra vez con otras mayúsculas y espacios';
  exception when unique_violation then null; end;
  -- otra fuente y otra flota sí pueden tener la misma caja
  insert into public.vigia_estatus_importacion (tenant_id, caja, estado, fuente, observado_en)
  values ('07990000-0000-4000-8000-0000000000a1', 'CJ0001', 'en_ruta', 'track_trace', timestamptz '2026-10-05 09:00+00');
  insert into public.vigia_estatus_importacion (tenant_id, caja, fuente, observado_en)
  values ('07990000-0000-4000-8000-0000000000b1', 'CJ0001', 'programa', now());
  -- defaults conservadores
  select * into r from public.vigia_estatus_importacion
   where tenant_id = '07990000-0000-4000-8000-0000000000b1' and caja = 'CJ0001';
  if r.estado <> 'desconocido' or r.docs <> 'desconocido' then
    raise exception '0799(a): los defaults no son desconocido (% / %)', r.estado, r.docs;
  end if;
  begin
    insert into public.vigia_estatus_importacion (tenant_id, caja, estado, fuente, observado_en)
    values ('07990000-0000-4000-8000-0000000000a1', 'CJ0002', 'cruzando', 'programa', now());
    raise exception '0799(a): estado inventado';
  exception when check_violation then null; end;
  begin
    insert into public.vigia_estatus_importacion (tenant_id, caja, docs, fuente, observado_en)
    values ('07990000-0000-4000-8000-0000000000a1', 'CJ0002', 'completo', 'programa', now());
    raise exception '0799(a): docs inventado';
  exception when check_violation then null; end;
  begin
    insert into public.vigia_estatus_importacion (tenant_id, caja, fuente, observado_en)
    values ('07990000-0000-4000-8000-0000000000a1', 'CJ0002', 'adivinado', now());
    raise exception '0799(a): fuente inventada';
  exception when check_violation then null; end;
  begin
    insert into public.vigia_estatus_importacion (tenant_id, caja, fuente, observado_en)
    values ('07990000-0000-4000-8000-0000000000a1', '   ', 'programa', now());
    raise exception '0799(a): caja en blanco';
  exception when check_violation then null; end;
  begin
    insert into public.vigia_estatus_importacion (tenant_id, caja, unidad, fuente, observado_en)
    values ('07990000-0000-4000-8000-0000000000a1', 'CJ0003', '   ', 'programa', now());
    raise exception '0799(a): unidad en blanco';
  exception when check_violation then null; end;
  begin
    insert into public.vigia_estatus_importacion (tenant_id, caja, fuente)
    values ('07990000-0000-4000-8000-0000000000a1', 'CJ0004', 'programa');
    raise exception '0799(a): entró sin observado_en';
  exception when not_null_violation then null; end;
end $$;

-- (b) una fuente no retrocede su observado_en
do $$
begin
  begin
    update public.vigia_estatus_importacion set estado = 'pend_cruce', observado_en = timestamptz '2026-10-05 07:00+00'
     where tenant_id = '07990000-0000-4000-8000-0000000000a1' and caja = 'CJ0001' and fuente = 'programa';
    raise exception '0799(b): un dato más viejo pisó al más nuevo';
  exception when check_violation then null; end;
  update public.vigia_estatus_importacion set estado = 'pend_cruce', observado_en = timestamptz '2026-10-05 10:00+00'
   where tenant_id = '07990000-0000-4000-8000-0000000000a1' and caja = 'CJ0001' and fuente = 'programa';
  if not exists (select 1 from public.vigia_estatus_importacion
                  where tenant_id = '07990000-0000-4000-8000-0000000000a1' and caja = 'CJ0001' and fuente = 'programa'
                    and estado = 'pend_cruce') then
    raise exception '0799(b): avanzar observado_en no se aplicó';
  end if;
  -- mismo instante (reintento idempotente) sí pasa
  update public.vigia_estatus_importacion set unidad = 'U-101', observado_en = timestamptz '2026-10-05 10:00+00'
   where tenant_id = '07990000-0000-4000-8000-0000000000a1' and caja = 'CJ0001' and fuente = 'programa';
end $$;

-- (c) la fila no es de otra flota; borrarla conserva el estatus
do $$
begin
  begin
    insert into public.vigia_estatus_importacion (tenant_id, caja, fuente, observado_en, fila_id)
    values ('07990000-0000-4000-8000-0000000000a1', 'CJ0005', 'programa', now(), '07990000-0000-4000-8000-0000000000e3');
    raise exception '0799(c): el estatus se colgó de una fila de otra flota';
  exception when foreign_key_violation then null; end;
end $$;

-- (d) RLS
reset role;
do $$
declare n integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '07990000-0000-4000-8000-0000000000c1', true);
  select count(*) into n from public.vigia_estatus_importacion;
  if n = 0 then raise exception '0799(d): el dueño de la flota A no ve su estatus'; end if;
  if exists (select 1 from public.vigia_estatus_importacion where tenant_id <> '07990000-0000-4000-8000-0000000000a1') then
    raise exception '0799(d): el dueño de la flota A ve datos de otra flota';
  end if;
  perform set_config('request.jwt.claim.sub', '07990000-0000-4000-8000-0000000000c3', true);
  select count(*) into n from public.vigia_estatus_importacion;
  if n <> 0 then raise exception '0799(d): el contador ve el estatus (%)', n; end if;
  perform set_config('request.jwt.claim.sub', '07990000-0000-4000-8000-0000000000c4', true);
  if exists (select 1 from public.vigia_estatus_importacion where tenant_id = '07990000-0000-4000-8000-0000000000a1') then
    raise exception '0799(d): el dueño de la flota B ve datos de la flota A';
  end if;
  begin
    insert into public.vigia_estatus_importacion (tenant_id, caja, fuente, observado_en)
    values ('07990000-0000-4000-8000-0000000000b1', 'CJ-REST', 'manual', now());
    raise exception '0799(d): un usuario autenticado escribió por REST';
  exception when insufficient_privilege then null; end;
  begin
    update public.vigia_estatus_importacion set estado = 'patio';
    raise exception '0799(d): un usuario autenticado actualizó por REST';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.vigia_estatus_importacion;
    raise exception '0799(d): un usuario autenticado borró por REST';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

-- (c) borrar la fila deja el estatus; borrar la flota se lleva todo (con el dueño de la base)
do $$
begin
  delete from public.programa_despacho_fila where id = '07990000-0000-4000-8000-0000000000e1';
  if not exists (select 1 from public.vigia_estatus_importacion
                  where tenant_id = '07990000-0000-4000-8000-0000000000a1' and caja = 'CJ0001' and fuente = 'programa'
                    and fila_id is null) then
    raise exception '0799(c): borrar la fila no dejó el estatus sin fila (o lo borró)';
  end if;
  delete from public.tenant where id = '07990000-0000-4000-8000-0000000000a1';
  if exists (select 1 from public.vigia_estatus_importacion where tenant_id = '07990000-0000-4000-8000-0000000000a1') then
    raise exception '0799(c): quedó estatus de una flota borrada';
  end if;
end $$;

rollback;
select '0799: OK' as resultado;
