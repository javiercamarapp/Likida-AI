-- 0681 — PROTECCIÓN CONTRA EL FLOOD DE evento_seguridad (Ola 9, seguridad; auditoría ola 1 #20).
--
-- Los webhooks públicos escribían UNA fila por cada petición con firma inválida: quien conoce la
-- URL podía llenar la tabla (y el disco) a la velocidad de su conexión, y el panel de Trust & Safety
-- se ahogaba en ruido. Esta migración mueve el registro a una RPC que AGRUPA por ventana:
--
--   · Misma señal (origen, tipo, severidad, flota, actor) dentro de la misma ventana = UNA fila
--     con `repeticiones` y `ultimo_en`. Nada se pierde: el conteo y el primer/último instante quedan.
--     Ventana de 60 s para lo `alta` y de 10 min para lo `media`/`info`.
--   · Tope de filas DISTINTAS por (origen, tipo, severidad) y ventana: 500 las `alta`, 100 el resto.
--     Pasado el tope, lo excedente se cuenta en UNA fila de desborde (`detalle.desborde = true`,
--     sin actor) en vez de abrir una fila nueva por cada actor que rota.
--   · LO CRÍTICO NO SE DESCARTA JAMÁS: ni una `alta` se tira en ningún camino. Se agrupa (primera fila
--     intacta + conteo) o cae en la fila de desborde con su conteo; el contador sube siempre.
--
-- Ventanas fijas (por cubeta de tiempo) y no deslizantes: la clave es determinista, así que el
-- `insert … on conflict` es atómico y no necesita lock ni lectura previa para ser correcto.
-- El tope de distintos es SUAVE (cuenta antes de insertar): bajo carrera puede pasarse por un puñado
-- de filas, jamás por miles. Solo service_role; el cliente cae a un insert directo si la RPC aún no existe.
begin;

alter table public.evento_seguridad
  add column if not exists clave text,
  add column if not exists repeticiones integer not null default 1,
  add column if not exists ultimo_en timestamptz;

do $$ begin
  alter table public.evento_seguridad
    add constraint evento_seguridad_repeticiones_positivas check (repeticiones >= 1);
exception when duplicate_object then null; end $$;

-- Una clave de agrupación por ventana. Parcial: las filas anteriores a la 0681 no tienen clave.
create unique index if not exists evento_seguridad_clave_uidx
  on public.evento_seguridad (clave) where clave is not null;

create or replace function public.registrar_evento_seguridad(
  p_origen text,
  p_tipo text,
  p_severidad text default 'media',
  p_tenant uuid default null,
  p_actor text default null,
  p_detalle jsonb default null,
  p_ahora timestamptz default now()
) returns text
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_ventana integer := case when p_severidad = 'alta' then 60 else 600 end;
  v_tope integer := case when p_severidad = 'alta' then 500 else 100 end;
  v_cubeta bigint := floor(extract(epoch from p_ahora) / v_ventana);
  v_desde timestamptz := to_timestamp(v_cubeta * v_ventana);
  v_clave text;
  v_distintos integer;
  v_nuevo boolean;
  v_desborde boolean := false;
  v_actor text := left(p_actor, 120);
begin
  v_clave := md5(concat_ws('|', p_origen, p_tipo, p_severidad, coalesce(p_tenant::text, ''), coalesce(v_actor, ''), v_cubeta::text));

  -- ¿Ya hay una fila de esta señal en la ventana? Entonces solo se cuenta.
  if not exists (select 1 from public.evento_seguridad where clave = v_clave) then
    select count(*) into v_distintos
      from public.evento_seguridad
     where tipo = p_tipo and origen = p_origen and severidad = p_severidad
       and clave is not null and creado_en >= v_desde and creado_en < v_desde + make_interval(secs => v_ventana)
       and coalesce((detalle->>'desborde')::boolean, false) = false;
    if v_distintos >= v_tope then
      v_desborde := true;
      v_clave := md5(concat_ws('|', 'desborde', p_origen, p_tipo, p_severidad, v_cubeta::text));
      v_actor := null;
    end if;
  end if;

  insert into public.evento_seguridad as e (origen, tipo, severidad, tenant_id, actor, detalle, creado_en, clave, repeticiones, ultimo_en)
  values (
    p_origen, p_tipo, p_severidad,
    case when v_desborde then null else p_tenant end,
    v_actor,
    case when v_desborde then jsonb_build_object('desborde', true) else p_detalle end,
    p_ahora, v_clave, 1, p_ahora)
  on conflict (clave) where clave is not null
  do update set repeticiones = e.repeticiones + 1, ultimo_en = excluded.ultimo_en
  returning (xmax = 0) into v_nuevo;

  return case when v_desborde then 'desborde' when v_nuevo then 'nuevo' else 'agrupado' end;
end $$;

comment on function public.registrar_evento_seguridad(text, text, text, uuid, text, jsonb, timestamptz) is
  '0681: registra un evento de Trust & Safety AGRUPANDO por ventana (60 s lo alta, 10 min lo demás) y con tope de filas distintas por (origen, tipo, severidad) y ventana; el excedente se cuenta en una fila de desborde. Devuelve nuevo | agrupado | desborde. Lo crítico (alta) nunca se descarta: se agrupa o se cuenta. Solo service_role.';
revoke all on function public.registrar_evento_seguridad(text, text, text, uuid, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.registrar_evento_seguridad(text, text, text, uuid, text, jsonb, timestamptz) to service_role;

commit;
