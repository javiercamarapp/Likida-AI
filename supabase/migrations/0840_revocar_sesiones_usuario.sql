-- ═══════════════════════════════════════════════════════════════════════════
-- 0840 · FASE 1 SEGURIDAD — SEG-SESIONES: cerrar TODAS las sesiones de un
-- usuario de un tiro (checklist 31 v2 #5, plan 32 Fase 1).
--
-- *** SOLO LOCAL (pila de auditoría `likida-auditoria`). NO aplicar a
-- remoto — usa el rango 0840-0849 reservado para esta fase, por arriba del
-- más alto visto en los worktrees `cinco-*` el 16-oct-2026 (cartaporte
-- llega a 0839). Antes de fusionar a master, revalidar `ls supabase/
-- migrations | tail -1` en los 9 worktrees `cinco-*` y renumerar si alguno
-- ya ocupó este rango entretanto. ***
--
-- ── EL HUECO ───────────────────────────────────────────────────────────────
-- `usuarios_escritura.ts` (0294) ya documentaba el límite: «el SDK no ofrece
-- signOut por userId (solo por JWT, que no tenemos), así que el ban es la
-- revocación real disponible». Cierto para el SDK de supabase-js
-- (`GoTrueAdminApi.signOut(jwt, scope)` exige el JWT de ESA sesión, no un
-- userId) — pero el ban solo lo usa la BAJA de la cuenta; no hay manera de
-- cerrar las sesiones de alguien SIN desactivarlo (p. ej., sospecha de
-- robo de sesión, laptop perdida, pero la persona sigue trabajando).
--
-- Tampoco hacía falta inventar un mecanismo nuevo: GoTrue ya expone la
-- revocación real a nivel de FILA. `auth.refresh_tokens.session_id`
-- referencia `auth.sessions.id` con `ON DELETE CASCADE` (confirmado contra
-- el esquema real de la pila local, Supabase Auth self-hosted) — borrar la
-- fila de `auth.sessions` de un usuario tumba sus refresh tokens con ella,
-- que es EXACTAMENTE lo que `admin.signOut(jwt, 'global')` hace del lado
-- del servidor cuando sí tiene el JWT a la mano (confirmado en vivo contra
-- la pila `likida-auditoria`: dos sesiones del mismo usuario, cerrar con
-- scope=global desde una, la OTRA también queda `refresh_token_not_found`).
--
-- LÍMITE QUE SE ACEPTA, igual que el ban ya lo acepta: un ACCESS TOKEN que
-- ya se emitió sigue siendo válido hasta su propio vencimiento (es un JWT
-- autocontenido, GoTrue no lo revoca por fila) — pero `get_user_tenant_ids()`
-- y las demás funciones de RLS (0294) evalúan `activo` EN CADA consulta, así
-- que para cualquier dato real del panel la ventana de exposición es la
-- misma que ya existe para la baja: lo que queda vivo hasta que expire es
-- la SESIÓN del navegador, no el acceso a datos de otro tenant (eso lo
-- cierra RLS, no esto).
--
-- ── LA FUNCIÓN ───────────────────────────────────────────────────────────
-- `security definer`, propiedad de quien corre la migración (con acceso al
-- esquema `auth`) — mismo patrón que cualquier función que ya cruza a
-- `auth.*` en este repo (`get_user_tenant_ids` lee `auth.uid()`). Revocado
-- a `public`/`anon`/`authenticated`, concedido solo a `service_role`: se
-- llama desde `supabaseAdmin().rpc(...)`, nunca desde el navegador — mismo
-- candado que `revocar_mcp_oauth_usuario` (0265).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.revocar_sesiones_usuario(p_usuario uuid)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n bigint;
begin
  delete from auth.sessions where user_id = p_usuario;
  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function public.revocar_sesiones_usuario is
  'FASE 1 SEGURIDAD · SEG-SESIONES (checklist 31 v2 #5, SOLO LOCAL): borra todas las filas de auth.sessions de p_usuario — auth.refresh_tokens.session_id referencia auth.sessions.id ON DELETE CASCADE, así que revoca sus refresh tokens con ellas. Equivalente de admin.signOut(jwt, "global") para cuando no se tiene el JWT de esa sesión (el caso de un admin cerrando la sesión de OTRO usuario). No revoca un access token ya emitido (JWT autocontenido, expira solo) — la RLS por activo ya cierra esa ventana para los datos reales.';

revoke all on function public.revocar_sesiones_usuario(uuid) from public, anon, authenticated;
grant execute on function public.revocar_sesiones_usuario(uuid) to service_role;
