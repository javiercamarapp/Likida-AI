-- ═══════════════════════════════════════════════════════════════════════════
-- 0225 — EL COTIZADOR DE GANANCIA REAL (A8 del plan, priorizado por Javier el
-- 27-ago-2026; etapa 1 del ciclo de 14 — 18-Cierre §Fase 9).
--
-- La tabla `cotizacion` existe desde la 0051 con lector (`getCotizaciones`) y
-- CERO flujo: nadie la escribía. Esta migración le da al cotizador lo que la
-- 0051 no tenía, sin duplicar lo que sí:
--
--   1. `cotizador_config` — los costos DECLARADOS por la flota: diésel por
--      km, salario y viáticos por día, fijos prorrateados por km, el factor
--      de regreso vacío y el margen objetivo. TODO anulable: NULL = "no
--      declarado", y el motor entonces NO sugiere precio — lista qué falta
--      (la doctrina de la calculadora pública, puertas adentro). Ningún
--      valor se siembra: un costo de diésel inventado produce exactamente la
--      cotización que pierde dinero con cara de ganancia.
--
--   2. Autoría y desglose en `cotizacion`: quién la creó, quién la decidió y
--      el desglose CITABLE del cálculo tal cual se enseñó al cotizar
--      (jsonb) — si mañana cambian los costos declarados, la cotización de
--      ayer sigue diciendo con qué números se armó (mismo contrato que el
--      XML de Carta Porte 0214: lo citable es lo que salió).
--
--   3. El claim de conversión: `decidida_en` es el sello de "alguien ya está
--      decidiendo esta cotización" — el doble clic de "ganada" lo resuelve
--      un UPDATE condicional sobre NULL (patrón talacha/0201), no un `if`.
--      El CHECK `cotizacion_ganada_completa` de la 0051 (ganada exige precio
--      y viaje) queda intacto y es la otra mitad del candado.
--
-- Las casetas MEDIDAS no viven aquí: se computan al leer desde los gastos
-- 'caseta' de viajes liquidados de la misma ruta (persistirlas sería una
-- segunda verdad que se desactualiza con cada viaje nuevo — criterio 0207).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Los costos declarados de la flota ───────────────────────────────────
create table if not exists public.cotizador_config (
  tenant_id            uuid primary key references public.tenant(id) on delete cascade,
  -- $/km de diésel (o el equivalente que la flota declare). NULL = sin declarar.
  diesel_por_km        numeric(10,4),
  -- Lo que cuesta el operador por día de viaje (salario prorrateado).
  salario_dia          numeric(12,2),
  viaticos_dia         numeric(12,2),
  -- Fijos prorrateados por km (seguros, admin, depreciación) — como la flota
  -- los declare; el supuesto viaja a la vista en cada cotización.
  fijos_por_km         numeric(10,4),
  -- Multiplicador sobre los costos por km para cubrir el regreso: 1 = el
  -- cliente paga solo la ida y el regreso se consigue cargado; 2 = la ruta
  -- se cobra redonda. Entre 1 y 3; NULL = sin declarar.
  factor_regreso_vacio numeric(4,2),
  -- Margen objetivo sobre el costo, en % (markup declarado). 0–90.
  margen_objetivo_pct  numeric(5,2),
  actualizado_en       timestamptz not null default now(),
  -- Quién declaró; se conserva aunque el usuario se borre (criterio 0207).
  actualizado_por      uuid references public.app_user(id) on delete set null,
  constraint cotizador_config_sanos check (
        (diesel_por_km is null or (diesel_por_km >= 0 and diesel_por_km <> 'NaN'::numeric))
    and (salario_dia is null or (salario_dia >= 0 and salario_dia <> 'NaN'::numeric))
    and (viaticos_dia is null or (viaticos_dia >= 0 and viaticos_dia <> 'NaN'::numeric))
    and (fijos_por_km is null or (fijos_por_km >= 0 and fijos_por_km <> 'NaN'::numeric))
    and (factor_regreso_vacio is null or (factor_regreso_vacio >= 1 and factor_regreso_vacio <= 3))
    and (margen_objetivo_pct is null or (margen_objetivo_pct >= 0 and margen_objetivo_pct <= 90))
  )
);

comment on table public.cotizador_config is
  'Los costos DECLARADOS por la flota para cotizar (0225): $/km de diésel, salario/viáticos por día, fijos por km, factor de regreso y margen objetivo. NULL = no declarado — el cotizador entonces no sugiere precio y dice qué falta. El único escritor es cotizador/lector.ts.';

-- Mismo doble candado que 0196/0198/0215: RLS deny-all + solo el servidor.
alter table public.cotizador_config enable row level security;
revoke all on table public.cotizador_config from public, anon, authenticated;
grant select, insert, update, delete on table public.cotizador_config to service_role;

-- ── 2. Autoría, desglose citable y el sello de decisión ────────────────────
alter table public.cotizacion
  add column if not exists desglose     jsonb,
  add column if not exists creada_por   uuid references public.app_user(id) on delete set null,
  add column if not exists decidida_por uuid references public.app_user(id) on delete set null,
  add column if not exists decidida_en  timestamptz;

comment on column public.cotizacion.desglose is
  'El cálculo TAL CUAL se enseñó al cotizar (0225): línea por línea con su supuesto y su fuente ("medido en N viajes", "declarado por la flota", "capturado a mano"). Citable: no se recalcula al cambiar la config.';
comment on column public.cotizacion.decidida_en is
  'El claim de la decisión (0225): lo escribe un UPDATE condicional sobre NULL antes de convertir a viaje o marcar perdida — el doble clic lo resuelve la base, no un if. NULL = nadie la ha decidido.';
