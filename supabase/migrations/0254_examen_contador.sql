-- ═══════════════════════════════════════════════════════════════════════════
-- 0254 — EL EXAMEN DEL CONTADOR (E.26, fase 2 de EVALOPS 0134).
--
-- El banco dorado de 32 preguntas (22-evaluacion.md §5) vive CONGELADO y
-- versionado en src/lib/evals/banco-contador.ts — el archivo que el propio
-- diseño pide como primera acción. Aquí NO se duplica: sembrar 32 casos con
-- criterio escrito en SQL además de en TS sería dos verdades que se separan
-- en el primer ajuste. Lo que la base aporta es la LLAVE DE IDEMPOTENCIA
-- para que el runner (scripts/evals/correr-contador.ts) sincronice el banco
-- con upsert — índice único en la base, jamás un `if` previo (eso es una
-- carrera).
--
--  · eval_caso.clave — la identidad estable de cada pregunta dorada
--    ('Q1'…'Q32'). Nullable: los 12 casos del analista (0134) no la usan y
--    no se tocan.
--  · índice único (agente, clave) — el candado del upsert.
--
-- RLS ya está activo en las tres tablas de EVALOPS desde la 0134 (deny-all,
-- solo service role); una columna nueva no lo altera. Sin funciones nuevas.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.eval_caso add column if not exists clave text;

comment on column public.eval_caso.clave is
  'Identidad estable de la pregunta dorada (Q1…Q32 del banco del contador, '
  'src/lib/evals/banco-contador.ts). NULL en los casos sembrados sin clave (analista, 0134).';

-- COMPLETO y no parcial, a propósito: PostgREST (el upsert de supabase-js)
-- infiere el arbiter con `on conflict (agente, clave)` A SECAS, sin el WHERE
-- que un índice parcial exigiría — con índice parcial el upsert del runner
-- moriría con «no unique constraint matching the ON CONFLICT specification».
-- Los casos del analista (clave null) no chocan entre sí porque los NULL son
-- distintos entre sí en un índice único (NULLS DISTINCT, el default).
create unique index if not exists uq_eval_caso_agente_clave
  on public.eval_caso (agente, clave);
