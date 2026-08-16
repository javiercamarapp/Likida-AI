// ═══════════════════════════════════════════════════════════════════════════
// FASE 1, CIERRE DE PUNTA A PUNTA (16-ago-2026) — la PRIMERA corrida real de
// `liquidacion` en `agente_corrida`.
//
// Corre contra la base REAL (demo tenant) con el MOTOR real: siembra un viaje
// nuevo para un operador sin viaje abierto (VJ-2026-0847, Miguel Ángel
// Torres) con dos gastos que cuadran contra el anticipo, y lo cierra por la
// puerta real — executeTool('guardar_liquidacion') — que corre el cuadre
// real, genera los DOS PDFs reales a storage, persiste la liquidación,
// consulta el interruptor real y anota la corrida (0115).
//
// CÓMO SE CORRE (manual, nunca en CI — necesita .env.local):
//   set -a; source .env.local; set +a
//   npx vitest run --include 'pruebas-manuales/**/*.prueba.ts' \
//     pruebas-manuales/cierre-real-0847.prueba.ts
//
// El viaje queda como dato del demo a propósito (un liquidado más, con la
// misma narrativa Silao→Nuevo Laredo del seed). No se limpia.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';

const TENANT = process.env.DEMO_TENANT_ID!;
const OPERADOR = '33333333-0000-0000-0000-000000000002'; // Miguel Ángel Torres (seed, sin viaje abierto)
const TERMINAL = '22222222-0000-0000-0000-000000000001';
const FOLIO = 'VJ-2026-0847';

describe('cierre real de punta a punta — VJ-2026-0847', () => {
  it('siembra el viaje, lo cierra por el motor real y la corrida queda en agente_corrida', async () => {
    expect(TENANT, 'DEMO_TENANT_ID tiene que venir de .env.local').toBeTruthy();
    const { supabaseAdmin } = await import('@/lib/supabase/admin');
    const admin = supabaseAdmin();

    // ── 1. Sembrar el viaje + 2 gastos (misma forma que el seed) ───────────
    const viajeId = randomUUID();
    const hoy = new Date().toISOString().slice(0, 10);
    const { error: errViaje } = await admin.from('viaje').insert({
      id: viajeId, tenant_id: TENANT, operador_id: OPERADOR, terminal_id: TERMINAL,
      folio: FOLIO, origen: 'Silao, GTO', destino: 'Nuevo Laredo, TAM',
      anticipo: 5600, fecha_inicio: hoy, estatus: 'abierto',
    });
    expect(errViaje, `insert viaje: ${errViaje?.message}`).toBeNull();

    const { error: errGastos } = await admin.from('gasto').insert([
      {
        id: randomUUID(), tenant_id: TENANT, viaje_id: viajeId,
        concepto: 'diesel', monto: 4200, folio: 'DS-8847', cfdi_uuid: randomUUID(),
        rfc_emisor: 'ENE160518AB1', rfc_receptor: 'GMX0902279I1',
        estado_sat: 'vigente', efos: false, clave_prod_serv: '15101505', clave_unidad: 'LTR',
        tipo_comprobante: 'I', complemento_hidrocarburos: true, cfdi_esquema_alterno: false,
        xml_verificado: true, forma_pago: '03', sub_total: 3210.00, ieps_traslado: 408.62,
        iva_traslado: 581.38, fecha: hoy, ocr_confianza: 0.97, ocr_extra: { litros: 113 },
      },
      {
        id: randomUUID(), tenant_id: TENANT, viaje_id: viajeId,
        concepto: 'caseta', monto: 1400, folio: 'CA-4847', cfdi_uuid: randomUUID(),
        rfc_emisor: null, rfc_receptor: 'GMX0902279I1',
        estado_sat: 'vigente', efos: null, tipo_comprobante: 'I',
        xml_verificado: true, forma_pago: '04', sub_total: 1206.90, iva_traslado: 193.10,
        fecha: hoy, ocr_confianza: 0.96,
      },
    ]);
    expect(errGastos, `insert gastos: ${errGastos?.message}`).toBeNull();

    // ── 2. El cierre por la puerta REAL ────────────────────────────────────
    await import('@/lib/likida/tools');
    const { executeTool } = await import('@/lib/llm/tool-executor');
    const r = await executeTool('guardar_liquidacion', {}, {
      tenantId: TENANT, viajeId, operadorId: OPERADOR, telefono: '+521111111102',
    });
    console.log('resultado del cierre:', JSON.stringify(
      { success: r.success, error: r.error, ...(r.result && typeof r.result === 'object'
        ? { liquidacion_id: (r.result as Record<string, unknown>).liquidacion_id,
            estatus: (r.result as Record<string, unknown>).estatus,
            pdf_generado: (r.result as Record<string, unknown>).pdf_generado,
            pdf_contralor_generado: (r.result as Record<string, unknown>).pdf_contralor_generado }
        : {}) },
    ));
    expect(r.success, String(r.error)).toBe(true);
    const res = r.result as Record<string, unknown>;
    expect(res.liquidacion_id).toBeTruthy();
    expect(res.pdf_generado, 'el PDF del operador tiene que subir de verdad').toBe(true);
    expect(res.pdf_contralor_generado, 'el PDF del contralor tiene que subir de verdad').toBe(true);

    // ── 3. La PRUEBA de la fase: la corrida quedó en agente_corrida ────────
    const { data: corridas, error: errCorridas } = await admin
      .from('agente_corrida')
      .select('agente, disparo, estado, resumen, tenant_id')
      .eq('tenant_id', TENANT).eq('agente', 'liquidacion')
      .order('inicio', { ascending: false }).limit(1);
    expect(errCorridas, `leer corridas: ${errCorridas?.message}`).toBeNull();
    console.log('corrida registrada:', JSON.stringify(corridas));
    expect(corridas, 'liquidacion tiene que aparecer en agente_corrida').toHaveLength(1);
    expect(corridas![0]).toMatchObject({ agente: 'liquidacion', disparo: 'whatsapp', estado: 'ok' });
    expect((corridas![0].resumen as Record<string, unknown>).liquidacionId).toBe(res.liquidacion_id);
  }, 120_000);
});
