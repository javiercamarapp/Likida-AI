-- ═══════════════════════════════════════════════════════════════════════════
-- 0267 — LA BANDEJA DE CONTEXTO UNIVERSAL (Fase D, orden del 16-ago-2026:
-- "los 65, fácil y muy visual" — docs/conocimiento/plan-de-cierre.md).
--
-- CADA agente del catálogo (`agente_definicion`, 0116) tiene hoy una fila y
-- un prompt, pero ninguna forma de que Javier le SUELTE algo: un Excel al
-- financiero, una foto de referencia al de marca, un link al vigía de
-- competencia, un ticket al ejército de QA, una idea en texto libre a
-- cualquiera. El principio dictado es «entre más le das, más entienden» — y
-- hoy no hay dónde dar nada. Esta migración es la mitad de base de esa
-- pieza: la tabla que guarda el insumo, tipificado, y su rastro de
-- consumo («qué le diste, qué usó, qué aprendió de eso» — la frase exacta
-- del plan). La UI y el enganche al runner viven en TypeScript
-- (`src/lib/likida/agentes/insumos.ts` y la página
-- `/admin/agentes/[id]/insumos`); aquí solo el contrato de datos.
--
-- ── POR QUÉ `tenant_id` ES ANULABLE, Y POR QUÉ NO ES CIRCUNSTANCIAL ─────────
--
-- `agente_definicion` (0116) NO tiene `tenant_id`: es un catálogo de
-- PLATAFORMA, como `bus_*`/`interruptor`. Y casi todo el catálogo real corre
-- para LIKIDA, no para una flota — `corridas.ts` lo documenta agente por
-- agente: los 4 financieros, los 10 de crecimiento, los de ingeniería, los
-- de leads, dirección y back office registran su corrida con `tenant_id`
-- NULL a propósito (barren TODAS las flotas de una pasada). El insumo que
-- Javier le suelta al financiero o al de marca es, por la misma razón, un
-- insumo DE LA PLATAFORMA — no existe la flota por la cual anclarlo.
--
-- `tenant_id` queda como columna (no se omite) porque el catálogo declarativo
-- SÍ admite agentes de producto por-flota (`liquidacion`, `cobranza`, …) y
-- el diseño de la bandeja es UNIVERSAL — "cada agente del catálogo", dice el
-- plan, no "cada agente de plataforma". El día que un agente de producto
-- reciba insumos de un cliente concreto (un contador subiendo su propia
-- política de gastos, por ejemplo), la columna ya existe y ya está aislada
-- por RLS deny-all + el filtro `tenant_id` que la capa 2
-- (`consultas_admin_filtran_tenant.test.ts`) exige en cada consulta nueva.
-- Sin ella, ese día sería una migración con backfill; con ella, es una fila.
--
-- ── LA TIPIFICACIÓN (CHECK domain completo) ─────────────────────────────────
--
-- Los cinco tipos que el plan nombra, palabra por palabra: documentos y
-- Exceles («documento»), imágenes y videos de referencia («imagen»/«video»),
-- links y noticias («link»), ideas en texto libre («texto»). Qué agente
-- acepta cuáles vive en TypeScript (`TIPOS_POR_AGENTE`, insumos.ts) — es la
-- UI la que decide qué zona de arrastre mostrarle a Javier según el agente
-- que esté mirando; la base solo garantiza que el `tipo` que sea que llegue
-- esté en el dominio y que el campo que le corresponde venga lleno:
-- `storage_path` para lo que vive en Storage (documento/imagen/video) y
-- `contenido_texto` para lo que vive en la fila (link/texto) — nunca los dos,
-- nunca ninguno. Mismo criterio que `mcp_oauth_codigo.codigo_hash` (0260):
-- el CHECK hace posible que un insumo mal armado no pueda ni insertarse.
--
-- ── EL RASTRO DE CONSUMO ─────────────────────────────────────────────────
--
-- `procesado_en` nace NULL — "subido, pendiente" — y solo el agente lo
-- llena cuando de verdad lo leyó en una corrida (patrón fail-closed de
-- finanzas.ts: un insumo que no se pudo leer completo no se marca
-- procesado). `resumen_uso` es la frase para la tarjeta ("qué usó, qué
-- aprendió de eso") y por eso el CHECK exige que solo exista JUNTO con
-- `procesado_en` — un resumen sin fecha de proceso sería una afirmación sin
-- respaldo, la misma regla de CLAUDE.md sobre cifras que nadie midió.
--
-- ── DENY-ALL, COMO TODO EL CATÁLOGO DE AGENTES ──────────────────────────────
--
-- RLS activa, cero policies, grants solo a `service_role` — mismo patrón que
-- `agente_definicion` (0116) y `mcp_oauth_*` (0260): el único lector/escritor
-- es el servidor, primero la Server Action de `/admin/agentes/[id]/insumos`
-- (gateada `requireSuperadmin()`) y luego el runner al consumir. Sin FK
-- compuesta hacia `agente_definicion(id, tenant_id)`: esa tabla no tiene
-- `tenant_id` (no aplica — regla de la casa, no un descuido).
--
-- ── Idempotencia ─────────────────────────────────────────────────────────
-- `create table if not exists`, índices `if not exists`, bucket con
-- `on conflict do nothing`. Re-aplicarla no cambia nada.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.agente_insumo (
  id              uuid primary key default gen_random_uuid(),
  -- El agente DESTINO — de qué tarjeta cuelga este insumo. FK simple (no
  -- compuesta): agente_definicion no tiene tenant_id (ver cabecera).
  agente          text not null references public.agente_definicion(id),
  -- NULL = insumo de plataforma (el caso normal hoy — ver cabecera). No NULL
  -- queda reservado para el día que un agente de producto reciba un insumo
  -- de una flota concreta.
  tenant_id       uuid references public.tenant(id) on delete cascade,
  tipo            text not null
                    constraint agente_insumo_tipo_dominio check (tipo in ('documento', 'imagen', 'video', 'link', 'texto')),
  -- La etiqueta corta que la tarjeta enseña ("qué le has dado"). Obligatoria
  -- incluso para un link o una idea suelta: sin título, la tarjeta solo
  -- podría enseñar un uuid.
  titulo          text not null
                    constraint agente_insumo_titulo_forma check (length(titulo) between 1 and 200),
  -- La ruta en el bucket `agente-insumos` (privado) — solo para
  -- documento/imagen/video. NUNCA la URL pública: se sirve por
  -- createSignedUrl con TTL, igual que `liquidaciones` (0008).
  storage_path    text
                    constraint agente_insumo_storage_path_forma check (storage_path is null or length(storage_path) between 1 and 500),
  -- El link o el texto libre — solo para link/texto. Vive EN LA FILA (no en
  -- Storage): es lo que hace que un link o una idea sean baratos de leer en
  -- cada corrida, sin ida y vuelta a Storage por algo que cabe en una celda.
  contenido_texto text
                    constraint agente_insumo_contenido_texto_forma check (contenido_texto is null or length(contenido_texto) between 1 and 5000),
  subido_por      uuid not null references public.app_user(id) on delete cascade,
  subido_en       timestamptz not null default now(),
  -- NULL hasta que el agente lo consume en una corrida real (fail-closed:
  -- una lectura a medias no marca procesado — ver cabecera).
  procesado_en    timestamptz,
  -- «Qué usó, qué aprendió de eso» (la frase del plan) — la redacta el
  -- propio agente al procesar. Solo tiene sentido junto con procesado_en
  -- (constraint de abajo).
  resumen_uso     text
                    constraint agente_insumo_resumen_uso_forma check (resumen_uso is null or length(resumen_uso) between 1 and 2000),

  -- El contenido vive en EXACTAMENTE el campo que le corresponde a su tipo.
  constraint agente_insumo_contenido_segun_tipo check (
    (tipo in ('documento', 'imagen', 'video') and storage_path is not null and contenido_texto is null)
    or
    (tipo in ('link', 'texto') and contenido_texto is not null and storage_path is null)
  ),
  -- Un resumen sin fecha de proceso sería una afirmación de trabajo que
  -- nadie hizo — la misma regla de "nunca inventar una cifra" de CLAUDE.md,
  -- aplicada a "nunca inventar que un agente ya usó algo".
  constraint agente_insumo_resumen_requiere_procesado check (resumen_uso is null or procesado_en is not null)
);

comment on table public.agente_insumo is
  'La bandeja de contexto universal (Fase D, plan-de-cierre.md, orden del 16-ago-2026): lo que Javier le suelta a un agente del catálogo — documento/imagen/video/link/texto — tipificado, con su rastro de consumo (procesado_en/resumen_uso). tenant_id NULL = insumo de plataforma (el caso normal: casi todo el catálogo corre para Likida, no para una flota — ver corridas.ts). Deny-all: solo service_role la toca.';
comment on column public.agente_insumo.tenant_id is
  'NULL = insumo de plataforma (agentes que corren para Likida — el caso de hoy). No-NULL queda reservado para un agente de producto que reciba un insumo de una flota concreta; aislado por RLS deny-all + el filtro tenant_id que exige la capa 2 del aislamiento (consultas_admin_filtran_tenant.test.ts).';
comment on column public.agente_insumo.procesado_en is
  'NULL = pendiente de la siguiente corrida del agente. Se llena SOLO cuando el agente de verdad lo leyó (fail-closed, mismo criterio que finanzas.ts): una lectura a medias no marca procesado.';
comment on column public.agente_insumo.resumen_uso is
  '"Qué usó, qué aprendió de eso" para la tarjeta del agente — la redacta el propio agente al procesar. El CHECK agente_insumo_resumen_requiere_procesado impide que exista sin procesado_en.';

-- Los pendientes de UN agente, en orden de llegada — el índice que la
-- lectura del runner usa en cada corrida (WHERE agente = ? AND procesado_en
-- IS NULL ORDER BY subido_en).
create index if not exists agente_insumo_pendientes_idx
  on public.agente_insumo (agente, subido_en)
  where procesado_en is null;

-- Los insumos de un tenant concreto (hoy casi siempre vacío — ver cabecera).
create index if not exists agente_insumo_tenant_idx
  on public.agente_insumo (tenant_id)
  where tenant_id is not null;

-- Deny-all (mismo criterio que agente_definicion/mcp_oauth_*): RLS activa,
-- cero policies — solo el service role del servidor toca esto.
alter table public.agente_insumo enable row level security;
revoke all on table public.agente_insumo from public, anon, authenticated;
grant select, insert, update, delete on table public.agente_insumo to service_role;

-- ── El bucket de Storage — privado, como liquidaciones (0008) ──────────────
-- NUNCA público: un insumo puede ser un ticket con datos de un cliente o un
-- Excel financiero. Se sirve por createSignedUrl con TTL, jamás por URL
-- pública. Sin policies de storage.objects a propósito: el único que sube o
-- lee este bucket es el servidor (supabaseAdmin, service_role), igual que
-- `liquidaciones` — no hay sesión de navegador que necesite tocarlo directo.
insert into storage.buckets (id, name, public)
values ('agente-insumos', 'agente-insumos', false)
on conflict (id) do nothing;
