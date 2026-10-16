\set ON_ERROR_STOP on
-- 0793 — CARTA PORTE: catálogos SAT (tabla global cp_sat_catalogo).
--
-- Lo que SOLO la base puede demostrar (todo dentro de una transacción revertida):
--   (a) la tabla nace VACÍA (sin seed);
--   (b) la PK (catalogo, clave) rechaza duplicados, y el mismo código en otro catálogo sí cabe;
--   (c) la reimportación idempotente: upsert sobre la PK deja una sola fila y actualiza la descripción;
--   (d) CHECK de dominio: catálogo sin prefijo c_, clave vacía, extra que no es objeto, vigencia al revés;
--   (e) permisos: anon/authenticated sin acceso (ni lectura); service_role sí; RLS encendida.
-- Datos sintéticos.
begin;

do $$
begin
  if (select count(*) from public.cp_sat_catalogo) <> 0 then
    raise exception 'SATCAT_0793 la tabla debía nacer vacía';
  end if;
end $$;

set local role service_role;

do $$
declare
  pk_dup boolean := false; otro_catalogo boolean; idem boolean; desc_nueva boolean;
  malos int := 0; n int;
begin
  insert into cp_sat_catalogo (catalogo, clave, descripcion) values ('c_ClaveProdServCP', '24012099', 'Producto sintetico');
  begin
    insert into cp_sat_catalogo (catalogo, clave, descripcion) values ('c_ClaveProdServCP', '24012099', 'otra');
  exception when unique_violation then pk_dup := true; end;
  insert into cp_sat_catalogo (catalogo, clave, descripcion) values ('c_TipoEmbalaje', '24012099', 'mismo codigo, otro catalogo');
  otro_catalogo := true;

  -- reimportación idempotente
  insert into cp_sat_catalogo (catalogo, clave, descripcion, extra, vigente_desde)
    values ('c_ClaveProdServCP', '24012099', 'Descripcion actualizada', '{"k":1}'::jsonb, date '2020-01-01')
    on conflict (catalogo, clave) do update set descripcion = excluded.descripcion, extra = excluded.extra,
      vigente_desde = excluded.vigente_desde, updated_at = now();
  select count(*) into n from cp_sat_catalogo where catalogo = 'c_ClaveProdServCP';
  idem := n = 1;
  select descripcion = 'Descripcion actualizada' into desc_nueva from cp_sat_catalogo where catalogo = 'c_ClaveProdServCP';

  -- CHECKs
  begin insert into cp_sat_catalogo (catalogo, clave) values ('ClaveSinPrefijo', 'x'); exception when check_violation then malos := malos + 1; end;
  begin insert into cp_sat_catalogo (catalogo, clave) values ('c_Pais', '   '); exception when check_violation then malos := malos + 1; end;
  begin insert into cp_sat_catalogo (catalogo, clave, extra) values ('c_Pais', 'MEX', '[1]'::jsonb); exception when check_violation then malos := malos + 1; end;
  begin insert into cp_sat_catalogo (catalogo, clave, vigente_desde, vigente_hasta) values ('c_Pais', 'MEX', date '2024-01-01', date '2023-01-01'); exception when check_violation then malos := malos + 1; end;
  begin insert into cp_sat_catalogo (catalogo, clave, descripcion) values ('c_Pais', 'MEX', repeat('x', 1001)); exception when check_violation then malos := malos + 1; end;
  -- válidos
  insert into cp_sat_catalogo (catalogo, clave, vigente_desde, vigente_hasta) values ('c_Pais', 'MEX', date '2023-01-01', date '2023-01-01');
  insert into cp_sat_catalogo (catalogo, clave) values ('c_CodigoPostal', '01000');

  if not (pk_dup and otro_catalogo and idem and desc_nueva and malos = 5) then
    raise exception E'SATCAT_0793 pk-dup=% otro-catalogo=% idempotente=% descripcion-nueva=% checks=%/5   (esperado t/t/t/t/5)',
      pk_dup, otro_catalogo, idem, desc_nueva, malos;
  end if;
end $$;

-- ── (e) permisos ──────────────────────────────────────────────────────────
reset role;
do $$
declare r text; abierto boolean := false;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if has_table_privilege(r, 'public.cp_sat_catalogo', 'select') or has_table_privilege(r, 'public.cp_sat_catalogo', 'insert,update,delete') then
      abierto := true;
    end if;
  end loop;
  if not has_table_privilege('service_role', 'public.cp_sat_catalogo', 'select,insert,update,delete') then abierto := true; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.cp_sat_catalogo'::regclass) then abierto := true; end if;
  if abierto then
    raise exception 'SATCAT_0793 permisos: authenticated/anon con acceso, service_role sin él, o RLS apagada';
  end if;
end $$;

rollback;
select 'SATCAT_0793 OK' as resultado;
