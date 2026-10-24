-- REVERSA: drop trigger if exists vigia_datos_personales_por_arco on public.operador; drop function if exists public.vigia_datos_personales_por_arco(); drop function if exists public.purgar_vigia_datos_personales(integer, integer, date); y volver a aplicar el cuerpo de vigia_aviso_transicion de supabase/migrations/0797_vigia_aviso.sql (create or replace). Ninguna tabla cambia.
-- ═══════════════════════════════════════════════════════════════════════════
-- 0892 · Vigía: datos personales del operador con ARCO y retención (A37-A4-07)
--
-- `vigia_dato_viaje_manual` (0796) guarda nombre, licencia y teléfono de un operador y `vigia_aviso.texto` (0797) el nombre
-- que salió en cada aviso; `programa_despacho_fila.comentarios` es texto libre de la oficina. La cancelación ARCO
-- (`ejecutar_arco_cancelacion`) ANONIMIZA al operador —no lo borra— y por eso no disparaba la cascada de la 0796; y nada
-- recortaba estas tablas con el tiempo. Esta migración, ADITIVA:
--
--   1. Disparador sobre `operador.anonimizado_en` (mismo patrón que 0380/0861: sin reescribir el ejecutor ARCO): vacía en la
--      captura manual los datos del operador (por id, por teléfono o por el nombre que tenía antes), y reemplaza el texto
--      de los avisos de esa flota que lo nombraban. Se conservan placas, estados e instantes (no identifican a la persona).
--   2. `purgar_vigia_datos_personales(p_dias, p_limite, p_hoy)`: retención por plazo contado desde la FECHA DE LA CITA de la
--      fila del programa (default 90 días, mínimo 30; es un PARÁMETRO PROPUESTO: lo fija el aviso de privacidad de cada
--      flota). Vacía nombre/licencia/teléfono de la captura, el texto de los avisos ya cerrados y los comentarios libres.
--      No borra filas, cambios ni avisos: la historia operativa (qué cambió y cuándo) se conserva.
--   3. `vigia_aviso_transicion` (0797) deja pasar SOLO el cambio del campo `texto` de un aviso cerrado cuando lo pide una de
--      estas dos funciones (variable de transacción `likida.vigia_redactar`); cualquier otra edición de la historia sigue
--      prohibida. Es la misma función de la 0797 con ese único añadido.
--
-- Idempotente: create or replace / drop trigger if exists. Todo es SECURITY DEFINER con search_path fijo y solo service_role.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.vigia_aviso_transicion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id or new.fila_id is distinct from old.fila_id
     or new.huella is distinct from old.huella or new.version is distinct from old.version then
    raise exception 'vigia_aviso: tenant, fila, huella y versión no se editan (cree otra versión)' using errcode = '23514';
  end if;
  if old.estado in ('enviado', 'descartado', 'reemplazado') then
    -- única excepción: borrar al cliente suelta el vínculo (ON DELETE SET NULL de la llave foránea) sin tocar el contenido
    if new.cliente_id is null and old.cliente_id is not null and to_jsonb(new) - 'cliente_id' = to_jsonb(old) - 'cliente_id' then
      return new;
    end if;
    -- 0892: redacción por ARCO o retención. Solo cambia `texto` (y la marca de actualización); nada más.
    if coalesce(current_setting('likida.vigia_redactar', true), '') = '1'
       and to_jsonb(new) - 'texto' - 'actualizado_en' = to_jsonb(old) - 'texto' - 'actualizado_en' then
      return new;
    end if;
    raise exception 'vigia_aviso: un aviso % es historia y no se edita', old.estado using errcode = '23514';
  end if;
  if new.estado is distinct from old.estado then
    if not (
      (old.estado = 'borrador'               and new.estado in ('pendiente_confirmacion', 'aprobado', 'sin_destinatario', 'descartado', 'reemplazado'))
      or (old.estado = 'pendiente_confirmacion' and new.estado in ('aprobado', 'sin_destinatario', 'descartado', 'reemplazado'))
      or (old.estado = 'sin_destinatario'     and new.estado in ('pendiente_confirmacion', 'descartado', 'reemplazado'))
      or (old.estado = 'aprobado'             and new.estado in ('enviado', 'fallido', 'descartado', 'reemplazado'))
      or (old.estado = 'fallido'              and new.estado in ('aprobado', 'descartado', 'reemplazado'))
    ) then
      raise exception 'vigia_aviso: transición % → % no válida', old.estado, new.estado using errcode = '23514';
    end if;
  end if;
  -- el arriendo solo vive mientras el aviso está aprobado
  if new.estado <> 'aprobado' then
    new.reclamo_token := null;
    new.reclamo_expira_en := null;
  end if;
  new.actualizado_en := clock_timestamp();
  return new;
end;
$$;
revoke all on function public.vigia_aviso_transicion() from public, anon, authenticated;

-- ── 1. Cancelación ARCO del operador ────────────────────────────────────────
create or replace function public.vigia_datos_personales_por_arco()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_nombre text := nullif(lower(btrim(old.nombre)), '');
  v_digitos text := regexp_replace(coalesce(old.telefono, ''), '\D', '', 'g');
begin
  if not (old.anonimizado_en is null and new.anonimizado_en is not null) then
    return null;
  end if;
  perform set_config('likida.vigia_redactar', '1', true);

  update public.vigia_dato_viaje_manual m
     set operador_id = null, operador_nombre = null, licencia = null, licencia_vence = null, telefono = null, en = now()
   where m.tenant_id = new.tenant_id
     and (m.operador_id = new.id
          or (v_nombre is not null and lower(btrim(m.operador_nombre)) = v_nombre)
          or (length(v_digitos) >= 10 and m.telefono is not null and right(m.telefono, 10) = right(v_digitos, 10)));

  -- Los avisos solo guardan el texto: la única forma de encontrarlos es por el nombre que tenía el operador. Un nombre
  -- demasiado corto coincidiría con cualquier cosa y se omite (el plazo de retención los alcanza igual).
  if v_nombre is not null and char_length(v_nombre) >= 4 then
    update public.vigia_aviso a
       set texto = '[texto retirado por solicitud ARCO]'
     where a.tenant_id = new.tenant_id
       and a.texto <> '[texto retirado por solicitud ARCO]'
       and position(v_nombre in lower(a.texto)) > 0;
  end if;
  return null;
end $$;
revoke all on function public.vigia_datos_personales_por_arco() from public, anon, authenticated;

drop trigger if exists vigia_datos_personales_por_arco on public.operador;
create trigger vigia_datos_personales_por_arco
  after update of anonimizado_en on public.operador
  for each row execute function public.vigia_datos_personales_por_arco();

-- ── 2. Retención ────────────────────────────────────────────────────────────
-- Devuelve cuántas filas vació en total (captura + avisos + comentarios); `p_limite` aplica a cada una de las tres.
create or replace function public.purgar_vigia_datos_personales(
  p_dias integer default 90, p_limite integer default 5000, p_hoy date default current_date
) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_n integer := 0;
  v_k integer;
begin
  if p_dias is null or p_dias < 30 or p_limite is null or p_limite < 1 or p_hoy is null then
    raise exception 'parámetros de retención inválidos' using errcode = '22023';
  end if;
  perform set_config('likida.vigia_redactar', '1', true);

  with viejos as (
    select m.id from public.vigia_dato_viaje_manual m
      join public.programa_despacho_fila f on f.id = m.fila_id and f.tenant_id = m.tenant_id
     where f.fecha < p_hoy - p_dias
       and (m.operador_nombre is not null or m.licencia is not null or m.licencia_vence is not null or m.telefono is not null)
     order by m.id limit p_limite
  )
  update public.vigia_dato_viaje_manual m
     set operador_nombre = null, licencia = null, licencia_vence = null, telefono = null, en = now()
    from viejos v where m.id = v.id;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  with viejos as (
    select a.id from public.vigia_aviso a
      join public.programa_despacho_fila f on f.id = a.fila_id and f.tenant_id = a.tenant_id
     where f.fecha < p_hoy - p_dias
       and a.estado in ('enviado', 'fallido', 'descartado', 'reemplazado', 'sin_destinatario')
       and a.texto not in ('[texto retirado por retención]', '[texto retirado por solicitud ARCO]')
     order by a.id limit p_limite
  )
  update public.vigia_aviso a
     set texto = '[texto retirado por retención]'
    from viejos v where a.id = v.id;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  with viejos as (
    select f.id from public.programa_despacho_fila f
     where f.fecha < p_hoy - p_dias and f.comentarios is not null
     order by f.id limit p_limite
  )
  update public.programa_despacho_fila f
     set comentarios = null
    from viejos v where f.id = v.id;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  return v_n;
end $$;
revoke all on function public.purgar_vigia_datos_personales(integer, integer, date) from public, anon, authenticated;
grant execute on function public.purgar_vigia_datos_personales(integer, integer, date) to service_role;

comment on function public.purgar_vigia_datos_personales(integer, integer, date) is
  '0892: retención (default 90 días desde la fecha de la cita, mínimo 30; plazo PROPUESTO) de datos personales del Vigía: vacía nombre/licencia/teléfono de la captura manual, el texto de los avisos cerrados y los comentarios libres del programa. No borra filas ni la historia de cambios. Solo service_role.';
comment on function public.vigia_datos_personales_por_arco() is
  '0892: al marcar operador.anonimizado_en (cancelación ARCO) retira del Vigía los datos personales del operador: captura manual y texto de los avisos que lo nombran.';
