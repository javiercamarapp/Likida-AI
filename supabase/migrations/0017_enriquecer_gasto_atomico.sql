-- B13 — Pegarle el código a su ticket, sin pisar a nadie.
--
-- `enriquecerGastoConCodigo` hacía read-modify-write desde la app: leía
-- `ocr_extra` a un objeto de JS, le mezclaba los campos del código y escribía el
-- objeto ENTERO de vuelta. Dos problemas, ambos en el camino del dinero:
--
--  1. LOST UPDATE. Las fotos de una ráfaga de WhatsApp se procesan en paralelo.
--     Si entre la lectura y la escritura otra foto le añadió algo a ese mismo
--     `ocr_extra` (montoDiscrepante, textoSospechoso, rfcEmisorDudoso), la
--     escritura de acá lo borra: no mezcla contra lo que hay en la tabla, sino
--     contra lo que había cuando se leyó.
--
--  2. EL SEGUNDO ACERCAMIENTO PISABA AL PRIMERO. Dos acercamientos del mismo
--     total emparejan al mismo gasto, y el último en escribir se quedaba con el
--     renglón. Ese folio es exactamente el que la oficina teclea en el portal
--     para timbrar, así que quedarse con el del comprobante equivocado no deja
--     un hueco visible: deja un timbrado que rebota semanas después.
--
-- Se resuelve en SQL, donde la fila está bloqueada durante el UPDATE:
--   - el merge es `ocr_extra || p_extra` (jsonb), contra lo que hay AHORA;
--   - el claim es la condición del WHERE: solo entra si ese campo sigue vacío.
--
-- Devuelve true si de verdad enriqueció. false = alguien más llegó primero, y
-- eso NO es un error: es la respuesta correcta a "ya estaba tomado".

create or replace function enriquecer_gasto_codigo(
  p_gasto uuid,
  p_tenant uuid,
  p_extra jsonb,
  p_cfdi_uuid text default null
)
returns boolean
language plpgsql
as $$
declare tocadas int;
begin
  update gasto
  set
    -- `||` mezcla a la derecha: lo que trae el código gana sobre lo viejo, y
    -- todo lo demás que hubiera en ocr_extra sobrevive.
    ocr_extra = coalesce(ocr_extra, '{}'::jsonb) || p_extra,
    -- El UUID solo se pone si el gasto NO tenía: un ticket ya timbrado no se
    -- re-apunta a otro CFDI desde un acercamiento.
    cfdi_uuid = coalesce(cfdi_uuid, p_cfdi_uuid)
  where id = p_gasto
    and tenant_id = p_tenant
    -- EL CLAIM. Si ya tiene folio de portal, este acercamiento no es el suyo
    -- (o es un reintento del mismo) y no se toca nada.
    and (ocr_extra->>'folioPortal') is null;

  get diagnostics tocadas = row_count;
  return tocadas > 0;
end $$;

revoke all on function enriquecer_gasto_codigo(uuid, uuid, jsonb, text) from public, anon, authenticated;
