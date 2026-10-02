-- 0683 — `registrar_evento_seguridad`: el cast de `detalle.desborde` deja de poder romper el alta (ronda 15, bajo).
--
-- La 0681 contaba las filas distintas con `(detalle->>'desborde')::boolean`: un `detalle` que trajera la llave `desborde` con
-- un valor que no es booleano ("si", 1, un objeto) hacía fallar ese cast en TODA alta nueva del mismo (origen, tipo, severidad)
-- dentro de la ventana (ERROR: invalid input syntax for type boolean). Hoy ningún llamador manda esa llave: era latente.
--
-- Correctiva (la 0681 ya está aplicada y no se edita), en dos candados:
--   · la comparación no hace cast: `(detalle->>'desborde') is distinct from 'true'` (un texto cualquiera nunca revienta);
--   · la llave `desborde` es RESERVADA: solo la fila de desborde que arma la propia función la lleva; a una alta normal se le
--     quita del `detalle` (si es un objeto), así un llamador no puede ni disfrazar su fila de desborde ni sacarla del conteo.
--
-- Va DESPUÉS de la 0682 a propósito: si llevara un número entre la 0672 y la 0681, la 0681 (que redefine la misma función) correría
-- después y desharía este arreglo. Mismo contrato y firma que la 0681. Idempotente (create or replace).
begin;

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
       and (detalle->>'desborde') is distinct from 'true';
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
    case when v_desborde then jsonb_build_object('desborde', true)
         when jsonb_typeof(p_detalle) = 'object' then p_detalle - 'desborde'
         else p_detalle end,
    p_ahora, v_clave, 1, p_ahora)
  on conflict (clave) where clave is not null
  do update set repeticiones = e.repeticiones + 1, ultimo_en = excluded.ultimo_en
  returning (xmax = 0) into v_nuevo;

  return case when v_desborde then 'desborde' when v_nuevo then 'nuevo' else 'agrupado' end;
end $$;

comment on function public.registrar_evento_seguridad(text, text, text, uuid, text, jsonb, timestamptz) is
  '0681/0683: registra un evento de Trust & Safety AGRUPANDO por ventana (60 s lo alta, 10 min lo demás) y con tope de filas distintas por (origen, tipo, severidad) y ventana; el excedente se cuenta en una fila de desborde. Devuelve nuevo | agrupado | desborde. Lo crítico (alta) nunca se descarta: se agrupa o se cuenta. La llave detalle.desborde es reservada. Solo service_role.';
revoke all on function public.registrar_evento_seguridad(text, text, text, uuid, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.registrar_evento_seguridad(text, text, text, uuid, text, jsonb, timestamptz) to service_role;

commit;
