-- ═══════════════════════════════════════════════════════════════════════════
-- 0265 — MCP OAuth: revalidar la identidad al refrescar, revocar por usuario,
-- y purgar lo que la 0260 dejó creciendo sin techo.
-- Auditoría final Likida 2026-08-29, HALLAZGO 1 (MEDIA) y HALLAZGO 3 (MEDIA).
--
-- ── HALLAZGO 1 — el refresco reemitía la identidad CONGELADA sin revisarla ──
--
-- `refrescarTokens` (src/lib/mcp/oauth.ts) rota el par de tokens copiando
-- `tenant_id`/`rol`/`user_id` de la FILA DEL TOKEN, nunca del `app_user`
-- actual. Cada rotación renueva el refresco otros 60 días (REFRESCO_TTL_MS),
-- así que un contador dado de baja o con el rol cambiado —sin borrar su fila
-- de `app_user`, que el FK cascade sí limpiaría— sigue con acceso MCP a
-- cuadres/facturación/fiscal de la flota indefinidamente, mientras su cliente
-- siga refrescando.
--
-- El arreglo vive en dos mitades:
--   1. `mcp_oauth_usuario_vigente()` — la pregunta que solo la base puede
--      contestar con la fila REAL de `app_user` en el instante del refresco:
--      ¿esta fila sigue existiendo, en el MISMO tenant y con el MISMO rol
--      con los que se consintió? `refrescarTokens` la llama por RPC antes de
--      rotar; si contesta `false`, se trata EXACTAMENTE como el reuso de un
--      refresco ya rotado: se revoca la familia entera y se contesta
--      `invalid_grant` (oauth.ts, misma rama que `revocarFamilia`).
--      `app_user` no tiene columna de "activo"/estatus (schema.sql, 0001 en
--      adelante) — no se inventa una aquí; el criterio que SÍ existe y que
--      cierra el escenario del hallazgo (baja o cambio de rol) es identidad +
--      tenant + rol exactos.
--   2. `revocar_mcp_oauth_usuario()` — para cuando SÍ se sabe que alguien se
--      va: tumba de un tiro todos los tokens vivos de un usuario en una
--      flota. Hoy no hay flujo de admin que dé de baja o cambie el rol de un
--      usuario del panel (`src/app/dashboard/usuarios/forma.tsx` lo dice en
--      su propio comentario: "cambiar rol y dar de baja no existen todavía";
--      `src/lib/auth/invitar.ts` solo tiene ALTA). Esta función queda lista
--      para cablearse el día que ese flujo exista — no se inventa aquí una
--      pantalla nueva para no ensanchar el alcance de esta migración — y
--      mientras tanto (1) ya cierra la fuga por sí sola: sin importar si
--      alguien se acuerda de revocar a mano, el SIGUIENTE refresco después de
--      un cambio real en `app_user` se niega solo.
--
-- ── HALLAZGO 3 — las tres tablas de la 0260 crecen sin techo ────────────────
--
-- Mismo defecto que `producto_evento` (0259, MEDIO): nadie las purga.
--   (a) `mcp_oauth_token`: 2 filas nuevas por CADA rotación de refresco,
--       nunca borradas — retienen `user_email`/rol congelado sin plazo.
--   (b) `mcp_oauth_codigo`: solo tenía una limpieza best-effort (oauth.ts,
--       sin condicionar la respuesta) para códigos de más de un día; aquí se
--       vuelve una garantía de mantenimiento con su propio contrato.
--   (c) `mcp_oauth_cliente`: el registro (DCR, RFC 7591) es público y sin
--       autenticar — un escáner con IPs rotadas puede registrar clientes en
--       bucle sin jamás completar un login. `ultimo_uso_en` se documentó en
--       la 0260 "para poder podarlas" pero el barrido nunca se escribió.
--
-- `mantener_mcp_oauth()` sigue el patrón EXACTO de `mantener_producto_evento`
-- (0259): DELETE en tandas (`purgar_en_tandas`, 0155) y no consolidación —
-- aquí no hay una métrica de negocio que preservar, el dato es un secreto
-- hasheado y una identidad congelada, así que no hace falta un paso previo
-- que la resuma. Mismo piso de `p_dias` por la misma razón de fondo (PU001):
-- 30 días es margen de sobra para que cualquier incidente de seguridad que
-- necesite mirar tokens revocados recientes lo haga antes de que se borren.
--
-- Se llama desde `/api/cron/purgar` (src/app/api/cron/purgar/route.ts) como
-- RPC HERMANA de `mantenimiento_de_datos`, igual que `mantener_producto_evento`
-- en la 0259 y por la MISMA razón: no se apila esta migración sobre la que
-- redefine `mantenimiento_de_datos` desde otra rama (regla de la casa, ver
-- cabecera de la 0259). No se crea un cron nuevo: `vercel.json` ya tiene el
-- agregador de mantenimiento y esta es una llamada más ahí.
--
-- ── Idempotencia ─────────────────────────────────────────────────────────────
-- `create index if not exists`, `create or replace function`. Re-aplicarla
-- no cambia nada.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Los índices que las purgas y la revocación por usuario necesitan ────
create index if not exists mcp_oauth_token_expira_idx
  on public.mcp_oauth_token (expira_en);
create index if not exists mcp_oauth_token_revocado_idx
  on public.mcp_oauth_token (revocado_en)
  where revocado_en is not null;
-- La revocación por usuario (`revocar_mcp_oauth_usuario`) y la revalidación
-- del refresco filtran por (tenant, usuario, vigente): un patrón nuevo que
-- ningún índice existente cubre (`mcp_oauth_token_tenant_idx` lleva
-- `emitido_en`, no `user_id`).
create index if not exists mcp_oauth_token_usuario_vigente_idx
  on public.mcp_oauth_token (tenant_id, user_id)
  where revocado_en is null;
create index if not exists mcp_oauth_cliente_creado_idx
  on public.mcp_oauth_cliente (creado_en);

-- ── 2. HALLAZGO 1a — ¿la identidad congelada del token sigue siendo cierta? ─
create or replace function public.mcp_oauth_usuario_vigente(
  p_user_id uuid,
  p_tenant_id uuid,
  p_rol text
) returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.app_user
     where id = p_user_id
       and tenant_id = p_tenant_id
       and rol = p_rol
  );
$$;

comment on function public.mcp_oauth_usuario_vigente is
  'HALLAZGO 1 (auditoría final 2026-08-29): ¿la fila de app_user congelada en un token MCP (tenant_id, rol) sigue siendo cierta AHORA? refrescarTokens la llama por RPC antes de rotar; false = revoca la familia y niega, igual que el reuso de un refresco. app_user no tiene columna de estatus/activo — el criterio es identidad + tenant + rol exactos, que es lo que existe y lo que cierra el escenario real (baja o cambio de rol sin borrar la fila).';

revoke all on function public.mcp_oauth_usuario_vigente(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.mcp_oauth_usuario_vigente(uuid, uuid, text) to service_role;

-- ── 3. HALLAZGO 1b — cortar de un tiro todos los tokens MCP de un usuario ───
create or replace function public.revocar_mcp_oauth_usuario(
  p_tenant uuid,
  p_usuario uuid
) returns bigint
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  n bigint;
begin
  update public.mcp_oauth_token
     set revocado_en = now()
   where tenant_id = p_tenant
     and user_id = p_usuario
     and revocado_en is null;
  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function public.revocar_mcp_oauth_usuario is
  'HALLAZGO 1 (auditoría final 2026-08-29): revoca (revocado_en = now()) todos los tokens MCP activos de p_usuario en p_tenant. Devuelve cuántos tocó. Pensada para cablearse desde el flujo de admin que dé de baja o cambie el rol de un usuario del panel — ese flujo NO EXISTE hoy (dashboard/usuarios solo invita, forma.tsx lo dice explícito); mcp_oauth_usuario_vigente() ya cierra la fuga sin depender de que alguien la invoque a mano.';

revoke all on function public.revocar_mcp_oauth_usuario(uuid, uuid) from public, anon, authenticated;
grant execute on function public.revocar_mcp_oauth_usuario(uuid, uuid) to service_role;

-- ── 4. HALLAZGO 3 — purgar las tres tablas de la 0260 ───────────────────────
create or replace function public.mantener_mcp_oauth(
  p_dias integer default 90,
  p_ahora timestamptz default now(),
  p_vence timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  corte timestamptz := p_ahora - make_interval(days => p_dias);
  -- Los códigos viven MINUTOS (CODIGO_TTL_MS = 5 min): uno con más de un día
  -- de vida está, sin excepción, usado o expirado. No depende de p_dias.
  corte_codigo timestamptz := p_ahora - interval '1 day';
  purga_token jsonb;
  purga_codigo jsonb;
  purga_cliente jsonb;
begin
  if p_dias < 30 then
    -- Mismo criterio que mantener_producto_evento (0259, PU001): un piso
    -- para que un incidente de seguridad reciente todavía tenga tokens
    -- revocados que mirar antes de que este mantenimiento los borre.
    raise exception 'mantener_mcp_oauth: % días es demasiado poco; el mínimo es 30', p_dias
      using errcode = 'PU001';
  end if;

  -- (a) Tokens: revocados o expirados hace más de p_dias. DELETE y no
  -- consolidación — a diferencia de producto_evento aquí no hay una métrica
  -- de negocio que preservar; el dato es un secreto hasheado y una identidad
  -- congelada sin valor pasado el plazo.
  purga_token := public.purgar_en_tandas(
    'public.mcp_oauth_token'::regclass,
    format('(revocado_en is not null and revocado_en < %L) or expira_en < %L', corte, corte),
    p_vence);

  -- (b) Códigos ya usados o expirados hace más de un día (ver corte_codigo).
  -- Reemplaza la limpieza best-effort de oauth.ts:356-360 con una garantía
  -- de mantenimiento propia; esa limpieza best-effort se deja como está —no
  -- estorba, y cubre el hueco entre corridas del cron.
  purga_codigo := public.purgar_en_tandas(
    'public.mcp_oauth_codigo'::regclass,
    format('expira_en < %L', corte_codigo),
    p_vence);

  -- (c) Clientes DCR que JAMÁS produjeron un token: el escenario del
  -- hallazgo 3 (registro abierto, un escáner que se registra y se va).
  -- `ultimo_uso_en` no es el criterio —nunca se escribe hoy—; "sin ningún
  -- mcp_oauth_token asociado" sí lo es, y no depende de esa columna.
  purga_cliente := public.purgar_en_tandas(
    'public.mcp_oauth_cliente'::regclass,
    format(
      'creado_en < %L and not exists (select 1 from public.mcp_oauth_token t where t.cliente_id = mcp_oauth_cliente.id)',
      corte),
    p_vence);

  return jsonb_build_object(
    'tokensBorrados', coalesce((purga_token->>'borradas')::bigint, 0),
    'codigosBorrados', coalesce((purga_codigo->>'borradas')::bigint, 0),
    'clientesBorrados', coalesce((purga_cliente->>'borradas')::bigint, 0),
    'parcial',
      coalesce((purga_token->>'parcial')::boolean, false)
      or coalesce((purga_codigo->>'parcial')::boolean, false)
      or coalesce((purga_cliente->>'parcial')::boolean, false)
  );
end;
$$;

comment on function public.mantener_mcp_oauth is
  'HALLAZGO 3 (auditoría final 2026-08-29): purga (DELETE en tandas, purgar_en_tandas de la 0155) mcp_oauth_token revocado/expirado hace más de p_dias (default 90, mínimo 30 — PU001), mcp_oauth_codigo con más de un día de vida, y mcp_oauth_cliente sin ningún token asociado con más de p_dias de creado. La llama el cron /api/cron/purgar como RPC hermana de mantenimiento_de_datos, mismo criterio que mantener_producto_evento (0259): dos PRs independientes no deben redefinir la misma función desde master.';

revoke all on function public.mantener_mcp_oauth(integer, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.mantener_mcp_oauth(integer, timestamptz, timestamptz) to service_role;
