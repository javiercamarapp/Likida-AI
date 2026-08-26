-- AUDITORÍA 19 (fiscal F2, CRÍTICO): el numerador del cubo del 15% (RFA 2026
-- regla 2.9) se medía en SQL con `forma_pago = '01'` — UN valor — mientras que
-- el resto del motor (`medioNoAdmitidoCombustible`, engine.ts:153, ya
-- verificado contra fuente primaria en la auditoría 18-c3, FISC-C3-1) juzga
-- por EXCLUSIÓN de la lista CERRADA que la norma admite: cheque nominativo
-- (02), transferencia (03), tarjeta de crédito (04), monedero SAT (05),
-- débito (28), servicios (29). Cualquier OTRO medio conocido —dinero
-- electrónico (06), vales (08), dación en pago (12), compensación (17),
-- novación (23)— cuenta como "medio distinto" para la regla, pero el
-- contador SQL del ejercicio no lo veía: un gasto pagado con vales entraba a
-- `causasDe` como `combustible_efectivo` (individual) sin sumar nada al
-- numerador del 15% (agregado), así que la flota podía rebasar el 15% real
-- de gasto en medios no admitidos y el contador seguir diciendo que iba bien.
--
-- Mismas dos fronteras que `medioNoAdmitidoCombustible` en TS, para que las
-- dos cifras sobre el mismo comprobante sigan siendo LA MISMA cifra:
--   · `forma_pago` NULL no cuenta — desconocido no es "medio distinto"
--     (inflaría el contador contra la flota).
--   · '99' (RMF 2.7.1.29 fr. II: no pagado) tampoco cuenta — no es un medio
--     distinto, es que no se ha pagado; ese caso lo juzga otra regla.
--
-- Si `MEDIOS_LISR_27_III` (engine.ts:126) cambia, esta lista tiene que
-- cambiar con ella — no hay forma de importar la constante de TS a SQL, así
-- que `fiscal_agregado_15pct.test.ts` fija ambas listas lado a lado para que
-- una diferencia falle ruidoso en CI, no en silencio en producción.

create or replace function public.sumar_combustible_ejercicio(p_tenant uuid, p_anio int, p_claves text[])
returns table (total numeric, efectivo numeric)
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  select
    coalesce(sum(monto), 0) as total,
    coalesce(sum(monto) filter (
      where forma_pago is not null
        and forma_pago <> '99'
        and forma_pago not in ('02', '03', '04', '05', '28', '29')
    ), 0) as efectivo
  from gasto
  where tenant_id = p_tenant
    and monto > 0
    and fecha >= make_date(p_anio, 1, 1)
    and fecha <= make_date(p_anio, 12, 31)
    and (concepto = 'diesel' or (p_claves is not null and cardinality(p_claves) > 0 and clave_prod_serv = any(p_claves)));
$$;

comment on function public.sumar_combustible_ejercicio(uuid, int, text[]) is
  'Acumulado del ejercicio para el cubo del 15% (RFA 2026 regla 2.9): total de combustible y la porción pagada por un medio NO admitido por la LISR 27-III (medioNoAdmitidoCombustible en engine.ts — misma lista, misma exclusión de NULL y de 99-no-pagado). NO es solo forma_pago=01: dinero electrónico, vales, dación en pago, compensación y novación también cuentan.';
