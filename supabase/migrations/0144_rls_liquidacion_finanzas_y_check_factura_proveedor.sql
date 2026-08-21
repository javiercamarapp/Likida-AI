-- ═══════════════════════════════════════════════════════════════════════════
-- 0144 — RLS de liquidacion por rol financiero + CHECK de factura_proveedor
-- (auditoría 2, 21-ago-2026). IDEMPOTENTE: segura de re-correr.
--
-- 1) liquidacion: su política `tenant_data` solo checaba tenant_id, a diferencia
--    de cliente/pago_recibido/factura_emitida que gatean por ve_finanzas(). Un
--    `encargado` (excluido del dinero en la app, visibilidad.ts) podía leer/
--    escribir liquidaciones por PostgREST directo con su sesión. Se alinea el
--    RLS con la app. El cron/processor usan service-role (saltan RLS): intactos.
-- 2) factura_proveedor: sin CHECK, un total ≤ 0 (nota de crédito, complemento
--    de pago, cero) podía aprobarse y exportarse al ERP del cliente.
-- ═══════════════════════════════════════════════════════════════════════════

drop policy if exists tenant_data on public.liquidacion;
drop policy if exists tenant_finanzas on public.liquidacion;
create policy tenant_finanzas on public.liquidacion
  for all
  using ((((tenant_id = any (get_user_tenant_ids())) and ve_finanzas()) or is_superadmin()))
  with check ((((tenant_id = any (get_user_tenant_ids())) and ve_finanzas()) or is_superadmin()));

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'factura_proveedor_total_positivo') then
    alter table public.factura_proveedor add constraint factura_proveedor_total_positivo check (total > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'factura_proveedor_conceptos_positivo') then
    alter table public.factura_proveedor add constraint factura_proveedor_conceptos_positivo check (conceptos > 0);
  end if;
end $$;
