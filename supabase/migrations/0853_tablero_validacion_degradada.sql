-- ═══════════════════════════════════════════════════════════════════════════
-- 0853 — Visibilidad de la validación DEGRADADA en el tablero
-- (`conductor_indicadores`, 0385).
--
-- HALLAZGO ALTO CONFIRMADO (auditoría A5 Conductor). La validación de
-- ubicación por GPS solo aplica a `llegada_carga`/`llegada_descarga`
-- (`src/lib/likida/conductor/validar_hito.ts:13-16`); las SALIDAS nunca se
-- validan. Sin geocerca configurada el veredicto siempre es 'sin_dato'.
-- Cuando la unidad no reporta GPS activo, "el pin ES la única evidencia
-- posible" y el pin "lo ELIGE el chofer" (`validar_hito.ts:97-101`) — no es
-- la posición real del tractor. Hasta esta migración, NINGUNA métrica de
-- 'sin_dato'/'aproximada' se exponía en `tablero.ts`: operaciones no tenía
-- manera de saber cuánta de su validación de ubicación corre en modo
-- DEGRADADO (sin GPS real) frente a confiable (GPS real dentro del sitio).
--
-- QUÉ HACE. Amplía `conductor_indicadores` con DOS cifras más, sin tocar las
-- que ya existían: cuántas llegadas eran VALIDABLES en el periodo
-- (`llegada_carga`/`llegada_descarga` recibidas o validadas) y, de esas,
-- cuántas quedaron en modo degradado — 'sin_dato' (sin geocerca o sin
-- ubicación con qué comparar) o 'validado' SOLO con el pin del chofer (sin
-- GPS real en la ventana de comparación). NO resuelve el problema de fondo
-- (seguir sin GPS real o sin geocerca configurada): solo lo hace VISIBLE,
-- que es la brecha exacta que señaló el hallazgo.
--
-- Reversible: recrear `conductor_indicadores` sin las dos claves nuevas
-- (el cuerpo de la 0385 queda documentado ahí mismo).
-- ═══════════════════════════════════════════════════════════════════════════

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
    -- 'validado' SOLO con el pin que el chofer elige a mano (sin GPS real en la ventana). Operaciones necesita esto
    -- para saber cuánta validación es confiable, no para resolver la falta de GPS/geocerca de fondo.
    'llegadas_validables', count(*) filter (
      where h.tipo in ('llegada_carga', 'llegada_descarga') and h.estado in ('recibido', 'validado')
    ),
    'validacion_degradada', count(*) filter (
      where h.tipo in ('llegada_carga', 'llegada_descarga') and h.estado in ('recibido', 'validado')
        and (val.resultado = 'sin_dato' or (val.resultado = 'validado' and val.fuente = 'pin'))
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
