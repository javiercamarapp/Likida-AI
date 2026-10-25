import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PRESUPUESTO_IMPORTACION_MS } from '@/lib/likida/liquidacion_externa/importar_archivo';

// A37-O7-06 · las páginas que alojan acciones con presupuesto de 45 s declaran un maxDuration literal con margen.
const MARGEN_S = 10;
describe('A37-O7-06: maxDuration de las páginas con acciones de presupuesto largo', () => {
  const paginas = ['src/app/dashboard/agentes/peajes/page.tsx', 'src/app/dashboard/agentes/liquidacion/page.tsx'];
  for (const ruta of paginas) {
    it(`${ruta} declara \`export const maxDuration = <número>;\` por encima del presupuesto de 45 s`, () => {
      const m = /^export const maxDuration = (\d+);$/m.exec(readFileSync(ruta, 'utf8'));
      expect(m, 'falta el literal').not.toBeNull();
      expect(Number(m![1]) * 1000).toBeGreaterThanOrEqual(PRESUPUESTO_IMPORTACION_MS + MARGEN_S * 1000);
    });
  }
  it('el presupuesto de la subida manual de peajes sigue siendo de 45 s (si cambia, revisar el maxDuration)', () => {
    expect(readFileSync('src/lib/likida/peajes/ingesta.ts', 'utf8')).toContain('venceEn: Date.now() + 45_000');
  });
});
