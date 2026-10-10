-- ═══════════════════════════════════════════════════════════════════════════
-- 0678 — Peajes: correctiva de la ronda 17 sobre 0665 (cursos).
--
-- NO se edita 0665 (ya aplicada): esta migración la corrige hacia adelante.
--
-- 1. RE-IMPORTAR YA NO REACTIVA lo que la flota desactivó. La 0665 hacía `activo = true` en el `on conflict` de
--    `peaje_curso_reemplazar`: el curso que la flota dio de baja a mano para dejar de reclamar con él volvía a encenderse con
--    el siguiente import desde la tabla, sin avisar. DECISIÓN: la importación actualiza los datos del curso (nombre, unidad,
--    convenio, vigencia, corredor, casetas) pero RESPETA `activo`; un curso NUEVO nace activo. Para reactivar uno desactivado,
--    la flota lo hace a mano (el mismo gesto que lo desactivó). Documentado también en `cursos_importar.ts`.
-- 2. REVOKE explícito sobre `peaje_curso` y `peaje_curso_caseta`. La 0665 encendió RLS sin políticas (deny-all) pero dejó los
--    grants por defecto de Supabase (authenticated: select/insert, anon: select). Defensa en profundidad, como las tablas
--    vecinas: solo service_role las toca.
--
-- Idempotente (create or replace + revoke/grant repetibles).
-- ═══════════════════════════════════════════════════════════════════════════
revoke all on table public.peaje_curso from public, anon, authenticated;
revoke all on table public.peaje_curso_caseta from public, anon, authenticated;
grant select, insert, update, delete on table public.peaje_curso to service_role;
grant select, insert, update, delete on table public.peaje_curso_caseta to service_role;

create or replace function public.peaje_curso_reemplazar(p_tenant uuid, p_cursos jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_item jsonb; v_id uuid; v_nuevo boolean; v_creados integer := 0; v_actualizados integer := 0; v_casetas jsonb; v_c text; v_orden integer;
begin
  if p_tenant is null or p_cursos is null or jsonb_typeof(p_cursos) <> 'array' then
    return jsonb_build_object('estado', 'invalida');
  end if;
  if jsonb_array_length(p_cursos) > 500 then
    raise exception 'un lote admite hasta 500 cursos' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_cursos) loop
    v_casetas := coalesce(v_item->'casetas', '[]'::jsonb);
    -- Un `return` aquí dejaría guardados los cursos anteriores del lote: se lanza y el handler de abajo revierte TODO.
    if jsonb_typeof(v_casetas) <> 'array' or jsonb_array_length(v_casetas) > 200 then
      raise exception 'casetas invalidas' using errcode = 'PC001';
    end if;
    -- Un curso de casetas sin casetas autorizaría nada: no se guarda (un corredor no lleva casetas).
    if (v_item->>'tipo') = 'casetas' and jsonb_array_length(v_casetas) = 0 then
      raise exception 'curso de casetas sin casetas' using errcode = 'PC001';
    end if;
    if (v_item->>'tipo') = 'corredor' and jsonb_array_length(v_casetas) > 0 then
      raise exception 'un corredor no lleva casetas' using errcode = 'PC001';
    end if;

    insert into public.peaje_curso
      (tenant_id, codigo, nombre, tipo, unidad_id, convenio_id, vigente_desde, vigente_hasta, corredor, buffer_m, activo)
    values (
      p_tenant, v_item->>'codigo', v_item->>'nombre', v_item->>'tipo',
      nullif(v_item->>'unidad_id', '')::uuid, nullif(v_item->>'convenio_id', '')::uuid,
      nullif(v_item->>'vigente_desde', '')::date, nullif(v_item->>'vigente_hasta', '')::date,
      case when jsonb_typeof(v_item->'corredor') = 'array' then v_item->'corredor' else null end,
      nullif(v_item->>'buffer_m', '')::integer, true
    )
    on conflict (tenant_id, codigo) do update set
      nombre = excluded.nombre, tipo = excluded.tipo, unidad_id = excluded.unidad_id, convenio_id = excluded.convenio_id,
      vigente_desde = excluded.vigente_desde, vigente_hasta = excluded.vigente_hasta, corredor = excluded.corredor,
      buffer_m = excluded.buffer_m, actualizado_en = now()   -- `activo` NO se toca: respeta la baja manual (0678)
    returning id, (xmax = 0) into v_id, v_nuevo;
    if v_nuevo then v_creados := v_creados + 1; else v_actualizados := v_actualizados + 1; end if;

    delete from public.peaje_curso_caseta where curso_id = v_id and tenant_id = p_tenant;
    v_orden := 0;
    for v_c in select jsonb_array_elements_text(v_casetas) loop
      insert into public.peaje_curso_caseta (curso_id, caseta_id, tenant_id, orden)
        values (v_id, v_c::uuid, p_tenant, v_orden)
        on conflict (curso_id, caseta_id) do nothing;
      v_orden := v_orden + 1;
    end loop;
  end loop;
  return jsonb_build_object('estado', 'ok', 'creados', v_creados, 'actualizados', v_actualizados);
exception
  when foreign_key_violation then return jsonb_build_object('estado', 'referencia_invalida');
  when sqlstate 'PC001' or check_violation or not_null_violation or invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range
    then return jsonb_build_object('estado', 'invalida');
end;
$$;

revoke all on function public.peaje_curso_reemplazar(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.peaje_curso_reemplazar(uuid, jsonb) to service_role;
