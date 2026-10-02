\set ON_ERROR_STOP on
-- 0678 — PEAJES, correctiva de la ronda 17 sobre 0665. Postgres REAL, datos sintéticos, rollback.
--   (a) re-importar actualiza los datos de un curso que la flota desactivó pero NO lo reactiva; uno nuevo nace activo;
--   (b) `peaje_curso` y `peaje_curso_caseta` ya no tienen grants para anon/authenticated/public (solo service_role).
begin;

insert into public.tenant (id, nombre) values ('67800000-0000-4000-8000-0000000000a1', 'Flota A 0678');
insert into public.peaje_caseta (id, tenant_id, nombre, nombre_norm, lat, lng) values
  ('67800000-0000-4000-8000-0000000000f1', '67800000-0000-4000-8000-0000000000a1', 'Caseta 1', 'caseta 1', 19.40, -99.10);
insert into public.unidad (id, tenant_id, numero_economico) values
  ('67800000-0000-4000-8000-0000000000e1', '67800000-0000-4000-8000-0000000000a1', 'A-0678');

set local role service_role;
do $$
declare
  A constant uuid := '67800000-0000-4000-8000-0000000000a1';
  uA constant uuid := '67800000-0000-4000-8000-0000000000e1';
  k1 constant uuid := '67800000-0000-4000-8000-0000000000f1';
  r jsonb;
begin
  r := public.peaje_curso_reemplazar(A, jsonb_build_array(jsonb_build_object('codigo', 'C-1', 'nombre', 'Ruta vieja', 'tipo', 'casetas', 'unidad_id', uA, 'casetas', jsonb_build_array(k1))));
  if r ->> 'estado' <> 'ok' or not (select activo from public.peaje_curso where tenant_id = A and codigo = 'C-1') then raise exception '0678: un curso nuevo debe nacer activo (%)', r; end if;

  -- la flota lo desactiva a mano
  update public.peaje_curso set activo = false where tenant_id = A and codigo = 'C-1';

  -- re-importar: actualiza el nombre pero respeta la baja
  r := public.peaje_curso_reemplazar(A, jsonb_build_array(jsonb_build_object('codigo', 'C-1', 'nombre', 'Ruta nueva', 'tipo', 'casetas', 'unidad_id', uA, 'casetas', jsonb_build_array(k1))));
  if r ->> 'estado' <> 'ok' or (r ->> 'actualizados')::int <> 1 then raise exception '0678: el re-import no actualizó (%)', r; end if;
  if (select nombre from public.peaje_curso where tenant_id = A and codigo = 'C-1') <> 'Ruta nueva' then raise exception '0678: el re-import no actualizó el nombre'; end if;
  if (select activo from public.peaje_curso where tenant_id = A and codigo = 'C-1') then raise exception '0678: el re-import REACTIVÓ un curso que la flota desactivó'; end if;

  -- uno activo sigue activo
  r := public.peaje_curso_reemplazar(A, jsonb_build_array(jsonb_build_object('codigo', 'C-2', 'nombre', 'Otro', 'tipo', 'casetas', 'unidad_id', uA, 'casetas', jsonb_build_array(k1))));
  r := public.peaje_curso_reemplazar(A, jsonb_build_array(jsonb_build_object('codigo', 'C-2', 'nombre', 'Otro 2', 'tipo', 'casetas', 'unidad_id', uA, 'casetas', jsonb_build_array(k1))));
  if not (select activo from public.peaje_curso where tenant_id = A and codigo = 'C-2') then raise exception '0678: un curso activo debía seguir activo'; end if;
end $$;
reset role;

do $$
declare t text; p text;
begin
  foreach t in array array['public.peaje_curso', 'public.peaje_curso_caseta'] loop
    foreach p in array array['select', 'insert', 'update', 'delete'] loop
      if has_table_privilege('anon', t, p) or has_table_privilege('authenticated', t, p) or has_table_privilege('public', t, p) then
        raise exception '0678: % aún da % a anon/authenticated/public', t, p;
      end if;
    end loop;
    if not has_table_privilege('service_role', t, 'select') or not has_table_privilege('service_role', t, 'insert') then raise exception '0678: service_role perdió acceso a %', t; end if;
  end loop;
end $$;

rollback;
\echo 0678_peaje_curso_respeta_baja PASS
