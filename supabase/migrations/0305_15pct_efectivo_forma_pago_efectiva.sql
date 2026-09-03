-- ═══════════════════════════════════════════════════════════════════════════
-- AUDITORÍA 25, FIS-C1/FIS-C2 (CRÍTICO, reincidente de la 23 y la 24). El
-- numerador del cubo del 15% (RFA 2026 regla 2.9) seguía juzgando la forma de
-- pago CRUDA del CFDI (`forma_pago`), no la EFECTIVA (`formaPagoJuzgable` en
-- `engine.ts:636`, `formaPagoEfectiva` en `fiscal.ts:161`): con el complemento
-- de pago ingerido (FASE 7, mig. 0199), un CFDI PPD ('99') cuyo REP dice que
-- de verdad se pagó en efectivo ('01') pasaba de largo — la 0190 lo excluía
-- por ser '99', el mismo criterio que YA era incorrecto para el resto del
-- motor desde la auditoría 23 (FIS-1) y que aquí nunca se corrigió.
--
-- `desde_db.ts:121-125` (`efectivoDeEsteViaje`, el "previo" que el motor le
-- resta al acumulado de esta RPC) SÍ ya usa `medioNoAdmitidoCombustible` sobre
-- la forma cruda — ese lado no se toca aquí porque ya filtra por
-- `g.formaPago` tal cual llega de `getGastos` (Gasto no trae `pagadoForma` en
-- ese tipo) y compensa restándose de un total que, con este arreglo, por fin
-- cuenta lo mismo que él resta.
--
-- La regla, en SQL:
--   forma_pago_efectiva :=
--     · si forma_pago = '99' y pagado_en no es NULL → pagado_forma (lo que el
--       REP dice que de verdad pasó)
--     · si forma_pago = '99' y no hay REP → NULL (no se sabe, no se juzga —
--       el mismo "undefined" que `formaPagoJuzgable` en engine.ts:637-638)
--     · si no → forma_pago tal cual
--
-- Con esa sustitución, el resto de la regla es la MISMA que dejó la 0190
-- (misma lista cerrada de la LISR 27-III, mismo `is not null`): un '99' nunca
-- puede sobrevivir a la sustitución (o se vuelve `pagado_forma`, o se vuelve
-- NULL), así que el `forma_pago_efectiva <> '99'` de la 0190 deja de hacer
-- falta — ya no hay ningún '99' que excluir aparte.
--
-- `total` NO cambia: sigue sumando TODO el combustible del ejercicio sin
-- filtrar por forma de pago — ese denominador nunca dependió del medio.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.sumar_combustible_ejercicio(p_tenant uuid, p_anio int, p_claves text[])
returns table (total numeric, efectivo numeric)
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  with base as (
    select
      monto,
      case
        when forma_pago = '99' and pagado_en is not null then pagado_forma
        when forma_pago = '99' then null
        else forma_pago
      end as forma_pago_efectiva
    from gasto
    where tenant_id = p_tenant
      and monto > 0
      and fecha >= make_date(p_anio, 1, 1)
      and fecha <= make_date(p_anio, 12, 31)
      and (concepto = 'diesel' or (p_claves is not null and cardinality(p_claves) > 0 and clave_prod_serv = any(p_claves)))
  )
  select
    coalesce(sum(monto), 0) as total,
    coalesce(sum(monto) filter (
      where forma_pago_efectiva is not null
        and forma_pago_efectiva not in ('02', '03', '04', '05', '28', '29')
    ), 0) as efectivo
  from base;
$$;

comment on function public.sumar_combustible_ejercicio(uuid, int, text[]) is
  'Acumulado del ejercicio para el cubo del 15% (RFA 2026 regla 2.9): total de combustible y la porción pagada por un medio NO admitido por la LISR 27-III, juzgada con la forma de pago EFECTIVA — mig. 0305, AUDITORÍA 25 FIS-C1/FIS-C2: un `99` con REP (`pagado_en`) cuenta por `pagado_forma`, no por `99`; un `99` sin REP no se juzga (NULL). Misma lista, mismo criterio que medioNoAdmitidoCombustible/formaPagoJuzgable en engine.ts.';
