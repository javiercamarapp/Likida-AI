-- ═══════════════════════════════════════════════════════════════════════════
-- 0123 — El runner nivel 2 (acotado) y el control de campañas.
--
-- Orden de Javier del 16-ago-2026, anulando el diferimiento del diseño del
-- copiloto §4: los agentes del back office SÍ corren solos — pero el runner
-- NACE ACOTADO, que es exactamente lo que la 0116 preparó al declarar
-- `presupuesto_dia_usd`: "declarar el techo primero es lo que permite que
-- ese runner nazca acotado en vez de acotarse después".
--
-- Tres piezas:
--  1. `agente_corrida.costo_usd` — LA MEDICIÓN por agente que la 0116
--     prometió al runner. NULL = corrida sin gasto de modelo medido (las
--     históricas y las que no llaman al modelo), nunca un 0 inventado.
--  2. `agente_definicion.runner_habilitado` — el opt-in de autonomía POR
--     agente, apagable en la base sin deploy. El runner solo corre agentes
--     vivos + habilitados + con disparador cron + CON techo declarado: un
--     agente sin presupuesto_dia_usd NO corre solo, por diseño.
--     El redactor (C5) estrena la autonomía: cron, habilitado, techo $1/día
--     (~8,000 correos al precio medido de deepseek-v4-flash — el techo real
--     lo pone antes el tope de piezas y el de envío, este es el de DINERO).
--  3. `campana` — el control del §4 del panel de adquisición: crear o subir
--     presupuesto SIEMPRE es humano (el CHECK exige aprobador para estar
--     activa); pausar es la acción de fricción mínima. El GASTO REAL llega
--     de la integración de lectura (campanas.ts) y es NULL —dicho— mientras
--     no haya token: jamás un $0 con cara de medición.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.agente_corrida
  add column if not exists costo_usd numeric
    constraint agente_corrida_costo_positivo check (costo_usd is null or costo_usd >= 0);

comment on column public.agente_corrida.costo_usd is
  'Gasto de modelo de ESTA corrida, USD (0123). NULL = sin gasto medido (corridas históricas o sin modelo) — el techo diario del runner suma solo lo medido y falla cerrado si no puede leer.';

alter table public.agente_definicion
  add column if not exists runner_habilitado boolean not null default false;

comment on column public.agente_definicion.runner_habilitado is
  'Opt-in de autonomía (0123): el runner nivel 2 solo corre agentes vivos + habilitados + disparador cron + presupuesto_dia_usd declarado. Apagable aquí sin deploy; el kill switch por interruptor sigue mandando encima.';

update public.agente_definicion
  set disparador = 'cron', runner_habilitado = true, presupuesto_dia_usd = 1.00
  where id = 'redactor';

create table public.campana (
  id                    uuid primary key default gen_random_uuid(),
  canal                 text not null
                          constraint campana_canal_dominio check (canal in ('meta', 'google')),
  -- El id en la plataforma de anuncios — la llave para leer gasto y pausar.
  id_externo            text,
  nombre                text not null
                          constraint campana_nombre_no_vacio check (length(btrim(nombre)) > 0),
  presupuesto_aprobado_usd numeric not null
                          constraint campana_presupuesto_positivo check (presupuesto_aprobado_usd > 0),
  cpl_objetivo_usd      numeric
                          constraint campana_cpl_positivo check (cpl_objetivo_usd is null or cpl_objetivo_usd > 0),
  estado                text not null default 'pausada'
                          constraint campana_estado_dominio check (estado in ('activa', 'pausada', 'terminada')),
  -- QUIÉN aprobó activarla y CUÁNDO — el §4 exige que activar/subir gasto
  -- sea siempre una acción humana con firma, no un dato implícito.
  aprobado_por          uuid references public.app_user(id) on delete set null,
  aprobado_por_email    text,
  aprobado_en           timestamptz,
  -- Activa ⇒ aprobada (los tres campos). El candado es de BASE: ninguna ruta
  -- puede activar una campaña sin aprobador aunque el código tuviera un bug.
  constraint campana_activa_solo_aprobada check (
    estado <> 'activa' or (aprobado_por_email is not null and aprobado_en is not null)
  ),
  -- Gasto REAL reportado por la plataforma (lectura, jamás escritura de
  -- presupuesto). NULL = sin medir todavía — la pantalla lo dice.
  gasto_real_usd        numeric
                          constraint campana_gasto_positivo check (gasto_real_usd is null or gasto_real_usd >= 0),
  gasto_medido_en       timestamptz,
  creado_en             timestamptz not null default now(),
  actualizado_en        timestamptz not null default now()
);

comment on table public.campana is
  'Control de campañas de ads (0123, panel-de-adquisicion §4): activar exige aprobador (CHECK campana_activa_solo_aprobada); pausar es de un clic; el gasto real es LECTURA de la plataforma — este producto jamás crea campañas ni sube presupuesto solo.';

-- Deny-all, como sus hermanas: solo el service role del servidor.
alter table public.campana enable row level security;
