\set ON_ERROR_STOP on
-- 0778 — Excepciones por unidad de «caseta que no debe cruzarse» y cruces justificados, contra Postgres REAL.
-- Lo que solo la base puede demostrar: la excepción es única por (flota, caseta, unidad) y repetible entre flotas;
-- su FK compuesta impide colgarla de una caseta que no es de su flota y borrar la caseta borra sus excepciones; la
-- unidad no admite vacío ni más de 40 caracteres; el cruce justificado es único por (flota, desglose, renglón,
-- categoría), exige un motivo de 3 a 300 caracteres y un renglón no negativo, su FK compuesta impide colgarlo del
-- desglose de otra flota, y borrar el desglose borra sus justificaciones; ambas tablas nacen con RLS deny-all.
begin;

insert into public.tenant (id, nombre) values
  ('78000000-0000-4000-8000-0000000000a1', 'Flota A 0778'),
  ('78000000-0000-4000-8000-0000000000b1', 'Flota B 0778');
insert into public.desglose_peaje (id, tenant_id, proveedor) values
  ('78000000-0000-4000-8000-0000000000a2', '78000000-0000-4000-8000-0000000000a1', 'IAVE'),
  ('78000000-0000-4000-8000-0000000000b2', '78000000-0000-4000-8000-0000000000b1', 'IAVE');
insert into public.peaje_caseta_nombre (tenant_id, nombre, nombre_norm, no_cruzar) values
  ('78000000-0000-4000-8000-0000000000a1', 'CASETA UNO', 'caseta uno', true),
  ('78000000-0000-4000-8000-0000000000b1', 'CASETA UNO', 'caseta uno', true),
  ('78000000-0000-4000-8000-0000000000b1', 'CASETA SOLO B', 'caseta solo b', true);

do $$
declare
  A constant uuid := '78000000-0000-4000-8000-0000000000a1';
  B constant uuid := '78000000-0000-4000-8000-0000000000b1';
  DA constant uuid := '78000000-0000-4000-8000-0000000000a2';
  DB constant uuid := '78000000-0000-4000-8000-0000000000b2';
  n int;
begin
  -- ── excepciones por unidad ──
  insert into public.peaje_caseta_excepcion_unidad (tenant_id, caseta_norm, unidad_norm, unidad) values (A, 'caseta uno', 'tc9001', 'TC9001');
  insert into public.peaje_caseta_excepcion_unidad (tenant_id, caseta_norm, unidad_norm, unidad) values (B, 'caseta uno', 'tc9001', 'TC9001');  -- otra flota: otra fila
  begin
    insert into public.peaje_caseta_excepcion_unidad (tenant_id, caseta_norm, unidad_norm, unidad) values (A, 'caseta uno', 'tc9001', 'tc-9001');
    raise exception '0778: la excepción se duplicó en la misma flota y caseta';
  exception when unique_violation then null; end;
  begin
    insert into public.peaje_caseta_excepcion_unidad (tenant_id, caseta_norm, unidad_norm, unidad) values (A, 'caseta solo b', 'tc9001', 'TC9001');
    raise exception '0778: la flota A colgó una excepción de una caseta de la flota B';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.peaje_caseta_excepcion_unidad (tenant_id, caseta_norm, unidad_norm, unidad) values (A, 'caseta uno', '', '');
    raise exception '0778: la excepción admitió una unidad vacía';
  exception when check_violation then null; end;
  begin
    insert into public.peaje_caseta_excepcion_unidad (tenant_id, caseta_norm, unidad_norm, unidad) values (A, 'caseta uno', repeat('x', 41), repeat('x', 41));
    raise exception '0778: la excepción admitió una unidad de más de 40 caracteres';
  exception when check_violation then null; end;
  begin
    insert into public.peaje_caseta_excepcion_unidad (tenant_id, caseta_norm, unidad_norm, unidad, nota) values (A, 'caseta uno', 'tc9002', 'TC9002', repeat('n', 301));
    raise exception '0778: la nota admitió más de 300 caracteres';
  exception when check_violation then null; end;

  -- ── cruces justificados ──
  insert into public.peaje_cruce_justificado (tenant_id, desglose_id, indice, motivo) values (A, DA, 7, 'Salida de servicio autorizada');
  begin
    insert into public.peaje_cruce_justificado (tenant_id, desglose_id, indice, motivo) values (A, DA, 7, 'Otra vez');
    raise exception '0778: el cruce se justificó dos veces';
  exception when unique_violation then null; end;
  begin
    insert into public.peaje_cruce_justificado (tenant_id, desglose_id, indice, motivo) values (A, DA, 8, 'ab');
    raise exception '0778: el motivo admitió menos de 3 caracteres';
  exception when check_violation then null; end;
  begin
    insert into public.peaje_cruce_justificado (tenant_id, desglose_id, indice, motivo) values (A, DA, 8, repeat('m', 301));
    raise exception '0778: el motivo admitió más de 300 caracteres';
  exception when check_violation then null; end;
  begin
    insert into public.peaje_cruce_justificado (tenant_id, desglose_id, indice, motivo) values (A, DA, -1, 'motivo válido');
    raise exception '0778: el renglón admitió un negativo';
  exception when check_violation then null; end;
  begin
    insert into public.peaje_cruce_justificado (tenant_id, desglose_id, indice, motivo) values (A, DB, 1, 'motivo válido');
    raise exception '0778: la flota A justificó un cruce del desglose de la flota B';
  exception when foreign_key_violation then null; end;

  -- borrar la caseta borra sus excepciones; borrar el desglose borra sus justificaciones
  delete from public.peaje_caseta_nombre where tenant_id = A and nombre_norm = 'caseta uno';
  select count(*) into n from public.peaje_caseta_excepcion_unidad where tenant_id = A;
  if n <> 0 then raise exception '0778: borrar la caseta debía borrar sus excepciones, quedaron %', n; end if;
  delete from public.desglose_peaje where id = DA;
  select count(*) into n from public.peaje_cruce_justificado where tenant_id = A;
  if n <> 0 then raise exception '0778: borrar el desglose debía borrar sus justificaciones, quedaron %', n; end if;

  -- ── RLS deny-all ──
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relname in ('peaje_caseta_excepcion_unidad', 'peaje_cruce_justificado') and c.relrowsecurity;
  if n <> 2 then raise exception '0778: las 2 tablas debían nacer con RLS, tienen % ', n; end if;
end $$;

rollback;
