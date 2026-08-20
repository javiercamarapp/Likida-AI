-- ═══════════════════════════════════════════════════════════════════════════
-- 0142 — AJUSTE DE necesidad_pct: "auxiliar administrativo" SOLO,
-- no era señal (20-ago-2026).
--
-- La 0140 sumaba +50 a necesidad_pct con `vacante ~* 'auxiliar administrativ'`,
-- pensando en vacantes como "Auxiliar Administrativo de Embarques" o "Auxiliar
-- administrativo Mesa de control" — donde el puesto SÍ toca el ciclo de viaje.
--
-- Al ordenar la base real por necesidad_pct desc (20-ago, investigación
-- profunda empresa por empresa) salió el patrón real: "auxiliar
-- administrativo/a" A SECAS es el título más común del censo para CUALQUIER
-- vacante de oficina — Qualtia Alimentos, Soriana, una dulcería, una empresa
-- de aires acondicionados. Ninguna de esas tiene nada que ver con liquidar
-- viajes. El patrón amplio infló necesidad_pct=50 en miles de filas que no
-- son la señal que la columna dice medir.
--
-- El arreglo: "auxiliar administrativ" solo cuenta si el resto de la vacante
-- SÍ nombra algo del ciclo de viaje/flota — si no, es una vacante de oficina
-- cualquiera y cae al tramo genérico (+25, igual que cualquier otra vacante
-- publicada). `liquidaci` y `cuadre` solos siguen valiendo +50 sin condición,
-- porque esos SÍ son inequívocos.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.prospecto drop column if exists necesidad_pct;

alter table public.prospecto
  add column necesidad_pct int generated always as (
    least(100,
      (case
        when vacante ~* 'liquidaci|cuadre' then 50
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
  'DERIVADO (0140, ajustado 0142): vacante de liquidacion/cuadre +50; "auxiliar administrativo" solo cuenta +50 si tambien nombra viaje/flota/diesel/combustible/caseta/embarque/mesa de control -- generico cae al tramo de +25 de cualquier otra vacante. Flota>=20 +25.';

create index if not exists idx_prospecto_necesidad on public.prospecto (necesidad_pct desc) where duplicado_de is null;
