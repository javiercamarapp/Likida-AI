-- ═══════════════════════════════════════════════════════════════════════════
-- AUDITORÍA 25, ALTO FISCAL (fiscal.md línea 145) — «IVA acreditable de tus
-- liquidaciones — LIVA art. 5» sumaba también las RECHAZADAS y las PENDIENTES.
--
-- `acreditables_liquidacion_tenant` (0112) suma `iva_acreditable`,
-- `peaje_acreditable` y `litros_diesel_acreditables` de TODA `liquidacion` del
-- tenant, sin una sola cláusula sobre `revision` (que nació después, en la
-- 0299: `pendiente | aprobada | ajustada | rechazada`). El repo ya escribe
-- esta misma abstención en DOS lugares sobre los mismos datos:
--   · `api/export/liquidaciones/periodo.ts` — por omisión NO exporta las
--     rechazadas (`FILTRO_REVISION_DEFECTO = 'sin_rechazadas'`).
--   · `api/v1/openapi/route.ts` — por omisión trae solo lo ASENTABLE
--     (`?revision=firmadas`: aprobada o ajustada); "`pendiente` = nadie la ha
--     firmado: no la asientes."
--
-- La tarjeta del contador (`inicio-contador.tsx`, vía `getAcreditables`) y la
-- herramienta de chat `acreditables_periodo` eran la ÚNICA puerta que no se
-- abstenía: sumaban una liquidación que el contralor RECHAZÓ con motivo (la
-- 0299 solo escribe `revision`/`revisada_*`/`motivo` al rechazar — las
-- columnas acreditables de la fila se quedan intactas) o que nadie ha
-- firmado todavía. El daño va en la dirección cara: LIVA art. 5 exige que la
-- erogación sea deducible para ser acreditable, y una liquidación rechazada
-- es, por definición del propio producto, una cuyas cifras no sostienen eso
-- todavía.
--
-- El arreglo adopta la MISMA palabra que ya usa la API pública: "firmadas"
-- (aprobada o ajustada). `pendiente` y `rechazada` quedan fuera — igual que
-- ya quedan fuera del CSV y del export por omisión.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.acreditables_liquidacion_tenant(
  p_tenant uuid,
  p_desde timestamptz default null
)
returns jsonb
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'litrosDiesel', coalesce(sum(litros_diesel_acreditables), 0),
    'ieps', coalesce(sum(ieps_acreditable), 0),
    'iva', coalesce(sum(iva_acreditable), 0),
    'peaje', coalesce(sum(peaje_acreditable), 0)
  )
  from liquidacion
  where tenant_id = p_tenant
    and (p_desde is null or created_at >= p_desde)
    and revision in ('aprobada', 'ajustada');
$$;

comment on function public.acreditables_liquidacion_tenant(uuid, timestamptz) is
  'Suma de estímulos acreditables (IEPS diésel + IVA + peaje 50% + litros de diésel elegibles) de UNA flota, en jsonb. Solo liquidaciones FIRMADAS (revision aprobada|ajustada, mismo criterio que ?revision=firmadas de la API pública) — una rechazada o pendiente no sostiene todavía el requisito de deducibilidad de LIVA 5-I (auditoría 25, fiscal.md línea 145). p_desde acota por created_at (o null = todo el histórico). SECURITY INVOKER; p_tenant sin default.';
