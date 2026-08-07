// TEMPORAL — arnés e2e con tickets reales. Se borra al terminar la sesión.
// npx vitest run --config pruebas-manuales/vitest.config.ts e2e-tickets-reales
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { extraerComprobante } from '@/lib/likida/intake/ocr';
import { hashImagen } from '@/lib/likida/intake/hash';

const DIR = process.env.E2E_DIR!;
const OUT = process.env.E2E_OUT!;
const FOTOS = (process.env.E2E_FOTOS ?? '').split(',').filter(Boolean);

for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
  const i = l.indexOf('=');
  if (i > 0 && !l.startsWith('#')) process.env[l.slice(0, i)] ||= l.slice(i + 1).split('#')[0].trim();
}

const dataUrl = (r: string) => `data:image/jpeg;base64,${readFileSync(r).toString('base64')}`;

describe('fase 1 · OCR real de los tickets', () => {
  it('extrae los 7', async () => {
    if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
    let total = 0;
    const filas: unknown[] = [];
    for (const nombre of FOTOS) {
      const ruta = `${DIR}/${nombre}`;
      const du = dataUrl(ruta);
      const t0 = Date.now();
      const r = await extraerComprobante([du]);
      const ms = Date.now() - t0;
      const h = await hashImagen(du);
      total += r.costo.costoUsd;
      const fila = { foto: nombre, imgHash: h, ms, ...r };
      filas.push(fila);
      console.log(`\n═══ ${nombre} ═══ legible=${r.legible} motivo=${r.motivo ?? '-'} $${r.costo.costoUsd.toFixed(5)} ${ms}ms tokIn=${r.costo.tokensIn} tokOut=${r.costo.tokensOut} modelo=${r.costo.modelo}`);
      console.log(JSON.stringify(r.gasto, null, 2));
    }
    writeFileSync(`${OUT}/ocr.json`, JSON.stringify(filas, null, 2));
    console.log(`\n>>> COSTO TOTAL: $${total.toFixed(5)} USD`);
    expect(filas.length).toBe(FOTOS.length);
  }, 900_000);
});
