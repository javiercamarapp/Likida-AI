-- ═══════════════════════════════════════════════════════════════════════════
-- AUDITORÍA DE SEGURIDAD 18-OCT-2026 — cierra el patrón que la 0292 dejó
-- "fuera de alcance a propósito": las policies de escritura `for all` que
-- quedaban en tablas sensibles, abiertas a cualquier sesión con su propio
-- JWT + anon key vía PostgREST, sin pasar por la app ni dejar rastro en
-- `bitacora_auditoria`.
--
-- Mismo razonamiento que la 0292 (léela primero si hace falta contexto): la
-- app NUNCA escribe estas tablas por RLS — todo `.from()` de escritura real
-- va por `supabaseAdmin()` (service_role, que salta RLS por definición) desde
-- código de servidor (`repo.ts`, `admin/*.ts`, `agentes/*.ts`, `saas/*.ts`,
-- `facturacion/*.ts` — verificado con grep, cero escritura desde cliente).
-- Las policies `for all` eran un resto de antes de 0086 (cuando el panel leía
-- por RLS) que nunca se acotó al convertir todo a service_role.
--
-- La 0292 dejó estas explícitamente pendientes de una decisión ("¿algún día
-- habrá escritura desde el navegador?"): verificado hoy que esa escritura no
-- existe en ningún punto del código actual, así que se cierran con el mismo
-- patrón ya aplicado a `tenant_data`/`tenant_finanzas`.
--
-- `ticket_mensaje` (hilo_escritura) NO está en esta lista: ya es `for insert`
-- desde la 0268, no `for all` — no necesita cambio.
--
-- Aditiva, idempotente (drop + create, nunca se deja una tabla sin policy de
-- escritura entre los dos pasos de la misma transacción de migración).
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── administra_flota / solo_admin_flota: acotadas a tenant + rol ───────────

drop policy if exists administra_flota on public.conector_credencial;
create policy administra_flota on public.conector_credencial for select
  using ((tenant_id = any(get_user_tenant_ids()) and administra_flota()) or is_superadmin());

drop policy if exists administra_flota on public.tenant_api_key;
create policy administra_flota on public.tenant_api_key for select
  using ((tenant_id = any(get_user_tenant_ids()) and administra_flota()) or is_superadmin());

drop policy if exists solo_admin_flota on public.invitacion;
create policy solo_admin_flota on public.invitacion for select
  using ((tenant_id = any(get_user_tenant_ids()) and administra_flota()) or is_superadmin());

drop policy if exists solo_admin_flota on public.solicitud_arco;
create policy solo_admin_flota on public.solicitud_arco for select
  using ((tenant_id = any(get_user_tenant_ids()) and administra_flota()) or is_superadmin());

drop policy if exists solo_admin_flota on public.rastreo_credencial;
create policy solo_admin_flota on public.rastreo_credencial for select
  using ((tenant_id = any(get_user_tenant_ids()) and administra_flota()) or is_superadmin());

-- ── SaaS: `plan`, `suscripcion`, `factura_saas` y `plan_price` YA tienen su
-- propia policy de lectura separada (`*_lectura`, for select) — la de
-- escritura solo se ELIMINA, no se reemplaza por otra de lectura redundante.
-- `evento_stripe` no tiene lectura separada: esa sí se convierte, como las de
-- arriba, para no perder el acceso de lectura del superadmin.

drop policy if exists plan_escritura on public.plan;
drop policy if exists suscripcion_escritura on public.suscripcion;
drop policy if exists factura_saas_escritura on public.factura_saas;
drop policy if exists plan_price_escritura on public.plan_price;

drop policy if exists evento_stripe_superadmin on public.evento_stripe;
create policy evento_stripe_superadmin on public.evento_stripe for select using (is_superadmin());

commit;
