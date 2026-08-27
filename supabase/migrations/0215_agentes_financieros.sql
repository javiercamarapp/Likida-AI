-- ═══════════════════════════════════════════════════════════════════════════
-- 0215 — LOS 4 AGENTES FINANCIEROS DEL BACK OFFICE, VIVOS EN EL RUNNER
-- (compañía agente, rubro 08-Financieros: analista_metricas, control_costos,
-- tesoreria, cierre_mensual).
--
-- Los cuatro ya existían como FILAS 'disenado' (0125). Esta migración los
-- enciende con los candados del runner (0123): estado vivo + runner_habilitado
-- + presupuesto_dia_usd DECLARADO. Son agentes SIN modelo (motor determinista
-- en finanzas.ts — un agente financiero que no puede alucinar cifras cumple
-- «nunca inventar una cifra» por construcción); el techo declarado es el
-- candado formal del runner, y su gasto medido es $0.
--
-- Tres piezas más:
--   1. `finanzas_config` — lo que SOLO Javier declara: saldo en caja (el
--      agente jamás lee el banco — diseño del blueprint de tesorería), costo
--      de vida, fijos, presupuesto de IA, tipo de cambio. TODO anulable:
--      NULL = «no declarado» y el parte lo dice — los valores que los
--      blueprints proponen ($6,500 P10, $65,000 P11, $150 USD/mes) son
--      PROPUESTAS pendientes de firma y NO se siembran como política.
--   2. El dominio del interruptor (0110/0122) gana los 4 kill switches — sin
--      ellos el runner ni los despacha (candado 1).
--   3. `cola_parte_por_periodo` — UN parte por (agente, periodo): el título
--      del parte es determinista por periodo («Costos — 2026-08-27»,
--      «Cierre — 2026-07») y este índice único parcial es el árbitro de la
--      carrera entre dos corridas del runner (estándar §7: la idempotencia
--      es un constraint, no un `if`). Parcial a los 4 agentes a propósito:
--      el Redactor titula sus piezas con el asunto del correo y DOS
--      prospectos distintos pueden compartir asunto legítimamente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. La configuración declarada ──────────────────────────────────────────
create table if not exists public.finanzas_config (
  -- Una sola fila: la config es de LIKIDA, no de una flota. El CHECK ancla
  -- la PK a true — un segundo INSERT rebota por PK, no por convención.
  id                     boolean primary key default true check (id),
  saldo_mxn              numeric(14,2),
  -- Sin fecha el saldo no vale: el parte de tesorería exige las dos juntas.
  saldo_fecha            date,
  costo_vida_mxn         numeric(14,2),
  fijos_mxn              numeric(14,2),
  presupuesto_ia_mes_usd numeric(10,2),
  tipo_cambio_mxn_usd    numeric(8,4),
  actualizado_en         timestamptz not null default now(),
  -- Quién declaró — se conserva aunque la cuenta se borre (patrón 0207/0213).
  actualizado_por        uuid references public.app_user(id) on delete set null,
  constraint finanzas_config_saldo_sano
    check (saldo_mxn is null or saldo_mxn <> 'NaN'::numeric),
  constraint finanzas_config_positivos
    check ((costo_vida_mxn is null or costo_vida_mxn >= 0)
       and (fijos_mxn is null or fijos_mxn >= 0)
       and (presupuesto_ia_mes_usd is null or presupuesto_ia_mes_usd > 0)
       and (tipo_cambio_mxn_usd is null or tipo_cambio_mxn_usd > 0)),
  -- El saldo y su fecha viajan JUNTOS: un saldo sin fecha no se puede juzgar
  -- por vejez, y una fecha sin saldo no dice nada.
  constraint finanzas_config_saldo_con_fecha
    check ((saldo_mxn is null) = (saldo_fecha is null))
);

comment on table public.finanzas_config is
  'Lo que SOLO Javier declara para los agentes financieros (0215): saldo en caja con su fecha (jamás se lee el banco), costo de vida, fijos, presupuesto de IA, tipo de cambio. NULL = no declarado — el parte lo dice, nunca lo inventa. Una sola fila (id=true).';

-- Mismo doble candado que 0196/0198/0207: RLS deny-all + solo service_role.
alter table public.finanzas_config enable row level security;
revoke all on table public.finanzas_config from public, anon, authenticated;
grant select, insert, update, delete on table public.finanzas_config to service_role;

-- ── 2. Los kill switches (patrón 0122) ─────────────────────────────────────
alter table public.interruptor drop constraint interruptor_id_dominio;
alter table public.interruptor add constraint interruptor_id_dominio check (
  id in (
    'global',
    'agente:liquidacion', 'agente:facturas', 'agente:cobranza',
    'agente:conductores', 'agente:peajes', 'agente:proveedores',
    'agente:ventas', 'agente:redactor',
    'agente:analista_metricas', 'agente:control_costos',
    'agente:tesoreria', 'agente:cierre_mensual'
  )
);

-- ── 3. Los cuatro, vivos y con techo ───────────────────────────────────────
-- El techo de $0.50/día es el candado FORMAL del runner (sin techo declarado
-- no corre); el gasto real de estos motores es $0 — no llaman a ningún
-- modelo. La descripción dice lo que el agente HACE hoy, no lo que promete.
update public.agente_definicion set
  estado = 'vivo', runner_habilitado = true, presupuesto_dia_usd = 0.50,
  actualizado_en = now(),
  descripcion = 'Parte semanal de métricas del negocio: MRR, churn, pipeline, por cobrar y conteos de plataforma — cada cifra con su consulta nombrada en la misma línea, null jamás como 0. Determinista (sin modelo); deja el parte en la bandeja de aprobación.'
  where id = 'analista_metricas';
update public.agente_definicion set
  estado = 'vivo', runner_habilitado = true, presupuesto_dia_usd = 0.50,
  actualizado_en = now(),
  descripcion = 'Parte diario de costos de IA/infra con los umbrales U1–U5 del blueprint: el modelo equivocado en una fase (U1) alerta ROJO al operador el mismo día. Determinista (sin modelo); no toca variables de entorno ni apaga agentes.'
  where id = 'control_costos';
update public.agente_definicion set
  estado = 'vivo', runner_habilitado = true, presupuesto_dia_usd = 0.50,
  actualizado_en = now(),
  descripcion = 'Parte semanal de flujo y runway sobre el saldo DECLARADO (jamás lee el banco): quema, semáforo 9/6/3 y ROJO inmediato al operador bajo 3 meses. Sin saldo declarado no hay runway — un runway sin saldo es un número inventado.'
  where id = 'tesoreria';
update public.agente_definicion set
  estado = 'vivo', runner_habilitado = true, presupuesto_dia_usd = 0.50,
  actualizado_en = now(),
  descripcion = 'Cierra el mes anterior desde el día 3: cobrado (no facturado), COGS de IA acotado al mes, margen por cliente sin prorrateos inventados, neto, y el borrador del update que Javier edita y manda. $0 cobrado también es un cierre completo.'
  where id = 'cierre_mensual';

-- ── 4. Un parte por periodo — el árbitro de la carrera ─────────────────────
create unique index if not exists cola_parte_por_periodo
  on public.cola_aprobacion (agente, titulo)
  where agente in ('analista_metricas', 'control_costos', 'tesoreria', 'cierre_mensual');

comment on index public.cola_parte_por_periodo is
  'UN parte financiero por (agente, periodo): el título es determinista por periodo y dos corridas del runner que compitan por el mismo lo resuelve la base — gana exactamente una (0215). Parcial a los 4 financieros: las piezas del Redactor titulan por asunto y pueden repetirse entre prospectos.';
