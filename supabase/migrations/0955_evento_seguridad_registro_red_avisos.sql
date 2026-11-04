-- 0955 — evento_seguridad: registro con tope por huella de red, reclamo atómico de avisos y anonimización de la red (CT-SEG-11).
--
-- Tres funciones, TODAS security definer con search_path fijo, ejecutables SOLO por service_role:
--
--   registrar_evento_seguridad_red(...)  como la 0681/0683 (agrupa por ventana, tope de filas distintas, desborde, jamás descarta lo
--                                        `alta`) MÁS dos cosas: guarda ip_hash/ua y aplica un tope POR HUELLA (20 filas distintas por
--                                        (origen, tipo, severidad, ip_hash) y ventana): una sola red que rota actores no puede llenar el
--                                        cupo de todos; lo que pasa de 20 cuenta en la fila de desborde, que no lleva huella ni actor.
--   reclamar_avisos_seguridad(...)       el barrido de avisos reclama atómicamente (for update skip locked) las filas `alta` que merecen
--                                        correo: máximo 3 avisos por incidente, con 1 h de espera entre dos, y solo si hubo repeticiones
--                                        NUEVAS desde el último aviso. Solo filas ya «maduras» (60 s sin cambios) para que el correo
--                                        diga el conteo final de la ráfaga. Ventana de 24 h: el histórico previo a esta migración
--                                        NO se avisa jamás.
--   anonimizar_red_evento_seguridad(...) pone en null ip_hash y ua de lo anterior a N días (piso 7, por omisión 30). La fila del evento
--                                        sigue su retención por severidad (0680).
--
-- RETENCIÓN: la de la fila ya existe (0680: info 90 / media 180 / alta 365 días, vía mantener_ledgers); no se duplica ni se redefine.
-- Esta migración solo agrega la anonimización de los datos de red, más corta que la de la fila.
--
-- COMPATIBILIDAD: el RPC anterior `registrar_evento_seguridad` queda intacto (el código viejo sigue funcionando). El código nuevo
-- llama primero a `_red` y, si la función no existe (42883/PGRST202), cae al anterior: puede desplegarse antes o después de migrar.
-- Los tipos nuevos requieren la 0954 (check ampliado); sin ella el código degrada el tipo a `otro` con el tipo real en el detalle.
--
-- REVERSA: drop function if exists public.registrar_evento_seguridad_red(text, text, text, uuid, text, jsonb, text, text, timestamptz);
--          drop function if exists public.reclamar_avisos_seguridad(integer, integer, interval, interval, interval, timestamptz);
--          drop function if exists public.anonimizar_red_evento_seguridad(integer, timestamptz, integer);
begin;

create or replace function public.registrar_evento_seguridad_red(
  p_origen text,
  p_tipo text,
  p_severidad text default 'media',
  p_tenant uuid default null,
  p_actor text default null,
  p_detalle jsonb default null,
  p_ip_hash text default null,
  p_ua text default null,
  p_ahora timestamptz default now()
) returns text
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_ventana integer := case when p_severidad = 'alta' then 60 else 600 end;
  v_tope integer := case when p_severidad = 'alta' then 500 else 100 end;
  v_tope_huella constant integer := 20;
  v_cubeta bigint := floor(extract(epoch from p_ahora) / v_ventana);
  v_desde timestamptz := to_timestamp(v_cubeta * v_ventana);
  v_clave text;
  v_distintos integer;
  v_de_huella integer;
  v_nuevo boolean;
  v_desborde boolean := false;
  v_actor text := left(p_actor, 120);
  -- Defensa en profundidad: una huella mal formada o un ua con caracteres de control no entran.
  v_ip text := case when p_ip_hash ~ '^[0-9a-f]{32}$' then p_ip_hash else null end;
  v_ua text := nullif(left(regexp_replace(coalesce(p_ua, ''), '[[:cntrl:]]', '', 'g'), 200), '');
begin
  v_clave := md5(concat_ws('|', p_origen, p_tipo, p_severidad, coalesce(p_tenant::text, ''), coalesce(v_actor, ''),
                           coalesce(v_ip, ''), v_cubeta::text));

  if not exists (select 1 from public.evento_seguridad where clave = v_clave) then
    select count(*) into v_distintos
      from public.evento_seguridad
     where tipo = p_tipo and origen = p_origen and severidad = p_severidad
       and clave is not null and creado_en >= v_desde and creado_en < v_desde + make_interval(secs => v_ventana)
       and (detalle->>'desborde') is distinct from 'true';
    if v_distintos >= v_tope then
      v_desborde := true;
    elsif v_ip is not null then
      select count(*) into v_de_huella
        from public.evento_seguridad
       where tipo = p_tipo and origen = p_origen and severidad = p_severidad and ip_hash = v_ip
         and clave is not null and creado_en >= v_desde and creado_en < v_desde + make_interval(secs => v_ventana)
         and (detalle->>'desborde') is distinct from 'true';
      if v_de_huella >= v_tope_huella then
        v_desborde := true;
      end if;
    end if;
    if v_desborde then
      v_clave := md5(concat_ws('|', 'desborde', p_origen, p_tipo, p_severidad, v_cubeta::text));
      v_actor := null;
      v_ip := null;
      v_ua := null;
    end if;
  end if;

  insert into public.evento_seguridad as e (origen, tipo, severidad, tenant_id, actor, detalle, creado_en, clave, repeticiones, ultimo_en, ip_hash, ua)
  values (
    p_origen, p_tipo, p_severidad,
    case when v_desborde then null else p_tenant end,
    v_actor,
    case when v_desborde then jsonb_build_object('desborde', true)
         when jsonb_typeof(p_detalle) = 'object' then p_detalle - 'desborde'
         else p_detalle end,
    p_ahora, v_clave, 1, p_ahora, v_ip, v_ua)
  on conflict (clave) where clave is not null
  do update set repeticiones = e.repeticiones + 1, ultimo_en = excluded.ultimo_en
  returning (xmax = 0) into v_nuevo;

  return case when v_desborde then 'desborde' when v_nuevo then 'nuevo' else 'agrupado' end;
end $$;

comment on function public.registrar_evento_seguridad_red(text, text, text, uuid, text, jsonb, text, text, timestamptz) is
  '0955: registra un evento de Trust & Safety como la 0681/0683 y ademas guarda ip_hash/ua con tope de 20 filas distintas por huella y ventana (el excedente cuenta en la fila de desborde). Devuelve nuevo | agrupado | desborde. Solo service_role.';
revoke all on function public.registrar_evento_seguridad_red(text, text, text, uuid, text, jsonb, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.registrar_evento_seguridad_red(text, text, text, uuid, text, jsonb, text, text, timestamptz) to service_role;

create or replace function public.reclamar_avisos_seguridad(
  p_max_avisos integer default 3,
  p_limite integer default 20,
  p_ventana interval default interval '24 hours',
  p_espera interval default interval '1 hour',
  p_madurez interval default interval '60 seconds',
  p_ahora timestamptz default now()
) returns setof public.evento_seguridad
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_max integer := least(greatest(coalesce(p_max_avisos, 3), 1), 3);
  v_lim integer := least(greatest(coalesce(p_limite, 20), 1), 50);
begin
  return query
  with c as (
    select e.id
      from public.evento_seguridad e
     where e.severidad = 'alta'
       and e.avisos_enviados < v_max
       and e.repeticiones > e.repeticiones_avisadas
       and e.creado_en >= p_ahora - p_ventana
       and coalesce(e.ultimo_en, e.creado_en) <= p_ahora - p_madurez
       and (e.ultimo_aviso_en is null or e.ultimo_aviso_en <= p_ahora - p_espera)
     order by e.creado_en
     limit v_lim
     for update skip locked
  )
  update public.evento_seguridad e
     set avisos_enviados = e.avisos_enviados + 1,
         repeticiones_avisadas = e.repeticiones,
         ultimo_aviso_en = p_ahora
    from c
   where e.id = c.id
  returning e.*;
end $$;

comment on function public.reclamar_avisos_seguridad(integer, integer, interval, interval, interval, timestamptz) is
  '0955: reclama atomicamente (skip locked) las filas alta que merecen correo: maximo 3 avisos por incidente, 1 h entre dos, solo con repeticiones nuevas, solo maduras (60 s) y dentro de 24 h. Marca el aviso ANTES de enviar (como mucho 3 correos, nunca mas). Solo service_role.';
revoke all on function public.reclamar_avisos_seguridad(integer, integer, interval, interval, interval, timestamptz) from public, anon, authenticated;
grant execute on function public.reclamar_avisos_seguridad(integer, integer, interval, interval, interval, timestamptz) to service_role;

create or replace function public.anonimizar_red_evento_seguridad(
  p_dias integer default 30,
  p_ahora timestamptz default now(),
  p_lote integer default 5000
) returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_n integer;
begin
  if p_dias is null or p_dias < 7 then
    raise exception 'anonimizar_red_evento_seguridad: el plazo minimo es 7 dias (recibido %)', p_dias;
  end if;
  with c as (
    select e.id from public.evento_seguridad e
     where (e.ip_hash is not null or e.ua is not null)
       and e.creado_en < p_ahora - make_interval(days => p_dias)
     order by e.creado_en
     limit least(greatest(coalesce(p_lote, 5000), 1), 20000)
     for update skip locked
  )
  update public.evento_seguridad e set ip_hash = null, ua = null from c where e.id = c.id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

comment on function public.anonimizar_red_evento_seguridad(integer, timestamptz, integer) is
  '0955: pone en null ip_hash y ua de los eventos con mas de N dias (piso 7, por omision 30). La fila del evento sigue su retencion por severidad (0680). Devuelve cuantas filas anonimizo. Solo service_role.';
revoke all on function public.anonimizar_red_evento_seguridad(integer, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.anonimizar_red_evento_seguridad(integer, timestamptz, integer) to service_role;

commit;
