-- ═══════════════════════════════════════════════════════════════════════════
-- LA 0036 BLINDABA EL INSERT. EL UPDATE SEGUÍA ABIERTO.
--
-- AUDITORÍA 8, ALTO (rubro modelo de datos). `updateGastoCfdiXml` (repo.ts:198)
-- pega el XML de un CFDI a un gasto que ya existe —el caso normal cuando un
-- ticket sin timbrar se aparea con su factura después— y ese UPDATE puede
-- cambiar `monto`, `sub_total`, `iva_traslado` e `ieps_traslado`: exactamente
-- las cifras que ya se imprimieron en el PDF si el viaje se liquidó entre
-- medias. El trigger `trg_gasto_no_tras_liquidar` (0036) solo corre
-- `before insert on gasto`, así que ese UPDATE pasaba sin que nadie lo viera.
--
-- Reusa la MISMA función que la 0036: el candado (`for update` sobre `viaje`)
-- y el SQLSTATE `CU001` son los mismos, así que el processor ya sabe
-- distinguir este error con `llegoTarde()` sin cambios adicionales de ese lado.
-- ═══════════════════════════════════════════════════════════════════════════

drop trigger if exists trg_gasto_no_tras_liquidar_update on gasto;
create trigger trg_gasto_no_tras_liquidar_update
  before update on gasto
  for each row
  when (
    new.monto is distinct from old.monto
    or new.sub_total is distinct from old.sub_total
    or new.iva_traslado is distinct from old.iva_traslado
    or new.ieps_traslado is distinct from old.ieps_traslado
    or new.cfdi_uuid is distinct from old.cfdi_uuid
  )
  execute function gasto_no_tras_liquidar();
