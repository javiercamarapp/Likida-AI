-- ═══════════════════════════════════════════════════════════════════════════
-- 0671 — Carta Porte: partir un documento con N embarques en N hijos, de una sola vez.
--
-- `cp_documento_dividir` es el ÚNICO camino de un documento a 'dividido' y corre en una transacción: o nacen todos los
-- hijos, sus fichas de linaje, sus eventos y el padre queda 'dividido', o no pasa nada. Eso evita dos fallas:
--   · un padre «dividido» al que le faltan hijos (un embarque perdido en silencio, justo lo que se quiere arreglar);
--   · hijos huérfanos y un padre que se vuelve a extraer y los duplica.
--
-- Reglas:
--   · Solo parte un documento 'procesando' cuya `version` es la que el worker reclamó (`p_version`): si otro lo
--     terminó, lo purgó o su lease venció y lo tomó otro, no devuelve nada (el llamador lo trata como «perdí el lease»).
--   · Ya 'dividido' = IDEMPOTENTE: devuelve sus hijos sin tocar nada (un reintento tras una caída no duplica).
--   · Cada hijo es un documento más con SU huella (sha256 de su archivo derivado): si esa huella ya existe en la flota
--     (alguien subió antes ese mismo embarque suelto) NO se duplica ni se le cuelga linaje ajeno: devuelve el existente
--     con `creado = false`.
--   · 2 a 100 hijos, índices 1..n sin huecos, las huellas distintas entre sí.
--
-- Solo service_role. security invoker. Idempotente (create or replace).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.cp_documento_dividir(
  p_tenant uuid, p_padre uuid, p_version int, p_hijos jsonb,
  p_retener_hijos timestamptz, p_retener_padre timestamptz
) returns table (indice int, documento_id uuid, creado boolean)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  pad public.cp_documento%rowtype;
  n int;
  h jsonb;
  i int := 0;
  nuevo uuid;
  existente uuid;
  nuevos int := 0;
  huellas text[] := '{}';
  sha text;
begin
  if p_hijos is null or jsonb_typeof(p_hijos) <> 'array' then
    raise exception 'cp_documento_dividir: p_hijos debe ser un arreglo';
  end if;
  n := jsonb_array_length(p_hijos);
  if n < 2 or n > 100 then
    raise exception 'cp_documento_dividir: de 2 a 100 hijos (llegaron %)', n;
  end if;

  select * into pad from public.cp_documento d where d.id = p_padre and d.tenant_id = p_tenant for update;
  if not found then
    raise exception 'cp_documento_dividir: el documento no existe en esta flota' using errcode = 'P0002';
  end if;

  -- Ya dividido: idempotente. Devuelve los hijos que tiene (los que nacieron aquí; los reutilizados no llevan ficha).
  if pad.estado = 'dividido' then
    return query
      select e.indice, e.documento_id, false from public.cp_documento_embarque e
       where e.tenant_id = p_tenant and e.padre_id = p_padre order by e.indice;
    return;
  end if;
  if pad.estado <> 'procesando' or pad.version <> p_version or pad.purgado_en is not null then
    return;
  end if;

  for h in select * from jsonb_array_elements(p_hijos) loop
    i := i + 1;
    sha := h ->> 'sha256';
    if sha is null or sha !~ '^[0-9a-f]{64}$' then
      raise exception 'cp_documento_dividir: el hijo % no trae una huella sha256 válida', i;
    end if;
    if sha = any (huellas) then
      raise exception 'cp_documento_dividir: dos hijos con la misma huella (el hijo %)', i;
    end if;
    huellas := huellas || sha;
    if (h ->> 'indice')::int is distinct from i then
      raise exception 'cp_documento_dividir: los índices deben ir de 1 a n sin huecos (el hijo % trae %)', i, h ->> 'indice';
    end if;
  end loop;

  i := 0;
  for h in select * from jsonb_array_elements(p_hijos) loop
    i := i + 1;
    sha := h ->> 'sha256';
    nuevo := null;
    insert into public.cp_documento (
      id, tenant_id, canal, formato, nombre_archivo, mime, bytes, sha256, storage_ruta, cliente_id,
      remitente, asunto, remitente_reconocido, retener_hasta
    ) values (
      coalesce((h ->> 'id')::uuid, gen_random_uuid()), p_tenant, pad.canal, 'csv', left(h ->> 'nombre', 255), 'text/csv',
      (h ->> 'bytes')::int, sha, h ->> 'storage_ruta', pad.cliente_id,
      pad.remitente, pad.asunto, pad.remitente_reconocido, p_retener_hijos
    )
    on conflict (tenant_id, sha256) do nothing
    returning id into nuevo;

    if nuevo is null then
      select d.id into existente from public.cp_documento d where d.tenant_id = p_tenant and d.sha256 = sha;
      indice := i; documento_id := existente; creado := false;
      return next;
    else
      nuevos := nuevos + 1;
      insert into public.cp_documento_embarque (documento_id, tenant_id, padre_id, huella_base, indice, total, clave)
        values (nuevo, p_tenant, p_padre, pad.sha256, i, n, left(h ->> 'clave', 120));
      insert into public.cp_documento_evento (documento_id, tenant_id, tipo, detalle)
        values (nuevo, p_tenant, 'recibido', jsonb_build_object(
          'canal', pad.canal, 'formato', 'csv', 'bytes', (h ->> 'bytes')::int, 'division', true, 'indice', i, 'total', n));
      indice := i; documento_id := nuevo; creado := true;
      return next;
    end if;
  end loop;

  update public.cp_documento d
     set estado = 'dividido', version = d.version + 1, procesando_hasta = null, ultimo_error = null,
         retener_hasta = p_retener_padre, updated_at = now()
   where d.id = p_padre and d.tenant_id = p_tenant;
  insert into public.cp_documento_evento (documento_id, tenant_id, tipo, detalle)
    values (p_padre, p_tenant, 'dividido', jsonb_build_object('embarques', n, 'nuevos', nuevos, 'ya_existian', n - nuevos));
end;
$$;
revoke all on function public.cp_documento_dividir(uuid, uuid, int, jsonb, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.cp_documento_dividir(uuid, uuid, int, jsonb, timestamptz, timestamptz) to service_role;
