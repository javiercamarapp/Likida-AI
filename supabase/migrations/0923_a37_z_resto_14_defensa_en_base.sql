-- REVERSA: (1) volver a aplicar el cuerpo de `conductor_indicadores` de 0853_tablero_validacion_degradada.sql, el de `equipo_desactivar_usuario` de 0846_equipo_candado_ultimo_dueno.sql y el de `recibir_desglose_atomico` de 0857_recibir_desglose_atomico.sql (create or replace misma firma + revoke/grant); (2) `grant select on table public.conector_credencial to authenticated; grant select on table public.rastreo_credencial to authenticated;` (el SELECT de tabla completa subsume los de columna). Ninguna tabla ni columna cambia; no hay datos que reponer.
-- ═══════════════════════════════════════════════════════════════════════════
-- 0923 — AUDITORÍA 37, lote M-Z-resto-14: cuatro endurecimientos de BASE,
-- todos ADITIVOS, IDEMPOTENTES y COMPATIBLES HACIA ATRÁS con el código
-- desplegado (producción en 0866): ninguno cambia una firma, un tipo de
-- retorno ni una columna; el código de hoy sigue funcionando con la migración
-- puesta o sin ella.
--
--  1. A37-S63-03 · `conductor_indicadores` (0853): `validacion_degradada` no
--     contaba la llegada RECIBIDA que NO tiene fila en `viaje_hito_validacion`
--     (capturada por la oficina, o cuyo registro de validación falló): el LEFT
--     JOIN deja `val.*` en NULL y la condición era NULL, o sea «ni validada ni
--     degradada» justo donde no se validó nada. Se añade
--     `or val.viaje_hito_id is null`. (La prueba 0853 trataba ese caso como
--     «barrido pendiente, no cuenta»: el validador escribe `sin_dato` en el
--     acto —validar_hito.ts— y el barrido solo MEJORA un veredicto ya
--     escrito, así que una llegada sin fila no es «pendiente», es «sin
--     evidencia»; la prueba se actualiza.)
--
--  2. A37-S63-02 · `equipo_desactivar_usuario` (0846) confiaba en
--     `p_rol_actual` del llamador y su UPDATE no lo anclaba (a diferencia de
--     `equipo_cambiar_rol`): con la flota de un solo dueño A y un contador B,
--     si B es ascendido y A degradado entre la lectura del rol y la RPC, la
--     baja de B entraba con `p_rol_actual = 'contador'`, se saltaba el
--     recuento y dejaba CERO dueños activos. El UPDATE exige ahora
--     `u.rol = p_rol_actual` y devuelve `conflicto` si el rol ya cambió (el
--     llamador ya sabe tratar `conflicto`: es el resultado de «ya estaba
--     inactivo»).
--
--  3. A37-S63-08 · `recibir_desglose_atomico` (0857): (a) `viaje_ids` es un
--     `uuid[]` sin FK y la función no lo validaba, pese a que la cabecera de
--     la 0857 dice que las FKs impiden colgar filas de otra flota: al CREAR
--     la liquidación se exige ahora que cada viaje sea de `p_tenant`
--     (errcode 23503; el llamador de hoy ya resuelve `viajeIds` por tenant,
--     así que no cambia nada para él); (b) un reenvío con la misma huella
--     agregaba entregas de generación 1 a un destinatario NUEVO si la
--     configuración de destinatarios cambió entre dos entregas del mismo
--     desglose: ahora solo se insertan entregas cuando la liquidación aún
--     NO tiene ninguna (la reparación de un corte a medias sigue
--     funcionando: ahí no hay entregas todavía).
--
--  4. A37-S63-04 · defensa en profundidad de lo cifrado:
--     `conector_credencial.valores_cifrados` y `rastreo_credencial.
--     token_cifrado` son blobs que, según sus propias migraciones, jamás
--     vuelven al panel; la 0841 los dejó con policy de SELECT para un
--     `flota_admin` con su JWT por PostgREST. Se quita el SELECT de ESA
--     columna a `authenticated` (el resto de la tabla se sigue leyendo).
--     Todo uso en `src/` es `supabaseAdmin()` (service_role, intacto).
--     NO SE TOCA `insight_linea_base` (0805): su policy `for all` es DISEÑO
--     documentado y probado (el administrador recaptura su línea base con su
--     propio JWT; supabase/tests/0805), y todavía no existe la pantalla que
--     decidiría si esa captura debe pasar por el servidor con bitácora. Eso
--     es decisión de producto, no se adivina aquí (queda en «pendientes»).
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. A37-S63-03 ───────────────────────────────────────────────────────────
create or replace function public.conductor_indicadores(
  p_tenant uuid, p_desde timestamptz, p_hasta timestamptz,
  p_terminal uuid default null, p_cliente uuid default null, p_operador uuid default null
) returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'recibidos', count(*) filter (where h.estado in ('recibido', 'validado')),
    'sin_insistencia', count(*) filter (where h.estado in ('recibido', 'validado') and h.recordatorios_enviados <= 1 and h.escalado_en is null),
    'con_respuesta_medida', count(*) filter (where h.estado in ('recibido', 'validado') and h.solicitado_en is not null and h.recibido_en >= h.solicitado_en),
    'minutos_respuesta_promedio', round((avg(extract(epoch from (h.recibido_en - h.solicitado_en)) / 60.0)
        filter (where h.estado in ('recibido', 'validado') and h.solicitado_en is not null and h.recibido_en >= h.solicitado_en))::numeric, 1),
    'escalados', count(*) filter (where h.escalado_en is not null),
    'omitidos', count(*) filter (where h.estado = 'omitido'),
    'validados_ubicacion', count(*) filter (where val.resultado = 'validado'),
    'sin_coincidencia', count(*) filter (where val.resultado = 'sin_coincidencia'),
    'capturados_oficina', count(*) filter (where h.fuente = 'oficina'),
    -- 0853: de las llegadas VALIDABLES por ubicación (las únicas que validar_hito.ts compara: las salidas nunca se
    -- validan), cuántas corrieron en modo DEGRADADO — 'sin_dato' (sin geocerca o sin ubicación con qué comparar) o
    -- 'validado' SOLO con el pin que el chofer elige a mano (sin GPS real en la ventana).
    -- 0923 (A37-S63-03): y las que NO tienen fila de validación (capturadas por la oficina, o cuyo registro falló):
    -- sin evidencia de ubicación también es modo degradado.
    'llegadas_validables', count(*) filter (
      where h.tipo in ('llegada_carga', 'llegada_descarga') and h.estado in ('recibido', 'validado')
    ),
    'validacion_degradada', count(*) filter (
      where h.tipo in ('llegada_carga', 'llegada_descarga') and h.estado in ('recibido', 'validado')
        and (val.viaje_hito_id is null or val.resultado = 'sin_dato' or (val.resultado = 'validado' and val.fuente = 'pin'))
    )
  )
  from public.viaje_hito h
  join public.viaje v on v.id = h.viaje_id and v.tenant_id = h.tenant_id
  left join public.viaje_hito_validacion val on val.viaje_hito_id = h.id and val.ciclo = h.ciclo
  where h.tenant_id = p_tenant
    and h.updated_at >= p_desde and h.updated_at < p_hasta
    and (p_terminal is null or v.terminal_id = p_terminal)
    and (p_cliente is null or v.cliente_id = p_cliente)
    and (p_operador is null or v.operador_id = p_operador)
$$;
revoke all on function public.conductor_indicadores(uuid, timestamptz, timestamptz, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.conductor_indicadores(uuid, timestamptz, timestamptz, uuid, uuid, uuid) to service_role;

-- ── 2. A37-S63-02 ───────────────────────────────────────────────────────────
create or replace function public.equipo_desactivar_usuario(
  p_tenant uuid, p_usuario uuid, p_rol_actual text, p_actor uuid
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_otros int;
  v_filas int;
begin
  perform pg_advisory_xact_lock(hashtextextended('equipo:' || p_tenant::text, 0));

  if p_rol_actual = 'flota_admin' then
    select count(*) into v_otros
      from public.app_user
     where tenant_id = p_tenant and rol = 'flota_admin' and activo = true and id <> p_usuario;
    if v_otros = 0 then
      return 'ultimo_dueno';
    end if;
  end if;

  -- 0923 (A37-S63-02): el UPDATE ancla el rol que el recuento de arriba dio por bueno (como equipo_cambiar_rol):
  -- si el rol cambió entre la lectura del llamador y esta función, NO se da de baja con un recuento que no aplica.
  update public.app_user u
     set activo = false, desactivado_en = now(), desactivado_por = p_actor
   where u.id = p_usuario and u.tenant_id = p_tenant and u.activo = true and u.rol = p_rol_actual;
  get diagnostics v_filas = row_count;
  if v_filas = 0 then
    return 'conflicto';
  end if;
  return 'ok';
end;
$$;
comment on function public.equipo_desactivar_usuario is
  '0846 + 0923: da de baja (activo=false) a alguien del equipo, con el mismo candado y recuento atómico que equipo_cambiar_rol; el UPDATE ancla el rol esperado (0923, A37-S63-02) para que un cambio de rol concurrente no deje la flota sin dueño. El ban de Auth y la bitácora siguen en TypeScript (usuarios_escritura.ts). Devuelve ok | ultimo_dueno | conflicto.';
revoke all on function public.equipo_desactivar_usuario(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.equipo_desactivar_usuario(uuid, uuid, text, uuid) to service_role;

-- ── 3. A37-S63-08 ───────────────────────────────────────────────────────────
create or replace function public.recibir_desglose_atomico(
  p_tenant      uuid,
  p_liquidacion jsonb,
  p_desglose    jsonb,
  p_evento      jsonb,
  p_entregas    jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id          uuid;
  v_huella      text;
  v_nueva       boolean := false;
  v_reparada    boolean := false;
  v_desg_nuevo  boolean := false;
  v_n_entregas  integer := 0;
  v_tiene_desg  boolean;
  v_retenida    boolean;
  v_hay_entr    boolean;
begin
  if p_tenant is null then
    raise exception 'p_tenant no puede ser nulo';
  end if;
  if p_liquidacion is null or jsonb_typeof(p_liquidacion) <> 'object'
     or p_desglose is null or jsonb_typeof(p_desglose) <> 'object' then
    raise exception 'p_liquidacion y p_desglose deben ser objetos';
  end if;
  if p_entregas is null or jsonb_typeof(p_entregas) <> 'array' then
    raise exception 'p_entregas debe ser un arreglo';
  end if;

  -- 0923 (A37-S63-08): `viaje_ids` no tiene FK. Al CREAR la liquidación, cada viaje tiene que ser de la flota. (Si la
  -- liquidación ya existe, es un reintento: no se revalida contra viajes que pudieron borrarse después.)
  if not exists (select 1 from public.liquidacion_externa l
                  where l.tenant_id = p_tenant and l.clave_externa = p_liquidacion->>'clave_externa')
     and exists (
       select 1
         from unnest(coalesce(array(select jsonb_array_elements_text(p_liquidacion->'viaje_ids')), '{}'::text[])::uuid[]) as vid
        where not exists (select 1 from public.viaje v where v.id = vid and v.tenant_id = p_tenant)
     ) then
    raise exception 'recibir_desglose_atomico: viaje_ids contiene viajes que no son de la flota' using errcode = '23503';
  end if;

  insert into public.liquidacion_externa (
    tenant_id, clave_externa, huella, sistema_origen, operador_id, folios_viaje, viaje_ids,
    periodo_desde, periodo_hasta, conceptos, total, moneda, pdf_ruta, pdf_origen, pdf_sha256
  ) values (
    p_tenant,
    p_liquidacion->>'clave_externa',
    p_liquidacion->>'huella',
    p_liquidacion->>'sistema_origen',
    (p_liquidacion->>'operador_id')::uuid,
    coalesce(array(select jsonb_array_elements_text(p_liquidacion->'folios_viaje')), '{}'::text[]),
    coalesce(array(select jsonb_array_elements_text(p_liquidacion->'viaje_ids')), '{}'::text[])::uuid[],
    (p_liquidacion->>'periodo_desde')::date,
    (p_liquidacion->>'periodo_hasta')::date,
    p_liquidacion->'conceptos',
    (p_liquidacion->>'total')::numeric,
    p_liquidacion->>'moneda',
    p_liquidacion->>'pdf_ruta',
    p_liquidacion->>'pdf_origen',
    p_liquidacion->>'pdf_sha256'
  )
  on conflict (tenant_id, clave_externa) do nothing
  returning id into v_id;

  if v_id is not null then
    v_nueva := true;
  else
    -- Ya existía (reintento o carrera). Se bloquea la fila para que dos
    -- reparaciones simultáneas no compitan.
    select l.id, l.huella into v_id, v_huella
      from public.liquidacion_externa l
     where l.tenant_id = p_tenant and l.clave_externa = p_liquidacion->>'clave_externa'
       for update;
    if v_id is null then
      raise exception 'liquidacion_externa desapareció durante la recepción';
    end if;
    if v_huella <> p_liquidacion->>'huella' then
      raise exception 'recibir_desglose_atomico: la clave ya existe con otro contenido' using errcode = 'P0001';
    end if;
  end if;

  -- Encabezado: PK por liquidación, así que reintentar no duplica ni pisa.
  select exists (select 1 from public.liquidacion_desglose d
                  where d.tenant_id = p_tenant and d.liquidacion_externa_id = v_id)
    into v_tiene_desg;
  if not v_tiene_desg then
    insert into public.liquidacion_desglose (
      liquidacion_externa_id, tenant_id, bitacora, terminal, poliza, unidad, tipo_operador, dias,
      total_origen, retenida_motivo, numero_liquidacion, numero_pago, bitacoras
    ) values (
      v_id, p_tenant,
      p_desglose->>'bitacora', p_desglose->>'terminal', p_desglose->>'poliza', p_desglose->>'unidad',
      p_desglose->>'tipo_operador', (p_desglose->>'dias')::smallint,
      p_desglose->>'total_origen', left(p_desglose->>'retenida_motivo', 1000),
      p_desglose->>'numero_liquidacion', p_desglose->>'numero_pago',
      case when jsonb_typeof(p_desglose->'bitacoras') = 'array'
           then array(select jsonb_array_elements_text(p_desglose->'bitacoras')) end
    )
    on conflict (liquidacion_externa_id) do nothing;
    v_desg_nuevo := found;
    v_retenida := (p_desglose->>'retenida_motivo') is not null;
  else
    select (d.retenida_motivo is not null) into v_retenida
      from public.liquidacion_desglose d
     where d.tenant_id = p_tenant and d.liquidacion_externa_id = v_id;
  end if;

  if v_nueva or v_desg_nuevo then
    insert into public.liquidacion_externa_evento (liquidacion_externa_id, tenant_id, tipo, detalle)
    values (v_id, p_tenant, 'recibida', coalesce(p_evento, '{}'::jsonb));
  end if;

  -- Entregas: solo si no está retenido Y la liquidación aún no tiene NINGUNA (0923, A37-S63-08): un reintento con la
  -- misma huella pero otros destinatarios no le agrega un correo a alguien nuevo dentro de la misma generación.
  -- Idempotentes por el índice único (liquidación, generación, rol, lower(correo)).
  select exists (select 1 from public.liquidacion_entrega_correo e
                  where e.tenant_id = p_tenant and e.liquidacion_externa_id = v_id)
    into v_hay_entr;
  if not coalesce(v_retenida, false) and not v_hay_entr and jsonb_array_length(p_entregas) > 0 then
    insert into public.liquidacion_entrega_correo (
      tenant_id, liquidacion_externa_id, generacion, rol, correo, xlsx_ruta, xlsx_sha256, disparo
    )
    select p_tenant, v_id, 1, e->>'rol', lower(btrim(e->>'correo')), e->>'xlsx_ruta', e->>'xlsx_sha256',
           coalesce(e->>'disparo', 'auto')
      from jsonb_array_elements(p_entregas) e
    on conflict do nothing;
    get diagnostics v_n_entregas = row_count;
  end if;

  v_reparada := (not v_nueva) and (v_desg_nuevo or (v_n_entregas > 0 and not v_hay_entr));

  return jsonb_build_object(
    'liquidacion_id', v_id, 'creada', v_nueva, 'reparada', v_reparada, 'entregas', v_n_entregas
  );
end;
$$;

comment on function public.recibir_desglose_atomico(uuid, jsonb, jsonb, jsonb, jsonb) is
  '0857 + 0923: crea en UNA transacción la liquidación externa, su encabezado, el evento recibida y las entregas por correo; si la liquidación ya existe con la misma huella a medias (corte previo), completa lo que falta. 0923: al crear exige que viaje_ids sean de la flota (23503) y no agrega entregas a una liquidación que ya tiene alguna. Misma clave con otra huella lanza P0001. Solo service_role.';

revoke all on function public.recibir_desglose_atomico(uuid, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.recibir_desglose_atomico(uuid, jsonb, jsonb, jsonb, jsonb)
  to service_role;

-- ── 4. A37-S63-04: las columnas cifradas no salen por PostgREST ────────────
-- Un REVOKE de columna no sirve mientras exista un GRANT de tabla; por eso se retira el SELECT de tabla y se vuelve a
-- dar SOLO sobre las demás columnas (las leídas por la RLS de 0841 siguen igual). Dinámico para no listar a mano
-- columnas que otras migraciones hayan añadido; idempotente (revoke/grant repetidos son inocuos).
do $$
declare
  v_t   text;
  v_col text;
  v_cols text;
begin
  for v_t, v_col in
    select * from (values ('conector_credencial', 'valores_cifrados'), ('rastreo_credencial', 'token_cifrado')) as x(t, c)
  loop
    if to_regclass('public.' || v_t) is null then continue; end if;
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_cols
      from pg_attribute a
     where a.attrelid = ('public.' || v_t)::regclass and a.attnum > 0 and not a.attisdropped and a.attname <> v_col;
    execute format('revoke select on table public.%I from authenticated', v_t);
    execute format('grant select (%s) on table public.%I to authenticated', v_cols, v_t);
  end loop;
end $$;

commit;
