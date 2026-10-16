-- ═══════════════════════════════════════════════════════════════════════════
-- 0813 — PEAJES: UNIDADES INMOVILIZADAS (taller / siniestro / baja) (T-A2-36).
--
-- (La ficha lo nombraba «0814»; la numeración se renumera en orden de creación dentro
-- del bloque 0810–0819 asignado a A2: después de la 0812 sigue la 0813.)
--
-- Basta teclear el número impreso del TAG para pasar una caseta: una foto del TAG de
-- una unidad en taller, en un parador o siniestrada alcanza. Para detectar un cruce con
-- el TAG de una unidad que NO podía estar circulando, la flota declara las VENTANAS en
-- que cada unidad estuvo inmovilizada; un cruce con el TAG de esa unidad dentro de la
-- ventana es un candidato crítico para validar (nunca una afirmación de fraude).
--
--   · `peaje_unidad_inmovilizada` — unidad, desde, hasta (NULL = sigue inmovilizada) y
--     motivo (taller | siniestro | baja). Nace VACÍA: no viene ninguna ventana precargada.
--
-- Distinta de `peaje_tag_baja` (0776): aquella es la baja del TAG y su fecha; esta es el
-- periodo en que la UNIDAD no circulaba, tenga o no baja de TAG.
--
-- RLS: deny-all (prendida SIN políticas; solo service_role, que filtra por tenant en
-- cada consulta), igual que 0775–0778. Aditiva e idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.peaje_unidad_inmovilizada (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenant(id) on delete cascade,
  unidad_id  uuid not null,
  -- Primer día de la inmovilización y último (ambos inclusive). hasta NULL = sigue inmovilizada.
  desde      date not null,
  hasta      date,
  motivo     text not null,
  nota       text,
  creado_en  timestamptz not null default now(),
  constraint peaje_unidad_inmovilizada_unica unique (tenant_id, unidad_id, desde, motivo),
  constraint peaje_unidad_inmovilizada_motivo_dominio check (motivo in ('taller', 'siniestro', 'baja')),
  constraint peaje_unidad_inmovilizada_ventana check (hasta is null or hasta >= desde),
  constraint peaje_unidad_inmovilizada_nota_larga check (nota is null or char_length(nota) <= 300),
  -- Una unidad de OTRA flota no puede quedar inmovilizada aquí (regla de la 0028/0145).
  constraint peaje_unidad_inmovilizada_unidad_tenant_fkey
    foreign key (unidad_id, tenant_id) references public.unidad (id, tenant_id) on delete cascade
);

comment on table public.peaje_unidad_inmovilizada is
  '0813: ventanas en que una unidad estuvo inmovilizada (taller, siniestro o baja). Un cruce con el TAG de la unidad dentro de la ventana es candidato crítico a validar. Nace vacía.';
comment on column public.peaje_unidad_inmovilizada.hasta is
  'Último día de la inmovilización (inclusive). NULL = la unidad sigue inmovilizada.';

create index if not exists peaje_unidad_inmovilizada_unidad_idx
  on public.peaje_unidad_inmovilizada (tenant_id, unidad_id);

alter table public.peaje_unidad_inmovilizada enable row level security;
