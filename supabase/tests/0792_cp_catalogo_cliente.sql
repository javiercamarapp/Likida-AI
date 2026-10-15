\set ON_ERROR_STOP on
-- 0792 — CARTA PORTE: catálogo maestro por cliente (número interno, productos, partes).
--
-- Lo que SOLO la base puede demostrar, contra Postgres real (todo dentro de una transacción revertida):
--
--   (a) las tres tablas nacen VACÍAS (sin seed de datos reales);
--   (b) SKU duplicado por (flota, cliente) rechazado; el mismo SKU en otro cliente o en otra flota, no;
--   (c) un solo número interno por cliente; alias duplicado por (cliente, rol) rechazado, mismo alias en otro rol, no;
--   (d) un cliente de OTRA flota no cuelga (FK compuesta) en las tres tablas;
--   (e) RFC: forma inválida rechazada (corto, largo, minúsculas, símbolos); válidos de 12 y 13 caracteres y
--       XEXX010101000 / XAXX010101000 admitidos; NULL admitido; -- grep-limpio:ok
--   (f) CHECK de dominio y de largo (rol, SKU vacío, clave peligrosa sin marca de peligroso, correo largo);
--   (g) borrar el cliente (ARCO / retención) borra su catálogo en cascada; borrar al usuario deja updated_by en NULL;
--   (h) permisos: anon/authenticated sin acceso; service_role sí.
-- Datos sintéticos (dominio .invalid).
begin;

insert into public.tenant (id, nombre) values
  ('79200000-0000-4000-8000-0000000000a1', 'Flota A 0792'),
  ('79200000-0000-4000-8000-0000000000b1', 'Flota B 0792');
insert into public.app_user (id, tenant_id, email, rol) values
  ('79200000-0000-4000-8000-0000000000c1', '79200000-0000-4000-8000-0000000000a1', 'cat-0792@test.invalid', 'flota_admin');
insert into public.cliente (id, tenant_id, nombre) values
  ('79200000-0000-4000-8000-0000000000d1', '79200000-0000-4000-8000-0000000000a1', 'Cliente Sintetico 1'),
  ('79200000-0000-4000-8000-0000000000d2', '79200000-0000-4000-8000-0000000000a1', 'Cliente Sintetico 2'),
  ('79200000-0000-4000-8000-0000000000e1', '79200000-0000-4000-8000-0000000000b1', 'Cliente Sintetico B');

-- ── (a) nacen vacías ──────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from public.cp_cliente_numero) <> 0
     or (select count(*) from public.cp_catalogo_producto) <> 0
     or (select count(*) from public.cp_catalogo_parte) <> 0 then
    raise exception 'CATALOGO_0792 las tablas debían nacer vacías';
  end if;
end $$;

set local role service_role;

do $$
declare
  ta constant uuid := '79200000-0000-4000-8000-0000000000a1';
  tb constant uuid := '79200000-0000-4000-8000-0000000000b1';
  c1 constant uuid := '79200000-0000-4000-8000-0000000000d1';
  c2 constant uuid := '79200000-0000-4000-8000-0000000000d2';
  cb constant uuid := '79200000-0000-4000-8000-0000000000e1';
  usr constant uuid := '79200000-0000-4000-8000-0000000000c1';
  sku_dup boolean := false; sku_otro_cliente boolean; sku_otra_flota boolean;
  num_dup boolean := false; alias_dup boolean := false; alias_otro_rol boolean;
  fk_ajeno boolean := true;
  rfc_malos int := 0; rfc_buenos int := 0; checks_malos int := 0;
  cascada boolean; upd_null boolean; n int;
begin
  -- ── (b) SKU ──
  insert into cp_catalogo_producto (tenant_id, cliente_id, sku, bienes_transp, clave_unidad, updated_by)
    values (ta, c1, 'SKU-001', '24012099', 'KGM', usr);
  begin
    insert into cp_catalogo_producto (tenant_id, cliente_id, sku, bienes_transp, clave_unidad)
      values (ta, c1, 'SKU-001', '24012099', 'KGM');
  exception when unique_violation then sku_dup := true; end;
  insert into cp_catalogo_producto (tenant_id, cliente_id, sku, bienes_transp, clave_unidad) values (ta, c2, 'SKU-001', '24012099', 'KGM');
  sku_otro_cliente := true;
  insert into cp_catalogo_producto (tenant_id, cliente_id, sku, bienes_transp, clave_unidad) values (tb, cb, 'SKU-001', '24012099', 'KGM');
  sku_otra_flota := true;

  -- ── (c) número interno y alias ──
  insert into cp_cliente_numero (tenant_id, cliente_id, numero_interno, numero_pagador) values (ta, c1, '10001', '10002');
  begin
    insert into cp_cliente_numero (tenant_id, cliente_id, numero_interno) values (ta, c1, '10003');
  exception when unique_violation then num_dup := true; end;
  insert into cp_catalogo_parte (tenant_id, cliente_id, rol, alias, razon_social, rfc)
    values (ta, c1, 'remitente', 'PLANTA-1', 'Empresa Sintetica SA de CV', 'XAXX010101000'); -- grep-limpio:ok
  begin
    insert into cp_catalogo_parte (tenant_id, cliente_id, rol, alias) values (ta, c1, 'remitente', 'PLANTA-1');
  exception when unique_violation then alias_dup := true; end;
  insert into cp_catalogo_parte (tenant_id, cliente_id, rol, alias) values (ta, c1, 'destinatario', 'PLANTA-1');
  alias_otro_rol := true;

  -- ── (d) cliente de otra flota no cuelga ──
  begin
    insert into cp_cliente_numero (tenant_id, cliente_id, numero_interno) values (ta, cb, '1');
    fk_ajeno := false;
  exception when foreign_key_violation then null; end;
  begin
    insert into cp_catalogo_producto (tenant_id, cliente_id, sku, bienes_transp, clave_unidad) values (ta, cb, 'X', '1', 'KGM');
    fk_ajeno := false;
  exception when foreign_key_violation then null; end;
  begin
    insert into cp_catalogo_parte (tenant_id, cliente_id, rol, alias) values (ta, cb, 'remitente', 'X');
    fk_ajeno := false;
  exception when foreign_key_violation then null; end;

  -- ── (e) RFC ──
  for n in 1..6 loop
    begin
      insert into cp_catalogo_parte (tenant_id, cliente_id, rol, alias, rfc) values (ta, c2, 'remitente', 'MALO-' || n,
        (array['ABC12345','ABC010101ABCDE','abc010101abc','AB*010101ABC','ABC01010ABC','12C010101ABC'])[n]);
    exception when check_violation then rfc_malos := rfc_malos + 1; end;
  end loop;
  for n in 1..5 loop
    insert into cp_catalogo_parte (tenant_id, cliente_id, rol, alias, rfc) values (ta, c2, 'destinatario', 'BUENO-' || n,
      (array['ABC010101AB1','ABCD010101AB1','XEXX010101000','XAXX010101000','Ñ&A010101AB1'])[n]); -- grep-limpio:ok
    rfc_buenos := rfc_buenos + 1;
  end loop;
  insert into cp_catalogo_parte (tenant_id, cliente_id, rol, alias, rfc) values (ta, c2, 'destinatario', 'SIN-RFC', null);

  -- ── (f) dominio y largo ──
  begin insert into cp_catalogo_parte (tenant_id, cliente_id, rol, alias) values (ta, c2, 'chofer', 'R'); exception when check_violation then checks_malos := checks_malos + 1; end;
  begin insert into cp_catalogo_producto (tenant_id, cliente_id, sku, bienes_transp, clave_unidad) values (ta, c2, '   ', '1', 'KGM'); exception when check_violation then checks_malos := checks_malos + 1; end;
  begin insert into cp_catalogo_producto (tenant_id, cliente_id, sku, bienes_transp, clave_unidad, clave_material_peligroso) values (ta, c2, 'P1', '1', 'KGM', '1203'); exception when check_violation then checks_malos := checks_malos + 1; end;
  begin insert into cp_catalogo_parte (tenant_id, cliente_id, rol, alias, correo) values (ta, c2, 'remitente', 'CORREO', repeat('a', 260)); exception when check_violation then checks_malos := checks_malos + 1; end;
  begin insert into cp_cliente_numero (tenant_id, cliente_id, numero_interno) values (ta, c2, repeat('9', 61)); exception when check_violation then checks_malos := checks_malos + 1; end;
  insert into cp_catalogo_producto (tenant_id, cliente_id, sku, bienes_transp, clave_unidad, material_peligroso, clave_material_peligroso)
    values (ta, c2, 'PELIGROSO', '1', 'KGM', true, '1203');

  -- ── (g) cascada y updated_by ──
  delete from public.app_user where id = usr;
  select updated_by is null into upd_null from cp_catalogo_producto where tenant_id = ta and cliente_id = c1 and sku = 'SKU-001';
  delete from public.cliente where id = c1 and tenant_id = ta;
  select count(*) = 0 into cascada from (
    select 1 from cp_cliente_numero where cliente_id = c1
    union all select 1 from cp_catalogo_producto where cliente_id = c1
    union all select 1 from cp_catalogo_parte where cliente_id = c1) x;
  -- el catálogo del otro cliente no se tocó
  select count(*) into n from cp_catalogo_producto where cliente_id = c2;
  cascada := cascada and n = 2;

  if not (sku_dup and sku_otro_cliente and sku_otra_flota and num_dup and alias_dup and alias_otro_rol and fk_ajeno
          and rfc_malos = 6 and rfc_buenos = 5 and checks_malos = 5 and upd_null and cascada) then
    raise exception E'CATALOGO_0792 sku-dup=% sku-otro-cliente=% sku-otra-flota=% numero-unico=% alias-dup=% alias-otro-rol=% fk-ajena-rebota=% rfc-malos=%/6 rfc-buenos=%/5 checks=%/5 updated_by-null=% cascada=%   (esperado t/t/t/t/t/t/t/6/5/5/t/t)',
      sku_dup, sku_otro_cliente, sku_otra_flota, num_dup, alias_dup, alias_otro_rol, fk_ajeno, rfc_malos, rfc_buenos, checks_malos, upd_null, cascada;
  end if;
end $$;

-- ── (h) permisos ──────────────────────────────────────────────────────────
reset role;
do $$
declare t text; r text; abierto boolean := false;
begin
  foreach t in array array['cp_cliente_numero', 'cp_catalogo_producto', 'cp_catalogo_parte'] loop
    foreach r in array array['anon', 'authenticated'] loop
      if has_table_privilege(r, 'public.' || t, 'select,insert,update,delete') then abierto := true; end if;
    end loop;
    if not has_table_privilege('service_role', 'public.' || t, 'select,insert,update,delete') then abierto := true; end if;
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then abierto := true; end if;
  end loop;
  if abierto then
    raise exception 'CATALOGO_0792 permisos: anon/authenticated con acceso, service_role sin él, o RLS apagada';
  end if;
end $$;

rollback;
select 'CATALOGO_0792 OK' as resultado;
