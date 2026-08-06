-- ═══════════════════════════════════════════════════════════════════════════
-- 0084 — sumar_combustible_ejercicio: la agregación del 15% en SQL
--
-- El contador de la RFA 2026 regla 2.9 (total y efectivo de combustible del
-- ejercicio) se calculaba en TS recorriendo páginas de `gasto` en cada cuadre
-- — el barrido anual en el camino caliente que las rondas 14-16 marcaron ALTO.
-- Con esto el SUM lo hace Postgres en una sola consulta; el TS solo lee el
-- resultado. Mismo criterio de combustible que el motor (concepto diesel O
-- clave_prod_serv de la lista del tenant) y misma ventana (el año del viaje).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.sumar_combustible_ejercicio(p_tenant uuid, p_anio int, p_claves text[])
returns table (total numeric, efectivo numeric)
language sql
stable
set search_path = public, pg_catalog
as $$
  select
    coalesce(sum(monto), 0) as total,
    coalesce(sum(monto) filter (where forma_pago = '01'), 0) as efectivo
  from gasto
  where tenant_id = p_tenant
    and fecha >= make_date(p_anio, 1, 1)
    and fecha <= make_date(p_anio, 12, 31)
    and (concepto = 'diesel' or (p_claves is not null and cardinality(p_claves) > 0 and clave_prod_serv = any(p_claves)));
$$;

revoke all on function public.sumar_combustible_ejercicio(uuid, int, text[]) from public, anon, authenticated;
grant execute on function public.sumar_combustible_ejercicio(uuid, int, text[]) to service_role;

comment on function public.sumar_combustible_ejercicio(uuid, int, text[]) is
  'Total y efectivo de combustible del ejercicio (RFA 2026 regla 2.9). Una sola pasada en SQL; la usa desde_db y la tool de periodo. Solo service_role.';
