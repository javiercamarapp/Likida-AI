-- RECUPERADA de produccion (CT-BAS-09, 3-nov-2026). NO es una migracion del repo y NO se aplica.
--
-- Origen: supabase_migrations.schema_migrations, version 20260908183539, name
-- `0351b_costo_fase_dominio_sintaxis_in` (proyecto Supabase ref gngoqsvrxdguxvsizpbw), leida con
-- `supabase db query --linked` (solo SELECT sobre la columna `statements`, texto tal cual).
-- Se aplico directo en la base y nunca llego a un commit. Su sufijo `b` no cumple `^\d{4}_`, por eso
-- verificar-migraciones-aplicadas.mjs y la compuerta la ignoran. Vive FUERA de supabase/migrations/ para
-- que ni el CLI ni la compuerta la tomen por una migracion pendiente.
--
-- Efecto: el mismo dominio de `llm_costo_fase_dominio` que ya declara 0351_costo_fase_copiloto_runner.sql
-- (que hoy ya usa la sintaxis `fase in (...)`); es idempotente en resultado y redundante con el archivo 0351.
-- Ver supabase/migrations/NUMERACION-SALTADA.md.
--
-- ===== SQL ORIGINAL (sin cambios) =====
-- Corrección de forma sobre 0351: mismo dominio, sintaxis `in (...)` en vez de
-- `= any(array[...])` para que coincida con la convención textual que
-- costos_dominio.test.ts escanea (0025/0304 ya usan `in (...)`).
begin;

alter table public.llm_costo drop constraint llm_costo_fase_dominio;
alter table public.llm_costo
  add constraint llm_costo_fase_dominio
  check (fase in ('ocr', 'cuadre', 'escalacion', 'chat', 'router', 'whatsapp', 'transcripcion', 'copiloto', 'runner'));

comment on constraint llm_costo_fase_dominio on llm_costo is
  'Espeja FaseCosto (src/lib/likida/costos.ts). Seis fases en 0025, transcripcion en 0304, copiloto/runner en 0351 (auditoria 28, TC-B2): sin llamador todavia, solo amplia el dominio. costos_dominio.test.ts cruza las dos listas y falla si divergen.';

commit;
