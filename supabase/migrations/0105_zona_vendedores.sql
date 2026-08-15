-- ═══════════════════════════════════════════════════════════════════════════
-- 0105 — LA ZONA DE VENDEDORES: el censo entra a Likida y los vendedores
-- entran con cuenta propia.
--
-- Likida no tiene clientes todavía; lo que sí tiene es un censo de empresas
-- transportistas que ya NOMBRAN el dolor de la liquidación (la vacante que
-- publican es la señal). Hasta hoy ese censo vivía fuera del producto, en
-- ~/javiercamarapp/censo-liquidacion, y venderlo era trabajo de una sola
-- persona. Esta migración mete las tres piezas que faltaban:
--
--   1. El rol `vendedor` en el dominio de `app_user.rol` — rol de LIKIDA,
--      como superadmin: `tenant_id` null, porque un vendedor no pertenece a
--      ninguna flota. NO ve el panel de flota (visibilidad.ts no le da
--      áreas); su casa es /vendedor.
--   2. La tabla `prospecto` — el pipeline de ventas: cada empresa del censo,
--      con su vacante como señal, su vendedor asignado y su estado.
--   3. La bitácora `agente_corrida` aprende al agente `ventas` (el
--      asignador round-robin) — el primer agente que corre para LIKIDA y no
--      para una flota, y por eso `tenant_id` se vuelve anulable.
--
-- LA REGLA DE COMISIÓN, PACTADA EL 14-AGO-2026, va escrita en el `comment on
-- table` de `prospecto` para que sobreviva a cualquier refactor del código:
-- 50% del primer mes del cliente cerrado, 20% recurrente de ahí en adelante.
-- El dinero REAL de comisiones no se calcula hasta que existan cobros
-- reales — Likida hoy no le cobra a nadie, y una comisión estimada sobre un
-- cobro que no existe sería exactamente la cifra inventada que este
-- producto tiene prohibida.
--
-- RLS: `prospecto` se habilita SIN políticas (deny-all). El censo es dato de
-- NEGOCIO de Likida, no de ninguna flota: ni la policy `tenant_data` ni
-- ninguna otra le aplica, y todo acceso pasa por el service-role desde el
-- servidor (los paneles filtran por la sesión ANTES de consultar — el
-- vendedor solo recibe sus filas porque `/vendedor` consulta con SU userId
-- de sesión, jamás con uno del formulario). Mismo patrón que
-- `correo_procesado` (0096) y `api_idempotencia` (0098).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. El rol `vendedor` entra al dominio ──────────────────────────────────
-- Mismo mecanismo que 0044 (entró `encargado`) y 0086 (salió `operador`):
-- soltar el constraint si existe y recrearlo con la lista completa.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'app_user_rol_dominio' and conrelid = 'public.app_user'::regclass
  ) then
    alter table public.app_user drop constraint app_user_rol_dominio;
  end if;

  alter table public.app_user
    add constraint app_user_rol_dominio
    check (rol in ('superadmin', 'flota_admin', 'contador', 'encargado', 'vendedor'));
end $$;

comment on constraint app_user_rol_dominio on app_user is
  'De este dominio depende is_superadmin() y por tanto la RLS de las tablas de negocio. operador retirado en 0086 (el chofer solo tiene WhatsApp); vendedor agregado en 0105 — rol de LIKIDA con tenant_id null, su panel es /vendedor y no ve ninguna flota.';

-- ── 2. `prospecto` — el pipeline de ventas de Likida ───────────────────────

create table if not exists public.prospecto (
  id              uuid primary key default gen_random_uuid(),
  empresa         text not null,
  contacto_nombre text,
  telefono        text,
  correo          text,
  ciudad          text,
  -- La señal del censo: el puesto que la empresa busca cubrir (analista de
  -- liquidaciones, auxiliar de cuadre…). Es el DOLOR nombrado por la propia
  -- empresa — el argumento de venta no lo inventa el vendedor, lo publicó
  -- el prospecto.
  vacante         text,
  fuente          text not null default 'censo',
  estado          text not null default 'nuevo',
  -- El vendedor dueño de este prospecto. Sin `on delete`: borrar una cuenta
  -- con cartera debe DOLER (Postgres rebota) — primero se reasigna, luego se
  -- borra. Un `set null` devolvería la cartera al pool en silencio.
  vendedor_id     uuid references public.app_user(id),
  -- Se llena SOLO al cerrar: linkea el prospecto con la flota real creada en
  -- `tenant`. Mientras el trato no cierre, aquí no hay nada que apuntar.
  tenant_id       uuid references public.tenant(id),
  notas           text,
  cerrado_en      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- El embudo completo. Un estado inventado partiría el tablero en dos.
  constraint prospecto_estado_dominio
    check (estado in ('nuevo', 'contactado', 'demo', 'negociacion', 'cerrado', 'perdido')),
  -- Cerrado ⇔ con fecha de cierre, en los DOS sentidos: un cerrado sin fecha
  -- no dice cuándo empezó a correr la comisión, y una fecha en un estado no
  -- cerrado afirmaría un cierre que no ocurrió.
  constraint prospecto_cerrado_coherente
    check ((estado = 'cerrado') = (cerrado_en is not null)),
  -- La liga con la flota real solo existe en un trato cerrado — es el
  -- "se llena SOLO al cerrar" del comentario de la columna, con dientes.
  constraint prospecto_tenant_solo_cerrado
    check (tenant_id is null or estado = 'cerrado'),
  -- Espeja la validación del panel: una empresa en blanco no es un prospecto.
  constraint prospecto_empresa_no_vacia
    check (length(btrim(empresa)) > 0)
);

comment on table public.prospecto is
  'Pipeline de ventas de LIKIDA (no de ninguna flota): las empresas del censo de vacantes, su vendedor y su estado. REGLA DE COMISIÓN PACTADA (14-ago-2026): el vendedor que cierra cobra el 50% del PRIMER mes del cliente y el 20% RECURRENTE de cada mes siguiente. La comisión se calcula sobre COBROS REALES — Likida hoy no le cobra a nadie, así que no existe cifra de comisión que enseñar, y estimarla sería inventarla.';

comment on column public.prospecto.vacante is
  'El puesto que la empresa publicó (la señal del censo): es el dolor de liquidación nombrado por el propio prospecto.';
comment on column public.prospecto.tenant_id is
  'Solo en estado cerrado (prospecto_tenant_solo_cerrado): la flota real que nació de este prospecto. Sobre los cobros de ESA flota se calculará la comisión — cuando existan cobros.';
comment on column public.prospecto.fuente is
  'De dónde salió el prospecto: censo (importación del censo de vacantes) o manual (alta desde /admin/vendedores).';

-- La consulta de los dos tableros: los prospectos de UN vendedor, por
-- columna del embudo. Sin más índices a propósito (mismo criterio que la
-- 0104): el censo son cientos de filas, no millones, y cada índice extra
-- cobra en cada escritura para ahorrar un scan que aquí no duele.
create index if not exists prospecto_por_vendedor
  on public.prospecto (vendedor_id, estado);

-- Deny-all: enable SIN políticas. Ver la cabecera — todo acceso es
-- service-role desde el servidor; ni el rol vendedor ni ningún rol de flota
-- consulta esta tabla con su propia sesión.
alter table public.prospecto enable row level security;

-- ── 3. `agente_corrida` aprende al agente `ventas` ─────────────────────────
-- El asignador round-robin es el primer agente que corre para LIKIDA y no
-- para una flota: no hay tenant que anotarle. `tenant_id` se vuelve anulable
-- y NULL pasa a significar "corrida del negocio". La policy `tenant_lee`
-- (0102) ya hace lo correcto sin tocarla: `tenant_id = any(...)` es NULL
-- para estas filas — ninguna flota las ve — y `is_superadmin()` sí.

alter table public.agente_corrida alter column tenant_id drop not null;

comment on column public.agente_corrida.tenant_id is
  'La flota de la corrida, o NULL cuando el agente corre para LIKIDA (negocio, no flota — hoy solo ventas, 0105). Las filas NULL solo las ve el superadmin: la policy tenant_lee no las alcanza para ningún tenant.';

alter table public.agente_corrida drop constraint if exists agente_corrida_agente_dominio;
alter table public.agente_corrida
  add constraint agente_corrida_agente_dominio
  check (agente in ('liquidacion', 'facturas', 'cobranza', 'conductores', 'peajes', 'proveedores', 'ventas'));

comment on constraint agente_corrida_agente_dominio on agente_corrida is
  'El catálogo de agentes con bitácora: los seis de flota (agentes/notificaciones.ts) más ventas (0105), que es de Likida y corre con tenant_id null.';
