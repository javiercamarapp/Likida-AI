-- ═══════════════════════════════════════════════════════════════════════════
-- AUDITORÍA 25 · DATOS-B2 (BAJO, REINCIDENTE DE LA 24) — `tenant_perfil_merge`
-- (0296) solo llevaba `grant execute ... to service_role`, sin el `revoke`
-- explícito que el resto del repo sí hace.
--
-- Postgres concede EXECUTE a PUBLIC por default en funciones nuevas, y
-- Supabase además concede explícito a `anon`/`authenticated` por sus default
-- privileges (0284:110-112, la lección de la 0013). Un `grant ... to
-- service_role` NO retira lo que ya está concedido — hace falta el `revoke`
-- explícito, que 0284 (cancelar_factura_tx) y sus hermanas sí traen.
--
-- Inerte HOY, no por este grant: `tenant` tiene RLS y la función es
-- SECURITY DEFINER (0296) pero el hallazgo de la 24 ya lo dejó anotado como
-- riesgo de superficie, no de explotación activa — se cierra igual, para no
-- ser la única función del repo que depende de la RLS de otra tabla en vez
-- de su propio grant.
-- ═══════════════════════════════════════════════════════════════════════════

revoke execute on function public.tenant_perfil_merge(uuid, jsonb, uuid) from public, anon, authenticated;
