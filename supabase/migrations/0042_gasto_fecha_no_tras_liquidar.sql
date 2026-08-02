-- La 0037 tampoco cubría `fecha` — `corregirFechaGasto` pasaba sin trigger.
--
-- AUDITORÍA 9, ALTO (tres auditores independientes: backend, seguridad,
-- modelo de datos). El `when` de `trg_gasto_no_tras_liquidar_update` (0037)
-- solo mira `monto`, `sub_total`, `iva_traslado`, `ieps_traslado` y
-- `cfdi_uuid`. `corregirFechaGasto` (repo.ts), nueva en la ronda 9, hace
-- `UPDATE gasto SET fecha = ...` — el trigger ni siquiera se dispara para esa
-- columna, así que una foto de re-fecha que llega DESPUÉS de liquidar el
-- viaje reescribe `gasto.fecha` en silencio, sin el `CU001` que
-- `processor.ts` ya sabe traducir (`if (llegoTarde(e)) …`, código que existe
-- y nunca corre).
--
-- La fecha decide ejercicio, plazo de facturación y la agrupación del tope
-- diario de LISR 28-V — no es una columna cosmética. Se agrega al `when` de
-- la MISMA función y el MISMO trigger que ya existen; no hace falta una
-- función nueva.

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
    or new.fecha is distinct from old.fecha
  )
  execute function gasto_no_tras_liquidar();
