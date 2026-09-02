-- ═══════════════════════════════════════════════════════════════════════════
-- FASE 0 DE LA DESCARGA MASIVA (0231): MEDIR ANTES DE CONSTRUIR 37 PORTALES.
--
-- La pregunta que decide dónde vale la pena el trabajo: de los tickets que hoy
-- se persiguen a mano, ¿CUÁNTOS vendrían solos del buzón del SAT y cuántos
-- exigen entrar a un portal? La respuesta no se adivina — se cuenta.
--
-- CORRIDA DEL 27-AGO-2026 CONTRA PRODUCCIÓN:
--
--     gasto: 8 filas · 0 con CFDI · 1 tenant · 2 viajes
--     por concepto: alimentacion 4, otro 3, diesel 1 · caseta 0
--
-- O sea: LA BASE NO TIENE DATOS PARA MEDIR ESTO. No es que la distribución
-- salga pareja: es que no hay flota real todavía (8 gastos de siembra, ningún
-- CFDI, cero casetas). Cualquier porcentaje que se sacara de aquí sería una
-- cifra inventada con forma de medición, que es exactamente lo que este
-- producto no se permite.
--
-- Por eso la consulta queda escrita y sin correr: el día que entre el primer
-- cliente con volumen, esto se pega en el SQL editor y contesta en un segundo.
--
-- CÓMO SE LEE EL RESULTADO. Las tres cubetas de la última consulta:
--   · «cae solo (monedero)» — el emisor está en el padrón de monederos
--     autorizados. Su CFDI mensual con complemento ECC llega al buzón y
--     Likida lo concilia carga por carga. NO hay portal que visitar.
--   · «cae solo si hay alta» — casetas. Cae del buzón SOLO si la flota hizo
--     el alta fiscal en TeleVía o está en PASE pospago mensual; si no, es
--     portal Y el derecho se vence el último día del mes.
--   · «hay que ver» — el resto. Aquí es donde se decide si vale la pena un
--     adaptador de portal, y para cuál emisor: el ranking por RFC de la
--     segunda consulta dice cuáles concentran el gasto.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. ¿Hay algo que medir? Si esto sale en ceros, lo demás no significa nada.
select
  count(*)                                        as gastos,
  count(*) filter (where cfdi_uuid is not null)   as con_cfdi,
  count(*) filter (where cfdi_uuid is null)       as sin_cfdi,
  count(distinct tenant_id)                       as flotas,
  min(fecha)                                      as desde,
  max(fecha)                                      as hasta
from public.gasto;

-- ── 2. Los emisores que concentran el gasto SIN factura. El ranking dice para
-- cuál proveedor vale la pena un adaptador — y cuáles ya no hacen falta
-- porque su CFDI cae solo del buzón.
select
  coalesce(g.rfc_emisor, '(el ticket no traía RFC)') as rfc_emisor,
  g.concepto,
  count(*)                as tickets,
  sum(g.monto)::numeric(14,2) as monto,
  -- El padrón de monederos vive en el código (intake/padron_monederos.json) y
  -- no en la base: aquí se marcan los 13 RFC de esa semilla a mano. Un `false`
  -- significa «no está en la semilla», NUNCA «no es monedero».
  (g.rfc_emisor in (
    'ASE930924SS7','EFE8908015L3','PUN9810229R0','TIN090211JC9','SBR130327HU9',
    'PME811211B20','BGM141113GEA','TFM191231NA7','PET040903DH1','GME080312617',
    'VTO1508246S6','SIA030228F63','BFE150903SR1'
  )) as emisor_de_monedero
from public.gasto g
where g.cfdi_uuid is null
group by g.rfc_emisor, g.concepto
order by monto desc nulls last
limit 50;

-- ── 3. LA CIFRA QUE DECIDE: qué porcentaje del gasto sin factura cae solo.
select
  cubeta,
  count(*)                                          as tickets,
  sum(monto)::numeric(14,2)                         as monto,
  round(100.0 * count(*) / nullif(sum(count(*)) over (), 0), 1) as pct_tickets,
  round(100.0 * sum(monto) / nullif(sum(sum(monto)) over (), 0), 1) as pct_monto
from (
  select
    g.monto,
    case
      when g.rfc_emisor in (
        'ASE930924SS7','EFE8908015L3','PUN9810229R0','TIN090211JC9','SBR130327HU9',
        'PME811211B20','BGM141113GEA','TFM191231NA7','PET040903DH1','GME080312617',
        'VTO1508246S6','SIA030228F63','BFE150903SR1'
      ) then 'cae solo (monedero, CFDI mensual con ECC)'
      when g.concepto = 'caseta' then 'cae solo SI hay alta (TeleVia / PASE mensual); si no, portal y vence a fin de mes'
      else 'hay que ver — candidato a portal'
    end as cubeta
  from public.gasto g
  where g.cfdi_uuid is null
) t
group by cubeta
order by monto desc nulls last;
