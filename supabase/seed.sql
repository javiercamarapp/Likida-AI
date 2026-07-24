-- ═══════════════════════════════════════════════════════════════════════════
-- SEED — Cliente demo (demo 6-ago-2026)
--
-- 🔴🔴🔴  TODO LO MARCADO CON "INVENTADO" ES DATO DE FANTASÍA  🔴🔴🔴
--         Reemplázalo con el dato REAL de cliente_demo antes del demo.
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
insert into tenant (id, nombre, rfc, ciudad, plan) values
  ('11111111-1111-1111-1111-111111111111', 'Cliente demo',
   'TIN010101AAA',                 -- 🔴 INVENTADO: RFC real de cliente_demo
   'Silao, Guanajuato', 'demo')
on conflict (id) do nothing;

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
-- POLÍTICA DE GASTOS  🔴🔴🔴 TODA INVENTADA — PARAMETRIZABLE 🔴🔴🔴
-- Estructura de transportista de carga. AJUSTA cada tope con la política real.
-- El motor de cuadre usa `tope_monto` por comprobante y `requiere_cfdi`.
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

insert into gasto (id, tenant_id, viaje_id, concepto, monto, folio, cfdi_uuid, ocr_confianza, cfdi_valido) values
  ('55555555-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '44444444-0000-0000-0000-000000000001', 'diesel',  4200, 'DS-8801', null, 0.97, null),                                   -- 🔴 INVENTADO ($200 sobre tope → la diferencia visible)
  ('55555555-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '44444444-0000-0000-0000-000000000001', 'diesel',  3800, 'DS-8802', null, 0.98, null),                                   -- 🔴 INVENTADO
  ('55555555-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '44444444-0000-0000-0000-000000000001', 'caseta',  1400, 'CA-4471', null, 0.96, null),                                   -- 🔴 INVENTADO
  ('55555555-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', '44444444-0000-0000-0000-000000000001', 'factura', 1200, 'FA-9007', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 0.99, true)  -- 🔴 INVENTADO (CFDI válido)
on conflict (id) do nothing;

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
