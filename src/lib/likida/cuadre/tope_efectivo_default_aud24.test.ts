// ═══════════════════════════════════════════════════════════════════════════
// AUD24 · PRU-2 (ALTO) — el tope de efectivo de la LISR 27-III (`?? 2000`) no
// tenía ancla: la mutación M21 (`engine.ts:508`, `?? 2000` → `?? 20000`) pasó
// las 43 pruebas de `cuadre/` y la suite completa.
//
// Ninguna prueba existente pisa la FRONTERA del default: las que tocan
// efectivo o pasan `estimulos.efectivoTopeMxn` explícito, o usan montos muy
// por encima ($58,000, FIS-C3) o muy por debajo del tope. Un diésel — aquí
// una caseta, para no entrar a la rama de combustible — de $2,000.01 pagado en
// efectivo SIN `estimulos` es exactamente el caso que sostiene el hallazgo:
// con 15,000 viajes/mes es la banda donde vive la mayoría de los tickets
// reales (diésel $3–8k, casetas, refacciones).
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { cuadrarViaje } from './engine';
import type { Gasto } from '@/types/likida';

const gastoEfectivo = (monto: number): Gasto => ({
  id: 'g1', concepto: 'caseta', monto, folio: 'A1', fecha: '2026-05-01',
  ocrConfianza: 0.95, cfdiUuid: 'u-g1', xmlVerificado: true, rfcReceptor: 'REC010101AA1',
  formaPago: '01', ivaTraslado: 0,
});

const tipos = (l: ReturnType<typeof cuadrarViaje>) => (l.diferencias ?? []).map((d) => d.tipo);

describe('PRU-2: el tope de efectivo por default (sin estimulos) es $2,000, no $20,000', () => {
  it('$2,000.01 en efectivo SIN estimulos → efectivo_sobre_tope (no deducible)', () => {
    const l = cuadrarViaje({ viajeId: 'v1', anticipo: 2_000.01, politica: [], gastos: [gastoEfectivo(2_000.01)] });
    expect(tipos(l)).toContain('efectivo_sobre_tope');
  });

  it('$2,000.00 exactos en efectivo SIN estimulos → NO cruza el tope', () => {
    const l = cuadrarViaje({ viajeId: 'v1', anticipo: 2_000, politica: [], gastos: [gastoEfectivo(2_000)] });
    expect(tipos(l)).not.toContain('efectivo_sobre_tope');
  });

  it('con efectivoTopeMxn: 5000 explícito, $4,999 pasa (el default no lo tapa)', () => {
    const l = cuadrarViaje({
      viajeId: 'v1', anticipo: 4_999, politica: [], gastos: [gastoEfectivo(4_999)],
      estimulos: { peajeFactor: 0.5, viaticosTopeFiscalDiarioMxn: 750, efectivoTopeMxn: 5000, clavesDieselIeps: [] },
    });
    expect(tipos(l)).not.toContain('efectivo_sobre_tope');
  });
});
