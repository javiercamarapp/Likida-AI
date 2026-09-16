-- 0357 — ARQ-A3 (CRÍTICO, auditoría 32; reincidente desde la 30, reproducido
-- con cifras contra un Postgres real por primera vez en la 32).
--
-- EL FOLIO SE REINICIA POR EMISOR. La numeración de un ticket de gasolinera la
-- lleva cada estación, no el SAT: dos estaciones distintas emiten su folio
-- `1234` el mismo año sin ninguna anomalía.
--
-- La 0349 portó a SQL el criterio de `copiasDeComprobante` (engine.ts:514-564)
-- tal cual, y ahí está el error de arquitectura: ese criterio es correcto en el
-- universo para el que se escribió —UN viaje, que es el fajo de comprobantes de
-- un operador, donde dos tickets con el mismo folio, el mismo concepto y el
-- mismo total al centavo son, en efecto, la misma foto dos veces— y deja de
-- serlo al aplicarse al EJERCICIO COMPLETO: un año, todos los viajes, todas las
-- estaciones. Mismo código, universo distinto, supuesto roto.
--
-- Lo que costaba, medido (reproducción de la 32, Postgres 16 efímero con las
-- 333 migraciones aplicadas): dos tickets de diésel en efectivo de $2,500 de
-- estaciones distintas, los dos con folio `1234`, en un ejercicio de
-- $1,400,000.
--
--   sumar_combustible_ejercicio   total $1,397,500   efectivo $208,500
--   la verdad en la base          total $1,400,000   efectivo $211,000
--
-- El daño no se queda en el sustraendo: `engine.ts:812` calcula
-- `tope = 0.15 * total`, así que el total deflactado deforma también el
-- DENOMINADOR — tope $209,625 contra $210,000. Los dos errores empujan en la
-- misma dirección, porque el universo grande nunca dedupa menos que el chico:
-- `cupoRestante` sale $3,625 donde debe ser $1,500, y el PDF declara deducibles
-- los $2,500 completos cuando $1,000 no lo son, sin imprimir el renglón que lo
-- avisaría.
--
-- EL ARREGLO ES DE UNA LÍNEA Y SOLO EN LA RAMA DEL FOLIO: se agrega el emisor a
-- la partición. Las otras dos ramas no se tocan —la de `cfdi_uuid` ya es
-- identidad fiscal global y no necesita emisor; la de "sin folio ni uuid" nunca
-- marca copia—.
--
-- Las tres direcciones quedan fijadas en `supabase/tests/0357_dedup_ejercicio_
-- emisor.sql`:
--   1. emisores DISTINTOS   → NO son copias   (lo que esta migración arregla).
--   2. mismo emisor         → SÍ son copias   (dos fotos del mismo ticket).
--   3. emisor NULO en ambos → SÍ son copias   (conserva el comportamiento de la
--      0349: sin emisor no hay con qué distinguirlas, y `coalesce(...,'')` las
--      deja en la misma partición. Fallar hacia "es copia" nunca imprime una
--      deducción de más, que es la dirección segura de este cubo).
--
-- FUERA DE ALCANCE, y se dice para que no se lea como olvido:
--   · `copiasDeComprobante` (engine.ts:514-564) NO se toca. Corre sobre un solo
--     viaje, donde su criterio sigue siendo el correcto y donde el comentario de
--     la 0349 ya razonó el intercambio a propósito. Que la misma definición viva
--     en dos lugares es el hallazgo de arquitectura de fondo (ARQ-A3 lo nombra),
--     y unificarla es un cambio de diseño, no este arreglo.
--   · FIS-A2 (`fecha` vs `pagado_en` para el corte del ejercicio) sigue
--     pendiente e intacto: es interpretación fiscal, decisión de Javier.
--
-- Mismo molde que la 0349: SECURITY INVOKER heredado, `create or replace`, firma
-- sin cambios, `set search_path` idéntico.
begin;

CREATE OR REPLACE FUNCTION public.sumar_combustible_ejercicio(p_tenant uuid, p_anio int, p_claves text[])
returns table (total numeric, efectivo numeric)
language sql
stable
parallel safe
set search_path = public, pg_catalog
as $$
  with candidatos as (
    select
      id, monto, forma_pago, pagado_en, pagado_forma, cfdi_uuid, cfdi_orden, folio, folio_norm, concepto,
      -- ARQ-A3 (0357): quién emitió el ticket. `nullif(...,'')` es la misma
      -- normalización que ya usa `gastos_fiscales_agregados_tenant` (0192).
      nullif(rfc_emisor, '') as rfc_emisor
    from gasto
    where tenant_id = p_tenant
      and monto > 0
      and fecha >= make_date(p_anio, 1, 1)
      and fecha <= make_date(p_anio, 12, 31)
      and (concepto = 'diesel' or (p_claves is not null and cardinality(p_claves) > 0 and clave_prod_serv = any(p_claves)))
  ),
  marcados as (
    select
      monto, forma_pago, pagado_en, pagado_forma,
      case
        when cfdi_uuid is not null then
          row_number() over (partition by lower(cfdi_uuid), coalesce(cfdi_orden, 1) order by id)
        when folio is not null then
          -- ARQ-A3 (0357): `coalesce(rfc_emisor, '')` entra a la partición. Sin
          -- él, el folio `1234` de la estación A y el `1234` de la estación B
          -- caían en la misma partición y el segundo salía con orden_copia = 2.
          row_number() over (
            partition by unaccent(lower(concepto)), coalesce(folio_norm, folio), monto, coalesce(rfc_emisor, '')
            order by id
          )
        else 1
      end as orden_copia
    from candidatos
  ),
  base as (
    select
      monto,
      case
        when forma_pago = '99' and pagado_en is not null then pagado_forma
        when forma_pago = '99' then null
        else forma_pago
      end as forma_pago_efectiva
    from marcados
    where orden_copia = 1
  )
  select
    coalesce(sum(monto), 0) as total,
    coalesce(sum(monto) filter (
      where forma_pago_efectiva is not null
        and forma_pago_efectiva <> '99'
        and forma_pago_efectiva not in ('02', '03', '04', '05', '28', '29')
    ), 0) as efectivo
  from base;
$$;

comment on function public.sumar_combustible_ejercicio(uuid, int, text[]) is
  '0357 (ARQ-A3): el dedup por folio incluye el emisor — el folio se reinicia por estación, y sin él dos tickets legítimos de $2,500 con folio 1234 contaban como uno, deflactando total Y tope del 15% en la misma dirección (siempre regalando cupo). Dedup por (cfdi_uuid, cfdi_orden) intacto. 0349 (excluir copias) y 0345 (forma efectiva del REP) intactas. FIS-A2 (fecha vs pagado_en) sigue pendiente, es decisión de Javier.';

commit;
