-- ═══════════════════════════════════════════════════════════════════════════
-- 0140 — INVESTIGACIÓN PROFUNDA Y SCORE DE FILTRADO (19-ago-2026)
--
-- Pedido de Javier: que cada prospecto del censo traiga, además de contacto y
-- decisor, el tamaño de flota, una historia breve, y un score de filtrado en
-- porcentaje. La regla del producto ("nunca inventar una cifra",
-- CLAUDE.md) aplica igual aquí: un LLM adivinando "73% de similitud" por
-- empresa sería precisión falsa e inconsistente entre agentes y entre
-- corridas — 33,000 números sin fórmula común no son un dato, son ruido.
--
-- Por eso se separan dos cosas distintas:
--
--   - num_unidades / historia SON HECHOS: los escribe el agente que
--     investiga, null si no lo encontró — igual que sitio/contacto_nombre.
--   - similitud_icp_pct / necesidad_pct / viajes_mes_estimado SON
--     DERIVADOS: columnas GENERADAS (STORED) con una fórmula fija y
--     documentada aquí mismo, calculada SOLO de columnas ya verificadas.
--     Se recalculan solas cuando cambia el hecho de origen — nunca las
--     escribe un agente, nunca se desincronizan, y aplican YA a las 32,890
--     filas existentes en cuanto se corre esta migración (no hace falta
--     re-investigar nada para empezar a filtrar por ellas).
--
-- FÓRMULA similitud_icp_pct (0-100, qué tanto calza con el ICP de Likida):
--   +40 si scian en (484,485,488)      — transportista de carga, el giro correcto
--   +25 si vacante no es null           — publicó el dolor que Likida resuelve
--   +20 si num_unidades >= 10           — flota con volumen real de liquidaciones
--   +15 si sitio_verificado             — el dato de la empresa está confirmado
--   Máximo 100. Un prospecto sin ninguna señal da 0 (no null a propósito: el
--   punto de la columna es poder ordenar/filtrar por ella siempre).
--
-- FÓRMULA necesidad_pct (0-100, qué tan urgente es el dolor):
--   +50 si vacante ilike 'liquidaci%'/'cuadre%'/'auxiliar administrativ%'
--       — el puesto que buscan ES el trabajo que Likida automatiza
--   +25 si vacante no es null (cualquier otra vacante — ya señaló que contrata)
--   +25 si num_unidades >= 20            — a más flota, más dolor manual
--   Máximo 100.
--
-- FÓRMULA viajes_mes_estimado (declarada, NO medida — mismo principio que
-- MINUTOS_CAPTURA_MANUAL en analytics.ts: toda estimación se muestra con su
-- supuesto a la vista, nunca como si fuera dato medido):
--   num_unidades × 18 viajes/unidad/mes (supuesto de sector: una unidad de
--   carga troncal en México hace ~1 viaje redondo cada 1.5 días hábiles).
--   NULL si num_unidades es null — nunca se encadena un supuesto sobre otro.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.prospecto
  add column if not exists num_unidades int
    constraint prospecto_num_unidades_no_negativo check (num_unidades is null or num_unidades >= 0),
  add column if not exists historia text;

comment on column public.prospecto.num_unidades is
  'Tamaño de flota (numero de camiones/unidades), del sitio oficial o prensa. NULL = no se encontro, no se infiere.';
comment on column public.prospecto.historia is
  '2-3 lineas de contexto real de la empresa (a que se dedica, desde cuando, a quien le vende). NULL = no se encontro.';

alter table public.prospecto
  add column if not exists similitud_icp_pct int generated always as (
    least(100,
      (case when scian in ('484', '485', '488') then 40 else 0 end) +
      (case when vacante is not null then 25 else 0 end) +
      (case when num_unidades is not null and num_unidades >= 10 then 20 else 0 end) +
      (case when sitio_verificado then 15 else 0 end)
    )
  ) stored,
  add column if not exists necesidad_pct int generated always as (
    least(100,
      (case
        when vacante ~* 'liquidaci|cuadre|auxiliar administrativ' then 50
        when vacante is not null then 25
        else 0
      end) +
      (case when num_unidades is not null and num_unidades >= 20 then 25 else 0 end)
    )
  ) stored,
  add column if not exists viajes_mes_estimado int generated always as (
    case when num_unidades is not null then num_unidades * 18 else null end
  ) stored;

comment on column public.prospecto.similitud_icp_pct is
  'DERIVADO, no lo escribe ningun agente (0140): scian correcto +40, vacante publicada +25, flota>=10 +20, sitio_verificado +15. Formula completa en la cabecera de esta migracion.';
comment on column public.prospecto.necesidad_pct is
  'DERIVADO (0140): vacante de liquidacion/cuadre +50 (cualquier otra vacante +25), flota>=20 +25.';
comment on column public.prospecto.viajes_mes_estimado is
  'ESTIMADO declarado (0140): num_unidades x 18 viajes/unidad/mes (supuesto de sector, no medido). NULL si no se sabe la flota — nunca se encadena sobre otro supuesto.';

create index if not exists idx_prospecto_similitud on public.prospecto (similitud_icp_pct desc) where duplicado_de is null;
create index if not exists idx_prospecto_necesidad on public.prospecto (necesidad_pct desc) where duplicado_de is null;
