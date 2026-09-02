import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 · BE-19 — ningún `export/*` declaraba `maxDuration`. El export
// de póliza de 92 días y el de facturas de proveedor dependían del default de
// la plataforma. Cada ruta de export declara el literal (Next lo lee en build:
// una constante importada no cuenta — ver `continuar.test.ts`).
// ═══════════════════════════════════════════════════════════════════════════

describe('BE-19: todas las rutas de export declaran maxDuration literal', () => {
  const rutas = globSync('src/app/api/export/**/route.ts').sort();
  it('hay rutas de export que revisar', () => { expect(rutas.length).toBeGreaterThanOrEqual(7); });
  for (const ruta of rutas) {
    it(`${ruta} declara \`export const maxDuration = <número>;\``, () => {
      const fuente = readFileSync(ruta, 'utf8');
      const m = /^export const maxDuration = (\d+);$/m.exec(fuente);
      expect(m, 'falta el literal').not.toBeNull();
      expect(Number(m![1])).toBeGreaterThanOrEqual(60);
      expect(fuente).not.toMatch(/^export const maxDuration = [A-Za-z_]/m);
    });
  }
});
