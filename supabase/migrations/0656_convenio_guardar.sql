-- ═══════════════════════════════════════════════════════════════════════════
-- 0656 — Convenios: alta y edición en pantalla, ATÓMICAS y con control de versión.
--
-- LOOP PUNTA A PUNTA, ola 4, P7 «convenios-edicion». Hasta hoy un convenio solo se creaba o cambiaba re-subiendo el
-- Excel. Editarlo en pantalla son varias escrituras (los datos del convenio y su lista de instrucciones, que se reemplaza
-- entera): con PostgREST serían llamadas sueltas y una falla a medias dejaba el convenio sin instrucciones. Aquí es UNA
-- función, una transacción.
--
--  1. `cliente_convenio.version` sube sola en cada UPDATE (trigger): el panel manda la versión que leyó y la función
--     rechaza el guardado si alguien más (otro jefe, o el importador del Excel) cambió el convenio entre tanto. Sin esto,
--     dos jefes editando a la vez se pisarían en silencio.
--  2. `guardar_convenio(...)` crea (p_convenio nulo) o edita. Devuelve jsonb con `estado`:
--       ok · conflicto (versión vieja) · no_existe (id ajeno o de otra flota) · duplicado (ya hay un convenio con ese nombre
--       para ese cliente) · referencia_invalida (cliente o sitio que no es de la flota) · invalida (CHECK de la 0580).
--     Al editar NO se cambia el cliente (el convenio ya puede estar ligado a viajes de ese cliente). `p_instrucciones` nulo =
--     no tocar la lista; arreglo (aun vacío) = ESA es la lista. Las que ya no vienen se borran en la misma transacción.
--     Cualquier fallo revierte todo (handler a nivel de función).
--
-- security definer, search_path vacío, solo service_role (el panel escribe por servidor con el tenant de la sesión).
-- Idempotente. No hay cambio de datos: el código que no la usa sigue funcionando.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.cliente_convenio add column if not exists version integer not null default 1;

create or replace function public.cliente_convenio_sube_version() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.version := coalesce(old.version, 1) + 1;
  return new;
end;
$$;

drop trigger if exists cliente_convenio_version on public.cliente_convenio;
create trigger cliente_convenio_version before update on public.cliente_convenio
  for each row execute function public.cliente_convenio_sube_version();

create or replace function public.guardar_convenio(
  p_tenant uuid, p_convenio uuid, p_cliente uuid, p_nombre text, p_origen text, p_destino text,
  p_origen_sitio uuid, p_destino_sitio uuid, p_desde date, p_hasta date, p_notas text,
  p_version integer, p_instrucciones jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid; v_ver integer; v_item jsonb; v_iid uuid; v_ids uuid[] := '{}'; v_creado boolean := false;
begin
  if p_instrucciones is not null and jsonb_typeof(p_instrucciones) <> 'array' then
    raise exception 'instrucciones debe ser un arreglo' using errcode = '22023';
  end if;
  if p_instrucciones is not null and jsonb_array_length(p_instrucciones) > 40 then
    raise exception 'un convenio admite hasta 40 instrucciones' using errcode = '22023';
  end if;

  if p_convenio is null then
    if p_cliente is null then return jsonb_build_object('estado', 'referencia_invalida'); end if;
    insert into public.cliente_convenio
      (tenant_id, cliente_id, nombre, origen, destino, origen_sitio_id, destino_sitio_id, vigente_desde, vigente_hasta, notas)
    values (p_tenant, p_cliente, p_nombre, p_origen, p_destino, p_origen_sitio, p_destino_sitio, p_desde, p_hasta, p_notas)
    returning id into v_id;
    v_creado := true;
  else
    select c.version into v_ver from public.cliente_convenio c
     where c.id = p_convenio and c.tenant_id = p_tenant for update;
    if not found then return jsonb_build_object('estado', 'no_existe'); end if;
    if p_version is distinct from v_ver then
      return jsonb_build_object('estado', 'conflicto', 'version', v_ver);
    end if;
    update public.cliente_convenio
       set nombre = p_nombre, origen = p_origen, destino = p_destino, origen_sitio_id = p_origen_sitio,
           destino_sitio_id = p_destino_sitio, vigente_desde = p_desde, vigente_hasta = p_hasta, notas = p_notas,
           actualizado_en = now()
     where id = p_convenio and tenant_id = p_tenant;
    v_id := p_convenio;
  end if;

  if p_instrucciones is not null then
    for v_item in select * from jsonb_array_elements(p_instrucciones) loop
      insert into public.convenio_instruccion (tenant_id, convenio_id, categoria, texto, momento, lugar, orden, activa)
      values (p_tenant, v_id, v_item->>'categoria', v_item->>'texto', coalesce(v_item->>'momento', 'ambos'),
              coalesce(v_item->>'lugar', 'ambos'), coalesce((v_item->>'orden')::integer, 0), true)
      on conflict (convenio_id, categoria, texto)
        do update set momento = excluded.momento, lugar = excluded.lugar, orden = excluded.orden, activa = true
      returning id into v_iid;
      v_ids := v_ids || v_iid;
    end loop;
    delete from public.convenio_instruccion i
     where i.convenio_id = v_id and i.tenant_id = p_tenant and not (i.id = any (v_ids));
  end if;

  select c.version into v_ver from public.cliente_convenio c where c.id = v_id;
  return jsonb_build_object('estado', 'ok', 'id', v_id, 'version', v_ver, 'creado', v_creado);
exception
  when unique_violation then return jsonb_build_object('estado', 'duplicado');
  when foreign_key_violation then return jsonb_build_object('estado', 'referencia_invalida');
  when check_violation then return jsonb_build_object('estado', 'invalida');
end;
$$;
revoke all on function public.guardar_convenio(uuid, uuid, uuid, text, text, text, uuid, uuid, date, date, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.guardar_convenio(uuid, uuid, uuid, text, text, text, uuid, uuid, date, date, text, integer, jsonb) to service_role;

comment on function public.guardar_convenio(uuid, uuid, uuid, text, text, text, uuid, uuid, date, date, text, integer, jsonb) is
  '0656: alta (p_convenio nulo) o edición atómica de un convenio y su lista de instrucciones, con control de versión (estado conflicto si cambió entre tanto).';
