-- ═══════════════════════════════════════════════════════════════════════════
-- 0672 — Carta Porte: correctiva de la ronda 15 sobre 0670-0671 (M1 y el replay idempotente).
--
-- NO se edita 0670 ni 0671 (ya están aplicadas): esta migración las corrige hacia adelante.
--
-- M1 — un hijo cuya huella ya existía como documento RECHAZADO, FALLIDO o PURGADO se perdía en silencio: la RPC lo
--      «reutilizaba» (`creado = false`) pero ese embarque no tenía ningún documento legible, y el archivo que la app acababa
--      de subir a Storage quedaba sin fila que lo retuviera. Ahora `cp_documento_dividir` devuelve un `accion` por hijo:
--        · creado      — nació como documento nuevo (con su ficha de linaje y su evento «recibido»);
--        · reabierto   — la huella era de un documento rechazado o fallido (o purgado en esos estados): se REABRE como
--                        `recibido` con el archivo nuevo (se reutiliza la ruta), se limpia su extracción anterior, se le
--                        pone su ficha de linaje bajo ESTE padre y queda el evento «reabierto» (visible en su línea de
--                        tiempo). El worker lo vuelve a leer y la oficina lo ve de nuevo en la bandeja;
--        · reutilizado — ya existe un documento vigente (por revisar, recibido, procesando) o ya aprobado: no se toca, solo
--                        queda el evento «duplicado_recibido» en ese documento para que se vea que el embarque volvió a llegar;
--        · sin_archivo — como «reutilizado», pero ese documento ya no tiene archivo (purgado): el archivo que la app subió
--                        no lo retiene nadie y la app debe BORRARLO (devolverlo aquí lo deja a la vista en una sola fila).
--      El evento «dividido» del padre registra además `reabiertos`, `sin_archivo` y la lista `hijos` (indice, documento_id,
--      accion), que es lo que usa el replay.
--
-- Replay idempotente (bajo): sobre un padre ya `dividido` devolvía solo los hijos con ficha (los reutilizados faltaban). Ahora
--      devuelve TODOS, leyendo la lista del evento «dividido» (y, para los padres anteriores a esta migración, las fichas).
--      En el replay `accion` es siempre «reutilizado» (nada se crea ni se borra).
--
-- Solo service_role. security invoker. Idempotente (drop if exists + create).
-- (El cierre de los `procesando` zombi, M3, va aparte en la 0676.)
-- ═══════════════════════════════════════════════════════════════════════════
drop function if exists public.cp_documento_dividir(uuid, uuid, int, jsonb, timestamptz, timestamptz);
create function public.cp_documento_dividir(
  p_tenant uuid, p_padre uuid, p_version int, p_hijos jsonb,
  p_retener_hijos timestamptz, p_retener_padre timestamptz
) returns table (indice int, documento_id uuid, creado boolean, accion text)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  pad public.cp_documento%rowtype;
  ex public.cp_documento%rowtype;
  n int;
  h jsonb;
  i int := 0;
  nuevo uuid;
  nuevos int := 0;
  reabiertos int := 0;
  sin_arch int := 0;
  huellas text[] := '{}';
  sha text;
  acc text;
  lista jsonb := '[]'::jsonb;
  previa jsonb;
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

  -- Ya dividido: idempotente. Devuelve TODOS los hijos (los del evento «dividido»; para padres anteriores a la 0672, las fichas).
  if pad.estado = 'dividido' then
    select e.detalle -> 'hijos' into previa
      from public.cp_documento_evento e
     where e.documento_id = p_padre and e.tenant_id = p_tenant and e.tipo = 'dividido'
     order by e.id desc limit 1;
    if previa is not null and jsonb_typeof(previa) = 'array' and jsonb_array_length(previa) > 0 then
      return query
        select (x ->> 'indice')::int, (x ->> 'documento_id')::uuid, false, 'reutilizado'::text
          from jsonb_array_elements(previa) x order by 1;
    else
      return query
        select e.indice, e.documento_id, false, 'reutilizado'::text from public.cp_documento_embarque e
         where e.tenant_id = p_tenant and e.padre_id = p_padre order by e.indice;
    end if;
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

    if nuevo is not null then
      nuevos := nuevos + 1;
      acc := 'creado';
      insert into public.cp_documento_embarque (documento_id, tenant_id, padre_id, huella_base, indice, total, clave)
        values (nuevo, p_tenant, p_padre, pad.sha256, i, n, left(h ->> 'clave', 120));
      insert into public.cp_documento_evento (documento_id, tenant_id, tipo, detalle)
        values (nuevo, p_tenant, 'recibido', jsonb_build_object(
          'canal', pad.canal, 'formato', 'csv', 'bytes', (h ->> 'bytes')::int, 'division', true, 'indice', i, 'total', n));
    else
      select * into ex from public.cp_documento d where d.tenant_id = p_tenant and d.sha256 = sha for update;
      nuevo := ex.id;
      if ex.estado in ('rechazado', 'fallido') then
        -- Un embarque sin documento legible: se REABRE con el archivo nuevo (misma ruta) en vez de perderse.
        acc := 'reabierto';
        reabiertos := reabiertos + 1;
        update public.cp_documento d
           set estado = 'recibido', version = d.version + 1, intentos = 0, procesando_hasta = null, ultimo_error = null,
               rechazo_motivo = null, storage_ruta = h ->> 'storage_ruta', purgado_en = null, bytes = (h ->> 'bytes')::int,
               formato = 'csv', mime = 'text/csv', retener_hasta = p_retener_hijos,
               perfil_id = null, perfil_version = null, texto_extracto = null, riesgo_inyeccion = false,
               extraccion = null, validacion = null, confianza_min = null, nivel_modelo = null, modelo = null,
               tokens_in = 0, tokens_out = 0, costo_usd = 0, abierto_en = null, revisado_por = null,
               tiempo_revision_seg = null, avisos_oficina = '{}'::jsonb, updated_at = now()
         where d.id = ex.id and d.tenant_id = p_tenant;
        insert into public.cp_documento_embarque (documento_id, tenant_id, padre_id, huella_base, indice, total, clave)
          values (ex.id, p_tenant, p_padre, pad.sha256, i, n, left(h ->> 'clave', 120))
        on conflict on constraint cp_documento_embarque_pkey do update
          set padre_id = excluded.padre_id, huella_base = excluded.huella_base, indice = excluded.indice,
              total = excluded.total, clave = excluded.clave;
        insert into public.cp_documento_evento (documento_id, tenant_id, tipo, detalle)
          values (ex.id, p_tenant, 'reabierto', jsonb_build_object(
            'origen', 'division', 'estado_previo', ex.estado, 'padre_id', p_padre, 'indice', i, 'total', n));
      else
        acc := case when ex.storage_ruta is null or ex.purgado_en is not null then 'sin_archivo' else 'reutilizado' end;
        if acc = 'sin_archivo' then sin_arch := sin_arch + 1; end if;
        insert into public.cp_documento_evento (documento_id, tenant_id, tipo, detalle)
          values (ex.id, p_tenant, 'duplicado_recibido', jsonb_build_object(
            'origen', 'division', 'estado', ex.estado, 'padre_id', p_padre, 'indice', i, 'total', n));
      end if;
    end if;
    lista := lista || jsonb_build_object('indice', i, 'documento_id', nuevo, 'accion', acc);
    indice := i; documento_id := nuevo; creado := (acc = 'creado'); accion := acc;
    return next;
  end loop;

  update public.cp_documento d
     set estado = 'dividido', version = d.version + 1, procesando_hasta = null, ultimo_error = null,
         retener_hasta = p_retener_padre, updated_at = now()
   where d.id = p_padre and d.tenant_id = p_tenant;
  insert into public.cp_documento_evento (documento_id, tenant_id, tipo, detalle)
    values (p_padre, p_tenant, 'dividido', jsonb_build_object(
      'embarques', n, 'nuevos', nuevos, 'ya_existian', n - nuevos, 'reabiertos', reabiertos, 'sin_archivo', sin_arch, 'hijos', lista));
end;
$$;
revoke all on function public.cp_documento_dividir(uuid, uuid, int, jsonb, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.cp_documento_dividir(uuid, uuid, int, jsonb, timestamptz, timestamptz) to service_role;

