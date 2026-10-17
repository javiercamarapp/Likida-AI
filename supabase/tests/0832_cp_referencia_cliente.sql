\set ON_ERROR_STOP on
-- 0832 — CARTA PORTE: referencia comercial del cliente y regla «exige referencia» por cliente (T-A3-65).
--
-- Lo que SOLO la base puede demostrar, contra Postgres real (todo en una transacción revertida):
--   (a) las dos tablas nacen VACÍAS;
--   (b) exige_referencia nace en false; una regla por cliente; una referencia por viaje;
--   (c) un cliente o un viaje de OTRA flota no cuelga (FK compuesta);
--   (d) CHECK de la referencia: vacía, con espacios en los bordes, con salto de línea o de 61 caracteres rebota;
--   (e) borrar el viaje o el cliente cascada la fila;
--   (f) permisos: anon/authenticated sin acceso; service_role sí; RLS encendida.
-- Datos sintéticos (dominio .invalid).
begin;

insert into public.tenant (id, nombre) values
  ('83200000-0000-4000-8000-0000000000a1', 'Flota A 0832'),
  ('83200000-0000-4000-8000-0000000000b1', 'Flota B 0832');
insert into public.cliente (id, tenant_id, nombre) values
  ('83200000-0000-4000-8000-0000000000d1', '83200000-0000-4000-8000-0000000000a1', 'Cliente Sintetico 1'),
  ('83200000-0000-4000-8000-0000000000e1', '83200000-0000-4000-8000-0000000000b1', 'Cliente Sintetico B');
insert into public.operador (id, tenant_id, nombre, telefono) values
  ('83200000-0000-4000-8000-0000000000f1', '83200000-0000-4000-8000-0000000000a1', 'Operador Sintetico A', '525500832001'), -- grep-limpio:ok
  ('83200000-0000-4000-8000-0000000000f2', '83200000-0000-4000-8000-0000000000b1', 'Operador Sintetico B', '525500832002'); -- grep-limpio:ok
insert into public.viaje (id, tenant_id, operador_id) values
  ('83200000-0000-4000-8000-000000000a01', '83200000-0000-4000-8000-0000000000a1', '83200000-0000-4000-8000-0000000000f1'),
  ('83200000-0000-4000-8000-000000000b01', '83200000-0000-4000-8000-0000000000b1', '83200000-0000-4000-8000-0000000000f2');

do $$
begin
  if (select count(*) from public.cp_cliente_referencia) <> 0 or (select count(*) from public.cp_viaje_referencia) <> 0 then
    raise exception 'REFERENCIA_0832 las tablas debían nacer vacías';
  end if;
end $$;

set local role service_role;

do $$
declare
  ta constant uuid := '83200000-0000-4000-8000-0000000000a1';
  tb constant uuid := '83200000-0000-4000-8000-0000000000b1';
  c1 constant uuid := '83200000-0000-4000-8000-0000000000d1';
  cb constant uuid := '83200000-0000-4000-8000-0000000000e1';
  va constant uuid := '83200000-0000-4000-8000-000000000a01';
  vb constant uuid := '83200000-0000-4000-8000-000000000b01';
  def boolean; dup_regla boolean := false; dup_ref boolean := false; fk_cli boolean := true; fk_via boolean := true;
  malos int := 0; n int; cascada boolean;
begin
  -- ── (b) default y unicidad ──
  insert into cp_cliente_referencia (tenant_id, cliente_id) values (ta, c1);
  select exige_referencia into def from cp_cliente_referencia where tenant_id = ta and cliente_id = c1;
  begin
    insert into cp_cliente_referencia (tenant_id, cliente_id, exige_referencia) values (ta, c1, true);
  exception when unique_violation then dup_regla := true; end;
  insert into cp_viaje_referencia (tenant_id, viaje_id, referencia) values (ta, va, 'REF-0001');
  begin
    insert into cp_viaje_referencia (tenant_id, viaje_id, referencia) values (ta, va, 'REF-0002');
  exception when unique_violation then dup_ref := true; end;

  -- ── (c) otra flota ──
  begin
    insert into cp_cliente_referencia (tenant_id, cliente_id) values (ta, cb);
    fk_cli := false;
  exception when foreign_key_violation then null; end;
  begin
    insert into cp_viaje_referencia (tenant_id, viaje_id, referencia) values (ta, vb, 'REF-X');
    fk_via := false;
  exception when foreign_key_violation then null; end;

  -- ── (d) forma de la referencia (viaje de la flota B para no chocar con la unicidad) ──
  for n in 1..4 loop
    begin
      insert into cp_viaje_referencia (tenant_id, viaje_id, referencia) values (tb, vb,
        (array['', ' REF', E'RE\nF', repeat('x', 61)])[n]);
    exception when check_violation then malos := malos + 1; end;
  end loop;
  insert into cp_viaje_referencia (tenant_id, viaje_id, referencia) values (tb, vb, repeat('x', 60));

  -- ── (e) cascada ──
  delete from public.viaje where id = va and tenant_id = ta;
  delete from public.cliente where id = c1 and tenant_id = ta;
  cascada := (select count(*) from cp_viaje_referencia where viaje_id = va) = 0
         and (select count(*) from cp_cliente_referencia where cliente_id = c1) = 0
         and (select count(*) from cp_viaje_referencia where viaje_id = vb) = 1;

  if not (def = false and dup_regla and dup_ref and fk_cli and fk_via and malos = 4 and cascada) then
    raise exception E'REFERENCIA_0832 default-false=% regla-dup=% ref-dup=% fk-cliente=% fk-viaje=% malos=%/4 cascada=%   (esperado t/t/t/t/t/4/t)',
      (def = false), dup_regla, dup_ref, fk_cli, fk_via, malos, cascada;
  end if;
end $$;

-- ── (f) permisos ──────────────────────────────────────────────────────────
reset role;
do $$
declare r text; t text; abierto boolean := false;
begin
  foreach t in array array['public.cp_cliente_referencia', 'public.cp_viaje_referencia'] loop
    foreach r in array array['anon', 'authenticated'] loop
      if has_table_privilege(r, t, 'select,insert,update,delete') then abierto := true; end if;
    end loop;
    if not has_table_privilege('service_role', t, 'select,insert,update,delete') then abierto := true; end if;
    if not (select relrowsecurity from pg_class where oid = t::regclass) then abierto := true; end if;
  end loop;
  if abierto then
    raise exception 'REFERENCIA_0832 permisos: anon/authenticated con acceso, service_role sin él, o RLS apagada';
  end if;
end $$;

rollback;
select 'REFERENCIA_0832 OK' as resultado;
