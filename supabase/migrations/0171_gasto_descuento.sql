-- ═══════════════════════════════════════════════════════════════════════════
-- 0171 — `gasto.descuento`: el estímulo de peaje deja de calcularse sobre una
--        base que el emisor ya había descontado
--
-- El 50% de peaje (RMF 9.1.8) se calcula sobre `sub_total`, que es el
-- `@SubTotal` del CFDI. Pero el CFDI 4.0 tiene además un atributo `@Descuento`
-- —opcional, y por eso fácil de olvidar— que resta de esa base. El parser lo
-- tiraba y ninguna capa lo conocía, así que una factura de casetas con
-- descuento acreditaba de más:
--
--   SubTotal $120,000 · Descuento $18,000 · base real $102,000
--   estímulo correcto  = $51,000
--   estímulo que salía = $60,000   ← nueve mil pesos que no proceden
--
-- La columna es NULLABLE a propósito: `null` es "el CFDI no trae descuento"
-- (el caso normal), y se distingue de un `0` declarado. Nada de defaults: una
-- base fiscal no se rellena sola.
--
-- No hay que recalcular el histórico aquí: las liquidaciones ya cerradas
-- conservan la cifra con la que se cerraron, que es como debe ser. Lo que
-- cambia es de aquí en adelante.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.gasto add column if not exists descuento numeric(12,2);

alter table public.gasto drop constraint if exists gasto_descuento_no_negativo;
alter table public.gasto add constraint gasto_descuento_no_negativo
  check (descuento is null or descuento >= 0);

comment on column public.gasto.descuento is
  '@Descuento del Comprobante (CFDI 4.0, opcional). Resta de sub_total para formar la base del estímulo de peaje (RMF 9.1.8). NULL = el CFDI no lo trae.';
