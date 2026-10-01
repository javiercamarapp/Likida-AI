-- ═══════════════════════════════════════════════════════════════════════════
-- 0461 — Conteos por patio, sobre la flota entera y en UNA consulta.
--
-- LOOP PUNTA A PUNTA, W2 «producto». La pantalla de Patios enseña, por cada
-- patio, cuántos operadores activos, unidades activas y jefes de tráfico tiene.
-- Traer las filas de operadores y unidades para contarlas en memoria era
-- exactamente el error que la 0298 corrigió en los registros (PostgREST recorta
-- a 1,000 filas en silencio, y con 800 tractos y cientos de choferes cada render
-- arrastraba el catálogo entero). Aquí los cuenta la base, agrupados.
--
-- Los números son de la FLOTA ENTERA (p_tenant), nunca de una página. Una flota
-- sin patios devuelve cero filas, no un renglón de ceros inventado.
-- Solo `service_role` ejecuta la función (mismo grant que 0298).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.terminales_conteos_tenant(p_tenant uuid)
returns table (terminal_id uuid, operadores integer, unidades integer, jefes integer)
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  select t.id,
         (select count(*)::int from operador o
           where o.tenant_id = p_tenant and o.terminal_id = t.id and o.activo),
         (select count(*)::int from unidad u
           where u.tenant_id = p_tenant and u.terminal_id = t.id and u.activo),
         (select count(*)::int from app_user a
           where a.tenant_id = p_tenant and a.terminal_id = t.id and a.activo is not false)
  from terminal t
  where t.tenant_id = p_tenant
  order by t.id;
$$;

comment on function public.terminales_conteos_tenant(uuid) is
  'Operadores activos, unidades activas y jefes con patio, por patio, sobre la FLOTA ENTERA (0461). Una consulta agrupada: el panel no trae las filas para contarlas.';

revoke all on function public.terminales_conteos_tenant(uuid) from public, anon, authenticated;
grant execute on function public.terminales_conteos_tenant(uuid) to service_role;
