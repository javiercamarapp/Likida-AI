\set ON_ERROR_STOP on
-- 0830 — CARTA PORTE: catálogo de distancias origen→destino por cliente.
--
-- Lo que SOLO la base puede demostrar, contra Postgres real (todo dentro de una transacción revertida):
--
--   (a) la tabla nace VACÍA (sin seed de datos reales);
--   (b) ruta duplicada por (flota, cliente, tipo, origen, destino) rechazada; la misma ruta en otro cliente, en otra
--       flota, con otro tipo o en sentido contrario, no (la distancia es dirigida);
--   (c) un cliente de OTRA flota no cuelga (FK compuesta);
--   (d) CHECK de dominio: tipo inválido, km cero o negativo o fuera de rango, CP de forma inválida (corto, letras),
--       municipio vacío, con espacios en los bordes o con mayúsculas; los válidos se admiten;
--   (e) borrar el cliente (ARCO / retención) borra sus rutas en cascada; borrar al usuario deja updated_by en NULL;
--   (f) permisos: anon/authenticated sin acceso; service_role sí; RLS encendida.
-- Datos sintéticos (dominio .invalid).
begin;

insert into public.tenant (id, nombre) values
  ('83000000-0000-4000-8000-0000000000a1', 'Flota A 0830'),
  ('83000000-0000-4000-8000-0000000000b1', 'Flota B 0830');
insert into public.app_user (id, tenant_id, email, rol) values
  ('83000000-0000-4000-8000-0000000000c1', '83000000-0000-4000-8000-0000000000a1', 'dist-0830@test.invalid', 'flota_admin');
insert into public.cliente (id, tenant_id, nombre) values
  ('83000000-0000-4000-8000-0000000000d1', '83000000-0000-4000-8000-0000000000a1', 'Cliente Sintetico 1'),
  ('83000000-0000-4000-8000-0000000000d2', '83000000-0000-4000-8000-0000000000a1', 'Cliente Sintetico 2'),
  ('83000000-0000-4000-8000-0000000000e1', '83000000-0000-4000-8000-0000000000b1', 'Cliente Sintetico B');

-- ── (a) nace vacía ────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from public.cp_distancia) <> 0 then
    raise exception 'DISTANCIAS_0830 la tabla debía nacer vacía';
  end if;
end $$;

set local role service_role;

do $$
declare
  ta constant uuid := '83000000-0000-4000-8000-0000000000a1';
  tb constant uuid := '83000000-0000-4000-8000-0000000000b1';
  c1 constant uuid := '83000000-0000-4000-8000-0000000000d1';
  c2 constant uuid := '83000000-0000-4000-8000-0000000000d2';
  cb constant uuid := '83000000-0000-4000-8000-0000000000e1';
  usr constant uuid := '83000000-0000-4000-8000-0000000000c1';
  dup boolean := false; otro_cliente boolean; otra_flota boolean; otro_tipo boolean; sentido boolean;
  fk_ajeno boolean := true;
  malos int := 0; buenos int := 0;
  cascada boolean; upd_null boolean; n int;
begin
  -- ── (b) unicidad ──
  insert into cp_distancia (tenant_id, cliente_id, tipo, origen, destino, km, updated_by) values (ta, c1, 'cp', '64000', '78000', 812.35, usr);
  begin
    insert into cp_distancia (tenant_id, cliente_id, tipo, origen, destino, km) values (ta, c1, 'cp', '64000', '78000', 900);
  exception when unique_violation then dup := true; end;
  insert into cp_distancia (tenant_id, cliente_id, tipo, origen, destino, km) values (ta, c2, 'cp', '64000', '78000', 812.35);
  otro_cliente := true;
  insert into cp_distancia (tenant_id, cliente_id, tipo, origen, destino, km) values (tb, cb, 'cp', '64000', '78000', 812.35);
  otra_flota := true;
  insert into cp_distancia (tenant_id, cliente_id, tipo, origen, destino, km) values (ta, c1, 'municipio', 'monterrey', 'laredo', 230);
  insert into cp_distancia (tenant_id, cliente_id, tipo, origen, destino, km) values (ta, c1, 'municipio', 'laredo', 'monterrey', 230);
  otro_tipo := true;
  insert into cp_distancia (tenant_id, cliente_id, tipo, origen, destino, km) values (ta, c1, 'cp', '78000', '64000', 812.35);
  sentido := true;

  -- ── (c) cliente de otra flota ──
  begin
    insert into cp_distancia (tenant_id, cliente_id, tipo, origen, destino, km) values (ta, cb, 'cp', '11111', '22222', 10);
    fk_ajeno := false;
  exception when foreign_key_violation then null; end;

  -- ── (d) dominio ──
  for n in 1..10 loop
    begin
      insert into cp_distancia (tenant_id, cliente_id, tipo, origen, destino, km) values (ta, c2,
        (array['via','cp','cp','cp','cp','cp','municipio','municipio','municipio','municipio'])[n],
        (array['a','64000','64000','6400','640a0','64000','','monterrey ','Monterrey','monterrey'])[n],
        (array['b','78000','78000','78000','78000','78001','laredo','laredo','laredo',repeat('x', 121)])[n],
        (array[10, 0, -5, 10, 10, 100000, 10, 10, 10, 10])[n]);
    exception when check_violation or numeric_value_out_of_range then malos := malos + 1; end;
  end loop;
  -- válidos: dos decimales, municipio con espacio interno, km máximo
  insert into cp_distancia (tenant_id, cliente_id, tipo, origen, destino, km) values (ta, c2, 'cp', '01000', '99999', 0.01); buenos := buenos + 1;
  insert into cp_distancia (tenant_id, cliente_id, tipo, origen, destino, km) values (ta, c2, 'municipio', 'san nicolas de los garza', 'nuevo laredo', 99999.99); buenos := buenos + 1;

  -- ── (e) cascada y updated_by ──
  delete from public.app_user where id = usr;
  select updated_by is null into upd_null from cp_distancia where tenant_id = ta and cliente_id = c1 and tipo = 'cp' and origen = '64000' and destino = '78000';
  delete from public.cliente where id = c1 and tenant_id = ta;
  select count(*) = 0 into cascada from cp_distancia where cliente_id = c1;
  -- las rutas del otro cliente no se tocaron (la de 64000→78000 y las dos válidas)
  select count(*) into n from cp_distancia where cliente_id = c2;
  cascada := cascada and n = 3;

  if not (dup and otro_cliente and otra_flota and otro_tipo and sentido and fk_ajeno and malos = 10 and buenos = 2 and upd_null and cascada) then
    raise exception E'DISTANCIAS_0830 ruta-dup=% otro-cliente=% otra-flota=% otro-tipo=% sentido-contrario=% fk-ajena-rebota=% malos=%/10 buenos=%/2 updated_by-null=% cascada=%   (esperado t/t/t/t/t/t/10/2/t/t)',
      dup, otro_cliente, otra_flota, otro_tipo, sentido, fk_ajeno, malos, buenos, upd_null, cascada;
  end if;
end $$;

-- ── (f) permisos ──────────────────────────────────────────────────────────
reset role;
do $$
declare r text; abierto boolean := false;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if has_table_privilege(r, 'public.cp_distancia', 'select,insert,update,delete') then abierto := true; end if;
  end loop;
  if not has_table_privilege('service_role', 'public.cp_distancia', 'select,insert,update,delete') then abierto := true; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.cp_distancia'::regclass) then abierto := true; end if;
  if abierto then
    raise exception 'DISTANCIAS_0830 permisos: anon/authenticated con acceso, service_role sin él, o RLS apagada';
  end if;
end $$;

rollback;
select 'DISTANCIAS_0830 OK' as resultado;
