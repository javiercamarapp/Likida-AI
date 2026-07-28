-- Un CFDI, un gasto. Red de seguridad contra el mismo comprobante contado dos veces.
--
-- El UUID de un CFDI es único por definición: dos gastos con el mismo UUID son
-- el mismo comprobante cobrado dos veces, y eso infla el total comprobado con
-- dinero que no se gastó.
--
-- El código ya lo evita por varios lados (`emparejarXmlConTicket`,
-- `detectarDuplicadosEntreViajes`), pero todos esos son read-then-write y las
-- fotos de una ráfaga de WhatsApp corren en paralelo: entre el "¿ya existe?" y
-- el INSERT cabe otro INSERT. Eso solo lo cierra la base.
--
-- PARCIAL, y esto importa: `where cfdi_uuid is not null`. Un ticket de
-- gasolinera NO trae UUID, y en Postgres los NULL no colisionan entre sí — sin
-- el `where` el índice igual funcionaría, pero indexaría miles de filas NULL
-- para nada. Y deja claro en el esquema que un gasto sin timbrar es lo NORMAL,
-- no una excepción.
--
-- Nombre explícito: el processor tiene que distinguir CUÁL índice chocó para
-- saber si el 23505 es benigno. Con un nombre generado no se puede.
create unique index if not exists uq_gasto_cfdi_uuid
  on gasto (tenant_id, cfdi_uuid)
  where cfdi_uuid is not null;

comment on index uq_gasto_cfdi_uuid is
  'Un CFDI timbrado = un gasto por tenant. Parcial: los tickets sin timbrar (NULL) quedan fuera.';

-- NO se agrega CHECK (monto > 0), y es a propósito.
--
-- La auditoría lo pedía, pero sería un RETROCESO. Hoy un comprobante cuyo monto
-- el OCR no supo leer entra a la tabla, el motor lo marca `monto_invalido`
-- (engine.ts:107), lo excluye del total y del acreditamiento, y manda el viaje a
-- REVISAR. El contralor lo ve y lo corrige a mano.
--
-- Con el CHECK, el INSERT fallaría: el gasto no entra, y nadie se entera nunca
-- de que hubo un comprobante ilegible. La foto se pierde en silencio. Un dato
-- malo VISIBLE vale más que un dato ausente.
