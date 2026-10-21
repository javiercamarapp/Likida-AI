-- ═══════════════════════════════════════════════════════════════════════════
-- 0845 · AUDITORÍA ADVERSARIAL (ALTO #2) — el CFDI real que llega DESPUÉS de
--       que un humano ya decidió (aprobó o rechazó) la factura.
--
-- `completarFacturaConXml` (buzon/repo.ts) solo completaba la fila cuando
-- `estado = 'pendiente'`. Si el folio ya estaba decidido, el UPDATE afectaba 0
-- filas y la función devolvía `false` SIN GUARDAR NADA: el XML del correo (dato
-- duro del CFDI — RFCs, totales, UUID) se perdía para siempre. Es evidencia
-- fiscal (CFF art. 30: conservación 5 años) y no puede desecharse por llegar
-- tarde ni por el orden en que llegaron PDF y XML.
--
-- Esta migración NO toca la decisión ya tomada (estado/decidido_por/decidido_en
-- quedan intactos a propósito — no es de este arreglo decidir qué hacer con una
-- aprobación o un rechazo ya firmado por una persona) ni los campos que esa
-- persona vio al decidir (descripcion, total, etc., que pudieron venir de una
-- LECTURA de PDF/foto). Solo agrega DOS columnas, en su propio namespace
-- "_tardio", para que el XML real quede guardado y sea recuperable — nunca
-- descartado silenciosamente:
--
--   xml_crudo_tardio   — el XML completo tal como llegó (el dato duro del CFDI;
--                        de él se puede re-derivar cualquier campo si algún día
--                        hace falta, sin inventar una segunda copia de cada
--                        columna del CFDI).
--   recibido_tardio_en — cuándo llegó, para la bitácora/pantalla.
--
-- `null` en ambas = nunca llegó un XML tardío (el caso normal). Las dos van
-- juntas (CHECK de coherencia) y SOLO se llenan una vez: un segundo correo con
-- el mismo folio es el mismo CFDI (inmutable por definición del SAT), así que
-- sobrescribir no pierde nada — pero el código (repo.ts) de todas formas solo
-- escribe la primera vez (`is tardio null`) para que la fecha sea la de la
-- PRIMERA llegada tardía, igual que `exportada_en` en 0091/0108.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.factura_proveedor
  add column if not exists xml_crudo_tardio   text,
  add column if not exists recibido_tardio_en timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'factura_proveedor_cfdi_tardio_coherente') then
    alter table public.factura_proveedor
      add constraint factura_proveedor_cfdi_tardio_coherente
      check ((xml_crudo_tardio is null) = (recibido_tardio_en is null));
  end if;
end $$;

comment on column public.factura_proveedor.xml_crudo_tardio is
  'El XML real del CFDI cuando llegó por el buzón DESPUÉS de que la factura ya estaba aprobada o rechazada (completarFacturaConXml, buzon/repo.ts). NUNCA se pierde: antes de la 0845 este caso devolvía sin guardar nada. NO reemplaza xml_crudo (que sigue siendo lo que vio la persona al decidir) ni cambia estado/decidido_por/decidido_en — es evidencia fiscal adicional (CFF 30), no una corrección retroactiva de la decisión.';
comment on column public.factura_proveedor.recibido_tardio_en is
  'Cuándo llegó el XML tardío (NULL si nunca llegó uno). Junto con xml_crudo_tardio, siempre los dos null o los dos llenos.';
