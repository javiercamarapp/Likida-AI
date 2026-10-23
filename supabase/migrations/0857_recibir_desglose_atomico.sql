-- ═══════════════════════════════════════════════════════════════════════════
-- 0857 — RECEPCIÓN ATÓMICA DEL DESGLOSE POR CORREO (Agente 1; hallazgo A35-A1-01)
--
-- REVERSA: drop function if exists public.recibir_desglose_atomico(uuid, jsonb, jsonb, jsonb, jsonb);
--
-- ── EL DEFECTO ──────────────────────────────────────────────────────────────
-- `recibirDesglose` (TypeScript) escribía en CUATRO llamadas separadas: la fila
-- de `liquidacion_externa`, el encabezado `liquidacion_desglose`, el evento y
-- las entregas `liquidacion_entrega_correo`. Un corte (límite de 60 s de la
-- función, error de base, red) entre la primera y la última dejaba la
-- liquidación guardada SIN entregas. El reintento la encontraba por clave y
-- huella, contestaba «idempotente» y nunca creaba las entregas: una nómina que
-- no se envía, en silencio, y ninguna ruta de rescate (la red de huérfanas
-- excluye lo que ya tiene encabezado; el reenvío exige un archivo previo).
--
-- ── EL ARREGLO ──────────────────────────────────────────────────────────────
-- Una función que hace las cuatro escrituras en UNA transacción (el cuerpo de
-- una función plpgsql es atómico: si algo lanza, no queda nada). Además es
-- REPARADORA: si la liquidación ya existe con la MISMA huella pero quedó a
-- medias (sin encabezado, o sin retención y sin una sola entrega), completa lo
-- que falta con inserciones idempotentes. Con la misma huella y todo completo
-- no cambia nada.
--
-- ── PARÁMETROS ──────────────────────────────────────────────────────────────
--   p_tenant       flota dueña (toda escritura y lectura lleva este tenant)
--   p_liquidacion  columnas de `liquidacion_externa` (jsonb): clave_externa,
--                  huella, sistema_origen, operador_id, folios_viaje[],
--                  viaje_ids[], periodo_desde, periodo_hasta, conceptos,
--                  total, moneda, pdf_ruta, pdf_origen, pdf_sha256
--   p_desglose     columnas de `liquidacion_desglose` (sin id ni tenant)
--   p_evento       detalle jsonb del evento `recibida`
--   p_entregas     arreglo de {rol, correo, xlsx_ruta, xlsx_sha256, disparo}
--                  (vacío si el desglose quedó retenido)
-- Devuelve jsonb {liquidacion_id, creada, reparada, entregas}.
--   · huella distinta de la guardada ⇒ lanza P0001 (el llamador ya trató la
--     «corrección»; llegar aquí es una carrera y se reintenta).
--
-- ── COMPATIBILIDAD ──────────────────────────────────────────────────────────
-- Función NUEVA; no altera tablas ni firmas existentes. El código anterior
-- sigue funcionando sin ella; el nuevo cae al camino viejo si no existe.
-- SECURITY DEFINER con search_path vacío (patrón 0787) y ejecución solo de
-- service_role: el tenant llega por parámetro, no por sesión. Las FKs
-- compuestas (id, tenant_id) siguen impidiendo colgar filas de otra flota.
-- Idempotente: `create or replace`.
-- ═══════════════════════════════════════════════════════════════════════════

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

  -- Entregas: solo si no está retenido. Idempotentes por el índice único
  -- (liquidación, generación, rol, lower(correo)).
  select exists (select 1 from public.liquidacion_entrega_correo e
                  where e.tenant_id = p_tenant and e.liquidacion_externa_id = v_id)
    into v_hay_entr;
  if not coalesce(v_retenida, false) and jsonb_array_length(p_entregas) > 0 then
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
  '0857: crea en UNA transacción la liquidación externa, su encabezado, el evento recibida y las entregas por correo; si la liquidación ya existe con la misma huella a medias (corte previo), completa lo que falta. Misma clave con otra huella lanza P0001. Solo service_role.';

revoke all on function public.recibir_desglose_atomico(uuid, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.recibir_desglose_atomico(uuid, jsonb, jsonb, jsonb, jsonb)
  to service_role;
