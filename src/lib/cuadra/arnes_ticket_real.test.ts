import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { extraerComprobante } from './intake/ocr';
import { cuadrarViaje, cubetaDe, etiquetaConcepto } from './cuadre/engine';
import { DEMO_CONFIG } from './config';

// ═══════════════════════════════════════════════════════════════════════════
// ARNÉS DE TICKET REAL — corre el pipeline COMPLETO sobre una foto de verdad.
//
//     TICKET_PATH=~/Downloads/ticket.jpg npx vitest run arnes_ticket_real
//     TICKET_PATH="a.jpg,b.jpg" npx vitest run arnes_ticket_real   ← dos fotos
//
// Gasta dinero real (una llamada de visión por corrida, ~$0.02 USD) y necesita
// OPENROUTER_API_KEY, así que se SALTA solo cuando no hay `TICKET_PATH`. Nunca
// rompe CI y nunca cuesta sin que alguien lo pida.
//
// POR QUÉ VIVE EN EL REPO: la versión anterior de este arnés se escribió en un
// directorio temporal, se perdió al cerrar la sesión y hubo que reconstruirla.
//
// POR QUÉ PASA LA CONFIG ENTERA: el arnés viejo mandaba solo `politica`. Sin
// `estimulos` no se evalúa el tope de $750/día, y sin `hoy` no corren ni la
// fecha ni el plazo de facturación. Probar con fotos reales contra un motor a
// medias probaba menos de lo que parecía: un ticket de $1,050 de comida pasaba
// sin que nadie notara que excede el tope.
// ═══════════════════════════════════════════════════════════════════════════

const RUTAS = process.env.TICKET_PATH?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
const HOY = process.env.TICKET_HOY ?? new Date().toISOString().slice(0, 10);

for (const l of RUTAS.length ? readFileSync('.env.local', 'utf8').split('\n') : []) {
  const i = l.indexOf('=');
  if (i > 0 && !l.startsWith('#')) process.env[l.slice(0, i)] ||= l.slice(i + 1).trim();
}

describe.skipIf(RUTAS.length === 0)('arnés: ticket real', () => {
  it('pasa por el pipeline entero', async () => {
    const fotos = RUTAS.map((r) => `data:image/jpeg;base64,${readFileSync(r).toString('base64')}`);

    const t0 = Date.now();
    const r = await extraerComprobante(fotos);
    const ms = Date.now() - t0;

    console.log('\n══════ OCR ══════');
    console.log('legible:', r.legible, r.motivo ? `(motivo: ${r.motivo})` : '');
    console.log(JSON.stringify(r.gasto, null, 2));
    console.log(`costo: $${r.costo.costoUsd.toFixed(4)} USD · ${ms} ms · ${r.costo.modelo}`);

    const liq = cuadrarViaje({
      viajeId: 'arnes',
      anticipo: Number(process.env.TICKET_ANTICIPO ?? 5000),
      gastos: [r.gasto],
      politica: DEMO_CONFIG.politica,
      estimulos: DEMO_CONFIG.estimulos,
      hidrocarburos: DEMO_CONFIG.hidrocarburos,
      empresaRfc: DEMO_CONFIG.empresa.rfc,
      hoy: HOY,
    });

    console.log('\n══════ MOTOR ══════  (hoy =', HOY, ')');
    console.log('etiqueta:', etiquetaConcepto(r.gasto.concepto, r.gasto.ocrExtra as Record<string, unknown>));
    console.log('cubeta:', cubetaDe(r.gasto, liq.diferencias ?? []));
    console.log('comprobado:', liq.totalComprobado, '· diferencia:', liq.diferencia, '· estatus:', liq.estatus);
    console.log('deducible:', liq.totalDeducible, '· no deducible:', liq.totalNoDeducible, '· por confirmar:', liq.totalPorConfirmar);
    console.log('\nobservaciones:');
    for (const d of liq.diferencias ?? []) console.log(`  · [${d.tipo}] ${d.nota ?? ''}`);
  }, 180_000);
});
