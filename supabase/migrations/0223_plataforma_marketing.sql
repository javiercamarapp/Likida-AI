-- ═══════════════════════════════════════════════════════════════════════════
-- 0223 — PLATAFORMA DE MARKETING (A2 de la lista maestra; Fase 3 del plan
-- hacia el 90%, Fase C del plan de cierre). Dos piezas chicas:
--
--   1. El dominio de `prospecto.fuente` gana 'landing': el visitante que usó
--      la calculadora pública y pidió su copia. La columna es text sin CHECK
--      a propósito (0105), así que lo que se amplía es el CONTRATO — la unión
--      en `crearProspecto()` (vendedores.ts) y este comentario, que es donde
--      el dominio está declarado. El blueprint del lead magnet lo exige
--      ANTES de escribir la primera fila: un valor fuera del dominio
--      declarado rompe los tableros sin avisar, que es peor que rebotar.
--
--   2. `sitio_evento` — la analítica mínima y honesta del sitio público:
--      pageviews y conversiones de /blog y /calculadora, SIN identificar a
--      nadie (cero IP, cero user-agent, cero cookies: minimización LFPDPPP —
--      el sitio es de una empresa que trata datos fiscales; su analítica no
--      puede ser el primer lugar donde se recolecta de más). Es el sustrato
--      del embudo (A7): cuántos vieron / cuántos convirtieron, por día.
--      Suficiente para el funnel; nada más.
--
-- Va en EXENTAS-de-bloque con la razón de la casa: la capa 1 de la batería
-- (capa1_auditoria_estatica.sql) ya barre TODO el catálogo buscando tablas
-- sin RLS y grants de más — `sitio_evento` entra a ese barrido sola; un
-- bloque dedicado repetiría la aserción global.
-- ═══════════════════════════════════════════════════════════════════════════

comment on column public.prospecto.fuente is
  'De dónde llegó: ''censo'' (importación), ''manual'' (alta del panel), ''landing'' (la calculadora pública de likida.ai — llega con intención declarada y sus cifras capturadas en notas). El dominio vive en crearProspecto(); un valor nuevo se agrega ahí y aquí, junto.';

create table if not exists public.sitio_evento (
  id         uuid primary key default gen_random_uuid(),
  -- Qué página pública ('blog', 'blog:<slug>', 'calculadora'). Lista corta,
  -- validada en el código (el único escritor es /api/marketing/evento).
  pagina     text not null,
  evento     text not null
    constraint sitio_evento_dominio check (evento in ('pageview', 'conversion')),
  created_at timestamptz not null default now(),
  constraint sitio_evento_pagina_forma check (length(pagina) between 1 and 80)
);

-- Consulta típica del embudo: eventos por página por día.
create index if not exists sitio_evento_pagina_dia_idx
  on public.sitio_evento (pagina, created_at);

comment on table public.sitio_evento is
  'Analítica mínima del sitio público (0223): pageviews y conversiones de blog/calculadora, sin ningún dato personal (ni IP, ni UA, ni cookies — minimización LFPDPPP). El único escritor es la API de marketing, con límite de tasa; el lector es el panel de crecimiento.';

-- Mismo doble candado que 0196/0198/0207: RLS deny-all + solo service_role.
alter table public.sitio_evento enable row level security;
revoke all on table public.sitio_evento from public, anon, authenticated;
grant select, insert on table public.sitio_evento to service_role;
