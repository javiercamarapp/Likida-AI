-- ═══════════════════════════════════════════════════════════════════════════
-- LOS GRANT QUE `supabase start` (CLI local) NO PROPAGA — hallazgo E.27.
--
-- Contra un Supabase LOCAL recién levantado con `supabase start`, la primera
-- consulta de PostgREST truena: «permission denied for table tenant» — con
-- la SERVICE_ROLE_KEY, cuyo JWT sí trae `"role":"service_role"` y cuyo rol
-- en Postgres sí tiene `rolbypassrls = true`. BYPASSRLS salta las POLICIES;
-- no inventa el GRANT de tabla que Postgres exige primero, y sin él ni el
-- login real ni una sola consulta de PostgREST funcionan.
--
-- LA CAUSA (verificada contra el proyecto GESTIONADO con
-- information_schema.role_table_grants): producción hereda, desde el
-- bootstrap de la PLATAFORMA — no de nuestras migraciones —
-- select/insert/update/delete a anon/authenticated/service_role para cada
-- tabla nueva. La imagen de Postgres del CLI local no repite ese bootstrap
-- para las tablas que crean nuestras propias migraciones (corridas como
-- `postgres`): nacen con TRIGGER/REFERENCES/TRUNCATE nada más.
--
-- MISMO HALLAZGO, EN FUNCIONES: Postgres SÍ da EXECUTE a PUBLIC por default
-- en una función nueva (por eso el patrón de 87 migraciones es puro
-- `revoke ... from public, anon, authenticated` función por función, nunca
-- un `grant` — no hacía falta). Pero para las que ese `revoke` deja
-- reservadas a `service_role` (p. ej. 0017, `enriquecer_gasto_codigo`), la
-- migración de origen casi nunca vuelve a hacer `grant execute ... to
-- service_role` explícito: confía en que production se lo dio por el mismo
-- bootstrap de plataforma. Local no lo repite tampoco, y el arranque del
-- servidor lo detecta solo (`startup.migraciones`, "permission denied for
-- function enriquecer_gasto_codigo") — el login real se cuelga esperando
-- una respuesta que nunca llega limpia.
--
-- POR QUÉ ESTO NO ES UNA MIGRACIÓN (supabase/migrations/): ese directorio lo
-- barre también `ci-postgres.yml` contra su propio andamio mínimo
-- (`andamio_ci.sql`), que a propósito NO replica el bootstrap de plataforma
-- — su batería de aislamiento usa la AUSENCIA de estos GRANT como capa de
-- defensa en varias tablas (`wa_mensaje`, `llm_costo_mensual` y otras),
-- así que un regrant ahí mismo tumbó 23 verificaciones que hoy pasan
-- (intentado y revertido: ver el PR de E.27). Esto vive fuera de
-- `migrations/` justo para no tocar ese andamio — solo corre contra el
-- Supabase LOCAL real de `supabase start` (local o en
-- `e2e-navegador.yml`), que si SÍ replica el resto del bootstrap de
-- plataforma (RLS, políticas) y solo le falta este paso.
--
-- NO-OP EN PRODUCCIÓN si alguna vez se corriera ahí por error: ya tiene
-- exactamente estos privilegios.
--
-- Uso (local): tras `supabase start` (o `supabase db reset`):
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f scripts/ci/e2e/grants-locales.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ── service_role: nunca restringido en ninguna tabla ni función, regrant
--    sin excepción (incluye las EXECUTE que 0017 y afines dejan sin volver
--    a otorgar explícitamente, confiando en el bootstrap de plataforma) ───
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- ── anon/authenticated: TODAS las tablas MENOS las que otra migración les
--    revocó el acceso directo a propósito (acceso solo por función o por
--    service_role) — MISMA lista que
--    `grep -rn "revoke all on public\." supabase/migrations/` ────────────
do $$
declare
  fila record;
  restringidas text[] := array[
    'llm_costo_mensual', 'agente_mutacion_idempotencia', 'llm_presupuesto_reserva',
    'cfdi_pago', 'proveedor_emergencia', 'qa_corrida_paso', 'viaje_mercancia',
    'evento_seguridad_flota', 'portal_pago_propuesta', 'qa_foto_lectura',
    'jornada_politica', 'aviso_vigencia', 'bitacora_auditoria'
  ];
begin
  for fila in
    select tablename from pg_tables
    where schemaname = 'public' and tablename <> all(restringidas)
  loop
    execute format('grant select, insert, update, delete on public.%I to anon, authenticated', fila.tablename);
  end loop;

  -- bitacora_auditoria: solo INSERT estaba revocado (0195); SELECT/UPDATE/
  -- DELETE de ese archivo no los tocó, así que tampoco los toca este bloque.
  execute 'grant select, update, delete on public.bitacora_auditoria to anon, authenticated';
end $$;
