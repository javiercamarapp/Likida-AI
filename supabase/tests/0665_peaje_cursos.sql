\set ON_ERROR_STOP on
-- 0665 — peaje_curso / peaje_curso_caseta / peaje_curso_reemplazar contra Postgres REAL (sintético, rollback).
--   (a) feliz: un lote crea los cursos con sus casetas en el orden del arreglo;
--   (b) duplicado: re-aplicar el mismo lote actualiza (no duplica cursos ni casetas) y reemplaza la lista entera de casetas;
--   (c) fuera de orden: el `orden` sigue al arreglo, no al uuid ni al orden de inserción, y un curso por unidad y otro por convenio conviven;
--   (d) otra flota: unidad, convenio o caseta de otra flota → referencia_invalida y NO se escribe nada (ni los cursos previos del lote);
--   (e) fallo a media lista revierte el lote entero (curso válido + curso sin casetas);
--   (f) los CHECK de la forma (casetas con polilínea, corredor con buffer corto, curso sin a quién aplicar) rebotan;
--   (g) la FK compuesta rebota aunque se escriba directo con service_role;
--   (h) RLS prendida sin políticas, `authenticated` no lee ni escribe, y solo service_role ejecuta la función.
begin;

insert into public.tenant (id, nombre) values
  ('66500000-0000-4000-8000-0000000000a1', 'Flota A 0665'),
  ('66500000-0000-4000-8000-0000000000b1', 'Flota B 0665');
insert into public.cliente (id, tenant_id, nombre) values
  ('66500000-0000-4000-8000-0000000000c1', '66500000-0000-4000-8000-0000000000a1', 'Cliente A 0665'),
  ('66500000-0000-4000-8000-0000000000c2', '66500000-0000-4000-8000-0000000000b1', 'Cliente B 0665');
insert into public.cliente_convenio (id, tenant_id, cliente_id, nombre) values
  ('66500000-0000-4000-8000-0000000000d1', '66500000-0000-4000-8000-0000000000a1', '66500000-0000-4000-8000-0000000000c1', 'Convenio A 0665'),
  ('66500000-0000-4000-8000-0000000000d2', '66500000-0000-4000-8000-0000000000b1', '66500000-0000-4000-8000-0000000000c2', 'Convenio B 0665');
insert into public.unidad (id, tenant_id, numero_economico) values
  ('66500000-0000-4000-8000-0000000000e1', '66500000-0000-4000-8000-0000000000a1', 'A-0665'),
  ('66500000-0000-4000-8000-0000000000e2', '66500000-0000-4000-8000-0000000000b1', 'B-0665');
insert into public.peaje_caseta (id, tenant_id, nombre, nombre_norm, lat, lng) values
  ('66500000-0000-4000-8000-0000000000f1', '66500000-0000-4000-8000-0000000000a1', 'Caseta 1', 'caseta 1', 19.40, -99.10),
  ('66500000-0000-4000-8000-0000000000f2', '66500000-0000-4000-8000-0000000000a1', 'Caseta 2', 'caseta 2', 19.50, -99.20),
  ('66500000-0000-4000-8000-0000000000f3', '66500000-0000-4000-8000-0000000000a1', 'Caseta 3', 'caseta 3', 19.60, -99.30),
  ('66500000-0000-4000-8000-0000000000f9', '66500000-0000-4000-8000-0000000000b1', 'Caseta B', 'caseta b', 20.00, -100.00);

set local role service_role;
do $$
declare
  A constant uuid := '66500000-0000-4000-8000-0000000000a1';
  B constant uuid := '66500000-0000-4000-8000-0000000000b1';
  uA constant uuid := '66500000-0000-4000-8000-0000000000e1';
  uB constant uuid := '66500000-0000-4000-8000-0000000000e2';
  cvA constant uuid := '66500000-0000-4000-8000-0000000000d1';
  cvB constant uuid := '66500000-0000-4000-8000-0000000000d2';
  c1 constant uuid := '66500000-0000-4000-8000-0000000000f1';
  c2 constant uuid := '66500000-0000-4000-8000-0000000000f2';
  c3 constant uuid := '66500000-0000-4000-8000-0000000000f3';
  cB constant uuid := '66500000-0000-4000-8000-0000000000f9';
  r jsonb; n int; ids uuid[]; v_ok boolean;
begin
  -- (a) feliz
  r := public.peaje_curso_reemplazar(A, jsonb_build_array(
    jsonb_build_object('codigo', 'CUR-1', 'nombre', 'Planta A a B', 'tipo', 'casetas', 'convenio_id', cvA, 'casetas', jsonb_build_array(c3, c1, c2)),
    jsonb_build_object('codigo', 'CUR-2', 'nombre', 'Unidad A-0665', 'tipo', 'casetas', 'unidad_id', uA, 'vigente_desde', '2026-01-01', 'casetas', jsonb_build_array(c1))
  ));
  if r->>'estado' <> 'ok' or (r->>'creados')::int <> 2 or (r->>'actualizados')::int <> 0 then raise exception '0665(a): respuesta %', r; end if;
  select array_agg(caseta_id order by orden) into ids from public.peaje_curso_caseta pc join public.peaje_curso c on c.id = pc.curso_id where c.codigo = 'CUR-1' and c.tenant_id = A;
  -- (c) el orden sigue al arreglo (c3, c1, c2), no al uuid
  if ids <> array[c3, c1, c2] then raise exception '0665(c): orden de casetas %', ids; end if;
  if (select count(*) from public.peaje_curso where tenant_id = A) <> 2 then raise exception '0665(a): cursos creados'; end if;

  -- (b) duplicado: mismo lote otra vez; el CUR-1 cambia su lista
  r := public.peaje_curso_reemplazar(A, jsonb_build_array(
    jsonb_build_object('codigo', 'CUR-1', 'nombre', 'Planta A a B (v2)', 'tipo', 'casetas', 'convenio_id', cvA, 'casetas', jsonb_build_array(c2)),
    jsonb_build_object('codigo', 'CUR-2', 'nombre', 'Unidad A-0665', 'tipo', 'casetas', 'unidad_id', uA, 'vigente_desde', '2026-01-01', 'casetas', jsonb_build_array(c1))
  ));
  if r->>'estado' <> 'ok' or (r->>'creados')::int <> 0 or (r->>'actualizados')::int <> 2 then raise exception '0665(b): respuesta %', r; end if;
  if (select count(*) from public.peaje_curso where tenant_id = A) <> 2 then raise exception '0665(b): duplicó cursos'; end if;
  select array_agg(caseta_id) into ids from public.peaje_curso_caseta pc join public.peaje_curso c on c.id = pc.curso_id where c.codigo = 'CUR-1' and c.tenant_id = A;
  if ids <> array[c2] then raise exception '0665(b): la lista de casetas no se reemplazó entera: %', ids; end if;
  if (select nombre from public.peaje_curso where tenant_id = A and codigo = 'CUR-1') <> 'Planta A a B (v2)' then raise exception '0665(b): el nombre no se actualizó'; end if;
  select count(*) into n from public.peaje_curso_caseta where tenant_id = A;
  if n <> 2 then raise exception '0665(b): casetas totales % (esperadas 2)', n; end if;

  -- (d) otra flota: nada se escribe, ni el curso bueno que iba antes en el lote
  r := public.peaje_curso_reemplazar(A, jsonb_build_array(
    jsonb_build_object('codigo', 'CUR-BUENO', 'nombre', 'Bueno', 'tipo', 'casetas', 'unidad_id', uA, 'casetas', jsonb_build_array(c1)),
    jsonb_build_object('codigo', 'CUR-AJENO', 'nombre', 'Con caseta ajena', 'tipo', 'casetas', 'unidad_id', uA, 'casetas', jsonb_build_array(cB))
  ));
  if r->>'estado' <> 'referencia_invalida' then raise exception '0665(d): caseta ajena %', r; end if;
  r := public.peaje_curso_reemplazar(A, jsonb_build_array(jsonb_build_object('codigo', 'CUR-AJENO', 'nombre', 'Unidad ajena', 'tipo', 'casetas', 'unidad_id', uB, 'casetas', jsonb_build_array(c1))));
  if r->>'estado' <> 'referencia_invalida' then raise exception '0665(d): unidad ajena %', r; end if;
  r := public.peaje_curso_reemplazar(A, jsonb_build_array(jsonb_build_object('codigo', 'CUR-AJENO', 'nombre', 'Convenio ajeno', 'tipo', 'casetas', 'convenio_id', cvB, 'casetas', jsonb_build_array(c1))));
  if r->>'estado' <> 'referencia_invalida' then raise exception '0665(d): convenio ajeno %', r; end if;
  if exists (select 1 from public.peaje_curso where codigo in ('CUR-BUENO', 'CUR-AJENO')) then raise exception '0665(d): quedó escrito algo de un lote rechazado'; end if;
  -- la flota B guarda lo suyo con el mismo código sin chocar con el de A
  r := public.peaje_curso_reemplazar(B, jsonb_build_array(jsonb_build_object('codigo', 'CUR-1', 'nombre', 'De B', 'tipo', 'casetas', 'unidad_id', uB, 'casetas', jsonb_build_array(cB))));
  if r->>'estado' <> 'ok' then raise exception '0665(d): la flota B no pudo guardar %', r; end if;
  if (select nombre from public.peaje_curso where tenant_id = A and codigo = 'CUR-1') <> 'Planta A a B (v2)' then raise exception '0665(d): la flota B pisó el curso de A'; end if;

  -- (e) fallo a media lista revierte todo
  r := public.peaje_curso_reemplazar(A, jsonb_build_array(
    jsonb_build_object('codigo', 'CUR-1', 'nombre', 'No debe quedar', 'tipo', 'casetas', 'convenio_id', cvA, 'casetas', jsonb_build_array(c1, c2, c3)),
    jsonb_build_object('codigo', 'CUR-VACIO', 'nombre', 'Sin casetas', 'tipo', 'casetas', 'convenio_id', cvA, 'casetas', '[]'::jsonb)
  ));
  if r->>'estado' <> 'invalida' then raise exception '0665(e): respuesta %', r; end if;
  if (select nombre from public.peaje_curso where tenant_id = A and codigo = 'CUR-1') <> 'Planta A a B (v2)'
     or (select count(*) from public.peaje_curso_caseta pc join public.peaje_curso c on c.id = pc.curso_id where c.codigo = 'CUR-1' and c.tenant_id = A) <> 1 then
    raise exception '0665(e): el lote fallido dejó escritura a medias';
  end if;
  -- fecha ilegible → invalida, no excepción
  r := public.peaje_curso_reemplazar(A, jsonb_build_array(jsonb_build_object('codigo', 'CUR-F', 'nombre', 'Fecha mala', 'tipo', 'casetas', 'unidad_id', uA, 'vigente_desde', 'mañana', 'casetas', jsonb_build_array(c1))));
  if r->>'estado' <> 'invalida' then raise exception '0665(e): fecha ilegible %', r; end if;

  -- corredor sintético válido
  r := public.peaje_curso_reemplazar(A, jsonb_build_array(jsonb_build_object('codigo', 'COR-1', 'nombre', 'Corredor', 'tipo', 'corredor', 'unidad_id', uA, 'buffer_m', 500,
    'corredor', jsonb_build_array(jsonb_build_object('lat', 19.4, 'lng', -99.1), jsonb_build_object('lat', 19.6, 'lng', -99.3)))));
  if r->>'estado' <> 'ok' then raise exception '0665(corredor): %', r; end if;
  -- corredor con buffer corto, corredor con casetas, y casetas con polilínea: invalida
  r := public.peaje_curso_reemplazar(A, jsonb_build_array(jsonb_build_object('codigo', 'COR-2', 'nombre', 'Buffer corto', 'tipo', 'corredor', 'unidad_id', uA, 'buffer_m', 5,
    'corredor', jsonb_build_array(jsonb_build_object('lat', 19.4, 'lng', -99.1), jsonb_build_object('lat', 19.6, 'lng', -99.3)))));
  if r->>'estado' <> 'invalida' then raise exception '0665(f): buffer corto %', r; end if;
  r := public.peaje_curso_reemplazar(A, jsonb_build_array(jsonb_build_object('codigo', 'COR-3', 'nombre', 'Corredor con casetas', 'tipo', 'corredor', 'unidad_id', uA, 'buffer_m', 500,
    'corredor', jsonb_build_array(jsonb_build_object('lat', 19.4, 'lng', -99.1), jsonb_build_object('lat', 19.6, 'lng', -99.3)), 'casetas', jsonb_build_array(c1))));
  if r->>'estado' <> 'invalida' then raise exception '0665(f): corredor con casetas %', r; end if;
  r := public.peaje_curso_reemplazar(A, jsonb_build_array(jsonb_build_object('codigo', 'CUR-P', 'nombre', 'Casetas con polilinea', 'tipo', 'casetas', 'unidad_id', uA, 'casetas', jsonb_build_array(c1),
    'corredor', jsonb_build_array(jsonb_build_object('lat', 19.4, 'lng', -99.1), jsonb_build_object('lat', 19.6, 'lng', -99.3)), 'buffer_m', 500)));
  if r->>'estado' <> 'invalida' then raise exception '0665(f): casetas con polilínea %', r; end if;
  -- sin a quién aplicar
  r := public.peaje_curso_reemplazar(A, jsonb_build_array(jsonb_build_object('codigo', 'CUR-N', 'nombre', 'Sin dueño', 'tipo', 'casetas', 'casetas', jsonb_build_array(c1))));
  if r->>'estado' <> 'invalida' then raise exception '0665(f): curso sin unidad ni convenio %', r; end if;
  -- argumentos degenerados
  if public.peaje_curso_reemplazar(A, null)->>'estado' <> 'invalida' or public.peaje_curso_reemplazar(A, '{}'::jsonb)->>'estado' <> 'invalida' then raise exception '0665(f): argumentos nulos'; end if;

  -- (g) la FK compuesta rebota aunque se escriba directo
  v_ok := false;
  begin
    insert into public.peaje_curso_caseta (curso_id, caseta_id, tenant_id) select id, cB, tenant_id from public.peaje_curso where tenant_id = A and codigo = 'CUR-1';
  exception when foreign_key_violation then v_ok := true; end;
  if not v_ok then raise exception '0665(g): aceptó una caseta de otra flota por escritura directa'; end if;
  v_ok := false;
  begin
    insert into public.peaje_curso (tenant_id, codigo, nombre, tipo, unidad_id) values (A, 'DIR', 'Directo', 'casetas', uB);
  exception when foreign_key_violation then v_ok := true; end;
  if not v_ok then raise exception '0665(g): aceptó una unidad de otra flota por escritura directa'; end if;
  -- borrar la caseta del catálogo la quita del curso (cascada) sin borrar el curso
  delete from public.peaje_caseta where id = c2;
  if exists (select 1 from public.peaje_curso_caseta where caseta_id = c2) or not exists (select 1 from public.peaje_curso where tenant_id = A and codigo = 'CUR-1') then
    raise exception '0665(g): la cascada de la caseta no dejó el curso consistente';
  end if;
end $$;

-- (h) RLS y permisos
reset role;
do $$
begin
  if not (select bool_and(relrowsecurity) from pg_class where oid in ('public.peaje_curso'::regclass, 'public.peaje_curso_caseta'::regclass)) then
    raise exception '0665(h): RLS apagada';
  end if;
  if exists (select 1 from pg_policies where tablename in ('peaje_curso', 'peaje_curso_caseta')) then
    raise exception '0665(h): hay políticas; debía ser deny-all';
  end if;
end $$;

set local role authenticated;
do $$
declare n int;
begin
  -- Desde la 0678 el revoke explícito corta el SELECT de raíz (permission denied); antes bastaba la RLS sin políticas (0 filas).
  begin
    select count(*) into n from public.peaje_curso;
    if n <> 0 then raise exception '0665(h): authenticated leyó % cursos', n; end if;
  exception when insufficient_privilege then null; end;
  begin
    insert into public.peaje_curso (tenant_id, codigo, nombre, tipo, unidad_id) values ('66500000-0000-4000-8000-0000000000a1', 'X', 'X', 'casetas', '66500000-0000-4000-8000-0000000000e1');
    raise exception '0665(h): authenticated insertó un curso';
  exception when insufficient_privilege or sqlstate '42501' then null; end;
  begin perform public.peaje_curso_reemplazar('66500000-0000-4000-8000-0000000000a1', '[]'::jsonb); raise exception '0665(h): authenticated ejecutó la función';
  exception when insufficient_privilege then null; end;
end $$;
set local role anon;
do $$
begin
  begin perform public.peaje_curso_reemplazar('66500000-0000-4000-8000-0000000000a1', '[]'::jsonb); raise exception '0665(h): anon ejecutó la función';
  exception when insufficient_privilege then null; end;
end $$;

rollback;
