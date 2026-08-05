-- ═══════════════════════════════════════════════════════════════════════════
-- 0078 — RLS: el chofer pierde la escritura (y la lectura) de lo que no es suyo
--
-- Auditoría 11 (pase 2, SEC-C2 y DATOS-C2) y auditoría 10 (seguridad): la 0045
-- excluyó a `operador` de `tenant_data` SOLO en viaje/gasto/liquidacion. Las
-- otras tablas que nacieron con `tenant_data` a secas —sin mirar el rol— se
-- quedaron abiertas, y dos migraciones nuevas (0009, 0076) repitieron el mismo
-- patrón. Un chofer con sesión web (app_user rol=operador) + la anon key
-- pública podía, por PostgREST:
--
--   • `operador`       → leer y MODIFICAR los teléfonos y nombres de TODA la
--                        flota (y cambiarse el suyo para robar la identidad de
--                        WhatsApp de un compañero).
--   • `wa_conversacion` → leer el historial de chats de todos los choferes
--                        (datos personales de terceros, LFPDPPP).
--   • `cfdi_xml`        → leer el XML crudo de los CFDI de la flota entera
--                        (RFC, montos, proveedores).
--   • `cfdi_consolidado_linea` → leer montos del monedero/TAG de toda la flota.
--   • `llm_costo`       → leer lo que cuesta cada liquidación.
--   • `terminal`, `politica_gasto` → leer/escribir.
--   • `tenant` (`tenant_self` era `for all`) → REESCRIBIR el rfc, la política
--                        de gastos y el domicilio fiscal de la propia flota —
--                        el chofer editando la regla que lo juzga — y hasta
--                        borrar la fila del tenant.
--
-- El patrón correcto ya existe en la 0047/0050/0051:
--   using ((tenant_id = any(get_user_tenant_ids()) and not is_operador()) or is_superadmin())
--
-- Y para `tenant`: la app escribe SIEMPRE por service_role (server actions,
-- supabaseAdmin), así que por RLS nadie debe escribir — solo leer.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Las seis tablas que arrastran el `tenant_data` viejo ────────────────
--    (0001: terminal/operador/politica_gasto/wa_conversacion; 0003: llm_costo;
--     0009: cfdi_xml; 0076: cfdi_consolidado_linea)
do $$
declare t text;
begin
  foreach t in array array['terminal', 'operador', 'politica_gasto', 'wa_conversacion', 'llm_costo', 'cfdi_xml', 'cfdi_consolidado_linea']
  loop
    execute format('drop policy if exists tenant_data on %I', t);
    execute format($p$
      create policy tenant_data on %I for all
      using ((tenant_id = any(get_user_tenant_ids()) and not is_operador()) or is_superadmin())
      with check ((tenant_id = any(get_user_tenant_ids()) and not is_operador()) or is_superadmin())
    $p$, t);
  end loop;
end $$;

-- ── 2. `tenant` deja de ser escribible por RLS ─────────────────────────────
--    La app nunca escribe `tenant` con el cliente de sesión: todas las
--    escrituras (crearFlota, editar política, reabrir) van por supabaseAdmin()
--    (service_role, bypasea RLS). Un `for all` por RLS le daba al chofer —y a
--    cualquier rol del tenant— la llave para reescribir el RFC de la flota.
drop policy if exists tenant_self on tenant;
create policy tenant_self on tenant for select
  using (id = any(get_user_tenant_ids()) or is_superadmin());

comment on policy tenant_self on public.tenant is
  'SOLO lectura por RLS (0078): la app escribe tenant por service_role en server actions; por PostgREST nadie edita la fila de la flota (antes era `for all` y un rol=operador reescribía el rfc/politica).';
