-- ═══════════════════════════════════════════════════════════════════════════
-- SEED — Transportes Innovativos (demo 6-ago-2026)
--
-- 🔴🔴🔴  TODO LO MARCADO CON "INVENTADO" ES DATO DE FANTASÍA  🔴🔴🔴
--         Reemplázalo con el dato REAL de Innovativos antes del demo.
--
-- Qué es real vs inventado:
--   ✅ REAL:      corredor Silao → Nuevo Laredo, las 3 terminales, el vertical.
--   🔴 INVENTADO: nombres de operadores, teléfonos, TODA la política de gastos
--                 (topes, anticipos), y todos los montos de comprobantes.
--
-- La política es PARAMETRIZABLE: cambia los valores del bloque POLÍTICA y listo.
-- Idempotente: se puede correr varias veces (ON CONFLICT DO NOTHING).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Tenant (la flota) ───────────────────────────────────────────────────────
--
-- Los tres campos de RESPONSABLE (razón social, domicilio, liga del aviso) no
-- son adorno: sin ellos el aviso de privacidad NO se envía. Es a propósito —un
-- aviso sin responsable no dice a quién reclamarle, que es justo para lo que
-- sirve— pero significa que con estos campos vacíos el flujo se ve incompleto.
-- Detalle en normas/lfpdppp-15-16.yaml.
insert into tenant (id, nombre, rfc, ciudad, plan,
                    razon_social, domicilio_fiscal, url_aviso_privacidad) values
  ('11111111-1111-1111-1111-111111111111', 'Transportes Innovativos',
   'TIN010101AAA',                 -- 🔴 INVENTADO: RFC real de Innovativos
   'Silao, Guanajuato', 'demo',
   -- 🔴 INVENTADOS los dos primeros. La razón social va TAL CUAL esté en el
   -- RFC y el domicilio es el FISCAL (la ciudad de arriba no sirve: no es un
   -- domicilio). Los dos los tiene que capturar la flota.
   --
   -- LA LIGA YA NO ES UN INVENTO. Apuntaba a `transportesinnovativos.mx`, que
   -- responde NXDOMAIN: el operador recibía una dirección muerta y la respuesta
   -- a *PRIVACIDAD* tenía que confesar que no había a dónde mandarlo. Ahora
   -- apunta al integral que sirve la propia app (`/aviso/[tenant]`), armado con
   -- estos mismos datos. El responsable sigue siendo la flota (art. 14); Likida
   -- solo aloja el documento como persona encargada, y el texto lo dice.
   --
   -- El host es `likida.ai` porque HOY ese dominio sirve esta app: se comprobó
   -- con curl el 31-jul (título de `layout.tsx`, `/acceso` 200, y el webhook
   -- devolviendo 403 al token malo, o sea que la ruta existe). La primera
   -- versión de esta línea decía `cuadra.mx`, que NO es nuestro: es un dominio
   -- parkeado que redirige a su página de venta. Habría mandado al operador al
   -- anuncio de un desconocido desde su aviso de privacidad.
   --
   -- DECIDIDO el 31-jul: el software se muda a `app.likida.ai` y `likida.ai`
   -- queda para la landing. Esta línea NO se adelanta a ese cambio a propósito
   -- —hoy `app.likida.ai` da 404— porque una liga que todavía no resuelve es el
   -- bug que esto vino a cerrar. Se mueve en el paso 3 del orden de §6 del
   -- handoff, junto con `NEXT_PUBLIC_APP_URL`. En localhost
   -- `revisarAvisoIntegral` marca la liga `inservible` a propósito, así que en
   -- dev el operador recibe el aviso degradado, que es lo correcto.
   'TRANSPORTES INNOVATIVOS SA DE CV',
   'Carretera Silao-Romita Km 4.5, Parque Industrial, 36100 Silao, Guanajuato',
   'https://likida.ai/aviso/11111111-1111-1111-1111-111111111111')
on conflict (id) do update set
  -- Se actualiza aunque el tenant ya exista: el `do nothing` de antes dejaba a
  -- las flotas ya sembradas sin los campos nuevos para siempre.
  razon_social         = excluded.razon_social,
  domicilio_fiscal     = excluded.domicilio_fiscal,
  url_aviso_privacidad = excluded.url_aviso_privacidad;

-- ── Terminales (✅ REALES: su operación es multi-terminal en este corredor) ──
insert into terminal (id, tenant_id, nombre, ciudad) values
  ('22222222-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Silao',        'Silao, GTO'),
  ('22222222-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Guadalajara',  'Guadalajara, JAL'),
  ('22222222-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Nuevo Laredo', 'Nuevo Laredo, TAM')
on conflict (id) do nothing;

-- ── Operadores  🔴 INVENTADO: nombres y teléfonos de fantasía ───────────────
--    ⚠️ Para el demo por WhatsApp REAL, el teléfono DEBE ser el número de
--    prueba dado de alta en Meta. Reemplaza estos placeholders.
insert into operador (id, tenant_id, terminal_id, nombre, telefono, numero_empleado, activo) values
  ('33333333-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000001', 'Juan Pérez Ramírez',      '+521111111101', 'OP-101', true),  -- 🔴 INVENTADO
  ('33333333-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000001', 'Miguel Ángel Torres',     '+521111111102', 'OP-102', true),  -- 🔴 INVENTADO
  ('33333333-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000002', 'José Luis Hernández',     '+521111111103', 'OP-103', true),  -- 🔴 INVENTADO
  ('33333333-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000003', 'Ricardo Gómez Vázquez',   '+521111111104', 'OP-104', true),  -- 🔴 INVENTADO
  ('33333333-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000002', 'Fernando Aguilar Cruz',   '+521111111105', 'OP-105', true)   -- 🔴 INVENTADO
on conflict (id) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- POLÍTICA DE GASTOS  ⚠️  ESTA TABLA NO LA LEE NADIE  ⚠️
--
-- Aquí decía "el motor de cuadre usa `tope_monto` por comprobante y
-- `requiere_cfdi`", y es FALSO desde hace tiempo: la política viva sale de
-- `tenant.config.politica` (ver `DEMO_CONFIG` en src/lib/cuadra/config.ts).
--
-- Se nota en estas mismas filas: aquí abajo el viático se llama `viaticos` y en
-- la config viva se llama `alimentacion`. Son dos listas que ya se separaron.
--
-- Estas filas se conservan porque la tabla sigue en pie con su check de dominio
-- (mig. 0025) por si alguien la revive, pero cambiar un tope AQUÍ no cambia
-- ninguna liquidación. El sitio real es `tenant.config`.
-- Nota de corredor Silao→Laredo (~800 km one-way): casetas esperadas del
-- trayecto ≈ 6-8 plazas, ~$2,800 total 🔴 INVENTADO — documentar el set real.
-- ═══════════════════════════════════════════════════════════════════════════
insert into politica_gasto (tenant_id, concepto, ruta, tope_monto, requiere_cfdi, notas) values
  ('11111111-1111-1111-1111-111111111111', 'diesel',   null, 4000, false, '🔴 INVENTADO: tope por carga de diésel'),
  ('11111111-1111-1111-1111-111111111111', 'caseta',   null, 1500, false, '🔴 INVENTADO: tope por caseta'),
  ('11111111-1111-1111-1111-111111111111', 'viaticos', null, 800,  false, '🔴 INVENTADO: tope de viáticos/comida'),
  ('11111111-1111-1111-1111-111111111111', 'factura',  null, null, true,  '🔴 INVENTADO: facturas requieren CFDI válido')
on conflict do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- VIAJE DEMO (abierto) — Silao → Nuevo Laredo, listo para cuadrar por WhatsApp.
-- 🔴 INVENTADO: anticipo y montos. Diseñado para mostrar UNA diferencia:
--    el diésel $4,200 excede el tope de $4,000 → diferencia de $200.
--    (anticipo = total comprobado, así la ÚNICA diferencia es la de política).
-- ═══════════════════════════════════════════════════════════════════════════
insert into viaje (id, tenant_id, operador_id, terminal_id, folio, origen, destino, anticipo, fecha_inicio, estatus) values
  ('44444444-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '33333333-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001',
   'VJ-2026-0847',                 -- 🔴 INVENTADO: folio
   'Silao, GTO', 'Nuevo Laredo, TAM',
   10600,                          -- 🔴 INVENTADO: anticipo del viaje
   current_date, 'abierto')
on conflict (id) do nothing;

-- 🔴 DEMO: diésel con CFDI de estación completo (IEPS/IVA desglosados +
-- complemento HidroYPetro) → deducible y ACREDITABLE, y aún $200 sobre tope.
insert into gasto (id, tenant_id, viaje_id, concepto, monto, folio, cfdi_uuid, rfc_emisor, rfc_receptor,
  estado_sat, efos, clave_prod_serv, clave_unidad, tipo_comprobante, complemento_hidrocarburos,
  cfdi_esquema_alterno, xml_verificado, forma_pago, sub_total, ieps_traslado, iva_traslado, fecha, ocr_confianza) values
  ('55555555-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '44444444-0000-0000-0000-000000000001',
   'diesel', 4200, 'DS-8801', 'b7e3f1a2-1c4d-4e6f-8a90-1234567890ab', 'ENE160518AB1', 'TIN010101AAA',
   'vigente', false, '15101505', 'LTR', 'I', true, false, true, '03', 3210.00, 408.62, 581.38, current_date - 1, 0.97),
  ('55555555-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '44444444-0000-0000-0000-000000000001',
   'caseta', 1400, 'CA-4471', 'c8f4a2b3-2d5e-4f70-9b01-234567890abc', null, 'TIN010101AAA',
   'vigente', null, null, null, 'I', null, null, true, '04', 1206.90, null, 193.10, current_date - 1, 0.96)
on conflict (id) do nothing;

-- 🔴 DEMO: XML crudo del diésel (CFF 30) — con complemento HidroYPetro real.
insert into cfdi_xml (tenant_id, gasto_id, cfdi_uuid, xml) values (
  '11111111-1111-1111-1111-111111111111', '55555555-0000-0000-0000-000000000001', 'b7e3f1a2-1c4d-4e6f-8a90-1234567890ab',
  '<?xml version="1.0" encoding="UTF-8"?><cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:hidrocarburospetroliferos="http://www.sat.gob.mx/hidrocarburospetroliferos" Version="4.0" Serie="DS" Folio="8801" Fecha="2026-05-15T09:14:00" FormaPago="03" SubTotal="3210.00" Moneda="MXN" Total="4200.00" TipoDeComprobante="I" MetodoPago="PUE" LugarExpedicion="36100"><cfdi:Emisor Rfc="ENE160518AB1" Nombre="Estacion de Servicio Demo SA de CV" RegimenFiscal="601"/><cfdi:Receptor Rfc="TIN010101AAA" Nombre="Transportes Innovativos" DomicilioFiscalReceptor="36100" RegimenFiscalReceptor="601" UsoCFDI="G03"/><cfdi:Conceptos><cfdi:Concepto ClaveProdServ="15101505" ClaveUnidad="LTR" Cantidad="113.00" Descripcion="Diesel" ValorUnitario="28.41" Importe="3210.00" ObjetoImp="02"><cfdi:ComplementoConcepto><hidrocarburospetroliferos:HidroYPetro Version="1.0" TipoPermiso="PER20" NumeroPermiso="PL/12345/EXP/ES/2020" ClaveHYP="PR07" SubProductoHYP="SP14"/></cfdi:ComplementoConcepto></cfdi:Concepto></cfdi:Conceptos><cfdi:Impuestos TotalImpuestosTrasladados="990.00"><cfdi:Traslados><cfdi:Traslado Base="3210.00" Impuesto="003" TipoFactor="Cuota" TasaOCuota="6.1740" Importe="408.62"/><cfdi:Traslado Base="3618.62" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="581.38"/></cfdi:Traslados></cfdi:Impuestos><cfdi:Complemento><tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="1.1" UUID="b7e3f1a2-1c4d-4e6f-8a90-1234567890ab" FechaTimbrado="2026-05-15T09:14:05"/></cfdi:Complemento></cfdi:Comprobante>'
) on conflict (tenant_id, cfdi_uuid) do nothing;

-- ── Historial para que el dashboard no salga vacío 🔴 INVENTADO ─────────────
insert into viaje (id, tenant_id, operador_id, terminal_id, folio, origen, destino, anticipo, fecha_inicio, estatus) values
  ('44444444-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '33333333-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000001', 'VJ-2026-0844', 'Silao, GTO', 'Nuevo Laredo, TAM', 10200, current_date - 2, 'liquidado'),
  ('44444444-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '33333333-0000-0000-0000-000000000003', '22222222-0000-0000-0000-000000000002', 'VJ-2026-0845', 'Guadalajara, JAL', 'Nuevo Laredo, TAM', 11800, current_date - 1, 'liquidado'),
  ('44444444-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', '33333333-0000-0000-0000-000000000004', '22222222-0000-0000-0000-000000000003', 'VJ-2026-0846', 'Nuevo Laredo, TAM', 'Silao, GTO', 9900, current_date - 1, 'liquidado')
on conflict (id) do nothing;

insert into liquidacion (tenant_id, viaje_id, total_comprobado, total_anticipo, diferencia, estatus, diferencias) values
  ('11111111-1111-1111-1111-111111111111', '44444444-0000-0000-0000-000000000002', 10200, 10200, 0, 'cuadrada', '[]'::jsonb),                                                                                                                        -- 🔴 INVENTADO
  ('11111111-1111-1111-1111-111111111111', '44444444-0000-0000-0000-000000000003', 12100, 11800, -300, 'con_diferencias', '[{"tipo":"sobre_politica","monto":300,"nota":"Diésel excede tope por $300"}]'::jsonb),                                    -- 🔴 INVENTADO
  ('11111111-1111-1111-1111-111111111111', '44444444-0000-0000-0000-000000000004', 9900, 9900, 0, 'revisar', '[{"tipo":"sin_cfdi","monto":0,"nota":"Factura de $600 sin CFDI"}]'::jsonb)                                                             -- 🔴 INVENTADO
on conflict do nothing;
