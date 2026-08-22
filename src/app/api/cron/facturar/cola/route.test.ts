import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 18 (M2, B12): la cola declaraba maxDuration = 600 contra un techo
// de plataforma verificado en 300, y el corte real del lote se deriva del
// maxDuration de `../route.ts`. Los dos números tienen que ser el MISMO: si
// se separan, el que lee la ruta de la cola dimensiona contra un presupuesto
// que no existe. Next exige literales estáticos, así que se leen del fuente.
// ═══════════════════════════════════════════════════════════════════════════
const leerMax = (ruta: string) => Number(readFileSync(ruta, 'utf8').match(/export const maxDuration = (\d+);/)?.[1]);

describe('el presupuesto de la cola de facturación', () => {
  it('la cola y el cron declaran el MISMO maxDuration (el corte del lote se deriva del cron)', () => {
    expect(leerMax('src/app/api/cron/facturar/cola/route.ts')).toBe(leerMax('src/app/api/cron/facturar/route.ts'));
  });

  it('y no rebasa el techo del plan (pro: 300s)', () => {
    expect(leerMax('src/app/api/cron/facturar/cola/route.ts')).toBeLessThanOrEqual(300);
  });
});
