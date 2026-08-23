-- ═══════════════════════════════════════════════════════════════════════════
-- 0157 — Escala 50k: el cursor de /v1/viajes y ANALYZE tras importar.
--
-- AUDITORÍA "qué tira producción" (escala.md), ESC-15 y ESC-18.
--
-- 1. ESC-15. `GET /v1/viajes` pagina ahora con cursor (created_at, id) en vez
--    de rebanar en memoria una ventana de 1,000 (menos de un día de viajes a
--    50k/mes). La consulta es
--      where tenant_id = $1 and (created_at, id) < ($c, $i)
--      order by created_at desc, id desc limit N
--    y el único índice de `viaje` por tenant es `idx_viaje_tenant`
--    (tenant_id, estatus): cada página barría la flota entera y la ordenaba.
--    Este índice la deja en un range scan del tamaño de la página.
--
-- 2. ESC-18. `importarViajes` mete hasta 2,000 filas por archivo en lotes de
--    100 y nadie le decía al planificador que la tabla cambió: autovacuum
--    analiza cuando cambia el 10 % de la tabla (`analyze_scale_factor`), que a
--    50k viajes son 5,000 filas — varias importaciones con estadísticas viejas
--    y planes de cuando la flota tenía 300 viajes. `analizar_tablas_operacion()`
--    es la única forma de correr ANALYZE desde PostgREST (no hay SQL crudo) y
--    sólo la llama el service_role, después de un import que pasó de 1,000
--    filas. SECURITY DEFINER porque ANALYZE exige ser dueño de la tabla.
--
-- Idempotente: `if not exists` y `create or replace`.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. ESC-15: el índice del cursor ───────────────────────────────────────
create index if not exists viaje_tenant_created_id_idx
  on public.viaje (tenant_id, created_at desc, id desc);

comment on index public.viaje_tenant_created_id_idx is
  'Cursor de GET /v1/viajes (0157, ESC-15): (tenant_id, created_at desc, id desc) es exactamente el ORDER BY + el filtro `(created_at, id) < cursor` de la página.';

-- ── 2. ESC-18: ANALYZE a demanda, sólo para el servidor ───────────────────
create or replace function public.analizar_tablas_operacion()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Sólo las tablas que un import puede mover de golpe. ANALYZE no bloquea
  -- escrituras (toma SHARE UPDATE EXCLUSIVE) y cabe en una transacción.
  analyze public.viaje;
end $$;

comment on function public.analizar_tablas_operacion() is
  'ANALYZE de las tablas que un import masivo mueve de golpe (0157, ESC-18). La llama importarViajes después de >1,000 filas creadas; best-effort, el import ya quedó.';

revoke all on function public.analizar_tablas_operacion() from public, anon, authenticated;
grant execute on function public.analizar_tablas_operacion() to service_role;
