-- REVERSA: drop function if exists public.mantener_agente_idempotencia(integer, timestamptz, timestamptz); drop function if exists public.contar_tokens_mcp_vivos(uuid[]); ninguna tabla cambia (la purga solo borra filas ya terminales y viejas; las filas borradas no se restauran).
-- ═══════════════════════════════════════════════════════════════════════════
-- 0909 · Dos huecos menores del frente S60 (agentes / legal / IA)
--
-- A37-S60-07 (BAJO): `agente_mutacion_idempotencia` guarda `result` (liga de
-- PDF, folio, cifras de una liquidación) y NADA la purgaba: crecía sin tope y la retención no la alcanzaba. La llave del
-- efecto ya lleva `runId` (D.21, tool-executor.ts), así que una fila terminal
-- vieja no protege nada: el reintento que cuida es el del MISMO run, que ocurre
-- en minutos. `mantener_agente_idempotencia` borra solo filas `succeeded` /
-- `failed` con `updated_at` de más de p_dias (default 90, piso 7: PU001). No
-- toca `running` (las reclama el lease). No se tocan los grants de la tabla
-- (0186 no concede DELETE, pero los privilegios por defecto del esquema sí).
--
-- A37-S60-09 (BAJO): la cola de clientes MCP pendientes contaba los tokens
-- vivos con una consulta por cliente (hasta 200 en paralelo). Un solo conteo
-- agrupado: `contar_tokens_mcp_vivos(uuid[])` (sin filas = 0 en el llamador).
--
-- ADITIVA E IDEMPOTENTE (create or replace). El código tolera que aún no esté
-- aplicada (cae al camino anterior y lo avisa).
-- ═══════════════════════════════════════════════════════════════════════════

create index if not exists agente_mutacion_idem_terminal_idx
  on public.agente_mutacion_idempotencia (updated_at)
  where status in ('succeeded', 'failed');

create or replace function public.mantener_agente_idempotencia(
  p_dias integer default 90,
  p_ahora timestamptz default now(),
  p_vence timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  purga jsonb;
begin
  if p_dias is null or p_dias < 7 then
    raise exception 'mantener_agente_idempotencia: % días es demasiado poco; el mínimo es 7', p_dias
      using errcode = 'PU001';
  end if;
  purga := public.purgar_en_tandas(
    'public.agente_mutacion_idempotencia'::regclass,
    format('status in (''succeeded'', ''failed'') and updated_at < %L', p_ahora - make_interval(days => p_dias)),
    p_vence);
  return jsonb_build_object(
    'borradas', coalesce((purga->>'borradas')::bigint, 0),
    'parcial', coalesce((purga->>'parcial')::boolean, false));
end;
$$;

comment on function public.mantener_agente_idempotencia is
  '0909 (A37-S60-07): purga agente_mutacion_idempotencia — filas succeeded/failed con más de p_dias (default 90, mínimo 7: PU001); nunca running. La llama /api/cron/purgar. SECURITY DEFINER, solo service_role.';

revoke all on function public.mantener_agente_idempotencia(integer, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.mantener_agente_idempotencia(integer, timestamptz, timestamptz) to service_role;

create or replace function public.contar_tokens_mcp_vivos(p_clientes uuid[])
returns table (cliente_id uuid, vivos bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select t.cliente_id, count(*)::bigint
    from public.mcp_oauth_token t
   where t.cliente_id = any (p_clientes)
     and t.revocado_en is null
   group by t.cliente_id;
$$;

comment on function public.contar_tokens_mcp_vivos is
  '0909 (A37-S60-09): tokens OAuth del MCP sin revocar, agrupados por cliente, en una sola consulta. Los clientes sin tokens no aparecen (0). Solo service_role.';

revoke all on function public.contar_tokens_mcp_vivos(uuid[]) from public, anon, authenticated;
grant execute on function public.contar_tokens_mcp_vivos(uuid[]) to service_role;
