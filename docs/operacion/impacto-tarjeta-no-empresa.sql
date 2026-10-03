-- IMPACTO de la regla `tarjeta_no_empresa` (E1-B, P0-6) — SOLO LECTURA. Correr ANTES de publicar.
--
-- La regla: diésel (clave 15101505) con CFDI verificado, pagado con forma 04/05/28/29 (tarjeta o
-- monedero) y litros > 0 NO acredita litros y manda el viaje a «revisar», salvo que la flota haya
-- declarado que sus tarjetas son de la empresa (`tarjetasDeLaEmpresa(perfil) === true`):
--   perfil.tarjetasANombreEmpresa.valor = true (procedencia declarado/detectado) Y
--   perfil.pagoEnBomba no es 'chofer_reembolso' ni 'mixto'.
-- Espejo SQL de src/lib/likida/perfil/preguntas.ts (`tarjetasDeLaEmpresa`) y de la condición de
-- src/lib/likida/cuadre/engine.ts (bloque de `tarjeta_no_empresa`). Si cambian, cámbialo aquí.
--
-- NO retroactiva (src/lib/likida/cuadre/vigencia_tarjeta.ts): las liquidaciones cerradas ANTES de
-- TARJETA_NO_EMPRESA_VIGENTE_DESDE (2026-10-04 00:00 -06) se reabren/recalculan SIN la regla.
-- Por eso el resultado se parte en dos grupos:
--   protegidas  = cerradas antes de la vigencia: CAMBIARÍAN al reabrirse si la regla fuera
--                 retroactiva; con el código actual NO cambian (esta cifra es lo que se evita).
--   afectadas   = cerradas en/después de la vigencia (p. ej. entre la constante y el despliegue
--                 real): AL REABRIRSE se recalculan con la regla y su desglose se apaga / los litros
--                 pasan a 0. Es lo único que el despliegue puede mover; idealmente 0.
-- Además `viajes_con_diesel_con_tarjeta_sin_liquidar` = lo que hoy cierra y caerá en «revisar»
-- por cada flota sin declarar (volumen futuro, no retroactivo).

with perfil_decidido as (
  -- `decidir()`: un campo con procedencia inferido/ausente/default NO cuenta como declarado.
  select t.id as tenant_id, t.nombre,
         case when coalesce(t.perfil #>> '{tarjetasANombreEmpresa,procedencia}', 'ausente') in ('inferido', 'ausente', 'default')
              then null else t.perfil #>> '{tarjetasANombreEmpresa,valor}' end as tarjetas,
         case when coalesce(t.perfil #>> '{pagoEnBomba,procedencia}', 'ausente') in ('inferido', 'ausente', 'default')
              then null else t.perfil #>> '{pagoEnBomba,valor}' end as bomba
  from tenant t
),
sin_declarar as (
  -- Complemento de `tarjetasDeLaEmpresa(perfil) === true`.
  select tenant_id, nombre
  from perfil_decidido
  where coalesce(tarjetas, '') = 'false' or coalesce(bomba, '') = 'chofer_reembolso'          -- declaró que NO
     or not (coalesce(tarjetas, '') = 'true' and coalesce(bomba, '') <> 'mixto')              -- sin declaración suficiente (incluye 'mixto')
),
gastos_que_disparan as (
  select g.tenant_id, g.viaje_id, g.id as gasto_id
  from gasto g
  join sin_declarar s on s.tenant_id = g.tenant_id
  where g.xml_verificado is true
    and g.forma_pago in ('04', '05', '28', '29')
    and g.clave_prod_serv = '15101505'
    and coalesce(nullif(g.ocr_extra ->> 'litros', '')::numeric, 0) > 0
),
liq as (
  select l.id, l.tenant_id, l.viaje_id, l.created_at,
         (l.created_at < timestamptz '2026-10-04 00:00:00-06') as protegida
  from liquidacion l
  where exists (select 1 from gastos_que_disparan q where q.tenant_id = l.tenant_id and q.viaje_id = l.viaje_id)
)
select
  count(*) filter (where protegida)                       as liquidaciones_protegidas_por_la_vigencia,
  count(*) filter (where not protegida)                   as liquidaciones_afectadas_al_reabrirse,
  count(distinct tenant_id)                               as flotas_con_liquidaciones_en_juego,
  (select count(distinct v.id)
     from viaje v
     join gastos_que_disparan q on q.viaje_id = v.id
    where not exists (select 1 from liquidacion l2 where l2.viaje_id = v.id))
                                                          as viajes_con_diesel_con_tarjeta_sin_liquidar,
  (select count(*) from sin_declarar)                     as flotas_sin_declaracion_positiva_de_tarjetas
from liq;

-- Detalle por flota (las que hay que llamar para que contesten «Tarjetas a nombre de la empresa» y
-- «Quién paga en la bomba» en su perfil antes de que sus viajes empiecen a caer en «revisar»).
-- with ... mismas CTE que arriba; ejecútalo pegándolas, o sustituye el SELECT final por:
--   select s.nombre, count(distinct q.viaje_id) as viajes_con_diesel_con_tarjeta
--   from gastos_que_disparan q join sin_declarar s using (tenant_id)
--   group by s.nombre order by 2 desc;
