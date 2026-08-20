-- ═══════════════════════════════════════════════════════════════════════════
-- 0143 — AJUSTE DE necesidad_pct: "liquidación de pagos" no es "liquidación
-- de viajes" (20-ago-2026).
--
-- La 0140/0142 sumaban +50 sin condición a cualquier `vacante ~* 'liquidaci'`,
-- pensando en "Auxiliar de Liquidaciones" (viajes de operadores) o "Coordinador
-- de Liquidaciones" (flota). Pero "liquidación" también es vocabulario estándar
-- de finanzas/tesorería — "Analista de Liquidaciones de Pagos" (Soriana),
-- "Analista de Operaciones Liquidación y Compensación" (Copayment de México,
-- una fintech de pagos) son la MISMA palabra, un dolor completamente distinto.
-- El patrón amplio les daba el mismo necesidad_pct=50 que a un transportista
-- real con "Coordinador de Liquidaciones" de flota.
--
-- El arreglo: "liquidaci" sigue valiendo +50 sin condición EXCEPTO cuando la
-- vacante también nombra "de pagos" o "compensación" — el vocabulario que
-- delata liquidación financiera, no de viajes. `cuadre` y el resto de la
-- fórmula (auxiliar administrativo con contexto de flota/diésel, ajustado en
-- 0142) no cambian.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.prospecto drop column if exists necesidad_pct;

alter table public.prospecto
  add column necesidad_pct int generated always as (
    least(100,
      (case
        when vacante ~* 'liquidaci' and vacante !~* 'de pagos|compensaci[oó]n' then 50
        when vacante ~* 'cuadre' then 50
        when vacante ~* 'auxiliar administrativ'
             and vacante ~* 'viaje|flota|diesel|di[eé]sel|combustible|caseta|embarque|operativ|mesa de control'
          then 50
        when vacante is not null then 25
        else 0
      end) +
      (case when num_unidades is not null and num_unidades >= 20 then 25 else 0 end)
    )
  ) stored;

comment on column public.prospecto.necesidad_pct is
  'DERIVADO (0140, ajustado 0142 y 0143): vacante de liquidacion +50 EXCEPTO si nombra "de pagos"/"compensacion" (liquidacion financiera, no de viajes); cuadre +50; "auxiliar administrativo" solo +50 si tambien nombra viaje/flota/diesel/combustible/caseta/embarque/mesa de control -- generico cae a +25. Flota>=20 +25.';

create index if not exists idx_prospecto_necesidad on public.prospecto (necesidad_pct desc) where duplicado_de is null;
