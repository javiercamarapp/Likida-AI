-- ═══════════════════════════════════════════════════════════════════════════
-- LOS PRECIOS DE LOS PLANES, EN MODO LIVE (18-ago-2026).
--
-- Hasta hoy `plan.precio_mensual` y `plan.stripe_price_id` estaban en NULL a
-- propósito —la 0052 lo dice: "un precio de ejemplo acaba en una propuesta
-- comercial"—. Ya no es un ejemplo: los products y prices existen en la cuenta
-- live `acct_1U5sFC3o5MSd1TP7` y esto los amarra al catálogo.
--
--   flota  → price_1U5tAD3o5MSd1TP7Bb3Om9pa   $17,500.00 MXN / mes
--   demo   → price_1U5tAw3o5MSd1TP7ZLkOzSMH    $1,900.00 MXN / mes
--   empresa → SIN precio, y así se queda: se cotiza caso por caso. La pantalla
--             ya dice "no se puede contratar en línea" en vez de fingir.
--
-- DE DÓNDE SALEN LOS $17,500. Del tabulador de $35 por viaje contra el cupo del
-- plan (500 × 35). El de demo, de $38 × 50. El cupo es el que ya vivía en
-- `limite_viajes_mes` desde la 0052, no una cifra nueva.
--
-- EL IVA VA POR FUERA. Los dos prices se crearon con `tax_behavior: exclusive`,
-- que es como se cotiza en B2B mexicano: la flota ve $17,500 + IVA y el CFDI
-- desglosa subtotal e impuesto. Por eso `precio_iva_incluido = false` y no NULL:
-- con NULL, `emitirMensualidad` se niega a timbrar (0066), que es lo correcto
-- cuando no se sabe, pero aquí sí se sabe.
--
-- ESTO NO SUSTITUYE A `guardarPriceDePlan()`. Esa función existe para que el
-- monto NO se teclee: lo trae de Stripe al guardar el price id. Aquí se teclea
-- porque la migración no puede llamar a la API, así que los valores se copiaron
-- de la propia pantalla del price en Stripe. Si alguna vez divergen, la cura es
-- volver a guardar el price id desde /admin/costos-facturacion: esa ruta relee
-- de Stripe y pisa estas cuatro columnas con la verdad.
-- ═══════════════════════════════════════════════════════════════════════════

update public.plan
   set stripe_price_id     = 'price_1U5tAD3o5MSd1TP7Bb3Om9pa',
       precio_mensual      = 17500.00,
       moneda              = 'MXN',
       precio_iva_incluido = false
 where clave = 'flota';

update public.plan
   set stripe_price_id     = 'price_1U5tAw3o5MSd1TP7ZLkOzSMH',
       precio_mensual      = 1900.00,
       moneda              = 'MXN',
       precio_iva_incluido = false
 where clave = 'demo';

-- `empresa` se deja explícitamente sin precio. El `update` no es redundante:
-- si una corrida anterior le puso un price de sandbox, con llaves live ese id
-- no existe y el checkout reventaría en la cara del cliente. Más vale que diga
-- "se cotiza" a que falle al cobrar.
update public.plan
   set stripe_price_id     = null,
       precio_mensual      = null,
       precio_iva_incluido = null
 where clave = 'empresa';
