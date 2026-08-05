-- ═══════════════════════════════════════════════════════════════════════════
-- 0079 — RLS: cierra la familia que la 0078 no cubrió (auditoría 12, seguridad)
--
-- La 0078 cerró las 7 tablas de `tenant_data` y `tenant`. Esta migración cierra
-- los dos MEDIO que el auditor de seguridad de la ronda 12 encontró fuera de
-- esa lista, de la MISMA familia ("se acota el tenant y se olvida el rol"):
--
--   1. `app_user_self` (0001:127) — `for select` con `tenant_id = any(...)`
--      a secas: un chofer con sesión web + anon key leía los correos, nombres,
--      roles y el `operador_id` de TODA la flota (el mapa quién-es-quién entre
--      cuentas web e identidades de WhatsApp). El chofer necesita leer SU
--      propia fila (`lib/auth/session.ts:70` la consulta por id), así que se
--      conserva `id = auth.uid()` y se añade `not is_operador()` al brazo de
--      tenant.
--
--   2. `bitacora_insercion` (0053:199) — `for insert` con `with check` a
--      secas: un chofer podía sembrar entradas falsas en la bitácora de
--      auditoría de su flota (cambios de política que nunca ocurrieron, con el
--      correo del dueño como actor). La lectura ya exige `administra_flota()`;
--      la ESCRITURA queda con `not is_operador()`.
--
-- Ambas con el mismo patrón verificado en la 0078: `not is_operador()` en el
-- brazo de tenant, superadmin intacto.
-- ═══════════════════════════════════════════════════════════════════════════

drop policy if exists app_user_self on app_user;
create policy app_user_self on app_user for select
  using (id = auth.uid()
      or (tenant_id = any(get_user_tenant_ids()) and not is_operador())
      or is_superadmin());

drop policy if exists bitacora_insercion on public.bitacora_auditoria;
create policy bitacora_insercion on public.bitacora_auditoria for insert
  with check ((tenant_id = any(get_user_tenant_ids()) and not is_operador()) or is_superadmin());
