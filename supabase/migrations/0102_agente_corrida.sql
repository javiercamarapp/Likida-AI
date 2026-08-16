-- ═══════════════════════════════════════════════════════════════════════════
-- 0102 — LA BITÁCORA DE CORRIDAS DE LOS AGENTES (hallazgo B3, auditoría 4).
--
-- Es la pieza de la arquitectura de referencia que más faltaba: su ficha de agente enseña
-- «Periodo · Estado · Tareas 2/2 · Duración · Fecha» por corrida. En Likida,
-- el único rastro de que un agente corrió era `logger.info` — que el cliente
-- no ve. La consecuencia está escrita en el plan de la ronda: **sin
-- historial, un agente que nunca avisa es indistinguible de uno que nunca
-- corrió.** Y ya costó nueve días de cron tronando sin que nadie lo viera.
--
-- UNA FILA POR (corrida × flota), no por corrida global: los crons recorren
-- todas las flotas, pero la pregunta del cliente es «¿mi agente trabajó?»,
-- y la respuesta de OTRA flota no se la puede contestar.
--
-- QUÉ NO ES: no sustituye a `agente_notificacion_estado` (el anti-ruido de
-- avisos, 0097) ni a Sentry (los fallos de plataforma). Es el historial que
-- se ENSEÑA — la fila se escribe best-effort desde el código: perder una
-- anotación es mil veces mejor que tumbar la corrida que anota.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.agente_corrida (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  -- El dominio es el catálogo de agentes de `agentes/notificaciones.ts`. Se
  -- vigila con CHECK porque un id inventado partiría el historial en dos.
  agente      text not null,
  inicio      timestamptz not null,
  fin         timestamptz,
  -- ok      = corrió y terminó sin fallo para ESTA flota
  -- parcial = terminó, pero alguna tarea de esta flota falló
  -- fallo   = la corrida de esta flota no se pudo completar
  estado      text not null,
  -- cron = la disparó el reloj; manual = el botón «Ejecutar ahora».
  disparo     text not null default 'cron',
  -- Tareas: el «2/2» de la ficha. NULL = esta corrida no se mide en tareas
  -- (y la ficha lo dice, no pinta 0/0).
  tareas_hechas int,
  tareas_total  int,
  -- El resumen que la ficha despliega (conteos, folios). SIN datos personales
  -- y SIN mensajes de error crudos — para eso está `error`.
  resumen     jsonb,
  -- El motivo del fallo YA REDACTADO para una persona (nunca el stack).
  error       text,
  creada_en   timestamptz not null default now(),
  constraint agente_corrida_agente_dominio
    check (agente in ('liquidacion', 'facturas', 'cobranza', 'conductores', 'peajes', 'proveedores')),
  constraint agente_corrida_estado_dominio
    check (estado in ('ok', 'parcial', 'fallo')),
  constraint agente_corrida_disparo_dominio
    check (disparo in ('cron', 'manual')),
  constraint agente_corrida_fin_coherente
    check (fin is null or fin >= inicio),
  constraint agente_corrida_tareas_sanas
    check (tareas_hechas is null or tareas_total is null or (tareas_hechas >= 0 and tareas_hechas <= tareas_total))
);

comment on table public.agente_corrida is
  'Historial de corridas por agente y flota — la ficha «Periodo · Estado · Tareas · Duración». Se escribe best-effort: una anotación perdida es mejor que una corrida tumbada.';

-- La consulta de la ficha: las últimas N de un agente de una flota.
create index if not exists agente_corrida_ficha_idx
  on public.agente_corrida (tenant_id, agente, inicio desc);
-- La purga por fecha.
create index if not exists agente_corrida_por_fecha
  on public.agente_corrida (creada_en);

alter table public.agente_corrida enable row level security;

-- Lectura para la flota (cualquier rol con panel: la corrida de un agente no
-- es dinero, es operación del sistema); escritura solo service role — las
-- corridas las anota el servidor, jamás un formulario.
create policy tenant_lee on public.agente_corrida for select
  using (tenant_id = any(get_user_tenant_ids()) or is_superadmin());

-- ── La purga: 180 días de historial ────────────────────────────────────────
-- Suficiente para «¿desde cuándo no corre?» y para comparar contra el mes
-- pasado; más que eso es una tabla que crece sin que nadie la mire.
create or replace function public.purgar_agente_corrida(
  p_dias integer default 180,
  p_ahora timestamptz default now()
) returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare borradas bigint;
begin
  delete from public.agente_corrida
   where creada_en < p_ahora - make_interval(days => p_dias);
  get diagnostics borradas = row_count;
  return borradas;
end;
$$;

revoke all on function public.purgar_agente_corrida(integer, timestamptz) from public;
revoke all on function public.purgar_agente_corrida(integer, timestamptz) from anon;
revoke all on function public.purgar_agente_corrida(integer, timestamptz) from authenticated;
grant execute on function public.purgar_agente_corrida(integer, timestamptz) to service_role;

-- `mantenimiento_de_datos` aprende la llave nueva (misma firma que 0098/0101).
create or replace function public.mantenimiento_de_datos(
  p_dias_wa integer default 30,
  p_ahora timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  wa_purgados bigint;
  ia_consolidados bigint;
  idem_purgadas bigint;
  correo_purgado bigint;
  corridas_purgadas bigint;
begin
  wa_purgados := public.purgar_wa_mensaje_procesado(p_dias_wa, p_ahora);
  ia_consolidados := public.consolidar_llm_costo_mensual(p_ahora);
  idem_purgadas := public.purgar_api_idempotencia(7, p_ahora);
  correo_purgado := public.purgar_correo_procesado(90, p_ahora);
  corridas_purgadas := public.purgar_agente_corrida(180, p_ahora);
  return jsonb_build_object(
    'waPurgados', wa_purgados,
    'diasWa', p_dias_wa,
    'iaConsolidados', ia_consolidados,
    'llmCostoPurgado', false,
    'idempotenciaPurgada', idem_purgadas,
    'correoPurgado', correo_purgado,
    'corridasPurgadas', corridas_purgadas,
    'corridaEn', p_ahora
  );
end;
$$;

revoke all on function public.mantenimiento_de_datos(integer, timestamptz) from public;
revoke all on function public.mantenimiento_de_datos(integer, timestamptz) from anon;
revoke all on function public.mantenimiento_de_datos(integer, timestamptz) from authenticated;
grant execute on function public.mantenimiento_de_datos(integer, timestamptz) to service_role;
