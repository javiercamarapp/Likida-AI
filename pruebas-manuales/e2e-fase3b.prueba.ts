// TEMPORAL — fase 3b: lo que quedó del bloqueo. Se borra.
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';

for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
  const i = l.indexOf('=');
  if (i > 0 && !l.startsWith('#')) process.env[l.slice(0, i)] ||= l.slice(i + 1).split('#')[0].trim();
}
process.env.WHATSAPP_ACCESS_TOKEN = '';
process.env.WHATSAPP_PHONE_NUMBER_ID = '';

const OUT = process.env.E2E_OUT!;

describe('fase 3b', () => {
  it('corre', async () => {
    const { crearViaje } = await import('@/lib/likida/operacion');
    const { crearOperador } = await import('@/lib/likida/administracion');
    const { addGasto, saveLiquidacion } = await import('@/lib/likida/repo');
    const { cuadrarDesdeDB } = await import('@/lib/likida/cuadre/desde_db');
    const { resumenCuadre } = await import('@/lib/likida/cuadre/resumen');
    const { estadoDelViaje, interpretarPregunta, armarRespuesta } = await import('@/lib/likida/consulta_chofer');
    const { supabaseAdmin } = await import('@/lib/supabase/admin');

    const ids = JSON.parse(readFileSync(`${OUT}/ids.json`, 'utf8'));
    const tenantId = ids.tenantId as string;
    const gastosDb = JSON.parse(readFileSync(`${OUT}/gastos_db.json`, 'utf8')) as Array<Record<string, unknown>>;
    const extra: Record<string, unknown> = {};

    // ── A2. EL ÍNDICE ÚNICO DE HASH, en un viaje ABIERTO ──────────────────
    console.log('\n═══ A2 · uq_gasto_img_hash en viaje ABIERTO (y en OTRO viaje de la misma flota) ═══');
    const op2 = await crearOperador(tenantId, { nombre: 'Pedro Segundo Prueba', telefono: '9997654321' });
    ids.operador2 = op2;
    const viajeAbierto = await crearViaje(tenantId, {
      folio: 'V-E2E-ABIERTO', origen: 'Mérida', destino: 'Progreso',
      fechaInicio: '2026-08-04', anticipo: 1000, operadorId: op2,
    });
    ids.viajeAbierto = viajeAbierto;
    const hashYaUsado = gastosDb[0].img_hash as string;
    try {
      await addGasto(tenantId, viajeAbierto, {
        id: crypto.randomUUID(), concepto: 'otro', monto: 225.56, folio: 'X', imgHash: hashYaUsado,
      } as never);
      console.log('!! ACEPTADO: la MISMA foto entró como gasto en un SEGUNDO viaje de la misma flota');
      extra.a2 = 'aceptado (duplicado entre viajes)';
    } catch (e) {
      console.log('rechazado:', (e as { code?: string }).code, '-', (e as Error).message.slice(0, 140));
      extra.a2 = { code: (e as { code?: string }).code, msg: (e as Error).message };
    }

    // ── D. CERRAR SIN COMPROBANTES ────────────────────────────────────────
    console.log('\n═══ D · CERRAR SIN COMPROBANTES ═══');
    const liqVacia = await cuadrarDesdeDB(tenantId, viajeAbierto);
    const { data: cuantos } = await supabaseAdmin().from('gasto').select('id').eq('viaje_id', viajeAbierto);
    console.log('gastos en ese viaje:', cuantos?.length ?? 0);
    console.log('comprobado', liqVacia.totalComprobado, '| anticipo', liqVacia.totalAnticipo, '| diferencia', liqVacia.diferencia, '| estatus', liqVacia.estatus);
    for (const d of liqVacia.diferencias ?? []) console.log(`  · [${d.tipo}] $${d.monto ?? 0} — ${d.nota ?? ''}`);
    console.log('--- al OPERADOR ---');
    console.log(resumenCuadre(liqVacia, true, 'operador'));
    const est = await estadoDelViaje(tenantId, viajeAbierto);
    console.log('--- "¿cuánto llevo?" ---');
    console.log(armarRespuesta(interpretarPregunta('cuanto llevo')!, est));
    const liqId = await saveLiquidacion(tenantId, liqVacia);
    const { data: vv } = await supabaseAdmin().from('viaje').select('estatus').eq('id', viajeAbierto).single();
    console.log('viaje tras cierre:', JSON.stringify(vv), '| liq', liqId);
    extra.d = { liq: liqVacia, estatus: vv };

    // ── F. CERRAR EL VIAJE DEL SOBREGIRO (para dejarlo consistente) ───────
    const liqSobre = await cuadrarDesdeDB(tenantId, ids.viajeSobre as string);
    const idSobre = await saveLiquidacion(tenantId, liqSobre);
    console.log('\nviaje sobregiro cerrado:', idSobre, 'diferencia', liqSobre.diferencia);

    // ── G. RELOJ: qué día cree el motor vs qué día imprime el PDF ─────────
    const { ventanaDesdeDB } = await import('@/lib/likida/cuadre/desde_db');
    const { fechaMx } = await import('@/lib/formato');
    const v = await ventanaDesdeDB(tenantId, ids.viajeId as string);
    console.log('\n═══ G · RELOJ ═══');
    console.log('motor (ventanaDelViaje, UTC):', JSON.stringify(v));
    console.log('PDF / pantalla (fechaMx, America/Mexico_City):', fechaMx(new Date().toISOString()));
    console.log('Date UTC:', new Date().toISOString());
    extra.g = { motor: v, pdf: fechaMx(new Date().toISOString()), utc: new Date().toISOString() };

    writeFileSync(`${OUT}/ids.json`, JSON.stringify(ids, null, 2));
    writeFileSync(`${OUT}/feos2.json`, JSON.stringify(extra, null, 2));
    expect(true).toBe(true);
  }, 600_000);
});
