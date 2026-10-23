-- ═══════════════════════════════════════════════════════════════════════════
-- 0858 — AUDITORÍA 35, R04-fiscal-01 (ALTO): la liga de un CFDI del SAT a un
--         gasto marcaba `xml_verificado = true` pero NO copiaba los campos
--         fiscales del XML.
--
-- ── EL DEFECTO ─────────────────────────────────────────────────────────────
-- Los dos caminos que ligan un CFDI de la descarga masiva del SAT a un gasto
-- (el automático, `ligar` en sat_descarga/ciclo.ts, y el manual,
-- `sat_cfdi_ligar_tx` de la 0263 vía resolucion.ts) escribían SOLO
-- `cfdi_uuid`, `cfdi_orden = 1` y `xml_verificado = true`. El camino de
-- WhatsApp (`updateGastoCfdiXml`, repo.ts) escribe además rfc_emisor,
-- rfc_receptor, monto, forma_pago, metodo_pago, sub_total, descuento,
-- ieps_traslado, iva_traslado, iva_retenido, isr_retenido, clave_prod_serv,
-- clave_unidad, tipo_comprobante, complemento_hidrocarburos,
-- cfdi_esquema_alterno y, en ocr_extra, litros / moneda / tipoCambio.
-- Resultado: un gasto «verificado» con sub_total, iva_traslado y
-- rfc_receptor en NULL → el motor de cuadre no acredita IVA, no da estímulo
-- de peaje y la póliza se bloquea por folio con 409 «base gravable
-- desconocida». Fail-closed (subestima, no sobre-acredita), pero pierde
-- dinero real del cliente.
--
-- ── EL ARREGLO (ADITIVO: NO se toca la 0263) ───────────────────────────────
-- Dos funciones NUEVAS; `sat_cfdi_ligar_tx` (7 parámetros) queda EXACTAMENTE
-- como la dejó la 0263, así el código desplegado hoy sigue funcionando sin
-- cambio y el código nuevo detecta si esta migración ya está aplicada.
--
--   1. gasto_ligar_cfdi_campos(tenant, gasto, cfdi_uuid, campos jsonb)
--      Liga el CFDI al gasto Y copia los campos del XML en UN solo UPDATE,
--      con la última línea de defensa EN LA BASE: los campos solo se copian
--      si el XML pasa las mismas guardas con que el camino de WhatsApp
--      empareja un XML con un ticket (folio igual, no es nota de crédito,
--      total al centavo, SubTotal presente, mismo emisor si el ticket ya
--      traía RFC). Si NO las pasa —o no hay XML (`p_campos` nulo)— el gasto
--      se LIGA igual que hoy (cfdi_uuid + xml_verificado) y los campos fiscales
--      se quedan como estaban (NULL): NUNCA se inventa un valor. La función
--      devuelve `campos_copiados` y `motivo` para que el llamador lo diga.
--   2. sat_cfdi_ligar_campos_tx(…, p_campos jsonb)
--      Copia de `sat_cfdi_ligar_tx` (mismos candados, mismos SQLSTATE CU014 /
--      CU015, mismo expediente) cuyo UPDATE del gasto es la función 1.
--
-- No se hace backfill: los gastos YA ligados por el SAT con campos NULL se
-- quedan como están (propuesta aparte en el PR; esta migración no toca datos).
--
-- Redondeo: numeric(12,2) de la columna; `round(…, 2)` de numeric es
-- «medio hacia afuera de cero», sin pasar por coma flotante binaria
-- (un 0.285 que llegó como JSON 0.285 se guarda 0.29, no 0.28).
--
-- REVERSA (la 0263 no se modifica; basta quitar lo nuevo):
--   drop function if exists public.sat_cfdi_ligar_campos_tx(uuid, uuid, uuid, text, jsonb, uuid, text, jsonb);
--   drop function if exists public.gasto_ligar_cfdi_campos(uuid, uuid, text, jsonb);
-- Y `public.sat_cfdi_ligar_tx(uuid, uuid, uuid, text, jsonb, uuid, text)` sigue
-- tal cual en la definición de supabase/migrations/0263_ligar_cfdi_sat_transaccional.sql
-- (si alguien la hubiera cambiado, restaurarla copiando literal ese archivo).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. La liga + copia de campos de UN gasto ───────────────────────────────
create or replace function public.gasto_ligar_cfdi_campos(
  p_tenant    uuid,
  p_gasto     uuid,
  p_cfdi_uuid text,
  p_campos    jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uuid        text := lower(btrim(p_cfdi_uuid));
  v_monto       numeric;
  v_rfc_emisor  text;
  v_fecha       date;
  v_ocr         jsonb;
  v_motivo      text := null;
  v_total       numeric;
  v_rfc_xml     text;
  v_ocr_nuevo   jsonb;
  v_fecha_xml   date;
begin
  -- El gasto TRABADO, de esta flota y TODAVÍA sin comprobante (la guardia
  -- optimista que antes era `.is('cfdi_uuid', null)` en TypeScript).
  select monto, rfc_emisor, fecha, ocr_extra
    into v_monto, v_rfc_emisor, v_fecha, v_ocr
    from gasto
   where id = p_gasto and tenant_id = p_tenant and cfdi_uuid is null
     for update;

  if not found then
    return jsonb_build_object('ligado', false, 'campos_copiados', false, 'motivo', 'gasto_no_disponible');
  end if;

  -- ── Las guardas: ante la duda NO se copia nada (se liga, sin campos) ─────
  if p_campos is null or jsonb_typeof(p_campos) <> 'object' then
    v_motivo := 'sin_xml';
  elsif lower(btrim(coalesce(p_campos->>'uuid', ''))) <> v_uuid then
    v_motivo := 'folio_distinto';
  elsif upper(coalesce(p_campos->>'tipo_comprobante', '')) = 'E' then
    v_motivo := 'nota_de_credito';
  elsif jsonb_typeof(p_campos->'total') is distinct from 'number'
        or (p_campos->>'total')::numeric <= 0 then
    v_motivo := 'total_ilegible';
  elsif abs(v_monto - (p_campos->>'total')::numeric) > 0.01 then
    v_motivo := 'total_no_coincide';
  elsif jsonb_typeof(p_campos->'sub_total') is distinct from 'number'
        or (p_campos->>'sub_total')::numeric < 0 then
    v_motivo := 'sin_subtotal';
  else
    v_rfc_xml := upper(nullif(btrim(coalesce(p_campos->>'rfc_emisor', '')), ''));
    if v_rfc_emisor is not null and btrim(v_rfc_emisor) <> ''
       and v_rfc_xml is not null and upper(btrim(v_rfc_emisor)) <> v_rfc_xml then
      v_motivo := 'emisor_distinto';
    end if;
  end if;

  if v_motivo is not null then
    -- Solo la liga, idéntica a la 0263: ningún campo fiscal se toca.
    update gasto
       set cfdi_uuid = v_uuid, cfdi_orden = 1, xml_verificado = true
     where id = p_gasto and tenant_id = p_tenant;
    return jsonb_build_object('ligado', true, 'campos_copiados', false, 'motivo', v_motivo);
  end if;

  -- ── Los campos, validados uno por uno: lo que no es válido queda NULL ────
  v_total := (p_campos->>'total')::numeric;

  -- ocr_extra: se MERGEA (no se reemplaza el jsonb: ahí viven producto,
  -- estación, fechaImpresa…), igual que `updateGastoCfdiXml`.
  v_ocr_nuevo := coalesce(v_ocr, '{}'::jsonb);
  if p_campos->>'clave_unidad' = 'LTR'
     and jsonb_typeof(p_campos->'cantidad') = 'number'
     and (p_campos->>'cantidad')::numeric > 0 then
    v_ocr_nuevo := v_ocr_nuevo || jsonb_build_object('litros', (p_campos->>'cantidad')::numeric);
  end if;
  if nullif(btrim(coalesce(p_campos->>'moneda', '')), '') is not null then
    v_ocr_nuevo := v_ocr_nuevo || jsonb_build_object('moneda', btrim(p_campos->>'moneda'));
  end if;
  if jsonb_typeof(p_campos->'tipo_cambio') = 'number' then
    v_ocr_nuevo := v_ocr_nuevo || jsonb_build_object('tipoCambio', (p_campos->>'tipo_cambio')::numeric);
  end if;

  -- La fecha del XML SOLO llena un hueco: no se mueve el día de un ticket que
  -- ya traía fecha (cambiaría el tope diario y el periodo del gasto).
  if v_fecha is null and (p_campos->>'fecha') ~ '^\d{4}-\d{2}-\d{2}' then
    v_fecha_xml := left(p_campos->>'fecha', 10)::date;
    if v_fecha_xml < date '2000-01-01' then v_fecha_xml := null; end if;
  end if;

  update gasto set
    cfdi_uuid      = v_uuid,
    cfdi_orden     = 1,
    xml_verificado = true,
    monto          = round(v_total, 2),
    fecha          = coalesce(fecha, v_fecha_xml),
    rfc_emisor     = coalesce(nullif(btrim(coalesce(rfc_emisor, '')), ''), v_rfc_xml),
    rfc_receptor   = upper(nullif(btrim(coalesce(p_campos->>'rfc_receptor', '')), '')),
    forma_pago     = nullif(btrim(coalesce(p_campos->>'forma_pago', '')), ''),
    metodo_pago    = nullif(btrim(coalesce(p_campos->>'metodo_pago', '')), ''),
    clave_prod_serv = nullif(btrim(coalesce(p_campos->>'clave_prod_serv', '')), ''),
    clave_unidad   = nullif(btrim(coalesce(p_campos->>'clave_unidad', '')), ''),
    tipo_comprobante = nullif(btrim(coalesce(p_campos->>'tipo_comprobante', '')), ''),
    complemento_hidrocarburos = case when jsonb_typeof(p_campos->'complemento_hidrocarburos') = 'boolean'
                                     then (p_campos->>'complemento_hidrocarburos')::boolean end,
    cfdi_esquema_alterno = case when jsonb_typeof(p_campos->'esquema_alterno') = 'boolean'
                                then (p_campos->>'esquema_alterno')::boolean end,
    sub_total      = round((p_campos->>'sub_total')::numeric, 2),
    descuento      = case when jsonb_typeof(p_campos->'descuento') = 'number' and (p_campos->>'descuento')::numeric >= 0
                          then round((p_campos->>'descuento')::numeric, 2) end,
    ieps_traslado  = case when jsonb_typeof(p_campos->'ieps_traslado') = 'number' and (p_campos->>'ieps_traslado')::numeric >= 0
                          then round((p_campos->>'ieps_traslado')::numeric, 2) end,
    iva_traslado   = case when jsonb_typeof(p_campos->'iva_traslado') = 'number' and (p_campos->>'iva_traslado')::numeric >= 0
                          then round((p_campos->>'iva_traslado')::numeric, 2) end,
    iva_retenido   = case when jsonb_typeof(p_campos->'iva_retenido') = 'number' and (p_campos->>'iva_retenido')::numeric >= 0
                          then round((p_campos->>'iva_retenido')::numeric, 2) end,
    isr_retenido   = case when jsonb_typeof(p_campos->'isr_retenido') = 'number' and (p_campos->>'isr_retenido')::numeric >= 0
                          then round((p_campos->>'isr_retenido')::numeric, 2) end,
    ocr_extra      = case when v_ocr_nuevo = '{}'::jsonb and v_ocr is null then null else v_ocr_nuevo end
  where id = p_gasto and tenant_id = p_tenant;

  return jsonb_build_object('ligado', true, 'campos_copiados', true, 'motivo', null);
end;
$$;

comment on function public.gasto_ligar_cfdi_campos(uuid, uuid, text, jsonb) is
  'Liga un CFDI del SAT a un gasto sin comprobante Y copia los campos fiscales del XML (auditoría 35, R04-fiscal-01). Antes la liga solo escribía cfdi_uuid + xml_verificado y dejaba sub_total, iva_traslado y rfc_receptor en NULL (IVA acreditable y estímulo de peaje en cero, póliza bloqueada por folio). Los campos solo se copian si el XML pasa las guardas (folio igual, no nota de crédito, total al centavo, SubTotal presente, mismo emisor); si no pasa, o no hay XML, el gasto se liga como antes y los campos quedan NULL. Devuelve {ligado, campos_copiados, motivo}.';

revoke execute on function public.gasto_ligar_cfdi_campos(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant  execute on function public.gasto_ligar_cfdi_campos(uuid, uuid, text, jsonb) to service_role;

-- ── 2. La liga manual atómica (0263) con copia de campos ───────────────────
create or replace function public.sat_cfdi_ligar_campos_tx(
  p_tenant           uuid,
  p_cfdi             uuid,
  p_gasto            uuid,
  p_estatus_esperado text,
  p_candidatos       jsonb,
  p_actor_id         uuid,
  p_actor_email      text,
  p_campos           jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_cfdi_uuid text;
  v_res       jsonb;
begin
  select cfdi_uuid into v_cfdi_uuid
    from sat_cfdi_descargado
   where id = p_cfdi and tenant_id = p_tenant and estatus = p_estatus_esperado
     for update;

  if not found then
    raise exception 'comprobante % no coincide con el estatus % en la flota %', p_cfdi, p_estatus_esperado, p_tenant
      using errcode = 'CU014';
  end if;

  perform 1 from gasto
   where id = p_gasto and tenant_id = p_tenant and cfdi_uuid is null
     for update;

  if not found then
    raise exception 'gasto % no disponible para el cruce en la flota %', p_gasto, p_tenant
      using errcode = 'CU015';
  end if;

  -- El gasto PRIMERO (puede lanzar CU001 si el viaje ya se liquidó: se deja
  -- propagar, la función entera revierte), el comprobante DESPUÉS.
  v_res := public.gasto_ligar_cfdi_campos(p_tenant, p_gasto, v_cfdi_uuid, p_campos);
  if not coalesce((v_res->>'ligado')::boolean, false) then
    raise exception 'gasto % no disponible para el cruce en la flota %', p_gasto, p_tenant
      using errcode = 'CU015';
  end if;

  update sat_cfdi_descargado
     set estatus = 'casado',
         gasto_id = p_gasto,
         candidatos = p_candidatos,
         resuelto_por = p_actor_id,
         resuelto_por_email = p_actor_email,
         resuelto_en = now()
   where id = p_cfdi and tenant_id = p_tenant;

  insert into sat_cfdi_resolucion
    (tenant_id, cfdi_id, acto, gasto_id, estatus_antes, estatus_despues, actor_id, actor_email)
  values
    (p_tenant, p_cfdi, 'ligado', p_gasto, p_estatus_esperado, 'casado', p_actor_id, p_actor_email);

  return jsonb_build_object(
    'gasto_id', p_gasto,
    'cfdi_uuid', v_cfdi_uuid,
    'campos_copiados', coalesce((v_res->>'campos_copiados')::boolean, false),
    'motivo_campos', v_res->>'motivo'
  );
end;
$$;

comment on function public.sat_cfdi_ligar_campos_tx(uuid, uuid, uuid, text, jsonb, uuid, text, jsonb) is
  'Igual que sat_cfdi_ligar_tx (0263: mismos candados, CU014/CU015, mismo expediente, todo en una transacción) pero el UPDATE del gasto es gasto_ligar_cfdi_campos: además de la liga copia los campos fiscales del XML cuando pasa las guardas (auditoría 35, R04-fiscal-01). p_campos nulo = liga sin campos, como la 0263. Devuelve {gasto_id, cfdi_uuid, campos_copiados, motivo_campos}.';

revoke execute on function public.sat_cfdi_ligar_campos_tx(uuid, uuid, uuid, text, jsonb, uuid, text, jsonb) from public, anon, authenticated;
grant  execute on function public.sat_cfdi_ligar_campos_tx(uuid, uuid, uuid, text, jsonb, uuid, text, jsonb) to service_role;
