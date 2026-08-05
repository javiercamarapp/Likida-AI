-- 0070 — Las dos columnas del camino del dinero que aceptaban NEGATIVOS.
--
-- AUDITORÍA DE DATOS, CRÍTICO. El esquema YA protegía lo demás:
--   · `pago_recibido.monto > 0`   (pago_monto_positivo)
--   · `tarifa.precio > 0`         (tarifa_precio_positivo)
--   · `factura_emitida`           (factura_importes_positivos: subtotal/iva/total >= 0)
--   · `cotizacion`                (cotizacion_importes: costo/precio >= 0)
--   · `viaje.intake_pendientes >= 0`
-- pero `gasto.monto` y `viaje.anticipo` solo tenían un check contra `NaN`. Son
-- justo las dos que entran a la resta del cuadre, así que eran las dos que
-- importaban. Comprobado contra la base: `monto = -99999` ENTRABA.
--
-- POR QUÉ ES DEL CAMINO DEL DINERO. La liquidación es
-- `diferencia = total_anticipo - total_comprobado`. Un comprobante negativo no
-- suma de menos: RESTA del comprobado, así que infla la diferencia dos veces su
-- valor. El PDF entonces le dice al chofer que debe dinero que no debe — y el
-- PDF es el entregable que el contralor cruza con su contador. Un signo mal
-- leído por el OCR bastaba.
--
-- ── POR QUÉ `>= 0` Y NO `> 0` EN CADA UNA ────────────────────────────────
--
-- `viaje.anticipo` → **`>= 0` es obligatorio**, no una concesión. Su DEFAULT en
-- el esquema es `0`: un viaje sin anticipo es el caso NORMAL, no una anomalía.
-- Un `> 0` aquí rompería la inserción de todo viaje que no lleve adelanto.
--
-- `gasto.monto` → **`>= 0` a propósito.** El cero no es un comprobante con
-- sentido, pero tampoco hace daño: aporta 0 al comprobado y no mueve la
-- diferencia. El daño que esta migración cierra es el NEGATIVO, que sí resta.
-- Se elige el piso que mata el daño sin arriesgar un camino legítimo que hoy no
-- se puede descartar (un ticket que el OCR lee en 0 y que el encargado corrige
-- después vale más como fila visible en 0 que como inserción rechazada, porque
-- rechazada desaparece y nadie la revisa). Si algún día se decide que un gasto
-- en 0 es siempre un error de captura, el cambio es de `>= 0` a `> 0` y esta
-- migración es el lugar donde se documenta por qué no se hizo hoy.
--
-- SE VALIDAN DE INMEDIATO (sin `NOT VALID`) porque la base está VACÍA: 0 flotas,
-- 0 viajes, 0 gastos. Es el momento en que validar no cuesta nada y no puede
-- fallar por datos viejos. Dentro de un mes ya no lo es.

alter table public.gasto
  add constraint gasto_monto_no_negativo check (monto >= 0);

alter table public.viaje
  add constraint viaje_anticipo_no_negativo check (anticipo >= 0);
