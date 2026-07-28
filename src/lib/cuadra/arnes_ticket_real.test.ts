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

// Un COMPROBANTE por grupo; dentro del grupo, varias fotos del MISMO ticket
// (el protocolo de dos fotos: el ticket completo y el acercamiento al código).
//
//   TICKET_PATH="a.jpg;b.jpg,b2.jpg;c.jpg"
//              └─ ticket 1 ─┘└─ ticket 2, dos fotos ─┘└─ 3 ─┘
//
// Separar por ";" importa: pasar cuatro tickets distintos como cuatro fotos del
// mismo comprobante da UN gasto y tira tres. Y esa es justo la liquidación de
// verdad — un viaje trae varios comprobantes, no uno.
const GRUPOS = (process.env.TICKET_PATH ?? '')
  .split(';').map((g) => g.split(',').map((s) => s.trim()).filter(Boolean)).filter((g) => g.length);
const HOY = process.env.TICKET_HOY ?? new Date().toISOString().slice(0, 10);

for (const l of GRUPOS.length ? readFileSync('.env.local', 'utf8').split('\n') : []) {
  const i = l.indexOf('=');
  if (i > 0 && !l.startsWith('#')) process.env[l.slice(0, i)] ||= l.slice(i + 1).trim();
}

const dataUrl = (r: string) => `data:image/jpeg;base64,${readFileSync(r).toString('base64')}`;

describe.skipIf(GRUPOS.length === 0)('arnés: tickets reales', () => {
  it('pasa por el pipeline entero', async () => {
    const gastos = [];
    let costo = 0;

    for (const grupo of GRUPOS) {
      const t0 = Date.now();
      const r = await extraerComprobante(grupo.map(dataUrl));
      costo += r.costo.costoUsd;
      console.log(`\n══════ OCR · ${grupo.map((g) => g.split('/').pop()).join(' + ')} ══════`);
      console.log('legible:', r.legible, r.motivo ? `(motivo: ${r.motivo})` : '', `· $${r.costo.costoUsd.toFixed(4)} · ${Date.now() - t0} ms`);
      console.log(JSON.stringify(r.gasto, null, 2));
      // El acercamiento del protocolo de dos fotos NO es un gasto: si entrara
      // solo, el mismo dinero se contaría dos veces.
      if (r.motivo === 'solo_codigo') { console.log('→ acercamiento, no se da de alta como gasto'); continue; }
      gastos.push(r.gasto);
    }

    const liq = cuadrarViaje({
      viajeId: 'arnes',
      anticipo: Number(process.env.TICKET_ANTICIPO ?? 5000),
      gastos,
      politica: DEMO_CONFIG.politica,
      estimulos: DEMO_CONFIG.estimulos,
      hidrocarburos: DEMO_CONFIG.hidrocarburos,
      empresaRfc: DEMO_CONFIG.empresa.rfc,
      hoy: HOY,
    });

    console.log('\n══════ MOTOR ══════  (hoy =', HOY, `· ${gastos.length} comprobantes)`);
    for (const g of gastos) {
      console.log(`  ${etiquetaConcepto(g.concepto, g.ocrExtra as Record<string, unknown>).padEnd(22)} $${String(g.monto).padStart(9)}  → ${cubetaDe(g, (liq.diferencias ?? []).filter((d) => d.gastoId === g.id))}`);
    }
    console.log('\ncomprobado:', liq.totalComprobado, '· anticipo:', liq.totalAnticipo, '· diferencia:', liq.diferencia, '· estatus:', liq.estatus);
    console.log('deducible:', liq.totalDeducible, '· no deducible:', liq.totalNoDeducible, '· por confirmar:', liq.totalPorConfirmar);
    console.log('IVA acreditable:', liq.ivaAcreditable, '· IEPS:', liq.iepsAcreditable, '· litros diésel:', liq.litrosDieselAcreditables, '· peaje:', liq.peajeAcreditable);
    console.log(`\nobservaciones (${liq.diferencias?.length ?? 0}):`);
    for (const d of liq.diferencias ?? []) console.log(`  · [${d.tipo}] ${d.nota ?? ''}`);
    console.log(`\ncosto total de visión: $${costo.toFixed(4)} USD`);
  }, 300_000);
});
