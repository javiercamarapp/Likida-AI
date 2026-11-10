-- 1000 · Baja del personal de Likida (superadmin y vendedor) con el candado EN LA BASE. PROPUESTA de la sub-entrega 4b: pendiente de
-- revisión del dueño y de aplicación. Sin ella, src/lib/auth/baja_acceso.ts cae a un camino de aplicación (cuenta, escribe, recuenta
-- y revierte). Con ella, el recuento del "último superadmin" y el UPDATE corren en la misma transacción bajo un candado, como 0846.
begin;

create or replace function public.equipo_baja_personal_likida(p_usuario uuid, p_actor uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rol text;
  v_otros int;
  v_filas int;
begin
  if p_usuario = p_actor then
    return 'uno_mismo';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('personal_likida', 0));

  select rol into v_rol
    from public.app_user
   where id = p_usuario and tenant_id is null and rol in ('superadmin', 'vendedor') and activo = true;
  if v_rol is null then
    return 'conflicto';
  end if;

  if v_rol = 'superadmin' then
    select count(*) into v_otros
      from public.app_user
     where tenant_id is null and rol = 'superadmin' and activo = true and id <> p_usuario;
    if v_otros = 0 then
      return 'ultimo_superadmin';
    end if;
  end if;

  update public.app_user
     set activo = false, desactivado_en = now(), desactivado_por = p_actor
   where id = p_usuario and tenant_id is null and activo = true;
  get diagnostics v_filas = row_count;
  if v_filas = 0 then
    return 'conflicto';
  end if;
  return 'ok';
end;
$$;
comment on function public.equipo_baja_personal_likida is
  '1000: baja de superadmin/vendedor (tenant_id nulo) con candado de transaccion: nunca uno mismo, nunca el ultimo superadmin activo. Devuelve ok | uno_mismo | ultimo_superadmin | conflicto. Ban de Auth y bitacora viven en TypeScript (baja_acceso.ts).';
revoke all on function public.equipo_baja_personal_likida(uuid, uuid) from public, anon, authenticated;
grant execute on function public.equipo_baja_personal_likida(uuid, uuid) to service_role;

commit;
