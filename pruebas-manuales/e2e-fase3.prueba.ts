// TEMPORAL — fase 3 e2e: casos feos. Se borra.
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';

for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
  const i = l.indexOf('=');
  if (i > 0 && !l.startsWith('#')) process.env[l.slice(0, i)] ||= l.slice(i + 1).split('#')[0].trim();
}
process.env.WHATSAPP_ACCESS_TOKEN = '';
process.env.WHATSAPP_PHONE_NUMBER_ID = '';

const OUT = process.env.E2E_OUT!;
const DIR = process.env.E2E_DIR!;

describe('fase 3 · casos feos', () => {
  it('corre', async () => {
    const { crearViaje } = await import('@/lib/cuadra/operacion');
    const { addGasto, getGastos, gastoExistePorHash, ubicarGastoPorHash, saveLiquidacion } = await import('@/lib/cuadra/repo');
    const { extraerComprobante } = await import('@/lib/cuadra/intake/ocr');
    const { hashImagen } = await import('@/lib/cuadra/intake/hash');
    const { decidirFoto } = await import('@/lib/cuadra/intake/decidir');
    const { decidirAcuse, CONFIANZA_PROBADA, CONFIANZA_LEGIBLE } = await import('@/lib/cuadra/acuse_ticket');
    const { cuadrarDesdeDB } = await import('@/lib/cuadra/cuadre/desde_db');
    const { estadoDelViaje, interpretarPregunta, armarRespuesta } = await import('@/lib/cuadra/consulta_chofer');
    const { resumenCuadre } = await import('@/lib/cuadra/cuadre/resumen');
    const { supabaseAdmin } = await import('@/lib/supabase/admin');

    const ids = JSON.parse(readFileSync(`${OUT}/ids.json`, 'utf8'));
    const tenantId = ids.tenantId as string;
    const viajeId = ids.viajeId as string;
    const operadorId = ids.operadorId as string;
    const extra: Record<string, unknown> = {};
    const dataUrl = (r: string) => `data:image/jpeg;base64,${readFileSync(r).toString('base64')}`;

    // ── A. LA MISMA FOTO DOS VECES (bytes idénticos) ──────────────────────
    console.log('\n═══ A · MISMA FOTO DOS VECES ═══');
    const du = dataUrl(`${DIR}/IMG_9473.jpg`);
    const h = await hashImagen(du);
    const yaEsta = await gastoExistePorHash(viajeId, h, tenantId);
    console.log('gastoExistePorHash (pre-chequeo, ahorra el OCR):', yaEsta);
    const donde = await ubicarGastoPorHash(tenantId, h);
    console.log('ubicarGastoPorHash (toda la flota):', JSON.stringify(donde));
    // Y el índice único, forzándolo: ¿qué pasa si el pre-chequeo no atajara?
    try {
      await addGasto(tenantId, viajeId, { id: crypto.randomUUID(), concepto: 'otro', monto: 225.56, imgHash: h } as never);
      console.log('!! el índice único NO lo rechazó — gasto duplicado insertado');
    } catch (e) {
      console.log('índice único lo rechazó:', (e as { code?: string }).code, '-', (e as Error).message.slice(0, 90));
    }
    extra.a = { preChequeo: yaEsta, ubicado: donde };

    // ── B. UNA FOTO QUE NO ES UN TICKET ───────────────────────────────────
    console.log('\n═══ B · FOTO QUE NO ES TICKET (ilustración de un camión en una caseta) ═══');
    const noTicket = dataUrl('public/images/login-hero.jpg');
    const rNo = await extraerComprobante([noTicket]);
    console.log('legible:', rNo.legible, '| motivo:', rNo.motivo, '| costo $', rNo.costo.costoUsd.toFixed(5));
    console.log(JSON.stringify(rNo.gasto, null, 2));
    const decNo = decidirFoto(rNo, await getGastos(viajeId, tenantId));
    const acuNo = decidirAcuse({
      montoMxn: rNo.gasto.monto, concepto: rNo.gasto.concepto, fecha: rNo.gasto.fecha ?? null,
      confianza: rNo.gasto.ocrConfianza ?? null, deCfdi: false, esRepeticion: false,
    });
    console.log('decisión:', JSON.stringify(decNo), '| acuse:', JSON.stringify(acuNo));
    extra.b = { legible: rNo.legible, motivo: rNo.motivo, gasto: rNo.gasto, decision: decNo, acuse: acuNo, costo: rNo.costo };

    // ── C. SOBREGIRO ──────────────────────────────────────────────────────
    console.log('\n═══ C · SOBREGIRO (anticipo $300 contra $664) ═══');
    const viajeSobre = await crearViaje(tenantId, {
      folio: 'V-E2E-SOBRE', origen: 'Mérida', destino: 'Valladolid',
      fechaInicio: '2026-08-02', anticipo: 300, operadorId,
    });
    ids.viajeSobre = viajeSobre;
    await addGasto(tenantId, viajeSobre, {
      id: crypto.randomUUID(), concepto: 'alimentacion', monto: 664, fecha: '2026-08-03',
      folio: 'SOBRE-1', ocrConfianza: 0.95,
    } as never);
    const liqSobre = await cuadrarDesdeDB(tenantId, viajeSobre);
    console.log('comprobado', liqSobre.totalComprobado, '| anticipo', liqSobre.totalAnticipo, '| diferencia', liqSobre.diferencia, '| estatus', liqSobre.estatus);
    for (const d of liqSobre.diferencias ?? []) console.log(`  · [${d.tipo}] $${d.monto ?? 0} — ${d.nota ?? ''}`);
    console.log('--- lo que le llega al OPERADOR por WhatsApp ---');
    console.log(resumenCuadre(liqSobre, true, 'operador'));
    const estSobre = await estadoDelViaje(tenantId, viajeSobre);
    console.log('--- "¿cuánto llevo?" ---');
    console.log(armarRespuesta(interpretarPregunta('cuanto llevo')!, estSobre));
    extra.c = { liq: liqSobre, estado: estSobre };

    // ── D. CERRAR SIN COMPROBANTES ────────────────────────────────────────
    console.log('\n═══ D · CERRAR SIN COMPROBANTES (anticipo $1,500, cero gastos) ═══');
    const viajeVacio = await crearViaje(tenantId, {
      folio: 'V-E2E-VACIO', origen: 'Mérida', destino: 'Campeche',
      fechaInicio: '2026-08-04', anticipo: 1500, operadorId,
    });
    ids.viajeVacio = viajeVacio;
    const liqVacia = await cuadrarDesdeDB(tenantId, viajeVacio);
    console.log('comprobado', liqVacia.totalComprobado, '| anticipo', liqVacia.totalAnticipo, '| diferencia', liqVacia.diferencia, '| estatus', liqVacia.estatus);
    for (const d of liqVacia.diferencias ?? []) console.log(`  · [${d.tipo}] $${d.monto ?? 0} — ${d.nota ?? ''}`);
    console.log('--- lo que le llega al OPERADOR ---');
    console.log(resumenCuadre(liqVacia, true, 'operador'));
    const liqVaciaId = await saveLiquidacion(tenantId, liqVacia);
    const { data: vv } = await supabaseAdmin().from('viaje').select('estatus').eq('id', viajeVacio).single();
    console.log('viaje tras cierre sin comprobantes:', JSON.stringify(vv), '| liq', liqVaciaId);
    extra.d = { liq: liqVacia, estatus: vv };

    // ── E. LA ESCALERA DEL ACUSE contra la confianza REAL ─────────────────
    console.log('\n═══ E · ESCALERA DEL ACUSE ═══');
    console.log(`umbrales: PROBADA=${CONFIANZA_PROBADA} LEGIBLE=${CONFIANZA_LEGIBLE}`);
    const ocr = JSON.parse(readFileSync(`${OUT}/ocr.json`, 'utf8')) as Array<Record<string, unknown>>;
    const confs = ocr.map((r) => (r.gasto as Record<string, unknown>).ocrConfianza);
    console.log('confianzas REALES de las 7 fotos:', JSON.stringify(confs));
    for (const c of [0.5, 0.64, 0.65, 0.7, 0.89, 0.9, 0.95]) {
      const d = decidirAcuse({ montoMxn: 100, concepto: 'otro', fecha: '2026-08-02', confianza: c, deCfdi: false, esRepeticion: false });
      console.log(`  confianza ${c} → ${d.peldano} (${d.porque})`);
    }
    extra.e = { confianzasReales: confs };

    writeFileSync(`${OUT}/ids.json`, JSON.stringify(ids, null, 2));
    writeFileSync(`${OUT}/feos.json`, JSON.stringify(extra, null, 2));
    expect(true).toBe(true);
  }, 600_000);
});
