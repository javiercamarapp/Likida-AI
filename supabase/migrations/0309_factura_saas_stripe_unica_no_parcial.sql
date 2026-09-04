-- ═══════════════════════════════════════════════════════════════════════════
-- AUDITORÍA 25 · DATOS-A2 (ALTO) — `factura_saas_stripe_unica` no puede
-- seguir siendo un índice PARCIAL: el webhook de Stripe lo usa como blanco
-- de `onConflict` y PostgREST no puede inferirlo. LA MISMA trampa que la
-- 0176 ya documentó y arregló para `posicion` hace dos años (0176:59-67).
--
-- El índice (0052:105-106):
--   create unique index if not exists factura_saas_stripe_unica
--     on public.factura_saas (stripe_invoice_id) where stripe_invoice_id is not null;
--
-- El llamador (suscripcion.ts:865-891):
--   .upsert({...}, { onConflict: 'stripe_invoice_id' })
--
-- PostgREST traduce eso a `INSERT … ON CONFLICT (stripe_invoice_id) DO
-- UPDATE …` SIN predicado. Postgres solo infiere un único PARCIAL si el
-- ON CONFLICT repite su WHERE — que PostgREST no puede escribir porque el
-- cliente solo manda el nombre de columna, no el índice. Sin eso, aborta con
-- 42P10: «there is no unique or exclusion constraint matching the ON
-- CONFLICT specification». Cuando la primera flota pague por Stripe:
-- `route.ts:232` llama `aplicarFactura` → 42P10 → el webhook contesta 500 →
-- Stripe reintenta hasta rendirse → la factura JAMÁS entra a la base, aunque
-- el cobro sí ocurrió en Stripe.
--
-- Y el predicado es DECORATIVO desde el día uno: un índice único NO parcial
-- sobre una columna nullable ya trata cada NULL como distinto entre sí (regla
-- estándar de Postgres para únicos), así que `where stripe_invoice_id is not
-- null` no compra ninguna unicidad que el índice no tuviera sin él — las
-- filas con `stripe_invoice_id is null` (pago por transferencia, según el
-- CHECK `factura_saas_metodo_coherente` de la 0163) nunca iban a competir de
-- todas formas.
--
-- Mismo mecanismo que 0176:65-67 sobre `uq_posicion_lectura`: soltar el
-- índice parcial y recrearlo SIN `where`. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

drop index if exists public.factura_saas_stripe_unica;
create unique index factura_saas_stripe_unica
  on public.factura_saas (stripe_invoice_id);

comment on index public.factura_saas_stripe_unica is
  'NO parcial a propósito (auditoría 25, DATOS-A2): el upsert de suscripcion.ts usa `onConflict: stripe_invoice_id` sin WHERE, y PostgREST no puede inferir un índice PARCIAL a partir de eso — Postgres aborta con 42P10. El predicado viejo (where stripe_invoice_id is not null) era además decorativo: un único no-parcial sobre columna nullable ya trata cada NULL como distinto. Mismo arreglo que 0176 le dio a uq_posicion_lectura.';
