-- ═══════════════════════════════════════════════════════════════════════════
-- 0441 — reservar_presupuesto_llm YA NO RECORRE EL HISTORIAL DEL TENANT, y la
-- tabla de reservas se purga.
--
-- Auditoría ola 1, #18. `reservar_presupuesto_llm` se ejecuta en CADA llamada al
-- modelo (~11 por viaje: 8 vueltas de cuadre + OCR). Toma un lock asesor por
-- tenant y luego calcula `usado_run` con
--     where tenant_id = p_tenant_id and run_id = p_run_id and (…vivo…)
-- SIN cota de fecha y SIN índice por run_id: los únicos índices eran
-- (tenant_id, created_at, estado) y (tenant_id, proposito, created_at), así que
-- cada reserva leía por prefijo `tenant_id` TODAS las filas históricas de la
-- flota y filtraba run_id en el heap — bajo un lock que serializa a todas las
-- reservas de esa flota. Con 5,000 viajes/mes son ~55 mil filas/mes (~660 mil al
-- año) y la tabla jamás se purgaba: la latencia de CADA llamada de IA crecía con
-- la edad de la cuenta.
--
-- Arreglo, en dos partes:
--   1. Índice (tenant_id, run_id) INCLUYENDO lo que la suma lee (reservado_usd,
--      estado, expira_en): `usado_run` pasa a ser un index-only scan que toca SOLO
--      las filas de ese run (decenas), no las de la flota. El cuerpo de la función
--      no cambia de semántica (misma suma, mismos estados vivos); se re-crea solo
--      para dejar el comentario de por qué el índice existe.
--   2. `mantener_llm_presupuesto()`: RPC HERMANA (mismo patrón que
--      `mantener_mcp_oauth`, 0265, para no redefinir `mantenimiento_de_datos`)
--      que purga en tandas lo que ya no sirve: reservas 'liquidado' de más de
--      p_dias (default 35, mínimo 2: el tope del día y el del run solo miran lo
--      reciente) y 'reservado' cuya expiración venció hace más de un día (0193 ya
--      las ignora en la suma; aquí dejan de ocupar espacio). El costo real queda
--      en `llm_costo`/`llm_costo_mensual`, que es lo que lee el panel.
--
-- Idempotente: create index if not exists, create or replace function.
-- (Si algún día la tabla fuera enorme, crear el índice CONCURRENTLY aparte —como
-- hace 0332 con scripts/ci/0335_preflight_retencion_indices.sql—; hoy son miles
-- de filas y el CREATE INDEX no se nota.)
-- ═══════════════════════════════════════════════════════════════════════════

create index if not exists llm_presupuesto_run_idx
  on public.llm_presupuesto_reserva (tenant_id, run_id)
  include (reservado_usd, estado, expira_en);

comment on index public.llm_presupuesto_run_idx is
  '0441 (auditoría ola 1 #18): sirve el usado_run de reservar_presupuesto_llm sin recorrer el historial de la flota. INCLUDE para index-only scan.';

create or replace function public.reservar_presupuesto_llm(
  p_reserva_id uuid,
  p_tenant_id uuid,
  p_run_id uuid,
  p_reserva_usd numeric,
  p_tope_run_usd numeric,
  p_tope_tenant_usd numeric,
  p_proposito text,
  p_reserva_interactivo_usd numeric
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  usado_tenant numeric;
  usado_run numeric;
  usado_fondo numeric;
  inicio_dia_mx timestamptz;
begin
  -- Argumentos inválidos LANZAN (error de programación, no de presupuesto):
  -- la versión de 6 args devolvía false y eso se leía como "tope del tenant",
  -- que es una mentira sobre dinero.
  if p_reserva_usd is null or p_reserva_usd <= 0
     or p_tope_run_usd is null or p_tope_run_usd <= 0
     or p_tope_tenant_usd is null or p_tope_tenant_usd <= 0 then
    raise exception 'reservar_presupuesto_llm: montos inválidos (reserva=%, tope_run=%, tope_tenant=%)',
      p_reserva_usd, p_tope_run_usd, p_tope_tenant_usd;
  end if;
  if p_proposito is null or p_proposito not in ('interactivo', 'ocr_lote', 'fondo') then
    raise exception 'reservar_presupuesto_llm: propósito desconocido: %', p_proposito;
  end if;
  if p_reserva_interactivo_usd is null or p_reserva_interactivo_usd < 0
     or p_reserva_interactivo_usd > p_tope_tenant_usd then
    raise exception 'reservar_presupuesto_llm: reserva de interactivo fuera de rango: % (tope %)',
      p_reserva_interactivo_usd, p_tope_tenant_usd;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));
  -- Medianoche de HOY en hora de México, no en UTC (0193, ver 0161).
  inicio_dia_mx := date_trunc('day', now() at time zone 'America/Mexico_City') at time zone 'America/Mexico_City';

  select coalesce(sum(reservado_usd), 0) into usado_tenant
    from public.llm_presupuesto_reserva
   where tenant_id = p_tenant_id
     and created_at >= inicio_dia_mx
     and (estado = 'liquidado' or (estado = 'reservado' and expira_en > now()));
  if usado_tenant + p_reserva_usd > p_tope_tenant_usd then return 'tope_tenant'; end if;

  -- La RESERVA del camino interactivo: el fondo solo llega hasta
  -- (tope − reserva); el interactivo puede usar el techo completo.
  if p_proposito <> 'interactivo' then
    select coalesce(sum(reservado_usd), 0) into usado_fondo
      from public.llm_presupuesto_reserva
     where tenant_id = p_tenant_id
       and proposito <> 'interactivo'
       and created_at >= inicio_dia_mx
       and (estado = 'liquidado' or (estado = 'reservado' and expira_en > now()));
    if usado_fondo + p_reserva_usd > p_tope_tenant_usd - p_reserva_interactivo_usd then
      return 'tope_proposito';
    end if;
  end if;

  -- 0441: el tope por corrida lo sirve llm_presupuesto_run_idx (tenant_id,
  -- run_id) — solo las filas de ESTE run, no el historial de la flota.
  select coalesce(sum(reservado_usd), 0) into usado_run
    from public.llm_presupuesto_reserva
   where tenant_id = p_tenant_id
     and run_id = p_run_id
     and (estado = 'liquidado' or (estado = 'reservado' and expira_en > now()));
  if usado_run + p_reserva_usd > p_tope_run_usd then return 'tope_run'; end if;

  insert into public.llm_presupuesto_reserva(id, tenant_id, run_id, reservado_usd, estado, proposito)
  values (p_reserva_id, p_tenant_id, p_run_id, p_reserva_usd, 'reservado', p_proposito);
  return 'ok';
end;
$$;

comment on function public.reservar_presupuesto_llm(uuid, uuid, uuid, numeric, numeric, numeric, text, numeric) is
  'Reserva presupuesto de IA con dimensión de propósito (0244, D.23): interactivo | ocr_lote | fondo. El fondo solo gasta hasta (tope_tenant − reserva_interactivo); el interactivo usa el techo completo. Devuelve ok | tope_tenant | tope_proposito | tope_run — el llamador falla cerrado y le dice al usuario CUÁL techo, en español. 0441: el tope por corrida se sirve con llm_presupuesto_run_idx (no recorre el historial de la flota).';

revoke all on function public.reservar_presupuesto_llm(uuid, uuid, uuid, numeric, numeric, numeric, text, numeric) from public, anon, authenticated;
grant execute on function public.reservar_presupuesto_llm(uuid, uuid, uuid, numeric, numeric, numeric, text, numeric) to service_role;

-- ── La purga ────────────────────────────────────────────────────────────────
create or replace function public.mantener_llm_presupuesto(
  p_dias integer default 35,
  p_ahora timestamptz default now(),
  p_vence timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  corte timestamptz := p_ahora - make_interval(days => p_dias);
  corte_vencida timestamptz := p_ahora - interval '1 day';
  purga_liquidadas jsonb;
  purga_vencidas jsonb;
begin
  if p_dias < 2 then
    -- El tope del día mira desde la medianoche MX y el del run mira su corrida:
    -- por debajo de 2 días se podría borrar una reserva que aún cuenta.
    raise exception 'mantener_llm_presupuesto: % días es demasiado poco; el mínimo es 2', p_dias
      using errcode = 'PU001';
  end if;

  purga_liquidadas := public.purgar_en_tandas(
    'public.llm_presupuesto_reserva'::regclass,
    format('estado = ''liquidado'' and created_at < %L', corte),
    p_vence);

  -- 'reservado' vencido hace más de un día: 0193 ya las ignora en las sumas; la
  -- llamada murió antes de liquidar y la fila solo ocupa espacio.
  purga_vencidas := public.purgar_en_tandas(
    'public.llm_presupuesto_reserva'::regclass,
    format('estado = ''reservado'' and expira_en < %L', corte_vencida),
    p_vence);

  return jsonb_build_object(
    'liquidadasBorradas', coalesce((purga_liquidadas->>'borradas')::bigint, 0),
    'vencidasBorradas', coalesce((purga_vencidas->>'borradas')::bigint, 0),
    'parcial',
      coalesce((purga_liquidadas->>'parcial')::boolean, false)
      or coalesce((purga_vencidas->>'parcial')::boolean, false)
  );
end;
$$;

comment on function public.mantener_llm_presupuesto is
  '0441 (auditoría ola 1 #18): purga llm_presupuesto_reserva — liquidadas de más de p_dias (default 35, mínimo 2: PU001) y reservadas vencidas hace más de un día. RPC hermana de mantener_mcp_oauth (0265) para no redefinir mantenimiento_de_datos; la llama /api/cron/purgar. SECURITY DEFINER, solo service_role.';

revoke all on function public.mantener_llm_presupuesto(integer, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.mantener_llm_presupuesto(integer, timestamptz, timestamptz) to service_role;
