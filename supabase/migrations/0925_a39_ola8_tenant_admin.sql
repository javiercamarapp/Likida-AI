-- REVERSA: `alter table public.tenant drop column if exists rfc_sat_verificado;` (la columna solo la lee la descarga masiva del SAT; sin ella el código de esa descarga falla cerrado, no abre buzones). No hay datos que reponer: la columna nace vacía y solo la llena Likida.
-- ═══════════════════════════════════════════════════════════════════════════
-- 0925 — AUDITORÍA 39, OLA 8, lote O8-1-tenant-admin.
--
-- A39-S57-01 (CRÍTICO): el candado de la descarga masiva del SAT (A37-S57-01)
-- ataba el RFC del buzón a `tenant.rfc` suponiendo que ninguna pantalla de la
-- flota lo escribe. Falso: `guardarDatosFiscales` (dashboard/suscripcion) lo
-- escribe porque es el RFC del RECEPTOR de la factura de Likida a la flota. La
-- flota A podía poner el RFC de la flota B (público, sale en cada CFDI),
-- declararlo como buzón y bajar sus CFDI con la cuenta compartida del PAC.
--
-- Se separan las dos ideas: `tenant.rfc` sigue siendo el RFC de facturación
-- (editable por la flota); `tenant.rfc_sat_verificado` es el RFC cuya
-- pertenencia VERIFICÓ Likida y es el único que autoriza un buzón. NINGÚN
-- código de flota lo escribe (lo fija el alta de Likida o un UPDATE de
-- Likida). Nace NULL a propósito: no se copia `tenant.rfc` porque ese valor
-- pudo teclearlo la propia flota; mientras esté vacío, la descarga no abre
-- buzón (falla cerrado). Aditiva e idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.tenant add column if not exists rfc_sat_verificado text;

comment on column public.tenant.rfc_sat_verificado is
  'RFC cuya pertenencia a la flota verificó Likida (A39-S57-01). Único RFC que autoriza un buzón de la descarga masiva del SAT. Solo lo escribe Likida; NO es tenant.rfc, que la flota edita desde Suscripción.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'tenant_rfc_sat_verificado_forma' and conrelid = 'public.tenant'::regclass
  ) then
    alter table public.tenant
      add constraint tenant_rfc_sat_verificado_forma
      check (rfc_sat_verificado is null or rfc_sat_verificado ~ '^[A-ZÑ&0-9]{12,13}$');
  end if;
end $$;
