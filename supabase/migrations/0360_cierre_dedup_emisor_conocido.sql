-- 0360 — ARQ32C4-C1 (CRÍTICO): el TERCER LADO DEL ESPEJO, el del CIERRE.
--
-- QUÉ ESTABA ROTO, Y LO METIÓ ESTA MISMA RAMA. Las migraciones 0357/0358/0359
-- le enseñaron al SQL del panel que el folio lo numera cada estación y SE
-- REINICIA POR EMISOR. El commit `790900d` (19-sep) se lo enseñó al motor en
-- TS: `copiasDeComprobante` (engine.ts:516) dedupa desde entonces mirando el
-- emisor cuando se conoce. Nadie se lo enseñó a `guardar_liquidacion_tx`, que
-- es quien VERIFICA los totales en el instante del cierre y se quedó con la
-- llave anterior a la 0357(`0354:238-256`):
--
--   TS  (engine.ts, desde 790900d)     f|concepto|folio|monto|EMISOR  → $5,000
--   SQL (0354 guardar_liquidacion_tx)  f|concepto|folio|monto         → $2,500
--
-- El daño NO es una cifra mal: es que el cierre SE VUELVE IMPOSIBLE. Los
-- totales dejan de derivarse de los insumos bloqueados, la RPC lanza CU007
-- `snapshot_invalid`, y `insumosDeCierreCambiaron` (repo.ts:1066-1070) sólo
-- reconoce CU003 y CU006 — CU007 no lo traduce NADIE en TS. El contralor que
-- intenta liquidar un viaje con dos tickets legítimos de $2,500 con el mismo
-- folio de dos gasolineras distintas no puede cerrarlo, y lo que recibe es un
-- error opaco. La ruta del cierre sí trae el emisor (`getGastos`, repo.ts:992
-- y :1012), así que basta con que el OCR lo haya leído para caer aquí.
--
-- Lo encontraron DOS auditores independientes por dos ejes distintos —
-- arquitectura (ARQ32C4-C1) desde la estructura y cumplimiento fiscal (FIS-C4)
-- desde la norma — y está reproducido contra Postgres 16 con las 336
-- migraciones sobre base virgen en `supabase/tests/0360_cierre_dedup_emisor.sql`.
--
-- QUÉ HACE ESTA MIGRACIÓN, Y QUÉ NO.
-- Espeja la llave de la **0358**, no la de la 0357, y la distinción es el
-- hallazgo caro de la continuación 2: el emisor discrimina SÓLO CUANDO SE
-- CONOCE, y la fila sin emisor HEREDA el del grupo (`min()` sobre los
-- conocidos, igual que `0358:80-82`). Un grupo entero sin emisor se comporta
-- como antes de la 0357. Las cuatro direcciones de la 0358 valen aquí igual y
-- las cuatro están en el arnés.
--
-- NO toca el hash: `cierre_insumos_hash` (0354:95-143) hashea las filas crudas
-- de `gasto`, no un total deduplicado, así que esta llave no lo mueve y
-- `insumos_hash_version` SE QUEDA EN 2 a propósito — subirla invalidaría todos
-- los snapshots en vuelo sin que la fotografía haya cambiado.
--
-- NO unifica la normalización del concepto, y se declara porque es deuda viva:
-- la 0358 usa `unaccent(lower(...))` y esta función usa
-- `translate(lower(...),'áéíóúüñ','aeiouun')`. Difieren en los acentos que
-- `unaccent` cubre y `translate` no (ü/ö, mayúsculas acentuadas ya bajadas por
-- `lower`). Arreglarlo aquí sería cambiar la partición de TODOS los cierres en
-- una migración cuyo alcance es el emisor; queda anotado como hallazgo
-- (ARQ32C4-M2) y no se toca. Cambio quirúrgico: sólo el emisor.
--
-- Lo único que cambia respecto de `0354` es el bloque `rankeados`, que pasa de
-- un CTE a tres (`candidatos` → `con_emisor_del_grupo` → `rankeados`): una
-- función de ventana no puede anidarse en el `partition by` de otra, que es la
-- misma razón por la que la 0358 lo partió en dos.
begin;

CREATE OR REPLACE FUNCTION public.guardar_liquidacion_tx(
  p_tenant uuid, p_viaje uuid, p_total_comprobado numeric, p_total_anticipo numeric,
  p_diferencia numeric, p_estatus text, p_diferencias jsonb, p_ieps numeric,
  p_iva numeric, p_peaje numeric, p_pdf_url text, p_litros_diesel numeric default 0,
  p_n_gastos integer default null, p_insumos_hash text default null,
  p_insumos_hash_version integer default null
)
returns uuid
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_id uuid;
  v_viaje public.viaje%rowtype;
  v_n integer;
  v_hash text;
  v_total numeric;
begin
  perform pg_advisory_xact_lock(public.cierre_tenant_lock_key(p_tenant));

  select * into v_viaje
  from public.viaje
  where id = p_viaje and tenant_id = p_tenant
  for update;
  if not found then
    raise exception 'el viaje % no existe o no es de la flota %', p_viaje, p_tenant
      using errcode = 'CU002';
  end if;

  perform 1 from public.tenant where id = p_tenant for share;
  perform 1 from public.operador
    where id = v_viaje.operador_id and tenant_id = p_tenant for share;

  if p_n_gastos is not null then
    select count(*) into v_n from public.gasto
      where viaje_id = p_viaje and tenant_id = p_tenant;
    if v_n <> p_n_gastos then
      raise exception 'el viaje % tenía % comprobante(s) y ahora tiene %', p_viaje, p_n_gastos, v_n
        using errcode = 'CU003';
    end if;
  end if;

  -- DAT-B1 (0354): un cliente que todavía pida version=1 (código viejo en
  -- vuelo durante el propio deploy) rebota aquí con snapshot_invalid, no con
  -- un hash comparado bajo la fórmula equivocada — falla cerrado, fuerza a
  -- releer el snapshot con el código nuevo.
  if p_insumos_hash is not null or p_insumos_hash_version is not null then
    if p_insumos_hash is null
       or p_insumos_hash_version is distinct from 2
       or p_insumos_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'snapshot_invalid: versión/hash de cierre inválidos'
        using errcode = 'CU007';
    end if;

    v_hash := public.cierre_insumos_hash(p_tenant, p_viaje);
    if v_hash is distinct from p_insumos_hash then
      raise exception 'snapshot_changed: cambiaron insumos económicos/fiscales del viaje %', p_viaje
        using errcode = 'CU006';
    end if;

    if round(coalesce(p_total_anticipo, 0), 2) is distinct from round(v_viaje.anticipo, 2) then
      raise exception 'snapshot_invalid: total_anticipo no coincide con viaje.anticipo'
        using errcode = 'CU007';
    end if;

    -- ARQ32C4-C1 (0360): EL ESPEJO DE LA 0358, en la llave del cierre.
    -- Tres CTE en vez de uno: una función de ventana no puede anidarse en el
    -- `partition by` de otra, así que el emisor del grupo se calcula aparte.
    with candidatos as (
      select g.id, g.monto, g.created_at, g.cfdi_uuid, g.cfdi_orden,
             g.folio, g.folio_norm, g.concepto,
             -- misma normalización que `0358:64` y que
             -- `gastos_fiscales_agregados_tenant` (0192): '' es ausencia.
             nullif(g.rfc_emisor, '') as rfc_emisor
      from public.gasto g
      where g.tenant_id = p_tenant and g.viaje_id = p_viaje
    ),
    con_emisor_del_grupo as (
      -- El emisor CONOCIDO del grupo (concepto, folio, monto). `min()` ignora
      -- los NULL, así que sale NULL sólo cuando NINGUNA fila del grupo trae
      -- emisor — el caso 3, que se comporta como antes de la 0357.
      select c.*,
        min(c.rfc_emisor) over (
          partition by
            translate(lower(c.concepto), 'áéíóúüñ', 'aeiouun'),
            coalesce(nullif(c.folio_norm, ''), c.folio),
            c.monto
        ) as rfc_emisor_del_grupo
      from candidatos c
    ),
    rankeados as (
      select monto,
        row_number() over (
          partition by case
            when nullif(cfdi_uuid, '') is not null
              then 'u|' || lower(cfdi_uuid) || '#' || coalesce(cfdi_orden, 1)::text
            when nullif(folio, '') is not null
              -- La fila SIN emisor hereda el del grupo en vez de abrir
              -- partición propia (0358). El `''` final conserva el caso en que
              -- todo el grupo viene sin emisor.
              then 'f|' || translate(lower(concepto), 'áéíóúüñ', 'aeiouun')
                || '|' || coalesce(nullif(folio_norm, ''), folio)
                || '|' || monto::text
                || '|' || coalesce(rfc_emisor, rfc_emisor_del_grupo, '')
            else 'i|' || id::text
          end
          order by created_at, id
        ) as rn
      from con_emisor_del_grupo
    )
    select coalesce(round(sum(monto) filter (where rn = 1 and monto > 0), 2), 0)
      into v_total from rankeados;

    if round(coalesce(p_total_comprobado, 0), 2) is distinct from v_total
       or round(coalesce(p_total_anticipo, 0) - coalesce(p_total_comprobado, 0), 2)
          is distinct from round(coalesce(p_diferencia, 0), 2) then
      raise exception 'snapshot_invalid: los totales enviados no se derivan de los insumos bloqueados'
        using errcode = 'CU007';
    end if;
  end if;

  insert into public.liquidacion (
    tenant_id, viaje_id, total_comprobado, total_anticipo, diferencia,
    estatus, diferencias, ieps_acreditable, iva_acreditable, peaje_acreditable,
    pdf_url, litros_diesel_acreditables, insumos_hash, insumos_hash_version
  ) values (
    p_tenant, p_viaje, p_total_comprobado, p_total_anticipo, p_diferencia,
    p_estatus, p_diferencias, p_ieps, p_iva, p_peaje,
    p_pdf_url, p_litros_diesel, p_insumos_hash, p_insumos_hash_version
  )
  on conflict (viaje_id) do update set
    total_comprobado = excluded.total_comprobado,
    total_anticipo = excluded.total_anticipo,
    diferencia = excluded.diferencia,
    estatus = excluded.estatus,
    diferencias = excluded.diferencias,
    ieps_acreditable = excluded.ieps_acreditable,
    iva_acreditable = excluded.iva_acreditable,
    peaje_acreditable = excluded.peaje_acreditable,
    litros_diesel_acreditables = excluded.litros_diesel_acreditables,
    pdf_url = coalesce(excluded.pdf_url, liquidacion.pdf_url),
    insumos_hash = coalesce(excluded.insumos_hash, liquidacion.insumos_hash),
    insumos_hash_version = coalesce(excluded.insumos_hash_version, liquidacion.insumos_hash_version)
  returning id into v_id;

  update public.viaje set estatus = 'liquidado'
    where id = p_viaje and tenant_id = p_tenant;
  return v_id;
end $$;

comment on function public.guardar_liquidacion_tx(
  uuid, uuid, numeric, numeric, numeric, text, jsonb, numeric, numeric,
  numeric, text, numeric, integer, text, integer
) is
  'v2 (0360, ARQ32C4-C1): la llave de dedup del cierre espeja la 0358 — el emisor discrimina sólo cuando se conoce y la fila sin emisor hereda el del grupo. insumos_hash_version SIGUE EN 2: cierre_insumos_hash no cambió. Historial: 0321 (creación, exigía version=1), 0322 (firma 13→15 args), 0354 (exige version=2).';

commit;
