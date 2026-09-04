-- ═══════════════════════════════════════════════════════════════════════════
-- AUDITORÍA 25 · SEGURIDAD, MEDIO (línea 202, REINCIDENTE) — la 0296 concedía
-- `execute` sobre `tenant_perfil_merge` (que ESCRIBE en `public.tenant`) sin
-- el `revoke from public, anon, authenticated` que el resto del repo aplica
-- a cada función nueva desde la lección de la 0013: Supabase concede EXECUTE
-- explícito a `anon`/`authenticated` por default privileges — un
-- `grant ... to service_role` solo no lo retira, así que la función quedaba
-- invocable por PostgREST directo con la sesión de cualquier usuario (mismo
-- molde que la 0284:110-113, cancelar_factura_tx).
--
-- POR QUÉ ES MEDIO Y NO ALTO: `tenant_perfil_merge` no es `security definer`
-- (corre como INVOKER), y `tenant` es de solo lectura por RLS para cualquier
-- rol que no sea service_role desde la 0078 — así que un `authenticated` que
-- la invocara por PostgREST se topaba con el `not found` de la 0296 (RLS le
-- niega el UPDATE) antes de tocar una fila ajena. No hay fuga de datos hoy,
-- pero la única red es RLS: si esa red se afloja alguna vez, esta función
-- pasa de "no hace nada" a "escribible por cualquiera" sin que nadie la
-- vuelva a mirar. Confirmado en rojo contra Postgres real (283 migraciones):
-- `has_function_privilege('anon', 'public.tenant_perfil_merge(uuid,jsonb,uuid)',
-- 'EXECUTE')` daba `true`.
-- ═══════════════════════════════════════════════════════════════════════════

revoke execute on function public.tenant_perfil_merge(uuid, jsonb, uuid) from public, anon, authenticated;
grant  execute on function public.tenant_perfil_merge(uuid, jsonb, uuid) to service_role;
