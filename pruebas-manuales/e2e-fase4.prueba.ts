// TEMPORAL — fase 4: cierre del sobregiro + reloj + doble cierre. Se borra.
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';

for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
  const i = l.indexOf('=');
  if (i > 0 && !l.startsWith('#')) process.env[l.slice(0, i)] ||= l.slice(i + 1).split('#')[0].trim();
}
process.env.WHATSAPP_ACCESS_TOKEN = '';
process.env.WHATSAPP_PHONE_NUMBER_ID = '';

const OUT = process.env.E2E_OUT!;
const TENANT = '1ea1b146-8ce6-4958-be53-9d0ec83625f3';
const V_MAIN = '7a852206-d471-446b-9a82-0423080b3efc';
const V_SOBRE = 'df7c9548-f51e-4532-bbb5-59a3e4ecb166';

describe('fase 4', () => {
  it('corre', async () => {
    const { saveLiquidacion } = await import('@/lib/cuadra/repo');
    const { cuadrarDesdeDB, ventanaDesdeDB } = await import('@/lib/cuadra/cuadre/desde_db');
    const { fechaMx } = await import('@/lib/formato');
    const { supabaseAdmin } = await import('@/lib/supabase/admin');
    const extra: Record<string, unknown> = {};

    // Cierre del sobregiro
    const liqSobre = await cuadrarDesdeDB(TENANT, V_SOBRE);
    const idSobre = await saveLiquidacion(TENANT, liqSobre);
    console.log('sobregiro cerrado:', idSobre, '| diferencia', liqSobre.diferencia, '| estatus', liqSobre.estatus);

    // ── DOBLE CIERRE del mismo viaje: ¿idempotente? ──────────────────────
    console.log('\n═══ H · CERRAR DOS VECES EL MISMO VIAJE ═══');
    const liq2 = await cuadrarDesdeDB(TENANT, V_MAIN);
    const id2 = await saveLiquidacion(TENANT, liq2);
    const { data: cuantas } = await supabaseAdmin().from('liquidacion').select('id').eq('viaje_id', V_MAIN);
    console.log('segundo cierre devolvió:', id2, '| liquidaciones para ese viaje:', cuantas?.length);
    extra.h = { id2, filas: cuantas?.length };

    // ── RELOJ ────────────────────────────────────────────────────────────
    const v = await ventanaDesdeDB(TENANT, V_MAIN);
    console.log('\n═══ G · RELOJ ═══');
    console.log('motor (ventanaDelViaje, UTC):', JSON.stringify(v));
    console.log('PDF/pantalla (fechaMx, America/Mexico_City):', fechaMx(new Date().toISOString()));
    console.log('reloj UTC:', new Date().toISOString());
    extra.g = { motor: v, pdf: fechaMx(new Date().toISOString()), utc: new Date().toISOString() };

    writeFileSync(`${OUT}/feos3.json`, JSON.stringify(extra, null, 2));
    expect(true).toBe(true);
  }, 300_000);
});
