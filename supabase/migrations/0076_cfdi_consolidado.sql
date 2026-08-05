-- 0076 — El CFDI CONSOLIDADO: la mitad del gasto fiscal que ningún adaptador
-- de portal puede tocar.
--
-- ═══ POR QUÉ ESTA TABLA ═════════════════════════════════════════════════════
--
-- Diésel por monedero (Edenred, Efectivale…) y peaje por TAG (IAVE, PASE,
-- TeleVía) son ~54% del gasto real de una flota (INEGI EAT 2024) y no dejan
-- ticket por transacción: llegan como UN CFDI que ampara muchos días de
-- consumo. `cfdi_xml.ts` (código) ya sabe extraer esas líneas; lo que faltaba
-- era un lugar para guardarlas y una cola para lo que no se pueda ligar solo.
--
-- `gasto` NO se toca con columnas nuevas: la migración 0065 ya construyó
-- exactamente lo que hace falta para que VARIOS gastos compartan un mismo
-- CFDI (`cfdi_orden` + el índice único movido a `(tenant_id, cfdi_uuid,
-- cfdi_orden)`). Esta migración reusa ese mecanismo, no lo duplica.
--
-- ═══ POR QUÉ `cfdi_consolidado_linea` Y NO SOLO EL UPDATE A `gasto` ═══════
--
-- Porque no todas las líneas concilian. Cuando NINGÚN gasto candidato cuadra
-- por monto+fecha, o hay MÁS DE UNO (ambiguo), la disciplina de "nunca
-- inventar una cifra" que gobierna el resto del repo dice que no se adivina
-- — la línea se queda aquí, con sus candidatos (si los hubo) para que un
-- contador la resuelva viendo el mismo CFDI que va a defender ante el SAT.
-- Sin esta tabla esas líneas simplemente DESAPARECERÍAN: el JOIN las vería,
-- no las ligaría a nada, y no habría rastro de que existieron.

-- ── 1. Dos columnas en `cfdi_xml`: ¿es un consolidado, y de cuántas líneas? ──
alter table public.cfdi_xml add column if not exists tiene_multiples_conceptos boolean not null default false;
alter table public.cfdi_xml add column if not exists total_conceptos smallint;

comment on column public.cfdi_xml.tiene_multiples_conceptos is
  'true si el XML ampara mas de una transaccion (lineas.length > 1 en cfdi_xml.ts). Un CFDI asi NO se liga 1:1 a un gasto via gasto_id: gasto_id se queda NULL y el reparto vive en cfdi_consolidado_linea.';
comment on column public.cfdi_xml.total_conceptos is
  'Cuantas lineas trajo el parser (ecc12 o concepto base). NULL en un CFDI normal de un solo concepto.';

-- ── 2. La cola de conciliación ────────────────────────────────────────────
create table if not exists public.cfdi_consolidado_linea (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  cfdi_xml_id uuid not null references public.cfdi_xml(id) on delete cascade,
  -- 1-based, el orden en que aparecio en el XML. Es el mismo numero que se
  -- escribe en gasto.cfdi_orden cuando la linea concilia (mig. 0065).
  indice smallint not null check (indice >= 1),
  fuente text not null check (fuente in ('ecc12', 'concepto_base')),
  -- NULL cuando el estandar no da fecha por transaccion (concepto_base sin
  -- ECC12 — ver cfdi_xml.ts). NO es un dato que falte capturar: es una
  -- limitacion real del CFDI que la emitio.
  fecha date,
  monto numeric(12,2) not null,
  descripcion text,
  -- Solo ecc12: el RFC y la clave de la gasolinera REAL, distintos del
  -- emisor del CFDI (que es el monedero).
  estacion_rfc text,
  estacion_clave text,
  folio_operacion text,
  estatus text not null default 'por_conciliar' check (estatus in ('conciliada', 'por_conciliar')),
  gasto_id uuid references public.gasto(id) on delete set null,
  -- Candidatos que SÍ pasaron el filtro de monto+fecha pero no fueron unicos
  -- (0 o 2+): [{gastoId, monto, fecha}]. Se guarda para que revisar a mano no
  -- signifique correr el matcher otra vez — el contador ve las mismas
  -- opciones que vio el codigo.
  candidatos jsonb,
  resuelto_por uuid references public.app_user(id) on delete set null,
  resuelto_en timestamptz,
  created_at timestamptz not null default now(),
  unique (cfdi_xml_id, indice)
);

comment on table public.cfdi_consolidado_linea is
  'Cada transaccion dentro de un CFDI consolidado (monedero de combustible o TAG de casetas), con su resultado de conciliacion contra gasto. estatus=conciliada implica gasto_id no nulo Y que gasto.cfdi_uuid/cfdi_orden ya se escribieron; estatus=por_conciliar es la cola para un humano.';

alter table public.cfdi_consolidado_linea enable row level security;
create policy tenant_data on public.cfdi_consolidado_linea for all
  using (tenant_id = any(get_user_tenant_ids()) or is_superadmin())
  with check (tenant_id = any(get_user_tenant_ids()) or is_superadmin());

-- La cola que de verdad se consulta: "qué le falta revisar a este tenant".
create index if not exists cfdi_consolidado_linea_por_conciliar_idx
  on public.cfdi_consolidado_linea (tenant_id, created_at)
  where estatus = 'por_conciliar';

-- Para saber, dado un cfdi_xml, si ya se corrió el JOIN (idempotencia de
-- guardarYConciliarConsolidado en intake/consolidado.ts).
create index if not exists cfdi_consolidado_linea_por_cfdi_idx
  on public.cfdi_consolidado_linea (cfdi_xml_id);
