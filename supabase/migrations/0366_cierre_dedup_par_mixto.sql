-- ═══════════════════════════════════════════════════════════════════════════
-- 0366 · El CIERRE deja de contar dos veces el par mixto: `total_comprobado`
--        espeja la semántica que la 0365 le dio al ejercicio.
--
-- AUDITORÍA 32 (continuación 10), DAT-32C10-C1 / ARQ-32C10-C2 (CRÍTICO).
-- Dos auditores llegaron por separado y el orquestador lo reprodujo contra
-- PostgreSQL 16.14 con las 342 migraciones sobre base virgen.
--
-- EL MECANISMO, y es distinto del de la 0365. La 0360 no usa dos ventanas: usa
-- UNA cuya partición es un `case` que produce una llave. Las dos filas de un par
-- mixto reciben llaves distintas POR CONSTRUCCIÓN —'u|<uuid>#<orden>' la que
-- trae UUID, 'f|<concepto>|<folio>|<monto>|<emisor>' su copia—, así que cada una
-- es `rn = 1` en su propia partición y sobreviven LAS DOS, en todos los órdenes
-- de llegada. Y el par mixto no es raro: es la ÚNICA forma que puede tomar un
-- par de copias de un comprobante con folio fiscal, porque `uq_gasto_img_hash`
-- deja entrar la segunda foto y `uq_gasto_cfdi_uuid` prohíbe que las dos lleven
-- el UUID.
--
-- MEDIDO, con UN ticket de diésel de $10,000 (folio MIX, emisor ESA030303CC1) en
-- dos filas, sobre un viaje con anticipo $30,000:
--
--     sumar_combustible_ejercicio (0365)             →  total 10000.00   ✅
--     guardar_liquidacion_tx(total_comprobado=10000) →  RECHAZADO  CU007
--     guardar_liquidacion_tx(total_comprobado=20000) →  ACEPTADO
--     liquidacion.total_comprobado guardado          →  20000.00
--
-- **La función rechazaba el valor verdadero y aceptaba —y persistía— el doble.**
-- No es inferencia: es el código de error de su propio guardia.
--
-- POR QUÉ ES CRÍTICO. `engine.ts:1286` calcula `diferencia = anticipo −
-- totalComprobado`. Con el ticket contado una vez el chofer regresa $20,000; con
-- el par mixto, $10,000. Y como el guardia de `0360:163-172` es un contrato de
-- IGUALDAD, el producto sólo tenía dos salidas: cerrar con el dinero mal, o no
-- poder liquidar el viaje en absoluto —el botón fallando con «los totales
-- enviados no se derivan de los insumos bloqueados» delante del contralor—.
-- Encima el MISMO PDF imprimía $10,000 de combustible del ejercicio (de la 0365)
-- junto a un comprobado de $20,000 del mismo ticket: dos cifras del mismo
-- renglón en una hoja firmada.
--
-- EL CAMBIO, y es uno solo. Un CTE `con_censo_de_uuids` —espejo literal del que
-- la 0365 le puso al ejercicio— y una rama PRIMERA en el `case`: cuando el grupo
-- de folio trae UNA sola fila con UUID, la llave del FOLIO manda para todas las
-- filas del grupo. Con `uuids_en_grupo >= 2` no se toca nada, así que dos CFDI
-- distintos que comparten folio, monto y emisor siguen contando dos veces.
--
-- `insumos_hash_version` SE QUEDA EN 2 a propósito: `cierre_insumos_hash`
-- (0354:95-143) hashea las filas CRUDAS y no cambió. Subirla invalidaría todos
-- los cierres en vuelo sin ninguna razón.
--
-- LO QUE ESTA MIGRACIÓN **NO** CIERRA, y se dice para que nadie lo lea como
-- cerrado: `gastos_fiscales_agregados_tenant` (0362) sigue con la semántica
-- vieja, y es la sede que alimenta el panel del contador (FIS-32C10-C1). Esta
-- migración baja el censo de sedes divergentes, no lo resuelve. El rediseño de
-- una sede única es ARQ-C1 y lleva 17 apariciones.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.guardar_liquidacion_tx(p_tenant uuid, p_viaje uuid, p_total_comprobado numeric, p_total_anticipo numeric, p_diferencia numeric, p_estatus text, p_diferencias jsonb, p_ieps numeric, p_iva numeric, p_peaje numeric, p_pdf_url text, p_litros_diesel numeric DEFAULT 0, p_n_gastos integer DEFAULT NULL::integer, p_insumos_hash text DEFAULT NULL::text, p_insumos_hash_version integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
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
    con_censo_de_uuids as (
      -- DAT-32C10-C1 / ARQ-32C10-C2 (0366): cuantas filas del grupo de folio
      -- traen `cfdi_uuid`. Va en un CTE aparte por la misma razon que el emisor
      -- del grupo: una funcion de ventana no puede anidarse en el `partition by`
      -- de otra, y esta particion usa `rfc_emisor_del_grupo`, que ya es
      -- resultado de ventana. `count()` ignora los NULL, asi que cuenta
      -- exactamente las filas con UUID. Es el ESPEJO del CTE homonimo de la
      -- 0365: misma particion que la llave 'f|' de abajo, para que el censo y
      -- la llave hablen del mismo grupo.
      select g.*,
        count(g.cfdi_uuid) over (
          partition by
            translate(lower(g.concepto), 'áéíóúüñ', 'aeiouun'),
            coalesce(nullif(g.folio_norm, ''), g.folio),
            g.monto,
            coalesce(g.rfc_emisor, g.rfc_emisor_del_grupo, '')
        ) as uuids_en_grupo
      from con_emisor_del_grupo g
    ),
    rankeados as (
      select monto,
        row_number() over (
          partition by case
            -- DAT-32C10-C1 / ARQ-32C10-C2 (0366): cuando el grupo de folio trae
            -- UNA sola fila con `cfdi_uuid`, la llave del FOLIO manda para TODAS
            -- las filas del grupo, la del UUID incluida. Sin esto las dos filas
            -- de un par mixto reciben llaves DISTINTAS por construccion —'u|…'
            -- la que trae UUID y 'f|…' su copia—, cada una es `rn = 1` en su
            -- propia particion y SOBREVIVEN LAS DOS, en todos los ordenes de
            -- llegada. Es exactamente la rama que la 0365 le puso a
            -- `sumar_combustible_ejercicio`; aqui faltaba, y por eso el cierre
            -- y el ejercicio contaban distinto el MISMO ticket.
            --
            -- Con `uuids_en_grupo >= 2` no se toca nada: dos CFDI DISTINTOS que
            -- comparten folio, monto y emisor son dos comprobantes, no copias, y
            -- siguen contando dos veces.
            when nullif(folio, '') is not null and uuids_en_grupo <= 1
              then 'f|' || translate(lower(concepto), 'áéíóúüñ', 'aeiouun')
                || '|' || coalesce(nullif(folio_norm, ''), folio)
                || '|' || monto::text
                || '|' || coalesce(rfc_emisor, rfc_emisor_del_grupo, '')
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
      from con_censo_de_uuids
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
end $function$;

comment on function public.guardar_liquidacion_tx(uuid, uuid, numeric, numeric, numeric, text, jsonb, numeric, numeric, numeric, text, numeric, integer, text, integer) is
  'v3 (0366, DAT-32C10-C1/ARQ-32C10-C2): la llave de dedup del cierre espeja la 0365 — cuando el grupo de folio trae un solo `cfdi_uuid`, la llave del FOLIO manda para todo el grupo, así que un par mixto cuenta UNA vez en total_comprobado. insumos_hash_version SIGUE EN 2: cierre_insumos_hash no cambió. Historial: 0321 (creación, exigía version=1), 0322 (firma 13→15 args), 0354 (exige version=2), 0360 (espejo de la 0358, emisor del grupo).';
