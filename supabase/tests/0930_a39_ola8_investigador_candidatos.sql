\set ON_ERROR_STOP on
-- 0930 — A39-S28-01: prospectos_sin_dossier salta a los ya investigados sin importar cuántos sean, reintenta el provisional vencido
-- y respeta el tope de intentos, los duplicados y los estados cerrados.
begin;

-- 2,500 prospectos viejos YA con dossier (más que el tope de escaneo del código anterior) y luego los candidatos.
insert into public.prospecto (id, empresa, estado, created_at)
select ('93000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'Empresa ' || g, 'nuevo', timestamptz '2026-01-01' + (g || ' minutes')::interval
  from generate_series(1, 2500) g;
insert into public.prospecto_dossier (prospecto_id, datos, fuentes)
select id, '[{"dato":"Opera 20 camiones","fuente":"x"}]'::jsonb, '[]'::jsonb from public.prospecto where empresa ~ '^Empresa [0-9]+$';

insert into public.prospecto (id, empresa, estado, created_at) values
  ('93000000-0000-4000-8000-0000000a0001', 'Sin dossier A', 'nuevo',      timestamptz '2026-06-01'),
  ('93000000-0000-4000-8000-0000000a0002', 'Sin dossier B', 'contactado', timestamptz '2026-06-02'),
  ('93000000-0000-4000-8000-0000000a0003', 'Provisional vencido', 'nuevo', timestamptz '2026-06-03'),
  ('93000000-0000-4000-8000-0000000a0004', 'Provisional reciente', 'nuevo', timestamptz '2026-06-04'),
  ('93000000-0000-4000-8000-0000000a0005', 'Provisional agotado', 'nuevo', timestamptz '2026-06-05'),
  ('93000000-0000-4000-8000-0000000a0006', 'Cerrado sin dossier', 'perdido', timestamptz '2026-06-06');
insert into public.prospecto (id, empresa, estado, created_at, duplicado_de) values
  ('93000000-0000-4000-8000-0000000a0007', 'Duplicado sin dossier', 'nuevo', timestamptz '2026-06-07', '93000000-0000-4000-8000-0000000a0001');
insert into public.prospecto_dossier (prospecto_id, datos, fuentes, investigado_en) values
  ('93000000-0000-4000-8000-0000000a0003', '[{"dato":"SITIO_NO_RESPONDIO|1|x","fuente":""}]', '[]', now() - interval '2 days'),
  ('93000000-0000-4000-8000-0000000a0004', '[{"dato":"SITIO_NO_RESPONDIO|1|x","fuente":""}]', '[]', now() - interval '1 hour'),
  ('93000000-0000-4000-8000-0000000a0005', '[{"dato":"SITIO_NO_RESPONDIO|5|x","fuente":""}]', '[]', now() - interval '2 days');

do $$
declare ids uuid[];
begin
  select array_agg(id order by ord) into ids from (select id, row_number() over () ord from public.prospectos_sin_dossier(10)) t;
  if ids is distinct from array[
    '93000000-0000-4000-8000-0000000a0001'::uuid,
    '93000000-0000-4000-8000-0000000a0002'::uuid,
    '93000000-0000-4000-8000-0000000a0003'::uuid] then
    raise exception '0930: candidatos inesperados: %', ids;
  end if;
  if (select count(*) from public.prospectos_sin_dossier(2)) <> 2 then raise exception '0930: no respeta p_limite'; end if;
  if (select count(*) from public.prospectos_sin_dossier(null)) <> 3 then raise exception '0930: p_limite null debe usar el valor por omisión'; end if;
  -- datos NULL o con forma rara no rompen: el dossier cuenta como hecho.
  update public.prospecto_dossier set datos = null where prospecto_id = '93000000-0000-4000-8000-0000000a0004';
  update public.prospecto_dossier set datos = '{"a":1}'::jsonb where prospecto_id = '93000000-0000-4000-8000-0000000a0005';
  if (select count(*) from public.prospectos_sin_dossier(10)) <> 3 then raise exception '0930: datos con forma rara cambió el resultado'; end if;
end $$;

-- Permisos: solo service_role.
do $$
begin
  if has_function_privilege('anon', 'public.prospectos_sin_dossier(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.prospectos_sin_dossier(integer)', 'execute') then
    raise exception '0930: anon/authenticated pueden ejecutar prospectos_sin_dossier';
  end if;
  if not has_function_privilege('service_role', 'public.prospectos_sin_dossier(integer)', 'execute') then
    raise exception '0930: service_role no puede ejecutar prospectos_sin_dossier';
  end if;
end $$;

rollback;
