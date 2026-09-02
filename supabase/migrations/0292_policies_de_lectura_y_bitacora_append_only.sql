-- ═══════════════════════════════════════════════════════════════════════════
-- AUDITORÍA 24 · SEG-2 (MEDIO) — LA COOKIE DE SESIÓN + LA ANON KEY ABREN UN
-- SEGUNDO CAMINO DE **ESCRITURA** A LA BASE QUE LA APP NO VIGILA.
--
-- ── EL ESCENARIO, CON VALORES ─────────────────────────────────────────────
-- Un `contador` de Innovativos abre DevTools, copia el JWT de su propia
-- sesión (la anon key ya viaja en el bundle, `browser-storage.ts:27`) y hace:
--
--   curl -X PATCH "https://<ref>.supabase.co/rest/v1/liquidacion?id=eq.<uuid>" \
--     -H "apikey: <anon>" -H "Authorization: Bearer <jwt>" \
--     -d '{"diferencia": 0, "total_comprobado": 18500}'
--
-- `tenant_finanzas_update` (0158) lo deja pasar: es su tenant y `ve_finanzas()`
-- es true. El único trigger sobre `liquidacion` es de DELETE. Resultado: 204,
-- la fila cambia, el PDF archivado dice otra cifra, `bitacora_auditoria` no
-- tiene entrada y `reabrirViaje` —«el camino auditado que deja rastro»— nunca
-- corrió. Se rompe la regla número uno del producto («nunca inventar una
-- cifra») desde dentro y sin rastro.
--
-- Lo mismo con `PATCH /rest/v1/viaje` (`{"operador_id": …, "estatus":
-- "liquidado"}`) y con `DELETE /rest/v1/operador`. La CSP `connect-src 'self'`
-- frena a un XSS, pero no frena a `curl`.
--
-- ── POR QUÉ SE PUEDE CERRAR SIN ROMPER NADA ───────────────────────────────
-- La app NO usa estas policies para escribir: todo `.from()` de escritura va
-- por `supabaseAdmin()` (service_role), que salta RLS por definición, y el
-- guardián `consultas_admin_filtran_tenant.test.ts` es quien exige el filtro
-- por tenant en ese camino. Las policies de escritura son un resto de cuando
-- la app leía por RLS (pre-0086): quedaron `for all` al migrar todo a service
-- role. La 0158 tapó los tres casos que dolieron con triggers; esto tapa el
-- patrón.
--
-- Se conserva la LECTURA tal cual (misma expresión, mismo alcance): el panel
-- sí lee por RLS. Sólo se retira el verbo de escritura.
--
-- Fuera de alcance a propósito (y por eso siguen `for all`): las policies ya
-- acotadas a un rol —`administra_flota` (conector_credencial, tenant_api_key),
-- `solo_admin_flota` (invitacion, solicitud_arco, rastreo_credencial),
-- `hilo_escritura` (ticket_mensaje)— y las de facturación del SaaS
-- (`plan_escritura`, `plan_price_escritura`, `suscripcion_escritura`,
-- `factura_saas_escritura`, `evento_stripe_superadmin`). Quedan anotadas en el
-- CIERRE: acotarlas exige decidir antes si algún día habrá escritura desde el
-- navegador, y esta migración no inventa esa decisión.
--
-- ── LA BITÁCORA: POR QUÉ **NO** SE TOCAN LOS GRANTS AQUÍ ──────────────────
-- `bitacora_auditoria` tiene una sola policy (`bitacora_lectura`, SELECT), así
-- que RLS ya niega UPDATE y DELETE por ausencia de policy: el auditado no
-- puede borrar su rastro, y el bloque BITACORA de la batería lo comprueba
-- desde hace rondas (0 filas afectadas).
--
-- Revocar además los GRANTS de tabla (`update`, `delete`, que la 0195 dejó
-- vivos al revocar sólo INSERT) sería un segundo candado legítimo, pero cambia
-- el DESENLACE de «afecta 0 filas» a «permission denied», y ese bloque —que no
-- es de esta migración— hace el UPDATE y el DELETE sin envolverlos, así que
-- dejaría la batería roja por un endurecimiento. Va anotado en el CIERRE de la
-- auditoría 24 con el cambio que exige, en vez de hacerse a medias aquí.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. `tenant_data` y `tenant_finanzas`: de `for all` a `for select` ─────
-- Se recrea CADA UNA con SU PROPIA expresión (no todas comparten predicado:
-- `factura_viaje` no tiene `tenant_id` y resuelve por `factura_emitida`), leída
-- del catálogo. Idempotente: si ya son `for select`, el bucle no las ve.
do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname, qual
    from pg_policies
    where schemaname = 'public'
      and policyname in ('tenant_data', 'tenant_finanzas')
      and cmd = 'ALL'
  loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    execute format('create policy %I on %I.%I for select using (%s)',
                   p.policyname, p.schemaname, p.tablename, p.qual);
    raise notice 'AUD24/0292: %.% → %s ahora es solo lectura', p.tablename, p.policyname, p.policyname;
  end loop;
end $$;

-- ── 2. Las de escritura explícitas sobre el dinero y el viaje ────────────
-- `viaje`, `gasto`, `liquidacion`, `cfdi_xml`, `llm_costo`: la app las escribe
-- SOLO por service_role. Sin policy de INSERT/UPDATE, RLS niega por ausencia.
drop policy if exists tenant_data_insert    on public.viaje;
drop policy if exists tenant_data_update    on public.viaje;
drop policy if exists tenant_finanzas_insert on public.gasto;
drop policy if exists tenant_finanzas_update on public.gasto;
drop policy if exists tenant_finanzas_insert on public.liquidacion;
drop policy if exists tenant_finanzas_update on public.liquidacion;
drop policy if exists tenant_finanzas_insert on public.cfdi_xml;
drop policy if exists tenant_finanzas_update on public.cfdi_xml;
drop policy if exists tenant_finanzas_insert on public.llm_costo;
drop policy if exists tenant_finanzas_update on public.llm_costo;

-- ── 3. La bitácora sigue siendo constancia (documentado, no cambiado) ────
comment on table public.bitacora_auditoria is
  'Constancia de quien cambio que. Solo `service_role` escribe (por `bitacora_escritura.ts`): `anon` y `authenticated` tienen una unica policy de SELECT, y RLS niega INSERT/UPDATE/DELETE por ausencia de policy. Los GRANTS de tabla todavia dicen update/delete (la 0195 revoco solo INSERT); revocarlos es el segundo candado pendiente de la auditoria 24 (SEG-2).';
