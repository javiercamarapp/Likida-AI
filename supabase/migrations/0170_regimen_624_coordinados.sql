-- 0170 — FISC-C2-4: clave 624 (Coordinados, LISR 72-73) en el dominio de
-- `tenant.regimen_fiscal`. RFA 2026 regla 2.9 admite Título II Cap. VII
-- (624) y Título IV Cap. II Secc. I (612). Sin 624, un coordinado real no
-- podía declararse: la facilidad del 15% solo la alcanzaba una PF 612, y el
-- PAC no recibía el régimen del receptor al timbrar la mensualidad.
--
-- No se toca 0056: las migraciones ya aplicadas no se reescriben. Este CHECK
-- reemplaza el de 0056 con las mismas claves más 624.
--
-- Sincronizado con `REGIMENES` en src/lib/saas/fiscal.ts. Si divergen, el
-- formulario ofrece una opción que el insert rechaza.

alter table public.tenant drop constraint if exists tenant_regimen_fiscal_dominio;
alter table public.tenant add constraint tenant_regimen_fiscal_dominio
  check (regimen_fiscal is null or regimen_fiscal in (
    '601',  -- General de Ley Personas Morales
    '603',  -- Personas Morales con Fines no Lucrativos
    '612',  -- Personas Fisicas con Actividades Empresariales y Profesionales
    '621',  -- Incorporacion Fiscal
    '624',  -- Coordinados (LISR 72-73 / RFA 2.9)
    '626'   -- RESICO
  ));
